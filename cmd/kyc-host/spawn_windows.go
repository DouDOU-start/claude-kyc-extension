//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func startUpdater(executable string, arguments []string) error {
	command := exec.Command(executable, arguments...)
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x00000008 | 0x00000200,
	}
	return command.Start()
}
