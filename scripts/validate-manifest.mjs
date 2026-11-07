/**
 * Offline manifest validation.
 *
 * Validates manifest.yml against the EXACT JSON schema shipped inside
 * @forge/manifest (the package @forge/cli bundles) using ajv. This is the
 * same schema `forge lint` checks before its login-requiring steps, so it
 * can run in CI / on planes / without an Atlassian account.
 *
 * The only deliberate exception: `app.id` is a placeholder uuid until
 * `forge register` assigns the real ARI, so that pattern is checked
 * separately below.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const manifest = parse(readFileSync(join(root, 'manifest.yml'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'node_modules/@forge/manifest/out/schema/manifest-schema.json'), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
// Remove the $schema keyword ajv doesn't understand and add required defs.
const validate = ajv.compile(schema);

const ok = validate(manifest);
const appIdOk = typeof manifest.app?.id === 'string' && /^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/.test(manifest.app.id);

if (!ok) {
  console.error('manifest.yml FAILED schema validation:');
  for (const err of validate.errors ?? []) {
    console.error(`  ${err.instancePath || '<root>'} ${err.message}${err.params ? ` (${JSON.stringify(err.params)})` : ''}`);
  }
  process.exit(1);
}
if (!appIdOk) {
  console.error('app.id must match ari:cloud:ecosystem::app/<uuid> (placeholder ok until forge register)');
  process.exit(1);
}

const modules = Object.keys(manifest.modules ?? {});
console.log(`manifest.yml valid against @forge/manifest schema (${modules.length} module types: ${modules.join(', ')})`);
console.log(`app.id placeholder: ${manifest.app.id}`);
