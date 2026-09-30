# js-ts-quality-checker-kit

Set up code quality checks for a JavaScript or TypeScript project with one command:

- **Biome** checks formatting and lint rules.
- **Knip** finds unused files, exports and dependencies.
- **TypeScript** checks types in TS projects.
- **Semgrep** scans for security issues, if enabled.

Run the checks yourself or use the included skill with your coding agent.

## Get started

You need Node.js 20.12 or newer and a project with `package.json` and a Git repository.
Run the setup in your project's root directory:

```sh
npx js-ts-quality-checker-kit
# For Bun projects:
bunx js-ts-quality-checker-kit
```

Follow the terminal prompts to choose your language, package manager and project type.
Setup installs the checking tools, writes their configurations, adds package scripts
and sets up Git hooks. Security scans, license headers and agent skills are optional.

Then get a full report:

```sh
npm run report
# Or:
bun run report
```

## Everyday commands

Run these from your project's root directory after setup:

| Command                         | What it does                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `npm run report`                | Run all configured checks and show a readable summary           |
| `npm run --silent report:agent` | Run the same checks and output JSON for an agent or automation  |
| `npm run lint`                  | Check formatting and lint rules                                 |
| `npm run typecheck`             | Check TypeScript types, if configured                           |
| `npm run dead-code`             | Find unused code and dependencies                               |
| `npm run security-check`        | Run Semgrep, if configured                                      |
| `npm run lint:fix`              | Apply formatting and lint fixes                                 |
| `npm run license:fix`           | Add license headers, if configured                              |
| `npm run validate`              | Run the configured validation sequence; may add license headers |

With Bun, use `bun run <command>`, including `bun run report:agent`.
The npm `--silent` option keeps its script banner out of the JSON output.

The standard report commands do **not** change source files or apply fixes.
Fix commands and Git hooks can change files. Review actual usage before deleting
anything reported by Knip.

## Understand the results

A report includes your current `typecheck` script and continues with the other checks
when one fails. Both report commands save the same results and use these exit codes:

| Code | Meaning                                            | Next step                                                          |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `0`  | All configured checks completed with no findings   | No action needed                                                   |
| `1`  | Checks completed with findings, including warnings | Review the findings and rerun affected checks after fixing them    |
| `2`  | A check failed or its result is incomplete         | Read the reported reason and logs, resolve the problem, then rerun |

A failure takes priority over findings. Optional checks that were not configured
are shown as skipped. Missing required checks or tools are failures.

All report files are saved in `.reports/`. Start with **`report.json`**, which contains
the overall result, each check's status and paths to the details:

| File                           | Details                                           |
| ------------------------------ | ------------------------------------------------- |
| `biome-report.json`            | Formatting and lint diagnostics                   |
| `knip-report.json`             | Unused code, dependencies and other Knip findings |
| `typescript-report.txt`        | TypeScript diagnostics                            |
| `security-report.json`         | Semgrep findings and scan errors                  |
| `*.stdout.txt`, `*.stderr.txt` | Individual checks' output and logs                |

Only configured checks that run produce their detailed reports.
Semgrep needs its CLI and network access for the default rules; a failed download
or scan is an incomplete check, not a clean result.

Reports use the scripts currently in your `package.json`. Custom scripts keep their
own behavior, including any file changes. If their output cannot be interpreted
reliably, the report returns `2` and keeps the full text for you to inspect.

## Use with a coding agent

During setup, select Codex or Claude Code to install the `js-ts-quality-checker`
skill. Existing skill files are preserved.

For a full check, the agent can run `npm run --silent report:agent`, read
`.reports/report.json`, then open the relevant detailed reports. Incomplete checks
must be resolved before treating the results as successful.

<details>
<summary>Update reports in an existing project</summary>

If you already use the kit, update the report scripts and exclusions below.
You do not need to rerun setup, which also rewrites checking configurations and hooks.

In `package.json`, set these two scripts using a kit version that includes the new
report commands (the repository's current version is `1.0.0`):

```json
{
  "report": "npx js-ts-quality-checker-kit@1.0.0 report --format=human --package-manager=npm",
  "report:agent": "npx js-ts-quality-checker-kit@1.0.0 report --format=json --package-manager=npm"
}
```

For Bun, replace `npx` with `bunx` and `--package-manager=npm` with
`--package-manager=bun`. Keep your other scripts and tool versions.

To prevent checks from scanning their own reports, add these exclusions while
keeping existing entries:

- Biome 1.9.4: `.reports/**` in `files.ignore`.
- Knip: `.reports/**` in `ignore`.
- Semgrep: `.reports/` in `.semgrepignore`.
- Your own TypeScript config: `.reports/` in `exclude`, if it otherwise includes generated files.

The kit configurations already exclude reports from Biome, Knip and Semgrep.
Add `.reports/` to `.gitignore` to keep local reports out of commits.
