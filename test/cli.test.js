/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  cli,
  commandPath,
  initialize,
  interact,
  packKit,
  pathEnv,
  runNpm,
  systemPath,
  useLocalReportParser,
  writeCommand,
} from "./cli.js";
import { validateLicenseType } from "../src/license-header.js";

const skillPaths = [
  ".agents/skills/js-ts-quality-checks/SKILL.md",
  ".claude/skills/js-ts-quality-checks/SKILL.md",
];

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "quality kit тест-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 5 }));
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "unrelated-consumer",
      scripts: { start: "node src/index.js" },
      dependencies: { existing: "1.0.0" },
    }),
  );
  for (const command of ["npm", "npx", "bun", "bunx", "semgrep", "pipx"]) {
    writeCommand(
      bin,
      command,
      `const fs = require("node:fs");
const command = ${JSON.stringify(command)};
const args = process.argv.slice(2);
fs.appendFileSync("commands.jsonl", JSON.stringify({ command, args }) + "\\n");
if (process.env.FAIL_COMMAND === command) process.exit(23);
if (command === "semgrep" && process.env.SEMGREP_NEEDS_INSTALL && !fs.existsSync(".semgrep-installed")) process.exit(23);
if (command === "pipx" && args[0] === "install") {
  console.log("Installing Semgrep with pipx...");
  if (process.env.FAIL_SEMGREP_INSTALL) process.exit(23);
  fs.writeFileSync(".semgrep-installed", "");
}
`,
    );
  }
  return { cwd, env: pathEnv([bin, systemPath]) };
}

test("initializer depends only on Clack, not the consumer's quality tools", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  assert.deepEqual(pkg.dependencies, { "@clack/prompts": "1.8.1" });
  assert.equal(pkg.engines.node, ">=20.12.0");
});

test("setup requires a terminal and leaves the consumer unchanged", (t) => {
  const project = fixture(t);
  const before = readFileSync(join(project.cwd, "package.json"), "utf8");
  const files = readdirSync(project.cwd);
  const result = spawnSync(process.execPath, [cli], {
    ...project,
    encoding: "utf8",
    input: "js\nnode\n",
    timeout: 5000,
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stderr.trim(),
    "Interactive setup requires a terminal. Run this command in a terminal.",
  );
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(join(project.cwd, "package.json"), "utf8"), before);
  assert.deepEqual(readdirSync(project.cwd), files);
});

test("Enter accepts English defaults and an empty holder skips license headers", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, ["", "", "", "", "", "", ""]);
  assert.equal(result.status, 0, result.stderr);
  for (const label of [
    "Welcome to the quality standards initializer!",
    "JavaScript",
    "TypeScript",
    "Node.js",
    "Bun",
    "Application",
    "Library / npm package",
    "VS Code extension",
    "Yes",
    "No",
    "MIT",
    "Apache-2.0",
    "Proprietary",
    "Leave blank to skip license headers.",
    "Select none to skip.",
    "Codex",
    "Claude Code",
    "Setup completed successfully!",
  ])
    assert.ok(
      result.stdout.includes(label),
      `Missing English UI text: ${label}`,
    );
  assert.doesNotMatch(result.stdout + result.stderr, /[\u0400-\u04ff]/);
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.equal(pkg.scripts.typecheck, undefined);
  assert.equal(pkg.scripts["security-check"], undefined);
  assert.equal(pkg.licenseHeader, undefined);
  assert.equal(existsSync(join(project.cwd, ".license-header.cjs")), false);
  const knip = JSON.parse(readFileSync(join(project.cwd, "knip.json")));
  assert.deepEqual(knip.entry, [
    "src/index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    "index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    "src/main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    "main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  ]);
  assert.deepEqual(knip.project, ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
  assert.equal(knip.includeEntryExports, true);
  const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(commands[0].command, "npm");
  assert.ok(
    !commands.some(({ command }) => ["semgrep", "pipx"].includes(command)),
  );
  for (const skill of skillPaths)
    assert.ok(existsSync(join(project.cwd, skill)));
});

const cancelSteps = [
  ["Which language does your project use?", "\r"],
  ["Which runtime do you use?", "\r"],
  ["Select your project type.", "\r"],
  ["Configure security checks with Semgrep?", "y\r"],
  ["Automatically add license headers to source files?", "y\r"],
  ["Select a license.", "\r"],
  ["Enter the copyright holder (Name / Company).", "Example Company\r"],
  ["Select coding agents for the quality-checking skill.", "\r"],
  ["Semgrep CLI is unavailable. Install it with pipx now?", "\r"],
];

