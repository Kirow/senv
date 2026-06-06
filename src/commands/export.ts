import { Command } from "commander";
import { getAccessiblePayloads } from "./utils";

function shellEscapeSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isValidEnvName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export const exportCmd = new Command("export")
  .description("Outputs export statements for standard shell usage: eval $(senv export)")
  .action(async (options, command) => {
    const env = command.optsWithGlobals().env;
    const keystorePath = command.optsWithGlobals().keystore;
    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      const aggregated: Record<string, { value: string; identityName: string }> = {};

      for (const { identityName, payload } of payloads) {
        for (const item of payload) {
          if (!aggregated[item.key]) {
            aggregated[item.key] = { value: item.value, identityName };
          }
        }
      }

      for (const [key, data] of Object.entries(aggregated)) {
        if (!isValidEnvName(key)) {
          throw new Error(`Invalid environment variable name '${key}'.`);
        }
        const escaped = shellEscapeSingleQuoted(data.value);
        console.log(`export ${key}=${escaped}`);
      }
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
