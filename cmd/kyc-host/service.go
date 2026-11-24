package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/DouDOU-start/claude-kyc-extension/internal/kyc"
	"github.com/DouDOU-start/claude-kyc-extension/internal/proxy"
)

type request struct {
	ID             string `json:"id"`
	Method         string `json:"method"`
	SessionKey     string `json:"sessionKey"`
	Proxy          string `json:"proxy"`
	OrgID          string `json:"orgId"`
	RefreshSession bool   `json:"refreshSession"`
	AttemptRetry   bool   `json:"attemptRetry"`
	Version        string `json:"version"`
}

type organizationsData struct {
	Organizations []kyc.Organization `json:"organizations"`
}

type queryData struct {
	kyc.Status
	CheckedAt string `json:"checkedAt"`
}

type service struct {
	version       string
	repository    string
	executable    func() (string, error)
	organizations func(context.Context, string, string) ([]kyc.Organization, error)
	query         func(context.Context, string, string, string, kyc.Options) (kyc.Status, error)
}

func newService(version, repository string) service {
	return service{
		version:       version,
		repository:    repository,
		executable:    os.Executable,
		organizations: discoverOrganizations,
		query:         queryKYC,
	}
}

func (worker service) execute(req request) response {
	if problem := validateRequest(req); problem != nil {
		return failed(req.ID, problem)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeoutFor(req.Method))
	defer cancel()

	switch req.Method {
	case "organizations":
		organizations, err := worker.organizations(ctx, req.SessionKey, req.Proxy)
		if err != nil {
			problem := describeError(err, true)
			return failed(req.ID, &problem)
		}
		if len(organizations) == 0 {
			return failed(req.ID, &apiError{Code: "no_organizations", Message: "此 SK 没有可访问的 Claude 组织。"})
		}
		return response{ID: req.ID, OK: true, Data: organizationsData{Organizations: organizations}}
	case "query":
		status, err := worker.query(ctx, req.SessionKey, req.Proxy, req.OrgID, kyc.Options{
			RefreshSession: req.RefreshSession,
			AttemptRetry:   req.AttemptRetry,
		})
		if err != nil {
			problem := describeError(err, false)
			return failed(req.ID, &problem)
		}
		return response{
			ID: req.ID,
			OK: true,
			Data: queryData{
				Status:    status,
				CheckedAt: time.Now().UTC().Format(time.RFC3339),
			},
		}
	case "status":
		return response{ID: req.ID, OK: true, Data: worker.status()}
	case "checkUpdate":
		data, problem := worker.checkUpdate(ctx)
		if problem != nil {
			return failed(req.ID, problem)
		}
		return response{ID: req.ID, OK: true, Data: data}
	case "prepareUpdate":
		data, problem := worker.prepareUpdate(ctx, req.Version)
		if problem != nil {
			return failed(req.ID, problem)
		}
		return response{ID: req.ID, OK: true, Data: data}
	case "applyUpdate":
		data, problem := worker.applyUpdate(req.Version)
		if problem != nil {
			return failed(req.ID, problem)
		}
		return response{ID: req.ID, OK: true, Data: data}
	default:
		return failed(req.ID, &apiError{Code: "unsupported_method", Message: "不支持的查询操作。"})
	}
}

