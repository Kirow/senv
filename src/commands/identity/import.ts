import { Command } from "commander";
import * as senvCrypto from "../../core/crypto";
import * as store from "../../core/store";
import { getCommandOptions } from "../utils";
import * as readline from "node:readline/promises";

export const identityImportCmd = new Command("import")
  .argument("<BASE64_STRING>", "Base64 encoded keypair")
  .option("-y, --yes", "Skip overwrite confirmation prompt")
  .description("Imports a Base64 encoded keypair into the local project keystore")
  .action(async (b64String, options, command) => {
    const { keystorePath } = getCommandOptions(command);

    try {
      const decoded = senvCrypto.decodeKeyPairBase64(b64String);

      if (decoded.publicKey && !senvCrypto.isValidPEM(decoded.publicKey, "public")) {
        throw new Error("Imported public key is not a valid PEM-formatted RSA public key.");
      }
      if (decoded.privateKey && !senvCrypto.isValidPEM(decoded.privateKey, "private")) {
        throw new Error("Imported private key is not a valid PEM-formatted RSA private key.");
      }

      const projectKeystore = await store.getProjectKeystore(keystorePath);

      if (projectKeystore[decoded.idName] && !options.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write("Aborted.\n");
          return;
        }
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await rl.question(
          `Identity '${decoded.idName}' already exists in the local keystore. Overwrite? (y/N): `
        );
        rl.close();
        if (answer.trim().toLowerCase() !== "y") {
          process.stderr.write("Aborted.\n");
          return;
        }
      }

      const existing = projectKeystore[decoded.idName] || { publicKey: "", privateKey: "" };

      projectKeystore[decoded.idName] = {
        publicKey: decoded.publicKey || existing.publicKey,
        privateKey: decoded.privateKey || existing.privateKey,
      };

      await store.writeProjectKeystore(projectKeystore, keystorePath);
      console.log(`Successfully imported keys for identity '${decoded.idName}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
