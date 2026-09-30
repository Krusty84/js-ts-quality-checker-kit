/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  cli,
  commandPath,
  pathEnv,
  runNpm,
  systemPath,
  useLocalReportCommands,
  writeCommand,
} from "./cli.js";

const biome = (diagnostics = []) => ({
  summary: {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    skipped: 0,
    diagnosticsNotPrinted: 0,
  },
  diagnostics,
});
const diagnostic = {
  category: "lint/correctness/noUnusedVariables",
  severity: "warning",
  description: "This variable is unused.",
  location: { path: { file: "src/пример.ts" }, span: [4, 9] },
};
const finding = {
  check_id: "test.eval",
  path: "src/пример.js",
  start: { line: 2, col: 1, offset: 10 },
  end: { line: 2, col: 9, offset: 18 },
  extra: {
    message: "Avoid eval",
    severity: "ERROR",
    metadata: { arbitrary: "preserved" },
  },
};

function fixture(t, packageManager = "npm") {
  const cwd = mkdtempSync(join(tmpdir(), "quality report проверка-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 5 }));
  const bin = join(cwd, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const scripts = {
    lint: `${packageManager === "bun" ? "bunx" : "npx"} @biomejs/biome check .`,
    typecheck: packageManager === "bun" ? "bun x tsc --noEmit" : "tsc --noEmit",
    "dead-code": `${packageManager === "bun" ? "bunx" : "npx"} knip`,
    "security-check": "semgrep scan --config=p/default --error",
    "license:fix": "node forbidden.cjs",
    "lint:fix": "node forbidden.cjs",
    validate: "node forbidden.cjs",
    report: `${packageManager === "bun" ? "bunx" : "npx"} js-ts-quality-checker-kit@1.0.0 report --format=human --package-manager=${packageManager}`,
    "report:agent": `${packageManager === "bun" ? "bunx" : "npx"} js-ts-quality-checker-kit@1.0.0 report --format=json --package-manager=${packageManager}`,
  };
  const responses = {
    biome: {
      out: biome(),
      err: "Experimental JSON reporter\n",
      version: "Version: 1.9.4",
    },
    knip: { out: { files: [], issues: [] }, version: "5.43.0" },
    tsc: { out: "", version: "Version 5.9.3" },
    semgrep: { out: { results: [], errors: [] }, version: "1.100.0" },
  };
  for (const tool of Object.keys(responses)) {
    writeCommand(
      bin,
      tool,
      `
const fs = require("node:fs");
const tool = ${JSON.stringify(tool)};
const response = JSON.parse(fs.readFileSync(".responses.json"))[tool];
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log(response.version ?? "unknown"); process.exit(0); }
fs.appendFileSync(".order.jsonl", JSON.stringify({tool, args}) + "\\n");
process.stdout.write(typeof response.out === "string" ? response.out : JSON.stringify(response.out));
process.stderr.write(response.err ?? "");
process.exit(response.exit ?? 0);
`,
    );
  }
  for (const runner of ["npx", "bunx", "bun"]) {
    writeCommand(
      bin,
      runner,
      `
const args = process.argv.slice(2);
if (args[0] === "x") args.shift();
const tool = args.shift() === "@biomejs/biome" ? "biome" : process.argv[${runner === "bun" ? 3 : 2}];
process.argv = [process.argv[0], tool, ...args];
require("./" + tool + ".cjs");
`,
    );
  }
  writeFileSync(
    join(cwd, "forbidden.cjs"),
    'require("node:fs").writeFileSync("source.js", "MUTATED");',
  );
  writeFileSync(join(cwd, "source.js"), "const unused = 1;\n");
  const project = { cwd, env: pathEnv([bin, systemPath]), encoding: "utf8" };
  function save() {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts }));
    writeFileSync(join(cwd, ".responses.json"), JSON.stringify(responses));
  }
  function run(format = "json") {
    save();
    const child = spawnSync(
      process.execPath,
      [
        cli,
        "report",
        `--format=${format}`,
        `--package-manager=${packageManager}`,
      ],
      project,
    );
    assert.ifError(child.error);
    const report = JSON.parse(
      readFileSync(join(cwd, ".reports/report.json"), "utf8"),
    );
    assert.equal(child.status, report.exitCode, child.stdout + child.stderr);
    if (format === "json") assert.deepEqual(JSON.parse(child.stdout), report);
    else
      for (const check of report.checks)
        assert.ok(
          child.stdout.includes(
            `${check.name}: ${check.status}; findings: ${check.findingsCount ?? "unknown"}`,
          ),
        );
    return report;
  }
  const read = (path) => readFileSync(join(cwd, path), "utf8");
  const order = () => read(".order.jsonl").trim().split("\n").map(JSON.parse);
  return { ...project, bin, scripts, responses, run, read, order, save };
}