func validateRequest(req request) *apiError {
	if req.ID == "" || len(req.ID) > 128 || strings.IndexFunc(req.ID, func(r rune) bool {
		return r < 0x21 || r > 0x7e
	}) >= 0 {
		return &apiError{Code: "invalid_request", Message: "查询请求无效。"}
	}
	switch req.Method {
	case "organizations", "query":
		if req.SessionKey == "" || len(req.SessionKey) > 16384 || strings.IndexFunc(req.SessionKey, func(r rune) bool {
			return r < 0x21 || r > 0x7e || r == ';' || r == '"' || r == '\\'
		}) >= 0 {
			return &apiError{Code: "invalid_session", Message: "请填写有效的 Claude 网页 SK。"}
		}
		if len(req.Proxy) > 8192 || strings.ContainsAny(req.Proxy, "\r\n") {
			return &apiError{Code: "invalid_proxy", Message: "代理地址无效。"}
		}
	case "status", "checkUpdate", "prepareUpdate", "applyUpdate":
	default:
		return &apiError{Code: "unsupported_method", Message: "不支持的查询操作。"}
	}
	if req.Method == "query" {
		if req.OrgID == "" || len(req.OrgID) > 128 || strings.ContainsAny(req.OrgID, " \t\r\n") {
			return &apiError{Code: "invalid_organization", Message: "请选择或填写 Claude 组织 ID。"}
		}
		if req.AttemptRetry && !req.RefreshSession {
			return &apiError{Code: "invalid_request", Message: "重新验证必须先刷新验证会话。"}
		}
	}
	if (req.Method == "prepareUpdate" || req.Method == "applyUpdate") && req.Version == "" {
		return &apiError{Code: "invalid_request", Message: "更新版本无效。"}
	}
	return nil
}

func timeoutFor(method string) time.Duration {
	if method == "prepareUpdate" {
		return 5 * time.Minute
	}
	if method == "checkUpdate" || method == "status" {
		return 30 * time.Second
	}
	if method == "applyUpdate" {
		return 60 * time.Second
	}
	return 45 * time.Second
}

func discoverOrganizations(ctx context.Context, sessionKey, proxyURL string) ([]kyc.Organization, error) {
	client, err := kyc.New(sessionKey, proxy.ResolveTemplate(proxyURL), "")
	if err != nil {
		return nil, err
	}
	defer client.Close()
	return client.Organizations(ctx)
}

func queryKYC(ctx context.Context, sessionKey, proxyURL, orgID string, options kyc.Options) (kyc.Status, error) {
	client, err := kyc.New(sessionKey, proxy.ResolveTemplate(proxyURL), orgID)
	if err != nil {
		return kyc.Status{}, err
	}
	defer client.Close()
	return client.Status(ctx, options)
}

func describeError(err error, organizations bool) apiError {
	var upstream *kyc.HTTPError
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return apiError{Code: "timeout", Message: "查询超时，请检查代理后重试。"}
	case errors.Is(err, kyc.ErrInvalidResponse):
		return apiError{Code: "invalid_response", Message: "Claude 未返回有效的 KYC 状态，暂时无法判断认证结果。"}
	case errors.As(err, &upstream):
		switch {
		case upstream.Challenge:
			return apiError{Code: "challenge", Message: "Claude 要求浏览器验证，暂时无法查询 KYC。"}
		case upstream.Status == http.StatusUnauthorized || upstream.Status == http.StatusForbidden:
			if organizations {
				return apiError{Code: "auth", Message: "Claude 拒绝了这个 SK，请检查它是否有效或已过期。"}
			}
			return apiError{Code: "auth", Message: "Claude 拒绝了 KYC 查询，请检查 SK 和访问权限。"}
		case upstream.Status == http.StatusNotFound:
			if organizations {
				return apiError{Code: "no_organizations", Message: "此 SK 没有可访问的 Claude 组织。"}
			}
			return apiError{Code: "not_found", Message: "Claude 未提供此组织的 KYC 状态（HTTP 404）。"}
		case upstream.Status == http.StatusTooManyRequests:
			return apiError{Code: "rate_limited", Message: "查询过于频繁，请稍后重试。"}
		default:
			return apiError{Code: "upstream", Message: fmt.Sprintf("Claude 返回 HTTP %d，暂时无法查询。", upstream.Status)}
		}
	}
	message := err.Error()
	for _, safe := range []string{
		"代理地址无效", "代理仅支持 http、https、socks5、socks5h",
		"代理连接失败", "代理 TLS 握手失败", "代理握手响应无效", "代理拒绝隧道",
	} {
		if strings.Contains(message, safe) {
			return apiError{Code: "proxy", Message: message}
		}
	}
	if organizations {
		return apiError{Code: "organizations_failed", Message: "读取 Claude 组织失败，请检查 SK、代理和网络。"}
	}
	return apiError{Code: "query_failed", Message: "KYC 查询失败，请检查 SK、代理和网络。"}
}
