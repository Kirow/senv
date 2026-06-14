import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { isValidIdentityName, getCommandOptions, requirePublicKeyForEncrypt } from "../utils";

export const keyRmCmd = new Command("rm")
  .argument("<ID_NAME>", "Name of the identity")
  .argument("<KEY>", "The key to remove")
  .description("Removes a key from a specific identity's payload")
  .action(async (idName, targetKey, options, command) => {
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
        console.error(`Identity '${idName}' has no entry in local keystore.`);
        process.exit(1);
      }

      if (!projectKeystore[idName].privateKey) {
        console.error(`Identity '${idName}' is missing private key in local keystore.`);
        process.exit(1);
      }

      const payload = senvCrypto.decryptPayload(config.identities[idName], projectKeystore[idName].privateKey);
      const filtered = payload.filter((i) => !(i.key === targetKey && i.environment === env));

      if (filtered.length === payload.length) {
        console.log(`Key '${targetKey}' not found in '${idName}' for env '${env}'.`);
        return;
      }

      const publicKey = requirePublicKeyForEncrypt(projectKeystore, idName);
      const newEncrypted = senvCrypto.encryptPayload(filtered, publicKey);
      config.identities[idName] = newEncrypted;

      await store.writeProjectConfig(config);
      console.log(`Removed '${targetKey}' from '${idName}' for env '${env}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
