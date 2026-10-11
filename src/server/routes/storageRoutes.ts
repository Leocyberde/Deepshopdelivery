import { logServerError } from '../logger.ts';
import { Express } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { AuthRequest, requireAuth, requireAdmin } from '../middleware/auth.ts';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasValidPngChunks(buf: Buffer): boolean {
  if (buf.length < 57 || !buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return false;

  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  let hasEnd = false;

  while (offset + 12 <= buf.length) {
    const chunkLength = buf.readUInt32BE(offset);
    const chunkTypeStart = offset + 4;
    const dataStart = offset + 8;
    const crcStart = dataStart + chunkLength;
    const nextOffset = crcStart + 4;
    if (nextOffset > buf.length) return false;

    const chunkType = buf.toString('ascii', chunkTypeStart, dataStart);
    const chunkData = buf.subarray(dataStart, crcStart);
    if (buf.readUInt32BE(crcStart) !== crc32(buf.subarray(chunkTypeStart, crcStart))) return false;

    if (!hasHeader) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) return false;
      if (chunkData.readUInt32BE(0) === 0 || chunkData.readUInt32BE(4) === 0) return false;
      hasHeader = true;
    } else if (chunkType === 'IHDR') {
      return false;
    }

    if (chunkType === 'IDAT' && chunkLength > 0) hasImageData = true;
    if (chunkType === 'IEND') {
      if (chunkLength !== 0 || nextOffset !== buf.length) return false;
      hasEnd = true;
      break;
    }
    offset = nextOffset;
  }

  return hasHeader && hasImageData && hasEnd;
}

function hasValidJpegStructure(buf: Buffer): boolean {
  if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return false;
  let offset = 2;
  let hasFrame = false;

  while (offset + 1 < buf.length) {
    if (buf[offset] !== 0xff) return false;
    while (offset < buf.length && buf[offset] === 0xff) offset++;
    if (offset >= buf.length) return false;
    const marker = buf[offset++];
    if (marker === 0xd9) return hasFrame && offset === buf.length;
    if (marker === 0x00 || marker === 0xd8) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buf.length) return false;
    const segmentLength = buf.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buf.length) return false;
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) {
      if (segmentLength < 8 || buf.readUInt16BE(offset + 3) === 0 || buf.readUInt16BE(offset + 5) === 0) return false;
      hasFrame = true;
    }
    if (marker === 0xda) {
      if (!hasFrame || segmentLength < 6) return false;
      return buf.lastIndexOf(Buffer.from([0xff, 0xd9])) === buf.length - 2;
    }
    offset += segmentLength;
  }
  return false;
}

function hasValidWebpStructure(buf: Buffer): boolean {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (buf.readUInt32LE(4) + 8 !== buf.length) return false;
  const chunkType = buf.toString('ascii', 12, 16);
  const chunkLength = buf.readUInt32LE(16);
  if (20 + chunkLength + (chunkLength % 2) > buf.length) return false;
  if (chunkType === 'VP8X') return chunkLength >= 10;
  if (chunkType === 'VP8L') return chunkLength >= 5 && buf[20] === 0x2f;
  if (chunkType === 'VP8 ') return chunkLength >= 10 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a;
  return false;
}

function hasValidMp4Structure(buf: Buffer): boolean {
  if (buf.length < 24) return false;
  let offset = 0;
  let hasFileType = false;
  let hasMediaData = false;

  while (offset + 8 <= buf.length) {
    let boxLength = buf.readUInt32BE(offset);
    const boxType = buf.toString('ascii', offset + 4, offset + 8);
    let headerLength = 8;
    if (boxLength === 1) {
      if (offset + 16 > buf.length) return false;
      const extendedLength = buf.readBigUInt64BE(offset + 8);
      if (extendedLength > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      boxLength = Number(extendedLength);
      headerLength = 16;
    } else if (boxLength === 0) {
      boxLength = buf.length - offset;
    }
    if (boxLength < headerLength || offset + boxLength > buf.length) return false;
    if (boxType === 'ftyp') hasFileType = boxLength >= headerLength + 8;
    if (boxType === 'mdat' && boxLength > headerLength) hasMediaData = true;
    offset += boxLength;
  }
  return offset === buf.length && hasFileType && hasMediaData;
}

function readEbmlVint(buf: Buffer, offset: number): { length: number; value: bigint; unknown: boolean } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];
  let marker = 0x80;
  let length = 1;
  while (length <= 8 && (first & marker) === 0) { marker >>= 1; length++; }
  if (length > 8 || offset + length > buf.length) return null;
  let value = BigInt(first & (marker - 1));
  for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(buf[offset + i]);
  const unknown = value === (1n << BigInt(7 * length)) - 1n;
  return { length, value, unknown };
}

