import { Command } from "commander";
import * as senvCrypto from "../core/crypto";
import * as store from "../core/store";
import { type SenvProjectConfig } from "../core/store";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const mergeCmd = new Command("merge")
  .argument("<FILE_A>", "Primary file")
  .argument("<FILE_B>", "File to merge from")
  .description("Utility to handle git merge conflicts by merging FILE_B identities into FILE_A")
  .action(async (fileA, fileB, options, command) => {
    const keystorePath = command.optsWithGlobals().keystore;
    try {
      const contentA = await fs.readFile(fileA, "utf-8");
      const contentB = await fs.readFile(fileB, "utf-8");
      const configA = JSON.parse(contentA) as SenvProjectConfig;
      const configB = JSON.parse(contentB) as SenvProjectConfig;

      const projectKeystore = await store.getProjectKeystore(keystorePath);

      for (const [idName, encryptedB] of Object.entries(configB.identities)) {
        if (!configA.identities[idName]) {
          configA.identities[idName] = encryptedB;
          console.log(`Identity '${idName}' added from ${fileB}.`);
        } else if (configA.identities[idName] !== encryptedB) {
          if (projectKeystore[idName] && projectKeystore[idName].privateKey) {
            const payloadA = senvCrypto.decryptPayload(configA.identities[idName], projectKeystore[idName].privateKey);
            const payloadB = senvCrypto.decryptPayload(encryptedB, projectKeystore[idName].privateKey);

            const mapA = new Map(payloadA.map(i => [`${i.environment}:${i.key}`, i]));
            for (const itemB of payloadB) {
              mapA.set(`${itemB.environment}:${itemB.key}`, itemB);
            }

            const mergedPayload = Array.from(mapA.values());
            configA.identities[idName] = senvCrypto.encryptPayload(mergedPayload, projectKeystore[idName].publicKey);
            console.log(`Merged payloads for identity '${idName}'.`);
          } else {
            console.warn(`[WARN] Conflict for identity '${idName}' but missing private key. Cannot merge. Keeping ${fileA} version.`);
          }
        }
      }

      const tmpPath = fileA + ".tmp";
      await fs.writeFile(tmpPath, JSON.stringify(configA, null, 2), { encoding: "utf-8", mode: 0o600 });
      await fs.rename(tmpPath, fileA);
      console.log(`Merge complete. Merged into ${fileA}.`);
    } catch (e: any) {
      console.error("Merge failed:", e.message);
      process.exit(1);
    }
  });
