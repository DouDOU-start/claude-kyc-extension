//go:build !windows

package main

func processAlive(int) bool {
	return false
}
