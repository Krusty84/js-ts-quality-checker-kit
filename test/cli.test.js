import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cli = fileURLToPath(new URL("../main.js", import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "quality-kit-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
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
    writeFileSync(
      join(bin, command),
      `#!${process.execPath}
const fs = require("node:fs");
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
      { mode: 0o755 },
    );
  }
  return { cwd, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function initialize(project, answers = ["js", "node", "1", "n", "n"], entrypoint = cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], project);
    let stdout = "";
    let stderr = "";
    let pending = "";
    let index = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Initializer timed out: ${stdout}\n${stderr}`));
    }, 10000);
    child.stdout.on("data", (data) => {
      stdout += data;
      pending += data;
      if (pending.endsWith(": ") && index < answers.length) {
        child.stdin.write(`${answers[index++]}\n`);
        pending = "";
      }
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

test("initializer runs without installing its own tool dependencies", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url)),
  );
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test("initializes the consumer and generates a report command for the kit", async (t) => {
  const project = fixture(t);
  const sourceBefore = readFileSync(cli, "utf8");
  const result = await initialize(project);
  assert.equal(result.status, 0, result.stderr);
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
  assert.ok(!commands.some(({ command }) => ["semgrep", "pipx"].includes(command)));
  assert.equal(readFileSync(cli, "utf8"), sourceBefore);
});

for (const answer of ["", "   ", "js", " TS "]) {
  test(`selects ${answer.trim().toLowerCase() === "ts" ? "TypeScript" : "JavaScript"} for language answer ${JSON.stringify(answer)}`, async (t) => {
    const project = fixture(t);
    const result = await initialize(project, [answer, "node", "1", "n", "n"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\(js\/ts\) \[js\]/);
    const knip = JSON.parse(readFileSync(join(project.cwd, "knip.json")));
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    const hooks = readFileSync(join(project.cwd, "lefthook.yml"), "utf8");
    if (answer.trim().toLowerCase() === "ts") {
      assert.deepEqual(knip.entry, ["src/index.ts", "index.ts", "src/main.ts", "main.ts"]);
      assert.deepEqual(knip.project, ["**/*.ts"]);
      assert.match(pkg.scripts.validate, /tsc --noEmit/);
      assert.match(hooks, /types-check/);
    } else {
      assert.deepEqual(knip.entry, ["src/index.js", "index.js", "src/main.js", "main.js"]);
      assert.deepEqual(knip.project, ["**/*.js"]);
      assert.doesNotMatch(pkg.scripts.validate, /tsc/);
      assert.doesNotMatch(hooks, /types-check/);
    }
  });
}

test("a failed dependency install stops setup before installing hooks", async (t) => {
  const project = fixture(t);
  project.env.FAIL_COMMAND = "npm";
  const result = await initialize(project);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Setup completed successfully/);
  const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8");
  assert.doesNotMatch(commands, /lefthook","install/);
});

