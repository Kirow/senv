import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { type SenvProjectConfig, CURRENT_PROJECT_CONFIG_VERSION } from "../../core/store";
import { isValidIdentityName, getCommandOptions } from "../utils";

export const identityAddCmd = new Command("add")
  .argument("<ID_NAME>", "Name of the identity")
  .description("Generates a keypair and registers a new identity")
  .action(async (idName, options, command) => {
    const { keystorePath } = getCommandOptions(command);
    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      let config: SenvProjectConfig;
      try {
        config = await store.readProjectConfig();
      } catch (e: any) {
        if (e.message.includes(".senv.json not found")) {
          config = {
            version: CURRENT_PROJECT_CONFIG_VERSION,
            identities: {},
          };
        } else {
          throw e;
        }
      }
      if (config.identities[idName]) {
        console.error(`Identity '${idName}' already exists in .senv.json.`);
        process.exit(1);
      }

      console.log(`Generating keypair for '${idName}'...`);
      const keypair = senvCrypto.generateRSAKeyPair();

      const projectKeystore = await store.getProjectKeystore(keystorePath);
      if (projectKeystore[idName]) {
        process.stderr.write(`Identity '${idName}' already exists in local keystore; overwriting with new keypair.\n`);
      }
      projectKeystore[idName] = keypair;
      await store.writeProjectKeystore(projectKeystore, keystorePath);

      const emptyEncrypted = senvCrypto.encryptPayload([], keypair.publicKey);
      config.identities[idName] = emptyEncrypted;
      await store.writeProjectConfig(config);

      console.log(`Successfully added identity '${idName}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
