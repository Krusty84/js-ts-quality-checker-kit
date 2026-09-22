/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./commands.js";

export const lefthookDependency = "lefthook@1.10.10";

function formatCommand({ name, priority, glob, run }) {
  let yaml = `\n    ${name}:`;
  if (priority) yaml += `\n      priority: ${priority}`;
  if (glob) yaml += `\n      glob: "${glob}"`;
  yaml += `\n      run: ${run}`;
  return yaml;
}

export function configureLefthook({ targetDir, preCommit, prePush }) {
  let lefthookYaml = `pre-commit:\n  parallel: false\n  commands:`;
  lefthookYaml += preCommit.map(formatCommand).join("");
  lefthookYaml += `\n\npre-push:\n  commands:`;
  lefthookYaml += prePush.map(formatCommand).join("");
  writeFileSync(join(targetDir, "lefthook.yml"), lefthookYaml);
}

export function installLefthook(runCmd) {
  runCommand(runCmd, ["lefthook", "install"]);
}
