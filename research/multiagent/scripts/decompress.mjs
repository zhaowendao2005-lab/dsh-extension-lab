// Read-only: decompress ~/.dsh/sessions/<proj>/<sid>/session.v4.jsonl.zstd (multi-frame, appended writes)
// into /tmp/dsh-sessions-raw/<proj>/<sid>.jsonl. Node's zstd only decodes the first frame, so we walk frames.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import os from 'node:os';
const root = path.join(os.homedir(), '.dsh/sessions'); const out = process.argv[2] || '/tmp/dsh-sessions-raw';
function frameLen(b, p) {
  const magic = b.readUInt32LE(p);
  if ((magic & 0xFFFFFFF0) === 0x184D2A50) return 8 + b.readUInt32LE(p + 4); // skippable
  if (magic !== 0xFD2FB528) throw new Error('bad magic at ' + p);
  const fhd = b[p + 4]; const fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, cksum = (fhd >> 2) & 1, did = fhd & 3;
  let q = p + 5 + (single ? 0 : 1) + [0, 1, 2, 4][did] + [single ? 1 : 0, 2, 4, 8][fcsFlag];
  for (;;) { const h = b[q] | (b[q + 1] << 8) | (b[q + 2] << 16); const last = h & 1, type = (h >> 1) & 3, size = h >> 3;
    q += 3 + (type === 1 ? 1 : size); if (last) break; }
  return q - p + (cksum ? 4 : 0);
}
let n = 0, bytes = 0, bad = 0;
for (const proj of fs.readdirSync(root)) { const pd = path.join(root, proj); if (!fs.statSync(pd).isDirectory()) continue;
  for (const sid of fs.readdirSync(pd)) { const f = path.join(pd, sid, 'session.v4.jsonl.zstd'); if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f); const parts = []; let p = 0;
    try { while (p + 4 <= b.length) { const L = frameLen(b, p); const fr = b.subarray(p, p + L);
        if (fr.readUInt32LE(0) === 0xFD2FB528) parts.push(zlib.zstdDecompressSync(fr)); p += L; } }
    catch (e) { bad++; console.error(sid, 'truncated at', p, '/', b.length, e.message); }
    const buf = Buffer.concat(parts); fs.mkdirSync(path.join(out, proj), { recursive: true });
    fs.writeFileSync(path.join(out, proj, sid + '.jsonl'), buf); n++; bytes += buf.length; } }
console.log(n, 'files', (bytes / 1e6).toFixed(1), 'MB', 'errors', bad);
