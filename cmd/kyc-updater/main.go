package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/DouDOU-start/claude-kyc-extension/internal/update"
)

func main() {
	installDir := flag.String("install-dir", "", "installed application directory")
	hostPath := flag.String("host", "", "staged kyc-host.exe")
	updaterPath := flag.String("updater", "", "staged kyc-updater.exe")
	version := flag.String("version", "", "version being installed")
	parentPID := flag.Int("parent-pid", 0, "parent native host process")
	logPath := flag.String("log", "", "update log path")
	flag.Parse()

	logger, err := newLogger(*logPath)
	if err != nil {
		os.Exit(1)
	}
	defer logger.Close()
	if *installDir == "" || *hostPath == "" || *updaterPath == "" || *version == "" {
		logger.printf("invalid updater arguments")
		os.Exit(2)
	}
	if *parentPID > 0 {
		deadline := time.Now().Add(30 * time.Second)
		for processAlive(*parentPID) && time.Now().Before(deadline) {
			time.Sleep(250 * time.Millisecond)
		}
	}
	if err := replaceFile(*hostPath, filepath.Join(*installDir, "kyc-host.exe")); err != nil {
		logger.printf("host update failed: %v", err)
		os.Exit(3)
	}
	if err := replaceFile(*updaterPath, filepath.Join(*installDir, "kyc-updater.exe")); err != nil {
		logger.printf("updater update failed: %v", err)
		os.Exit(4)
	}
	versionFile := []byte(fmt.Sprintf("{\"version\":%q,\"updatedAt\":%q}\n", *version, time.Now().UTC().Format(time.RFC3339)))
	if err := os.WriteFile(filepath.Join(*installDir, "version.json"), versionFile, 0600); err != nil {
		logger.printf("version marker failed: %v", err)
	}
	update.CleanupUpdates(filepath.Join(*installDir, "updates"), *version)
	logger.printf("updated to %s", *version)
}

func replaceFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	temp := destination + ".update-" + strconv.Itoa(os.Getpid())
	output, err := os.OpenFile(temp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0700)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		_ = os.Remove(temp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(temp)
		return closeErr
	}
	var last error
	for attempt := 0; attempt < 40; attempt++ {
		if err := os.Remove(destination); err != nil && !os.IsNotExist(err) {
			last = err
			time.Sleep(250 * time.Millisecond)
			continue
		}
		if err := os.Rename(temp, destination); err == nil {
			return nil
		} else {
			last = err
		}
		time.Sleep(250 * time.Millisecond)
	}
	_ = os.Remove(temp)
	return last
}

type logger struct {
	file *os.File
}

func newLogger(path string) (*logger, error) {
	if path == "" {
		return &logger{}, nil
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	return &logger{file: file}, nil
}

func (log *logger) printf(format string, args ...any) {
	if log.file == nil {
		return
	}
	_, _ = fmt.Fprintf(log.file, "%s %s\n", time.Now().UTC().Format(time.RFC3339), fmt.Sprintf(format, args...))
}

func (log *logger) Close() {
	if log.file != nil {
		_ = log.file.Close()
	}
}