for (const manager of ["npm", "bun"]) {
  test(`${manager}: both generated report commands share statuses and preserve source`, (t) => {
    const project = fixture(t, manager);
    const pkg = { scripts: project.scripts };
    useLocalReportCommands(pkg, cli);
    project.save();
    for (const name of ["report", "report:agent"]) {
      const child = runNpm(["run", "--silent", name], project);
      assert.equal(child.status, 0, child.stdout + child.stderr);
      const report = JSON.parse(project.read(".reports/report.json"));
      assert.equal(report.complete, true);
      assert.ok(
        report.checks.every(
          (check) => check.status === "completed" && check.findingsCount === 0,
        ),
      );
      assert.deepEqual(
        report.checks.map((check) => check.version),
        ["1.9.4", "5.9.3", "5.43.0", "1.100.0"],
      );
      if (name === "report:agent")
        assert.deepEqual(JSON.parse(child.stdout), report);
      else assert.match(child.stdout, /Complete: true; exit code: 0/);
      assert.equal(project.read("source.js"), "const unused = 1;\n");
      assert.equal(report.schemaVersion, 1);
      assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
      for (const check of report.checks) {
        for (const path of [
          check.reportPath,
          check.stdoutPath,
          check.stderrPath,
        ]) {
          assert.ok(path.startsWith(".reports/"));
          assert.ok(existsSync(join(project.cwd, path)));
        }
      }
    }
    assert.deepEqual(
      project.order().map(({ tool }) => tool),
      ["biome", "tsc", "knip", "semgrep", "biome", "tsc", "knip", "semgrep"],
    );
  });
}

test("warnings alone return 1; human and JSON modes agree and preserve native diagnostics", (t) => {
  const project = fixture(t);
  project.responses.biome.out = biome([diagnostic]);
  const human = project.run("human");
  const json = project.run();
  assert.deepEqual(human.checks, json.checks);
  assert.equal(json.complete, true);
  assert.equal(json.exitCode, 1);
  assert.equal(json.checks[0].exitCode, 0);
  assert.equal(json.checks[0].findingsCount, 1);
  assert.deepEqual(
    JSON.parse(project.read(json.checks[0].reportPath)),
    biome([diagnostic]),
  );
  assert.equal(
    project.read(json.checks[0].stderrPath),
    "Experimental JSON reporter\n",
  );
  assert.deepEqual(project.order()[0].args, [
    "check",
    ".",
    "--reporter=json",
    "--max-diagnostics=none",
  ]);
});

test("failure has priority over findings and does not stop subsequent checks", (t) => {
  const project = fixture(t);
  project.responses.biome = { out: "", err: "configuration failed", exit: 23 };
  project.responses.knip.out.files.push("unused.js");
  project.responses.knip.exit = 1;
  const report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(report.complete, false);
  assert.equal(report.checks[0].exitCode, 23);
  assert.equal(report.checks[0].status, "failed");
  assert.equal(report.checks[0].version, null);
  assert.equal(report.checks[2].status, "completed");
  assert.equal(report.checks[2].findingsCount, 1);
  assert.deepEqual(
    project.order().map(({ tool }) => tool),
    ["biome", "tsc", "knip", "semgrep"],
  );
});

test("optional scripts are explicitly skipped; mandatory scripts are required", (t) => {
  const project = fixture(t);
  delete project.scripts.typecheck;
  delete project.scripts["security-check"];
  let report = project.run();
  assert.equal(report.exitCode, 0);
  for (const check of [report.checks[1], report.checks[3]]) {
    assert.equal(check.status, "skipped");
    assert.equal(check.reason, "not_configured");
    for (const field of [
      "command",
      "version",
      "findingsCount",
      "exitCode",
      "reportPath",
      "stdoutPath",
      "stderrPath",
    ])
      assert.equal(check[field], null);
  }
  delete project.scripts.lint;
  delete project.scripts["dead-code"];
  report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(report.checks[0].status, "failed");
  assert.equal(report.checks[2].reason, "not_configured");
});

