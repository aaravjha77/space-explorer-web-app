'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createApplication } = require('../server');
const { openDatabase } = require('../database');

test('Space Explorer backend integration', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'space-explorer-test-'));
  const databasePath = path.join(directory, 'test.sqlite');
  let server;
  let base;
  let cookie;
  let savedId;
  const valid = { planetId: 'saturn', title: 'Saturn rings', note: 'Investigate the icy ring particles.', status: 'planned' };
  async function start() {
    server = createApplication({ databasePath });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
  }
  async function call(route, method = 'GET', body, headers = {}) {
    const response = await fetch(base + route, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    });
    return { response, body: response.status === 204 ? null : await response.json() };
  }
  try {
    await start();
    await t.test('startup, seeded database and restricted static file serving', async () => {
      assert.deepEqual((await call('/api/health')).body, { status: 'ok', database: 'SQLite', planets: 3 });
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert((await page.text()).includes('Space Explorer'));
      assert.equal((await fetch(base + '/style.css', { method: 'HEAD' })).status, 200);
      for (const file of ['/server.js', '/data/space-explorer.sqlite', '/README.md', '/database/missions.json', '/.env', '/output/backend/Backend_Project_Submission.pdf', '/missing', '/api/missing']) {
        assert.equal((await fetch(base + file)).status, 404, file);
      }
    });
    await t.test('server-side planet search and filtering', async () => {
      assert.equal((await call('/api/planets')).body.planets.length, 3);
      assert.equal((await call('/api/planets?kind=rocky')).body.planets.length, 2);
      assert.equal((await call('/api/planets?kind=giant')).body.planets[0].id, 'saturn');
      assert.equal((await call('/api/planets?q=MAR')).body.planets[0].id, 'mars');
      assert.equal((await call('/api/planets?q=%25')).body.planets.length, 0);
      assert.equal((await call('/api/planets?kind=giant&q=earth')).body.planets.length, 0);
      assert.equal((await call('/api/planets?kind=rocky&q=earth')).body.planets[0].id, 'earth');
      assert.equal((await call('/api/planets?kind=other')).response.status, 400);
      assert.equal((await call('/api/planets?q=' + 'a'.repeat(81))).response.status, 400);
    });
    await t.test('notebook cookie and server-side validation', async () => {
      const initial = await call('/api/notes');
      cookie = initial.response.headers.get('set-cookie').split(';')[0];
      assert(initial.response.headers.get('set-cookie').includes('HttpOnly; SameSite=Strict'));
      assert.deepEqual(initial.body.notes, []);
      const invalid = await call('/api/notes', 'POST', { planetId: 'pluto', title: ' ', note: '', status: 'wrong' });
      assert.equal(invalid.response.status, 422);
      assert.equal(Object.keys(invalid.body.error.fields).length, 4);
      assert.equal((await call('/api/notes', 'POST', '{broken')).response.status, 400);
      assert.equal((await call('/api/notes', 'POST', [])).response.status, 400);
      assert.equal((await call('/api/notes', 'POST', valid, { 'Content-Type': 'text/plain' })).response.status, 415);
      assert.equal((await call('/api/notes', 'POST', { ...valid, title: 'x'.repeat(81) })).response.status, 422);
      assert.equal((await call('/api/notes', 'POST', { ...valid, note: 'x'.repeat(1001) })).response.status, 422);
      assert.equal((await call('/api/notes', 'POST', { ...valid, note: 'x'.repeat(9000) })).response.status, 413);
      assert.equal((await call('/api/notes')).body.notes.length, 0);
    });
    await t.test('create, retrieve, update and owner isolation', async () => {
      const created = await call('/api/notes', 'POST', { ...valid, title: '  Saturn rings  ' });
      assert.equal(created.response.status, 201);
      savedId = created.body.note.id;
      assert.equal(created.body.note.title, 'Saturn rings');
      assert.equal((await call(`/api/notes/${savedId}`)).body.note.planetName, 'Saturn');
      const updated = await call(`/api/notes/${savedId}`, 'PUT', { ...valid, status: 'explored', note: "Ice particles; '); DROP TABLE planets; --" });
      assert.equal(updated.body.note.status, 'explored');
      assert.equal((await call('/api/health')).body.planets, 3);
      const other = await fetch(base + '/api/notes');
      assert.deepEqual((await other.json()).notes, []);
      assert.equal((await fetch(base + `/api/notes/${savedId}`)).status, 404);
      assert.equal((await fetch(base + `/api/notes/${savedId}`, { method: 'DELETE' })).status, 404);
    });
    await t.test('database persists across an actual server restart', async () => {
      await stop();
      await start();
      const notes = (await call('/api/notes')).body.notes;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].id, savedId);
      assert.equal(notes[0].status, 'explored');
    });
    await t.test('mission definitions, validation, isolation and durable progress', async () => {
      const initial = (await call('/api/missions')).body.missions;
      assert.equal(initial.length, 3);
      assert(initial.every(m => m.completed === false && m.condition && m.objective));
      const route = '/api/missions/' + initial[0].id;
      for (const value of [{ completed: 1 }, { completed: 'true' }, {}, { completed: true, owner: 'other' }]) {
        assert.equal((await call(route, 'PUT', value)).response.status, 422);
      }
      assert.equal((await call('/api/missions/unknown', 'PUT', { completed: true })).response.status, 404);
      assert.equal((await call(route, 'DELETE')).response.status, 405);
      assert.equal((await call('/api/missions', 'POST', {})).response.status, 405);
      assert.equal((await call(route, 'PUT', { completed: true }, { Origin: 'https://example.com' })).response.status, 403);
      assert.equal((await call(route, 'PUT', { completed: true })).response.status, 200);
      const separate = await fetch(base + '/api/missions');
      const otherCookie = separate.headers.get('set-cookie').split(';')[0];
      assert((await separate.json()).missions.every(m => !m.completed));
      await fetch(base + route, { method: 'PUT', headers: { Cookie: otherCookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: false }) });
      assert.equal((await call('/api/missions')).body.missions[0].completed, true);
      await stop(); await start();
      assert.equal((await call('/api/missions')).body.missions[0].completed, true);
      for (let i = 0; i < 6; i++) await call(route, 'PUT', { completed: Boolean(i % 2) });
      assert.equal((await call('/api/missions')).body.missions[0].completed, true);
      await call(route, 'PUT', { completed: false });
      await stop(); await start();
      assert.equal((await call('/api/missions')).body.missions[0].completed, false);
      assert.equal((await call('/api/notes')).body.notes[0].id, savedId);
      const inspect = openDatabase(databasePath);
      assert.equal(inspect.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(inspect.prepare('PRAGMA foreign_key_check').all().length, 0);
      inspect.close();
    });
    await t.test('cross-origin writes, unsupported methods and missing records', async () => {
      assert.equal((await call('/api/notes', 'POST', valid, { Origin: 'https://example.com' })).response.status, 403);
      assert.equal((await call('/api/notes', 'POST', valid, { 'Sec-Fetch-Site': 'cross-site' })).response.status, 403);
      assert.equal((await call('/api/notes', 'PATCH', valid)).response.status, 405);
      assert.equal((await call('/api/notes/999999')).response.status, 404);
      assert.equal((await call(`/api/notes/${savedId}`, 'PUT', { ...valid, title: '' })).response.status, 422);
    });
    await t.test('delete and confirm durable removal', async () => {
      assert.equal((await call(`/api/notes/${savedId}`, 'DELETE')).response.status, 204);
      assert.equal((await call(`/api/notes/${savedId}`)).response.status, 404);
      await stop();
      await start();
      assert.equal((await call('/api/notes')).body.notes.length, 0);
    });
  } finally {
    await stop();
    if (path.dirname(directory) !== os.tmpdir()) throw new Error('Unexpected test directory');
    await rm(directory, { recursive: true, force: true });
  }
});
