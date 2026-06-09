import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvPayload } from "../core/store";

export function isValidIdentityName(name: string): boolean {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name);
}

export function isValidPresetName(name: string): boolean {
  return isValidIdentityName(name);
}

export interface AccessibleKeyEntry {
  value: string;
  identityName: string;
  identities: string[];
}

export async function getAccessibleKeyMap(
  env: string,
  keystorePath?: string
): Promise<Map<string, AccessibleKeyEntry>> {
  const payloads = await getAccessiblePayloads(env, keystorePath);
  const aggregated = new Map<string, AccessibleKeyEntry>();

  for (const { identityName, payload } of payloads) {
    for (const item of payload) {
      const existing = aggregated.get(item.key);
      if (!existing) {
        aggregated.set(item.key, { value: item.value, identityName, identities: [identityName] });
      } else if (!existing.identities.includes(identityName)) {
        existing.identities.push(identityName);
      }
    }
  }

  return aggregated;
}

export function warnMissingPresetKeys(
  presetName: string,
  keys: string[],
  accessibleKeys: Set<string> | Map<string, unknown>,
  env: string
): void {
  const hasKey = (key: string) =>
    accessibleKeys instanceof Map ? accessibleKeys.has(key) : accessibleKeys.has(key);

  for (const key of keys) {
    if (!hasKey(key)) {
      console.warn(
        `[WARN] Preset '${presetName}': key '${key}' not available for environment '${env}'.`
      );
    }
  }
}

export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function getRootCommand(command: any): any {
  let root = command;
  while (root.parent) root = root.parent;
  return root;
}

export function getCommandOptions(command: any): { env: string; keystorePath?: string; envExplicit: boolean } {
  const parentOpts = command.parent?.optsWithGlobals() || {};
  const globalOpts = command.optsWithGlobals() || {};
  const envSource = getRootCommand(command).getOptionValueSource?.("env");
  return {
    env: globalOpts.env || parentOpts.env || "dev",
    keystorePath: globalOpts.keystore || parentOpts.keystore,
    envExplicit: envSource === "cli",
  };
}

export async function getAccessiblePayloads(
  env: string,
  keystorePath?: string,
  filterByEnv = true
): Promise<{ identityName: string; payload: SenvPayload }[]> {
  const projectConfig = await store.readProjectConfig();
  const keystore = await store.getProjectKeystore(keystorePath);
  const results: { identityName: string; payload: SenvPayload }[] = [];

  for (const [idName, encryptedString] of Object.entries(projectConfig.identities)) {
    if (keystore[idName] && keystore[idName].privateKey) {
      try {
        const decrypted = senvCrypto.decryptPayload(encryptedString, keystore[idName].privateKey);
        const filtered = filterByEnv
          ? decrypted.filter((item) => item.environment === env)
          : decrypted;
        results.push({ identityName: idName, payload: filtered });
      } catch (e: any) {
        console.warn(`[WARN] Failed to decrypt identity '${idName}': ${e.message}`);
      }
    }
  }

  return results;
}
