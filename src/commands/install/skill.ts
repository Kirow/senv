import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import * as store from "../../core/store";
import skillContent from "../../../skill/SKILL.md" with { type: "text" };

const SKILL_REL = path.join(".agents", "skills", "secure-env-tool", "SKILL.md");

export const installSkillCmd = new Command("skill")
  .description("Install the senv agent skill into this project")
  .action(async () => {
    try {
      const projectDir = path.dirname(store.getProjectConfigPath());
      const destPath = path.join(projectDir, SKILL_REL);
      await mkdir(path.dirname(destPath), { recursive: true });
      await store.atomicWriteFile(destPath, skillContent, 0o644);
      console.log(`Installed skill to ${destPath}`);
    } catch (e: any) {
      console.error(e.message);
      process.exit(1);
    }
  });
