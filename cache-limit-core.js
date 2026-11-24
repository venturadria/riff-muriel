// Which cached songs to delete to get under the song storage limit, shared by the phone app
// (mobile/cache-limit.js) and the computer (server.js): the songs played longest ago go first, the newest
// few always stay, and a download still being written counts towards the limit but is never deleted.
// files: [{ size, used (ms), temp }]; returns the files to delete and the size left after deleting them
const KEEP_NEWEST = 4;

function pickRemovals(files, limitBytes, keepNewest = KEEP_NEWEST) {
  let total = files.reduce((n, f) => n + f.size, 0);
  if (!(limitBytes > 0) || total <= limitBytes) return { remove: [], total };
  const done = files.filter((f) => !f.temp).sort((a, b) => a.used - b.used);
  const removable = done.slice(0, Math.max(0, done.length - keepNewest));
  const remove = [];
  for (const f of removable) {
    if (total <= limitBytes) break;
    remove.push(f);
    total -= f.size;
  }
  return { remove, total };
}

// '2048' -> 2 GB in bytes; anything else (missing, 0, junk) -> the fallback in MB (0: no limit)
function limitBytesFromMb(value, fallbackMb) {
  const mb = parseInt(value, 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : fallbackMb) * 1024 * 1024;
}

module.exports = { pickRemovals, limitBytesFromMb, KEEP_NEWEST };
