import { Command } from "commander";
import * as store from "../../core/store";
import * as readline from "node:readline/promises";

export const identityRmCmd = new Command("rm")
  .argument("<ID_NAME>", "Name of the identity to remove")
  .option("-y, --yes", "Skip confirmation prompt")
  .description("Removes an identity from .senv.json")
  .action(async (idName, options, command) => {
    const keystorePath = command.optsWithGlobals().keystore;
    try {
      const config = await store.readProjectConfig();
      if (!config.identities[idName]) {
        console.error(`Identity '${idName}' not found in .senv.json.`);
        process.exit(1);
      }

      if (!options.yes) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question(`Are you sure you want to completely remove the identity '${idName}' and all of its secrets? (y/N): `);
        rl.close();
        if (answer.trim().toLowerCase() !== "y") {
          console.log("Aborted.");
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
