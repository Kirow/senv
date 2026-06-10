import { GITHUB_REPO } from "../version";

/** @param version - Semver-like string. @returns Numeric dot-separated segments (prerelease suffix stripped). */
function normalizeVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .replace(/-.*$/, "")
    .split(".")
    .map(part => {
      const n = Number(part);
      return Number.isNaN(n) ? 0 : n;
    });
}

/**
 * Compares two semver-like version strings using numeric dot-separated segments.
 *
 * @param a - First version (optional `v` prefix and prerelease suffix are ignored).
 * @param b - Second version.
 * @returns `-1` when `a < b`, `1` when `a > b`, `0` when equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = normalizeVersion(a);
  const pb = normalizeVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/**
 * Fetches the latest release tag from the GitHub API for this project.
 *
 * @returns Version string without a leading `v`.
 * @throws When the API request fails or the response lacks `tag_name`.
 */
export async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status}`);
  }
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) {
    throw new Error("missing tag_name in release response");
  }
  return data.tag_name.replace(/^v/, "");
}
