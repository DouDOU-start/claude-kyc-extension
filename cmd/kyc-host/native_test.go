package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/DouDOU-start/claude-kyc-extension/internal/kyc"
)

func TestMessageCodec(t *testing.T) {
	var stream bytes.Buffer
	if err := writeMessage(&stream, map[string]string{"method": "query"}); err != nil {
		t.Fatal(err)
	}
	raw := stream.Bytes()
	if size := binary.LittleEndian.Uint32(raw[:4]); int(size) != len(raw)-4 {
		t.Fatal("incorrect native message length")
	}
	body, err := readMessage(&stream)
	if err != nil || string(body) != `{"method":"query"}` {
		t.Fatal("native message round trip failed", err)
	}
	if _, err := readMessage(&stream); !errors.Is(err, io.EOF) {
		t.Fatal("empty native message stream did not end", err)
	}
}

func TestServeRejectsInvalidInputWithoutQuery(t *testing.T) {
	called := false
	worker := service{
		organizations: func(context.Context, string, string) ([]kyc.Organization, error) {
			called = true
			return nil, nil
		},
	}
	var input bytes.Buffer
	payload, _ := json.Marshal(request{ID: "1", Method: "organizations", SessionKey: "bad\nkey"})
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	input.Write(header[:])
	input.Write(payload)

	var output bytes.Buffer
	if err := serve(&input, &output, worker); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("invalid request reached the query function")
	}
	var reply response
	if err := json.Unmarshal(output.Bytes()[4:], &reply); err != nil || reply.OK || reply.Error == nil || reply.Error.Code != "invalid_session" {
		t.Fatal("invalid request was not rejected", err)
	}
}
