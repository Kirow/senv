import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { isValidEnvName, isValidIdentityName, getCommandOptions } from "../utils";

const MAX_VALUE_BYTES = 16 * 1024;

export const keyAddCmd = new Command("add")
  .argument("<ID_NAME>", "Name of the identity")
  .argument("<KEY>", "The key to add or update")
  .argument("<VALUE>", "The plaintext value")
  .description("Adds or updates a key in a specific identity's payload")
  .action(async (idName, targetKey, targetValue, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);

    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }
      if (!isValidEnvName(targetKey)) {
        console.error(`Invalid environment variable name '${targetKey}'. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
        process.exit(1);
      }
      if (Buffer.byteLength(targetValue, "utf8") > MAX_VALUE_BYTES) {
        console.error(`Value exceeds maximum size of ${MAX_VALUE_BYTES} bytes.`);
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

      const currentEncrypted = config.identities[idName];
      const payload = senvCrypto.decryptPayload(currentEncrypted, projectKeystore[idName].privateKey);

      const existingIdx = payload.findIndex((i) => i.key === targetKey && i.environment === env);
      if (existingIdx >= 0) {
        if (payload[existingIdx].value === targetValue) {
          console.log(`'${targetKey}' in '${idName}' for env '${env}' is already up to date.`);
          return;
        }
        payload[existingIdx].value = targetValue;
        console.log(`Updated '${targetKey}' in '${idName}' for env '${env}'.`);
      } else {
        payload.push({ key: targetKey, value: targetValue, environment: env });
        console.log(`Added '${targetKey}' to '${idName}' for env '${env}'.`);
      }

      const publicKey = projectKeystore[idName].publicKey;
      const newEncrypted = senvCrypto.encryptPayload(payload, publicKey);
      config.identities[idName] = newEncrypted;

      await store.writeProjectConfig(config);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
