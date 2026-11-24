'use strict';

// A shared log was full of "Audio element error: no details | mediaError=4 ..." lines that did not say
// which song failed. Every playback line now ends with the song: artist - title, platform and id.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function fnSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = app.indexOf('{', start); i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

const audio = { currentSrc: 'https://rr2---sn.googlevideo.com/videoplayback?x=1', src: '', error: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' }, readyState: 0, networkState: 3, paused: true };
function logWith(currentTrack) {
  const logged = [];
  const ctx = {
    el: { nativeAudio: audio }, state: { loadToken: 3, currentTrack }, hlsInstance: null, URL,
    console: { warn: () => {} },
    window: { __riffLogError: (level, line) => logged.push(line) },
  };
  vm.runInNewContext(`${fnSource('describeMediaState')}\n${fnSource('logPlaybackIssue')}\nthis.log = logPlaybackIssue;`, ctx);
  return { line: ctx.log('Audio element error', null), logged };
}

test('an audio element error says which song it was', () => {
  const { line, logged } = logWith({ title: 'California', artist: 'Some Band', platform: 'youtube', id: 'abc123XYZ_-' });
  assert.match(line, /^Audio element error: no details \| mediaError=4 /);
  assert.match(line, /\| load=3 \| track="Some Band - California" youtube:abc123XYZ_-$/);
  assert.deepEqual(logged, [line], 'the same line goes to the app log');
});

test('a song without an artist, a long title or line breaks still logs on one short line', () => {
  assert.match(logWith({ title: 'Sirenas', platform: 'soundcloud', id: 'x' }).line, /track="Sirenas" soundcloud:x$/);
  const long = logWith({ title: 'a\nb '.repeat(100), artist: 'X', platform: 'youtube', id: 'y' }).line;
  assert.doesNotMatch(long, /\n/);
  assert.ok(long.split('track="')[1].length < 140);
});

test('nothing playing: the line has no track part', () => {
  assert.doesNotMatch(logWith(null).line, /track=/);
});
