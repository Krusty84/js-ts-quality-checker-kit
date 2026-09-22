#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configureBiome } from "./src/biome.js";
import { runCommand } from "./src/commands.js";
import { configureKnip, parseKnipReport } from "./src/knip.js";
import {
  configureLefthook,
  installLefthook,
  lefthookDependency,
} from "./src/lefthook.js";
import {
  configureLicenseHeader,
  licenseHeaderPreCommit,
  licenseHeaderScripts,
  validateLicenseType,
} from "./src/license-header.js";
import { askQuestions } from "./src/questions.js";
import { configureSemgrep } from "./src/semgrep.js";
import { getTypeScriptCommands } from "./src/typescript.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const kit = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
const [, , argCommand] = process.argv;

function generateConfig({
  isTS,
  isBun,
  isVSCode,
  useSemgrep,
  licenseType,
  copyrightHolder,
}) {
  const targetDir = process.cwd();
  const packageJsonPath = join(targetDir, "package.json");
  const templatesDir = join(__dirname, "templates");

  if (!existsSync(packageJsonPath)) {
    console.error(
      "❌ Error: package.json not found. Run `npm init` or `bun init` first.",
    );
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  validateLicenseType(licenseType);
  console.log("\n⚙️  Generating configuration files...");
  const runCmd = isBun ? "bunx" : "npx";
  const hasLicenseHeader = licenseType && copyrightHolder;

  const biome = configureBiome({ targetDir, isVSCode, runCmd });
  const knip = configureKnip({ targetDir, isTS, isVSCode, runCmd });
  const semgrep = useSemgrep
    ? configureSemgrep({ targetDir, templatesDir })
    : null;
  const typescript = getTypeScriptCommands({ isBun });

  const preCommit = [];
  if (hasLicenseHeader) preCommit.push(licenseHeaderPreCommit);
  preCommit.push(biome.preCommit);
  const prePush = [];
  if (isTS) prePush.push(typescript.prePush);
  prePush.push(knip.prePush);
  if (semgrep) prePush.push(semgrep.prePush);
  configureLefthook({ targetDir, preCommit, prePush });

  if (!pkg.scripts) pkg.scripts = {};
  Object.assign(pkg.scripts, biome.scripts, knip.scripts);
  if (semgrep) Object.assign(pkg.scripts, semgrep.scripts);
  if (hasLicenseHeader) {
    pkg.licenseHeader = configureLicenseHeader({
      targetDir,
      templatesDir,
      licenseType,
      copyrightHolder,
    });
    Object.assign(pkg.scripts, licenseHeaderScripts);
  }

  const validateParts = [];
  if (hasLicenseHeader) validateParts.push(pkg.scripts["license:fix"]);
  validateParts.push(pkg.scripts["lint"]);
  if (isTS) validateParts.push(typescript.validate);
  validateParts.push(pkg.scripts["dead-code"]);
  if (semgrep) validateParts.push(pkg.scripts["security-check"]);
  pkg.scripts["validate"] = validateParts.join(" && ");

  const mkdirCmd = isBun
    ? "mkdir -p .reports"
    : "node -e \"const fs = require('fs'); if (!fs.existsSync('.reports')) fs.mkdirSync('.reports')\"";
  const reportParts = [mkdirCmd];
  if (hasLicenseHeader)
    reportParts.push(`${pkg.scripts["license:fix"]} || true`);
  reportParts.push(biome.report, knip.report);
  if (semgrep) reportParts.push(semgrep.report);
  reportParts.push(`${runCmd} ${kit.name}@${kit.version} parse-report`);
  pkg.scripts["report"] = reportParts.join(" && ");

  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2));

  console.log("\n📦 Installing devDependencies in your project...");
  const devDeps = [
    biome.dependency,
    knip.dependency,
    lefthookDependency,
    typescript.dependency,
  ];
  const installCmd = isBun ? "bun" : "npm";
  const installArgs = isBun
    ? ["add", "-d", "--exact", ...devDeps]
    : ["install", "-D", "--save-exact", ...devDeps];
  runCommand(installCmd, installArgs);

  installLefthook(runCmd);
  console.log("\n🎉 Setup completed successfully!");
}

if (argCommand === "parse-report") {
  parseKnipReport();
} else {
  askQuestions().then(generateConfig).catch((err) => {
    console.error("An error occurred:", err);
    process.exit(1);
  });
}
