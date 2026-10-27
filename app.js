'use strict';

// Fetch connects the preserved frontend to the catalogue, notebook and mission API.
const $ = selector => document.querySelector(selector);
let notes = [];
let editingId = null;
let deletingId = null;
let searchController;
let searchTimer;
let noteBusy = false;
let missions = [];
let missionBusy = false;
const form = $('#note-form');
const deleteDialog = $('#delete-dialog');

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || 'The request could not be completed.');
    error.fields = body.error?.fields || {};
    throw error;
  }
  return body;
}

async function loadPlanets() {
  searchController?.abort();
  searchController = new AbortController();
  const controller = searchController;
  const selected = document.querySelector('[name="planet-filter"]:checked').id;
  const kind = { 'all-worlds': 'all', 'rocky-worlds': 'rocky', 'giant-worlds': 'giant' }[selected];
  const query = new URLSearchParams({ kind, q: $('#planet-search').value.trim() });
  $('#planet-status').textContent = 'Loading destinations…';
  $('#planets').setAttribute('aria-busy', 'true');
  try {
    const { planets } = await request(`/api/planets?${query}`, { signal: controller.signal });
    const ids = new Set(planets.map(p => p.id));
    document.querySelectorAll('.planet-card').forEach(card => { card.hidden = !ids.has(card.id); });
    for (const planet of planets) {
      const card = document.getElementById(planet.id);
      card.querySelectorAll('dd')[0].textContent = planet.radiusKm.toLocaleString('en-US') + ' km';
      card.querySelectorAll('dd')[1].textContent = planet.year;
      card.querySelector('.details-copy p').textContent = planet.description;
    }
    $('#planet-status').textContent = planets.length ? `${planets.length} destination${planets.length === 1 ? '' : 's'} loaded from the server.` : 'No destinations found. Try another name or category.';
  } catch (error) {
    if (error.name !== 'AbortError') $('#planet-status').textContent = 'Could not load the catalogue. Start the server and try again.';
  } finally { if (!controller.signal.aborted) $('#planets').setAttribute('aria-busy', 'false'); }
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderNotes() {
  const list = $('#notes-list');
  list.replaceChildren();
  for (const note of notes) {
    const article = makeElement('article', 'saved-note');
    article.dataset.noteId = note.id;
    article.append(makeElement('p', 'note-tag', `${note.planetName} / ${note.status === 'explored' ? 'Explored' : 'Want to explore'}`));
    article.append(makeElement('h4', '', note.title));
    // User text is never inserted as HTML, so markup is displayed safely as text.
    article.append(makeElement('p', 'note-body', note.note));
    article.append(makeElement('p', 'note-date', 'Updated ' + new Date(note.updatedAt).toLocaleString()));
    const actions = makeElement('div', 'note-actions');
    for (const action of ['Edit', 'Delete']) {
      const button = makeElement('button', 'text-link', action);
      button.type = 'button';
      button.dataset.action = action.toLowerCase();
      button.dataset.id = note.id;
      button.setAttribute('aria-label', `${action} ${note.title}`);
      actions.append(button);
    }
    article.append(actions);
    list.append(article);
  }
  $('#notes-message').textContent = notes.length ? `${notes.length} saved discover${notes.length === 1 ? 'y' : 'ies'}.` : 'No discoveries yet. Add your first note on the left.';
}

async function loadNotes() {
  $('#refresh-notes').disabled = true;
  try {
    ({ notes } = await request('/api/notes'));
    renderNotes();
  } catch {
    $('#notes-message').textContent = 'Your notebook could not be loaded. Check the server, then select Refresh.';
  } finally { $('#refresh-notes').disabled = false; }
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  $('#form-message').textContent = '';
}

function resetForm() {
  editingId = null;
  form.reset();
  clearErrors();
  $('#form-title').textContent = 'New discovery';
  $('#save-note').textContent = 'Save discovery ↗';
  $('#cancel-edit').hidden = true;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (noteBusy) return;
  clearErrors();
  // Match the trimmed server rules before sending; server validation remains authoritative.
  for (const name of ['title', 'note']) {
    if (!form.elements.namedItem(name).value.trim()) {
      $(`#error-${name}`).textContent = `Enter a ${name === 'note' ? 'note' : 'title'} before saving.`;
      form.elements.namedItem(name).setAttribute('aria-invalid', 'true');
    }
  }
  if (form.querySelector('[aria-invalid="true"]')) {
    $('#form-message').textContent = 'Please correct the highlighted fields.';
    form.querySelector('[aria-invalid="true"]').focus();
    return;
  }
  noteBusy = true;
  form.setAttribute('aria-busy', 'true');
  $('#cancel-edit').disabled = true;
  const button = $('#save-note');
  button.disabled = true;
  const value = Object.fromEntries(new FormData(form));
  try {
    const wasEditing = editingId !== null;
    await request(wasEditing ? `/api/notes/${editingId}` : '/api/notes', {
      method: wasEditing ? 'PUT' : 'POST', body: JSON.stringify(value)
    });
    resetForm();
    $('#form-message').textContent = wasEditing ? 'Discovery updated.' : 'Discovery saved.';
    await loadNotes();
  } catch (error) {
    $('#form-message').textContent = error.message || 'Could not save. Check the server and try again.';
    for (const [name, message] of Object.entries(error.fields || {})) {
      $(`#error-${name}`).textContent = message;
      form.elements.namedItem(name)?.setAttribute('aria-invalid', 'true');
    }
    form.querySelector('[aria-invalid="true"]')?.focus();
  } finally {
    button.disabled = false; noteBusy = false;
    $('#cancel-edit').disabled = false; form.setAttribute('aria-busy', 'false');
  }
});

