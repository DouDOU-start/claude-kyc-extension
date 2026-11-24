package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	for _, test := range []struct {
		left, right string
		want        int
	}{
		{"1.0.0", "1.0.0", 0},
		{"v1.0.1", "1.0.0", 1},
		{"1.2.0", "1.10.0", -1},
		{"2.0.0", "1.99.99", 1},
	} {
		if got := CompareVersions(test.left, test.right); got != test.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
}

func TestLatestReleaseUsesDigest(t *testing.T) {
	archive := []byte("fixture archive")
	sum := sha256.Sum256(archive)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/repos/example/project/releases/latest" {
			http.NotFound(writer, request)
			return
		}
		fmt.Fprintf(writer, `{
			"tag_name":"v1.2.3",
			"html_url":"https://github.com/example/project/releases/tag/v1.2.3",
			"body":"notes",
			"published_at":"2026-11-20T10:00:00Z",
			"assets":[{
				"name":"claude-kyc-extension-v1.2.3.zip",
				"browser_download_url":"https://github.com/example/project/releases/download/v1.2.3/claude-kyc-extension-v1.2.3.zip",
				"size":%d,
				"digest":"sha256:%s"
			}]
		}`, len(archive), hex.EncodeToString(sum[:]))
	}))
	defer server.Close()
	checker := NewChecker("example/project", "test-agent")
	checker.APIBase = server.URL
	release, err := checker.Latest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if release.Version != "1.2.3" || release.SHA256 != hex.EncodeToString(sum[:]) || release.AssetName == "" {
		t.Fatal("release metadata was not parsed")
	}
}

func TestExtractRejectsTraversal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	entry, _ := archive.Create("../escape.txt")
	_, _ = entry.Write([]byte("bad"))
	_ = archive.Close()
	_ = file.Close()
	if err := extract(path, t.TempDir()); err == nil {
		t.Fatal("zip traversal was accepted")
	}
}

func TestPrepareValidatesReleasePackage(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	rootFolder := "Claude" + "KYC"
	files := []struct {
		name string
		body string
	}{
		{rootFolder + "/extension/manifest.json", `{"version":"1.0.1"}`},
		{rootFolder + "/kyc-host.exe", "host"},
		{rootFolder + "/kyc-updater.exe", "updater"},
	}
	for _, file := range files {
		entry, _ := zipWriter.Create(file.name)
		_, _ = entry.Write([]byte(file.body))
	}
	_ = zipWriter.Close()
	sum := sha256.Sum256(archive.Bytes())

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/repos/example/project/releases/latest":
			fmt.Fprintf(writer, `{
				"tag_name":"v1.0.1",
				"html_url":"https://github.com/example/project/releases/tag/v1.0.1",
				"published_at":"2026-11-20T10:00:00Z",
				"assets":[{
					"name":"claude-kyc-extension-v1.0.1.zip",
					"browser_download_url":"https://github.com/example/project/releases/download/v1.0.1/claude-kyc-extension-v1.0.1.zip",
					"size":%d,
					"digest":"sha256:%s"
				}]
			}`, archive.Len(), hex.EncodeToString(sum[:]))
		case strings.Contains(request.URL.Path, "/releases/download/"):
			_, _ = writer.Write(archive.Bytes())
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	checker := NewChecker("example/project", "test-agent")
	checker.APIBase = server.URL
	target, _ := url.Parse(server.URL)
	checker.Client = &http.Client{Transport: &rewriteTransport{target: target, base: http.DefaultTransport}}
	prepared, err := Prepare(context.Background(), checker, t.TempDir(), "1.0.1")
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Version != "1.0.1" || prepared.ExtensionDir == "" {
		t.Fatal("prepared update is invalid")
	}
}

func TestApplyExtensionPreservesInstallationMarker(t *testing.T) {
	source := t.TempDir()
	destination := t.TempDir()
	if err := os.MkdirAll(filepath.Join(source, "lib"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "app.js"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "lib", "kyc.js"), []byte("lib"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "installation.json"), []byte("source-marker"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(destination, "installation.json"), []byte("installed-marker"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ApplyExtension(Prepared{ExtensionDir: source}, destination); err != nil {
		t.Fatal(err)
	}
	marker, _ := os.ReadFile(filepath.Join(destination, "installation.json"))
	app, _ := os.ReadFile(filepath.Join(destination, "app.js"))
	library, _ := os.ReadFile(filepath.Join(destination, "lib", "kyc.js"))
	if string(marker) != "installed-marker" || string(app) != "new" || string(library) != "lib" {
		t.Fatal("extension update copy failed")
	}
}

type rewriteTransport struct {
	target *url.URL
	base   http.RoundTripper
}

func (transport *rewriteTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.URL.Hostname() == "github.com" {
		clone := request.Clone(request.Context())
		clone.URL.Scheme = transport.target.Scheme
		clone.URL.Host = transport.target.Host
		return transport.base.RoundTrip(clone)
	}
	return transport.base.RoundTrip(request)
}
