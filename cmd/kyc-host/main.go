package main

import (
	"fmt"
	"os"
)

var (
	version    = "dev"
	repository = "DouDOU-start/claude-kyc-extension"
)

func main() {
	worker := newService(version, repository)
	if err := serve(os.Stdin, os.Stdout, worker); err != nil {
		fmt.Fprintln(os.Stderr, "Claude KYC host:", err)
		os.Exit(1)
	}
}
