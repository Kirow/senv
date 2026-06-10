/** Current CLI version string (`senv -V`). Single source of truth — do not hardcode elsewhere. */
export const VERSION = "0.2.0";

/** Canonical project URL shown in `senv -V` output. */
export const GITHUB_URL = "https://github.com/Kirow/senv";

/** `owner/repo` slug for GitHub API calls (e.g. {@link fetchLatestVersion}). */
export const GITHUB_REPO = "Kirow/senv";

/** Remote install script used by `senv update`. */
export const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/Kirow/senv/refs/heads/main/scripts/install.sh";