for (const [index, [message]] of cancelSteps.entries()) {
  test(`Ctrl+C cancels without installation or configuration at: ${message}`, async (t) => {
    const project = fixture(t);
    project.env.SEMGREP_NEEDS_INSTALL = "1";
    const before = readFileSync(join(project.cwd, "package.json"), "utf8");
    const files = readdirSync(project.cwd);
    const result = await interact(project, [
      ...cancelSteps.slice(0, index),
      [message, "\u0003"],
    ]);
    assert.equal(result.status, 130, result.stderr);
    assert.match(result.stdout, /Setup cancelled\./);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /An error occurred|Setup completed successfully/,
    );
    assert.doesNotMatch(result.stdout + result.stderr, /[\u0400-\u04ff]/);
    assert.equal(
      readFileSync(join(project.cwd, "package.json"), "utf8"),
      before,
    );
    assert.deepEqual(
      readdirSync(project.cwd).filter((file) => file !== "commands.jsonl"),
      files,
    );
    const commandsFile = join(project.cwd, "commands.jsonl");
    const commands = existsSync(commandsFile)
      ? readFileSync(commandsFile, "utf8").trim().split("\n").map(JSON.parse)
      : [];
    assert.deepEqual(
      commands,
      index === cancelSteps.length - 1
        ? [{ command: "semgrep", args: ["--version"] }]
        : [],
    );
  });
}

test("preserves the copyright holder's Unicode input without translation", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, [
    "js",
    "node",
    "application",
    "n",
    "y",
    "mit",
    "Тестовая компания",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.equal(pkg.licenseHeader.copyrightHolder, "Тестовая компания");
});

test("initializes the consumer and generates a report command for the kit", async (t) => {
  const project = fixture(t);
  const sourceBefore = readFileSync(cli, "utf8");
  const result = await initialize(project);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(
    result.stdout,
    /Select a license\.|Enter the copyright holder/,
  );
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.equal(pkg.name, "unrelated-consumer");
  assert.equal(pkg.scripts.start, "node src/index.js");
  assert.deepEqual(pkg.dependencies, { existing: "1.0.0" });
  assert.match(pkg.scripts.report, /js-ts-quality-checker-kit.* parse-report/);
  assert.doesNotMatch(pkg.scripts.report, /unrelated-consumer/);
  assert.ok(existsSync(join(project.cwd, "biome.json")));
  const biome = JSON.parse(readFileSync(join(project.cwd, "biome.json")));
  assert.deepEqual(biome.files.ignore, ["node_modules/**"]);
  assert.ok(existsSync(join(project.cwd, "knip.json")));
  assert.ok(existsSync(join(project.cwd, "lefthook.yml")));
  assert.equal(existsSync(join(project.cwd, ".license-header.cjs")), false);
  assert.equal(pkg.licenseHeader, undefined);
  assert.equal(pkg.scripts["license:fix"], undefined);
  assert.doesNotMatch(pkg.scripts.validate, /license-header/);
  assert.doesNotMatch(pkg.scripts.report, /license-header/);
  assert.doesNotMatch(
    readFileSync(join(project.cwd, "lefthook.yml"), "utf8"),
    /license-header/,
  );
  const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const install = commands.find(({ command }) => command === "npm");
  assert.ok(
    install.args.includes("typescript@5"),
    "Knip needs a compatible TypeScript compiler even in JS projects",
  );
  assert.ok(!install.args.some((arg) => arg.includes("@clack/")));
  assert.ok(
    !commands.some(({ command }) => ["semgrep", "pipx"].includes(command)),
  );
  assert.equal(readFileSync(cli, "utf8"), sourceBefore);
});

