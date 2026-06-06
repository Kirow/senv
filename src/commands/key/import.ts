import { Command } from "commander";
import * as crypto from "../../core/crypto";
import * as store from "../../core/store";

export const keyImportCmd = new Command("import")
  .argument("<BASE64_STRING>", "Base64 encoded keypair")
  .description("Imports a Base64 encoded keypair into the local project keystore")
  .action(async (b64String, options, command) => {
    const parentOpts = command.parent?.optsWithGlobals() || {};
    const globalOpts = command.optsWithGlobals();
    const keystorePath = globalOpts.keystore || parentOpts.keystore;

    try {
      const decoded = crypto.decodeKeyPairBase64(b64String);
      const projectKeystore = await store.getProjectKeystore(keystorePath);
      
      // Merge keys if partial
      const existing = projectKeystore[decoded.idName] || { publicKey: "", privateKey: "" };
      
      projectKeystore[decoded.idName] = { 
        publicKey: decoded.publicKey || existing.publicKey, 
        privateKey: decoded.privateKey || existing.privateKey 
      };
      
      await store.writeProjectKeystore(projectKeystore, keystorePath);
      console.log(`Successfully imported keys for identity '${decoded.idName}'.`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
