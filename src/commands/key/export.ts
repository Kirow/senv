import { Command } from "commander";
import * as crypto from "../../core/crypto";
import * as store from "../../core/store";

export const keyExportCmd = new Command("export")
  .argument("<ID_NAME>", "Name of the identity")
  .option("--readonly", "Export only the private key for decrypt-only access")
  .description("Exports an identity's keys as a Base64 string")
  .action(async (idName, options, command) => {
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const projectKeystore = await store.getProjectKeystore(keystorePath);
      if (!projectKeystore[idName]) {
        console.error(`Identity '${idName}' not found in local project keystore.`);
        process.exit(1);
      }
      
      const { publicKey, privateKey } = projectKeystore[idName];

      const expPub = options.readonly ? "" : publicKey;
      const expPriv = privateKey;

      const b64 = crypto.encodeKeyPairBase64(idName, expPub, expPriv);
      console.log(b64);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
