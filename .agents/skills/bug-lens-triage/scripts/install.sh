#!/usr/bin/env bash
# Bug Lens 原生 Rust CLI 安装脚本（POSIX: macOS / Linux）
# 仅在安装或升级 Skill 时由用户/安装器显式运行一次；CLI 运行时本身保持严格零外联。

set -euo pipefail

REPO="${BUG_LENS_REPO:-Aoyia/bug-lens}"
VERSION="${1:-${BUG_LENS_CLI_VERSION:-latest}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${SKILL_DIR}/bin"
BIN_PATH="${BIN_DIR}/bug-lens-cli"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}:${ARCH}" in
  Darwin:arm64|Darwin:aarch64)
    TARGET="aarch64-apple-darwin"
    ;;
  Darwin:x86_64)
    TARGET="x86_64-apple-darwin"
    ;;
  Linux:x86_64|Linux:amd64)
    TARGET="x86_64-unknown-linux-musl"
    ;;
  Linux:aarch64|Linux:arm64)
    TARGET="aarch64-unknown-linux-musl"
    ;;
  *)
    echo "Unsupported platform: ${OS}/${ARCH}. Build from source via cargo build --release." >&2
    exit 1
    ;;
esac

ARCHIVE="bug-lens-cli-${TARGET}.tar.gz"
if [ "${VERSION}" = "latest" ]; then
  BASE_URL="https://github.com/${REPO}/releases/latest/download"
else
  TAG="${VERSION#v}"
  BASE_URL="https://github.com/${REPO}/releases/download/v${TAG}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[bug-lens-cli] Downloading ${ARCHIVE} from ${BASE_URL}..."
curl -fsSL "${BASE_URL}/${ARCHIVE}" -o "${TMP_DIR}/${ARCHIVE}"
curl -fsSL "${BASE_URL}/SHA256SUMS.txt" -o "${TMP_DIR}/SHA256SUMS.txt"

# 校验 SHA-256 摘要，防止下载产物被篡改或损坏
EXPECTED_SHA="$(awk -v file="${ARCHIVE}" '$2 == file || $2 == "*"file { print $1; exit }' "${TMP_DIR}/SHA256SUMS.txt")"
if [ -z "${EXPECTED_SHA}" ]; then
  echo "Error: ${ARCHIVE} not found in SHA256SUMS.txt" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "${TMP_DIR}/${ARCHIVE}" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "${TMP_DIR}/${ARCHIVE}" | awk '{print $1}')"
else
  echo "Error: neither shasum nor sha256sum is available to verify download integrity." >&2
  exit 1
fi

if [ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]; then
  echo "Error: SHA-256 mismatch for ${ARCHIVE} (expected ${EXPECTED_SHA}, got ${ACTUAL_SHA})" >&2
  exit 1
fi

mkdir -p "${BIN_DIR}"
tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "${TMP_DIR}"
mv -f "${TMP_DIR}/bug-lens-cli" "${BIN_PATH}"
chmod 755 "${BIN_PATH}"

echo "[bug-lens-cli] Installed native binary to ${BIN_PATH}"
"${BIN_PATH}" --version
