'use strict';

const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { randomBytes, createHash } = require('node:crypto');
const { openDatabase } = require('./database');

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

// Only the browser holding this random cookie can access its own notebook.
function owner(req, res) {
  let token = /(?:^|;\s*)space_visitor=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) {
    token = randomBytes(32).toString('hex');
    res.setHeader('Set-Cookie', `space_visitor=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
  }
  return createHash('sha256').update(token).digest('hex');
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Send JSON using Content-Type: application/json.');
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8192) throw new HttpError(413, 'Request body is too large (maximum 8 KB).');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return value;
}

function validateNote(value, db) {
  const fields = {};
  const text = key => typeof value[key] === 'string' ? value[key].trim() : '';
  const result = { planetId: text('planetId'), title: text('title'), note: text('note'), status: text('status') };
  if (!db.prepare('SELECT id FROM planets WHERE id = ?').get(result.planetId)) fields.planetId = 'Choose Earth, Mars or Saturn.';
  if (!result.title || result.title.length > 80) fields.title = 'Enter a title between 1 and 80 characters.';
  if (!result.note || result.note.length > 1000) fields.note = 'Enter a note between 1 and 1000 characters.';
  if (!['planned', 'explored'].includes(result.status)) fields.status = 'Choose planned or explored.';
  if (Object.keys(fields).length) throw new HttpError(422, 'Please correct the highlighted fields.', fields);
  return result;
}

function createApplication(options = {}) {
  const db = openDatabase(options.databasePath || process.env.DB_PATH || undefined);
  const planetColumns = 'id, name, kind, radius_km AS radiusKm, orbital_period AS year, description';
  const noteColumns = `n.id, n.planet_id AS planetId, p.name AS planetName, n.title, n.note,
    n.status, n.created_at AS createdAt, n.updated_at AS updatedAt`;
  const findNote = db.prepare(`SELECT ${noteColumns} FROM notes n JOIN planets p ON p.id=n.planet_id
    WHERE n.id=? AND n.owner_hash=?`);

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      // This classroom application is served only on loopback, not as an internet service.
      const port = server.address()?.port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (!hosts.includes(req.headers.host)) throw new HttpError(403, 'Unrecognized host. Use the printed local URL.');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!['GET', 'HEAD'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== url.origin) throw new HttpError(403, 'Cross-origin changes are not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site changes are not allowed.');
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, { status: 'ok', database: 'SQLite', planets: db.prepare('SELECT count(*) AS n FROM planets').get().n });
      }
      if (url.pathname === '/api/planets' && req.method === 'GET') {
        const kind = url.searchParams.get('kind') || 'all';
        const q = (url.searchParams.get('q') || '').trim();
        if (!['all', 'rocky', 'giant'].includes(kind) || q.length > 80) throw new HttpError(400, 'Use kind=all, rocky or giant and a search up to 80 characters.');
        const planets = db.prepare(`SELECT ${planetColumns} FROM planets
          WHERE (?='all' OR kind=?) AND instr(lower(name), lower(?))>0 ORDER BY radius_km`).all(kind, kind, q);
        return json(res, 200, { planets });
      }
      if (url.pathname === '/api/notes') {
        const ownerHash = owner(req, res);
        if (req.method === 'GET') {
          const notes = db.prepare(`SELECT ${noteColumns} FROM notes n JOIN planets p ON p.id=n.planet_id
            WHERE n.owner_hash=? ORDER BY n.id DESC`).all(ownerHash);
          return json(res, 200, { notes });
        }
        if (req.method === 'POST') {
          const value = validateNote(await readJson(req), db);
          if (db.prepare('SELECT count(*) AS n FROM notes WHERE owner_hash=?').get(ownerHash).n >= 100) {
            throw new HttpError(409, 'Your notebook is full (100 notes). Delete a note before adding another.');
          }
          const result = db.prepare('INSERT INTO notes(owner_hash,planet_id,title,note,status) VALUES(?,?,?,?,?)')
            .run(ownerHash, value.planetId, value.title, value.note, value.status);
          return json(res, 201, { note: findNote.get(Number(result.lastInsertRowid), ownerHash) });
        }
        throw new HttpError(405, 'Use GET or POST for the notebook.');
      }
      if (url.pathname === '/api/missions') {
        if (req.method !== 'GET') throw new HttpError(405, 'Use GET for missions.');
        const ownerHash = owner(req, res);
        const missions = db.prepare(`SELECT m.id, m.planet_id AS planetId, m.title, m.objective,
          m.condition, coalesce(p.completed,0) AS completed FROM missions m
          LEFT JOIN mission_progress p ON p.mission_id=m.id AND p.owner_hash=? ORDER BY m.rowid`)
          .all(ownerHash).map(m => ({ ...m, completed: Boolean(m.completed) }));
        return json(res, 200, { missions });
      }
      const missionMatch = /^\/api\/missions\/([a-z0-9-]+)$/.exec(url.pathname);
      if (missionMatch) {
        if (req.method !== 'PUT') throw new HttpError(405, 'Use PUT to update mission progress.');
        if (!db.prepare('SELECT id FROM missions WHERE id=?').get(missionMatch[1])) throw new HttpError(404, 'Mission not found.');
        const value = await readJson(req);
        if (typeof value.completed !== 'boolean' || Object.keys(value).length !== 1) {
          throw new HttpError(422, 'Send only completed as true or false.');
        }
        const ownerHash = owner(req, res);
        db.prepare(`INSERT INTO mission_progress(owner_hash,mission_id,completed) VALUES(?,?,?)
          ON CONFLICT(owner_hash,mission_id) DO UPDATE SET completed=excluded.completed,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(ownerHash, missionMatch[1], Number(value.completed));
        return json(res, 200, { id: missionMatch[1], completed: value.completed });
      }
      const match = /^\/api\/notes\/([1-9]\d*)$/.exec(url.pathname);
      if (match) {
        const id = Number(match[1]);
        const ownerHash = owner(req, res);
        if (!Number.isSafeInteger(id) || !findNote.get(id, ownerHash)) throw new HttpError(404, 'Note not found.');
        if (req.method === 'GET') return json(res, 200, { note: findNote.get(id, ownerHash) });
        if (req.method === 'PUT') {
          const value = validateNote(await readJson(req), db);
          db.prepare(`UPDATE notes SET planet_id=?,title=?,note=?,status=?,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND owner_hash=?`)
            .run(value.planetId, value.title, value.note, value.status, id, ownerHash);
          return json(res, 200, { note: findNote.get(id, ownerHash) });
        }
        if (req.method === 'DELETE') {
          db.prepare('DELETE FROM notes WHERE id=? AND owner_hash=?').run(id, ownerHash);
          res.writeHead(204);
          return res.end();
        }
        throw new HttpError(405, 'Use GET, PUT or DELETE for a note.');
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'This file supports GET and HEAD only.');
      // A whitelist prevents accidental exposure of the database, PDFs, or server source.
      const assets = new Map([
        ['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']],
        ['/style.css', ['style.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']],
        ['/CODE.txt', ['CODE.txt', 'text/plain']]
      ]);
      for (const image of ['earth', 'mars', 'saturn', 'nebula', 'moon', 'galaxy']) {
        assets.set(`/images/${image}.jpg`, [`images/${image}.jpg`, 'image/jpeg']);
      }
      const asset = assets.get(url.pathname);
      if (!asset) throw new HttpError(404, 'Page not found.');
      const content = await readFile(path.join(__dirname, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1] + (asset[1].startsWith('text/') ? '; charset=utf-8' : ''), 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!(error instanceof HttpError)) console.error('Request failed:', error.message);
      json(res, error.status || 500, { error: { message: error.status ? error.message : 'The server could not complete this request.', ...(error.fields ? { fields: error.fields } : {}) } });
    }
  });
  server.requestTimeout = 10000;
  server.on('close', () => db.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');
  const server = createApplication();
  server.on('error', error => { console.error(`Could not start server: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Space Explorer: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
module.exports = { createApplication };
