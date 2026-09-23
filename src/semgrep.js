/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCommandAvailable, runCommand } from "./commands.js";

export async function prepareSemgrep(rl) {
  if (process.platform === "win32") {
    console.log(
      "   Semgrep on Windows is beta. Prepare Python 3.10+, pipx and their PATH entries, and set PYTHONUTF8=1 before running scans. See https://docs.semgrep.dev/getting-started/quickstart. The kit does not change system settings.",
    );
  }
  if (isCommandAvailable("semgrep")) return true;

  const installAns = await rl.question(
    "   Semgrep CLI is unavailable. Install it with pipx now? (y/n) [n]: ",
  );
  if (installAns.trim().toLowerCase() !== "y") {
    console.warn(
      "⚠️  Installation skipped. Continuing without Semgrep security checks.",
    );
    return false;
  }

  if (!isCommandAvailable("pipx")) {
    console.warn(
      "⚠️  pipx is unavailable. Install it using https://pipx.pypa.io/latest/how-to/install-pipx.html, then run `pipx install semgrep` and rerun the initializer. Continuing without Semgrep security checks.",
    );
    return false;
  }

  try {
    runCommand("pipx", ["install", "semgrep"]);
  } catch (error) {
    console.warn(
      `⚠️  Semgrep installation failed: ${error.message} Continuing without Semgrep security checks.`,
    );
    return false;
  }

  if (!isCommandAvailable("semgrep")) {
    console.warn(
      "⚠️  Semgrep is still unavailable after installation. Run `pipx ensurepath`, open a new terminal, and rerun the initializer. Continuing without Semgrep security checks.",
    );
    return false;
  }

  return true;
}

export function configureSemgrep({ targetDir, templatesDir }) {
  const ignoreSrc = join(templatesDir, ".semgrepignore");
  if (existsSync(ignoreSrc))
    cpSync(ignoreSrc, join(targetDir, ".semgrepignore"));
  else
    writeFileSync(
      join(targetDir, ".semgrepignore"),
      "node_modules/\ndist/\nout/\n",
    );

  const check = "semgrep scan --config=p/default --error";
  return {
    scripts: { "security-check": check },
    report: 'semgrep scan --config=p/default --json -o .reports/security-report.json || node -e "process.exit(0)"',
    prePush: { name: "security-scan", run: check },
  };
}
