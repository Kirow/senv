import * as crypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvPayload } from "../core/store";

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
        const decrypted = crypto.decryptPayload(encryptedString, keystore[idName].privateKey);
        const filtered = decrypted.filter((item) => item.environment === env);
        results.push({ identityName: idName, payload: filtered });
      } catch (e: any) {
        console.warn(`[WARN] Failed to decrypt identity '${idName}': ${e.message}`);
      }
    }
  }

  return results;
}
