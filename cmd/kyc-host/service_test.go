package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DouDOU-start/claude-kyc-extension/internal/kyc"
)

func TestServiceReturnsOrganizationsAndStatus(t *testing.T) {
	worker := service{
		version: "1.0.0",
		organizations: func(context.Context, string, string) ([]kyc.Organization, error) {
			return []kyc.Organization{{ID: "org", Name: "Personal"}}, nil
		},
		query: func(_ context.Context, key, rawProxy, org string, options kyc.Options) (kyc.Status, error) {
			if key != "session" || rawProxy != "http://127.0.0.1:8080" || org != "org" ||
				!options.RefreshSession || options.AttemptRetry {
				t.Fatal("service did not forward query fields")
			}
			return kyc.Status{Status: "pending", VendorInquiryURL: "https://inquiry.withpersona.com/verify"}, nil
		},
	}
	orgReply := worker.execute(request{ID: "a", Method: "organizations", SessionKey: "session", Proxy: "http://127.0.0.1:8080"})
	if !orgReply.OK || orgReply.Error != nil {
		t.Fatal("organization request failed", orgReply.Error)
	}
	queryReply := worker.execute(request{
		ID: "b", Method: "query", SessionKey: "session", Proxy: "http://127.0.0.1:8080",
		OrgID: "org", RefreshSession: true,
	})
	if !queryReply.OK || queryReply.Error != nil {
		t.Fatal("KYC request failed", queryReply.Error)
	}
	data, ok := queryReply.Data.(queryData)
	if !ok || data.Status.Status != "pending" || data.CheckedAt == "" {
		t.Fatal("KYC result was not returned")
	}
}

func TestServiceDoesNotEchoSecretsOnFailure(t *testing.T) {
	worker := service{
		query: func(context.Context, string, string, string, kyc.Options) (kyc.Status, error) {
			return kyc.Status{}, errors.New("secret-session secret-inquiry")
		},
	}
	reply := worker.execute(request{
		ID: "1", Method: "query", SessionKey: "secret-session",
		Proxy: "http://127.0.0.1:8080", OrgID: "org",
	})
	encoded, _ := json.Marshal(reply)
	if reply.Error == nil || strings.Contains(string(encoded), "secret-session") || strings.Contains(string(encoded), "secret-inquiry") {
		t.Fatal("failure leaked credentials")
	}
}

func TestStatusReadsInstallationMarker(t *testing.T) {
	root := t.TempDir()
	extensionDir := filepath.Join(root, "extension")
	if err := os.MkdirAll(extensionDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extensionDir, "manifest.json"), []byte(`{"version":"1.2.3"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extensionDir, "installation.json"), []byte(`{"managed":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	worker := service{
		version:    "1.2.3",
		repository: "example/project",
		executable: func() (string, error) {
			return filepath.Join(root, "kyc-host.exe"), nil
		},
	}
	status := worker.status()
	if status.ExtensionVersion != "1.2.3" || !status.Managed || status.Repository != "example/project" {
		t.Fatal("installation status was not read", status)
	}
}

func TestUnmanagedExtensionCannotUpdate(t *testing.T) {
	root := t.TempDir()
	worker := service{
		repository: "example/project",
		executable: func() (string, error) {
			return filepath.Join(root, "kyc-host.exe"), nil
		},
	}
	info, problem := worker.checkUpdate(context.Background())
	if problem != nil || info.Managed || info.Reason == "" {
		t.Fatal("unmanaged extension update check should be disabled", problem)
	}
	if _, problem := worker.applyUpdate("1.0.1"); problem == nil || problem.Code != "update_unavailable" {
		t.Fatal("unmanaged extension was allowed to update")
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("  hello  ", 10); got != "hello" {
		t.Fatal(got)
	}
	if got := truncateRunes("abcdef", 3); got != "abc…" {
		t.Fatal(got)
	}
}
