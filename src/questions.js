/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import * as prompts from "@clack/prompts";
import { prepareSemgrep } from "./semgrep.js";

async function answer(prompt) {
  const value = await prompt;
  if (prompts.isCancel(value)) throw value;
  return value;
}

export async function askQuestions({ name }) {
  prompts.box(`\n${name}\n`, "", {
    rounded: false,
    contentAlign: "center",
    width: "auto",
    withGuide: false,
    formatBorder: (border) =>
      ({
        "┌": "╔",
        "┐": "╗",
        "└": "╚",
        "┘": "╝",
        "─": "═",
        "│": "║",
      })[border] ?? border,
  });
  console.log(
    "\nAuthor: Alexey Sedoykin\nContact|Support: www.linkedin.com/in/sedoykin | https://github.com/Krusty84/js-ts-quality-checker-kit\n",
  );
  try {
    const language = await answer(
      prompts.select({
        message: "Which language does your project use?",
        options: [
          { value: "js", label: "JavaScript" },
          { value: "ts", label: "TypeScript" },
        ],
        initialValue: "js",
      }),
    );
    const runtime = await answer(
      prompts.select({
        message: "Which runtime do you use?",
        options: [
          { value: "node", label: "Node.js" },
          { value: "bun", label: "Bun" },
        ],
        initialValue: "node",
      }),
    );
    const projectType = await answer(
      prompts.select({
        message: "Select your project type.",
        options: [
          {
            value: "application",
            label: "Application",
            hint: "Standalone app; checks unused entry exports",
          },
          {
            value: "library",
            label: "Library / npm package",
            hint: "Reusable code; preserves public entry exports",
          },
          {
            value: "vscode",
            label: "VS Code extension",
            hint: "Extension entry points and build exclusions",
          },
        ],
        initialValue: "application",
      }),
    );
    const wantsSemgrep = await answer(
      prompts.confirm({
        message: "Configure security checks with Semgrep?",
        initialValue: false,
      }),
    );
    const wantsLicense = await answer(
      prompts.confirm({
        message: "Automatically add license headers to source files?",
        initialValue: true,
      }),
    );
    let licenseType = "";
    let copyrightHolder = "";
    if (wantsLicense) {
      licenseType = await answer(
        prompts.select({
          message: "Select a license.",
          options: [
            { value: "mit", label: "MIT" },
            { value: "apache", label: "Apache-2.0" },
            { value: "proprietary", label: "Proprietary" },
          ],
          initialValue: "mit",
        }),
      );
      copyrightHolder = await answer(
        prompts.text({
          message: "Enter the copyright holder (Name / Company).",
          placeholder: "Leave blank to skip license headers.",
          defaultValue: "",
        }),
      );
    }
    prompts.log.info("Select none to skip.");
    const agentTargets = await answer(
      prompts.multiselect({
        message: "Select coding agents for the quality-checking skill.",
        options: [
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude Code" },
        ],
        initialValues: ["codex"],
        required: false,
      }),
    );
    const useSemgrep =
      wantsSemgrep &&
      (await prepareSemgrep(() =>
        answer(
          prompts.confirm({
            message: "Semgrep CLI is unavailable. Install it with pipx now?",
            initialValue: false,
          }),
        ),
      ));
    return {
      isTS: language === "ts",
      isBun: runtime === "bun",
      projectType,
      useSemgrep,
      licenseType,
      copyrightHolder,
      agentTargets,
    };
  } catch (error) {
    if (!prompts.isCancel(error)) throw error;
    prompts.cancel("Setup cancelled.");
    return null;
  }
}
