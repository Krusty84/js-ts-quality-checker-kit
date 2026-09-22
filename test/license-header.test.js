import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const template = new URL("../templates/license-header.cjs", import.meta.url);
const mitHeader = "/*\n * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin\n * SPDX-License-Identifier: MIT\n */\n\n";

function fixture(t, licenseHeader = {}, type = "module") {
  const cwd = mkdtempSync(join(tmpdir(), "spdx-header-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = spawnSync("git", ["init", "--quiet"], { cwd, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  writeFileSync(join(cwd, "package.json"), JSON.stringify({
    type,
    licenseHeader: {
      licenseType: "mit",
      copyrightHolder: "Alexey Sedoykin",
      yearRange: "2026",
      ...licenseHeader,
    },
  }));
  cpSync(template, join(cwd, ".license-header.cjs"));
  return cwd;
}

function applyHeaders(cwd) {
  const result = spawnSync(process.execPath, [".license-header.cjs"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

for (const [licenseType, identifier] of [
  ["mit", "MIT"],
  ["apache", "Apache-2.0"],
  ["proprietary", "LicenseRef-Proprietary"],
]) {
  test(`writes the exact ${identifier} header using configured values`, (t) => {
    const cwd = fixture(t, {
      licenseType,
      copyrightHolder: "Example Company",
      yearRange: "2024-2026",
    });
    const source = "export const value = 1;\n";
    for (const extension of ["js", "ts", "jsx", "tsx"]) {
      writeFileSync(join(cwd, `index.${extension}`), source);
    }
    applyHeaders(cwd);
    const expected = `/*\n * SPDX-FileCopyrightText: Copyright (c) 2024-2026 Example Company\n * SPDX-License-Identifier: ${identifier}\n */\n\n${source}`;
    for (const extension of ["js", "ts", "jsx", "tsx"]) {
      assert.equal(readFileSync(join(cwd, `index.${extension}`), "utf8"), expected);
    }
    applyHeaders(cwd);
    for (const extension of ["js", "ts", "jsx", "tsx"]) {
      assert.equal(readFileSync(join(cwd, `index.${extension}`), "utf8"), expected);
    }
  });
}

test("preserves existing license headers in leading block and line comments", (t) => {
  const cwd = fixture(t);
  const sources = [
    "/* SPDX-License-Identifier: Apache-2.0 */\nexport {};\n",
    "/* copyright 1999 Another Author */\nexport {};\n",
    "// @license MIT\nexport {};\n",
    "// Description\n// Licensed under the Apache License\nexport {};\n",
    "/* Description */\n\n/* Copyright 2000 Another Author */\nexport {};\n",
    "\uFEFF#!/usr/bin/env node\r\n// SPDX-FileCopyrightText: Another Author\r\nconsole.log('hello');\r\n",
  ];
  for (const [index, source] of sources.entries()) {
    writeFileSync(join(cwd, `${index}.js`), source);
  }
  applyHeaders(cwd);
  for (const [index, source] of sources.entries()) {
    assert.equal(readFileSync(join(cwd, `${index}.js`), "utf8"), source);
  }
});

test("preserves ordinary comments and does not mistake source text for a header", (t) => {
  const cwd = fixture(t, {}, "commonjs");
  const source = "/* Entry point */\n// Prints a label\nconsole.log('Copyright');\n// Licensed under MIT\n";
  writeFileSync(join(cwd, "index.js"), source);
  applyHeaders(cwd);
  assert.equal(readFileSync(join(cwd, "index.js"), "utf8"), mitHeader + source);
});

test("preserves BOM, shebang and line endings, including a shebang without a newline", (t) => {
  const cwd = fixture(t);
  const cases = [
    ["\uFEFF", "\n", "console.log('hello');\n"],
    ["#!/usr/bin/env node\n", "\n", "console.log('hello');\n"],
    ["\uFEFF#!/usr/bin/env node\r\n", "\r\n", "console.log('hello');\r\n"],
    ["", "\r\n", "// Entry point\r\nconsole.log('hello');\r\n"],
    ["#!/usr/bin/env node", "\n", ""],
    ["", "\n", ""],
  ];
  for (const [index, [prefix, , source]] of cases.entries()) {
    writeFileSync(join(cwd, `${index}.js`), prefix + source);
  }
  applyHeaders(cwd);
  for (const [index, [prefix, eol, source]] of cases.entries()) {
    const separator = prefix.startsWith("#!") && !prefix.endsWith("\n") ? eol : "";
    assert.equal(
      readFileSync(join(cwd, `${index}.js`), "utf8"),
      prefix + separator + mitHeader.replaceAll("\n", eol) + source,
    );
  }
});

test("handles Git paths and excludes ignored, generated, linked and missing files", (t) => {
  const cwd = fixture(t);
  const source = "export const value = 1;\n";
  const included = ["tracked.js", "with spaces.ts", "with\nnewline.tsx"];
  const excluded = ["ignored.js", "notes.txt", "module.mjs", "outside.txt"];
  for (const file of [...included, ...excluded, "deleted.js"]) {
    writeFileSync(join(cwd, file), source);
  }
  for (const directory of ["node_modules", "dist", "out", ".reports", "nested/dist"]) {
    mkdirSync(join(cwd, directory), { recursive: true });
    const file = `${directory}/generated.js`;
    writeFileSync(join(cwd, file), source);
    excluded.push(file);
  }
  writeFileSync(join(cwd, ".gitignore"), "ignored.js\n");
  symlinkSync("outside.txt", join(cwd, "linked.js"));
  symlinkSync("absent.txt", join(cwd, "broken-link.js"));
  const git = spawnSync("git", ["add", "tracked.js", "deleted.js", "dist/generated.js"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(git.status, 0, git.stderr);
  rmSync(join(cwd, "deleted.js"));
  const helperBefore = readFileSync(join(cwd, ".license-header.cjs"), "utf8");
  applyHeaders(cwd);
  for (const file of included) {
    assert.equal(readFileSync(join(cwd, file), "utf8"), mitHeader + source);
  }
  for (const file of excluded) {
    assert.equal(readFileSync(join(cwd, file), "utf8"), source);
  }
  assert.equal(existsSync(join(cwd, "deleted.js")), false);
  assert.equal(readFileSync(join(cwd, ".license-header.cjs"), "utf8"), helperBefore);
});
