[CmdletBinding()]
param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionSource = Join-Path $repoRoot "extension"
$dist = Join-Path $repoRoot "dist"
$project = [IO.File]::ReadAllText((Join-Path $repoRoot "project.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$stage = Join-Path $dist $project.installFolder
$stageExtension = Join-Path $stage "extension"
$manifestTemplate = [IO.File]::ReadAllText((Join-Path $extensionSource "manifest.template.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$version = [string]$manifestTemplate.version

if ($env:OS -ne "Windows_NT") {
  throw "打包 Windows 发布版需要在 Windows 上运行。"
}
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "扩展版本必须是 x.y.z 格式。"
}

function Remove-SafeTree {
  param([string]$Path, [string]$Parent)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd([char]92)
  $rootPath = [IO.Path]::GetFullPath($Parent).TrimEnd([char]92)
  $separator = [string][IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($rootPath + $separator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝删除构建目录之外的路径：$resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Text)
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Get-ExtensionID {
  param([string]$PublicKey)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Convert]::FromBase64String($PublicKey))
    $id = ""
    for ($index = 0; $index -lt 16; $index++) {
      $byte = $hash[$index]
      $id += [char](97 + ($byte -shr 4))
      $id += [char](97 + ($byte -band 15))
    }
    return $id
  } finally {
    $sha.Dispose()
  }
}

if (-not $SkipTests) {
  Push-Location $extensionSource
  try {
    node --test tests/*.test.js
  } finally {
    Pop-Location
  }
  Push-Location $repoRoot
  try {
    go test ./...
    go vet ./...
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $extensionSource "icons\icon-128.png"))) {
  & (Join-Path $PSScriptRoot "make-icons.ps1")
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Remove-SafeTree $stage $dist
New-Item -ItemType Directory -Force -Path $stageExtension | Out-Null

$hostPath = Join-Path $stage "kyc-host.exe"
$updaterPath = Join-Path $stage "kyc-updater.exe"
$hostLdflags = "-s -w -X main.version=$version -X main.repository=$($project.githubRepository)"
Push-Location $repoRoot
try {
  go build -buildvcs=false -trimpath -ldflags $hostLdflags -o $hostPath ./cmd/kyc-host
  if ($LASTEXITCODE -ne 0) { throw "kyc-host 构建失败。" }
  go build -buildvcs=false -trimpath -ldflags "-s -w -H=windowsgui" -o $updaterPath ./cmd/kyc-updater
  if ($LASTEXITCODE -ne 0) { throw "kyc-updater 构建失败。" }
} finally {
  Pop-Location
}

$publicKey = (Get-Content -Raw (Join-Path $repoRoot "keys\kyc-extension.pub")).Trim()
$expectedID = (Get-Content -Raw (Join-Path $repoRoot "keys\extension-id.txt")).Trim()
$actualID = Get-ExtensionID $publicKey
if ($actualID -ne $expectedID) {
  throw "扩展 ID 不一致：$actualID != $expectedID"
}
$manifestTemplate.key = $publicKey
Write-Utf8NoBom (Join-Path $stageExtension "manifest.json") ($manifestTemplate | ConvertTo-Json -Depth 10)

foreach ($file in "app.html", "app.js", "background.js", "styles.css", "installation.json") {
  Copy-Item -LiteralPath (Join-Path $extensionSource $file) -Destination $stageExtension
}
foreach ($directory in "lib", "icons") {
  Copy-Item -LiteralPath (Join-Path $extensionSource $directory) -Destination $stageExtension -Recurse
}

foreach ($file in "install.ps1", "安装.cmd", "卸载.cmd", "Install.cmd", "Uninstall.cmd", "使用说明.txt") {
  Copy-Item -LiteralPath (Join-Path $repoRoot "packaging\$file") -Destination $stage
}
foreach ($file in "LICENSE", "README.md", "README.zh-CN.md", "PRIVACY.md", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md") {
  Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $repoRoot "docs") -Destination $stage -Recurse

$packageMeta = [ordered]@{
  version = $version
  githubRepository = $project.githubRepository
  nativeHostName = $project.nativeHostName
  installFolder = $project.installFolder
  extensionId = $actualID
}
Write-Utf8NoBom (Join-Path $stage "package-meta.json") ($packageMeta | ConvertTo-Json -Depth 5)

$archiveName = "$($project.packageBaseName)-v$version.zip"
$archive = Join-Path $dist $archiveName
if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -LiteralPath $stage -DestinationPath $archive -CompressionLevel Optimal

$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
Write-Utf8NoBom (Join-Path $dist "SHA256SUMS.txt") ("{0}  {1}`n" -f $hash, $archiveName)

Write-Host ""
Write-Host "构建完成"
Write-Host "  版本：$version"
Write-Host "  扩展 ID：$actualID"
Write-Host "  目录：$stage"
Write-Host "  压缩包：$archive"
Write-Host "  校验文件：$(Join-Path $dist 'SHA256SUMS.txt')"
Write-Host ""
Write-Host "发布 GitHub Release 时同时上传 ZIP 和 SHA256SUMS.txt。"
