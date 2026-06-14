import { Command } from "commander";
import * as store from "../../core/store";
import * as readline from "node:readline/promises";
import { getCommandOptions, isValidIdentityName } from "../utils";

export const identityRmCmd = new Command("rm")
  .argument("<ID_NAME>", "Name of the identity to remove")
  .option("-y, --yes", "Skip confirmation prompt")
  .description("Removes an identity from .senv.json")
  .action(async (idName, options, command) => {
    const { keystorePath } = getCommandOptions(command);
    try {
      if (!isValidIdentityName(idName)) {
        console.error(`Invalid identity name '${idName}'. Use letters, digits, '.', '_' or '-' only.`);
        process.exit(1);
      }

      const config = await store.readProjectConfig();
      if (!config.identities[idName]) {
        console.error(`Identity '${idName}' not found in .senv.json.`);
        process.exit(1);
      }

      if (!options.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write("Aborted.\n");
          return;
        }
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question(`Are you sure you want to completely remove the identity '${idName}' and all of its secrets? (y/N): `);
        rl.close();
        if (answer.trim().toLowerCase() !== "y") {
          process.stderr.write("Aborted.\n");
          return;
        }
      }

      delete config.identities[idName];
      await store.writeProjectConfig(config);

      const projectKeystore = await store.getProjectKeystore(keystorePath);
      if (projectKeystore[idName]) {
        delete projectKeystore[idName];
        await store.writeProjectKeystore(projectKeystore, keystorePath);
      }

      console.log(`Successfully removed identity '${idName}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
