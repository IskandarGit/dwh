import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const webRoot = process.cwd();
const appRoot = path.join(webRoot, 'src', 'app');
const catalogRoot = path.resolve(webRoot, '..', 'server', 'src', 'main', 'resources', 'i18n');
const supported = ['ru', 'uz', 'en', 'kk', 'ky', 'tg', 'de', 'tr'];
const cyrillic = /[А-Яа-яЁё]/;

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(absolute));
    else if (entry.name.endsWith('.component.ts')) result.push(absolute);
  }
  return result;
}

function withoutComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\r\n]*/g, '');
}

const catalogs = {};
for (const code of supported) {
  catalogs[code] = JSON.parse(await readFile(path.join(catalogRoot, `${code}.json`), 'utf8'));
}
const russianKeys = new Set(Object.keys(catalogs.ru));
const nonTranslationIdentifiers = new Set([
  'analytics.dashboard', 'iam.roles', 'iam.users', 'md.custom_fields', 'md.roles',
  'notify.inbox', 'platform.files', 'rbac.roles', 'role.pcode', 's.pcode',
  'system.custom_fields', 'tasks.items', 'tasks.projects', 'user.theme'
]);
const usedKeys = new Set();
const rawCopy = [];

for (const file of await filesUnder(appRoot)) {
  const source = withoutComments(await readFile(file, 'utf8'));
  for (const match of source.matchAll(/['"]([a-z][a-z0-9_.-]+)['"]\s*\|\s*t\b/g)) usedKeys.add(match[1]);
  for (const match of source.matchAll(/\.translate\(\s*['"]([a-z][a-z0-9_.-]+)['"]/g)) usedKeys.add(match[1]);
  for (const line of source.split(/\r?\n/).filter(candidate => candidate.includes('| t'))) {
    for (const match of line.matchAll(/['"]([a-z][a-z0-9_-]*(?:\.[a-z0-9_.-]+)+)['"]/g)) {
      usedKeys.add(match[1]);
    }
  }
  source.split(/\r?\n/).forEach((line, index) => {
    if (cyrillic.test(line)) rawCopy.push(`${path.relative(webRoot, file)}:${index + 1}: ${line.trim()}`);
  });
}

const missing = [...usedKeys]
  .filter(key => !nonTranslationIdentifiers.has(key) && !russianKeys.has(key))
  .sort();
const unknownByLanguage = supported.slice(1).flatMap(code =>
  Object.keys(catalogs[code])
    .filter(key => !russianKeys.has(key))
    .map(key => `${code}:${key}`)
);
const invalidValues = supported.flatMap(code => Object.entries(catalogs[code])
  .filter(([key, value]) => !key.trim() || typeof value !== 'string' || !value.trim() || value.length > 4000)
  .map(([key]) => `${code}:${key}`));

if (rawCopy.length || missing.length || unknownByLanguage.length || invalidValues.length) {
  if (rawCopy.length) process.stderr.write(`Unlocalized Cyrillic UI copy:\n${rawCopy.join('\n')}\n`);
  if (missing.length) process.stderr.write(`Translation keys missing from ru.json:\n${missing.join('\n')}\n`);
  if (unknownByLanguage.length) process.stderr.write(`Non-Russian catalog keys absent from ru.json:\n${unknownByLanguage.join('\n')}\n`);
  if (invalidValues.length) process.stderr.write(`Invalid translation values:\n${invalidValues.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Localization audit passed: ${usedKeys.size} referenced keys, ${russianKeys.size} Russian catalog keys.\n`);
