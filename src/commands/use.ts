import { Command } from "commander";
import { getAccessiblePayloads, getCommandOptions, isValidEnvName } from "./utils";

function shellEscapeAnsiC(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `$'${escaped}'`;
}

export const useCmd = new Command("use")
  .description("Outputs export statements for standard shell usage: eval $(senv use)")
  .action(async (options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    try {
      const payloads = await getAccessiblePayloads(env, keystorePath);
      const aggregated: Record<string, { value: string; identityName: string; identities: string[] }> = {};
      const lines: string[] = [];

      for (const { identityName, payload } of payloads) {
        for (const item of payload) {
          if (!aggregated[item.key]) {
            aggregated[item.key] = { value: item.value, identityName, identities: [identityName] };
          } else if (!aggregated[item.key].identities.includes(identityName)) {
            aggregated[item.key].identities.push(identityName);
          }
        }
      }

      for (const [key, data] of Object.entries(aggregated)) {
        if (data.identities.length > 1) {
          console.warn(
            `[WARN] Conflict for key '${key}': defined in ${data.identities.length} identities (${data.identities.join(", ")}). Using value from '${data.identityName}'. Pass -i/--identity to disambiguate.`
          );
        }
        if (!isValidEnvName(key)) {
          throw new Error(`Invalid environment variable name '${key}'.`);
        }
        const escaped = shellEscapeAnsiC(data.value);
        lines.push(`export ${key}=${escaped}`);
      }

      process.stdout.write(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
