#!/usr/bin/env bash
set -euo pipefail

SENV_INSTALL_DIR="${SENV_INSTALL_DIR:-$HOME/.local/bin}"
SENV_REPO="${SENV_REPO:-Kirow/senv}"

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required but not found." >&2
  exit 1
fi

detect_artifact() {
  if command -v bun >/dev/null 2>&1; then
    echo "senv-bun"
    return
  fi

  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64) echo "senv-darwin-arm64" ;;
        x86_64) echo "senv-darwin-x64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    Linux)
      case "$arch" in
        x86_64) echo "senv-linux-x64" ;;
        aarch64|arm64) echo "senv-linux-arm64" ;;
        *) echo "unsupported" ;;
      esac
      ;;
    *)
      echo "unsupported"
      ;;
  esac
}

resolve_tag() {
  if [[ -n "${SENV_VERSION:-}" ]]; then
    echo "v${SENV_VERSION}"
    return
  fi

  local tag
  tag="$(curl -fsSL "https://api.github.com/repos/${SENV_REPO}/releases/latest" | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
  if [[ -z "$tag" ]]; then
    echo "Error: could not resolve latest release for ${SENV_REPO}." >&2
    exit 1
  fi
  echo "$tag"
}

verify_checksum() {
  local dir="$1"
  local artifact="$2"
  local checksums="$dir/checksums.sha256"

  if [[ ! -f "$checksums" ]]; then
    echo "Error: checksums.sha256 not found." >&2
    exit 1
  fi

  local line expected
  line="$(grep " ${artifact}$" "$checksums" || true)"
  if [[ -z "$line" ]]; then
    echo "Error: no checksum entry for ${artifact} in checksums.sha256." >&2
    exit 1
  fi
  expected="${line%% *}"

  if command -v sha256sum >/dev/null 2>&1; then
    echo "${expected}  ${artifact}" | (cd "$dir" && sha256sum -c -)
  elif command -v shasum >/dev/null 2>&1; then
    echo "${expected}  ${artifact}" | (cd "$dir" && shasum -a 256 -c -)
  else
    echo "Error: sha256sum or shasum is required but not found." >&2
    exit 1
  fi
}

ARTIFACT="$(detect_artifact)"
if [[ "$ARTIFACT" == "unsupported" ]]; then
  echo "Error: unsupported platform ($(uname -s) $(uname -m)). No standalone binary available." >&2
  exit 1
fi

TAG="$(resolve_tag)"
BASE_URL="https://github.com/${SENV_REPO}/releases/download/${TAG}"
INSTALL_PATH="${SENV_INSTALL_DIR}/senv"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Installing senv ${TAG} (${ARTIFACT})"
curl -fsSL "${BASE_URL}/checksums.sha256" -o "${TMPDIR}/checksums.sha256"
curl -fsSL "${BASE_URL}/${ARTIFACT}" -o "${TMPDIR}/${ARTIFACT}"
verify_checksum "$TMPDIR" "$ARTIFACT"

if [[ -f "$INSTALL_PATH" ]]; then
  if ! "$INSTALL_PATH" -V 2>&1 | grep -q "Secure ENV (senv)"; then
    echo "Error: ${INSTALL_PATH} already exists but does not appear to be this senv application. Aborting to prevent name collision." >&2
    exit 1
  fi
fi

mkdir -p "$SENV_INSTALL_DIR"
cp "${TMPDIR}/${ARTIFACT}" "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

echo "senv has been successfully installed to ${INSTALL_PATH}"
echo "Make sure ${SENV_INSTALL_DIR} is in your PATH."
