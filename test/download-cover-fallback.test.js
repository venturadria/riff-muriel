'use strict';

// A download failed whole when its cover would not convert or embed ("Postprocessing: Conversion failed!",
// "No such file or directory: '... - Back to Bars.jpg'"), on the fallback too: it is now saved without the cover.
// yt-dlp is a fake script that fails whenever it is asked to embed the cover (or always, for a refused song).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'muriel-cover-'));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) process.env[key] = tmp;
process.env.MURIEL_DATA_DIR = path.join(tmp, 'data');

const calls = path.join(tmp, 'yt-dlp-calls.txt');
const fake = path.join(tmp, 'yt-dlp');
fs.writeFileSync(fake, `#!/bin/sh
echo "$*" >> "${calls}"
out=""; fmt=""; cover=""; prev=""
for a; do
  [ "$prev" = "-o" ] && out="$a"
  [ "$prev" = "--audio-format" ] && fmt="$a"
  [ "$a" = "--embed-thumbnail" ] && cover=1
  prev="$a"
done
case "$*" in *REFUSEDsng1*) echo "ERROR: [youtube] REFUSEDsng1: HTTP Error 403: Forbidden" >&2; exit 1 ;; esac
if [ -n "$cover" ]; then echo "ERROR: Postprocessing: Conversion failed!" >&2; exit 1; fi
file=$(echo "$out" | sed "s/%(ext)s/$fmt/")
head -c 5000 /dev/zero > "$file"
`);
fs.chmodSync(fake, 0o755);
process.env.MURIEL_YTDLP = fake;
process.env.MURIEL_FFMPEG = fake;

const posix = process.platform !== 'win32';
const downloads = path.join(tmp, 'Downloads');
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

function download(id, title) {
  const q = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, id, title, artist: 'Tangana', format: 'mp3' });
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: `/api/download?${q}`, headers: { 'x-muriel-token': server.getServerToken() } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    });
  });
}
const runs = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf-8').trim().split('\n') : []);

test('a cover that will not convert: the song is saved without it', { skip: !posix && 'fake yt-dlp is a shell script' }, async () => {
  const r = await download('COVERfail01', 'Back to Bars');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.filename, 'Tangana - Back to Bars.mp3');
  assert.ok(fs.existsSync(path.join(downloads, 'Tangana - Back to Bars.mp3')));
  // the first try with the cover, then the same try (same YouTube clients) without it
  const [first, second] = runs();
  assert.match(first, /--embed-thumbnail/);
  assert.doesNotMatch(second, /--embed-thumbnail/);
  assert.match(second, /player_client=default,android/);
  assert.equal(runs().length, 2);
});

test('a failure that is not the cover keeps the cover on the fallback, and is still a failure', { skip: !posix && 'fake yt-dlp is a shell script' }, async () => {
  fs.rmSync(calls, { force: true });
  const r = await download('REFUSEDsng1', 'Refused');
  assert.equal(r.status, 500);
  assert.match(r.body.error, /403/);
  const tried = runs();
  assert.equal(tried.length, 2);
  for (const run of tried) assert.match(run, /--embed-thumbnail/);
});
