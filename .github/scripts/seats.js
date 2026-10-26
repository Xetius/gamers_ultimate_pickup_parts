// Resolves every config's part tree (mod + vanilla parts) and reports its seats and driver cameras.
// Usage: node .github/scripts/seats.js <vanilla vehicles dir> [--extra <dir>] [--strict]
//   --extra adds another mod's vehicles dir (its parts override vanilla, like in game)
//   --strict exits non-zero when any config has a seat problem
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const vanillaDir = args[0];
const extraDirs = args.flatMap((a, i) => (a === '--extra' ? [args[i + 1]] : []));
const strict = args.includes('--strict');
const root = path.resolve(__dirname, '../..');
const MODELS = ['pickup', 'md_series', 'van', 'roamer'];

// the same relaxed jbeam reader the validator uses
const { parseJbeam } = require('./validate.js');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.jbeam') ? [p] : [];
  });
}

// parts visible to one model: its own folder plus common, later sources override earlier ones
function loadParts(model) {
  const parts = {};
  const sources = [vanillaDir, ...extraDirs, path.join(root, 'vehicles')];
  for (const base of sources) {
    for (const dir of [path.join(base, 'common'), path.join(base, model)]) {
      for (const f of walk(dir)) {
        let doc;
        try { doc = parseJbeam(fs.readFileSync(f, 'utf8')); } catch (e) { continue; }
        for (const [name, part] of Object.entries(doc)) if (part && typeof part === 'object') parts[name] = part;
      }
    }
  }
  return parts;
}

const rows = (t) => (Array.isArray(t) ? t.filter(Array.isArray).slice(1) : []);
function slotsOf(part) {
  const out = [];
  for (const r of rows(part.slots)) out.push({ name: r[0], allow: [r[0]], def: r[1], opts: r[3] || {} });
  for (const r of rows(part.slots2)) out.push({ name: r[0], allow: [].concat(r[1]), def: r[3], opts: r[5] || {} });
  return out;
}
const fits = (part, allow) => part && [].concat(part.slotType).some((t) => allow.includes(t));

function resolve(parts, model, chosen) {
  const seats = [];
  const legacyCams = [];
  const visit = (name, vars, depth) => {
    const part = parts[name];
    if (!part || depth > 40) return;
    for (const r of rows(part.camerasInternal)) {
      if (r[0] === 'dash' || r[0] === 'driver') legacyCams.push(`${name} ("${r[0]}")`);
    }
    for (const s of slotsOf(part)) {
      const v = { ...vars, ...((s.opts && s.opts.variables) || {}) };
      let pick = Object.prototype.hasOwnProperty.call(chosen, s.name) ? chosen[s.name] : s.def;
      if (pick && !fits(parts[pick], s.allow)) pick = s.def; // game falls back to the slot default
      if (!pick || !fits(parts[pick], s.allow)) continue;
      if (s.allow.includes('seat_occupant')) {
        seats.push({ id: v.$seatID, driver: v.$isDriver === 'LHD' || v.$isDriver === 'RHD', host: name, name: v.$seatName });
        continue;
      }
      visit(pick, v, depth + 1);
    }
  };
  visit(model, {}, 0);
  return { seats, legacyCams };
}

const report = [];
for (const model of MODELS) {
  const parts = loadParts(model);
  const dir = path.join(root, 'vehicles', model);
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.pc'))) {
    const pc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const { seats, legacyCams } = resolve(parts, model, pc.parts || {});
    const ids = seats.map((s) => s.id);
    const problems = [];
    const isTrailer = /^trailer_/.test(f);
    if (!isTrailer) {
      if (!seats.length) problems.push('no seats');
      else if (!seats.some((s) => s.driver)) problems.push('no driver seat');
      if (seats.filter((s) => s.driver).length > 1) problems.push('more than one driver seat');
      if (seats.length && !seats.some((s) => /^F/.test(s.id || ''))) problems.push('no front seats');
    }
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) problems.push(`duplicate seat IDs ${[...new Set(dupes)].join(',')}`);
    if (legacyCams.length) problems.push(`legacy driver camera from ${legacyCams.join(', ')}`);
    report.push({ config: `${model}/${f.replace(/\.pc$/, '')}`, seats: seats.map((s) => `${s.id}${s.driver ? '*' : ''}`).join(' '), problems });
  }
}

for (const r of report) console.log(`${r.problems.length ? 'PROBLEM' : 'ok     '}  ${r.config.padEnd(58)} ${r.seats.padEnd(40)} ${r.problems.join('; ')}`);
const bad = report.filter((r) => r.problems.length).length;
console.log(`\n${report.length} configs, ${bad} with seat problems (* = driver seat)`);
if (strict && bad) process.exit(1);
