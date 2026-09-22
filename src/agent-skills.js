/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function configureAgentSkills({
  targetDir,
  templatesDir,
  agentTargets,
  isBun,
}) {
  if (agentTargets.length === 0) return;

  const skillPath = join("skills", "js-ts-quality-checks", "SKILL.md");
  const content = readFileSync(join(templatesDir, skillPath), "utf8")
    .replaceAll("{{run}}", isBun ? "bun run" : "npm run");
  const locations = { codex: ".agents", claude: ".claude" };

  for (const agent of agentTargets) {
    const relativePath = join(locations[agent], skillPath);
    const targetPath = join(targetDir, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      writeFileSync(targetPath, content, { flag: "wx" });
      console.log(`Installed agent skill: ${relativePath}`);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.warn(`Skipping existing agent skill: ${relativePath}`);
    }
  }
}
