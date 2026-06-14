import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type KeystoreProjectStore, type SenvPayload } from "../core/store";
import { isValidEnvName, isValidIdentityName } from "../core/validation";

export { isValidEnvName, isValidIdentityName } from "../core/validation";

/** Alias for {@link isValidIdentityName}; preset names use the same character set. */
export function isValidPresetName(name: string): boolean {
  return isValidIdentityName(name);
}

/** Aggregated view of one env var after decrypting across identities. */
export interface AccessibleKeyEntry {
  /** Decrypted value (first identity wins on conflict). */
  value: string;
  /** Identity that supplied `value`. */
  identityName: string;
  /** All identities that define this key in the target environment. */
  identities: string[];
}

/**
 * Aggregates decrypted key-value pairs across all locally decryptable identities.
 *
 * When a key appears in multiple identities, the first decrypted value wins;
 * all source identities are tracked for conflict warnings.
 *
 * @param env - Target environment (`-e/--env`, default `dev`).
 * @param keystorePath - Optional `--keystore` override.
 * @returns Map from env var name to value and contributing identities.
 */
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

/**
 * Warns on stderr for each preset key not present in `accessibleKeys`.
 *
 * @param presetName - Preset being validated.
 * @param keys - Key names defined in the preset.
 * @param accessibleKeys - Keys available in the current environment.
 * @param env - Environment label included in warning messages.
 * @returns Count of missing keys.
 */
export function warnMissingPresetKeys(
  presetName: string,
  keys: string[],
  accessibleKeys: Map<string, unknown>,
  env: string
): number {
  let missing = 0;
  for (const key of keys) {
    if (!accessibleKeys.has(key)) {
      console.warn(
        `[WARN] Preset '${presetName}': key '${key}' not available for environment '${env}'.`
      );
      missing++;
    }
  }
  return missing;
}

/**
 * Returns a PEM public key for re-encryption, or exits with a clear decrypt-only message.
 *
 * @param projectKeystore - Local keystore for the current project.
 * @param idName - Identity being updated.
 * @returns PEM-encoded RSA public key.
 */
export function requirePublicKeyForEncrypt(
  projectKeystore: KeystoreProjectStore,
  idName: string
): string {
  const publicKey = projectKeystore[idName]?.publicKey;
  if (!publicKey || !senvCrypto.isValidPEM(publicKey, "public")) {
    console.error(
      `Cannot re-encrypt '${idName}': missing or invalid public key in local keystore. ` +
        `'key add' and 'key rm' require a public key; import a full keypair or a public key bundle.`
    );
    process.exit(1);
  }
  return publicKey;
}

/** @param command - Commander subcommand instance. @returns Root `Command` program. */
function getRootCommand(command: any): any {
  let root = command;
  while (root.parent) root = root.parent;
  return root;
}

/**
 * Reads global CLI options from a subcommand's Commander context.
 *
 * @param command - Commander subcommand passed to an `.action()` handler.
 * @returns Resolved `env`, optional `keystorePath`, and whether `-e/--env` was explicit on the CLI.
 */
export function getCommandOptions(command: any): { env: string; keystorePath?: string; envExplicit: boolean } {
  const globalOpts = command.optsWithGlobals?.() ?? {};
  const envSource = getRootCommand(command).getOptionValueSource?.("env");
  return {
    env: globalOpts.env ?? "dev",
    keystorePath: globalOpts.keystore,
    envExplicit: envSource === "cli",
  };
}

/**
 * Decrypts payloads for identities that have a local private key.
 *
 * Identities without a private key or that fail decryption are skipped (warns on stderr).
 *
 * @param env - Environment to filter by when `filterByEnv` is true.
 * @param keystorePath - Optional `--keystore` override.
 * @param filterByEnv - When false, return all environments (used by `key list` without `-e`).
 * @returns Per-identity decrypted payloads.
 */
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
