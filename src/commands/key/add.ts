import { Command } from "commander";
import * as crypto from "../../core/crypto";
import * as store from "../../core/store";

export const keyAddCmd = new Command("add")
  .argument("<ID_NAME>", "Name of the identity")
  .argument("<KEY>", "The key to add or update")
  .argument("<VALUE>", "The plaintext value")
  .description("Adds or updates a key in a specific identity's payload")
  .action(async (idName, targetKey, targetValue, options, command) => {
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const env = globalOpts.env || parentOpts.env || "dev";
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const config = await store.readProjectConfig();
      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (!config.identities[idName]) {
        console.error(`Identity '${idName}' not found in .senv.json.`);
        process.exit(1);
      }

      if (!projectKeystore[idName] || !projectKeystore[idName].privateKey) {
        console.error(`Cannot add to '${idName}': missing private key in local keystore to decrypt existing payload.`);
        process.exit(1);
      }

      const currentEncrypted = config.identities[idName];
      const payload = crypto.decryptPayload(currentEncrypted, projectKeystore[idName].privateKey);
      
      const existingIdx = payload.findIndex((i) => i.key === targetKey && i.environment === env);
      if (existingIdx >= 0) {
        payload[existingIdx].value = targetValue;
        console.log(`Updated '${targetKey}' in '${idName}' for env '${env}'.`);
      } else {
        payload.push({ key: targetKey, value: targetValue, environment: env });
        console.log(`Added '${targetKey}' to '${idName}' for env '${env}'.`);
      }

      const publicKey = projectKeystore[idName].publicKey;
      const newEncrypted = crypto.encryptPayload(payload, publicKey);
      config.identities[idName] = newEncrypted;
      
      await store.writeProjectConfig(config);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
