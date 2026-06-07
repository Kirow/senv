#!/usr/bin/env bun
import { Command } from "commander";

import { initCmd } from "./commands/init";
import { useCmd } from "./commands/use";
import { mergeCmd } from "./commands/merge";

import { identityListCmd } from "./commands/identity/list";
import { identityAddCmd } from "./commands/identity/add";
import { identityRmCmd } from "./commands/identity/rm";
import { identityExportCmd } from "./commands/identity/export";
import { identityImportCmd } from "./commands/identity/import";

import { keyListCmd } from "./commands/key/list";
import { keyGetCmd } from "./commands/key/get";
import { keyAddCmd } from "./commands/key/add";
import { keyRmCmd } from "./commands/key/rm";

const program = new Command();

program
  .name("senv")
  .description("Secure environment variables manager using hybrid RSA/AES-GCM encryption")
  .version("Secure ENV (senv), 1.0.0");

program.option("-e, --env <env>", "Target environment", "dev");
program.option("-k, --keystore <path>", "Custom path to identity.json keystore");

program.addCommand(initCmd);
program.addCommand(useCmd);
program.addCommand(mergeCmd);

const identityGroup = new Command("identity").description("Manage identities");
identityGroup.addCommand(identityListCmd);
identityGroup.addCommand(identityAddCmd);
identityGroup.addCommand(identityRmCmd);
identityGroup.addCommand(identityExportCmd);
identityGroup.addCommand(identityImportCmd);
program.addCommand(identityGroup);

const keyGroup = new Command("key").description("Manage keys");
keyGroup.addCommand(keyListCmd);
keyGroup.addCommand(keyGetCmd);
keyGroup.addCommand(keyAddCmd);
keyGroup.addCommand(keyRmCmd);
program.addCommand(keyGroup);

program.parse(process.argv);
