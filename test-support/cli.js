import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export const cli = fileURLToPath(new URL("../main.js", import.meta.url));
export const systemPath = Object.entries(process.env)
  .find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";

export function pathEnv(paths, env = process.env) {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "path")),
    PATH: paths.join(delimiter),
  };
}

export function commandPath(bin, command) {
  return join(bin, process.platform === "win32" ? `${command}.cmd` : command);
}

export function writeCommand(bin, command, source) {
  writeFileSync(join(bin, `${command}.cjs`), source);
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const wrapper = process.platform === "win32"
    ? `@"${process.execPath}" "%~dp0${command}.cjs" %*\r\n`
    : `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(bin, `${command}.cjs`))} "$@"\n`;
  writeFileSync(commandPath(bin, command), wrapper, { mode: 0o755 });
}

export function runNpm(args, options = {}) {
  assert.ok(process.env.npm_execpath, "Run these checks through npm test or npm run test:smoke.");
  return spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
    encoding: "utf8",
    ...options,
  });
}

export function packKit(t) {
  const packedDir = mkdtempSync(join(tmpdir(), "quality kit пакет-"));
  t.after(() => rmSync(packedDir, { recursive: true, force: true, maxRetries: 5 }));
  const packed = runNpm([
    "pack", "--json", "--ignore-scripts", "--offline",
    "--cache", join(packedDir, "cache"),
    "--pack-destination", packedDir,
  ], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
  assert.equal(packed.status, 0, packed.stderr);
  const [archive] = JSON.parse(packed.stdout);
  const unpacked = spawnSync("tar", ["-xzf", join(packedDir, archive.filename), "-C", packedDir], {
    encoding: "utf8",
  });
  assert.equal(unpacked.status, 0, unpacked.stderr);
  return join(packedDir, "package");
}

export function useLocalReportParser(pkg, entrypoint) {
  const publishedParser = /(?:npx|bunx) js-ts-quality-checker-kit@[^ ]+ parse-report$/;
  assert.match(pkg.scripts.report, publishedParser);
  pkg.scripts.report = pkg.scripts.report.replace(
    publishedParser,
    () => `node "${entrypoint.replaceAll("\\", "/")}" parse-report`,
  );
}

export function initialize(
  project,
  answers = ["js", "node", "1", "n", "n"],
  entrypoint = cli,
  agentAnswers = [""],
  timeoutMs = 10000,
) {
  answers = [...answers, ...agentAnswers];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], project);
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
