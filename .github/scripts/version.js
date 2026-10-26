// Release versioning helpers.
//   node version.js next              prints the next version (from the latest vX.Y.Z tag, or info.json if
//                                     there are no tags). #major / #minor in any commit message since that
//                                     tag picks the bump, otherwise the patch number goes up.
//   node version.js stamp <dir> <ver> writes <ver> into version_string of <dir>/mod_info/*/info.json
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const parse = (v) => (v.match(/^v?(\d+)\.(\d+)\.(\d+)$/) || []).slice(1).map(Number);

function infoFiles(dir) {
  const base = path.join(dir, 'mod_info');
  return fs.readdirSync(base).map((d) => path.join(base, d, 'info.json')).filter((f) => fs.existsSync(f));
}

function next() {
  const tags = git('tag', '--list', 'v*.*.*', '--sort=-v:refname').split('\n').filter((t) => parse(t).length === 3);
  let current, range;
  if (tags.length) {
    current = parse(tags[0]);
    range = `${tags[0]}..HEAD`;
  } else {
    const info = JSON.parse(fs.readFileSync(infoFiles('.')[0], 'utf8'));
    current = parse(String(info.version_string || '0.0.0'));
    if (current.length !== 3) throw new Error(`info.json version_string "${info.version_string}" is not X.Y.Z`);
    range = 'HEAD';
  }
  const messages = git('log', '--format=%B', range);
  let [major, minor, patch] = current;
  if (/#major\b/i.test(messages)) { major++; minor = 0; patch = 0; }
  else if (/#minor\b/i.test(messages)) { minor++; patch = 0; }
  else patch++;
  return `${major}.${minor}.${patch}`;
}

function stamp(dir, version) {
  if (parse(version).length !== 3) throw new Error(`"${version}" is not X.Y.Z`);
  for (const file of infoFiles(dir)) {
    const text = fs.readFileSync(file, 'utf8');
    const updated = text.replace(/("version_string"\s*:\s*")[^"]*(")/, `$1${version}$2`);
    if (updated === text && !text.includes(`"version_string"`)) throw new Error(`${file} has no version_string`);
    JSON.parse(updated);
    fs.writeFileSync(file, updated);
    console.log(`${path.relative(dir, file)}: version_string = ${version}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'next') console.log(next());
else if (cmd === 'stamp') stamp(args[0], args[1]);
else { console.error('usage: version.js next | stamp <dir> <version>'); process.exit(2); }
