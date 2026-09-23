/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

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
  knipConfig.includeEntryExports = projectType === "application";
  writeFileSync(
    join(targetDir, "knip.json"),
    JSON.stringify(knipConfig, null, 2),
  );

  const check = `${runCmd} knip`;
  return {
    dependency: "knip@5.43.0",
    scripts: { "dead-code": check },
    report: `${runCmd} knip --reporter=json > .reports/knip-report.json || node -e "process.exit(0)"`,
    prePush: { name: "dead-code-check", run: check },
  };
}

export function parseKnipReport() {
  const reportPath = join(process.cwd(), ".reports/knip-report.json");
  if (!existsSync(reportPath)) {
    console.error(
      "❌ Report file .reports/knip-report.json not found. Generate the reports first.",
    );
    process.exit(1);
  }
  try {
    const rawData = readFileSync(reportPath, "utf-8");
    const data = JSON.parse(rawData);
    console.log("\n📊 --- DEAD CODE ANALYSIS SUMMARY ---");
    let totalUnusedFiles = 0;
    let totalUnusedExports = 0;
    let totalWastedBytes = 0;
    const filesTable = [];

    if (data.files && data.files.length > 0) {
      totalUnusedFiles = data.files.length;
      for (const file of data.files) {
        let sizeText = "unknown";
        if (existsSync(file)) {
          const stats = statSync(file);
          totalWastedBytes += stats.size;
          sizeText = `${(stats.size / 1024).toFixed(2)} KB`;
        }
        filesTable.push({
          Type: "📁 File",
          "Name / Path": file,
          Size: sizeText,
        });
      }
    }

    if (data.issues) {
      const issueTypes = ["exports", "types", "nsExports"];
      for (const issue of data.issues) {
        for (const type of issueTypes) {
          if (issue[type]) {
            const items = issue[type];
            totalUnusedExports += items.length;
            items.forEach((item) => {
              filesTable.push({
                Type: `❌ Export (${type})`,
                "Name / Path": `${issue.file} -> export { ${item.name} }`,
                Size: "-",
              });
            });
          }
        }
      }
    }

    if (filesTable.length === 0) {
      console.log("✨ Great! No dead code or unused files found.");
    } else {
      console.table(filesTable);
      console.log("\n📉 TOTAL IMPACT:");
      console.log(`   • Unused files: ${totalUnusedFiles}`);
      console.log(`   • Unused exports/types: ${totalUnusedExports}`);
      if (totalWastedBytes > 0) {
        console.log(
          `   • Wasted disk space: ${(totalWastedBytes / 1024).toFixed(2)} KB`,
        );
      }
      console.log(
        "\n💡 Tip: Remove these files and exports to reduce project size and speed up builds.",
      );
    }
  } catch (error) {
    console.error("❌ Error reading or parsing the report:", error);
    process.exitCode = 1;
  }
}
