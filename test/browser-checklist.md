# Phase 3 browser regression checklist

Verified through the in-app Chromium browser on 27 October 2026 against the real Node server and a separate test SQLite file. This is a repeatable manual browser suite; it is not included in the Node test count.

1. Load the page. Confirm three API-backed planet cards, notebook and three missions load. Check all six images render.
2. Select Gas giants, search Earth: expect no results. Click the Earth shortcut: expect All destinations, an empty search, three cards and keyboard focus on Earth's facts. Repeat with a mission's Explore planet control and a different planet. **Earth shortcut regression: retain this check.**
3. Search MAR: expect only Mars. Clear search: expect all three. Use Rocky worlds with search: both constraints must apply.
4. Submit an empty notebook form: expect field errors and focus on the first invalid field. API tests separately verify server-generated HTTP 422 errors.
5. Use a mission's Write a discovery button: expect its destination selected. Save a nonempty note, edit the text and progress, and reload: expect the updated record.
6. Open Delete, choose Keep it: record remains. Confirm Delete: record disappears. Reload: it remains deleted.
7. Save literal HTML/script markup as text: no image or script element must appear in the notebook. Delete the test record.
8. Complete a mission: expect 1 of 3, matching progress and the first remaining mission recommendation. Reopen and complete it again. Reload: progress persists.
9. Stop the Node process. Refresh missions and notebook: expect clear failure messages, no fake success and no discarded displayed records. Restart with the same DB_PATH and port; refresh both: saved progress and notes return.
10. Inspect widths 320, 390, 768, 1024 and 1440: document width must not exceed viewport width. Check the mobile Mission Control layout.
11. Use Enter on the gallery credits summary and planet facts. Check focus is visible. Toggle Pause animation: the Earth image and orbit animations pause. All navigation targets must exist.
12. Check browser logs for JavaScript errors. Expected failed resource requests during the deliberate outage are not successful API operations.

API tests cover independent browser-cookie ownership, invalid mission payloads, repeated progress writes, notebook isolation, restart persistence and SQL-safe values. No Firefox, Safari, physical-device or public-hosting claim is made.