for (const tool of ["biome", "knip", "semgrep"]) {
  for (const out of ["", "{broken", {}]) {
    test(`${tool}: ${JSON.stringify(out)} is never a clean native report`, (t) => {
      const project = fixture(t);
      project.responses[tool].out = out;
      const report = project.run();
      const check = report.checks.find((check) => check.tool === tool);
      assert.equal(report.exitCode, 2);
      assert.equal(check.status, "failed");
      assert.equal(check.findingsCount, null);
      assert.equal(
        project.read(check.reportPath),
        typeof out === "string" ? out : JSON.stringify(out),
      );
    });
  }
}

test("a missing executable fails without invoking a package downloader", (t) => {
  const project = fixture(t);
  rmSync(commandPath(project.bin, "biome"));
  project.env = pathEnv([project.bin, dirname(process.execPath)], project.env);
  // run() captures the fixture's environment object.
  project.save();
  const child = spawnSync(
    process.execPath,
    [cli, "report", "--format=json"],
    project,
  );
  const report = JSON.parse(child.stdout);
  assert.equal(child.status, 2, child.stderr);
  assert.equal(report.checks[0].reason, "executable_not_found: biome");
  assert.equal(report.checks[0].exitCode, null);
  assert.equal(report.checks[0].command, null);
  assert.equal(report.checks[0].reportPath, null);
  assert.deepEqual(
    project.order().map(({ tool }) => tool),
    ["tsc", "knip", "semgrep"],
  );
});

for (const mutation of [
  (data) => (data.summary.diagnosticsNotPrinted = 1),
  (data) => (data.summary.warnings = 2),
  (data) => (data.summary.skipped = 1),
]) {
  test("Biome truncation, skipped files and inconsistent counters are incomplete", (t) => {
    const project = fixture(t);
    project.responses.biome.out = biome([diagnostic]);
    mutation(project.responses.biome.out);
    const report = project.run();
    assert.equal(report.exitCode, 2);
    assert.equal(report.checks[0].status, "partial");
  });
}

const knipItems = {
  dependencies: [{ name: "unused-dependency" }],
  devDependencies: [{ name: "unused-dev-dependency" }],
  optionalPeerDependencies: [{ name: "optional-peer" }],
  unlisted: [{ name: "unlisted-dependency" }],
  binaries: [{ name: "missing-binary" }],
  unresolved: [{ name: "./unresolved", line: 3, col: 4, pos: 23 }],
  exports: [{ name: "unusedExport", line: 4, col: 1, pos: 24 }],
  types: [{ name: "UnusedType", line: 5, col: 2, pos: 44 }],
  nsExports: [{ name: "nsExport", line: 6, col: 2, pos: 64 }],
  nsTypes: [{ name: "NamespaceType", line: 7, col: 2, pos: 74 }],
  classMembers: { Example: [{ name: "method", line: 8, col: 3, pos: 87 }] },
  enumMembers: { Colour: [{ name: "Red", line: 9, col: 3, pos: 100 }] },
  duplicates: [
    [
      { name: "alias", line: 10, col: 1, pos: 110 },
      { name: "original", line: 11, col: 1, pos: 120 },
    ],
  ],
};

for (const [category, items] of Object.entries(knipItems)) {
  test(`Knip counts ${category} and preserves coordinates and grouping`, (t) => {
    const project = fixture(t);
    const data = {
      files: [],
      issues: [{ file: "src/пример.ts", [category]: items }],
    };
    project.responses.knip.out = data;
    project.responses.knip.exit = 1;
    const report = project.run();
    assert.equal(report.exitCode, 1);
    assert.equal(report.checks[2].findingsCount, 1);
    assert.deepEqual(
      JSON.parse(project.read(report.checks[2].reportPath)),
      data,
    );
    const parsed = spawnSync(process.execPath, [cli, "parse-report"], project);
    assert.equal(parsed.status, 0, parsed.stderr);
    assert.match(parsed.stdout, new RegExp(`${category}: 1`));
    assert.ok(parsed.stdout.includes(JSON.stringify(items, null, 2)));
    assert.match(parsed.stdout, /verify actual usage/);
    assert.doesNotMatch(parsed.stdout, /No Knip findings|Remove these/);
  });
}

