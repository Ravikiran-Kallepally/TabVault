import { getSessions, deleteSession, renameSession, pinSession, exportSessions, importSessions } from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';

let allSessions = [];
let selectedId = null;
let activeFilter = 'all';
let searchQuery = '';
let sortMode = 'newest';

const $ = id => document.getElementById(id);

async function init() {
  allSessions = await getSessions();
  updateStats();
  render();
  bindEvents();
}

function updateStats() {
  $('statSessions').textContent = allSessions.length;
  $('statTabs').textContent = allSessions.reduce((n, s) => n + s.tabs.length, 0);
}

function getFiltered() {
  const now = Date.now();
  const DAY = 86400000;
  const WEEK = 7 * DAY;

  let sessions = [...allSessions];

  if (activeFilter === 'pinned') sessions = sessions.filter(s => s.pinned);
  else if (activeFilter === 'today') sessions = sessions.filter(s => now - s.createdAt < DAY);
  else if (activeFilter === 'week') sessions = sessions.filter(s => now - s.createdAt < WEEK);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    sessions = sessions.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.tabs.some(t => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q))
    );
  }

  sessions.sort((a, b) => {
    if (sortMode === 'newest') return b.createdAt - a.createdAt;
    if (sortMode === 'oldest') return a.createdAt - b.createdAt;
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    if (sortMode === 'tabs') return b.tabs.length - a.tabs.length;
    return 0;
  });

  const pinned = sessions.filter(s => s.pinned);
  const rest = sessions.filter(s => !s.pinned);
  return [...pinned, ...rest];
}

function render() {
  const filtered = getFiltered();
  const grid = $('sessionGrid');
  const empty = $('emptyState');

  if (!filtered.length) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    $('emptyTitle').textContent = searchQuery ? 'No matches found' : 'No sessions yet';
    $('emptyMsg').textContent = searchQuery
      ? 'Try different keywords.'
      : 'Open the extension popup and save your first session.';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(s => cardHTML(s)).join('');

  grid.querySelectorAll('.card-fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.card-fav');
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent = getFavLetter(fav.dataset.url || '');
    });
  });
}

function cardHTML(s) {
  const preview = s.tabs.slice(0, 8);
  const favsHTML = preview.map(t => {
    const color = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      return `<div class="card-fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" />
      </div>`;
    }
    return `<div class="card-fav" style="background:${color}">${letter}</div>`;
  }).join('');

  return `<div class="session-card ${s.pinned ? 'pinned' : ''} ${selectedId === s.id ? 'selected' : ''}" data-id="${s.id}">
    <div class="card-favicons">${favsHTML}</div>
    <div class="card-name" title="${escapeHtml(s.name)}">${escapeHtml(truncate(s.name, 32))}</div>
    <div class="card-meta">
      <span>${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''}</span>
      <span class="card-dot">·</span>
      <span>${timeAgo(s.createdAt)}</span>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-id="${s.id}" data-action="restore">Open</button>
      <button class="card-btn" data-id="${s.id}" data-action="pin">${s.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="card-btn del" data-id="${s.id}" data-action="delete">Delete</button>
    </div>
  </div>`;
}

function showDetail(id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  selectedId = id;
  render();

  $('detailEmpty').style.display = 'none';
  const content = $('detailContent');
  content.classList.remove('hidden');

  $('detailTitle').textContent = s.name;
  $('detailMeta').textContent = `${s.tabs.length} tabs · saved ${timeAgo(s.createdAt)}`;

  $('detailRestore').onclick = () => {
    chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
  };

  $('tabsList').innerHTML = s.tabs.map(t => {
    const color = domainColor(t.url);
    const letter = getFavLetter(t.url);
    let favHTML;
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      favHTML = `<div class="tab-fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" />
      </div>`;
    } else {
      favHTML = `<div class="tab-fav" style="background:${color}">${letter}</div>`;
    }
    return `<div class="tab-item" data-url="${escapeHtml(t.url)}">
      ${favHTML}
      <div class="tab-info">
        <div class="tab-title" title="${escapeHtml(t.title)}">${escapeHtml(truncate(t.title, 38))}</div>
        <div class="tab-url">${escapeHtml(getDomain(t.url))}</div>
      </div>
    </div>`;
  }).join('');

  $('tabsList').querySelectorAll('.tab-fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.tab-fav');
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent = getFavLetter(fav.dataset.url || '');
    });
  });
}

function bindEvents() {
  $('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    render();
  });

  $('sortSelect').addEventListener('change', e => {
    sortMode = e.target.value;
    render();
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      render();
    });
  });

  $('sessionGrid').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      await handleCardAction(btn.dataset.action, btn.dataset.id);
      return;
    }
    const card = e.target.closest('.session-card');
    if (card) showDetail(card.dataset.id);
  });

  $('tabsList').addEventListener('click', e => {
    const item = e.target.closest('.tab-item');
    if (item && item.dataset.url) {
      chrome.tabs.create({ url: item.dataset.url });
    }
  });

  $('exportBtn').addEventListener('click', async () => {
    const json = await exportSessions();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabvault-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sessions exported');
  });

  $('importFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = await importSessions(text);
      allSessions = await getSessions();
      updateStats();
      render();
      showToast(`Imported ${count} session${count !== 1 ? 's' : ''}`);
    } catch {
      showToast('Import failed — invalid file');
    }
    e.target.value = '';
  });
}

async function handleCardAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore') {
    await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
    return;
  }

  if (action === 'pin') {
    await pinSession(id, !s.pinned);
    allSessions = await getSessions();
    updateStats();
    render();
    if (selectedId === id) showDetail(id);
    return;
  }

  if (action === 'delete') {
    await deleteSession(id);
    allSessions = await getSessions();
    if (selectedId === id) {
      selectedId = null;
      $('detailEmpty').style.display = 'flex';
      $('detailContent').classList.add('hidden');
    }
    updateStats();
    render();
    showToast('Session deleted');
    return;
  }
}

let toastTimer;
function showToast(msg) {
  const toast = $('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

init();
