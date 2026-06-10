import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

export const keyGetCmd = new Command("get")
  .argument("<KEY>", "The key to retrieve")
  .option("-i, --identity <name>", "Pick a specific identity when the key exists in multiple")
  .description("Returns the decrypted plaintext value for a key")
  .action(async (targetKey, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    const wantedIdentity = options.identity as string | undefined;

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

      if (wantedIdentity) {
        const chosen = matches.find((m) => m.identityName === wantedIdentity);
        if (!chosen) {
          const available = matches.map((m) => m.identityName).join(", ");
          console.error(`Identity '${wantedIdentity}' does not have key '${targetKey}' (available: ${available}).`);
          process.exit(1);
        }
        console.log(chosen.value);
        return;
      }

      if (matches.length > 1) {
        const all = matches.map((m) => m.identityName).join(", ");
        console.warn(
          `[WARN] Conflict for key '${targetKey}': defined in ${matches.length} identities (${all}). Using value from '${matches[0]!.identityName}'. Pass -i/--identity to disambiguate.`
        );
      }

      console.log(matches[0]!.value);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
