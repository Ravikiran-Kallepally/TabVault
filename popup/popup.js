import { getSessions, createSession, deleteSession, renameSession, pinSession } from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';
import { getApiKey } from '../utils/storage.js';
import { suggestSessionName, suggestTabGroups } from '../utils/ai.js';

let allSessions = [];
let searchQuery  = '';
let activeMenuId = null;

// undo-delete state
let pendingDelete  = null;
let deleteTimer    = null;

// toast timer
let toastTimer = null;

const $ = id => document.getElementById(id);

async function init() {
  allSessions = await getSessions();
  await loadCurrentTabCount();
  render();
  bindEvents();
}

async function loadCurrentTabCount() {
  const tabs  = await chrome.tabs.query({ currentWindow: true });
  const count = tabs.filter(t => isValidUrl(t.url)).length;
  $('currentTabCount').textContent = count;
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  const query = searchQuery.toLowerCase().trim();

  const pinned = allSessions.filter(s => s.pinned);
  const rest   = allSessions.filter(s => !s.pinned);
  let sessions = [...pinned, ...rest];

  let filtered = sessions;
  const matchMap = {};

  if (query) {
    filtered = sessions.filter(s => {
      const nameMatch  = s.name.toLowerCase().includes(query);
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

  const list  = $('sessionsList');
  const empty = $('emptyState');

  if (!filtered.length) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.querySelector('p').textContent    = query ? 'No matches found'       : 'No sessions yet';
    empty.querySelector('span').textContent = query ? 'Try a different search' : 'Save your first session above';
    return;
  }

  if (list.contains(empty)) list.removeChild(empty);
  list.innerHTML = filtered.map(s => sessionHTML(s, matchMap[s.id], query)).join('');

  list.querySelectorAll('.fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.fav');
      const url = fav.dataset.url || '';
      fav.style.background = domainColor(url);
      fav.textContent      = getFavLetter(url);
    });
  });
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + `<mark>${escapeHtml(text.slice(idx, idx + query.length))}</mark>`
    + escapeHtml(text.slice(idx + query.length));
}

