import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { MAX_VALUE_BYTES } from "../core/validation";
import {
  isValidEnvName,
  isValidIdentityName,
  getCommandOptions,
  assertKeyNotInPublic,
  assertKeyNotInEncrypted,
} from "./utils";

export const migrateCmd = new Command("migrate")
  .argument("[ID_NAME]", "Name of the identity (not used with --public)")
  .argument("[ENV_FILE]", "Path to a .env file")
  .option("--public", "Import missing keys into the public section instead of an identity")
  .description("Import missing keys from a .env file into senv storage")
  .action(async (idName, envFilePath, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    const isPublic = Boolean(options.public);

    try {
      let identityName = idName as string | undefined;
      let envPath = envFilePath as string | undefined;

      if (isPublic) {
        if (!envPath && identityName) {
          envPath = identityName;
          identityName = undefined;
        }
        if (identityName) {
          console.error("Identity name must not be provided with --public.");
          process.exit(1);
        }
        if (!envPath) {
          console.error("Usage: senv migrate --public <ENV_FILE>");
          process.exit(1);
        }
      } else if (!identityName || !envPath) {
        console.error("Usage: senv migrate <ID_NAME> <ENV_FILE>");
        process.exit(1);
      }

      const config = await store.readProjectConfig();
      const content = await readFile(envPath, "utf-8");
      const parsed = parseEnv(content);

      if (isPublic) {
        const existingKeys = new Set(
          store.getPublicItemsForEnv(config, env).map((item) => item.key)
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

          try {
            await assertKeyNotInEncrypted(config, env, key, keystorePath);
          } catch (e: any) {
            process.stderr.write(`Skipping '${key}': ${e.message}\n`);
            continue;
          }

          store.upsertPublicItem(config, { key, value, environment: env });
          existingKeys.add(key);
          added.push(key);
        }

        if (added.length > 0) {
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
        return;
      }

      const resolvedIdName = identityName;
      if (!resolvedIdName) {
        console.error("Identity name is required unless --public is set.");
        process.exit(1);
      }

      if (!isValidIdentityName(resolvedIdName)) {
        console.error(`Invalid identity name '${resolvedIdName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      if (!config.identities[resolvedIdName]) {
        console.error(`Identity '${resolvedIdName}' is missing from .senv.json.`);
        process.exit(1);
      }

      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (!projectKeystore[resolvedIdName]) {
        console.error(`Identity '${resolvedIdName}' has no entry in local keystore; cannot add keys.`);
        process.exit(1);
      }

      const identityKeystore = projectKeystore[resolvedIdName]!;
      if (!identityKeystore.privateKey) {
        console.error(`Cannot add to '${resolvedIdName}': missing private key in local keystore to decrypt existing payload.`);
        process.exit(1);
      }

      const currentEncrypted = config.identities[resolvedIdName];
      const payload = senvCrypto.decryptPayload(currentEncrypted, identityKeystore.privateKey);

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

        try {
          assertKeyNotInPublic(config, env, key);
        } catch (e: any) {
          process.stderr.write(`Skipping '${key}': ${e.message}\n`);
          continue;
        }

        payload.push({ key, value, environment: env });
        existingKeys.add(key);
        added.push(key);
      }

      if (added.length > 0) {
        const newEncrypted = senvCrypto.encryptPayload(payload, identityKeystore.publicKey);
        config.identities[resolvedIdName] = newEncrypted;
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
