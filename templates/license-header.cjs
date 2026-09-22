/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

const { execFileSync } = require("node:child_process");
const { lstatSync, readFileSync, writeFileSync } = require("node:fs");

const { licenseType, copyrightHolder, yearRange } = JSON.parse(
  readFileSync("package.json", "utf8"),
).licenseHeader;
const identifiers = {
  mit: "MIT",
  apache: "Apache-2.0",
  proprietary: "LicenseRef-Proprietary",
};
if (!Object.hasOwn(identifiers, licenseType)) {
  throw new Error("License headers support only mit, apache and proprietary.");
}
if ([copyrightHolder, yearRange].some((value) =>
  typeof value !== "string" || !value.trim() || /[\r\n\u2028\u2029]|\*\//.test(value)
)) {
  throw new Error("Copyright holder and year range must be non-empty, single-line comment text.");
}

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
).split("\0");
const excludedDirs = new Set(["node_modules", "dist", "out", ".reports"]);

for (const file of new Set(files)) {
  if (!/\.(js|ts|jsx|tsx)$/.test(file)) continue;
  if (file.split("/").slice(0, -1).some((part) => excludedDirs.has(part))) continue;
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;

  const source = readFileSync(file, "utf8");
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  let body = source.slice(bom.length);
  const eol = body.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const shebang = body.match(/^#![^\r\n]*(?:\r\n|\n|\r|$)/)?.[0] ?? "";
  body = body.slice(shebang.length);
  const comments = body.match(
    /^(?:\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r\n|\n|\r|$)))*/,
  )[0];
  if (/SPDX-|Copyright|@license|Licensed\s+under/i.test(comments)) continue;

  const header = [
    "/*",
    ` * SPDX-FileCopyrightText: Copyright (c) ${yearRange} ${copyrightHolder}`,
    ` * SPDX-License-Identifier: ${identifiers[licenseType]}`,
    " */",
    "",
    "",
  ].join(eol);
  const separator = shebang && !/[\r\n]$/.test(shebang) ? eol : "";
  writeFileSync(file, bom + shebang + separator + header + body);
}