test("Knip unknown nonempty categories remain visible and cannot imply success", (t) => {
  const project = fixture(t);
  project.responses.knip.out.issues.push({
    file: "x.ts",
    futureCategory: [{ name: "future", line: 15 }],
  });
  const report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(report.checks[2].status, "partial");
  assert.equal(report.checks[2].findingsCount, null);
  assert.match(report.checks[2].reason, /futureCategory/);
  const parsed = spawnSync(process.execPath, [cli, "parse-report"], project);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(parsed.stdout, /future/);
  assert.match(parsed.stderr, /Incomplete interpretation/);
  assert.doesNotMatch(parsed.stdout, /No Knip findings/);
});

test("TypeScript code 2 means findings and preserves the user's project argument", (t) => {
  const project = fixture(t);
  project.scripts.typecheck =
    'tsc --noEmit -p "tsconfig приложение.json" --pretty true';
  project.responses.tsc = {
    out: "src/пример.ts(3,4): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    exit: 2,
  };
  const report = project.run();
  assert.equal(report.exitCode, 1);
  assert.equal(report.checks[1].exitCode, 2);
  assert.equal(report.checks[1].status, "completed");
  assert.equal(report.checks[1].findingsCount, 1);
  assert.deepEqual(project.order()[1].args, [
    "--noEmit",
    "-p",
    "tsconfig приложение.json",
    "--pretty",
    "false",
  ]);
  assert.equal(
    project.read(report.checks[1].reportPath),
    project.responses.tsc.out,
  );
});

for (const response of [
  {
    out: "error TS5058: The specified path does not exist: 'bad.json'.\n",
    exit: 1,
  },
  {
    out: "tsconfig.json(2,3): error TS5023: Unknown compiler option.\n",
    exit: 2,
  },
  { out: "Version 5.9.3\nCompiler help\n", exit: 0 },
  { out: "", err: "Cannot find module typescript", exit: 1 },
]) {
  test("TypeScript configuration errors, startup errors and unrecognized output return 2", (t) => {
    const project = fixture(t);
    project.responses.tsc = response;
    const report = project.run();
    assert.equal(report.exitCode, 2);
    assert.notEqual(report.checks[1].status, "completed");
    assert.equal(report.checks[1].findingsCount, null);
  });
}

for (const exit of [0, 2]) {
  test(`Semgrep keeps findings and errors together with native exit ${exit}`, (t) => {
    const project = fixture(t);
    const data = {
      results: [finding],
      errors: [
        {
          type: "Timeout",
          message: "Timeout while analyzing source",
          path: "large.js",
        },
      ],
    };
    project.responses.semgrep = { out: data, err: "Scan incomplete\n", exit };
    const report = project.run();
    assert.equal(report.exitCode, 2);
    assert.equal(report.checks[3].status, "partial");
    assert.equal(report.checks[3].findingsCount, 1);
    assert.equal(report.checks[3].exitCode, exit);
    assert.deepEqual(
      JSON.parse(project.read(report.checks[3].reportPath)),
      data,
    );
  });
}

test("Semgrep network failure is not clean even with exit 0", (t) => {
  const project = fixture(t);
  project.responses.semgrep = {
    out: "",
    err: "Could not download p/default: network unavailable",
    exit: 0,
  };
  const report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(report.checks[3].status, "failed");
  assert.match(
    project.read(report.checks[3].stderrPath),
    /network unavailable/,
  );
});

test("custom scripts keep their semantics and complete text, including output over the buffer limit", (t) => {
  const project = fixture(t);
  project.scripts.typecheck =
    'node "custom script.cjs" && node -e "process.exit(0)"';
  writeFileSync(
    join(project.cwd, "custom script.cjs"),
    'process.stdout.write("Привет\\n" + "x".repeat(2 * 1024 * 1024)); process.stderr.write("details\\n"); require("node:fs").writeFileSync("custom-effect", "preserved");',
  );
  const report = project.run();
  assert.equal(report.exitCode, 2);
  const check = report.checks[1];
  assert.equal(check.status, "partial");
  assert.equal(check.reason, "unsupported_script");
  assert.equal(check.exitCode, 0);
  assert.equal(check.findingsCount, null);
  assert.equal(check.version, null);
  assert.equal(check.script, project.scripts.typecheck);
  assert.equal(
    project.read(check.stdoutPath),
    "Привет\n" + "x".repeat(2 * 1024 * 1024),
  );
  assert.equal(project.read(check.stderrPath), "details\n");
  assert.equal(project.read("custom-effect"), "preserved");
  assert.ok(project.order().some(({ tool }) => tool === "semgrep"));
});

