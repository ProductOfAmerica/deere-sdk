#!/usr/bin/env tsx
/**
 * Generates TypeScript types from John Deere OpenAPI specs using openapi-typescript.
 *
 * Usage: pnpm generate-types
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SPECS_DIR = join(process.cwd(), 'specs', 'fixed');
const OUTPUT_DIR = join(process.cwd(), 'src', 'types', 'generated');

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

async function main() {
  console.log('Generating TypeScript types from OpenAPI specs...\n');

  if (!existsSync(SPECS_DIR)) {
    console.error(`Specs directory not found: ${SPECS_DIR}`);
    console.error('Run `pnpm fetch-specs` and `pnpm fix-specs` first.');
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const yamlFiles = readdirSync(SPECS_DIR).filter((f) => f.endsWith('.yaml'));
  console.log(`Found ${yamlFiles.length} OpenAPI specs\n`);

  const generated: { name: string; module: string; file: string }[] = [];

  for (const yamlFile of yamlFiles) {
    const inputPath = join(SPECS_DIR, yamlFile);
    const moduleName = toPascalCase(basename(yamlFile, '.yaml').replace(/-api$/, ''));
    const outputFile = `${basename(yamlFile, '.yaml')}.ts`;
    const outputPath = join(OUTPUT_DIR, outputFile);

    const fileSize = statSync(inputPath).size;
    if (fileSize === 0) {
      console.log(`Skipping ${moduleName}... (empty file)`);
      continue;
    }

    process.stdout.write(`Generating ${moduleName}...`);

    try {
      execSync(`npx openapi-typescript "${inputPath}" -o "${outputPath}"`, { stdio: 'pipe' });
      const generatedSource = readFileSync(outputPath, 'utf-8');
      // Check for any HTML tags leaked into property names (not just <b>)
      const htmlInPropertyMatch = generatedSource.match(/"[^"]*<(b|sup|span|a|\/\w+)[^"]*":/);
      if (htmlInPropertyMatch) {
        throw new Error(
          `HTML leaked into property name in ${outputFile}: ${htmlInPropertyMatch[0]}`
        );
      }
      console.log(' OK');
      generated.push({ name: yamlFile, module: moduleName, file: outputFile });
    } catch (error) {
      console.error(`Failed generating ${moduleName}:`, error);
    }
  }

  // Generate index file
  console.log('\nGenerating index file...');

  const indexContent = `/**
 * John Deere API TypeScript Types
 * Auto-generated from OpenAPI specifications
 *
 * @generated ${new Date().toISOString()}
 */

${generated.map((g) => `export * as ${g.module} from './${basename(g.file, '.ts')}.js';`).join('\n')}

${generated.map((g) => `export type { paths as ${g.module}Paths, components as ${g.module}Components } from './${basename(g.file, '.ts')}.js';`).join('\n')}
`;

  writeFileSync(join(OUTPUT_DIR, 'index.ts'), indexContent);

  console.log(`\nGenerated ${generated.length} type modules`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('\nNext: Run `pnpm generate-sdk` to generate SDK wrappers');
}

main().catch(console.error);
