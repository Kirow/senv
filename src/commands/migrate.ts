import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { isValidEnvName, isValidIdentityName, getCommandOptions } from "./utils";

const MAX_VALUE_BYTES = 16 * 1024;

export const migrateCmd = new Command("migrate")
  .argument("<ID_NAME>", "Name of the identity")
  .argument("<ENV_FILE>", "Path to a .env file")
  .description("Import missing keys from a .env file into senv storage")
  .action(async (idName, envFilePath, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);

    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      const config = await store.readProjectConfig();
      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (!config.identities[idName]) {
        console.error(`Identity '${idName}' is missing from .senv.json.`);
        process.exit(1);
      }

      if (!projectKeystore[idName]) {
        console.error(`Identity '${idName}' has no entry in local keystore; cannot add keys.`);
        process.exit(1);
      }

      if (!projectKeystore[idName].privateKey) {
        console.error(`Cannot add to '${idName}': missing private key in local keystore to decrypt existing payload.`);
        process.exit(1);
      }

      const content = await readFile(envFilePath, "utf-8");
      const parsed = parseEnv(content);

      const currentEncrypted = config.identities[idName];
      const payload = senvCrypto.decryptPayload(currentEncrypted, projectKeystore[idName].privateKey);

      const existingKeys = new Set(
        payload.filter((item) => item.environment === env).map((item) => item.key)
      );

      const added: string[] = [];
      const skipped: string[] = [];

      for (const key of Object.keys(parsed).sort()) {
        const value = parsed[key]!;

        if (!isValidEnvName(key)) {
          process.stderr.write(`Skipping invalid environment variable name '${key}'.\n`);
          continue;
        }

        if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) {
          process.stderr.write(`Skipping '${key}': value exceeds maximum size of ${MAX_VALUE_BYTES} bytes.\n`);
          continue;
        }

        if (existingKeys.has(key)) {
          skipped.push(key);
          continue;
        }

        payload.push({ key, value, environment: env });
        existingKeys.add(key);
        added.push(key);
      }

      if (added.length > 0) {
        const publicKey = projectKeystore[idName].publicKey;
        const newEncrypted = senvCrypto.encryptPayload(payload, publicKey);
        config.identities[idName] = newEncrypted;
        await store.writeProjectConfig(config);
      }

      console.log("Added:");
      for (const key of added) {
        console.log(`- ${key}`);
      }

      console.log("Skipped:");
      for (const key of skipped) {
        console.log(`- ${key}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
