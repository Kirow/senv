import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvPayload } from "../core/store";

export function isValidIdentityName(name: string): boolean {
  return typeof name === "string" && /^[A-Za-z0-9._-]+$/.test(name);
}

export function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function getCommandOptions(command: any): { env: string; keystorePath?: string } {
  const parentOpts = command.parent?.optsWithGlobals() || {};
  const globalOpts = command.optsWithGlobals() || {};
  return {
    env: globalOpts.env || parentOpts.env || "dev",
    keystorePath: globalOpts.keystore || parentOpts.keystore,
  };
}

export async function getAccessiblePayloads(
  env: string,
  keystorePath?: string
): Promise<{ identityName: string; payload: SenvPayload }[]> {
  const projectConfig = await store.readProjectConfig();
  const keystore = await store.getProjectKeystore(keystorePath);
  const results: { identityName: string; payload: SenvPayload }[] = [];

  for (const [idName, encryptedString] of Object.entries(projectConfig.identities)) {
    if (keystore[idName] && keystore[idName].privateKey) {
      try {
        const decrypted = senvCrypto.decryptPayload(encryptedString, keystore[idName].privateKey);
        const filtered = decrypted.filter((item) => item.environment === env);
        results.push({ identityName: idName, payload: filtered });
      } catch (e: any) {
        console.warn(`[WARN] Failed to decrypt identity '${idName}': ${e.message}`);
      }
    }
  }

  return results;
}
