#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Generate the types from the server
const serverTypesPath = path.join(__dirname, '../../server/routes/index.ts');
const outputPath = path.join(__dirname, '../types/server-router.d.ts');

// Ensure types directory exists
const typesDir = path.dirname(outputPath);
if (!fs.existsSync(typesDir)) {
  fs.mkdirSync(typesDir, { recursive: true });
}

// Create a simple type export that references the server types
const typeContent = `// Auto-generated file. Do not edit manually.
// Re-run 'npm run generate:types' to update.

export type { AppRouter } from '../../../server/routes';
`;

fs.writeFileSync(outputPath, typeContent);
console.log('✅ tRPC types generated successfully');