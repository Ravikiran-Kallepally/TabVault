import { getSessions, createSession, deleteSession, renameSession, pinSession } from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';

let allSessions = [];
let searchQuery = '';
let activeMenuId = null;

const $ = id => document.getElementById(id);

async function init() {
  allSessions = await getSessions();
  await loadCurrentTabCount();
  render();
  bindEvents();
}

async function loadCurrentTabCount() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const count = tabs.filter(t => isValidUrl(t.url)).length;
  $('currentTabCount').textContent = count;
}

function render() {
  const query = searchQuery.toLowerCase().trim();
  let sessions = allSessions;

  const pinned = sessions.filter(s => s.pinned);
  const rest = sessions.filter(s => !s.pinned);
  sessions = [...pinned, ...rest];

  let filtered = sessions;
  let matchMap = {};

  if (query) {
    filtered = sessions.filter(s => {
      const nameMatch = s.name.toLowerCase().includes(query);
      const tabMatches = s.tabs.filter(t =>
        t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query)
      );
      if (nameMatch || tabMatches.length) {
        matchMap[s.id] = tabMatches.length;
        return true;
      }
      return false;
    });
  }

  $('sessionsCount').textContent = filtered.length;

  const list = $('sessionsList');
  const empty = $('emptyState');

  if (!filtered.length) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.querySelector('p').textContent = query ? 'No matches found' : 'No sessions yet';
    empty.querySelector('span').textContent = query ? 'Try a different search' : 'Save your first session above';
    return;
  }

  if (list.contains(empty)) list.removeChild(empty);

  list.innerHTML = filtered.map(s => sessionHTML(s, matchMap[s.id])).join('');

  list.querySelectorAll('.fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.fav');
      const url = fav.dataset.url || '';
      fav.style.background = domainColor(url);
      fav.textContent = getFavLetter(url);
    });
  });
}

function sessionHTML(s, matchCount) {
  const favs = s.tabs.slice(0, 4);
  const favsHTML = favs.map(t => {
    const color = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      return `<div class="fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" />
      </div>`;
    }
    return `<div class="fav" style="background:${color}">${letter}</div>`;
  }).join('');

  const matchHTML = (matchCount && searchQuery)
    ? `<div class="match-tabs">${matchCount} tab${matchCount > 1 ? 's' : ''} matched</div>`
    : '';

  return `<div class="session-item ${s.pinned ? 'pinned' : ''}" data-id="${s.id}">
    <div class="pin-dot"></div>
    <div class="favicons">${favsHTML}</div>
    <div class="session-info">
      <div class="session-name">${escapeHtml(truncate(s.name, 36))}</div>
      <div class="session-meta">
        <span>${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''}</span>
        <span class="dot">·</span>
        <span>${timeAgo(s.createdAt)}</span>
      </div>
      ${matchHTML}
    </div>
    <div class="session-actions">
      <button class="action-btn restore" data-id="${s.id}" data-action="restore-new" title="Open in new window">↗</button>
      <button class="action-btn" data-id="${s.id}" data-action="menu" title="More options">⋯</button>
    </div>
  </div>`;
}

function bindEvents() {
  $('openDashboard').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('saveBtn').addEventListener('click', () => {
    const nameBar = $('nameBar');
    nameBar.classList.remove('hidden');
    const input = $('nameInput');
    input.value = '';
    input.focus();
  });

  $('cancelSave').addEventListener('click', () => {
    $('nameBar').classList.add('hidden');
  });

  $('confirmSave').addEventListener('click', doSave);

  $('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') $('nameBar').classList.add('hidden');
  });

  $('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    $('clearSearch').classList.toggle('hidden', !searchQuery);
    render();
  });

  $('clearSearch').addEventListener('click', () => {
    $('search').value = '';
    searchQuery = '';
    $('clearSearch').classList.add('hidden');
    $('search').focus();
    render();
  });

  $('sessionsList').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      handleAction(btn.dataset.action, btn.dataset.id, btn);
      return;
    }
    const item = e.target.closest('.session-item');
    if (item) handleAction('restore-new', item.dataset.id, item);
  });

  document.addEventListener('click', hideMenu);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideMenu();
  });

  const menu = $('contextMenu');
  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn && activeMenuId) {
      handleMenuAction(btn.dataset.action, activeMenuId);
      hideMenu();
    }
  });
}

async function doSave() {
  const name = $('nameInput').value.trim();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) { showToast('No saveable tabs in this window'); return; }

  const session = await createSession(name, saveable);
  allSessions = await getSessions();
  $('nameBar').classList.add('hidden');
  render();
  showToast(`Saved "${session.name}" · ${saveable.length} tabs`);
}

async function handleAction(action, id, el) {
  if (action === 'restore-new') {
    const s = allSessions.find(s => s.id === id);
    if (!s) return;
    const urls = s.tabs.map(t => t.url).filter(Boolean);
    await chrome.windows.create({ url: urls });
    return;
  }

  if (action === 'menu') {
    showMenu(id, el);
    return;
  }
}

async function handleMenuAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore-new') {
    await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
    return;
  }

  if (action === 'restore-here') {
    const [win] = await chrome.windows.getAll({ populate: false });
    for (const t of s.tabs) {
      await chrome.tabs.create({ url: t.url, windowId: win.id });
    }
    return;
  }

  if (action === 'rename') {
    const item = document.querySelector(`.session-item[data-id="${id}"]`);
    if (!item) return;
    const nameEl = item.querySelector('.session-name');
    const oldName = s.name;
    nameEl.innerHTML = `<input class="rename-input" value="${escapeHtml(oldName)}" maxlength="60" />`;
    const input = nameEl.querySelector('input');
    input.focus();
    input.select();
    const commit = async () => {
      const newName = input.value.trim() || oldName;
      await renameSession(id, newName);
      allSessions = await getSessions();
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { nameEl.textContent = oldName; }
    });
    return;
  }

  if (action === 'pin') {
    await pinSession(id, !s.pinned);
    allSessions = await getSessions();
    render();
    showToast(s.pinned ? 'Unpinned' : 'Pinned to top');
    return;
  }

  if (action === 'delete') {
    await deleteSession(id);
    allSessions = await getSessions();
    render();
    showToast('Session deleted');
    return;
  }
}

function showMenu(id, anchor) {
  activeMenuId = id;
  const menu = $('contextMenu');
  const s = allSessions.find(s => s.id === id);

  menu.querySelector('[data-action="pin"]').textContent = s?.pinned ? 'Unpin' : 'Pin to top';

  const rect = anchor.getBoundingClientRect();
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = rect.right - mw;
  let top = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight - 4) top = rect.top - mh - 4;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function hideMenu() {
  $('contextMenu').classList.add('hidden');
  activeMenuId = null;
}

let toastTimer;
function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

init();
