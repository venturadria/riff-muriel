'use strict';

// The song storage limit (Settings > Storage) on the computer, as on phones: over the limit, the cached
// songs used longest ago are deleted, the newest few always stay. The rule is shared (cache-limit-core.js).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muriel-cachelimit-'));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) process.env[key] = tmp;
process.env.MURIEL_DATA_DIR = path.join(tmp, 'data');

const { pickRemovals, limitBytesFromMb } = require('../cache-limit-core');

const MB = 1024 * 1024;
const song = (name, size, used, temp = false) => ({ name, size, used, temp });

test('under the limit, or with no limit, nothing is removed', () => {
  const files = [song('a', 3 * MB, 1), song('b', 3 * MB, 2)];
  assert.deepEqual(pickRemovals(files, 10 * MB).remove, []);
  assert.deepEqual(pickRemovals(files, 0).remove, []);
});

test('the songs used longest ago go first, until the cache fits', () => {
  const files = [6, 1, 5, 2, 4, 3].map((used) => song(`s${used}`, MB, used));
  const { remove, total } = pickRemovals(files, 4 * MB);
  assert.deepEqual(remove.map((f) => f.name), ['s1', 's2']);
  assert.equal(total, 4 * MB);
});

test('the newest four always stay, and a download being written is never removed', () => {
  const files = [song('old', MB, 1), ...[2, 3, 4, 5].map((u) => song(`new${u}`, MB, u)), song('writing', MB, 0, true)];
  const { remove } = pickRemovals(files, MB);
  assert.deepEqual(remove.map((f) => f.name), ['old']);
});

test('the limit in MB, with a fallback for a missing or broken value', () => {
  assert.equal(limitBytesFromMb('2048', 0), 2048 * MB);
  assert.equal(limitBytesFromMb(null, 2048), 2048 * MB);
  assert.equal(limitBytesFromMb('junk', 0), 0);
});

// ---- the server: the limit is kept in config.json, off by default, and a lower one trims at once ----
let server;
let port;
const tracks = path.join(tmp, 'data', 'tracks');
const thumbs = path.join(tmp, 'data', 'thumbnails');
before(async () => {
  fs.mkdirSync(tracks, { recursive: true });
  fs.mkdirSync(thumbs, { recursive: true });
  // eight 400 KB songs, the first played longest ago
  for (let i = 1; i <= 8; i++) {
    const file = path.join(tracks, `song${i}.opus`);
    fs.writeFileSync(file, Buffer.alloc(400 * 1024));
    fs.writeFileSync(path.join(thumbs, `song${i}.jpg`), 'jpg');
    const t = new Date(Date.UTC(2026, 0, i));
    fs.utimesSync(file, t, t);
  }
  server = require('../server');
  port = await server.startServer(0);
});
after(async () => {
  if (server) await server.stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function call(route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers: { 'x-muriel-token': server.getServerToken() } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(JSON.parse(body || '{}')));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the computer has no limit until one is chosen', async () => {
  assert.equal((await call('/api/cache-limit')).mb, 0);
  assert.equal(fs.readdirSync(tracks).length, 8);
});

test('choosing a limit removes the songs used longest ago, with their covers, and is remembered', async () => {
  assert.equal((await call('/api/cache-limit?mb=1', 'POST')).mb, 1);
  // 3.2 MB over a 1 MB limit: only the newest four are left (they alone are 1.6 MB, and always stay)
  assert.deepEqual(fs.readdirSync(tracks).sort(), ['song5.opus', 'song6.opus', 'song7.opus', 'song8.opus']);
  assert.ok(!fs.existsSync(path.join(thumbs, 'song1.jpg')));
  assert.ok(fs.existsSync(path.join(thumbs, 'song8.jpg')));
  const config = JSON.parse(fs.readFileSync(require('../platform').CONFIG_PATH, 'utf-8'));
  assert.equal(config.cacheLimitMb, 1);
  assert.equal((await call('/api/cache-limit')).mb, 1);
});

test('turning the limit off again keeps every song', async () => {
  assert.equal((await call('/api/cache-limit?mb=0', 'POST')).mb, 0);
  assert.equal(fs.readdirSync(tracks).length, 4);
});

test('the phone app trims with the same rule, and the computer has its own row in Settings', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'mobile', 'cache-limit.js'), 'utf-8'), /require\('\.\.\/cache-limit-core'\)/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf-8'), /id="desktop-cache-limit-item"/);
});
