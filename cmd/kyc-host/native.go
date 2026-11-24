package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

const (
	maxRequestSize = 64 << 10
	maxReplySize   = 1 << 20
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type response struct {
	ID    string    `json:"id,omitempty"`
	OK    bool      `json:"ok"`
	Data  any       `json:"data,omitempty"`
	Error *apiError `json:"error,omitempty"`
}

func failed(id string, problem *apiError) response {
	return response{ID: id, Error: problem}
}

func readMessage(reader io.Reader) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		if errors.Is(err, io.EOF) {
			return nil, io.EOF
		}
		return nil, err
	}
	size := binary.LittleEndian.Uint32(header[:])
	if size == 0 || size > maxRequestSize {
		return nil, errors.New("native message size is invalid")
	}
	body := make([]byte, size)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}

func writeMessage(writer io.Writer, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(body) == 0 || len(body) > maxReplySize {
		return errors.New("native reply size is invalid")
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(body)))
	if err := writeAll(writer, header[:]); err != nil {
		return err
	}
	return writeAll(writer, body)
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return err
		}
		if written <= 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}

func serve(reader io.Reader, writer io.Writer, worker service) error {
	for {
		body, err := readMessage(reader)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		var req request
		if err := json.Unmarshal(body, &req); err != nil {
			if err := writeMessage(writer, failed("", &apiError{Code: "invalid_json", Message: "查询请求格式无效。"})); err != nil {
				return err
			}
			continue
		}
		if err := writeMessage(writer, worker.execute(req)); err != nil {
			return err
		}
	}
}