for (const answer of ["", "js", "ts"]) {
  test(`selects ${answer === "ts" ? "TypeScript" : "JavaScript"} for language choice ${JSON.stringify(answer)}`, async (t) => {
    const project = fixture(t);
    const result = await initialize(project, [answer, "node", "application", "n", "n"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Which language does your project use\?/);
    const knip = JSON.parse(readFileSync(join(project.cwd, "knip.json")));
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    const hooks = readFileSync(join(project.cwd, "lefthook.yml"), "utf8");
    assert.deepEqual(knip.entry, [
      "src/index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "src/main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
      "main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
    ]);
    assert.deepEqual(knip.project, ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"]);
    assert.equal(knip.includeEntryExports, true);
    if (answer === "ts") {
      assert.match(pkg.scripts.validate, /tsc --noEmit/);
      assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
      assert.match(hooks, /types-check/);
    } else {
      assert.doesNotMatch(pkg.scripts.validate, /tsc/);
      assert.equal(pkg.scripts.typecheck, undefined);
      assert.doesNotMatch(hooks, /types-check/);
    }
  });
}

for (const runtime of ["node", "bun"]) {
  for (const { answer, agents } of [
    { answer: "", agents: [true, true] },
    { answer: "1", agents: [true, false] },
    { answer: "2", agents: [false, true] },
    { answer: "3", agents: [true, true] },
    { answer: "4", agents: [false, false] },
  ]) {
    test(`installs selected agent skills for ${runtime}, choice ${answer || "default"}`, async (t) => {
      const project = fixture(t);
      const result = await initialize(
        project,
        ["js", runtime, "application", "n", "n"],
        cli,
        [answer],
      );
      assert.equal(result.status, 0, result.stderr);
      assert.ok(
        result.stdout.indexOf("Select coding agents") >
          result.stdout.indexOf("Automatically add license headers"),
      );
      const runner = runtime === "bun" ? "bun run" : "npm run";
      const template = readFileSync(
        new URL(
          "../templates/skills/js-ts-quality-checks/SKILL.md",
          import.meta.url,
        ),
        "utf8",
      );
      for (const [index, relativePath] of skillPaths.entries()) {
        const path = join(project.cwd, relativePath);
        assert.equal(existsSync(path), agents[index]);
        if (agents[index]) {
          assert.ok(lstatSync(path).isFile());
          const content = readFileSync(path, "utf8");
          assert.equal(content, template.replaceAll("{{run}}", runner));
          assert.doesNotMatch(content, /\{\{[^}]+\}\}/);
          assert.ok(content.includes(`${runner} lint`));
          assert.ok(result.stdout.includes(join(relativePath)));
        }
      }
      if (answer === "4") {
        assert.equal(existsSync(join(project.cwd, ".agents")), false);
        assert.equal(existsSync(join(project.cwd, ".claude")), false);
      }
    });
  }

  test(`preserves a custom typecheck command for ${runtime}`, async (t) => {
    const project = fixture(t);
    const pkgPath = join(project.cwd, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath));
    pkg.scripts.typecheck = "tsc --noEmit -p tsconfig.app.json";
    writeFileSync(pkgPath, JSON.stringify(pkg));
    const result = await initialize(project, ["ts", runtime, "application", "n", "n"]);
    assert.equal(result.status, 0, result.stderr);
    const generated = JSON.parse(readFileSync(pkgPath));
    assert.equal(generated.scripts.typecheck, pkg.scripts.typecheck);
    assert.equal(
      generated.scripts.validate,
      runtime === "bun"
        ? "bunx @biomejs/biome check . && bun x tsc --noEmit && bunx knip"
        : "npx @biomejs/biome check . && tsc --noEmit && npx knip",
    );
    assert.doesNotMatch(
      readFileSync(join(project.cwd, "lefthook.yml"), "utf8"),
      /tsconfig\.app/,
    );
  });
}

test("preserves existing skills and project instructions across repeated setup", async (t) => {
  const project = fixture(t);
  const existingPath = join(project.cwd, skillPaths[0]);
  mkdirSync(join(project.cwd, ".agents/skills/js-ts-quality-checks"), {
    recursive: true,
  });
  const custom = "Custom quality-checking instructions.\n";
  writeFileSync(existingPath, custom);
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    writeFileSync(join(project.cwd, path), "Existing project instructions.\n");
  }
  const result = await initialize(project);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stderr.includes(
      `Skipping existing agent skill: ${join(skillPaths[0])}`,
    ),
  );
  assert.equal(readFileSync(existingPath, "utf8"), custom);
  const claudeSkill = readFileSync(join(project.cwd, skillPaths[1]), "utf8");

  for (const answer of ["3", "1", "4"]) {
    const repeated = await initialize(project, undefined, cli, [answer]);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(readFileSync(existingPath, "utf8"), custom);
    assert.equal(
      readFileSync(join(project.cwd, skillPaths[1]), "utf8"),
      claudeSkill,
    );
  }
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    assert.equal(
      readFileSync(join(project.cwd, path), "utf8"),
      "Existing project instructions.\n",
    );
  }
});

