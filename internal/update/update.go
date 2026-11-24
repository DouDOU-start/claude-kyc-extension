package update

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	assetPrefix      = "claude-kyc-extension"
	maxArchiveBytes  = 100 << 20
	maxExtractBytes  = 200 << 20
	maxArchiveFiles  = 2000
	defaultAPIBase   = "https://api.github.com"
	defaultUserAgent = "claude-kyc-extension"
)

type Release struct {
	Version     string
	Tag         string
	PageURL     string
	Notes       string
	PublishedAt time.Time
	AssetName   string
	AssetURL    string
	SHA256      string
}

type Checker struct {
	Repository string
	APIBase    string
	UserAgent  string
	Client     *http.Client
}

func NewChecker(repository, userAgent string) *Checker {
	return &Checker{
		Repository: repository,
		APIBase:    defaultAPIBase,
		UserAgent:  userAgent,
		Client:     &http.Client{},
	}
}

func (checker *Checker) Latest(ctx context.Context) (Release, error) {
	if checker.Repository == "" {
		return Release{}, errors.New("未配置 GitHub 仓库")
	}
	apiBase := checker.APIBase
	if apiBase == "" {
		apiBase = defaultAPIBase
	}
	userAgent := checker.UserAgent
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	endpoint := strings.TrimRight(apiBase, "/") + "/repos/" + checker.Repository + "/releases/latest"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Release{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", userAgent)
	response, err := checker.Client.Do(request)
	if err != nil {
		return Release{}, errors.New("无法连接 GitHub Releases")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("GitHub Releases 返回 HTTP %d", response.StatusCode)
	}
	var payload struct {
		TagName     string    `json:"tag_name"`
		HTMLURL     string    `json:"html_url"`
		Body        string    `json:"body"`
		PublishedAt time.Time `json:"published_at"`
		Assets      []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil {
		return Release{}, errors.New("GitHub Releases 响应无效")
	}
	version := strings.TrimPrefix(strings.TrimSpace(payload.TagName), "v")
	if !validVersion(version) {
		return Release{}, errors.New("GitHub Release 版本号无效")
	}
	expectedName := assetPrefix + "-" + payload.TagName + ".zip"
	release := Release{
		Version:     version,
		Tag:         payload.TagName,
		PageURL:     payload.HTMLURL,
		Notes:       payload.Body,
		PublishedAt: payload.PublishedAt,
	}
	var checksumURL string
	for _, asset := range payload.Assets {
		switch asset.Name {
		case expectedName:
			if asset.Size > maxArchiveBytes {
				return Release{}, errors.New("更新包过大")
			}
			release.AssetName = asset.Name
			release.AssetURL = asset.URL
			release.SHA256 = parseDigest(asset.Digest)
		case "SHA256SUMS.txt":
			checksumURL = asset.URL
		}
	}
	if release.AssetURL == "" {
		return Release{}, errors.New("GitHub Release 缺少更新包")
	}
	if release.SHA256 == "" {
		if checksumURL == "" {
			return Release{}, errors.New("GitHub Release 缺少 SHA-256 校验值")
		}
		sum, err := checker.checksum(ctx, checksumURL, release.AssetName)
		if err != nil {
			return Release{}, err
		}
		release.SHA256 = sum
	}
	return release, nil
}

func (checker *Checker) checksum(ctx context.Context, assetURL, name string) (string, error) {
	if err := validateDownloadURL(assetURL, checker.Repository); err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", defaultUserAgent)
	response, err := checker.Client.Do(request)
	if err != nil {
		return "", errors.New("无法下载 SHA256SUMS.txt")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SHA256SUMS.txt 返回 HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(body), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			sum := strings.ToLower(fields[0])
			if validSHA256(sum) {
				return sum, nil
			}
		}
	}
	return "", errors.New("SHA256SUMS.txt 中缺少更新包校验值")
}

func parseDigest(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if strings.HasPrefix(value, "sha256:") {
		value = strings.TrimPrefix(value, "sha256:")
	}
	if validSHA256(value) {
		return value
	}
	return ""
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validateDownloadURL(raw, repository string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() != "github.com" {
		return errors.New("更新下载地址无效")
	}
	prefix := "/" + strings.ToLower(repository) + "/releases/download/"
	if !strings.HasPrefix(strings.ToLower(u.Path), prefix) {
		return errors.New("更新下载地址不属于配置的仓库")
	}
	return nil
}

type Prepared struct {
	Version       string
	Tag           string
	ReleaseURL    string
	ArchivePath   string
	PackageDir    string
	ExtensionDir  string
	HostExe       string
	UpdaterExe    string
	ManifestPath  string
	DownloadedAt  time.Time
	PublishedAt   time.Time
	ArchiveSHA256 string
}

func Prepare(ctx context.Context, checker *Checker, targetDir, requestedVersion string) (Prepared, error) {
	release, err := checker.Latest(ctx)
	if err != nil {
		return Prepared{}, err
	}
	if requestedVersion != "" && strings.TrimPrefix(requestedVersion, "v") != release.Version {
		return Prepared{}, errors.New("GitHub 最新版本已变化，请重新检查更新")
	}
	updateDir := filepath.Join(targetDir, release.Version)
	if err := os.MkdirAll(updateDir, 0700); err != nil {
		return Prepared{}, err
	}
	archivePath := filepath.Join(updateDir, release.AssetName)
	if err := download(ctx, checker, release, archivePath); err != nil {
		return Prepared{}, err
	}
	packageDir := filepath.Join(updateDir, "package")
	if err := os.RemoveAll(packageDir); err != nil {
		return Prepared{}, err
	}
	if err := extract(archivePath, packageDir); err != nil {
		return Prepared{}, err
	}
	root, err := packageRoot(packageDir)
	if err != nil {
		return Prepared{}, err
	}
	prepared := Prepared{
		Version:       release.Version,
		Tag:           release.Tag,
		ReleaseURL:    release.PageURL,
		ArchivePath:   archivePath,
		PackageDir:    root,
		ExtensionDir:  filepath.Join(root, "extension"),
		HostExe:       filepath.Join(root, "kyc-host.exe"),
		UpdaterExe:    filepath.Join(root, "kyc-updater.exe"),
		ManifestPath:  filepath.Join(root, "extension", "manifest.json"),
		DownloadedAt:  time.Now().UTC(),
		PublishedAt:   release.PublishedAt,
		ArchiveSHA256: release.SHA256,
	}
	if err := validatePrepared(prepared); err != nil {
		return Prepared{}, err
	}
	state, _ := json.Marshal(prepared)
	if err := os.WriteFile(filepath.Join(updateDir, "prepared.json"), state, 0600); err != nil {
		return Prepared{}, err
	}
	return prepared, nil
}

func LoadPrepared(targetDir, version string) (Prepared, error) {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	if !validVersion(version) {
		return Prepared{}, errors.New("更新版本无效")
	}
	path := filepath.Join(targetDir, version, "prepared.json")
	body, err := os.ReadFile(path)
	if err != nil {
		return Prepared{}, errors.New("没有已下载的更新")
	}
	var prepared Prepared
	if json.Unmarshal(body, &prepared) != nil || prepared.Version != version {
		return Prepared{}, errors.New("更新状态无效")
	}
	if err := validatePrepared(prepared); err != nil {
		return Prepared{}, err
	}
	return prepared, nil
}

// ApplyExtension copies a staged extension over the installed extension.
// The installer-owned installation.json marker is preserved.
func ApplyExtension(prepared Prepared, extensionDir string) error {
	source := filepath.Clean(prepared.ExtensionDir)
	destination := filepath.Clean(extensionDir)
	if source == "" || destination == "" {
		return errors.New("更新目录无效")
	}
	return copyTree(source, destination, map[string]bool{"installation.json": true})
}

func copyTree(source, destination string, skip map[string]bool) error {
	sourceInfo, err := os.Stat(source)
	if err != nil || !sourceInfo.IsDir() {
		return errors.New("更新源目录无效")
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return os.MkdirAll(destination, 0700)
		}
		if skip[filepath.Base(relative)] {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		return copyFileWithRetry(path, target)
	})
}

func copyFileWithRetry(source, destination string) error {
	var last error
	for attempt := 0; attempt < 12; attempt++ {
		if err := copyFileAtomic(source, destination); err == nil {
			return nil
		} else {
			last = err
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("无法写入 %s: %w", filepath.Base(destination), last)
}

func copyFileAtomic(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	temp := destination + ".new"
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
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(temp)
		return err
	}
	if err := os.Rename(temp, destination); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

func CleanupUpdates(targetDir, keepVersion string) {
	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return
	}
	keepVersion = strings.TrimPrefix(keepVersion, "v")
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == keepVersion {
			continue
		}
		_ = os.RemoveAll(filepath.Join(targetDir, entry.Name()))
	}
}

func download(ctx context.Context, checker *Checker, release Release, destination string) error {
	if err := validateDownloadURL(release.AssetURL, checker.Repository); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, release.AssetURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", defaultUserAgent)
	response, err := checker.Client.Do(request)
	if err != nil {
		return errors.New("无法下载更新包")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("更新包下载返回 HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(destination+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, maxArchiveBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(destination + ".tmp")
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(destination + ".tmp")
		return closeErr
	}
	if written > maxArchiveBytes {
		_ = os.Remove(destination + ".tmp")
		return errors.New("更新包超过大小限制")
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if actual != release.SHA256 {
		_ = os.Remove(destination + ".tmp")
		return errors.New("更新包 SHA-256 校验失败")
	}
	if err := os.Rename(destination+".tmp", destination); err != nil {
		_ = os.Remove(destination + ".tmp")
		return err
	}
	return nil
}

func extract(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return errors.New("更新包不是有效的 ZIP")
	}
	defer reader.Close()
	if len(reader.File) > maxArchiveFiles {
		return errors.New("更新包文件数量过多")
	}
	if err := os.MkdirAll(destination, 0700); err != nil {
		return err
	}
	var total int64
	for _, item := range reader.File {
		name := filepath.Clean(filepath.FromSlash(item.Name))
		if name == "." || filepath.IsAbs(name) || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			return errors.New("更新包包含非法路径")
		}
		target := filepath.Join(destination, name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(destination)+string(filepath.Separator)) {
			return errors.New("更新包包含目录穿越路径")
		}
		if item.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
			continue
		}
		total += int64(item.UncompressedSize64)
		if total > maxExtractBytes {
			return errors.New("更新包解压后超过大小限制")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		source, err := item.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			_ = source.Close()
			return err
		}
		_, copyErr := io.Copy(output, io.LimitReader(source, maxExtractBytes))
		closeOutputErr := output.Close()
		closeSourceErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeOutputErr != nil {
			return closeOutputErr
		}
		if closeSourceErr != nil {
			return closeSourceErr
		}
	}
	return nil
}

