import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { isValidIdentityName } from "../utils";

export const identityAddCmd = new Command("add")
  .argument("<ID_NAME>", "Name of the identity")
  .description("Generates a keypair and registers a new identity")
  .action(async (idName, options, command) => {
    const keystorePath = command.optsWithGlobals().keystore;
    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      const config = await store.readProjectConfig();
      if (config.identities[idName]) {
        console.error(`Identity '${idName}' already exists in .senv.json.`);
        process.exit(1);
      }

      console.log(`Generating keypair for '${idName}'...`);
      const keypair = senvCrypto.generateRSAKeyPair();

      const projectKeystore = await store.getProjectKeystore(keystorePath);
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