test("a failed dependency install stops setup before installing hooks", async (t) => {
  const project = fixture(t);
  project.env.FAIL_COMMAND = "npm";
  const result = await initialize(project);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Setup completed successfully/);
  const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8");
  assert.doesNotMatch(commands, /lefthook","install/);
  for (const path of skillPaths)
    assert.equal(existsSync(join(project.cwd, path)), false);
});

test("a failed hook install is reported as a setup failure", async (t) => {
  const project = fixture(t);
  project.env.FAIL_COMMAND = "npx";
  const result = await initialize(project);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Setup completed successfully/);
  for (const path of skillPaths)
    assert.equal(existsSync(join(project.cwd, path)), false);
});

test("invalid consumer package.json is rejected before configuration is written", async (t) => {
  const project = fixture(t);
  writeFileSync(join(project.cwd, "package.json"), "{invalid");
  const result = await initialize(project);
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(project.cwd, "biome.json")), false);
});

test("reads exports from a Knip 5 JSON report", (t) => {
  const project = fixture(t);
  mkdirSync(join(project.cwd, ".reports"));
  writeFileSync(
    join(project.cwd, ".reports/knip-report.json"),
    JSON.stringify({
      files: [],
      issues: [
        {
          file: "src/helper.js",
          exports: [{ name: "unusedExport", line: 1, col: 14, pos: 13 }],
          types: [],
        },
      ],
    }),
  );
  const result = spawnSync(process.execPath, [cli, "parse-report"], {
    ...project,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unusedExport/);
  assert.match(result.stdout, /Unused exports\/types: 1/);
});

test("malformed report exits with an error", (t) => {
  const project = fixture(t);
  mkdirSync(join(project.cwd, ".reports"));
  writeFileSync(join(project.cwd, ".reports/knip-report.json"), "{invalid");
  const result = spawnSync(process.execPath, [cli, "parse-report"], {
    ...project,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
});

test("a missing Knip report exits with an error", (t) => {
  const project = fixture(t);
  const result = spawnSync(process.execPath, [cli, "parse-report"], {
    ...project,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /not found/);
});

for (const runtime of ["node", "bun"]) {
  for (const scenario of [
    { name: "successful checks", exit: 0, license: false, security: false },
    {
      name: "successful checks with headers and security",
      exit: 0,
      license: true,
      security: true,
    },
    { name: "failed checks", exit: 23, license: false, security: true },
    {
      name: "failed checks and headers",
      exit: 23,
      license: true,
      security: true,
    },
    {
      name: "malformed Knip JSON",
      exit: 23,
      license: false,
      security: true,
      malformed: true,
    },
  ]) {
    test(`executes the ${runtime} report in npm's shell: ${scenario.name}`, async (t) => {
      const project = fixture(t);
      const result = await initialize(project, [
        "js",
        runtime,
        "application",
        scenario.security ? "y" : "n",
        ...(scenario.license ? ["y", "mit", "Example Company"] : ["n"]),
      ]);
      assert.equal(result.status, 0, result.stderr);
      const pkgPath = join(project.cwd, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath));
      useLocalReportParser(pkg, cli);
      writeFileSync(pkgPath, JSON.stringify(pkg));
      const bin = join(project.cwd, "bin");
      const record =
        'const fs = require("node:fs");\nconst record = (tool) => fs.appendFileSync("report-order.jsonl", JSON.stringify(tool) + "\\n");\n';
      for (const runner of ["npx", "bunx"]) {
        writeCommand(
          bin,
          runner,
          record +
            `
const biome = process.argv[2] === "@biomejs/biome";
record(biome ? "biome" : "knip");
console.log(biome ? "Biome report" : ${JSON.stringify(scenario.malformed ? "{invalid" : '{"files":[],"issues":[]}')});
process.exit(${scenario.exit});
`,
        );
      }
      writeCommand(
        bin,
        "semgrep",
        record +
          `
record("semgrep");
fs.writeFileSync(".reports/security-report.json", JSON.stringify({ results: [] }));
process.exit(${scenario.exit});
`,
      );
      if (scenario.license) {
        writeFileSync(
          join(project.cwd, ".license-header.cjs"),
          record + `record("license"); process.exit(${scenario.exit});`,
        );
      }
      // Exclude Git's Unix utilities so an installed true.exe cannot hide regressions.
      project.env = pathEnv([bin, dirname(process.execPath)], project.env);
      project.env.npm_config_script_shell =
        process.platform === "win32"
          ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
          : "/bin/sh";
      if (process.platform === "win32") {
        const probe = spawnSync("true", [], {
          ...project,
          shell: true,
          stdio: "ignore",
        });
        assert.notEqual(
          probe.status,
          0,
          "The regression test must not have true.exe on PATH",
        );
      }
      // The second run also covers an existing report directory and overwriting reports.
      for (let attempt = 0; attempt < 2; attempt++) {
        writeFileSync(join(project.cwd, "report-order.jsonl"), "");
        const report = runNpm(["run", "report"], project);
        assert.equal(
          report.status,
          scenario.malformed ? 1 : 0,
          report.stdout + report.stderr,
        );
        const order = readFileSync(
          join(project.cwd, "report-order.jsonl"),
          "utf8",
        )
          .trim()
          .split("\n")
          .map(JSON.parse);
        assert.deepEqual(order, [
          ...(scenario.license ? ["license"] : []),
          "biome",
          "knip",
          ...(scenario.security ? ["semgrep"] : []),
        ]);
        assert.match(
          readFileSync(join(project.cwd, ".reports/biome-report.txt"), "utf8"),
          /Biome report/,
        );
        assert.equal(
          existsSync(join(project.cwd, ".reports/security-report.json")),
          scenario.security,
        );
        if (scenario.malformed)
          assert.match(report.stderr, /Error reading or parsing/);
        else assert.match(report.stdout, /No dead code or unused files/);
      }
    });
  }
}

test(
  "Windows Semgrep preparation explains prerequisites only when selected",
  {
    skip: process.platform !== "win32",
  },
  async (t) => {
    const project = fixture(t);
    const enabled = await initialize(project, ["js", "node", "application", "y", "n"]);
    assert.equal(enabled.status, 0, enabled.stderr);
    assert.match(enabled.stdout, /Windows is beta/);
    assert.match(enabled.stdout, /Python 3\.10\+.*pipx.*PATH.*PYTHONUTF8=1/);
    const disabled = await initialize(project);
    assert.equal(disabled.status, 0, disabled.stderr);
    assert.doesNotMatch(disabled.stdout, /Windows is beta|PYTHONUTF8/);
  },
);

for (const licenseType of ["mit", "apache", "proprietary"]) {
  test(`configures supported ${licenseType} license headers`, async (t) => {
    const project = fixture(t);
    const result = await initialize(project, [
      "ts",
      "node",
      "application",
      "n",
      "y",
      licenseType,
      "Example Company",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    assert.equal(pkg.licenseHeader.licenseType, licenseType);
    assert.equal(pkg.licenseHeader.copyrightHolder, "Example Company");
    assert.equal(pkg.licenseHeader.yearRange, String(new Date().getFullYear()));
    assert.equal(pkg.scripts["license:fix"], "node .license-header.cjs");
    assert.ok(pkg.scripts.validate.startsWith("node .license-header.cjs && "));
    assert.ok(
      pkg.scripts.report.includes(
        'node .license-header.cjs || node -e "process.exit(0)"',
      ),
    );
    assert.ok(existsSync(join(project.cwd, ".license-header.cjs")));
    const hooks = readFileSync(join(project.cwd, "lefthook.yml"), "utf8");
    assert.match(hooks, /run: node \.license-header\.cjs/);
    assert.doesNotMatch(hooks, /--files-change-triggered/);
    assert.doesNotMatch(
      readFileSync(join(project.cwd, "commands.jsonl"), "utf8"),
      /@bufbuild\/license-header/,
    );
  });
}

test("defaults to MIT and runs the generated header script for Bun projects", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, [
    "js",
    "bun",
    "application",
    "n",
    "y",
    "",
    "Alexey Sedoykin",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.equal(pkg.licenseHeader.licenseType, "mit");
  assert.equal(pkg.scripts["license:fix"], "node .license-header.cjs");
  assert.ok(pkg.scripts.validate.startsWith("node .license-header.cjs && "));
  assert.ok(
    pkg.scripts.report.includes(
      'node .license-header.cjs || node -e "process.exit(0)"',
    ),
  );
  assert.match(
    readFileSync(join(project.cwd, "lefthook.yml"), "utf8"),
    /run: node \.license-header\.cjs/,
  );
  assert.doesNotMatch(
    readFileSync(join(project.cwd, "commands.jsonl"), "utf8"),
    /@bufbuild\/license-header/,
  );
  const git = spawnSync("git", ["init", "--quiet"], project);
  assert.equal(git.status, 0, git.stderr?.toString());
  writeFileSync(join(project.cwd, "index.js"), "console.log('hello');\n");
  const headers = spawnSync(process.execPath, [".license-header.cjs"], {
    ...project,
    encoding: "utf8",
  });
  assert.equal(headers.status, 0, headers.stderr);
  assert.equal(
    readFileSync(join(project.cwd, "index.js"), "utf8"),
    `/*\n * SPDX-FileCopyrightText: Copyright (c) ${pkg.licenseHeader.yearRange} Alexey Sedoykin\n * SPDX-License-Identifier: MIT\n */\n\nconsole.log('hello');\n`,
  );
});

test("license validation still rejects unsupported values outside the selection UI", () => {
  assert.throws(
    () => validateLicenseType("unknown"),
    /mit, apache and proprietary/,
  );
});

for (const scenario of [
  { name: "installation is declined", answer: "n" },
  { name: "the default installation answer is used", answer: "" },
  {
    name: "Semgrep is missing and installation is declined",
    answer: "n",
    missing: "semgrep",
  },
  {
    name: "pipx is missing",
    answer: "y",
    missing: "pipx",
    warning: /pipx\.pypa\.io/,
  },
  {
    name: "pipx cannot run",
    answer: "y",
    env: { FAIL_COMMAND: "pipx" },
    warning: /pipx\.pypa\.io/,
  },
  {
    name: "installation fails",
    answer: "y",
    env: { FAIL_SEMGREP_INSTALL: "1" },
    warning: /failed/,
  },
  {
    name: "Semgrep remains unavailable after installation",
    answer: "y",
    env: { FAIL_COMMAND: "semgrep" },
    warning: /pipx ensurepath/,
  },
]) {
  test(`continues without Semgrep when ${scenario.name}`, async (t) => {
    const project = fixture(t);
    Object.assign(project.env, { SEMGREP_NEEDS_INSTALL: "1" }, scenario.env);
    if (scenario.missing) {
      project.env.PATH = join(project.cwd, "bin");
      rmSync(commandPath(project.env.PATH, scenario.missing));
    }
    const result = await initialize(project, [
      "js",
      "node",
      "application",
      "y",
      "y",
      "mit",
      "Example Company",
      scenario.answer,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /Semgrep CLI is unavailable\. Install it with pipx now\?/,
    );
    assert.ok(
      result.stdout.indexOf("Install it with pipx now?") >
        result.stdout.indexOf("Select coding agents"),
    );
    assert.match(result.stdout, /Setup completed successfully/);
    assert.match(result.stderr, /Continuing without Semgrep/);
    if (scenario.warning) assert.match(result.stderr, scenario.warning);
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    assert.equal(pkg.scripts["security-check"], undefined);
    assert.doesNotMatch(pkg.scripts.validate, /semgrep/);
    assert.doesNotMatch(pkg.scripts.report, /semgrep|security-report/);
    assert.equal(existsSync(join(project.cwd, ".semgrepignore")), false);
    assert.ok(existsSync(join(project.cwd, "biome.json")));
    assert.ok(existsSync(join(project.cwd, "knip.json")));
    assert.equal(pkg.licenseHeader.copyrightHolder, "Example Company");
    const hooks = readFileSync(join(project.cwd, "lefthook.yml"), "utf8");
    assert.doesNotMatch(hooks, /semgrep|security-scan/);
    assert.match(hooks, /license-header/);
    const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const pipxCommands = commands.filter(({ command }) => command === "pipx");
    if (scenario.answer !== "y" || scenario.missing === "pipx") {
      assert.deepEqual(pipxCommands, []);
    } else if (scenario.env?.FAIL_COMMAND === "pipx") {
      assert.deepEqual(pipxCommands, [
        { command: "pipx", args: ["--version"] },
      ]);
    } else {
      assert.deepEqual(pipxCommands, [
        { command: "pipx", args: ["--version"] },
        { command: "pipx", args: ["install", "semgrep"] },
      ]);
    }
  });
}

for (const runtime of ["node", "bun"]) {
  test(`installs unavailable Semgrep with pipx for ${runtime} projects`, async (t) => {
    const project = fixture(t);
    project.env.SEMGREP_NEEDS_INSTALL = "1";
    const result = await initialize(project, [
      "js",
      runtime,
      "application",
      "y",
      "n",
      "y",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installing Semgrep with pipx/);
    const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(commands.slice(0, 4), [
      { command: "semgrep", args: ["--version"] },
      { command: "pipx", args: ["--version"] },
      { command: "pipx", args: ["install", "semgrep"] },
      { command: "semgrep", args: ["--version"] },
    ]);
    assert.equal(
      commands.filter(({ command }) => command === "pipx").length,
      2,
    );
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    assert.match(pkg.scripts["security-check"], /^semgrep scan /);
    assert.match(pkg.scripts.validate, /semgrep scan /);
    assert.match(pkg.scripts.report, /semgrep scan .*security-report\.json/);
    assert.ok(existsSync(join(project.cwd, ".semgrepignore")));
    assert.match(
      readFileSync(join(project.cwd, "lefthook.yml"), "utf8"),
      /security-scan:\n\s+run: semgrep scan /,
    );
  });
}

test("installs TypeScript for Bun projects and uses the system Semgrep CLI", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, ["ts", "bun", "application", "y", "n"]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Install it with pipx/);
  const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(!commands.some(({ command }) => command === "pipx"));
  const install = commands.find(({ command }) => command === "bun");
  assert.ok(install.args.some((arg) => arg.startsWith("typescript@")));
  assert.ok(!install.args.some((arg) => arg.startsWith("semgrep")));
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.match(pkg.scripts["security-check"], /^semgrep scan /);
  assert.ok(existsSync(join(project.cwd, ".semgrepignore")));
});

for (const runtime of ["node", "bun"]) {
  for (const [language, projectType] of [
    ["js", "application"],
    ["ts", "application"],
    ["js", "library"],
    ["ts", "library"],
    ["js", "vscode"],
    ["ts", "vscode"],
  ]) {
    test(`generates ${projectType} configuration and preserves command order for ${language}/${runtime}`, async (t) => {
      const project = fixture(t);
      const result = await initialize(project, [
        language,
        runtime,
        projectType,
        "y",
        "y",
        "mit",
        "Example Company",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
      const runCmd = runtime === "bun" ? "bunx" : "npx";
      const isTS = language === "ts";
      const kit = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url)),
      );
      assert.equal(
        readFileSync(join(project.cwd, "biome.json"), "utf8"),
        JSON.stringify(
          {
            $schema: "https://biomejs.dev/schemas/1.9.4/schema.json",
            vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
            formatter: { enabled: true, indentStyle: "space", indentWidth: 2 },
            linter: {
              enabled: true,
              rules: {
                recommended: true,
                correctness: { noUnusedVariables: "warn" },
              },
            },
            files: {
              ignore: projectType === "vscode"
                ? ["out/**", "dist/**", "node_modules/**"]
                : ["node_modules/**"],
            },
          },
          null,
          2,
        ),
      );
      assert.equal(
        readFileSync(join(project.cwd, "knip.json"), "utf8"),
        JSON.stringify(
          {
            $schema: "https://unpkg.com/knip@5.43.0/schema.json",
            entry: projectType === "vscode"
              ? [
                  "src/extension.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                  "extension.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                ]
              : [
                  "src/index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                  "index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                  "src/main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                  "main.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
                ],
            project: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
            includeEntryExports: projectType === "application",
          },
          null,
          2,
        ),
      );

      const validate = [
        "node .license-header.cjs",
        `${runCmd} @biomejs/biome check .`,
      ];
      if (isTS)
        validate.push(
          runtime === "bun" ? "bun x tsc --noEmit" : "tsc --noEmit",
        );
      validate.push(
        `${runCmd} knip`,
        "semgrep scan --config=p/default --error",
      );
      assert.deepEqual(pkg.scripts, {
        start: "node src/index.js",
        lint: `${runCmd} @biomejs/biome check .`,
        "lint:fix": `${runCmd} @biomejs/biome check --write .`,
        "dead-code": `${runCmd} knip`,
        "security-check": "semgrep scan --config=p/default --error",
        "license:fix": "node .license-header.cjs",
        ...(isTS
          ? {
              typecheck:
                runtime === "bun" ? "bun x tsc --noEmit" : "tsc --noEmit",
            }
          : {}),
        validate: validate.join(" && "),
        report: [
          "node -e \"require('node:fs').mkdirSync('.reports', { recursive: true })\"",
          'node .license-header.cjs || node -e "process.exit(0)"',
          `${runCmd} @biomejs/biome check . > .reports/biome-report.txt || node -e "process.exit(0)"`,
          `${runCmd} knip --reporter=json > .reports/knip-report.json || node -e "process.exit(0)"`,
          'semgrep scan --config=p/default --json -o .reports/security-report.json || node -e "process.exit(0)"',
          `${runCmd} ${kit.name}@${kit.version} parse-report`,
        ].join(" && "),
      });

      const codexSkill = readFileSync(join(project.cwd, skillPaths[0]), "utf8");
      assert.equal(
        readFileSync(join(project.cwd, skillPaths[1]), "utf8"),
        codexSkill,
      );
      assert.ok(
        codexSkill.includes(`${runtime === "bun" ? "bun" : "npm"} run lint`),
      );

      const hooks = [
        "pre-commit:",
        "  parallel: false",
        "  commands:",
        "    license-header:",
        "      priority: 1",
        '      glob: "*.{js,ts,jsx,tsx}"',
        "      run: node .license-header.cjs",
        "    biome-check:",
        "      priority: 2",
        '      glob: "*.{js,ts,jsx,tsx,json}"',
        `      run: ${runCmd} @biomejs/biome check --write --no-errors-on-unmatched {staged_files}`,
        "",
        "pre-push:",
        "  commands:",
      ];
      if (isTS)
        hooks.push(
          "    types-check:",
          `      run: ${runtime === "bun" ? "bun x" : "npx"} tsc --noEmit`,
        );
      hooks.push(
        "    dead-code-check:",
        `      run: ${runCmd} knip`,
        "    security-scan:",
        "      run: semgrep scan --config=p/default --error",
      );
      assert.equal(
        readFileSync(join(project.cwd, "lefthook.yml"), "utf8"),
        hooks.join("\n"),
      );
      const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.deepEqual(commands, [
        { command: "semgrep", args: ["--version"] },
        {
          command: runtime === "bun" ? "bun" : "npm",
          args: [
            ...(runtime === "bun"
              ? ["add", "-d", "--exact"]
              : ["install", "-D", "--save-exact"]),
            "@biomejs/biome@1.9.4",
            "knip@5.43.0",
            "lefthook@1.10.10",
            "typescript@5",
          ],
        },
        { command: runCmd, args: ["lefthook", "install"] },
      ]);
    });
  }
}

test("the packed CLI initializes another project and parses its report", async (t) => {
  const packedRoot = packKit(t);
  const packedSkill = readFileSync(
    join(packedRoot, "templates/skills/js-ts-quality-checks/SKILL.md"),
    "utf8",
  );
  const kit = JSON.parse(readFileSync(join(packedRoot, "package.json")));
  const packedCli = join(packedRoot, kit.bin[kit.name]);
  const project = fixture(t);
  const result = await initialize(
    project,
    ["ts", "node", "vscode", "y", "y", "mit", "Example Company"],
    packedCli,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup completed successfully/);
  for (const path of skillPaths) {
    const content = readFileSync(join(project.cwd, path), "utf8");
    assert.equal(content, packedSkill.replaceAll("{{run}}", "npm run"));
    assert.doesNotMatch(content, /\{\{[^}]+\}\}/);
  }
  for (const filename of ["license-header.cjs", ".semgrepignore"]) {
    const target = filename.startsWith(".") ? filename : `.${filename}`;
    assert.equal(
      readFileSync(join(project.cwd, target), "utf8"),
      readFileSync(
        new URL(`../templates/${filename}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.ok(
    pkg.scripts.report.endsWith(`npx ${kit.name}@${kit.version} parse-report`),
  );
  mkdirSync(join(project.cwd, ".reports"));
  writeFileSync(join(project.cwd, "unused.js"), "export const unused = 1;\n");
  writeFileSync(
    join(project.cwd, ".reports/knip-report.json"),
    JSON.stringify({
      files: ["unused.js"],
      issues: [{ file: "index.ts", exports: [{ name: "unusedExport" }] }],
    }),
  );
  // Reporting must not load the UI module, even if its dependencies are absent.
  rmSync(join(packedRoot, "node_modules"), { recursive: true, force: true });
  const report = spawnSync(process.execPath, [packedCli, "parse-report"], {
    ...project,
    encoding: "utf8",
  });
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /unused\.js/);
  assert.match(report.stdout, /unusedExport/);
  assert.match(report.stdout, /Unused files: 1/);
  assert.match(report.stdout, /Unused exports\/types: 1/);
  assert.match(report.stdout, /Wasted disk space: 0\.02 KB/);
  assert.doesNotMatch(
    report.stdout,
    /Welcome to the quality standards initializer/,
  );
});
