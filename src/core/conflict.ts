import { type SenvProjectConfig, CURRENT_PROJECT_CONFIG_VERSION } from "./store";

export function hasGitConflictMarkers(content: string): boolean {
  return content.includes("<<<<<<<");
}

function extractVersion(prefix: string): string {
  const match = prefix.match(/"version"\s*:\s*"([^"]+)"/);
  return match ? match[1]! : CURRENT_PROJECT_CONFIG_VERSION;
}

function wrapIdentitiesFragment(fragment: string, version: string): SenvProjectConfig {
  const trimmed = fragment.trim().replace(/,\s*$/, "");
  const wrapped = `{"version":"${version}","identities":{${trimmed}}}`;
  return JSON.parse(wrapped) as SenvProjectConfig;
}

const CONFLICT_BLOCK_RE = /<<<<<<<[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[ \t]*([^\n]*)\n?/gm;

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

function identityOwnerFromName(idName: string): string | null {
  const match = idName.match(/^(.+)-local$/);
  return match ? match[1]! : null;
}

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
