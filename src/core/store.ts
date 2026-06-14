import { access, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getGitRoot } from "./git";

/** RSA keypair for a single identity in the local keystore. */
export interface Identity {
  publicKey: string;
  privateKey: string;
}

/** Map of identity names to keypairs for one project directory. */
export interface KeystoreProjectStore {
  [identityName: string]: Identity;
}

/** On-disk `identity.json` schema: versioned, keyed by absolute project directory. */
export interface Keystore {
  version: string;
  projects: {
    [projectDir: string]: KeystoreProjectStore;
  };
}

/** On-disk `.senv.json` schema: encrypted identity blobs and optional named presets. */
export interface SenvProjectConfig {
  version: string;
  identities: {
    [idName: string]: string;
  };
  presets?: {
    [presetName: string]: string[];
  };
}

/** One decrypted environment variable inside an identity payload. */
export interface SenvPayloadItem {
  key: string;
  value: string;
  environment: string;
}

/** Decrypted payload for one identity: a list of env-scoped key-value pairs. */
export type SenvPayload = SenvPayloadItem[];

/** Supported `identity.json` schema version. Bump with a migration path in {@link validateKeystoreVersion}. */
export const CURRENT_KEYSTORE_VERSION = "1.0";

/** Supported `.senv.json` schema version. Bump with a migration path in {@link validateProjectConfigVersion}. */
export const CURRENT_PROJECT_CONFIG_VERSION = "1.0";

/**
 * Validates that parsed JSON matches the supported keystore schema version.
 *
 * @param parsed - Raw JSON value from `identity.json`.
 * @returns Typed {@link Keystore} when the version matches {@link CURRENT_KEYSTORE_VERSION}.
 * @throws When the version field is missing or unsupported.
 */
export function validateKeystoreVersion(parsed: any): Keystore {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.version !== "string" ||
    parsed.version !== CURRENT_KEYSTORE_VERSION
  ) {
    const got = parsed && typeof parsed === "object" && typeof parsed.version === "string"
      ? parsed.version
      : "<missing>";
    throw new Error(`Unsupported keystore version. Expected '${CURRENT_KEYSTORE_VERSION}'. Got '${got}'.`);
  }
  return parsed as Keystore;
}

/**
 * Validates that parsed JSON matches the supported `.senv.json` schema version.
 *
 * @param parsed - Raw JSON value from `.senv.json`.
 * @returns Typed {@link SenvProjectConfig} when the version matches {@link CURRENT_PROJECT_CONFIG_VERSION}.
 * @throws When the version field is missing or unsupported.
 */
export function validateProjectConfigVersion(parsed: any): SenvProjectConfig {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.version !== "string" ||
    parsed.version !== CURRENT_PROJECT_CONFIG_VERSION
  ) {
    const got = parsed && typeof parsed === "object" && typeof parsed.version === "string"
      ? parsed.version
      : "<missing>";
    throw new Error(`Unsupported .senv.json version. Expected '${CURRENT_PROJECT_CONFIG_VERSION}'. Got '${got}'.`);
  }

  if (!parsed.identities || typeof parsed.identities !== "object" || Array.isArray(parsed.identities)) {
    throw new Error("Invalid .senv.json: 'identities' must be an object.");
  }

  for (const [idName, blob] of Object.entries(parsed.identities)) {
    if (typeof blob !== "string" || blob.length === 0) {
      throw new Error(`Invalid .senv.json: identities['${idName}'] must be a non-empty string.`);
    }
  }

  if (parsed.presets !== undefined) {
    if (typeof parsed.presets !== "object" || Array.isArray(parsed.presets)) {
      throw new Error("Invalid .senv.json: 'presets' must be an object.");
    }
    for (const [presetName, keys] of Object.entries(parsed.presets)) {
      if (!Array.isArray(keys)) {
        throw new Error(`Invalid .senv.json: presets['${presetName}'] must be an array of strings.`);
      }
      for (let i = 0; i < keys.length; i++) {
        if (typeof keys[i] !== "string") {
          throw new Error(
            `Invalid .senv.json: presets['${presetName}'][${i}] must be a string.`
          );
        }
      }
    }
  }

  return parsed as SenvProjectConfig;
}

