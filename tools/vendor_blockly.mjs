#!/usr/bin/env node
/** Copy only Blockly's offline editor, Korean messages and required artwork. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pinnedVersion = '13.4.0';
const packageRoot = join(root, 'node_modules/blockly');
const version = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
if (version !== pinnedVersion) throw new Error(`Blockly ${pinnedVersion} is required; npm ci before generating vendor assets.`);
const files = new Map([
  ['blockly_compressed.js', 'blockly_compressed.js'], ['msg/ko.js', 'ko.js'], ['LICENSE', 'LICENSE.txt'],
  ...['1x1.gif', 'delete-icon.svg', 'dropdown-arrow.svg', 'foldout-icon.svg', 'handclosed.cur', 'handdelete.cur', 'handopen.cur', 'resize-handle.svg', 'sprites.svg'].map((name) => [`media/${name}`, `media/${name}`]),
]);
const check = process.argv.includes('--check');
for (const [source, destination] of files) {
  const bytes = await readFile(join(packageRoot, source));
  const path = join(root, 'web/vendor/blockly', destination);
  if (check) {
    let existing;
    try { existing = await readFile(path); } catch { /* Report a missing generated file below. */ }
    if (!existing || !bytes.equals(existing)) throw new Error(`${path} is stale; run node tools/vendor_blockly.mjs`);
  } else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
}
console.log(`${check ? 'Verified' : 'Vendored'} Blockly ${version}: ${files.size} offline assets; no CDN or generated JavaScript execution.`);
