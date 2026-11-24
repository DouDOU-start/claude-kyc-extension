package kyc

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestStatusUsesSessionAndExplicitFlags(t *testing.T) {
	for _, options := range []Options{{}, {RefreshSession: true}, {RefreshSession: true, AttemptRetry: true}} {
		t.Run(fmt.Sprintf("refresh=%v retry=%v", options.RefreshSession, options.AttemptRetry), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				cookie, err := request.Cookie("sessionKey")
				if err != nil || cookie.Value != "fixture-session" {
					t.Error("session cookie missing")
				}
				if request.Header.Get("anthropic-client-platform") != "web_claude_ai" {
					t.Error("web client header missing")
				}
				if request.Method != http.MethodGet || request.URL.EscapedPath() != "/api/organizations/org%2Fname/kyc_status" {
					t.Error("unexpected KYC endpoint")
				}
				if (request.URL.Query().Get("refresh_session") == "true") != options.RefreshSession ||
					(request.URL.Query().Get("attempt_retry") == "true") != options.AttemptRetry {
					t.Error("unexpected refresh flags")
				}
				fmt.Fprint(writer, `{"status":"pending","should_poll":true,"vendor_inquiry_url":"https://inquiry.withpersona.com/verify?inquiry-id=fixture"}`)
			}))
			defer server.Close()

			client, err := newClient("fixture-session", "", "org/name", server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			status, err := client.Status(context.Background(), options)
			if err != nil || status.Status != "pending" || !status.ShouldPoll || status.VendorInquiryURL == "" {
				t.Fatal("valid KYC response rejected", err)
			}
		})
	}
}

func TestTerminalStatusClearsVendorLink(t *testing.T) {
	for _, state := range []string{"verified", "not_required", "denied", "failed", "expired"} {
		t.Run(state, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				fmt.Fprintf(writer, `{"status":%q,"should_poll":true,"vendor_inquiry_url":"https://inquiry.withpersona.com/verify","vendor_inquiry_id":"fixture"}`, state)
			}))
			defer server.Close()
			client, err := newClient("fixture-session", "", "org", server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			status, err := client.Status(context.Background(), Options{})
			if err != nil || status.Status != state || status.ShouldPoll || status.VendorInquiryURL != "" || status.VendorInquiryID != "" {
				t.Fatal("terminal status was not normalized", err)
			}
		})
	}
}

func TestInvalidResponsesAreRejected(t *testing.T) {
	for _, body := range []string{
		`null`, `{}`, `{"status":""}`, `{"status":"pending","should_poll":"true"}`,
		`{"status":"pending","vendor_inquiry_url":"javascript:alert(1)"}`,
		`{"status":"pending","vendor_inquiry_url":"http://inquiry.withpersona.com/verify"}`,
		`{"status":"pending","vendor_inquiry_url":"https://user@inquiry.withpersona.com/verify"}`,
		`<html>error</html>`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				fmt.Fprint(writer, body)
			}))
			defer server.Close()
			client, err := newClient("fixture-session", "", "org", server.URL)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			if _, err := client.Status(context.Background(), Options{}); !errors.Is(err, ErrInvalidResponse) {
				t.Fatal("invalid response accepted", err)
			}
		})
	}
}

func TestHTTPFailuresRemainErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("cf-mitigated", "challenge")
		http.Error(writer, "blocked", http.StatusForbidden)
	}))
	defer server.Close()
	client, err := newClient("fixture-session", "", "org", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.Status(context.Background(), Options{})
	var upstream *HTTPError
	if !errors.As(err, &upstream) || !upstream.Challenge || upstream.Status != http.StatusForbidden {
		t.Fatal("HTTP failure or browser challenge was converted into a status", err)
	}
}

func TestOrganizationsUsesSessionOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		cookie, err := request.Cookie("sessionKey")
		if err != nil || cookie.Value != "fixture-session" {
			t.Error("session cookie missing")
		}
		fmt.Fprint(writer, `[{"uuid":"one","name":"Personal"},{"uuid":"two","name":"Team"},{"uuid":"one","name":"Duplicate"}]`)
	}))
	defer server.Close()
	client, err := newClient("fixture-session", "", "", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	organizations, err := client.Organizations(context.Background())
	if err != nil || len(organizations) != 2 || organizations[0].ID != "one" || organizations[1].Name != "Team" {
		t.Fatal("organization discovery failed", err)
	}
	if _, err := client.Status(context.Background(), Options{}); err == nil {
		t.Fatal("status accepted an empty organization")
	}
}

func TestAuthenticatedHTTPProxy(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Proxy-Authorization") != "" {
			t.Error("proxy credentials leaked to target")
		}
		fmt.Fprint(writer, `[{"uuid":"org","name":"Personal"}]`)
	}))
	defer target.Close()

	username := "fixture-user"
	secret := "fixture" + "-secret"
	expectedAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+secret))
	proxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodConnect || request.Header.Get("Proxy-Authorization") != expectedAuth {
			http.Error(writer, "proxy authentication missing", http.StatusForbidden)
			return
		}
		upstream, err := net.Dial("tcp", request.Host)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusBadGateway)
			return
		}
		defer upstream.Close()
		conn, buffer, err := writer.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		fmt.Fprint(buffer, "HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buffer.Flush()
		go func() {
			_, _ = io.Copy(upstream, buffer)
			_ = upstream.Close()
		}()
		_, _ = io.Copy(conn, upstream)
	}))
	defer proxyServer.Close()

	proxyURL, _ := url.Parse(proxyServer.URL)
	proxyURL.User = url.UserPassword(username, secret)
	client, err := newClient("fixture-session", proxyURL.String(), "", target.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	organizations, err := client.Organizations(context.Background())
	if err != nil || len(organizations) != 1 || organizations[0].ID != "org" {
		t.Fatal("authenticated proxy request failed", err)
	}
}

func TestInvalidSessionOrOrganization(t *testing.T) {
	if _, err := New("", "", "org"); err == nil {
		t.Fatal("empty session key accepted")
	}
	client, err := New("fixture-session", "", "org")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.Status(context.Background(), Options{AttemptRetry: true}); err == nil {
		t.Fatal("retry without refresh accepted")
	}
}

func TestOrganizationValidation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		fmt.Fprint(writer, `[{"uuid":"has spaces","name":"bad"}]`)
	}))
	defer server.Close()
	client, err := newClient("fixture-session", "", "", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if _, err := client.Organizations(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatal("invalid organization ID accepted")
	}
}

func TestRedirectsAreNotFollowed(t *testing.T) {
	destination := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		t.Error("redirect target was reached")
	}))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, destination.URL, http.StatusFound)
	}))
	defer redirect.Close()
	client, err := newClient("fixture-session", "", "", redirect.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.Organizations(context.Background())
	var upstream *HTTPError
	if !errors.As(err, &upstream) || upstream.Status != http.StatusFound {
		t.Fatal("redirect was followed", err)
	}
}
