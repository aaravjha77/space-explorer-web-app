PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS planets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rocky', 'giant')),
  radius_km INTEGER NOT NULL CHECK (radius_km > 0),
  orbital_period TEXT NOT NULL,
  description TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_hash TEXT NOT NULL,
  planet_id TEXT NOT NULL REFERENCES planets(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 1000),
  status TEXT NOT NULL CHECK (status IN ('planned', 'explored')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS notes_owner ON notes(owner_hash, id);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  planet_id TEXT NOT NULL REFERENCES planets(id),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  condition TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS mission_progress (
  owner_hash TEXT NOT NULL,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (owner_hash, mission_id)
) STRICT;
