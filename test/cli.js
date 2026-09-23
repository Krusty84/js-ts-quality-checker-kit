/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

export const cli = fileURLToPath(new URL("../main.js", import.meta.url));
export const systemPath =
  Object.entries(process.env).find(
    ([key]) => key.toLowerCase() === "path",
  )?.[1] ?? "";

export function pathEnv(paths, env = process.env) {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
    ),
    PATH: paths.join(delimiter),
  };
}

export function commandPath(bin, command) {
  return join(bin, process.platform === "win32" ? `${command}.cmd` : command);
}

export function writeCommand(bin, command, source) {
  writeFileSync(join(bin, `${command}.cjs`), source);
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const wrapper =
    process.platform === "win32"
      ? `@"${process.execPath}" "%~dp0${command}.cjs" %*\r\n`
      : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(bin, `${command}.cjs`))} "$@"\n`;
  writeFileSync(commandPath(bin, command), wrapper, { mode: 0o755 });
}

export function runNpm(args, options = {}) {
  assert.ok(
    process.env.npm_execpath,
    "Run these checks through npm test or npm run test:smoke.",
  );
  return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: "utf8",
    ...options,
  });
}

export function packKit(t) {
  const packedDir = mkdtempSync(join(tmpdir(), "quality kit пакет-"));
  t.after(() =>
    rmSync(packedDir, { recursive: true, force: true, maxRetries: 5 }),
  );
  const packed = runNpm(
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--offline",
      "--cache",
      join(packedDir, "cache"),
      "--pack-destination",
      packedDir,
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [archive] = JSON.parse(packed.stdout);
  const unpacked = spawnSync(
    "tar",
    ["-xzf", join(packedDir, archive.filename), "-C", packedDir],
    {
      encoding: "utf8",
    },
  );
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const packedRoot = join(packedDir, "package");
  // Use the tested dependency versions and the cache populated by npm ci.
  copyFileSync(
    new URL("../package-lock.json", import.meta.url),
    join(packedRoot, "package-lock.json"),
  );
  const installed = runNpm(
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: packedRoot },
  );
  assert.equal(installed.status, 0, installed.stderr);
  return packedRoot;
}

export function useLocalReportParser(pkg, entrypoint) {
  const publishedParser =
    /(?:npx|bunx) js-ts-quality-checker-kit@[^ ]+ parse-report$/;
  assert.match(pkg.scripts.report, publishedParser);
  pkg.scripts.report = pkg.scripts.report.replace(
    publishedParser,
    () => `node "${entrypoint.replaceAll("\\", "/")}" parse-report`,
  );
}

export function initialize(
  project,
  answers = ["js", "node", "application", "n", "n"],
  entrypoint = cli,
  agentAnswers = [""],
  timeoutMs = 10000,
) {
  const [language, runtime, projectType, semgrep, license, ...details] =
    answers;
  const down = "\u001b[B";
  const select = (options, value) =>
    down.repeat(Math.max(0, options.indexOf(value))) + "\r";
  const steps = [
    ["Which language does your project use?", select(["js", "ts"], language)],
    ["Which runtime do you use?", select(["node", "bun"], runtime)],
    [
      "Select your project type.",
      select(["application", "library", "vscode"], projectType),
    ],
    ["Configure security checks with Semgrep?", `${semgrep}\r`],
    ["Automatically add license headers to source files?", `${license}\r`],
  ];
  if (license !== "n") {
    steps.push(
      [
        "Select a license.",
        select(["mit", "apache", "proprietary"], details.shift()),
      ],
      [
        "Enter the copyright holder (Name / Company).",
        `${details.shift() ?? ""}\r`,
      ],
    );
  }
  const agentKeys = {
    "": "\r",
    1: `${down} \r`,
    2: " \r",
    3: "\r",
    4: ` ${down} \r`,
  };
  steps.push([
    "Select coding agents for the quality-checking skill.",
    agentKeys[agentAnswers[0]],
  ]);
  if (details.length) {
    steps.push([
      "Semgrep CLI is unavailable. Install it with pipx now?",
      `${details[0]}\r`,
    ]);
  }
  return interact(project, steps, entrypoint, timeoutMs);
}

export function interact(project, steps, entrypoint = cli, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const preload = new URL("./tty.js", import.meta.url).href;
    const child = spawn(
      process.execPath,
      ["--import", preload, entrypoint],
      project,
    );
    let stdout = "";
    let stderr = "";
    let pending = "";
    let index = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Initializer timed out: ${stdout}\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      stdout += data;
      pending += data;
      if (
        index < steps.length &&
        stripVTControlCharacters(pending).includes(steps[index][0])
      ) {
        child.stdin.write(steps[index++][1]);
        if (index === steps.length) child.stdin.end();
        pending = "";
      }
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({
        status,
        stdout: stripVTControlCharacters(stdout),
        stderr: stripVTControlCharacters(stderr),
      });
    });
  });
}
