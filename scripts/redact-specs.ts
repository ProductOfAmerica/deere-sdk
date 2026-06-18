#!/usr/bin/env tsx
/**
 * Redacts sensitive examples from checked-in OpenAPI specs.
 *
 * Usage: pnpm redact-specs
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSpecContent } from './lib/spec-redactor.js';

const SPEC_DIRS = [
  join(process.cwd(), 'specs', 'raw'),
  join(process.cwd(), 'specs', 'fixed'),
] as const;

for (const specDir of SPEC_DIRS) {
  if (!existsSync(specDir)) {
    continue;
  }

  const yamlFiles = readdirSync(specDir)
    .filter((file) => file.endsWith('.yaml'))
    .sort();

  for (const yamlFile of yamlFiles) {
    const path = join(specDir, yamlFile);
    const content = readFileSync(path, 'utf-8');
    const redacted = redactSpecContent(content);
    if (redacted !== content) {
      writeFileSync(path, redacted);
    }
  }
}
