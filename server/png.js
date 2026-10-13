import zlib from 'node:zlib';
import { t } from './i18n.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

export function readChunks(buf) {
  if (!isPng(buf)) throw new Error(t('server.cards.file_not_png'));
  const chunks = [];
  let pos = 8;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    chunks.push({ type, data: buf.subarray(pos + 8, pos + 8 + len) });
    pos += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

export function writeChunks(chunks) {
  const parts = [SIGNATURE];
  for (const { type, data } of chunks) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    parts.push(head, data, crc);
  }
  return Buffer.concat(parts);
}

function textChunk(keyword, text) {
  return {
    type: 'tEXt',
    data: Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]),
  };
}

function parseText(chunk) {
  const i = chunk.data.indexOf(0);
  if (i < 0) return null;
  return { keyword: chunk.data.toString('latin1', 0, i), text: chunk.data.toString('latin1', i + 1) };
}

// Devuelve el base64 guardado en el PNG (prefiere ccv3 sobre chara, como SillyTavern).
export function extractCardText(buf) {
  const found = {};
  for (const chunk of readChunks(buf)) {
    if (chunk.type !== 'tEXt') continue;
    const t = parseText(chunk);
    if (t && (t.keyword === 'chara' || t.keyword === 'ccv3')) found[t.keyword] = t.text;
  }
  return found.ccv3 ?? found.chara ?? null;
}

export function embedCard(pngBuf, v2Payload, v3Payload) {
  const kept = readChunks(pngBuf).filter((c) => {
    if (c.type !== 'tEXt') return true;
    const t = parseText(c);
    return !(t && (t.keyword === 'chara' || t.keyword === 'ccv3'));
  });
  const iend = kept.findIndex((c) => c.type === 'IEND');
  const at = iend < 0 ? kept.length : iend;
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  kept.splice(at, 0, textChunk('chara', b64(v2Payload)), textChunk('ccv3', b64(v3Payload)));
  return writeChunks(kept);
}

// PNG de color sólido para personajes importados sin imagen.
export function placeholderPng(seed = '', width = 400, height = 600) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rgb = [60 + (h % 100), 60 + ((h >> 8) % 100), 80 + ((h >> 16) % 100)];
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return writeChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: zlib.deflateSync(raw) },
    { type: 'IEND', data: Buffer.alloc(0) },
  ]);
}