func packageRoot(directory string) (string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return "", err
	}
	if len(entries) == 1 && entries[0].IsDir() {
		candidate := filepath.Join(directory, entries[0].Name())
		if _, err := os.Stat(filepath.Join(candidate, "extension", "manifest.json")); err == nil {
			return candidate, nil
		}
	}
	if _, err := os.Stat(filepath.Join(directory, "extension", "manifest.json")); err == nil {
		return directory, nil
	}
	return "", errors.New("更新包目录结构无效")
}

func validatePrepared(prepared Prepared) error {
	for _, file := range []string{prepared.ManifestPath, prepared.HostExe, prepared.UpdaterExe} {
		info, err := os.Stat(file)
		if err != nil || info.IsDir() {
			return fmt.Errorf("更新包缺少文件: %s", filepath.Base(file))
		}
	}
	body, err := os.ReadFile(prepared.ManifestPath)
	if err != nil {
		return err
	}
	var manifest struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(body, &manifest) != nil || strings.TrimPrefix(manifest.Version, "v") != prepared.Version {
		return errors.New("更新包版本与扩展清单不一致")
	}
	return nil
}

func CompareVersions(left, right string) int {
	parse := func(value string) []int {
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		parts := strings.SplitN(value, "-", 2)
		numbers := strings.Split(parts[0], ".")
		result := make([]int, 3)
		for index := 0; index < len(numbers) && index < len(result); index++ {
			result[index], _ = strconv.Atoi(numbers[index])
		}
		return result
	}
	a, b := parse(left), parse(right)
	for index := 0; index < 3; index++ {
		if a[index] < b[index] {
			return -1
		}
		if a[index] > b[index] {
			return 1
		}
	}
	return 0
}

func validVersion(value string) bool {
	value = strings.TrimPrefix(value, "v")
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil || number < 0 {
			return false
		}
	}
	return true
}
