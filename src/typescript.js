/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

export function getTypeScriptCommands({ isBun }) {
  return {
    dependency: "typescript@5",
    validate: isBun ? "bun x tsc --noEmit" : "tsc --noEmit",
    prePush: {
      name: "types-check",
      run: `${isBun ? "bun x tsc" : "npx tsc"} --noEmit`,
    },
  };
}