$('#notes-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (noteBusy) return;
  const note = notes.find(note => note.id === Number(button.dataset.id));
  if (!note) return;
  if (button.dataset.action === 'edit') {
    clearErrors();
    editingId = note.id;
    for (const name of ['planetId', 'title', 'note', 'status']) form.elements.namedItem(name).value = note[name];
    $('#form-title').textContent = 'Edit discovery';
    $('#save-note').textContent = 'Save changes ↗';
    $('#cancel-edit').hidden = false;
    form.scrollIntoView({ block: 'center' });
    $('#note-title').focus({ preventScroll: true });
  } else {
    deletingId = note.id;
    $('#delete-message').textContent = '';
    deleteDialog.showModal();
    $('#cancel-delete').focus();
  }
});

$('#confirm-delete').addEventListener('click', async () => {
  $('#confirm-delete').disabled = true;
  try {
    await request(`/api/notes/${deletingId}`, { method: 'DELETE' });
    if (editingId === deletingId) resetForm();
    deleteDialog.close();
    await loadNotes();
    $('#notes-message').textContent = `Discovery deleted. ${notes.length} remaining.`;
    $('#refresh-notes').focus({ preventScroll: true });
  } catch (error) { $('#delete-message').textContent = error.message || 'Could not delete. Please try again.'; }
  finally { $('#confirm-delete').disabled = false; }
});
$('#cancel-delete').addEventListener('click', () => deleteDialog.close());
$('#cancel-edit').addEventListener('click', () => { resetForm(); $('#note-title').focus(); });
$('#refresh-notes').addEventListener('click', loadNotes);
document.querySelectorAll('[name="planet-filter"]').forEach(input => input.addEventListener('change', loadPlanets));
$('#planet-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadPlanets, 200); });
async function visitPlanet(id) {
  clearTimeout(searchTimer);
  $('#all-worlds').checked = true;
  $('#planet-search').value = '';
  document.querySelectorAll('.planet-card').forEach(card => { card.hidden = false; });
  await loadPlanets();
  history.replaceState(null, '', '#' + id);
  const card = document.getElementById(id);
  card.scrollIntoView({ block: 'start' });
  card.querySelector('summary').focus({ preventScroll: true });
}
$('.earth-marker').addEventListener('click', async event => {
  event.preventDefault();
  await visitPlanet('earth');
});

function renderMissions() {
  const list = $('#mission-list');
  list.replaceChildren();
  const completed = missions.filter(m => m.completed).length;
  $('#trail-count').textContent = `${completed} of ${missions.length} missions completed`;
  $('#trail-progress').max = missions.length || 1;
  $('#trail-progress').value = completed;
  const next = missions.find(m => !m.completed);
  $('#next-mission').textContent = next ? `Next mission: ${next.title}` : missions.length ? 'Trail complete. Revisit a world or record a new discovery.' : 'No missions available yet.';
  for (const mission of missions) {
    const card = makeElement('article', 'trail-card');
    card.dataset.missionId = mission.id;
    card.append(makeElement('p', 'note-tag', `${mission.planetId} / ${mission.completed ? 'Completed' : 'Ready to explore'}`));
    card.append(makeElement('h3', '', mission.title));
    card.append(makeElement('p', '', mission.objective));
    card.append(makeElement('p', 'trail-condition', 'Complete when: ' + mission.condition));
    const actions = makeElement('div', 'trail-actions');
    for (const [action, label] of [['planet', 'Explore planet ↗'], ['notebook', 'Write a discovery ↗'], ['toggle', mission.completed ? 'Reopen mission' : 'Mark completed']]) {
      const button = makeElement('button', action === 'toggle' ? 'button button-outline' : 'text-link', label);
      button.type = 'button'; button.dataset.action = action;
      if (action === 'toggle') button.setAttribute('aria-pressed', String(mission.completed));
      actions.append(button);
    }
    card.append(actions); list.append(card);
  }
}
async function loadMissions() {
  if (missionBusy) return;
  missionBusy = true;
  $('#refresh-missions').disabled = true;
  $('#mission-list').setAttribute('aria-busy', 'true');
  $('#mission-message').textContent = 'Loading mission progress…';
  try {
    ({ missions } = await request('/api/missions'));
    renderMissions();
    $('#mission-message').textContent = missions.length ? 'Mission progress is up to date.' : 'No missions available yet.';
  } catch {
    $('#mission-message').textContent = 'Could not load mission progress. Check the server, then refresh missions.';
  } finally {
    missionBusy = false;
    $('#refresh-missions').disabled = false;
    $('#mission-list').setAttribute('aria-busy', 'false');
  }
}
$('#refresh-missions').addEventListener('click', loadMissions);
$('#mission-list').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const card = button.closest('[data-mission-id]');
  const mission = missions.find(m => m.id === card.dataset.missionId);
  if (button.dataset.action === 'planet') return visitPlanet(mission.planetId);
  if (button.dataset.action === 'notebook') {
    if (noteBusy) return;
    if (editingId !== null || $('#note-title').value || $('#note-text').value) {
      $('#form-message').textContent = 'Save or cancel your current discovery before starting a mission note.';
    } else { $('#note-planet').value = mission.planetId; }
    $('#note-title').focus();
    return;
  }
  if (missionBusy) return;
  missionBusy = true;
  button.disabled = true;
  $('#refresh-missions').disabled = true;
  try {
    const result = await request(`/api/missions/${mission.id}`, { method: 'PUT', body: JSON.stringify({ completed: !mission.completed }) });
    mission.completed = result.completed;
    renderMissions();
    $('#mission-message').textContent = result.completed ? 'Mission completed. Progress saved.' : 'Mission reopened. Progress saved.';
    $(`[data-mission-id="${mission.id}"] [data-action="toggle"]`).focus({ preventScroll: true });
  } catch {
    $('#mission-message').textContent = 'Progress could not be saved. Please try again.';
    button.disabled = false;
  } finally { missionBusy = false; $('#refresh-missions').disabled = false; }
});
if (location.protocol === 'file:') {
  $('#planet-status').textContent = 'Backend features need the Node server. Run node server.js and open its local URL.';
  $('#notes-message').textContent = 'Start the Node server to use your notebook.';
  $('#save-note').disabled = true;
  $('#mission-message').textContent = 'Start the Node server to save mission progress.';
} else {
  loadPlanets();
  // Establish the visitor cookie before another owned endpoint is requested.
  loadNotes().then(loadMissions);
}
