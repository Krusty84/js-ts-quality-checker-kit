/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

// Emulate terminal capabilities for keyboard-driven CLI tests over pipes.
process.stdin.isTTY = true;
process.stdin.setRawMode = (enabled) => {
  process.stdin.isRaw = enabled;
  return process.stdin;
};
process.stdout.isTTY = true;
process.stdout.columns = 120;
process.stdout.rows = 40;
