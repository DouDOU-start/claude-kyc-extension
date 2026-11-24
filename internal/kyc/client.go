package kyc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"

	"github.com/enetx/g"
	"github.com/enetx/surf"

	"github.com/DouDOU-start/claude-kyc-extension/internal/proxy"
)

const Origin = "https://claude.ai"

var ErrInvalidResponse = errors.New("Claude KYC 响应无效")

type Organization struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Options struct {
	RefreshSession bool `json:"refreshSession"`
	AttemptRetry   bool `json:"attemptRetry"`
}

type Status struct {
	Status           string `json:"status"`
	VendorInquiryURL string `json:"vendor_inquiry_url,omitempty"`
	VendorInquiryID  string `json:"vendor_inquiry_id,omitempty"`
	ShouldPoll       bool   `json:"should_poll"`
	UpdatedAt        string `json:"updated_at,omitempty"`
	CompletedAt      string `json:"completed_at,omitempty"`
}

func (status Status) Complete() bool {
	return status.Status == "verified" || status.Status == "not_required"
}

func (status Status) Failed() bool {
	return status.Status == "denied" || status.Status == "failed" || status.Status == "expired"
}

type HTTPError struct {
	Status    int
	Challenge bool
}

func (err *HTTPError) Error() string {
	return fmt.Sprintf("Claude HTTP %d", err.Status)
}

type Client struct {
	http   *http.Client
	origin string
	orgID  string
}

// New creates a client authenticated by a Claude web session key.
func New(sessionKey, proxyURL, orgID string) (*Client, error) {
	return newClient(sessionKey, proxyURL, orgID, Origin)
}

func newClient(sessionKey, proxyURL, orgID, origin string) (*Client, error) {
	key := strings.TrimSpace(sessionKey)
	if key == "" {
		return nil, errors.New("缺少 sessionKey")
	}
	upstream := proxy.Normalize(proxyURL)
	if err := proxy.Validate(upstream); err != nil {
		return nil, err
	}
	parsedOrigin, err := url.Parse(origin)
	if err != nil {
		return nil, errors.New("Claude 地址无效")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	jar.SetCookies(parsedOrigin, []*http.Cookie{{Name: "sessionKey", Value: key, Path: "/"}})

	builder := surf.NewClient().Builder().Impersonate().Chrome().Session()
	if upstream != "" {
		builder = builder.Proxy(g.String(upstream))
	}
	built := builder.Build()
	if built.IsErr() {
		return nil, built.Err()
	}
	httpClient := built.Ok().Std()
	httpClient.Timeout = 0
	httpClient.Jar = jar
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Client{http: httpClient, origin: origin, orgID: orgID}, nil
}

func (client *Client) Close() {
	client.http.CloseIdleConnections()
}

// Organizations returns the organizations visible to the session.
func (client *Client) Organizations(ctx context.Context) ([]Organization, error) {
	body, err := client.get(ctx, client.origin+"/api/organizations")
	if err != nil {
		return nil, err
	}
	var payload []struct {
		ID   string `json:"uuid"`
		Name string `json:"name"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return nil, ErrInvalidResponse
	}
	organizations := make([]Organization, 0, len(payload))
	seen := map[string]bool{}
	for _, item := range payload {
		if item.ID == "" || len(item.ID) > 128 || strings.ContainsAny(item.ID, " \t\r\n") {
			return nil, ErrInvalidResponse
		}
		if seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		organizations = append(organizations, Organization{ID: item.ID, Name: item.Name})
	}
	return organizations, nil
}

// Status queries one organization's KYC state.
func (client *Client) Status(ctx context.Context, options Options) (Status, error) {
	if client.orgID == "" || (options.AttemptRetry && !options.RefreshSession) {
		return Status{}, errors.New("KYC 查询参数无效")
	}
	endpoint := client.origin + "/api/organizations/" + url.PathEscape(client.orgID) + "/kyc_status"
	query := url.Values{}
	if options.RefreshSession {
		query.Set("refresh_session", "true")
	}
	if options.AttemptRetry {
		query.Set("attempt_retry", "true")
	}
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	body, err := client.get(ctx, endpoint)
	if err != nil {
		return Status{}, err
	}
	var status Status
	if json.Unmarshal(body, &status) != nil || status.Status == "" ||
		len(status.Status) > 64 || strings.ContainsAny(status.Status, " \t\r\n") {
		return Status{}, ErrInvalidResponse
	}
	if status.Complete() || status.Failed() {
		status.ShouldPoll = false
		status.VendorInquiryURL = ""
		status.VendorInquiryID = ""
	}
	if status.VendorInquiryURL != "" {
		inquiryURL, err := url.Parse(status.VendorInquiryURL)
		if err != nil || inquiryURL.Scheme != "https" || inquiryURL.Host == "" ||
			inquiryURL.User != nil || len(status.VendorInquiryURL) > 16384 {
			return Status{}, ErrInvalidResponse
		}
	}
	return status, nil
}

func (client *Client) get(ctx context.Context, endpoint string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("accept", "application/json, text/event-stream")
	request.Header.Set("anthropic-client-platform", "web_claude_ai")
	response, err := client.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &HTTPError{
			Status:    response.StatusCode,
			Challenge: strings.EqualFold(response.Header.Get("cf-mitigated"), "challenge"),
		}
	}
	return io.ReadAll(io.LimitReader(response.Body, 2<<20))
}
