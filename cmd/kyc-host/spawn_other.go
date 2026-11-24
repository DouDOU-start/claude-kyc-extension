//go:build !windows

package main

import "errors"

func startUpdater(string, []string) error {
	return errors.New("自动更新仅支持 Windows")
}
