import { Command } from "commander";
import * as store from "../core/store";
import {
  getAccessibleKeyMap,
  getCommandOptions,
  isValidEnvName,
  warnMissingPresetKeys,
} from "./utils";

/**
 * Shell-escapes a secret value using ANSI-C quoting (`$'...'`).
 *
 * Backslash is escaped first so later control-char inserts are not double-escaped.
 *
 * @param value - Raw secret string.
 * @returns Shell-safe quoted string for `export KEY=...`.
 */
function shellEscapeAnsiC(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `$'${escaped}'`;
}

/**
 * Appends a shell `export` line for `key`, warning when multiple identities define it.
 *
 * @param key - Environment variable name.
 * @param data - Decrypted value and contributing identities.
 * @param lines - Output buffer mutated in place.
 * @throws When `key` is not a valid env var name.
 */
function exportKey(
  key: string,
  data: { value: string; identityName: string; identities: string[] },
  lines: string[]
): void {
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

export const useCmd = new Command("use")
  .argument("[PRESET_NAME]", "Optional preset name to export a subset of keys")
  .description("Outputs export statements for standard shell usage: eval $(senv use)")
  .action(async (presetName: string | undefined, _options, command) => {
    const { env, keystorePath } = getCommandOptions(command);
    try {
      const accessible = await getAccessibleKeyMap(env, keystorePath);
      const lines: string[] = [];

      if (presetName) {
        const config = await store.readProjectConfig();
        const presetKeys = config.presets?.[presetName];

        if (!presetKeys) {
          console.error(`Preset '${presetName}' not found.`);
          process.exit(1);
        }

        warnMissingPresetKeys(presetName, presetKeys, accessible, env);

        for (const key of presetKeys) {
          const data = accessible.get(key);
          if (data) {
            exportKey(key, data, lines);
          }
        }
      } else {
        for (const [key, data] of accessible.entries()) {
          exportKey(key, data, lines);
        }
      }

      process.stdout.write(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