/**
 * Writes `data` to `filePath` atomically via a temp file, fsync, and rename.
 *
 * Single-process atomicity only; concurrent writers can clobber each other (see AGENTS.md).
 *
 * @param filePath - Destination path (overwritten on success).
 * @param data - UTF-8 string content to write.
 * @param mode - Unix file mode (e.g. `0o600` for secrets).
 */
export async function atomicWriteFile(filePath: string, data: string, mode: number): Promise<void> {
  const tmpPath = filePath + ".tmp";
  const fh = await open(tmpPath, "w", mode);
  try {
    await fh.writeFile(data, "utf-8");
    await fh.sync();
  } catch (e) {
    await fh.close();
    try { await unlink(tmpPath); } catch {}
    throw e;
  }
  await fh.close();
  await rename(tmpPath, filePath);
}

/** Creates `dir` with mode `0700` when it does not exist; does not tighten permissions on existing dirs. */
async function mkdirSecure(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/** @param filePath - Path to test for accessibility. @returns `true` when the path exists and is readable. */
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param dir - Directory path to normalize.
 * @returns Canonical path via `realpath`, or `path.resolve` when the path does not exist yet.
 */
async function normalizePath(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Resolves the project directory used for `.senv.json` and project-scoped keystore entries.
 *
 * Resolution order: `SENV_PROJECT_DIR` → cwd (when config exists there) → git root
 * (when cwd has no config but root does) → cwd.
 *
 * @returns Absolute, normalized project directory path.
 */
export async function resolveProjectDir(): Promise<string> {
  let dir: string;
  if (process.env.SENV_PROJECT_DIR) {
    dir = process.env.SENV_PROJECT_DIR;
  } else {
    const cwd = process.cwd();
    if (await pathExists(path.join(cwd, ".senv.json"))) {
      dir = cwd;
    } else {
      const gitRoot = getGitRoot(cwd);
      if (gitRoot) {
        const cwdNorm = await normalizePath(cwd);
        const gitNorm = await normalizePath(gitRoot);
        if (gitNorm !== cwdNorm && await pathExists(path.join(gitRoot, ".senv.json"))) {
          dir = gitRoot;
        } else {
          dir = cwd;
        }
      } else {
        dir = cwd;
      }
    }
  }
  return normalizePath(dir);
}

/** @returns User-facing message listing where `.senv.json` was searched. */
async function formatProjectConfigNotFoundError(): Promise<string> {
  if (process.env.SENV_PROJECT_DIR) {
    const dir = await normalizePath(process.env.SENV_PROJECT_DIR);
    return `.senv.json not found in SENV_PROJECT_DIR (${dir}).`;
  }
  const cwd = process.cwd();
  const gitRoot = getGitRoot(cwd);
  if (gitRoot) {
    const cwdNorm = await normalizePath(cwd);
    const gitNorm = await normalizePath(gitRoot);
    if (gitNorm !== cwdNorm) {
      return `.senv.json not found in the current directory or at the git repository root (${gitNorm}).`;
    }
  }
  return `.senv.json not found in the current directory.`;
}

/**
 * @param ks - Full keystore.
 * @param projectDir - Resolved project directory to look up.
 * @returns Project identity map, matching legacy keys that differ only by symlink normalization.
 */
async function findProjectKeystoreEntry(
  ks: Keystore,
  projectDir: string
): Promise<KeystoreProjectStore | undefined> {
  if (ks.projects[projectDir]) {
    return ks.projects[projectDir];
  }
  const normalized = await normalizePath(projectDir);
  for (const [key, entry] of Object.entries(ks.projects)) {
    if (await normalizePath(key) === normalized) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Returns the keystore file path, creating parent directories as needed.
 *
 * @param customPath - When set, use this path instead of `SENV_CONFIG_DIR` / `~/.config/senv/identity.json`.
 * @returns Absolute path to `identity.json`.
 */
export async function getKeystorePath(customPath?: string): Promise<string> {
  if (customPath) {
    const dir = path.dirname(customPath);
    await mkdirSecure(dir);
    return customPath;
  }
  const configDir = process.env.SENV_CONFIG_DIR || path.join(os.homedir(), ".config", "senv");
  await mkdirSecure(configDir);
  return path.join(configDir, "identity.json");
}

/**
 * Reads and validates the keystore.
 *
 * @param customPath - Optional override passed to {@link getKeystorePath}.
 * @returns Parsed keystore, or an empty store when the file does not exist.
 * @throws On JSON parse errors or unsupported versions.
 */
export async function readKeystore(customPath?: string): Promise<Keystore> {
  try {
    const p = await getKeystorePath(customPath);
    const content = await readFile(p, "utf-8");
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr: any) {
      throw new Error(`Failed to parse keystore JSON: ${parseErr.message}`);
    }
    return validateKeystoreVersion(parsed);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { version: CURRENT_KEYSTORE_VERSION, projects: {} };
    }
    throw new Error(`Failed to read keystore: ${err.message}`);
  }
}

/**
 * @param customPath - Optional keystore path override.
 * @returns Identity map for the current project, or `{}` when none is stored.
 */
export async function getProjectKeystore(customPath?: string): Promise<KeystoreProjectStore> {
  const ks = await readKeystore(customPath);
  const pd = await resolveProjectDir();
  return (await findProjectKeystoreEntry(ks, pd)) || {};
}

/**
 * Persists the identity map for the current project, collapsing duplicate normalized project keys.
 *
 * @param pks - Identity name → keypair map for this project.
 * @param customPath - Optional keystore path override.
 */
export async function writeProjectKeystore(pks: KeystoreProjectStore, customPath?: string): Promise<void> {
  const ks = await readKeystore(customPath);
  const pd = await resolveProjectDir();
  for (const key of Object.keys(ks.projects)) {
    if (key !== pd && (await normalizePath(key)) === pd) {
      delete ks.projects[key];
    }
  }
  ks.projects[pd] = pks;
  await writeKeystore(ks, customPath);
}

/**
 * Atomically writes the full keystore to disk with mode `0600`.
 *
 * @param keystore - Complete keystore object to persist.
 * @param customPath - Optional keystore path override.
 */
export async function writeKeystore(keystore: Keystore, customPath?: string): Promise<void> {
  const p = await getKeystorePath(customPath);
  await atomicWriteFile(p, JSON.stringify(keystore, null, 2), 0o600);
}

/** @returns Absolute path to `.senv.json` in the directory from {@link resolveProjectDir}. */
export async function getProjectConfigPath(): Promise<string> {
  const projDir = await resolveProjectDir();
  return path.join(projDir, ".senv.json");
}

/**
 * Reads and validates `.senv.json` for the resolved project directory.
 *
 * @returns Parsed project config.
 * @throws When the file is missing, malformed, or has an unsupported version.
 */
export async function readProjectConfig(): Promise<SenvProjectConfig> {
  const p = await getProjectConfigPath();
  try {
    const content = await readFile(p, "utf-8");
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseErr: any) {
      throw new Error(`Failed to parse .senv.json JSON: ${parseErr.message}`);
    }
    return validateProjectConfigVersion(parsed);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(await formatProjectConfigNotFoundError());
    }
    if (err.message.includes("Unsupported .senv.json version") || err.message.includes("Failed to parse .senv.json JSON")) {
      throw err;
    }
    throw new Error(`Failed to read .senv.json: ${err.message}`);
  }
}

/**
 * Atomically writes `.senv.json` with mode `0600`.
 *
 * @param config - Project config to persist.
 */
export async function writeProjectConfig(config: SenvProjectConfig): Promise<void> {
  const p = await getProjectConfigPath();
  await atomicWriteFile(p, JSON.stringify(config, null, 2), 0o600);
}
