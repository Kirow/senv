import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

export const keyGetCmd = new Command("get")
  .argument("<KEY>", "The key to retrieve")
  .description("Returns the decrypted plaintext value for a key")
  .action(async (targetKey, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);

    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      const matches: { value: string; identityName: string }[] = [];

      for (const { identityName, payload } of payloads) {
        const item = payload.find((i) => i.key === targetKey);
        if (item) {
          matches.push({ value: item.value, identityName });
        }
      }

      if (matches.length === 0) {
        console.error(`Key '${targetKey}' not found for environment '${env}'.`);
        process.exit(1);
      }

      if (matches.length > 1) {
        const all = matches.map((m) => m.identityName).join(", ");
        console.warn(
          `[WARN] Conflict for key '${targetKey}': defined in ${matches.length} identities (${all}). Using value from '${matches[0].identityName}'.`
        );
      }

      console.log(matches[0].value);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
