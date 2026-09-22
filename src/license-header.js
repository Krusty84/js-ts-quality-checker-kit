/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 Alexey Sedoykin
 * SPDX-License-Identifier: MIT
 */

import { cpSync } from "node:fs";
import { join } from "node:path";

export const licenseHeaderScripts = {
  "license:fix": "node .license-header.cjs",
};

export const licenseHeaderPreCommit = {
  name: "license-header",
  priority: 1,
  glob: "*.{js,ts,jsx,tsx}",
  run: licenseHeaderScripts["license:fix"],
};

export function validateLicenseType(licenseType) {
  if (licenseType && !["mit", "apache", "proprietary"].includes(licenseType)) {
    throw new Error(
      "License headers support only mit, apache and proprietary.",
    );
  }
}

export function configureLicenseHeader({
  targetDir,
  templatesDir,
  licenseType,
  copyrightHolder,
}) {
  const currentYear = new Date().getFullYear();
  cpSync(
    join(templatesDir, "license-header.cjs"),
    join(targetDir, ".license-header.cjs"),
  );
  return {
    licenseType: licenseType,
    copyrightHolder: copyrightHolder,
    yearRange: String(currentYear),
  };
}
