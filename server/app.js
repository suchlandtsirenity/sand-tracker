import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { parseKey, validateLevel } from '../shared/level.js';
import { validatePalettes } from '../shared/palette.js';

const MAX_BODY = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createApp({ db, rootDir }) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname, db);
      else await serveStatic(res, rootDir, pathname);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      const status = err instanceof HttpError ? err.status : 500;
      if (!res.headersSent) send(res, status, { error: err instanceof HttpError ? err.message : 'internal error' });
      if (status === 413) req.destroy();
    }
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
}

const cleanLevel = ({ type, number, colourCount, jars }) => ({
  type, number, colourCount,
  jars: jars.map(({ capacity, slots, empty }) => (empty ? { capacity, slots, empty } : { capacity, slots })),
});
const cleanPalettes = (list) => list.map(({ id, name, colours, names }) =>
  (names ? { id, name, colours, names } : { id, name, colours }));

async function handleApi(req, res, pathname, db) {
  const [, , resource, rawKey, extra] = pathname.split('/');
  if (extra !== undefined) throw new HttpError(404, 'not found');

  if (resource === 'levels' && rawKey === undefined) {
    if (req.method === 'GET') return send(res, 200, db.listLevels());
    throw new HttpError(405, 'method not allowed');
  }

  if (resource === 'levels') {
    let key;
    try { key = decodeURIComponent(rawKey); } catch { throw new HttpError(400, 'bad level key'); }
    const parsed = parseKey(key);
    if (!parsed) throw new HttpError(400, 'bad level key');

    if (req.method === 'GET') {
      const level = db.getLevel(key);
      if (!level) throw new HttpError(404, 'level not found');
      return send(res, 200, level);
    }
    if (req.method === 'PUT') {
      const level = await readJson(req);
      const problem = validateLevel(level);
      if (problem) throw new HttpError(400, problem);
      if (level.type !== parsed.type || level.number !== parsed.number) throw new HttpError(400, 'level does not match key');
      return send(res, 200, { updatedAt: db.putLevel(key, cleanLevel(level)) });
    }
    if (req.method === 'DELETE') {
      if (!db.deleteLevel(key)) throw new HttpError(404, 'level not found');
      res.writeHead(204);
      return res.end();
    }
    throw new HttpError(405, 'method not allowed');
  }

  if (resource === 'palettes' && rawKey === undefined) {
    if (req.method === 'GET') return send(res, 200, db.getPalettes());
    if (req.method === 'PUT') {
      const list = await readJson(req);
      const problem = validatePalettes(list);
      if (problem) throw new HttpError(400, problem);
      db.putPalettes(cleanPalettes(list));
      return send(res, 200, { ok: true });
    }
    throw new HttpError(405, 'method not allowed');
  }

  throw new HttpError(404, 'not found');
}

async function serveStatic(res, rootDir, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'bad path'); }
  if (rel === '/') rel = '/index.html';
  const isShared = rel.startsWith('/shared/');
  const allowedDir = join(rootDir, isShared ? '' : 'public') + sep;
  const file = resolve(allowedDir, '.' + rel);
  const mustStartWith = isShared ? join(rootDir, 'shared') + sep : allowedDir;
  if (!file.startsWith(mustStartWith)) throw new HttpError(404, 'not found');
  let data;
  try { data = await readFile(file); } catch { throw new HttpError(404, 'not found'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}
