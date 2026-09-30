/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configureSemgrep, prepareSemgrep } from "../src/semgrep.js";
import { cli, runNpm } from "./cli.js";

test("native Semgrep scans UTF-8 sources with a local rule", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "semgrep smoke проверка-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 5 }));
  assert.equal(
    await prepareSemgrep(async () => {
      throw new Error("Install Semgrep before running this smoke test");
    }),
    true,
  );
  const configured = configureSemgrep({
    targetDir: cwd,
    templatesDir: fileURLToPath(new URL("../templates", import.meta.url)),
  });
  const localRule = (command) =>
    command.replace("--config=p/default", "--config=rules.yml");
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      scripts: {
        "security-check": localRule(configured.scripts["security-check"]),
        report: `node "${cli.replaceAll("\\", "/")}" report --format=human --package-manager=npm`,
        "report:agent": `node "${cli.replaceAll("\\", "/")}" report --format=json --package-manager=npm`,
      },
    }),
  );
  writeFileSync(
    join(cwd, "rules.yml"),
    [
      "rules:",
      "  - id: smoke-eval",
      "    languages: [javascript]",
      "    message: Avoid eval",
      "    severity: ERROR",
      "    pattern: eval($X)",
      "",
    ].join("\n"),
  );
  mkdirSync(join(cwd, ".reports"));
  writeFileSync(join(cwd, ".reports/generated.js"), 'eval("ignored report");\n');
  const options = {
    cwd,
    timeout: 120000,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      SEMGREP_SEND_METRICS: "off",
      SEMGREP_ENABLE_VERSION_CHECK: "0",
      SEMGREP_SETTINGS_FILE: join(cwd, "settings.yml"),
    },
  };
  const git = spawnSync("git", ["init", "--quiet"], options);
  assert.equal(git.status, 0, git.stderr?.toString());
  const source = join(cwd, "пример.js");
  writeFileSync(source, 'console.log("Привет");\n');
  const clean = runNpm(["run", "security-check"], options);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  writeFileSync(source, '// Привет\neval("1 + 1");\n');
  const finding = runNpm(["run", "security-check"], options);
  assert.equal(finding.status, 1, finding.stdout + finding.stderr);
  let previous;
  for (const name of ["report", "report:agent"]) {
    const output = runNpm(["run", "--silent", name], options);
    // This fixture intentionally has no mandatory lint/dead-code scripts.
    assert.equal(output.status, 2, output.stdout + output.stderr);
    const report = JSON.parse(readFileSync(join(cwd, ".reports/report.json")));
    const security = report.checks.find((check) => check.name === "security-check");
    assert.equal(security.status, "completed", JSON.stringify(security));
    assert.equal(security.findingsCount, 1);
    assert.equal(security.exitCode, 1);
    assert.ok(security.version);
    if (previous) assert.deepEqual(security, previous);
    previous = security;
    if (name === "report:agent") assert.deepEqual(JSON.parse(output.stdout), report);
  }
  const data = JSON.parse(
    readFileSync(join(cwd, ".reports/security-report.json"), "utf8"),
  );
  assert.equal(data.results.length, 1);
  assert.match(data.results[0].path, /пример\.js$/);
});