test("a failed hook install is reported as a setup failure", async (t) => {
  const project = fixture(t);
  project.env.FAIL_COMMAND = "npx";
  const result = await initialize(project);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /Setup completed successfully/);
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

for (const licenseType of ["mit", "apache", "proprietary"]) {
  test(`configures supported ${licenseType} license headers`, async (t) => {
    const project = fixture(t);
    const result = await initialize(project, [
      "ts",
      "node",
      "1",
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
    assert.ok(pkg.scripts.report.includes("node .license-header.cjs || true"));
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
    "js", "bun", "1", "n", "y", "", "Alexey Sedoykin",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.equal(pkg.licenseHeader.licenseType, "mit");
  assert.equal(pkg.scripts["license:fix"], "node .license-header.cjs");
  assert.ok(pkg.scripts.validate.startsWith("node .license-header.cjs && "));
  assert.ok(pkg.scripts.report.includes("node .license-header.cjs || true"));
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

test("rejects unsupported licenses before writing configuration", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, [
    "js", "node", "1", "n", "y", "unknown", "Example Company",
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mit, apache and proprietary/);
  assert.equal(existsSync(join(project.cwd, "biome.json")), false);
});

for (const scenario of [
  { name: "installation is declined", answer: "n" },
  { name: "the default installation answer is used", answer: "" },
  { name: "Semgrep is missing and installation is declined", answer: "n", missing: "semgrep" },
  { name: "pipx is missing", answer: "y", missing: "pipx", warning: /pipx\.pypa\.io/ },
  { name: "pipx cannot run", answer: "y", env: { FAIL_COMMAND: "pipx" }, warning: /pipx\.pypa\.io/ },
  { name: "installation fails", answer: "y", env: { FAIL_SEMGREP_INSTALL: "1" }, warning: /failed/ },
  { name: "Semgrep remains unavailable after installation", answer: "y", env: { FAIL_COMMAND: "semgrep" }, warning: /pipx ensurepath/ },
]) {
  test(`continues without Semgrep when ${scenario.name}`, async (t) => {
    const project = fixture(t);
    Object.assign(project.env, { SEMGREP_NEEDS_INSTALL: "1" }, scenario.env);
    if (scenario.missing) {
      project.env.PATH = join(project.cwd, "bin");
      rmSync(join(project.env.PATH, scenario.missing));
    }
    const result = await initialize(project, [
      "js", "node", "1", "y", scenario.answer, "y", "mit", "Example Company",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Install it with pipx now\? \(y\/n\) \[n\]/);
    assert.ok(result.stdout.indexOf("Install it with pipx now?") < result.stdout.indexOf("5. Automatically"));
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
      .trim().split("\n").map(JSON.parse);
    const pipxCommands = commands.filter(({ command }) => command === "pipx");
    if (scenario.answer !== "y" || scenario.missing === "pipx") {
      assert.deepEqual(pipxCommands, []);
    } else if (scenario.env?.FAIL_COMMAND === "pipx") {
      assert.deepEqual(pipxCommands, [{ command: "pipx", args: ["--version"] }]);
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
    const result = await initialize(project, ["js", runtime, "1", "y", "y", "n"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installing Semgrep with pipx/);
    const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
      .trim().split("\n").map(JSON.parse);
    assert.deepEqual(commands.slice(0, 4), [
      { command: "semgrep", args: ["--version"] },
      { command: "pipx", args: ["--version"] },
      { command: "pipx", args: ["install", "semgrep"] },
      { command: "semgrep", args: ["--version"] },
    ]);
    assert.equal(commands.filter(({ command }) => command === "pipx").length, 2);
    const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
    assert.match(pkg.scripts["security-check"], /^semgrep scan /);
    assert.match(pkg.scripts.validate, /semgrep scan /);
    assert.match(pkg.scripts.report, /semgrep scan .*security-report\.json/);
    assert.ok(existsSync(join(project.cwd, ".semgrepignore")));
    assert.match(readFileSync(join(project.cwd, "lefthook.yml"), "utf8"), /security-scan:\n\s+run: semgrep scan /);
  });
}

test("installs TypeScript for Bun projects and uses the system Semgrep CLI", async (t) => {
  const project = fixture(t);
  const result = await initialize(project, ["ts", "bun", "1", "y", "n"]);
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
  for (const language of ["js", "ts"]) {
    test(`preserves VS Code configuration and command order for ${language}/${runtime}`, async (t) => {
      const project = fixture(t);
      const result = await initialize(project, [
        language, runtime, "2", "y", "y", "mit", "Example Company",
      ]);
      assert.equal(result.status, 0, result.stderr);
      const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
      const runCmd = runtime === "bun" ? "bunx" : "npx";
      const isTS = language === "ts";
      const kit = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
      assert.equal(readFileSync(join(project.cwd, "biome.json"), "utf8"), JSON.stringify({
        $schema: "https://biomejs.dev/schemas/1.9.4/schema.json",
        vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
        formatter: { enabled: true, indentStyle: "space", indentWidth: 2 },
        linter: {
          enabled: true,
          rules: { recommended: true, correctness: { noUnusedVariables: "warn" } },
        },
        files: { ignore: ["out/**", "dist/**", "node_modules/**"] },
      }, null, 2));
      assert.equal(readFileSync(join(project.cwd, "knip.json"), "utf8"), JSON.stringify({
        $schema: "https://unpkg.com/knip@5.43.0/schema.json",
        entry: isTS
          ? ["src/extension.ts", "extension.ts"]
          : ["src/extension.js", "extension.js"],
        project: [isTS ? "**/*.ts" : "**/*.js"],
      }, null, 2));

      const validate = [
        "node .license-header.cjs",
        `${runCmd} @biomejs/biome check .`,
      ];
      if (isTS) validate.push(runtime === "bun" ? "bun x tsc --noEmit" : "tsc --noEmit");
      validate.push(`${runCmd} knip`, "semgrep scan --config=p/default --error");
      assert.deepEqual(pkg.scripts, {
        start: "node src/index.js",
        lint: `${runCmd} @biomejs/biome check .`,
        "lint:fix": `${runCmd} @biomejs/biome check --write .`,
        "dead-code": `${runCmd} knip`,
        "security-check": "semgrep scan --config=p/default --error",
        "license:fix": "node .license-header.cjs",
        validate: validate.join(" && "),
        report: [
          runtime === "bun"
            ? "mkdir -p .reports"
            : "node -e \"const fs = require('fs'); if (!fs.existsSync('.reports')) fs.mkdirSync('.reports')\"",
          "node .license-header.cjs || true",
          `${runCmd} @biomejs/biome check . > .reports/biome-report.txt || true`,
          `${runCmd} knip --reporter=json > .reports/knip-report.json || true`,
          "semgrep scan --config=p/default --json -o .reports/security-report.json || true",
          `${runCmd} ${kit.name}@${kit.version} parse-report`,
        ].join(" && "),
      });

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
      if (isTS) hooks.push(
        "    types-check:",
        `      run: ${runtime === "bun" ? "bun x" : "npx"} tsc --noEmit`,
      );
      hooks.push(
        "    dead-code-check:",
        `      run: ${runCmd} knip`,
        "    security-scan:",
        "      run: semgrep scan --config=p/default --error",
      );
      assert.equal(readFileSync(join(project.cwd, "lefthook.yml"), "utf8"), hooks.join("\n"));
      const commands = readFileSync(join(project.cwd, "commands.jsonl"), "utf8")
        .trim().split("\n").map(JSON.parse);
      assert.deepEqual(commands, [
        { command: "semgrep", args: ["--version"] },
        {
          command: runtime === "bun" ? "bun" : "npm",
          args: [
            ...(runtime === "bun" ? ["add", "-d", "--exact"] : ["install", "-D", "--save-exact"]),
            "@biomejs/biome@1.9.4", "knip@5.43.0", "lefthook@1.10.10", "typescript@5",
          ],
        },
        { command: runCmd, args: ["lefthook", "install"] },
      ]);
    });
  }
}

test("the packed CLI initializes another project and parses its report", async (t) => {
  const packedDir = mkdtempSync(join(tmpdir(), "quality-kit-pack-"));
  t.after(() => rmSync(packedDir, { recursive: true, force: true }));
  const packed = spawnSync("npm", [
    "pack", "--json", "--ignore-scripts", "--offline",
    "--cache", join(packedDir, "cache"),
    "--pack-destination", packedDir,
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const [archive] = JSON.parse(packed.stdout);
  const unpacked = spawnSync("tar", ["-xzf", join(packedDir, archive.filename), "-C", packedDir], {
    encoding: "utf8",
  });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const packedRoot = join(packedDir, "package");
  const kit = JSON.parse(readFileSync(join(packedRoot, "package.json")));
  const packedCli = join(packedRoot, kit.bin[kit.name]);
  const project = fixture(t);
  const result = await initialize(project, [
    "ts", "node", "2", "y", "y", "mit", "Example Company",
  ], packedCli);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup completed successfully/);
  for (const filename of ["license-header.cjs", ".semgrepignore"]) {
    const target = filename.startsWith(".") ? filename : `.${filename}`;
    assert.equal(
      readFileSync(join(project.cwd, target), "utf8"),
      readFileSync(new URL(`../templates/${filename}`, import.meta.url), "utf8"),
    );
  }
  const pkg = JSON.parse(readFileSync(join(project.cwd, "package.json")));
  assert.ok(pkg.scripts.report.endsWith(`npx ${kit.name}@${kit.version} parse-report`));
  mkdirSync(join(project.cwd, ".reports"));
  writeFileSync(join(project.cwd, "unused.js"), "export const unused = 1;\n");
  writeFileSync(join(project.cwd, ".reports/knip-report.json"), JSON.stringify({
    files: ["unused.js"],
    issues: [{ file: "index.ts", exports: [{ name: "unusedExport" }] }],
  }));
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
  assert.doesNotMatch(report.stdout, /Welcome to the quality standards initializer/);
});
