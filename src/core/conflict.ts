import { type SenvProjectConfig, CURRENT_PROJECT_CONFIG_VERSION, SUPPORTED_PROJECT_CONFIG_VERSIONS } from "./store";

/**
 * @param content - Raw `.senv.json` file contents.
 * @returns `true` when git conflict start markers (`<<<<<<<`) are present.
 */
export function hasGitConflictMarkers(content: string): boolean {
  return content.includes("<<<<<<<");
}

/** @param prefix - JSON text before the first conflict marker. @returns Parsed `"version"` or {@link CURRENT_PROJECT_CONFIG_VERSION}. */
function extractVersion(prefix: string): string {
  const match = prefix.match(/"version"\s*:\s*"([^"]+)"/);
  return match ? match[1]! : CURRENT_PROJECT_CONFIG_VERSION;
}

/** @param version - Version string from conflict prefix. @throws When it is not a supported project config version. */
function validateSenvConfigVersion(version: string): void {
  const supported = SUPPORTED_PROJECT_CONFIG_VERSIONS as readonly string[];
  if (!supported.includes(version)) {
    throw new Error(
      `Unsupported .senv.json version in conflict. Expected one of ${supported.map((v) => `'${v}'`).join(", ")}. Got '${version}'.`
    );
  }
}

/**
 * @param fragment - Partial `identities` object body from a conflict block.
 * @param version - Config version to embed in the wrapper object.
 */
function wrapIdentitiesFragment(fragment: string, version: string): SenvProjectConfig {
  const trimmed = fragment.trim().replace(/,\s*$/, "");
  const wrapped = `{"version":"${version}","identities":{${trimmed}}}`;
  return JSON.parse(wrapped) as SenvProjectConfig;
}

const CONFLICT_BLOCK_RE = /<<<<<<<[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[ \t]*([^\n]*)\n?/gm;

/**
 * Parses one or more git conflict blocks in a `.senv.json` file.
 *
 * Identity entries across blocks are unioned into separate `ours` and `theirs` configs.
 * Used by `senv merge` when resolving conflict markers in place.
 *
 * @param content - Full conflicted file contents.
 * @returns Merged ours/theirs configs and the git branch label from the last `>>>>>>>` marker.
 * @throws When no conflict markers are found or a block cannot be parsed.
 */
export function parseGitConflictSenv(content: string): {
  ours: SenvProjectConfig;
  theirs: SenvProjectConfig;
  theirsLabel: string;
} {
  if (!hasGitConflictMarkers(content)) {
    throw new Error("No git conflict markers found in file.");
  }

  const firstPrefixMatch = content.match(/^([\s\S]*?)<<<<<<</m);
  const prefix = firstPrefixMatch ? firstPrefixMatch[1]! : "";
  const version = extractVersion(prefix);
  validateSenvConfigVersion(version);

  let oursMerged: SenvProjectConfig = wrapIdentitiesFragment("", version);
  let theirsMerged: SenvProjectConfig = wrapIdentitiesFragment("", version);
  let lastLabel = "";
  let matched = 0;

  for (const m of content.matchAll(CONFLICT_BLOCK_RE)) {
    const oursFragment = m[1] ?? "";
    const theirsFragment = m[2] ?? "";
    const label = (m[3] ?? "").trim();
    const oursBlock = wrapIdentitiesFragment(oursFragment, version);
    const theirsBlock = wrapIdentitiesFragment(theirsFragment, version);
    oursMerged = {
      ...oursMerged,
      identities: { ...oursMerged.identities, ...oursBlock.identities },
    };
    theirsMerged = {
      ...theirsMerged,
      identities: { ...theirsMerged.identities, ...theirsBlock.identities },
    };
    lastLabel = label;
    matched += 1;
  }

  if (matched === 0) {
    throw new Error("Failed to parse git conflict markers.");
  }

  return {
    ours: oursMerged,
    theirs: theirsMerged,
    theirsLabel: lastLabel,
  };
}

/** @param idName - Identity name (e.g. `alice-local`). @returns Username portion before `-local`, or `null`. */
function identityOwnerFromName(idName: string): string | null {
  const match = idName.match(/^(.+)-local$/);
  return match ? match[1]! : null;
}

/**
 * Picks which encrypted identity blob to keep when the local user lacks a private key.
 *
 * Matches the git conflict branch label (`theirsLabel`) against the `<user>-local` owner
 * heuristic so incoming changes from the other collaborator are preferred when appropriate.
 *
 * @param idName - Identity being merged.
 * @param encryptedOurs - Ciphertext from the current/ours side.
 * @param encryptedTheirs - Ciphertext from the incoming/theirs side.
 * @param theirsLabel - Git branch name from the `>>>>>>>` marker (optional).
 * @returns The chosen ciphertext blob.
 */
export function pickConflictBlobWithoutPrivateKey(
  idName: string,
  encryptedOurs: string,
  encryptedTheirs: string,
  theirsLabel?: string
): string {
  if (!theirsLabel) {
    return encryptedOurs;
  }
  const owner = identityOwnerFromName(idName);
  if (!owner) {
    return encryptedOurs;
  }
  if (owner === theirsLabel) {
    return encryptedTheirs;
  }
  return encryptedOurs;
}
