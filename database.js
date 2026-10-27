'use strict';

const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

// SQLite creates the file on first run. Tests supply their own temporary path.
function openDatabase(filename = path.join(__dirname, 'data', 'space-explorer.sqlite')) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8'));
  const seed = JSON.parse(readFileSync(path.join(__dirname, 'database', 'planets.json'), 'utf8'));
  const insert = db.prepare(`INSERT INTO planets
    (id, name, kind, radius_km, orbital_period, description) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`);
  db.exec('BEGIN');
  try {
    for (const p of seed) insert.run(p.id, p.name, p.kind, p.radiusKm, p.year, p.description);
    const missions = JSON.parse(readFileSync(path.join(__dirname, 'database', 'missions.json'), 'utf8'));
    const insertMission = db.prepare(`INSERT INTO missions(id,planet_id,title,objective,condition)
      VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET planet_id=excluded.planet_id,
      title=excluded.title,objective=excluded.objective,condition=excluded.condition`);
    for (const m of missions) insertMission.run(m.id, m.planetId, m.title, m.objective, m.condition);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

if (require.main === module) {
  const db = openDatabase(process.env.DB_PATH || undefined);
  console.log('Database ready; planet records:', db.prepare('SELECT count(*) AS total FROM planets').get().total);
  db.close();
}
module.exports = { openDatabase };
