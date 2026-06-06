import { Command } from "commander";
import { getAccessiblePayloads } from "../utils";

export const keyGetCmd = new Command("get")
  .argument("<KEY>", "The key to retrieve")
  .description("Returns the decrypted plaintext value for a key")
  .action(async (targetKey, options, command) => {
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const env = globalOpts.env || parentOpts.env || "dev";
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      let foundValue: string | null = null;
      let foundIdentity: string | null = null;

      for (const { identityName, payload } of payloads) {
        const item = payload.find((i) => i.key === targetKey);
        if (item) {
          if (foundValue !== null) {
            console.warn(
              `[WARN] Conflict for key '${targetKey}': defined in '${foundIdentity}' and '${identityName}'. Using value from '${foundIdentity}'.`
            );
          } else {
            foundValue = item.value;
            foundIdentity = identityName;
          }
        }
      }

      if (foundValue !== null) {
        console.log(foundValue);
      } else {
        console.error(`Key '${targetKey}' not found for environment '${env}'.`);
        process.exit(1);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
