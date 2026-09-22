/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prepareSemgrep } from "./semgrep.js";

export async function askQuestions() {
  console.log("🚀 Welcome to the quality standards initializer!\n");
  const rl = createInterface({ input, output });

  const langAns = await rl.question(
    "1. Which language does your project use? (js/ts) [js]: ",
  );
  const isTS = langAns.trim().toLowerCase() === "ts";

  const runtimeAns = await rl.question(
    "2. Which runtime do you use? (node/bun) [node]: ",
  );
  const isBun = runtimeAns.toLowerCase() === "bun";

  console.log("\n3. Select the project type:");
  console.log("   1) Standard application / Library (default)");
  console.log("   2) VS Code extension");
  const typeAns = await rl.question("Enter a number: ");
  const isVSCode = typeAns === "2";

  const semgrepAns = await rl.question(
    "\n4. Configure security checks with Semgrep? (y/n) [n]: ",
  );
  const useSemgrep =
    semgrepAns.trim().toLowerCase() === "y" && (await prepareSemgrep(rl));

  const licenseAns = await rl.question(
    "\n5. Automatically add a license header at the top of source files? (y/n) [y]: ",
  );
  let licenseType = "";
  let copyrightHolder = "";
  if (licenseAns.toLowerCase() !== "n") {
    licenseType =
      (
        await rl.question(
          "   Enter the license type (mit / apache / proprietary) [mit]: ",
        )
      )
        .trim()
        .toLowerCase() || "mit";
    copyrightHolder = await rl.question(
      "   Enter the copyright holder (Name / Company): ",
    );
  }

  console.log("\n6. Install the quality-checking skill for your coding agents:");
  console.log("   1) Codex");
  console.log("   2) Claude Code");
  console.log("   3) Both (default)");
  console.log("   4) Skip");
  let agentAns;
  do {
    agentAns = (await rl.question("Enter a number [3]: ")).trim() || "3";
    if (!["1", "2", "3", "4"].includes(agentAns))
      console.log("Please choose 1, 2, 3 or 4.");
  } while (!["1", "2", "3", "4"].includes(agentAns));
  const agentTargets = [["codex"], ["claude"], ["codex", "claude"], []][
    Number(agentAns) - 1
  ];

  rl.close();
  return {
    isTS,
    isBun,
    isVSCode,
    useSemgrep,
    licenseType,
    copyrightHolder,
    agentTargets,
  };
}
