'use strict';

// Translations reviewed by hand (i18n-reviewed/<lang>.json) win over the machine's: the translator gets the
// strings without context and lowercased many ('Opus' -> 'obra', 'Shuffle' -> 'barajar', 'Queue' -> 'cola').
// The translate service is a local stand-in; nothing touches the network or the real data dir.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const I18n = require('../i18n');
const reviewed = require('../i18n-reviewed/es.json');

test('format and style names are never sent to the translator', () => {
  for (const s of ['Opus', 'Nightcore', 'Daycore']) assert.equal(I18n.translatable(s), false, s);
});

test('every reviewed translation keeps its placeholders and the English initial capital', () => {
  const firstLetter = (s) => (/\p{L}/u.exec(s) || [''])[0];
  for (const [src, tr] of Object.entries(reviewed)) {
    assert.equal(I18n.pick(src, tr), tr, src);
    const a = firstLetter(src), b = firstLetter(tr);
    if (/^\p{L}/u.test(src) && /^[¿¡«]?\p{L}/u.test(tr) && a !== a.toLowerCase()) assert.notEqual(b, b.toLowerCase(), `${src} => ${tr}`);
  }
  assert.equal(reviewed.Opus, 'Opus');
  assert.equal(reviewed.Shuffle, 'Aleatorio');
  assert.equal(reviewed.Queue, 'Cola');
});

// ---------- the server ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muriel-i18n-reviewed-'));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) process.env[key] = tmp;
process.env.MURIEL_DATA_DIR = path.join(tmp, 'data');
// what an install translated by machine before: the reviewed words replace it, the rest stays
fs.mkdirSync(path.join(tmp, 'data', 'i18n'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'data', 'i18n', 'es.json'), JSON.stringify({ Shuffle: 'barajar', 'Not in the reviewed file': 'algo de la máquina' }));

const asked = [];
const service = http.createServer((req, res) => {
  const target = new URL(new URL(req.url, 'http://x').searchParams.get('u'));
  const text = target.searchParams.get('q');
  asked.push(text);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([[[text.split('\n').map((l) => `es:${l}`).join('\n'), text, null, null]]]));
});
https.get = (target, opts, cb) => {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  return http.get(`http://127.0.0.1:${service.address().port}/?u=${encodeURIComponent(String(target))}`, opts || {}, cb);
};

const { startServer, stopServer, getServerToken } = require('../server');
let port;
before(async () => {
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  port = await startServer(0);
});
after(async () => {
  await stopServer();
  service.closeAllConnections();
  await new Promise((resolve) => service.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function call(method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers: { 'Content-Type': 'application/json', 'x-muriel-token': getServerToken() } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('a reviewed word replaces the machine one saved before, and is never asked for', async () => {
  const r = await call('POST', '/api/i18n-batch', { target: 'es', texts: ['Shuffle', 'Opus', 'Not in the reviewed file'] });
  assert.deepEqual(r.translations, ['Aleatorio', 'Opus', 'algo de la máquina']);
  assert.deepEqual(asked, []);
  const all = await call('GET', '/api/i18n-batch?target=es');
  assert.equal(all.translations.Shuffle, 'Aleatorio');
});

test('words the reviewed file lacks still go to the translator', async () => {
  const r = await call('POST', '/api/i18n-batch', { target: 'es', texts: ['A brand new string'] });
  assert.deepEqual(r.translations, ['es:A brand new string']);
  assert.equal(asked.length, 1);
});

test('other languages are not touched by the Spanish file', async () => {
  const r = await call('POST', '/api/i18n-batch', { target: 'de', texts: ['Shuffle'] });
  assert.deepEqual(r.translations, ['es:Shuffle']);
});

test('the app takes the server\'s word over its own saved copy', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');
  assert.match(src, /if \(dict\.get\(src\) !== tr && learn\(src, tr\)\) changed\+\+/);
});
