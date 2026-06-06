import { Command } from "commander";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvProjectConfig, type SenvPayload } from "../core/store";
import * as fs from "node:fs";
import { getAccessiblePayloads } from "./utils";

export const initCmd = new Command("init")
  .description("Initializes a new .senv.json and creates a local keypair if missing")
  .action(async (options, command) => {
    const keystorePath = command.optsWithGlobals().keystore;
    const projectKeystore = await store.getProjectKeystore(keystorePath);
    const configPath = store.getProjectConfigPath();

    if (fs.existsSync(configPath)) {
      console.log(".senv.json already exists.");
      try {
        const config = await store.readProjectConfig();
        const configIdentities = Object.keys(config.identities);
        const missingKeys = configIdentities.filter(id => !projectKeystore[id]);

        if (missingKeys.length > 0) {
          console.warn("\n[WARNING] The following identities are in .senv.json but are missing from your local keystore:");
          missingKeys.forEach(id => console.warn(`- ${id}`));
          console.warn("You will not be able to decrypt payloads or add new keys to these identities.");
        } else {
          console.log("All identities have matching keys in your local keystore.");
        }

        await reportDuplicateKeys(projectKeystore);
      } catch (err: any) {
        console.error("Failed to read existing project config:", err.message);
      }
      return;
    }

    const rawUser = process.env.USER || process.env.USERNAME || "user";
    const sanitizedUser = rawUser
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "");
    const baseIdentity = sanitizedUser.length > 0 ? sanitizedUser : "user";
    const idName = `${baseIdentity}-local`;

    if (!projectKeystore[idName]) {
      console.log(`Generating new RSA keypair for identity: ${idName}...`);
      const keypair = senvCrypto.generateRSAKeyPair();
      projectKeystore[idName] = keypair;
      await store.writeProjectKeystore(projectKeystore, keystorePath);
    }

    console.log("Creating .senv.json...");
    const config: SenvProjectConfig = {
      version: "1.0",
      identities: {},
    };

    if (config.identities[idName]) {
      console.warn(`Identity '${idName}' already present in config. Skipping re-add.`);
      return;
    }

    const emptyEncrypted = senvCrypto.encryptPayload([], projectKeystore[idName].publicKey);
    config.identities[idName] = emptyEncrypted;
    await store.writeProjectConfig(config);
    console.log(`Initialized successfully. Identity '${idName}' added.`);
  });

async function reportDuplicateKeys(
  projectKeystore: store.KeystoreProjectStore
): Promise<void> {
  const config = await store.readProjectConfig();
  const envs = new Set<string>();

  for (const [idName, encrypted] of Object.entries(config.identities)) {
    const priv = projectKeystore[idName]?.privateKey;
    if (!priv) continue;
    try {
      const decrypted = senvCrypto.decryptPayload(encrypted, priv);
      for (const item of decrypted) envs.add(item.environment);
    } catch {
      // skip undecryptable
    }
  }

  const aggregated: { identityName: string; payload: SenvPayload }[] = [];
  for (const env of envs) {
    const payloads = await getAccessiblePayloads(env);
    aggregated.push(...payloads);
  }

  const seen = new Map<string, string[]>();
  for (const { identityName, payload } of aggregated) {
    for (const item of payload) {
      const k = `${item.environment}:${item.key}`;
      const list = seen.get(k) || [];
      if (!list.includes(identityName)) list.push(identityName);
      seen.set(k, list);
    }
  }

  const duplicates = Array.from(seen.entries()).filter(([, ids]) => ids.length > 1);
  if (duplicates.length === 0) return;

  console.warn("\n[WARNING] Duplicate keys detected across identities:");
  for (const [key, ids] of duplicates) {
    console.warn(`- ${key} defined in: ${ids.join(", ")}`);
  }
}
