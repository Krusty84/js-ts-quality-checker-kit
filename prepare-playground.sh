#!/bin/sh
# SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
# SPDX-License-Identifier: MIT

set -eu

for command in node npm git; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "$command" >&2
    exit 1
  }
done

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
playground="$root/playground"

if [ -L "$playground" ] || [ ! -d "$playground/.git" ] || [ -L "$playground/.git" ]; then
  printf 'Expected a separate Git repository at %s/.git\n' "$playground" >&2
  exit 1
fi

git -C "$playground" rev-parse --verify 'refs/tags/fixture-baseline^{commit}' >/dev/null

temporary=$(mktemp -d "${TMPDIR:-/tmp}/quality-kit-pack.XXXXXX")
trap 'rm -rf "$temporary"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

cd "$root"
npm pack --json --cache "$temporary/npm-cache" --pack-destination "$temporary" > "$temporary/pack.json"
archive=$(node -e '
  const fs = require("node:fs");
  const [result] = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log(result.filename);
' "$temporary/pack.json")
test -f "$temporary/$archive"

printf 'Resetting %s to fixture-baseline...\n' "$playground"
git -C "$playground" reset --hard refs/tags/fixture-baseline
git -C "$playground" clean -fdx
rm -f "$playground/.git/hooks/pre-commit" "$playground/.git/hooks/pre-push"

cp "$temporary/$archive" "$playground/$archive"
printf 'Package ready: %s/%s\n' "$playground" "$archive"
