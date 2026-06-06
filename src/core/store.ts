import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
}

export interface SenvPayloadItem {
  key: string;
  value: string;
  environment: string;
}

export type SenvPayload = SenvPayloadItem[];

export const CURRENT_KEYSTORE_VERSION = "1.0";
export const CURRENT_PROJECT_CONFIG_VERSION = "1.0";

export function migrateKeystore(parsed: any): Keystore {
  if (parsed && typeof parsed === "object" && typeof parsed.version === "string") {
    if (parsed.version === CURRENT_KEYSTORE_VERSION) {
      return parsed as Keystore;
    }
  }
  throw new Error(`Unsupported keystore version. Expected '${CURRENT_KEYSTORE_VERSION}'.`);
}

async function atomicWriteFile(filePath: string, data: string, mode: number): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, data, { encoding: "utf-8", mode });
  await rename(tmpPath, filePath);
}

export async function getKeystorePath(customPath?: string): Promise<string> {
  if (customPath) {
    const dir = path.dirname(customPath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    return customPath;
  }
  const configDir = process.env.SENV_CONFIG_DIR || path.join(os.homedir(), ".config", "senv");
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  return path.join(configDir, "identity.json");
}

function getProjectDir(): string {
  return process.env.SENV_PROJECT_DIR || process.cwd();
}

export async function readKeystore(customPath?: string): Promise<Keystore> {
  try {
    const p = await getKeystorePath(customPath);
    const content = await readFile(p, "utf-8");
    const parsed = JSON.parse(content);
    return migrateKeystore(parsed);
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
    return JSON.parse(content) as SenvProjectConfig;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(".senv.json not found in the current directory.");
    }
    throw new Error(`Failed to read .senv.json: ${err.message}`);
  }
}

export async function writeProjectConfig(config: SenvProjectConfig): Promise<void> {
  const p = getProjectConfigPath();
  await atomicWriteFile(p, JSON.stringify(config, null, 2), 0o600);
}
