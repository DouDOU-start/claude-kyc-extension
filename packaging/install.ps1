[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$NoOpenFolder
)

$ErrorActionPreference = "Stop"
$package = Split-Path -Parent $MyInvocation.MyCommand.Path
$metaPath = Join-Path $package "package-meta.json"
if (-not (Test-Path -LiteralPath $metaPath)) {
  throw "安装包缺少 package-meta.json。"
}
$meta = [IO.File]::ReadAllText($metaPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$hostName = [string]$meta.nativeHostName
$appFolder = [string]$meta.installFolder
$installDir = Join-Path $env:LOCALAPPDATA $appFolder
$installedExtension = Join-Path $installDir "extension"
$nativeManifest = Join-Path $installDir "native-host.json"
$registryRoots = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts",
  "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
  "HKCU:\Software\Chromium\NativeMessagingHosts"
)

function Remove-SafeTree {
  param([string]$Path, [string]$Parent)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolved = [IO.Path]::GetFullPath($Path).TrimEnd([char]92)
  $rootPath = [IO.Path]::GetFullPath($Parent).TrimEnd([char]92)
  $separator = [string][IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($rootPath + $separator, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝删除安装目录之外的路径：$resolved"
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

function Remove-HostRegistration {
  foreach ($root in $registryRoots) {
    $key = Join-Path $root $hostName
    if (Test-Path -LiteralPath $key) {
      Remove-Item -LiteralPath $key -Recurse -Force
    }
  }
}

if ($Uninstall) {
  Remove-HostRegistration
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA $appFolder)).TrimEnd([char]92)
  $actual = [IO.Path]::GetFullPath($installDir).TrimEnd([char]92)
  if ($actual -ne $expected) {
    throw "安装目录校验失败，未删除任何文件。"
  }
  if (Test-Path -LiteralPath $installDir) {
    Remove-Item -LiteralPath $installDir -Recurse -Force
  }
  Write-Host "本地查询组件已卸载。"
  Write-Host "请到扩展管理页手动移除 Claude KYC 扩展。"
  exit 0
}

$sourceHost = Join-Path $package "kyc-host.exe"
$sourceUpdater = Join-Path $package "kyc-updater.exe"
$sourceExtension = Join-Path $package "extension"
$sourceManifest = Join-Path $sourceExtension "manifest.json"
foreach ($required in $sourceHost, $sourceUpdater, $sourceManifest) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "安装包不完整，缺少：$required"
  }
}

$extensionManifest = [IO.File]::ReadAllText($sourceManifest, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($extensionManifest.key)) {
  throw "扩展包缺少固定 ID。"
}
$extensionID = Get-ExtensionID $extensionManifest.key

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Remove-SafeTree $installedExtension $installDir
Copy-Item -LiteralPath $sourceExtension -Destination $installedExtension -Recurse

$marker = [ordered]@{
  managed = $true
  installDir = $installDir
}
Write-Utf8NoBom (Join-Path $installedExtension "installation.json") ($marker | ConvertTo-Json -Depth 4)
$versionMarker = [ordered]@{
  version = [string]$extensionManifest.version
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
}
Write-Utf8NoBom (Join-Path $installDir "version.json") ($versionMarker | ConvertTo-Json -Depth 3)

try {
  Copy-Item -LiteralPath $sourceHost -Destination (Join-Path $installDir "kyc-host.exe") -Force
  Copy-Item -LiteralPath $sourceUpdater -Destination (Join-Path $installDir "kyc-updater.exe") -Force
} catch {
  throw "本地查询器正在使用中。请关闭 Claude KYC 扩展页后重试。"
}

$hostManifest = [ordered]@{
  name = $hostName
  description = "Claude KYC local query host"
  path = (Join-Path $installDir "kyc-host.exe")
  type = "stdio"
  allowed_origins = @("chrome-extension://$extensionID/")
}
Write-Utf8NoBom $nativeManifest ($hostManifest | ConvertTo-Json -Depth 5)

$registered = 0
foreach ($root in $registryRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  $key = Join-Path $root $hostName
  if (-not (Test-Path -LiteralPath $key)) {
    New-Item -Path $key -ErrorAction Stop | Out-Null
  }
  Set-Item -Path $key -Value $nativeManifest
  $registered++
}
if ($registered -eq 0) {
  throw "未检测到已配置的 Chromium 浏览器。"
}

if (-not $NoOpenFolder) {
  Start-Process explorer.exe -ArgumentList ('"' + $installedExtension + '"')
}

Write-Host ""
Write-Host "Claude KYC 本机组件已安装，自动更新已启用。"
Write-Host ""
Write-Host "下一步："
Write-Host "1. 打开 chrome://extensions 或 edge://extensions"
Write-Host "2. 开启右上角“开发者模式”"
Write-Host "3. 点击“加载已解压的扩展程序”"
Write-Host "4. 选择下面这个 extension 文件夹："
Write-Host "   $installedExtension"
Write-Host ""
Write-Host "注意：请选择 extension 文件夹，不要选择它的上一级。"
Write-Host "扩展 ID：$extensionID"
Write-Host "版本：$($extensionManifest.version)"
