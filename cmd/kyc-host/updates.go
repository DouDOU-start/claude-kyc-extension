package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/DouDOU-start/claude-kyc-extension/internal/update"
)

type installationMarker struct {
	Managed    bool   `json:"managed"`
	InstallDir string `json:"installDir,omitempty"`
}

type installInfo struct {
	Root             string
	ExtensionDir     string
	ExtensionVersion string
	Managed          bool
}

type statusData struct {
	HostVersion      string `json:"hostVersion"`
	ExtensionVersion string `json:"extensionVersion"`
	Managed          bool   `json:"managed"`
	Repository       string `json:"repository"`
}

type updateInfo struct {
	Managed        bool   `json:"managed"`
	Reason         string `json:"reason,omitempty"`
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion,omitempty"`
	Notes          string `json:"notes,omitempty"`
	ReleaseURL     string `json:"releaseUrl,omitempty"`
}

type preparedUpdateInfo struct {
	Version string `json:"version"`
}

type appliedUpdateInfo struct {
	Version         string `json:"version"`
	RestartRequired bool   `json:"restartRequired"`
}

func (worker service) installInfo() (installInfo, error) {
	executable, err := worker.executable()
	if err != nil {
		return installInfo{}, err
	}
	root := filepath.Dir(executable)
	extensionDir := filepath.Join(root, "extension")
	var marker installationMarker
	body, err := os.ReadFile(filepath.Join(extensionDir, "installation.json"))
	if err != nil || json.Unmarshal(body, &marker) != nil {
		return installInfo{Root: root, ExtensionDir: extensionDir}, nil
	}
	var manifest struct {
		Version string `json:"version"`
	}
	body, err = os.ReadFile(filepath.Join(extensionDir, "manifest.json"))
	if err != nil || json.Unmarshal(body, &manifest) != nil {
		return installInfo{Root: root, ExtensionDir: extensionDir, Managed: marker.Managed}, nil
	}
	return installInfo{
		Root:             root,
		ExtensionDir:     extensionDir,
		ExtensionVersion: manifest.Version,
		Managed:          marker.Managed,
	}, nil
}

func (worker service) status() statusData {
	info, _ := worker.installInfo()
	return statusData{
		HostVersion:      worker.version,
		ExtensionVersion: info.ExtensionVersion,
		Managed:          info.Managed,
		Repository:       worker.repository,
	}
}

func (worker service) checker() *update.Checker {
	return update.NewChecker(worker.repository, "claude-kyc-extension/"+worker.version)
}

func (worker service) checkUpdate(ctx context.Context) (updateInfo, *apiError) {
	info, err := worker.installInfo()
	if err != nil {
		return updateInfo{}, &apiError{Code: "update_unavailable", Message: "无法读取安装目录。"}
	}
	result := updateInfo{
		Managed:        info.Managed,
		CurrentVersion: info.ExtensionVersion,
	}
	if !info.Managed {
		result.Reason = "请从安装目录加载扩展后再使用自动更新。"
		return result, nil
	}
	if worker.repository == "" {
		result.Reason = "当前构建未配置 GitHub 仓库。"
		return result, nil
	}
	release, err := worker.checker().Latest(ctx)
	if err != nil {
		return updateInfo{}, &apiError{Code: "update_check_failed", Message: "检查更新失败，请稍后重试。"}
	}
	result.LatestVersion = release.Version
	result.ReleaseURL = release.PageURL
	result.Notes = truncateRunes(release.Notes, 6000)
	result.Available = update.CompareVersions(release.Version, info.ExtensionVersion) > 0
	return result, nil
}

func (worker service) prepareUpdate(ctx context.Context, version string) (preparedUpdateInfo, *apiError) {
	info, err := worker.installInfo()
	if err != nil || !info.Managed {
		return preparedUpdateInfo{}, &apiError{Code: "update_unavailable", Message: "请从安装目录加载扩展后再更新。"}
	}
	prepared, err := update.Prepare(ctx, worker.checker(), filepath.Join(info.Root, "updates"), version)
	if err != nil {
		return preparedUpdateInfo{}, &apiError{Code: "update_download_failed", Message: "下载或校验更新失败，请稍后重试。"}
	}
	return preparedUpdateInfo{Version: prepared.Version}, nil
}

func (worker service) applyUpdate(version string) (appliedUpdateInfo, *apiError) {
	info, err := worker.installInfo()
	if err != nil || !info.Managed {
		return appliedUpdateInfo{}, &apiError{Code: "update_unavailable", Message: "请从安装目录加载扩展后再更新。"}
	}
	updatesDir := filepath.Join(info.Root, "updates")
	prepared, err := update.LoadPrepared(updatesDir, version)
	if err != nil {
		return appliedUpdateInfo{}, &apiError{Code: "update_not_ready", Message: "更新尚未下载完成。"}
	}
	if update.CompareVersions(prepared.Version, info.ExtensionVersion) <= 0 {
		return appliedUpdateInfo{}, &apiError{Code: "update_not_ready", Message: "更新版本无效。"}
	}
	if err := startUpdater(prepared.UpdaterExe, updaterArguments(info.Root, prepared)); err != nil {
		return appliedUpdateInfo{}, &apiError{Code: "update_apply_failed", Message: "无法启动本机更新器，请重新运行安装包。"}
	}
	if err := update.ApplyExtension(prepared, info.ExtensionDir); err != nil {
		return appliedUpdateInfo{}, &apiError{Code: "update_apply_failed", Message: "扩展文件更新失败，请关闭扩展页后重试。"}
	}
	return appliedUpdateInfo{Version: prepared.Version, RestartRequired: true}, nil
}

func updaterArguments(root string, prepared update.Prepared) []string {
	logPath := filepath.Join(root, "update.log")
	return []string{
		"--install-dir", root,
		"--host", prepared.HostExe,
		"--updater", prepared.UpdaterExe,
		"--version", prepared.Version,
		"--parent-pid", strconv.Itoa(os.Getpid()),
		"--log", logPath,
	}
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}
