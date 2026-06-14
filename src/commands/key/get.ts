import { Command } from "commander";
import * as store from "../../core/store";
import { PUBLIC_IDENTITY_LABEL } from "../../core/store";
import { getAccessiblePayloads, getCommandOptions } from "../utils";

export const keyGetCmd = new Command("get")
  .argument("<KEY>", "The key to retrieve")
  .option("-i, --identity <name>", "Pick a specific identity when the key exists in multiple (not used for public keys)")
  .description("Returns the plaintext value for a key (public or decrypted)")
  .action(async (targetKey, options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    const wantedIdentity = options.identity as string | undefined;

    try {
      const config = await store.readProjectConfig();
      const publicItems = store.getPublicItemsForEnv(config, env);
      const publicMatch = publicItems.find((item) => item.key === targetKey);

      if (publicMatch) {
        if (wantedIdentity && wantedIdentity !== PUBLIC_IDENTITY_LABEL) {
          console.error(
            `Key '${targetKey}' is a public value for environment '${env}', not in identity '${wantedIdentity}'.`
          );
          process.exit(1);
        }
        console.log(publicMatch.value);
        return;
      }

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
