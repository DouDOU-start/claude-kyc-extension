package proxy

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	xproxy "golang.org/x/net/proxy"
)

// Regions is used when a proxy template contains {region}.
var Regions = []string{
	"US", "GB", "DE", "FR", "NL", "IE", "SE", "CH",
	"JP", "KR", "SG", "AU", "NZ", "CA",
	"IT", "ES", "PT", "AT", "BE", "DK", "NO", "FI", "PL",
}

// Normalize accepts a proxy URL, host:port, or the common
// host:port:username:credential vendor format.
func Normalize(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.Contains(raw, "://") {
		return raw
	}
	parts := strings.Split(raw, ":")
	if len(parts) == 4 && !strings.Contains(parts[0]+parts[1], "@") {
		return "http://" + url.UserPassword(parts[2], parts[3]).String() + "@" + net.JoinHostPort(parts[0], parts[1])
	}
	if strings.Contains(raw, "@") || len(parts) == 2 {
		return "http://" + raw
	}
	return raw
}

// ResolveTemplate replaces rotating proxy placeholders.
func ResolveTemplate(template string) string {
	if !strings.Contains(template, "{") {
		return template
	}
	random := make([]byte, 1)
	_, _ = rand.Read(random)
	region := Regions[int(random[0])%len(Regions)]
	result := strings.ReplaceAll(template, "{region}", region)
	return strings.ReplaceAll(result, "{session}", randomSession())
}

func randomSession() string {
	random := make([]byte, 4)
	_, _ = rand.Read(random)
	return hex.EncodeToString(random)
}

// Validate reports whether a normalized proxy can be used by NewDialer.
func Validate(raw string) error {
	_, err := NewDialer(raw)
	return err
}

// NewDialer returns a context-aware dial function for HTTP, HTTPS, SOCKS5,
// or SOCKS5H proxies. An empty value connects directly.
func NewDialer(raw string) (func(context.Context, string, string) (net.Conn, error), error) {
	direct := &net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}
	if raw == "" {
		return direct.DialContext, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil, errors.New("代理地址无效")
	}
	switch u.Scheme {
	case "socks5", "socks5h":
		var auth *xproxy.Auth
		if u.User != nil {
			secret, _ := u.User.Password()
			auth = &xproxy.Auth{User: u.User.Username(), Password: secret}
		}
		address := u.Host
		if u.Port() == "" {
			address = net.JoinHostPort(u.Hostname(), "1080")
		}
		dialer, err := xproxy.SOCKS5("tcp", address, auth, direct)
		if err != nil {
			return nil, err
		}
		contextDialer, ok := dialer.(xproxy.ContextDialer)
		if !ok {
			return nil, errors.New("代理不支持可取消连接")
		}
		return contextDialer.DialContext, nil
	case "http", "https":
		return func(ctx context.Context, network, address string) (net.Conn, error) {
			return connectHTTP(ctx, direct, u, address)
		}, nil
	default:
		return nil, errors.New("代理仅支持 http、https、socks5、socks5h")
	}
}

func connectHTTP(ctx context.Context, direct *net.Dialer, proxyURL *url.URL, target string) (conn net.Conn, err error) {
	address := proxyURL.Host
	if proxyURL.Port() == "" {
		port := "80"
		if proxyURL.Scheme == "https" {
			port = "443"
		}
		address = net.JoinHostPort(proxyURL.Hostname(), port)
	}
	conn, err = direct.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, errors.New("代理连接失败")
	}
	base := conn
	stop := context.AfterFunc(ctx, func() { _ = base.Close() })
	defer stop()
	defer func() {
		if err != nil {
			_ = base.Close()
		}
	}()

	deadline := time.Now().Add(20 * time.Second)
	if end, ok := ctx.Deadline(); ok && end.Before(deadline) {
		deadline = end
	}
	_ = conn.SetDeadline(deadline)
	if proxyURL.Scheme == "https" {
		secure := tls.Client(conn, &tls.Config{ServerName: proxyURL.Hostname(), MinVersion: tls.VersionTLS12})
		if err = secure.HandshakeContext(ctx); err != nil {
			return nil, errors.New("代理 TLS 握手失败")
		}
		conn = secure
	}
	if strings.ContainsAny(target, "\r\n") {
		return nil, errors.New("目标地址无效")
	}
	headers := ""
	if proxyURL.User != nil {
		secret, _ := proxyURL.User.Password()
		headers = "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString(
			[]byte(proxyURL.User.Username()+":"+secret),
		) + "\r\n"
	}
	if _, err = fmt.Fprintf(conn, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n%s\r\n", target, target, headers); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		return nil, errors.New("代理握手响应无效")
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		return nil, fmt.Errorf("代理拒绝隧道: HTTP %d", response.StatusCode)
	}
	_ = conn.SetDeadline(time.Time{})
	return &bufferedConn{Conn: conn, reader: reader}, nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(buffer []byte) (int, error) {
	return c.reader.Read(buffer)
}

func (c *bufferedConn) CloseWrite() error {
	if conn, ok := c.Conn.(interface{ CloseWrite() error }); ok {
		return conn.CloseWrite()
	}
	return c.Conn.Close()
}
