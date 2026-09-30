/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function configureBiome({ targetDir, isVSCode, runCmd }) {
  const biomeConfig = {
    $schema: "https://biomejs.dev/schemas/1.9.4/schema.json",
    vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
    formatter: { enabled: true, indentStyle: "space", indentWidth: 2 },
    linter: {
      enabled: true,
      rules: { recommended: true, correctness: { noUnusedVariables: "warn" } },
    },
  };
  biomeConfig.files = {
    ignore: isVSCode
      ? ["out/**", "dist/**", "node_modules/**", ".reports/**"]
      : ["node_modules/**", ".reports/**"],
  };
  writeFileSync(
    join(targetDir, "biome.json"),
    JSON.stringify(biomeConfig, null, 2),
  );

  return {
    dependency: "@biomejs/biome@1.9.4",
    scripts: {
      lint: `${runCmd} @biomejs/biome check .`,
      "lint:fix": `${runCmd} @biomejs/biome check --write .`,
    },
    preCommit: {
      name: "biome-check",
      priority: 2,
      glob: "*.{js,ts,jsx,tsx,json}",
      run: `${runCmd} @biomejs/biome check --write --no-errors-on-unmatched {staged_files}`,
    },
  };
}
