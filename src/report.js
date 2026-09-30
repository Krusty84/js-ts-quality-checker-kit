/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { spawnSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { reportingCommand } from "./report-commands.js";
import { interpretReport } from "./report-formats.js";

const checks = [
  { name: "lint", tool: "biome", report: "biome-report.json", required: true },
  { name: "typecheck", tool: "typescript", report: "typescript-report.txt" },
  {
    name: "dead-code",
    tool: "knip",
    report: "knip-report.json",
    required: true,
  },
  { name: "security-check", tool: "semgrep", report: "security-report.json" },
];

function environment(cwd, name, script) {
  const path =
    Object.entries(process.env).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1] ?? "";
  const bins = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    bins.push(join(dir, "node_modules", ".bin"));
    if (dirname(dir) === dir) break;
  }
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "path",
      ),
    ),
    PATH: [...bins, path].join(delimiter),
    INIT_CWD: process.env.INIT_CWD ?? cwd,
    npm_lifecycle_event: name,
    npm_lifecycle_script: script,
    npm_package_json: join(cwd, "package.json"),
  };
}

function available(command, env) {
  const extensions =
    process.platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
      : [""];
  return env.PATH.split(delimiter).some((dir) =>
    extensions.some((extension) => {
      try {
        const path = join(dir, command + extension);
        accessSync(
          path,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return statSync(path).isFile();
      } catch {
        return false;
      }
    }),
  );
}

function capture(command, options, stdoutPath, stderrPath) {
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  try {
    // File descriptors avoid child_process's buffered-output limit. Keep every
    // byte even when a tool crashes or emits a very large native report.
    const child = spawnSync(command, {
      ...options,
      stdio: ["ignore", stdout, stderr],
    });
    if (child.error) appendFileSync(stderrPath, `${child.error.message}\n`);
    return child;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function version(command, options) {
  const child = spawnSync(command, {
    ...options,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (child.error || child.status !== 0) return null;
  return (
    child.stdout
      .trim()
      .match(
        /^(?:Version:?[ \t]+|biome[ \t]+|knip[ \t]+|semgrep[ \t]+)?(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\r?\n|$)/i,
      )?.[1] ?? null
  );
}

function emptyCheck({ name, tool }) {
  return {
    name,
    tool,
    script: null,
    command: null,
    version: null,
    exitCode: null,
    signal: null,
    status: "failed",
    findingsCount: null,
    reason: null,
    reportPath: null,
    stdoutPath: null,
    stderrPath: null,
  };
}

function runCheck(spec, scripts, cwd, packageManager) {
  const check = emptyCheck(spec);
  const script = scripts[spec.name];
  if (script === undefined) {
    check.status = spec.required ? "failed" : "skipped";
    check.reason = "not_configured";
    return check;
  }
  if (typeof script !== "string" || !script.trim()) {
    check.reason = "invalid_script";
    return check;
  }
  check.script = script;
  // Lifecycle hooks are part of custom script semantics, not a native report.
  const direct =
    scripts[`pre${spec.name}`] || scripts[`post${spec.name}`]
      ? null
      : reportingCommand(script, spec.tool);
  check.command =
    direct?.command ?? `${packageManager} run --silent ${spec.name}`;
  if (!direct) check.tool = null;
  check.stdoutPath = `.reports/${spec.name}.stdout.txt`;
  check.stderrPath = `.reports/${spec.name}.stderr.txt`;
  check.reportPath = direct ? `.reports/${spec.report}` : check.stdoutPath;
  const stdoutPath = join(cwd, check.stdoutPath);
  const stderrPath = join(cwd, check.stderrPath);
  const env = environment(cwd, spec.name, script);
  const options = {
    cwd,
    env,
    shell: process.env.npm_config_script_shell || true,
  };
  try {
    // npx/bunx must not silently fetch a missing checker during reporting.
    const missing =
      direct &&
      [direct.executable, direct.launcher].find(
        (command) => !available(command, env),
      );
    if (missing) {
      writeFileSync(stdoutPath, "");
      writeFileSync(stderrPath, `Executable not found: ${missing}\n`);
      check.command = null;
      check.reportPath = null;
      check.reason = `executable_not_found: ${missing}`;
      return check;
    }
    const child = capture(check.command, options, stdoutPath, stderrPath);
    check.exitCode = child.status;
    check.signal = child.signal;
    if (direct) copyFileSync(stdoutPath, join(cwd, check.reportPath));
    if (child.error || child.signal || child.status === null) {
      check.reason = child.signal
        ? `terminated: ${child.signal}`
        : "process_failed";
    } else if (!direct) {
      check.status = "partial";
      check.reason = "unsupported_script";
    } else {
      Object.assign(
        check,
        interpretReport(
          spec.tool,
          readFileSync(stdoutPath, "utf8"),
          readFileSync(stderrPath, "utf8"),
          child.status,
        ),
      );
    }
    if (direct) check.version = version(direct.versionCommand, options);
  } catch (error) {
    check.status = "failed";
    check.findingsCount = null;
    check.reason = `collector_error: ${error.message}`;
  }
  return check;
}

function writeReport(cwd, report) {
  const temporary = join(cwd, ".reports/report.json.tmp");
  writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n");
  renameSync(temporary, join(cwd, ".reports/report.json"));
}

export function collectReport({
  cwd = process.cwd(),
  packageManager = "npm",
} = {}) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    complete: false,
    exitCode: 2,
    checks: [],
  };
  mkdirSync(join(cwd, ".reports"), { recursive: true });
  const artifacts = ["report.json", "report.json.tmp", "biome-report.txt"];
  for (const spec of checks)
    artifacts.push(
      spec.report,
      `${spec.name}.stdout.txt`,
      `${spec.name}.stderr.txt`,
    );
  // Own a finite list, never delete the user's other files under .reports/.
  for (const artifact of artifacts)
    rmSync(join(cwd, ".reports", artifact), { force: true });
  let scripts;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    scripts = pkg.scripts ?? {};
    if (typeof scripts !== "object" || Array.isArray(scripts))
      throw new Error("Invalid scripts object");
  } catch (error) {
    report.checks = checks.map((spec) => ({
      ...emptyCheck(spec),
      reason: `invalid_package_json: ${error.message}`,
    }));
    writeReport(cwd, report);
    return report;
  }
  for (const spec of checks)
    report.checks.push(runCheck(spec, scripts, cwd, packageManager));
  report.complete = report.checks.every((check) =>
    ["completed", "skipped"].includes(check.status),
  );
  report.exitCode = !report.complete
    ? 2
    : report.checks.some((check) => check.findingsCount > 0)
      ? 1
      : 0;
  writeReport(cwd, report);
  return report;
}

function formatHumanReport(report) {
  const lines = ["Quality report"];
  for (const check of report.checks) {
    lines.push(
      `${check.name}: ${check.status}; findings: ${check.findingsCount ?? "unknown"}; tool exit: ${check.exitCode ?? "unknown"}${check.reason ? `; ${check.reason}` : ""}`,
    );
    if (check.reportPath) lines.push(`  Report: ${check.reportPath}`);
    if (check.stderrPath) lines.push(`  Stderr: ${check.stderrPath}`);
  }
  lines.push(
    `Complete: ${report.complete}; exit code: ${report.exitCode}`,
    "Summary: .reports/report.json",
  );
  return lines.join("\n");
}

export function runReportCli(args) {
  let format = args.includes("--format=json") ? "json" : "human";
  let packageManager = "npm";
  let report;
  try {
    for (const arg of args) {
      if (/^--format=(human|json)$/.test(arg)) format = arg.split("=")[1];
      else if (/^--package-manager=(npm|bun)$/.test(arg))
        packageManager = arg.split("=")[1];
      else
        throw new Error(
          `Unknown report option: ${arg}. Use --format=human|json --package-manager=npm|bun.`,
        );
    }
    report = collectReport({ packageManager });
  } catch (error) {
    console.error(`Report failed: ${error.message}`);
    report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      complete: false,
      exitCode: 2,
      checks: [],
      reason: error.message,
    };
  }
  console.log(
    format === "json"
      ? JSON.stringify(report, null, 2)
      : formatHumanReport(report),
  );
  return report.exitCode;
}
