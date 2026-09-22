---
name: js-ts-quality-checks
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
| Full diagnostics | Run each available diagnostic script above separately |
| Requested formatting or lint fixes | `{{run}} lint:fix` |
| Requested license header changes | `{{run}} license:fix`, if configured |
| Requested report files | `{{run}} report`, after checking its effects below |

Check each script exists before running it. If a requested or relevant check is unavailable,
report it as not configured; do not invent a command or silently count it as passed.
For full diagnostics, run `lint`, `typecheck`, `dead-code`, and `security-check` where available.
Record each result and continue the other checks after a failure; do not join them with `&&`.

## Account for side effects

Inspect script definitions before using fix or aggregate commands.
`lint:fix` writes source files, and `license:fix` adds source headers.
The kit's `validate` and `report` may also run `license:fix` and change source files.
For diagnostics without source changes, use individual diagnostic scripts instead.
Run fixes only within the user's task scope; a request to inspect code does not request changes.

`report` writes files under `.reports/` and suppresses checker failures.
A successful report command does not establish that the checks passed, and it does not check types.
Read the generated reports and run `typecheck` separately when types are part of the task.
Semgrep uses a system CLI and registry rules; an unavailable CLI or network failure is a blocked check.

## Interpret results

Report the commands run, which passed, findings, and any checks that failed to run or were skipped.
Distinguish code findings from missing tools, dependencies, configuration, or network access.
Inspect Knip findings and actual usage before proposing removals; its output alone is not a reason to delete code.
After an authorized fix, rerun the affected check and review the diff for unrelated changes.
If the check still fails, report the remaining issue; do not weaken rules just to obtain a passing result.
