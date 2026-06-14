import { Command } from "commander";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvProjectConfig, type SenvPayload, CURRENT_PROJECT_CONFIG_VERSION } from "../core/store";
import * as fs from "node:fs/promises";
import { isValidIdentityName, getCommandOptions } from "./utils";

export const initCmd = new Command("init")
  .description("Initializes a new .senv.json and creates a local keypair if missing")
  .argument("[ID_NAME]", "Optional identity name (default: derived from $USER)")
  .action(async (idNameArg: string | undefined, _options, command) => {
    const { keystorePath } = getCommandOptions(command);
    const projectKeystore = await store.getProjectKeystore(keystorePath);
    const configPath = await store.getProjectConfigPath();

    let configExists = false;
    try {
      await fs.access(configPath);
      configExists = true;
    } catch {
      configExists = false;
    }

    if (configExists) {
      console.log(".senv.json already exists.");
      try {
        const config = await store.readProjectConfig();
        const configIdentities = Object.keys(config.identities);
        const missingKeys = configIdentities.filter(id => !projectKeystore[id]);

        if (missingKeys.length > 0) {
          console.warn("\n[WARNING] The following identities are in .senv.json but are missing from your local keystore:");
          missingKeys.forEach(id => console.warn(`- ${id}`));
          console.warn("You will not be able to decrypt payloads or add new keys to these identities.");
          console.warn("Duplicate-key report will only cover identities you can decrypt.\n");
        } else {
          console.log("All identities have matching keys in your local keystore.");
        }

        reportDuplicateKeys(config, projectKeystore);
      } catch (err: any) {
        console.error("Failed to read existing project config:", err.message);
        process.exit(1);
      }
      return;
    }

    try {
      let idName: string;
      if (idNameArg !== undefined && idNameArg !== "") {
        if (!isValidIdentityName(idNameArg)) {
          console.error(`Invalid identity name '${idNameArg}'. Use letters, digits, '.', '_' or '-' only.`);
          process.exit(1);
        }
        idName = idNameArg;
      } else {
        const rawUser = process.env.USER || process.env.USERNAME || "user";
        const sanitizedUser = rawUser
          .replace(/[^A-Za-z0-9._-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^[.-]+|[.-]+$/g, "");
        const baseIdentity = sanitizedUser.length > 0 ? sanitizedUser : "user";
        idName = `${baseIdentity}-local`;
      }

      let keypair = projectKeystore[idName];
      if (!keypair) {
        console.log(`Generating new RSA keypair for identity: ${idName}...`);
        keypair = senvCrypto.generateRSAKeyPair();
        projectKeystore[idName] = keypair;
        await store.writeProjectKeystore(projectKeystore, keystorePath);
      }

      console.log("Creating .senv.json...");
      const config: SenvProjectConfig = {
        version: CURRENT_PROJECT_CONFIG_VERSION,
        identities: {},
      };

      const emptyEncrypted = senvCrypto.encryptPayload([], keypair.publicKey);
      config.identities[idName] = emptyEncrypted;
      await store.writeProjectConfig(config);
      console.log(`Initialized successfully. Identity '${idName}' added.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });

/**
 * Warns when the same `environment:key` pair is defined in more than one locally decryptable identity.
 *
 * @param config - Project config with encrypted identity blobs.
 * @param projectKeystore - Local keystore used to decrypt payloads for comparison.
 */
function reportDuplicateKeys(
  config: store.SenvProjectConfig,
  projectKeystore: store.KeystoreProjectStore
): void {
  const grouped = new Map<string, Map<string, { identities: Set<string> }>>();

  for (const [idName, encrypted] of Object.entries(config.identities)) {
    const priv = projectKeystore[idName]?.privateKey;
    if (!priv) continue;
    let decrypted: SenvPayload;
    try {
      decrypted = senvCrypto.decryptPayload(encrypted, priv);
    } catch (e: any) {
      console.warn(`[WARN] Failed to decrypt identity '${idName}': ${e.message}`);
      continue;
    }
    for (const item of decrypted) {
      if (!grouped.has(item.environment)) grouped.set(item.environment, new Map());
      const envMap = grouped.get(item.environment)!;
      const existing = envMap.get(item.key);
      if (existing) {
        existing.identities.add(idName);
      } else {
        envMap.set(item.key, { identities: new Set([idName]) });
      }
    }
  }

  if (grouped.size === 0) return;

  const duplicates: { env: string; key: string; identities: string[] }[] = [];
  for (const [env, envMap] of grouped.entries()) {
    for (const [k, { identities }] of envMap.entries()) {
      if (identities.size > 1) {
        duplicates.push({ env, key: k, identities: Array.from(identities) });
      }
    }
  }

  if (duplicates.length === 0) return;

  console.warn("\n[WARNING] Duplicate keys detected across identities:");
  for (const d of duplicates) {
    console.warn(`- ${d.env}:${d.key} defined in: ${d.identities.join(", ")}`);
  }
}
