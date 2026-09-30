/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const nonempty = (value) =>
  object(value) || Array.isArray(value)
    ? Object.keys(value).length > 0
    : value !== null && value !== undefined && value !== "";
const result = (status, findingsCount, reason = null) => ({
  status,
  findingsCount,
  reason,
});
const invalid = () => result("failed", null, "invalid_report_structure");

const knipCategories = [
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "enumMembers",
  "classMembers",
  "duplicates",
];

export function inspectKnip(data) {
  if (
    !object(data) ||
    !Array.isArray(data.files) ||
    !data.files.every((file) => typeof file === "string") ||
    !Array.isArray(data.issues)
  ) {
    throw new Error("Invalid Knip report: expected files and issues arrays");
  }
  const counts = { files: data.files.length };
  const unknown = Object.keys(data).filter(
    (key) => !["files", "issues"].includes(key) && nonempty(data[key]),
  );
  const named = (item) => object(item) && typeof item.name === "string";
  for (const issue of data.issues) {
    if (!object(issue) || typeof issue.file !== "string")
      throw new Error("Invalid Knip issue");
    for (const [category, items] of Object.entries(issue)) {
      if (["file", "owners"].includes(category)) continue;
      if (!knipCategories.includes(category)) {
        if (nonempty(items)) unknown.push(category);
        continue;
      }
      let size;
      if (["enumMembers", "classMembers"].includes(category)) {
        if (
          !object(items) ||
          !Object.values(items).every(
            (members) => Array.isArray(members) && members.every(named),
          )
        ) {
          throw new Error(`Invalid Knip category: ${category}`);
        }
        size = Object.values(items).reduce(
          (sum, members) => sum + members.length,
          0,
        );
      } else if (category === "duplicates") {
        if (
          !Array.isArray(items) ||
          !items.every(
            (group) =>
              Array.isArray(group) && group.length > 0 && group.every(named),
          )
        ) {
          throw new Error("Invalid Knip duplicates");
        }
        size = items.length;
      } else {
        if (!Array.isArray(items) || !items.every(named))
          throw new Error(`Invalid Knip category: ${category}`);
        size = items.length;
      }
      counts[category] = (counts[category] ?? 0) + size;
    }
  }
  return {
    counts,
    unknown: [...new Set(unknown)],
    findingsCount: Object.values(counts).reduce((sum, size) => sum + size, 0),
  };
}

function biome(data, exitCode) {
  if (
    !object(data) ||
    !object(data.summary) ||
    !Array.isArray(data.diagnostics)
  )
    return invalid();
  const { summary, diagnostics } = data;
  if (
    !["errors", "warnings", "diagnosticsNotPrinted", "skipped"].every((key) =>
      count(summary[key]),
    )
  )
    return invalid();
  if (
    !diagnostics.every(
      (item) =>
        object(item) &&
        typeof item.category === "string" &&
        ["fatal", "error", "warning", "information", "hint"].includes(
          item.severity,
        ),
    )
  )
    return invalid();
  if (summary.diagnosticsNotPrinted > 0)
    return result("partial", null, "diagnostics_truncated");
  const errors = diagnostics.filter((item) =>
    ["error", "fatal"].includes(item.severity),
  ).length;
  const warnings = diagnostics.filter(
    (item) => item.severity === "warning",
  ).length;
  if (summary.errors !== errors || summary.warnings !== warnings)
    return result("partial", null, "inconsistent_diagnostic_counts");
  const findingsCount = diagnostics.length;
  if (summary.skipped > 0)
    return result("partial", findingsCount, "files_skipped");
  if (
    diagnostics.some(
      (item) =>
        !/^(lint\/|parse(?:\/|$)|syntax(?:\/|$)|format$|organizeImports$|assist\/)/.test(
          item.category,
        ),
    )
  ) {
    return result("partial", findingsCount, "tool_diagnostics");
  }
  return processResult(exitCode, findingsCount);
}

function processResult(exitCode, findingsCount) {
  if (exitCode === 0 || (exitCode === 1 && findingsCount > 0))
    return result("completed", findingsCount);
  return result(
    findingsCount > 0 ? "partial" : "failed",
    findingsCount,
    "unexpected_exit_code",
  );
}

function typescript(stdout, stderr, exitCode) {
  const text = [stdout, stderr].filter(Boolean).join("\n");
  const headers = [
    ...text.matchAll(
      /^(?:(.+)\((\d+),(\d+)\): |)(error|warning) TS(\d+):[^\r\n]*/gm,
    ),
  ];
  if (
    headers.some(
      (match) =>
        !match[1] ||
        /\.json$/i.test(match[1]) ||
        (Number(match[5]) >= 5000 && Number(match[5]) < 6000),
    )
  ) {
    return result("failed", null, "configuration_error");
  }
  if (headers.length === 0) {
    if (exitCode === 0 && !text.trim()) return result("completed", 0);
    return result(
      exitCode === 0 ? "partial" : "failed",
      null,
      "unrecognized_typescript_output",
    );
  }
  // Plain tsc diagnostics may have indented continuation lines. Other output
  // (help, file lists, traces, wrapper messages) is not a verified type check.
  const remainder = text.replace(
    /^(?:(.+)\((\d+),(\d+)\): |)(error|warning) TS(\d+):[^\r\n]*/gm,
    "",
  );
  if (
    remainder.split(/\r?\n/).some((line) => line.trim() && !/^\s/.test(line))
  ) {
    return result("partial", null, "unrecognized_typescript_output");
  }
  if (![1, 2].includes(exitCode))
    return result("partial", headers.length, "unexpected_exit_code");
  return result("completed", headers.length);
}

export function interpretReport(tool, stdout, stderr, exitCode) {
  if (tool === "typescript") return typescript(stdout, stderr, exitCode);
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return result(
      "failed",
      null,
      stdout.trim() ? "invalid_json" : "empty_report",
    );
  }
  if (tool === "biome") return biome(data, exitCode);
  if (tool === "knip") {
    let summary;
    try {
      summary = inspectKnip(data);
    } catch {
      return invalid();
    }
    if (summary.unknown.length)
      return result(
        "partial",
        null,
        `unknown_categories: ${summary.unknown.join(", ")}`,
      );
    return processResult(exitCode, summary.findingsCount);
  }
  if (
    !object(data) ||
    !Array.isArray(data.results) ||
    !Array.isArray(data.errors) ||
    !data.errors.every(object) ||
    !data.results.every(
      (item) =>
        object(item) &&
        typeof item.check_id === "string" &&
        typeof item.path === "string" &&
        object(item.start) &&
        object(item.end) &&
        object(item.extra),
    )
  )
    return invalid();
  if (data.errors.length)
    return result("partial", data.results.length, "analysis_errors");
  return processResult(exitCode, data.results.length);
}
