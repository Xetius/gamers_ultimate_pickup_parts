// Checks that every mod file BeamNG reads will parse, and that no part name is defined twice
// where the game would load both copies. Exits non-zero on any error.
// Usage: node .github/scripts/validate.js [repo root]
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');

// jbeam is relaxed JSON: commas are optional, // and /* */ comments are allowed
function parseJbeam(src) {
  let i = 0;
  const fail = (msg) => { throw new Error(`${msg} at line ${src.slice(0, i).split('\n').length}`); };
  const skip = () => {
    for (;;) {
      while (i < src.length && /[\s,]/.test(src[i])) i++;
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) fail('unterminated comment');
        i = end + 2;
        continue;
      }
      return;
    }
  };
  function value() {
    skip();
    const c = src[i];
    if (c === '{') {
      i++;
      const obj = {};
      for (;;) {
        skip();
        if (src[i] === '}') { i++; return obj; }
        if (i >= src.length) fail('unterminated object');
        const key = value();
        if (typeof key !== 'string') fail('object key is not a string');
        skip();
        if (src[i] !== ':') fail(`expected ':' after ${JSON.stringify(key)}`);
        i++;
        obj[key] = value();
      }
    }
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        skip();
        if (src[i] === ']') { i++; return arr; }
        if (i >= src.length) fail('unterminated array');
        arr.push(value());
      }
    }
    if (c === '"') {
      let end = i + 1;
      while (src[end] !== '"') {
        if (src[end] === '\\') end++;
        if (src[end] === '\n' || end >= src.length) fail('unterminated string');
        end++;
      }
      const s = src.slice(i + 1, end);
      i = end + 1;
      return s;
    }
    const m = src.slice(i, i + 40).match(/^(-?\d*\.?\d+(?:[eE][-+]?\d+)?|true|false|null|-?FLT_MAX)(?![\d.])/);
    if (!m) fail(`unexpected ${JSON.stringify(src.slice(i, i + 20))}`);
    i += m[0].length;
    return m[0];
  }
  const doc = value();
  skip();
  if (i < src.length) fail('unexpected content after the closing brace');
  return doc;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function main() {
  const errors = [];
  const rel = (f) => path.relative(root, f).replace(/\\/g, '/');
  const partsByFolder = {}; // top-level vehicle folder -> part name -> [files]
  let counts = { jbeam: 0, pc: 0, json: 0 };

  for (const file of walk(path.join(root, 'vehicles')).concat(walk(path.join(root, 'mod_info')))) {
    const name = file.toLowerCase();
    const text = () => fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    try {
      if (name.endsWith('.jbeam')) {
        counts.jbeam++;
        const raw = text();
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) throw new Error('contains control characters');
        const doc = parseJbeam(raw);
        const folder = rel(file).split('/')[1];
        for (const part of Object.keys(doc)) {
          const byName = (partsByFolder[folder] = partsByFolder[folder] || {});
          (byName[part] = byName[part] || []).push(rel(file));
        }
      } else if (name.endsWith('.pc')) {
        counts.pc++;
        const pc = JSON.parse(text());
        if (!pc.parts || typeof pc.parts !== 'object') throw new Error('no "parts" table');
      } else if (/(^|[\\/])info[^\\/]*\.json$|\.paintlibrary\.json$/.test(name)) {
        counts.json++;
        JSON.parse(text());
      }
    } catch (e) {
      errors.push(`${rel(file)}: ${e.message}`);
    }
  }

  // a vehicle loads its own folder plus vehicles/common, so names must be unique across that pair
  const common = partsByFolder.common || {};
  for (const [folder, byName] of Object.entries(partsByFolder)) {
    for (const [part, files] of Object.entries(byName)) {
      const all = folder === 'common' ? files : files.concat(common[part] || []);
      if (all.length > 1 && (folder !== 'common' || files.length > 1)) {
        errors.push(`duplicate part "${part}" in ${[...new Set(all)].join(', ')}`);
      }
    }
  }

  console.log(`checked ${counts.jbeam} jbeam, ${counts.pc} pc, ${counts.json} json files`);
  if (errors.length) {
    console.error(`${errors.length} problem(s):\n  ${[...new Set(errors)].join('\n  ')}`);
    process.exit(1);
  }
  console.log('all files valid');
}

module.exports = { parseJbeam };
if (require.main === module) main();
