# Space Explorer

A college web technology application featuring NASA imagery, an API-backed planet catalogue, an exploration notebook and **Mission Control - Discovery Trail**. Phase 3 preserves the original frontend and Node/SQLite stack.

Public source: https://github.com/aaravjha77/space-explorer-web-app

## Run locally

1. Install **Node.js 24.15 or newer**. Check `node --version`.
2. Download/extract the repository ZIP or clone it. Open the folder in VS Code.
3. Run `node server.js`.
4. Open the printed address, normally **http://127.0.0.1:3000**. Stop with Ctrl+C.

No npm install, API keys, framework or separate database service is required. Use the Node server rather than Live Server for backend features. `npm start` is an optional equivalent.

SQLite automatically creates `data/space-explorer.sqlite`, creates missing tables and seeds planets/missions. Existing notes and progress are preserved. Optional initialization: `node database.js`.

If port 3000 is occupied, PowerShell can choose a free port:

```powershell
$env:PORT = '0'
node server.js
```

`DB_PATH` optionally selects another writable SQLite file. No .env file is loaded. Back up your database if you want to retain your records.

## Features

- Search planet names and select a category. Both constraints use the real API/SQLite. Earth and mission shortcuts reset hidden results before navigating.
- Expand planet facts and NASA source links, explore the orbit illustration, open gallery credits and pause animations.
- Create, read, edit and delete discoveries. Title: 1-80 characters; note: 1-1,000 characters after trimming. Destinations: Earth/Mars/Saturn; status: planned/explored. Deletion requires confirmation.
- Complete/reopen three Mission Control objectives. Completion is self-reported: the checklist does not grade learning or enforce a note prerequisite. The progress bar counts completions; Next mission is the first incomplete mission in definition order. No AI or external API powers recommendations.
- Refresh controls retry failures. A failed refresh preserves displayed data.
- Notes and missions persist after refreshes and server restarts. Each browser has an opaque HttpOnly, SameSite=Strict cookie. Clearing cookies, another browser profile or expiry after 30 days creates a new identity. There is no login or device synchronization.

## Files

| File | Purpose |
| --- | --- |
| index.html, style.css | Preserved design, responsive notebook and Mission Control |
| app.js | Fetch, client validation, safe text rendering and interaction state |
| server.js | Local HTTP API, server validation and owned records |
| database.js | SQLite initialization and idempotent seeds |
| database/schema.sql | Planet, note, mission and owned progress tables |
| database/planets.json | Three original planet records |
| database/missions.json | Three editable mission definitions |
| test/server.test.js | Automated HTTP/database integration suite |
| test/browser-checklist.md | Repeatable browser and Earth-shortcut regression checks |
| images/, images/credits.json | Original six NASA images and source credits |
| CODE.txt | Complete readable source listings |

## API

| Route | Purpose |
| --- | --- |
| GET /api/health | Database status and planet count |
| GET /api/planets?kind=all&q=mars | Search; kind is all, rocky or giant |
| GET /api/notes | List this browser's discoveries |
| POST /api/notes | Create using planetId, title, note, status |
| GET /api/notes/:id | Read an owned discovery |
| PUT /api/notes/:id | Update the same four fields |
| DELETE /api/notes/:id | Delete an owned discovery |
| GET /api/missions | Definitions plus this browser's progress |
| PUT /api/missions/:id | Set progress using exactly {"completed":true} or false |

Mutations accept JSON. Error format: `{"error":{"message":"...","fields":{}}}` (field messages when applicable). Statuses include 400 malformed input, 404 missing resource, 405 wrong method, 413 oversized body, 415 wrong content type and 422 validation. Limits: 8 KB request body and 100 notes per browser.

## Verification

Run `node --test test/server.test.js` or `npm test`. Tests use a temporary database and real local HTTP servers, verify CRUD, combined filters, validation, ownership isolation, mission updates, repeated operations, private-file restrictions and persistence after shutdown/restart. Your normal database is not changed.

Phase 3 result: **9 passing tests (one parent and eight subtests)**. The in-app Chromium browser walkthrough also checked notebook CRUD, safe markup rendering, Earth/mission shortcuts, mission completion/reopening, refresh and Node-process restart persistence, genuine outage/recovery, keyboard disclosures, animation pause, image loading and widths 320, 390, 768, 1024 and 1440. Repeat these using `test/browser-checklist.md`. Firefox, Safari and physical devices were not tested.

## Security and scope

This is a **local classroom application**. The server listens on loopback, checks Host and mutation Origin, uses SQL parameters, caps requests and serves only whitelisted assets. SQLite stores a hash of each visitor token. User text uses textContent, and mission progress has a composite owner/mission key. Databases, private visitor records, credentials, academic reports and archives are excluded from public source.

The GitHub repository provides source code, not a running website. GitHub Pages cannot run the Node/SQLite API. No live deployment is claimed. Public hosting needs a separate review of TLS, secure cookies, authentication, abuse limits and durable storage.

## Credits

Original project: Aryan Gupta and Aarav Jha. NASA images/credits are retained in `images/credits.json` and on the page. Values are approximate and the orbit illustration is not to scale. This independent project is not endorsed by NASA. AI assistance: ChatGPT by OpenAI (Codex), for implementation, debugging, testing and documentation.
