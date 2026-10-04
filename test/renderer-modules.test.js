import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('every named renderer import is exported by the referenced module', () => {
  const root = path.resolve(import.meta.dirname, '../src/renderer');
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!file.endsWith('.js') || entry.name === 'vendor.js') continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
        if (!match[2].startsWith('.')) continue;
        const target = fs.readFileSync(path.resolve(dir, match[2]), 'utf8');
        const exports = new Set([...target.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(group => group[1].split(',').map(name => name.trim().split(/\s+as\s+/).at(-1))));
        for (const imported of match[1].split(',')) {
          const name = imported.trim().split(/\s+as\s+/)[0];
          assert(exports.has(name), `${path.relative(root, file)} imports missing ${name} from ${match[2]}`);
        }
      }
    }
  }
  visit(root);
});
