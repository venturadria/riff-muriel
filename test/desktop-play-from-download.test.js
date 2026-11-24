'use strict';

// Settings > Play from download (#51): the computer downloads the song and plays the file, as phones do,
// instead of streaming it. yt-dlp is a fake script: a lookup prints a stream URL, a download (-x) writes a file.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { PassThrough } = require('node:stream');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muriel-playdl-'));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) process.env[key] = tmp;
process.env.MURIEL_DATA_DIR = path.join(tmp, 'data');

const calls = path.join(tmp, 'yt-dlp-calls.txt');
const fake = path.join(tmp, 'yt-dlp');
fs.writeFileSync(fake, `#!/bin/sh
echo "$*" >> "${calls}"
out=""; dl=""; prev=""
for a; do
  [ "$a" = "-x" ] && dl=1
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
if [ -n "$dl" ]; then head -c 70000 /dev/zero > "$out"; exit 0; fi
echo "https://rr1.googlevideo.com/videoplayback?id=stream"
`);
fs.chmodSync(fake, 0o755);
process.env.MURIEL_YTDLP = fake;
process.env.MURIEL_FFMPEG = fake;

// offline: no YouTube search, and the fast YouTube lookup (yt-fast.js) fails so songs go through yt-dlp
https.get = (target, opts, cb) => {
  if (typeof opts === 'function') cb = opts;
  const res = new PassThrough();
  res.statusCode = 404;
  res.headers = {};
  const req = new PassThrough();
  req.setTimeout = () => req;
  process.nextTick(() => { cb(res); res.end(''); });
  return req;
};
https.request = () => {
  const req = new PassThrough();
  req.end = () => { process.nextTick(() => req.emit('error', new Error('offline'))); return req; };
  return req;
};

const posix = process.platform !== 'win32';
let server;
let port;
before(async () => {
  if (!posix) return;
  server = require('../server');
  port = await server.startServer(0);
});
after(async () => {
  if (server) await server.stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function get(route) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: route, headers: { 'x-muriel-token': server.getServerToken() } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    }).on('error', (error) => resolve({ error }));
  });
}
const query = (id, extra = {}) => new URLSearchParams({ id, url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube', title: 'California', artist: 'Someone', duration: '200', ...extra });

test('without the setting the computer still streams the song', { skip: !posix && 'fake yt-dlp is a shell script' }, async () => {
  const r = await get(`/api/stream-info?${query('STREAMonly1')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.isLocal, false);
  assert.match(r.body.streamUrl, /googlevideo\.com/);
});

test('cache=1 downloads the song and answers with the local file', { skip: !posix && 'fake yt-dlp is a shell script' }, async () => {
  const r = await get(`/api/stream-info?${query('DOWNLOADed1', { cache: '1' })}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isLocal, true);
  assert.match(r.body.streamUrl, /\/api\/local-track\?id=DOWNLOADed1/);
  assert.ok(fs.existsSync(path.join(tmp, 'data', 'tracks', 'DOWNLOADed1.opus')));
});

test('cache=1 ignores a stream URL remembered from an earlier play', { skip: !posix && 'fake yt-dlp is a shell script' }, async () => {
  const first = await get(`/api/stream-info?${query('REMEMBERed1')}`);
  assert.equal(first.body.isLocal, false);
  const r = await get(`/api/stream-info?${query('REMEMBERed1', { cache: '1' })}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.isLocal, true);
});

test('the Play from download switch is off by default, kept per device and hidden on phones', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
  assert.match(html, /<button class="effect-switch-btn" id="btn-play-from-download">/);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf-8');
  assert.match(app, /localStorage\.getItem\('muriel_play_from_download'\) === 'true'/);
  assert.match(fs.readFileSync(path.join(root, 'mobile', 'mobile-ui.js'), 'utf-8'), /'btn-play-from-download'/);
  assert.match(fs.readFileSync(path.join(root, 'profiles-core.js'), 'utf-8'), /'muriel_play_from_download'/);
});
