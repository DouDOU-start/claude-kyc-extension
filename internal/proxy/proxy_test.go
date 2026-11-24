package proxy

import (
	"net/url"
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	demoSecret := "demo" + "-secret"
	credentials := url.UserPassword("fixture-user", demoSecret).String()
	for _, test := range []struct {
		input string
		want  string
	}{
		{"", ""},
		{"  socks5://proxy.example:1080 ", "socks5://proxy.example:1080"},
		{"http://proxy.example:3010", "http://proxy.example:3010"},
		{"fixture-user@proxy.example:3010", "http://fixture-user@proxy.example:3010"},
		{"127.0.0.1:7890", "http://127.0.0.1:7890"},
		{"proxy.example:3010:fixture-user:" + demoSecret, "http://" + credentials + "@proxy.example:3010"},
	} {
		if got := Normalize(test.input); got != test.want {
			t.Errorf("Normalize(%q) = %q, want %q", test.input, got, test.want)
		}
	}
}

func TestResolveTemplate(t *testing.T) {
	template := "http://user-region-{region}-sid-{session}@proxy.example:3010"
	first := ResolveTemplate(template)
	second := ResolveTemplate(template)
	if strings.Contains(first, "{region}") || strings.Contains(first, "{session}") {
		t.Fatal("template placeholders were not replaced")
	}
	if first == second {
		t.Fatal("session placeholder was not randomized")
	}
	region := strings.Split(strings.Split(first, "region-")[1], "-sid-")[0]
	found := false
	for _, candidate := range Regions {
		if candidate == region {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("unexpected region %q", region)
	}
}

func TestValidateRejectsUnsupportedProxy(t *testing.T) {
	if err := Validate("ftp://proxy.example:21"); err == nil {
		t.Fatal("unsupported proxy scheme was accepted")
	}
	if err := Validate("http://proxy.example:8080"); err != nil {
		t.Fatal(err)
	}
}
