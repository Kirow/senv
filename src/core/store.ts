import { mkdir, readFile, writeFile } from "node:fs/promises";
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

function stripJsonComments(jsonc: string): string {
  // Simple comment stripper: removes // ... and /* ... */
  // Note: This naive regex might strip comments inside strings, but for our simple config it is sufficient.
  // A robust solution would use a proper parser, but standard JSON format is acceptable post-mutation.
  return jsonc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

export async function getKeystorePath(customPath?: string): Promise<string> {
  if (customPath) {
    const dir = path.dirname(customPath);
    await mkdir(dir, { recursive: true });
    return customPath;
  }
  const configDir = process.env.SENV_CONFIG_DIR || path.join(os.homedir(), ".config", "senv");
  await mkdir(configDir, { recursive: true });
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
    if (parsed && typeof parsed === "object" && parsed.version === "1.0") {
      return parsed as Keystore;
    }
    return { version: "1.0", projects: {} };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { version: "1.0", projects: {} };
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
  await writeFile(p, JSON.stringify(keystore, null, 2), "utf-8");
}

export function getProjectConfigPath(): string {
  const projDir = process.env.SENV_PROJECT_DIR || process.cwd();
  return path.join(projDir, ".senv.jsonc");
}

export async function readProjectConfig(): Promise<SenvProjectConfig> {
  try {
    const p = getProjectConfigPath();
    const content = await readFile(p, "utf-8");
    const stripped = stripJsonComments(content);
    return JSON.parse(stripped) as SenvProjectConfig;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(".senv.jsonc not found in the current directory.");
    }
    throw new Error(`Failed to read .senv.jsonc: ${err.message}`);
  }
}

export async function writeProjectConfig(config: SenvProjectConfig): Promise<void> {
  const p = getProjectConfigPath();
  await writeFile(p, JSON.stringify(config, null, 2), "utf-8");
}
