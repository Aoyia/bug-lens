# Bug Lens 原生 Rust CLI 安装脚本（Windows x64）
# 仅在安装或升级 Skill 时显式运行一次；CLI 运行时本身保持严格零外联。

param(
  [string]$Version = $(if ($env:BUG_LENS_CLI_VERSION) { $env:BUG_LENS_CLI_VERSION } else { "latest" }),
  [string]$Repo = $(if ($env:BUG_LENS_REPO) { $env:BUG_LENS_REPO } else { "Aoyia/bug-lens" })
)

$ErrorActionPreference = "Stop"
# 兼容 Windows PowerShell 5.1 默认 TLS 版本偏低导致的 GitHub HTTPS 握手失败
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillDir = Split-Path -Parent $ScriptDir
$BinDir = Join-Path $SkillDir "bin"
$BinPath = Join-Path $BinDir "bug-lens-cli.exe"

$Target = "x86_64-pc-windows-msvc"
$Archive = "bug-lens-cli-$Target.zip"

if ($Version -eq "latest") {
  $BaseUrl = "https://github.com/$Repo/releases/latest/download"
} else {
  $Tag = $Version.TrimStart("v")
  $BaseUrl = "https://github.com/$Repo/releases/download/v$Tag"
}

$TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("bug-lens-cli-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

try {
  $ArchivePath = Join-Path $TmpDir $Archive
  $SumsPath = Join-Path $TmpDir "SHA256SUMS.txt"

  Write-Host "[bug-lens-cli] Downloading $Archive from $BaseUrl..."
  Invoke-WebRequest -Uri "$BaseUrl/$Archive" -OutFile $ArchivePath -UseBasicParsing
  Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS.txt" -OutFile $SumsPath -UseBasicParsing

  # 校验 SHA-256 摘要，防止产物损坏或被篡改
  $ExpectedLine = Get-Content $SumsPath | Where-Object { $_ -match "\s+\*?$([regex]::Escape($Archive))$" } | Select-Object -First 1
  if (-not $ExpectedLine) {
    throw "Archive $Archive not found in SHA256SUMS.txt"
  }
  $ExpectedSha = ($ExpectedLine -split "\s+")[0].ToLowerInvariant()
  $ActualSha = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()

  if ($ActualSha -ne $ExpectedSha) {
    throw "SHA-256 mismatch for $Archive (expected $ExpectedSha, got $ActualSha)"
  }

  $ExtractDir = Join-Path $TmpDir "extracted"
  Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Move-Item -Path (Join-Path $ExtractDir "bug-lens-cli.exe") -Destination $BinPath -Force

  Write-Host "[bug-lens-cli] Installed native binary to $BinPath"
  & $BinPath --version
} finally {
  Remove-Item -Path $TmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
