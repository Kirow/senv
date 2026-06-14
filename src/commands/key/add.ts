import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { MAX_VALUE_BYTES } from "../../core/validation";
import {
  isValidEnvName,
  isValidIdentityName,
  getCommandOptions,
  requirePublicKeyForEncrypt,
  assertKeyNotInPublic,
  assertKeyNotInEncrypted,
} from "../utils";

export const keyAddCmd = new Command("add")
  .argument("[ID_NAME]", "Name of the identity (not used with --public)")
  .argument("[KEY]", "The key to add or update")
  .argument("[VALUE]", "The plaintext value")
  .option("--public", "Store as a project-wide public value (no identity or keystore required)")
  .description("Adds or updates a key in a specific identity's payload, or as a public value with --public")
  .action(async (idName, targetKey, targetValue, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    const isPublic = Boolean(options.public);

    try {
      let actualKey = targetKey;
      let actualValue = targetValue;

      if (isPublic) {
        if (targetValue === undefined && idName) {
          actualKey = idName;
          actualValue = targetKey;
        }
        if (idName && targetValue !== undefined) {
          console.error("Identity name must not be provided with --public.");
          process.exit(1);
        }
        if (!actualKey || actualValue === undefined) {
          console.error("Usage: senv key add --public <KEY> <VALUE>");
          process.exit(1);
        }
      }

      if (!isValidEnvName(actualKey)) {
        console.error(`Invalid environment variable name '${actualKey}'. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
        process.exit(1);
      }
      if (Buffer.byteLength(actualValue, "utf8") > MAX_VALUE_BYTES) {
        console.error(`Value exceeds maximum size of ${MAX_VALUE_BYTES} bytes.`);
        process.exit(1);
      }

      const config = await store.readProjectConfig();

      if (isPublic) {
        await assertKeyNotInEncrypted(config, env, actualKey, keystorePath);

        const idx = store.findPublicItemIndex(config, env, actualKey);
        if (idx >= 0) {
          const existing = config.public![idx]!;
          if (existing.value === actualValue) {
            console.log(`'${actualKey}' as public for env '${env}' is already up to date.`);
            return;
          }
          store.upsertPublicItem(config, { ...existing, key: actualKey, value: actualValue, environment: env });
          console.log(`Updated public '${actualKey}' for env '${env}'.`);
        } else {
          store.upsertPublicItem(config, { key: actualKey, value: actualValue, environment: env });
          console.log(`Added public '${actualKey}' for env '${env}'.`);
        }

        await store.writeProjectConfig(config);
        return;
      }

      if (!idName || idName === "") {
        console.error("Identity name is required unless --public is set.");
        process.exit(1);
      }

      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      if (!isValidEnvName(targetKey)) {
        console.error(`Invalid environment variable name '${targetKey}'. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
        process.exit(1);
      }
      if (targetValue === undefined) {
        console.error("Usage: senv key add <ID_NAME> <KEY> <VALUE>");
        process.exit(1);
      }
      if (Buffer.byteLength(targetValue, "utf8") > MAX_VALUE_BYTES) {
        console.error(`Value exceeds maximum size of ${MAX_VALUE_BYTES} bytes.`);
        process.exit(1);
      }

      assertKeyNotInPublic(config, env, targetKey);

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

      const currentEncrypted = config.identities[idName];
      const payload = senvCrypto.decryptPayload(currentEncrypted, projectKeystore[idName].privateKey);

      const existingIdx = payload.findIndex((i) => i.key === targetKey && i.environment === env);
      if (existingIdx >= 0) {
        const existing = payload[existingIdx]!;
        if (existing.value === targetValue) {
          console.log(`'${targetKey}' in '${idName}' for env '${env}' is already up to date.`);
          return;
        }
        existing.value = targetValue;
        console.log(`Updated '${targetKey}' in '${idName}' for env '${env}'.`);
      } else {
        payload.push({ key: targetKey, value: targetValue, environment: env });
        console.log(`Added '${targetKey}' to '${idName}' for env '${env}'.`);
      }

      const publicKey = requirePublicKeyForEncrypt(projectKeystore, idName);
      const newEncrypted = senvCrypto.encryptPayload(payload, publicKey);
      config.identities[idName] = newEncrypted;

      await store.writeProjectConfig(config);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
