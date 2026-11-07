/**
 * Single source of truth for the Chronos agent prompt lives in
 * src/backend/agentPrompt.ts. This script syncs it into manifest.yml's
 * rovo:agent prompt block so the two never drift.
 *
 * Run after editing the prompt:  node scripts/sync-agent-prompt.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// Load the prompt constant from TypeScript without a build step.
const ts = readFileSync(join(root, 'src/backend/agentPrompt.ts'), 'utf8');
const match = ts.match(/CHRONOS_AGENT_PROMPT = `([\s\S]*?)`;/);
if (!match) {
  console.error('Could not extract CHRONOS_AGENT_PROMPT from agentPrompt.ts');
  process.exit(1);
}
const prompt = match[1].replace(/\s+$/, '');

const manifestPath = join(root, 'manifest.yml');
const manifestYml = readFileSync(manifestPath, 'utf8');

const startMarker = '      prompt: |\n';
const endMarker = '      conversationStarters:';
const start = manifestYml.indexOf(startMarker);
const end = manifestYml.indexOf(endMarker, start);
if (start === -1 || end === -1) {
  console.error('Could not locate the rovo:agent prompt block in manifest.yml');
  process.exit(1);
}

const block = `${startMarker}${prompt
  .split('\n')
  .map((line) => (line.length > 0 ? `        ${line}` : ''))
  .join('\n')}\n`;

const replaced = manifestYml.slice(0, start) + block + manifestYml.slice(end);
writeFileSync(manifestPath, replaced, 'utf8');

// Sanity: manifest must still parse and match the constant.
const parsed = parse(readFileSync(manifestPath, 'utf8'));
const manifestPrompt = parsed.modules['rovo:agent'][0].prompt.replace(/\s+$/, '');
if (manifestPrompt !== prompt) {
  console.error('Synced prompt does not match the source constant.');
  process.exit(1);
}
console.log(`Prompt synced (${prompt.length} chars) into manifest.yml`);
