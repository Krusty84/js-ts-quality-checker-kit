---
name: js-ts-quality-checker
description: Choose and run project quality checks after JavaScript or TypeScript changes, or when asked to check code quality, types, unused code, security, or reports in a project configured with js-ts-quality-checker-kit.
---

# JS/TS quality checks

## Select checks

Read the project's current `package.json` and inspect the changes before choosing commands.
Run from the directory containing that package file. Use its scripts as the source of truth.
The configured runner is `{{run}}`; follow the current package manager if the project has migrated.
Choose all checks relevant to the task. Documentation-only changes need no JS/TS checks unless requested.

| Task or change | Command |
| --- | --- |
| Source code or Biome configuration | `{{run}} lint` |
| TypeScript code or compiler configuration | `{{run}} typecheck`, if configured |
| Added, removed or renamed source files; imports, exports, dependencies or Knip configuration | `{{run}} dead-code` |
| Security review or security-sensitive changes, such as authentication, input handling or command execution | `{{run}} security-check`, if configured |
| Full diagnostics | `{{run}} report:agent` |
| Human-readable summary | `{{run}} report` |
| Requested formatting or lint fixes | `{{run}} lint:fix` |
| Requested license header changes | `{{run}} license:fix`, if configured |

Check each script exists before running it. If a requested or relevant check is unavailable,
report it as not configured; do not invent a command or silently count it as passed.
For npm JSON output, use `npm run --silent report:agent` to suppress npm's banner.

## Read full diagnostics

`report` and `report:agent` use the same collector and save `.reports/report.json`.
Read this common JSON first: inspect `complete`, `exitCode`, and every entry in `checks`.
Then read the native file at each relevant `reportPath`, plus `stdoutPath` and `stderrPath` as needed.
Paths are relative to the project root. Native reports retain messages, positions, grouping and metadata.
The common JSON contains check summaries, not a normalized list of individual findings.

Collector exit codes are `0` for complete checks without findings, `1` for complete checks with
findings (including warnings), and `2` for failure or incomplete interpretation. Code `2` takes priority.
A check's `exitCode` is its original process code: TypeScript can return `2` for ordinary type errors.
`partial` or `failed` checks must never be described as passed, even if their process returned `0`.
Unknown counts and versions are `null`. Optional checks marked `skipped` with `not_configured`
do not make the aggregate incomplete; missing mandatory checks do.

If the project still has the old shell-chain `report`, run the available diagnostic scripts separately
and record each result. Continue after failure; do not join the checks with `&&`.
The legacy report suppresses failures, can run license fixes, and omits type checking.

## Account for side effects

Inspect script definitions before running them. The kit's standard reporting commands only write
report artifacts, never invoke `license:fix`, `lint:fix` or `validate`, and include the current `typecheck`.
Custom scripts retain their own side effects. Compound or unknown scripts keep their text output
and receive `partial` with an unknown count, because their output cannot be reliably interpreted.

`lint:fix` writes source files, and `license:fix` adds source headers. `validate` may also run `license:fix`.
Run fixes only within the user's task scope; a request to inspect code does not request changes.
Semgrep uses a system CLI and registry rules; missing tools, analysis errors, timeouts and network
failures are incomplete checks, even when some findings are available.

## Interpret results

Report the commands run, which completed, findings, and any failed, partial or skipped checks and their reasons.
Distinguish code findings from missing tools, dependencies, configuration, or network access.
Inspect Knip findings and actual usage before proposing removals; its output alone is not a reason to delete code.
After an authorized fix, rerun the affected checks and review the diff for unrelated changes.
Regenerate the aggregate report when an updated full report is needed; old artifacts are not verification of a fix.
If a check still fails, report the remaining issue; do not weaken rules just to obtain a passing result.