test("lifecycle hooks remain custom semantics and prevent claims of a native clean check", (t) => {
  const project = fixture(t);
  project.scripts.pretypecheck = "node -e \"console.log('before')\"";
  const report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(report.checks[1].status, "partial");
  assert.match(project.read(report.checks[1].stdoutPath), /before/);
});

test("reruns replace only owned artifacts and never reuse disabled or failed results", (t) => {
  const project = fixture(t);
  project.responses.semgrep.out.results.push(finding);
  project.run();
  writeFileSync(join(project.cwd, ".reports/keep-user-file.json"), "preserve");
  writeFileSync(
    join(project.cwd, ".reports/biome-report.txt"),
    "legacy report",
  );
  delete project.scripts["security-check"];
  project.responses.biome.out = "";
  const report = project.run();
  assert.equal(report.exitCode, 2);
  assert.equal(project.read(".reports/biome-report.json"), "");
  assert.equal(report.checks[0].findingsCount, null);
  assert.equal(report.checks[3].reportPath, null);
  for (const path of [
    "security-report.json",
    "security-check.stdout.txt",
    "security-check.stderr.txt",
    "biome-report.txt",
    "report.json.tmp",
  ]) {
    assert.equal(existsSync(join(project.cwd, ".reports", path)), false);
  }
  assert.equal(project.read(".reports/keep-user-file.json"), "preserve");
});

test("reporting flags are replaced without losing custom check arguments", (t) => {
  const project = fixture(t);
  project.scripts.lint =
    'biome check "src с пробелами" --only=correctness/noUnusedVariables --reporter=summary --max-diagnostics 2';
  project.scripts["dead-code"] =
    'knip --workspace "packages/my app" --reporter compact';
  project.scripts["security-check"] =
    'semgrep scan --config="rules локальные.yml" --error --sarif -o "old report.json"';
  assert.equal(project.run().exitCode, 0);
  const order = project.order();
  assert.deepEqual(order[0].args, [
    "check",
    "src с пробелами",
    "--only=correctness/noUnusedVariables",
    "--reporter=json",
    "--max-diagnostics=none",
  ]);
  assert.deepEqual(order[2].args, [
    "--workspace",
    "packages/my app",
    "--reporter=json",
  ]);
  assert.deepEqual(order[3].args, [
    "scan",
    "--config=rules локальные.yml",
    "--error",
    "--json",
  ]);
});

test("invalid package.json produces an incomplete report instead of retaining a previous success", (t) => {
  const project = fixture(t);
  project.run();
  writeFileSync(join(project.cwd, "package.json"), "{}");
  const child = spawnSync(
    process.execPath,
    [cli, "report", "--format=json"],
    project,
  );
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stdout).checks[0].reason, "not_configured");
  writeFileSync(join(project.cwd, "package.json"), "{invalid");
  const invalid = spawnSync(
    process.execPath,
    [cli, "report", "--format=json"],
    project,
  );
  assert.equal(invalid.status, 2);
  assert.ok(
    JSON.parse(invalid.stdout).checks.every((check) =>
      check.reason.startsWith("invalid_package_json:"),
    ),
  );
});

test("reporting flags precede an existing end-of-options separator", (t) => {
  const project = fixture(t);
  project.scripts.lint = 'biome check --reporter summary -- "src приложение"';
  assert.equal(project.run().exitCode, 0);
  assert.deepEqual(project.order()[0].args, [
    "check",
    "--reporter=json",
    "--max-diagnostics=none",
    "--",
    "src приложение",
  ]);
});

test(
  "Windows tsc project paths retain native backslashes",
  { skip: process.platform !== "win32" },
  (t) => {
    const project = fixture(t);
    project.scripts.typecheck = 'tsc --noEmit -p "configs\\проект тест.json"';
    assert.equal(project.run().exitCode, 0);
    assert.deepEqual(project.order()[1].args, [
      "--noEmit",
      "-p",
      "configs\\проект тест.json",
      "--pretty",
      "false",
    ]);
  },
);