function sessionHTML(s, matchCount, query) {
  const favs     = s.tabs.slice(0, 4);
  const favsHTML = favs.map(t => {
    const color  = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      return `<div class="fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" />
      </div>`;
    }
    return `<div class="fav" style="background:${color}">${letter}</div>`;
  }).join('');

  const matchHTML = (matchCount && query)
    ? `<div class="match-tabs">${matchCount} tab${matchCount > 1 ? 's' : ''} matched</div>`
    : '';

  const aiDot = s.aiNamed
    ? `<span class="ai-dot" title="AI-named">✨</span>`
    : '';

  return `<div class="session-item ${s.pinned ? 'pinned' : ''}" data-id="${s.id}" tabindex="0">
    <div class="pin-dot"></div>
    <div class="favicons">${favsHTML}</div>
    <div class="session-info">
      <div class="session-name">${highlight(truncate(s.name, 36), query)}${aiDot}</div>
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

// ── Events ────────────────────────────────────────────────────────────────────

function bindEvents() {
  $('openDashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Save session button → open name bar + trigger AI naming
  $('saveBtn').addEventListener('click', openNameBar);

  $('cancelSave').addEventListener('click', closeNameBar);
  $('confirmSave').addEventListener('click', doSave);

  $('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  doSave();
    if (e.key === 'Escape') closeNameBar();
  });

  // Search
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

  // Session list clicks + keyboard nav
  const list = $('sessionsList');

  list.addEventListener('click', e => {
    const btn  = e.target.closest('[data-action]');
    if (btn) { e.stopPropagation(); handleAction(btn.dataset.action, btn.dataset.id, btn); return; }
    const item = e.target.closest('.session-item');
    if (item) handleAction('restore-new', item.dataset.id, item);
  });

  list.addEventListener('keydown', e => {
    const item = e.target.closest('.session-item');
    if (!item) return;
    if (e.key === 'Enter') { handleAction('restore-new', item.dataset.id, item); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); (item.nextElementSibling?.focus()); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); (item.previousElementSibling?.focus()); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteWithUndo(item.dataset.id);
    }
  });

  // Context menu
  document.addEventListener('click', hideMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });

  $('contextMenu').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn && activeMenuId) { handleMenuAction(btn.dataset.action, activeMenuId); hideMenu(); }
  });

  // Smart Group button
  $('smartGroupBtn').addEventListener('click', doSmartGroup);
  $('closeGroupOverlay').addEventListener('click', closeGroupOverlay);
  $('cancelGroupSave').addEventListener('click', closeGroupOverlay);
  $('confirmGroupSave').addEventListener('click', saveAllGroups);
}

// ── Name bar / AI naming ──────────────────────────────────────────────────────

async function openNameBar() {
  const bar   = $('nameBar');
  const input = $('nameInput');
  const badge = $('aiBadge');

  bar.classList.remove('hidden');
  input.value       = '';
  input.disabled    = false;
  badge.classList.add('hidden');
  input.placeholder = 'Name this session…';
  input.focus();

  const key = await getApiKey();
  if (!key) return;

  // Fetch AI suggestion while user sees the bar
  input.disabled    = true;
  input.placeholder = 'Getting AI name…';

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));

  const suggestion = await suggestSessionName(saveable);

  input.disabled    = false;
  input.placeholder = 'Name this session…';

  if (suggestion) {
    input.value = suggestion;
    badge.classList.remove('hidden');
    input.select();
  }
  input.focus();
}

function closeNameBar() {
  $('nameBar').classList.add('hidden');
  $('aiBadge').classList.add('hidden');
  $('nameInput').disabled    = false;
  $('nameInput').placeholder = 'Name this session…';
}

async function doSave() {
  const name    = $('nameInput').value.trim();
  const aiNamed = !$('aiBadge').classList.contains('hidden') && name.length > 0;

  const tabs     = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) { showToast('No saveable tabs in this window'); return; }

  const session = await createSession(name, saveable, aiNamed);
  allSessions   = await getSessions();
  closeNameBar();
  render();
  showToast(`Saved "${session.name}" · ${saveable.length} tabs`);
}

// ── Restore actions ───────────────────────────────────────────────────────────

async function handleAction(action, id, el) {
  if (action === 'restore-new') {
    const s = allSessions.find(s => s.id === id);
    if (!s) return;
    await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
    return;
  }
  if (action === 'menu') { showMenu(id, el); return; }
}

async function handleMenuAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore-new') {
    await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
    return;
  }

  if (action === 'restore-here') {
    const win = await chrome.windows.getCurrent();
    for (const t of s.tabs) await chrome.tabs.create({ url: t.url, windowId: win.id });
    return;
  }

  if (action === 'rename') {
    const item   = document.querySelector(`.session-item[data-id="${id}"]`);
    if (!item) return;
    const nameEl = item.querySelector('.session-name');
    const oldName = s.name;
    nameEl.innerHTML = `<input class="rename-input" value="${escapeHtml(oldName)}" maxlength="60" />`;
    const input = nameEl.querySelector('input');
    input.focus(); input.select();
    const commit = async () => {
      const newName = input.value.trim() || oldName;
      await renameSession(id, newName);
      allSessions = await getSessions();
      render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
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

  if (action === 'delete') { deleteWithUndo(id); return; }
}

// ── Undo delete ───────────────────────────────────────────────────────────────

function deleteWithUndo(id) {
  // Commit any previously pending delete immediately
  if (pendingDelete) {
    clearTimeout(deleteTimer);
    deleteSession(pendingDelete.id);
  }

  pendingDelete = allSessions.find(s => s.id === id);
  if (!pendingDelete) return;

  allSessions = allSessions.filter(s => s.id !== id);
  render();

  showToast(`"${truncate(pendingDelete.name, 24)}" deleted`, async () => {
    clearTimeout(deleteTimer);
    // Re-insert at front; let next getSessions reflect it
    const sessions = await getSessions();
    // session is still in storage (we haven't deleted it yet)
    allSessions    = sessions;
    pendingDelete  = null;
    render();
  });

  deleteTimer = setTimeout(async () => {
    if (pendingDelete) {
      await deleteSession(pendingDelete.id);
      pendingDelete = null;
    }
  }, 5000);
}

// ── Smart Group overlay ───────────────────────────────────────────────────────

let proposedGroups = []; // [{name, tabs}]

async function doSmartGroup() {
  const key = await getApiKey();
  if (!key) {
    showToast('Add your Claude API key in Dashboard → Settings');
    return;
  }

  const overlay = $('groupOverlay');
  overlay.classList.remove('hidden');
  $('groupLoading').classList.remove('hidden');
  $('groupResults').classList.add('hidden');
  $('groupFooter').classList.add('hidden');

  const tabs     = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));

  if (saveable.length < 2) {
    closeGroupOverlay();
    showToast('Not enough tabs to group');
    return;
  }

  const result = await suggestTabGroups(saveable);

  $('groupLoading').classList.add('hidden');

  if (!result || !result.groups?.length) {
    closeGroupOverlay();
    showToast('AI grouping failed — try again');
    return;
  }

  // Map indices to actual tab objects
  proposedGroups = result.groups
    .filter(g => g.indices?.length)
    .map(g => ({
      name: g.name,
      tabs: g.indices.map(i => saveable[i]).filter(Boolean)
    }));

  renderGroupResults();

  $('groupResults').classList.remove('hidden');
  $('groupFooter').classList.remove('hidden');
}

function renderGroupResults() {
  $('groupResults').innerHTML = proposedGroups.map((g, gi) => {
    const favs = g.tabs.slice(0, 5).map(t => {
      if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
        return `<div class="gfav" data-url="${escapeHtml(t.url)}" style="background:${domainColor(t.url)}">
          <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" />
        </div>`;
      }
      return `<div class="gfav" style="background:${domainColor(t.url)}">${getFavLetter(t.url)}</div>`;
    }).join('');

    return `<div class="group-card">
      <input class="group-name-input" data-gi="${gi}" value="${escapeHtml(g.name)}" maxlength="60" />
      <div class="group-favs">${favs}</div>
      <div class="group-tab-count">${g.tabs.length} tab${g.tabs.length !== 1 ? 's' : ''}</div>
    </div>`;
  }).join('');

  // Sync name edits back to proposedGroups
  $('groupResults').querySelectorAll('.group-name-input').forEach(inp => {
    inp.addEventListener('input', e => {
      proposedGroups[+e.target.dataset.gi].name = e.target.value;
    });
  });

  // Favicon fallback
  $('groupResults').querySelectorAll('.gfav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.gfav');
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent      = getFavLetter(fav.dataset.url || '');
    });
  });
}

async function saveAllGroups() {
  let saved = 0;
  for (const g of proposedGroups) {
    if (g.tabs.length) {
      await createSession(g.name, g.tabs, true);
      saved++;
    }
  }
  allSessions = await getSessions();
  closeGroupOverlay();
  render();
  showToast(`Saved ${saved} group${saved !== 1 ? 's' : ''} as sessions`);
}

function closeGroupOverlay() {
  $('groupOverlay').classList.add('hidden');
  proposedGroups = [];
}

// ── Context menu ──────────────────────────────────────────────────────────────

function showMenu(id, anchor) {
  activeMenuId = id;
  const menu = $('contextMenu');
  const s    = allSessions.find(s => s.id === id);
  menu.querySelector('[data-action="pin"]').textContent = s?.pinned ? 'Unpin' : 'Pin to top';

  const rect = anchor.getBoundingClientRect();
  menu.classList.remove('hidden');
  const mw   = menu.offsetWidth;
  const mh   = menu.offsetHeight;
  let left    = rect.right - mw;
  let top     = rect.bottom + 4;
  if (left < 4)                            left = 4;
  if (top + mh > window.innerHeight - 4)  top  = rect.top - mh - 4;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

function hideMenu() {
  $('contextMenu').classList.add('hidden');
  activeMenuId = null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, onUndo) {
  const toast    = $('toastEl');
  const msgEl    = $('toastMsg');
  const undoBtn  = $('toastUndo');

  msgEl.textContent = msg;

  if (onUndo) {
    undoBtn.classList.remove('hidden');
    undoBtn.onclick = () => { onUndo(); toast.classList.remove('show'); };
  } else {
    undoBtn.classList.add('hidden');
    undoBtn.onclick = null;
  }

  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), onUndo ? 5000 : 2200);
}

init();
