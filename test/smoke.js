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
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { initialize, packKit, runNpm, useLocalReportParser } from "./cli.js";

test("the packed kit works with real tools and Git hooks", async (t) => {
  const packedRoot = packKit(t);
  const packedCli = join(packedRoot, "main.js");
  const { configureKnip } = await import(
    pathToFileURL(join(packedRoot, "src/knip.js")).href
  );
  const cache = join(packedRoot, "..", "tool-cache");

  for (const runtime of ["node", "bun"]) {
    for (const language of ["js", "ts"]) {
      await t.test(`${runtime}/${language}`, async (t) => {
        const root = mkdtempSync(join(tmpdir(), "quality smoke проверка-"));
        t.after(() =>
          rmSync(root, { recursive: true, force: true, maxRetries: 5 }),
        );
        const cwd = join(root, "project with spaces");
        mkdirSync(cwd);
        const project = {
          cwd,
          env: {
            ...process.env,
            INIT_CWD: cwd,
            npm_config_cache: join(cache, "npm"),
            BUN_INSTALL_CACHE_DIR: join(cache, "bun"),
          },
          encoding: "utf8",
          timeout: 180000,
        };
        const check = (result, success = true) => {
          assert.ifError(result.error);
          assert.notEqual(result.status, null, result.stdout + result.stderr);
          assert.equal(
            result.status === 0,
            success,
            result.stdout + result.stderr,
          );
          return result;
        };
        const git = (args, success = true) =>
          check(spawnSync("git", args, project), success);
        const script = (name, success = true) =>
          check(
            runtime === "node"
              ? runNpm(["run", name], project)
              : spawnSync("bun", ["run", name], project),
            success,
          );
        const pkgPath = join(cwd, "package.json");
        writeFileSync(
          pkgPath,
          JSON.stringify({
            name: "quality-kit-smoke",
            version: "1.0.0",
            private: true,
            type: "module",
          }),
        );
        writeFileSync(join(cwd, ".gitignore"), "node_modules/\n.reports/\n");
        const sourcePath = join(cwd, `index.${language}`);
        writeFileSync(
          sourcePath,
          'const message = "Привет";\nconsole.log(message);\n',
        );
        if (language === "ts") {
          writeFileSync(
            join(cwd, "tsconfig.json"),
            JSON.stringify({
              compilerOptions: {
                strict: true,
                target: "ES2020",
                module: "ESNext",
                skipLibCheck: true,
                types: [],
              },
              include: ["*.ts"],
            }),
          );
        }
        git(["init", "--quiet"]);
        git(["config", "user.name", "Quality Kit Test"]);
        git(["config", "user.email", "quality-kit@example.invalid"]);
        const remote = join(root, "local remote.git");
        git(["init", "--bare", "--quiet", remote]);
        git(["remote", "add", "origin", remote]);

        const initialized = await initialize(
          { cwd, env: project.env },
          [
            language,
            runtime,
            "application",
            "n",
            "y",
            "mit",
            "Тестовая компания",
          ],
          packedCli,
          ["3"],
          180000,
        );
        check(initialized);
        assert.match(initialized.stdout, /Setup completed successfully/);
        for (const directory of [".agents", ".claude"]) {
          assert.ok(
            existsSync(
              join(cwd, directory, "skills/js-ts-quality-checks/SKILL.md"),
            ),
          );
        }
        for (const hook of ["pre-commit", "pre-push"]) {
          assert.ok(existsSync(join(cwd, ".git/hooks", hook)));
        }
        const pkg = JSON.parse(readFileSync(pkgPath));
        assert.equal(pkg.scripts["security-check"], undefined);
        useLocalReportParser(pkg, packedCli);
        writeFileSync(pkgPath, JSON.stringify(pkg));

        script("license:fix");
        assert.match(
          readFileSync(sourcePath, "utf8"),
          /Copyright.*Тестовая компания/,
        );
        script("lint:fix");
        script("lint");
        script("dead-code");
        if (language === "ts") script("typecheck");
        script("validate");

        if (runtime === "node" && language === "js") {
          const knipRoot = join(cwd, "node_modules/knip");
          assert.equal(
            JSON.parse(readFileSync(join(knipRoot, "package.json"))).version,
            "5.43.0",
          );
          for (const projectType of ["application", "library", "vscode"]) {
            await t.test(`Knip ${projectType} exports and mixed source extensions`, () => {
              const targetDir = join(root, projectType);
              mkdirSync(targetDir);
              writeFileSync(
                join(targetDir, "package.json"),
                JSON.stringify({
                  name: `knip-${projectType}-smoke`,
                  type: "module",
                  main: "./main-entry.mjs",
                  bin: "./cli-entry.cjs",
                  exports: "./public-entry.mts",
                }),
              );
              for (const entry of [
                "main-entry.mjs",
                "cli-entry.cjs",
                "public-entry.mts",
              ])
                writeFileSync(join(targetDir, entry), "console.log('entry');\n");
              configureKnip({ targetDir, projectType, runCmd: "npx" });
              const extensions = [
                "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts",
              ];
              const entryName = projectType === "vscode" ? "extension" : "index";
              for (const extension of extensions) {
                const commonJS = extension === "cjs" || extension === "cts";
                writeFileSync(
                  join(targetDir, `used-${extension}.${extension}`),
                  commonJS ? "exports.used = 1;\n" : "export const used = 1;\n",
                );
                writeFileSync(
                  join(targetDir, `${entryName}.${extension}`),
                  (commonJS
                    ? `const { used } = require('./used-${extension}.${extension}');\n`
                    : `import { used } from './used-${extension}.${extension}';\n`) +
                    "console.log(used);\n",
                );
              }
              const entryPath = join(targetDir, `${entryName}.js`);
              writeFileSync(
                entryPath,
                readFileSync(entryPath, "utf8") +
                  (projectType === "vscode"
                    ? "export function activate() {}\nexport function deactivate() {}\n"
                    : "export const publicApi = 1;\n"),
              );
              const scan = (status) => {
                const result = spawnSync(
                  process.execPath,
                  [join(knipRoot, "bin/knip.js"), "--reporter=json"],
                  { ...project, cwd: targetDir },
                );
                assert.ifError(result.error);
                assert.equal(
                  result.status,
                  status,
                  result.stdout + result.stderr,
                );
                const report = JSON.parse(result.stdout);
                assert.ok(
                  report.issues.every((issue) =>
                    Object.entries(issue).every(([key, value]) =>
                      key === "file" ||
                      key === "exports" ||
                      Object.keys(value).length === 0,
                    ),
                  ),
                  result.stdout,
                );
                return {
                  files: report.files.sort(),
                  exports: report.issues
                    .flatMap((issue) =>
                      (issue.exports ?? []).map(({ name }) => `${issue.file}:${name}`),
                    )
                    .sort(),
                };
              };
              const entryExports = projectType === "application"
                ? ["index.js:publicApi"]
                : [];
              assert.deepEqual(scan(projectType === "application" ? 1 : 0), {
                files: [],
                exports: entryExports,
              });

              for (const extension of extensions)
                writeFileSync(
                  join(targetDir, `unused.${extension}`),
                  "console.log('unused');\n",
                );
              writeFileSync(
                join(targetDir, "used-js.js"),
                "export const used = 1;\nexport const unusedInternal = 2;\n",
              );
              assert.deepEqual(scan(1), {
                files: extensions.map((extension) => `unused.${extension}`).sort(),
                exports: [...entryExports, "used-js.js:unusedInternal"].sort(),
              });
            });
          }
        }

        const cleanSource = readFileSync(sourcePath, "utf8");
        git(["add", "."]);
        git(["commit", "--quiet", "-m", "Clean project"]);
        git(["push", "origin", "HEAD:refs/heads/main"]);

        writeFileSync(sourcePath, "const = ;\n");
        git(["add", `index.${language}`]);
        const rejectedCommit = git(
          ["commit", "--quiet", "-m", "Invalid syntax"],
          false,
        );
        assert.match(
          rejectedCommit.stdout + rejectedCommit.stderr,
          /biome-check/,
        );
        writeFileSync(sourcePath, cleanSource);
        writeFileSync(
          join(cwd, `unused.${language}`),
          "export const unused = 1;\n",
        );
        script("license:fix");
        script("lint:fix");
        script("dead-code", false);
        script("validate", false);
        git(["add", "."]);
        git(["commit", "--quiet", "-m", "Unused file"]);
        const rejectedPush = git(
          ["push", "origin", "HEAD:refs/heads/main"],
          false,
        );
        assert.match(
          rejectedPush.stdout + rejectedPush.stderr,
          /dead-code-check/,
        );

        if (language === "ts") {
          writeFileSync(
            sourcePath,
            cleanSource +
              'const value: number = "wrong";\nconsole.log(value);\n',
          );
          script("lint:fix");
          script("typecheck", false);
          git(["add", "."]);
          git(["commit", "--quiet", "-m", "Invalid type"]);
          const rejectedTypes = git(
            ["push", "origin", "HEAD:refs/heads/main"],
            false,
          );
          assert.match(
            rejectedTypes.stdout + rejectedTypes.stderr,
            /types-check/,
          );
        }
        writeFileSync(sourcePath, cleanSource + "debugger;\n");
        script("lint", false);
        for (let attempt = 0; attempt < 2; attempt++) {
          const report = script("report");
          assert.match(report.stdout, /Unused files:/);
          assert.ok(existsSync(join(cwd, ".reports/biome-report.txt")));
          const knip = JSON.parse(
            readFileSync(join(cwd, ".reports/knip-report.json")),
          );
          assert.ok(
            knip.files.some((file) => file.endsWith(`unused.${language}`)),
          );
        }
      });
    }
  }
});
