import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

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
  await mkdir(dir, { recursive: true, mode: 0o700 });
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

function getProjectDir(): string {
  return process.env.SENV_PROJECT_DIR || process.cwd();
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
  const pd = getProjectDir();
  return ks.projects[pd] || {};
}

export async function writeProjectKeystore(pks: KeystoreProjectStore, customPath?: string): Promise<void> {
  const ks = await readKeystore(customPath);
  const pd = getProjectDir();
  ks.projects[pd] = pks;
  await writeKeystore(ks, customPath);
}

export async function writeKeystore(keystore: Keystore, customPath?: string): Promise<void> {
  const p = await getKeystorePath(customPath);
  await atomicWriteFile(p, JSON.stringify(keystore, null, 2), 0o600);
}

export function getProjectConfigPath(): string {
  const projDir = process.env.SENV_PROJECT_DIR || process.cwd();
  return path.join(projDir, ".senv.json");
}

export async function readProjectConfig(): Promise<SenvProjectConfig> {
  try {
    const p = getProjectConfigPath();
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
      throw new Error(".senv.json not found in the current directory.");
    }
    if (err.message.includes("Unsupported .senv.json version") || err.message.includes("Failed to parse .senv.json JSON")) {
      throw err;
    }
    throw new Error(`Failed to read .senv.json: ${err.message}`);
  }
}

export async function writeProjectConfig(config: SenvProjectConfig): Promise<void> {
  const p = getProjectConfigPath();
  await atomicWriteFile(p, JSON.stringify(config, null, 2), 0o600);
}
