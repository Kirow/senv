import { Command } from "commander";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type KeystoreProjectStore, type SenvProjectConfig } from "../core/store";
import * as conflict from "../core/conflict";
import { getCommandOptions } from "./utils";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function getGitRoot(startDir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd: startDir, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function resolveDefaultMergeFilePath(): string {
  const projectDir = process.env.SENV_PROJECT_DIR || process.cwd();
  const gitRoot = getGitRoot(projectDir);
  if (gitRoot) {
    return path.join(gitRoot, ".senv.json");
  }
  return store.getProjectConfigPath();
}

export function mergeProjectConfigs(
  configA: SenvProjectConfig,
  configB: SenvProjectConfig,
  projectKeystore: KeystoreProjectStore,
  sourceLabel: string,
  theirsLabel?: string
): SenvProjectConfig {
  const merged = { ...configA, identities: { ...configA.identities } };

  for (const [idName, encryptedB] of Object.entries(configB.identities)) {
    if (!merged.identities[idName]) {
      merged.identities[idName] = encryptedB;
      console.log(`Identity '${idName}' added from ${sourceLabel}.`);
    } else if (merged.identities[idName] !== encryptedB) {
      if (projectKeystore[idName] && projectKeystore[idName].privateKey) {
        const payloadA = senvCrypto.decryptPayload(merged.identities[idName], projectKeystore[idName].privateKey);
        const payloadB = senvCrypto.decryptPayload(encryptedB, projectKeystore[idName].privateKey);

        const mapA = new Map(payloadA.map((i) => [`${i.environment}:${i.key}`, i]));
        for (const itemB of payloadB) {
          mapA.set(`${itemB.environment}:${itemB.key}`, itemB);
        }

        const mergedPayload = Array.from(mapA.values());
        merged.identities[idName] = senvCrypto.encryptPayload(mergedPayload, projectKeystore[idName].publicKey);
        console.log(`Merged payloads for identity '${idName}'.`);
      } else {
        const encryptedOurs = merged.identities[idName];
        const picked = conflict.pickConflictBlobWithoutPrivateKey(
          idName,
          encryptedOurs,
          encryptedB,
          theirsLabel
        );
        merged.identities[idName] = picked;
        if (picked === encryptedB) {
          console.log(`Identity '${idName}' kept incoming version (no private key).`);
        } else {
          console.log(`Identity '${idName}' kept ours version (no private key).`);
        }
      }
    }
  }

  return merged;
}

async function writeMergedConfig(filePath: string, config: SenvProjectConfig): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

export const mergeCmd = new Command("merge")
  .argument("[FILE_A]", "Primary file (default: .senv.json at git root or project dir)")
  .argument("[FILE_B]", "File to merge from (required when FILE_A has no conflict markers)")
  .description("Resolve git merge conflicts in .senv.json or merge FILE_B identities into FILE_A")
  .action(async (fileA, fileB, _options, command) => {
    const { keystorePath } = getCommandOptions(command);
    const targetPath = fileA ?? resolveDefaultMergeFilePath();

    try {
      const contentA = await fs.readFile(targetPath, "utf-8");
      const projectKeystore = await store.getProjectKeystore(keystorePath);

      let configA: SenvProjectConfig;
      let configB: SenvProjectConfig;
      let sourceLabel: string;
      let theirsLabel: string | undefined;

      if (conflict.hasGitConflictMarkers(contentA)) {
        const parsed = conflict.parseGitConflictSenv(contentA);
        configA = parsed.ours;
        configB = parsed.theirs;
        sourceLabel = "incoming";
        theirsLabel = parsed.theirsLabel;
      } else if (fileB) {
        const contentB = await fs.readFile(fileB, "utf-8");
        configA = JSON.parse(contentA) as SenvProjectConfig;
        configB = JSON.parse(contentB) as SenvProjectConfig;
        sourceLabel = fileB;
      } else {
        console.error("Merge failed: no git conflict markers in file and FILE_B was not provided.");
        process.exit(1);
        return;
      }

      const merged = mergeProjectConfigs(configA, configB, projectKeystore, sourceLabel, theirsLabel);
      await writeMergedConfig(targetPath, merged);
      console.log(`Merge complete. Merged into ${targetPath}.`);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        console.error(`Merge failed: file not found: ${targetPath}`);
      } else {
        console.error("Merge failed:", e.message);
      }
      process.exit(1);
    }
  });