function hasValidWebmStructure(buf: Buffer): boolean {
  const ebmlHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const segmentId = Buffer.from([0x18, 0x53, 0x80, 0x67]);
  const clusterId = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
  if (buf.length < 16 || !buf.subarray(0, 4).equals(ebmlHeader)) return false;
  const headerSize = readEbmlVint(buf, 4);
  if (!headerSize || headerSize.unknown) return false;
  const segmentOffset = 4 + headerSize.length + Number(headerSize.value);
  if (segmentOffset + 4 >= buf.length || !buf.subarray(segmentOffset, segmentOffset + 4).equals(segmentId)) return false;
  const segmentSize = readEbmlVint(buf, segmentOffset + 4);
  if (!segmentSize) return false;
  const contentOffset = segmentOffset + 4 + segmentSize.length;
  if (!segmentSize.unknown && contentOffset + Number(segmentSize.value) > buf.length) return false;
  return buf.indexOf(clusterId, contentOffset) >= contentOffset;
}

export function detectMimeFromSignature(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (hasValidJpegStructure(buf)) return 'image/jpeg';
  if (hasValidPngChunks(buf)) return 'image/png';
  if (hasValidWebpStructure(buf)) return 'image/webp';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp' && hasValidMp4Structure(buf)) return 'video/mp4';
  if (hasValidWebmStructure(buf)) return 'video/webm';
  return null;
}

export function registerStorageRoutes(app: Express) {
  app.get('/api/storage/:key', async (req, res) => {
    try {
      const [obj] = await db
        .select()
        .from(schema.storedObjects)
        .where(eq(schema.storedObjects.key, req.params.key));
      if (!obj) {
        res.status(404).send('Imagem não encontrada');
        return;
      }
      const buffer = Buffer.from(obj.dataBase64, 'base64');
      if (!ALLOWED_MIME.has(obj.mimeType)) {
        res.status(404).send('Arquivo não encontrado');
        return;
      }
      res.setHeader('Content-Type', obj.mimeType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).send('Erro ao carregar imagem');
    }
  });

  app.post('/api/admin/upload-image', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { mimeType, dataBase64, filename } = req.body || {};
      if (typeof mimeType !== 'string' || typeof dataBase64 !== 'string' || !dataBase64) {
        res.status(400).json({ error: 'Arquivo inválido.' });
        return;
      }
      if (!ALLOWED_MIME.has(mimeType)) {
        res.status(400).json({ error: 'Tipo de arquivo não permitido. Use JPEG, PNG, WEBP, MP4 ou WEBM.' });
        return;
      }

      const cleanBase64 = dataBase64.includes('base64,') ? dataBase64.split('base64,')[1] : dataBase64;
      const buffer = Buffer.from(cleanBase64, 'base64');

      // Confere a assinatura real do arquivo: o mimeType informado pelo cliente não é confiável.
      const detected = detectMimeFromSignature(buffer);
      if (!detected || !ALLOWED_MIME.has(detected)) {
        res.status(400).json({ error: 'O conteúdo do arquivo não é uma imagem ou vídeo válido.' });
        return;
      }
      if (detected !== mimeType) {
        res.status(400).json({ error: 'O tipo informado não confere com o conteúdo do arquivo.' });
        return;
      }

      const isVideo = detected.startsWith('video/');
      const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (buffer.length > maxBytes) {
        res.status(413).json({
          error: `Arquivo muito grande. Limite: ${isVideo ? '25 MB para vídeo' : '5 MB para imagem'}.`,
        });
        return;
      }

      const ext = MIME_EXT[detected];
      const baseName = String(filename || 'produto')
        .replace(/\.[^.]*$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 60);
      const key = `${Date.now()}_${baseName}.${ext}`;

      await db.insert(schema.storedObjects).values({
        key,
        mimeType: detected,
        dataBase64: buffer.toString('base64'),
      });

      res.json({ url: `/api/storage/${key}`, key });
    } catch (error) {
      logServerError('server_operation_failed', error);
      res.status(500).json({ error: 'Falha ao salvar o arquivo.' });
    }
  });
}
