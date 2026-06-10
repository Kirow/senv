import { access, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { getGitRoot } from "./git";

export interface Identity {
  publicKey: string;
  privateKey: string;
}

export interface KeystoreProjectStore {
  [identityName: string]: Identity;
}

export interface Keystore {
  version: string;
  projects: {
    [projectDir: string]: KeystoreProjectStore;
  };
}

export interface SenvProjectConfig {
  version: string;
  identities: {
    [idName: string]: string;
  };
  presets?: {
    [presetName: string]: string[];
  };
}

export interface SenvPayloadItem {
  key: string;
  value: string;
  environment: string;
}

export type SenvPayload = SenvPayloadItem[];

export const CURRENT_KEYSTORE_VERSION = "1.0";
export const CURRENT_PROJECT_CONFIG_VERSION = "1.0";

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
  return parsed as SenvProjectConfig;
}

export async function atomicWriteFile(filePath: string, data: string, mode: number): Promise<void> {
  // Single-process atomicity only: open tmp with explicit mode → fsync → rename.
  // No cross-process file lock; concurrent writers can clobber each other.
  // See AGENTS.md "Security model caveats" — this limitation is intentionally accepted.
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

async function mkdirSecure(dir: string): Promise<void> {
  // Mode applies only on creation; an existing dir with looser perms is NOT tightened.
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function normalizePath(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

export async function resolveProjectDir(): Promise<string> {
  // Resolution order (see README "Project directory resolution"):
  // 1. SENV_PROJECT_DIR when set
  // 2. cwd when .senv.json exists there (wins over git root — supports per-package configs)
  // 3. git repository root when cwd has no config but root does
  // 4. cwd otherwise
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

async function findProjectKeystoreEntry(
  ks: Keystore,
  projectDir: string
): Promise<KeystoreProjectStore | undefined> {
  if (ks.projects[projectDir]) {
    return ks.projects[projectDir];
  }
  // Match legacy keystore keys written before realpath normalization (symlinks, relative paths).
  const normalized = await normalizePath(projectDir);
  for (const [key, entry] of Object.entries(ks.projects)) {
    if (await normalizePath(key) === normalized) {
      return entry;
    }
  }
  return undefined;
}

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

export async function getProjectKeystore(customPath?: string): Promise<KeystoreProjectStore> {
  const ks = await readKeystore(customPath);
  const pd = await resolveProjectDir();
  return (await findProjectKeystoreEntry(ks, pd)) || {};
}

export async function writeProjectKeystore(pks: KeystoreProjectStore, customPath?: string): Promise<void> {
  const ks = await readKeystore(customPath);
  const pd = await resolveProjectDir();
  // Collapse duplicate project keys that resolve to the same directory.
  for (const key of Object.keys(ks.projects)) {
    if (key !== pd && (await normalizePath(key)) === pd) {
      delete ks.projects[key];
    }
  }
  ks.projects[pd] = pks;
  await writeKeystore(ks, customPath);
}

export async function writeKeystore(keystore: Keystore, customPath?: string): Promise<void> {
  const p = await getKeystorePath(customPath);
  await atomicWriteFile(p, JSON.stringify(keystore, null, 2), 0o600);
}

export async function getProjectConfigPath(): Promise<string> {
  const projDir = await resolveProjectDir();
  return path.join(projDir, ".senv.json");
}

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

export async function writeProjectConfig(config: SenvProjectConfig): Promise<void> {
  const p = await getProjectConfigPath();
  await atomicWriteFile(p, JSON.stringify(config, null, 2), 0o600);
}
