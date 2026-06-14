import { Command } from "commander";
import * as readline from "node:readline/promises";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { type SenvProjectConfig, CURRENT_PROJECT_CONFIG_VERSION } from "../../core/store";
import { isValidIdentityName, getCommandOptions } from "../utils";

export const identityAddCmd = new Command("add")
  .argument("<ID_NAME>", "Name of the identity")
  .option("-y, --yes", "Skip overwrite confirmation prompt")
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

      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (projectKeystore[idName] && !options.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write("Aborted.\n");
          return;
        }
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question(
          `Identity '${idName}' already exists in the local keystore. Overwrite? (y/N): `
        );
        rl.close();
        if (answer.trim().toLowerCase() !== "y") {
          process.stderr.write("Aborted.\n");
          return;
        }
      }

      console.log(`Generating keypair for '${idName}'...`);
      const keypair = senvCrypto.generateRSAKeyPair();

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
