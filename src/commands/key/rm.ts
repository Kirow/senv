import { Command } from "commander";
import * as crypto from "../../core/crypto";
import * as store from "../../core/store";

export const keyRmCmd = new Command("rm")
  .argument("<ID_NAME>", "Name of the identity")
  .argument("<KEY>", "The key to remove")
  .description("Removes a key from a specific identity's payload")
  .action(async (idName, targetKey, options, command) => {
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const env = globalOpts.env || parentOpts.env || "dev";
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const config = await store.readProjectConfig();
      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (!config.identities[idName] || !projectKeystore[idName] || !projectKeystore[idName].privateKey) {
        console.error(`Cannot remove from '${idName}': missing identity or private key.`);
        process.exit(1);
      }

      const payload = crypto.decryptPayload(config.identities[idName], projectKeystore[idName].privateKey);
      const filtered = payload.filter((i) => !(i.key === targetKey && i.environment === env));

      if (filtered.length === payload.length) {
        console.log(`Key '${targetKey}' not found in '${idName}' for env '${env}'.`);
        return;
      }

      const newEncrypted = crypto.encryptPayload(filtered, projectKeystore[idName].publicKey);
      config.identities[idName] = newEncrypted;
      
      await store.writeProjectConfig(config);
      console.log(`Removed '${targetKey}' from '${idName}' for env '${env}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
