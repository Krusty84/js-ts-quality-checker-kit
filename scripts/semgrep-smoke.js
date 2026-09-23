import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configureSemgrep, prepareSemgrep } from "../src/semgrep.js";
import { runNpm } from "../test-support/cli.js";

test("native Semgrep scans UTF-8 sources with a local rule", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "semgrep smoke проверка-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 5 }));
  assert.equal(await prepareSemgrep({
    question: async () => { throw new Error("Install Semgrep before running this smoke test"); },
  }), true);
  const configured = configureSemgrep({
    targetDir: cwd,
    templatesDir: fileURLToPath(new URL("../templates", import.meta.url)),
  });
  const localRule = (command) => command.replace("--config=p/default", "--config=rules.yml");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({
    scripts: {
      "security-check": localRule(configured.scripts["security-check"]),
      report: localRule(configured.report),
    },
  }));
  writeFileSync(join(cwd, "rules.yml"), [
    "rules:", "  - id: smoke-eval", "    languages: [javascript]",
    "    message: Avoid eval", "    severity: ERROR", "    pattern: eval($X)", "",
  ].join("\n"));
  mkdirSync(join(cwd, ".reports"));
  const options = {
    cwd, timeout: 120000,
    env: {
      ...process.env, PYTHONUTF8: "1", SEMGREP_SEND_METRICS: "off",
      SEMGREP_ENABLE_VERSION_CHECK: "0", SEMGREP_SETTINGS_FILE: join(cwd, "settings.yml"),
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
  const report = runNpm(["run", "report"], options);
  assert.equal(report.status, 0, report.stdout + report.stderr);
  const data = JSON.parse(readFileSync(join(cwd, ".reports/security-report.json"), "utf8"));
  assert.equal(data.results.length, 1);
  assert.match(data.results[0].path, /пример\.js$/);
});
