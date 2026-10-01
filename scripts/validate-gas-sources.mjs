import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(root);
const gasFiles = files.filter((file) => path.extname(file) === '.gs');
const errors = [];
const functionOwners = new Map();

files.filter((file) => path.extname(file) === '').forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  if (/\b(?:function|const|let|var)\b/.test(source)) {
    errors.push(`${path.relative(root, file)}: GASらしいコードに.gs拡張子がありません。`);
  }
});

gasFiles.forEach((file) => {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, 'utf8');
  try {
    new vm.Script(source, { filename: relative });
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
  }

  for (const match of source.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[1];
    if (functionOwners.has(name)) {
      errors.push(`${relative}: function ${name} は ${functionOwners.get(name)} と重複しています。`);
    } else {
      functionOwners.set(name, relative);
    }
  }
});

try {
  JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
} catch (error) {
  errors.push(`appsscript.json: ${error.message}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Validated ${gasFiles.length} GAS files; no extension or duplicate-function problems found.`);
