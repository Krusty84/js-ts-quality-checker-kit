/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { inspectKnip } from "./report-formats.js";

export function configureKnip({ targetDir, projectType, runCmd }) {
  const knipConfig = { $schema: "https://unpkg.com/knip@5.43.0/schema.json" };
  const extension = "{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
  knipConfig.entry = projectType === "vscode"
    ? [`src/extension.${extension}`, `extension.${extension}`]
    : [
        `src/index.${extension}`,
        `index.${extension}`,
        `src/main.${extension}`,
        `main.${extension}`,
      ];
  knipConfig.project = [`**/*.${extension}`];
  knipConfig.ignore = [".reports/**"];
  knipConfig.includeEntryExports = projectType === "application";
  writeFileSync(
    join(targetDir, "knip.json"),
    JSON.stringify(knipConfig, null, 2),
  );

  const check = `${runCmd} knip`;
  return {
    dependency: "knip@5.43.0",
    scripts: { "dead-code": check },
    prePush: { name: "dead-code-check", run: check },
  };
}

export function parseKnipReport() {
  const reportPath = join(process.cwd(), ".reports/knip-report.json");
  if (!existsSync(reportPath)) {
    console.error("Report file .reports/knip-report.json not found. Generate the reports first.");
    process.exitCode = 1;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(reportPath, "utf8"));
    const summary = inspectKnip(data);
    console.log("\nKNIP ANALYSIS SUMMARY");
    let totalBytes = 0;
    for (const file of data.files) {
      console.log(`File: ${file}`);
      if (existsSync(file)) totalBytes += statSync(file).size;
    }
    // Print native category values intact, including member/duplicate grouping
    // and all available positions. This is not a normalized findings schema.
    for (const issue of data.issues) {
      console.log(`\n${issue.file}`);
      for (const [category, items] of Object.entries(issue)) {
        if (category !== "file" && items != null && Object.keys(Object(items)).length) {
          console.log(`${category}: ${JSON.stringify(items, null, 2)}`);
        }
      }
    }
    for (const category of summary.unknown) {
      if (Object.hasOwn(data, category)) console.log(`${category}: ${JSON.stringify(data[category], null, 2)}`);
    }
    console.log(`\nUnused files: ${summary.counts.files}`);
    console.log(`Unused exports/types: ${["exports", "types", "nsExports", "nsTypes"].reduce((sum, key) => sum + (summary.counts[key] ?? 0), 0)}`);
    for (const [category, count] of Object.entries(summary.counts)) {
      if (category !== "files" && count) console.log(`${category}: ${count}`);
    }
    if (totalBytes) console.log(`Wasted disk space: ${(totalBytes / 1024).toFixed(2)} KB`);
    if (summary.unknown.length) {
      console.warn(`Incomplete interpretation; unknown categories: ${summary.unknown.join(", ")}. Read the native report.`);
    } else if (summary.findingsCount === 0) {
      console.log("No Knip findings.");
    }
    if (summary.findingsCount > 0 || summary.unknown.length) {
      console.log("Review these findings and verify actual usage before removing code or dependencies.");
    }
  } catch (error) {
    console.error("Error reading or parsing the report:", error.message);
    process.exitCode = 1;
  }
}
