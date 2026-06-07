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

export function parseGitConflictSenv(content: string): {
  ours: SenvProjectConfig;
  theirs: SenvProjectConfig;
  theirsLabel: string;
} {
  if (!hasGitConflictMarkers(content)) {
    throw new Error("No git conflict markers found in file.");
  }

  const conflictRegex = /^([\s\S]*?)<<<<<<<[^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>>[ \t]*([^\n]*)\n?([\s\S]*)$/m;
  const match = content.match(conflictRegex);
  if (!match) {
    throw new Error("Failed to parse git conflict markers.");
  }

  const [, prefix, oursFragment, theirsFragment, theirsLabel] = match;
  const version = extractVersion(prefix!);

  return {
    ours: wrapIdentitiesFragment(oursFragment!, version),
    theirs: wrapIdentitiesFragment(theirsFragment!, version),
    theirsLabel: theirsLabel!.trim(),
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
