/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Only rewrite simple invocations. Shell syntax, wrappers and expansions belong
// to the user's script and must be evaluated by their package manager unchanged.
export function reportingCommand(script, tool) {
  if (/[\r\n$`|&;<>()%^!#]/.test(script)) return null;
  if (process.platform !== "win32" && script.includes("\\")) return null;
  const tokens = [...script.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)];
  let end = 0;
  for (const token of tokens) {
    if (script.slice(end, token.index).trim()) return null;
    end = token.index + token[0].length;
  }
  if (script.slice(end).trim()) return null;
  const values = tokens.map(([raw]) => raw.replace(/["']/g, ""));
  let index = 0;
  if (["npx", "bunx"].includes(values[0])) index = 1;
  else if (values[0] === "bun" && values[1] === "x") index = 2;
  const names = {
    biome: ["biome", "@biomejs/biome"],
    knip: ["knip"],
    typescript: ["tsc"],
    semgrep: ["semgrep"],
  };
  if (!names[tool].includes(values[index])) return null;
  if (
    tool === "biome" &&
    !["check", "lint", "ci", "format"].includes(values[index + 1])
  )
    return null;
  if (
    tool === "semgrep" &&
    values[index + 1] !== "scan" &&
    !values[index + 1]?.startsWith("-")
  )
    return null;

  const valueOptions = {
    biome: ["--reporter", "--max-diagnostics"],
    knip: ["--reporter"],
    typescript: ["--pretty"],
    semgrep: ["--output", "-o"],
  };
  const formatOptions =
    tool === "semgrep"
      ? [
          "--json",
          "--sarif",
          "--text",
          "--emacs",
          "--vim",
          "--junit-xml",
          "--gitlab-sast",
          "--gitlab-secrets",
        ]
      : [];
  const reportingOptions = {
    biome: "--reporter=json --max-diagnostics=none",
    knip: "--reporter=json",
    typescript: "--pretty false",
    semgrep: "--json",
  };
  const removed = [];
  const separator = values.indexOf("--", index + 1);
  const optionsEnd = separator === -1 ? tokens.length : separator;
  for (let i = index + 1; i < optionsEnd; i++) {
    const option = values[i].split("=")[0];
    if (valueOptions[tool].includes(option)) {
      const start = tokens[i].index;
      if (!values[i].includes("=")) {
        // tsc accepts --pretty on its own as well as an explicit boolean.
        if (tool !== "typescript" || ["true", "false"].includes(values[i + 1]))
          i++;
        if (i >= optionsEnd) return null;
      }
      removed.push([start, tokens[i].index + tokens[i][0].length]);
    } else if (formatOptions.includes(option)) {
      removed.push([tokens[i].index, tokens[i].index + tokens[i][0].length]);
    }
  }
  const tail =
    separator === -1 ? "" : ` ${script.slice(tokens[separator].index)}`;
  let command =
    separator === -1 ? script : script.slice(0, tokens[separator].index);
  for (const [start, end] of removed.reverse())
    command = command.slice(0, start) + command.slice(end);
  const prefix = script.slice(0, tokens[index].index + tokens[index][0].length);
  return {
    command: `${command.trim()} ${reportingOptions[tool]}${tail}`,
    versionCommand: `${prefix} --version`,
    executable: tool === "typescript" ? "tsc" : tool,
    launcher: values[0],
  };
}
