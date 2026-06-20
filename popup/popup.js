import {
  getSessions, createSession, deleteSession, restoreSession, renameSession, pinSession, duplicateSession,
  getTags, upsertTag, setSessionTags,
  getSnapshots,
  hasOnboarded, markOnboarded
} from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allSessions        = [];
let allTags            = {};
let searchQuery        = '';
let activeMenuId       = null;
let activeTag          = null;
let activeTagSessionId = null;
let pendingDelete      = null;
let deleteTimer        = null;
let toastTimer         = null;
let obStep             = 0;
let recoverySnapshot   = null;
let searchTimer        = null;

const $ = id => document.getElementById(id);

// Chrome tab group color → hex
const GC = {
  grey:'#5f6368', blue:'#1a73e8', red:'#d93025', yellow:'#f9ab00',
  green:'#34a853', pink:'#e91e8c', purple:'#9c27b0', cyan:'#00bcd4', orange:'#f57c00'
};

// ── Theme ─────────────────────────────────────────────────────────────────────
async function loadTheme() {
  const { tabvault_theme } = await chrome.storage.local.get('tabvault_theme');
  const theme = tabvault_theme ?? 'dark';
  document.documentElement.setAttribute('data-theme', theme);
}

async function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  await chrome.storage.local.set({ tabvault_theme: next });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadTheme();
  $('themeToggle').addEventListener('click', toggleTheme);

  if (!(await hasOnboarded())) { showOnboarding(); return; }
  await loadAll();
  await checkRecovery();
  render();
  renderTagFilter();
  bindEvents();
}

async function loadAll() {
  [allSessions, allTags] = await Promise.all([getSessions(), getTags()]);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  $('currentTabCount').textContent = tabs.filter(t => isValidUrl(t.url)).length;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const OB_TOTAL = 3;

function showOnboarding() {
  obStep = 0;
  $('onboarding').classList.remove('hidden');
  updateObStep();
  $('obNext').addEventListener('click', advanceOnboarding);
}

function updateObStep() {
  for (let i = 0; i < OB_TOTAL; i++) {
    $(`obStep${i}`).classList.toggle('hidden', i !== obStep);
  }
  $('obDots').querySelectorAll('.ob-dot').forEach((d, i) => d.classList.toggle('active', i === obStep));
  $('obNext').textContent = obStep === OB_TOTAL - 1 ? 'Get Started →' : 'Next →';
}

async function advanceOnboarding() {
  if (obStep < OB_TOTAL - 1) { obStep++; updateObStep(); return; }
  await markOnboarded();
  $('onboarding').classList.add('hidden');
  await loadAll();
  await checkRecovery();
  render();
  renderTagFilter();
  bindEvents();
}

// ── Recovery ──────────────────────────────────────────────────────────────────
async function checkRecovery() {
  const { tabvault_startup } = await chrome.storage.local.get('tabvault_startup');
  if (!tabvault_startup) return;
  await chrome.storage.local.remove('tabvault_startup');

  const snaps = await getSnapshots();
  if (!snaps.length) return;

  recoverySnapshot = snaps[0];
  const totalTabs  = recoverySnapshot.windows.reduce((n, w) => n + w.tabs.length, 0);
  if (!totalTabs) return;

  $('recoverySub').textContent = `${totalTabs} tabs · ${timeAgo(recoverySnapshot.savedAt)}`;
  $('recoveryBanner').classList.remove('hidden');
}

async function restoreSnapshot() {
  if (!recoverySnapshot) return;
  for (const w of recoverySnapshot.windows) {
    const urls = w.tabs.map(t => t.url).filter(Boolean);
    if (urls.length) await chrome.windows.create({ url: urls });
  }
  $('recoveryBanner').classList.add('hidden');
  showToast(`Restored ${recoverySnapshot.windows.length} window${recoverySnapshot.windows.length !== 1 ? 's' : ''}`);
  recoverySnapshot = null;
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const query  = searchQuery.toLowerCase().trim();
  const pinned = allSessions.filter(s => s.pinned);
  const rest   = allSessions.filter(s => !s.pinned);
  let sessions = [...pinned, ...rest];

  if (activeTag) sessions = sessions.filter(s => (s.tags || []).includes(activeTag));

  let filtered   = sessions;
  const matchMap = {};

  if (query) {
    filtered = sessions.filter(s => {
      const nameMatch  = s.name.toLowerCase().includes(query);
      const tabMatches = s.tabs.filter(t =>
        t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query)
      );
      if (nameMatch || tabMatches.length) { matchMap[s.id] = tabMatches.length; return true; }
      return false;
    });
  }

  $('sessionsCount').textContent = filtered.length;
  const list  = $('sessionsList');
  const empty = $('emptyState');

  if (!filtered.length) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.querySelector('p').textContent    = query || activeTag ? 'No matches found'       : 'No sessions yet';
    empty.querySelector('span').textContent = query || activeTag ? 'Try a different search' : 'Save your first session above';
    return;
  }

  if (list.contains(empty)) list.removeChild(empty);
  list.innerHTML = filtered.map(s => sessionHTML(s, matchMap[s.id], query)).join('');

  list.querySelectorAll('.fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.fav');
      fav.innerHTML = getFavLetter(fav.dataset.url || '');
      fav.style.background = domainColor(fav.dataset.url || '');
    });
  });
}

function renderTagFilter() {
  const row   = $('tagFilterRow');
  const names = Object.keys(allTags);
  if (!names.length) { row.classList.add('hidden'); return; }

  row.classList.remove('hidden');
  row.innerHTML = `<button class="tf-chip tf-all ${!activeTag ? 'active' : ''}" data-tag="">All</button>` +
    names.map(name => {
      const color = allTags[name];
      return `<button class="tf-chip ${activeTag === name ? 'active' : ''}"
        data-tag="${escapeHtml(name)}" style="--tc:${color}">${escapeHtml(name)}</button>`;
    }).join('');
}

function sessionHTML(s, matchCount, query) {
  const sc = s.tabs.length ? domainColor(s.tabs[0].url) : '#1a73e8';

  const favSlice = s.tabs.slice(0, 5);
  const overflow = s.tabs.length - 5;
  const favsHTML = favSlice.map(t => {
    const color  = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      return `<div class="fav" data-url="${escapeHtml(t.url)}" title="${escapeHtml(t.title)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`;
    }
    return `<div class="fav" data-url="${escapeHtml(t.url)}" title="${escapeHtml(t.title)}" style="background:${color}">${letter}</div>`;
  }).join('') + (overflow > 0 ? `<div class="fav-more">+${overflow}</div>` : '');

  const pinnedDot = s.pinned ? `<span class="pin-indicator" title="Pinned">📌</span>` : '';

  const tagsHTML = (s.tags || []).length
    ? (s.tags).slice(0, 3).map(tag => {
        const c = allTags[tag] || '#1a73e8';
        return `<span class="tag-chip" style="--tc:${c}">${escapeHtml(tag)}</span>`;
      }).join('') + (s.tags.length > 3 ? `<span class="tag-chip tag-more">+${s.tags.length - 3}</span>` : '')
    : '';

  const groups = s.groups || [];
  const groupsHTML = groups.length
    ? groups.slice(0, 4).map(g =>
        `<span class="group-dot" style="background:${GC[g.color] || '#888'}" title="${escapeHtml(g.title)}"></span>`
      ).join('')
    : '';

  const matchBadge = (matchCount && query)
    ? `<span class="match-badge">${matchCount} matched</span>` : '';

  return `<div class="session-item ${s.pinned ? 'pinned' : ''}" data-id="${s.id}" tabindex="0" style="--sc:${sc}">
    <div class="item-top">
      <span class="session-name">${highlight(truncate(s.name, 36), query)}${pinnedDot}</span>
      <div class="session-actions">
        <button class="action-btn restore" data-id="${s.id}" data-action="restore-new" title="Open">↗</button>
        <button class="action-btn" data-id="${s.id}" data-action="tag" title="Tags">🏷</button>
        <button class="action-btn" data-id="${s.id}" data-action="menu" title="More">⋯</button>
      </div>
    </div>
    <div class="item-bottom">
      <div class="favicons">${favsHTML}</div>
      <div class="item-meta">
        <span class="meta-count">${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''}</span>
        <span class="dot">·</span>
        <span>${timeAgo(s.createdAt)}</span>
        ${groupsHTML}${matchBadge}
      </div>
      ${tagsHTML ? `<div class="session-tags">${tagsHTML}</div>` : ''}
    </div>
  </div>`;
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx))
    + `<mark>${escapeHtml(text.slice(idx, idx + query.length))}</mark>`
    + escapeHtml(text.slice(idx + query.length));
}

// ── Tab Groups ────────────────────────────────────────────────────────────────
async function captureTabGroups(tabs) {
  const groupIndexMap = {};
  const groups = [];

  for (const tab of tabs) {
    if (tab.groupId != null && tab.groupId !== -1 && groupIndexMap[tab.groupId] == null) {
      try {
        const g = await chrome.tabGroups.get(tab.groupId);
        groupIndexMap[tab.groupId] = groups.length;
        groups.push({ title: g.title || '', color: g.color });
      } catch {}
    }
  }

  const tabsWithGroups = tabs.map(t => ({
    ...t,
    groupIndex: (t.groupId != null && t.groupId !== -1) ? (groupIndexMap[t.groupId] ?? -1) : -1
  }));

  return { tabsWithGroups, groups };
}

async function restoreWithGroups(s) {
  const validTabs = s.tabs.filter(t => t.url && isValidUrl(t.url));
  if (!validTabs.length) return;

  const urls = validTabs.map(t => t.url);
  const win  = await chrome.windows.create({ url: urls });
  if (!s.groups?.length || !win.tabs?.length) return;

  const groupIdMap = {};
  for (let i = 0; i < validTabs.length; i++) {
    const gi    = validTabs[i].groupIndex ?? -1;
    const tabId = win.tabs[i]?.id;
    if (gi == null || gi === -1 || !tabId) continue;

    try {
      if (groupIdMap[gi] == null) {
        const cgid = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: win.id } });
        await chrome.tabGroups.update(cgid, {
          title: s.groups[gi]?.title || '',
          color: s.groups[gi]?.color || 'grey'
        });
        groupIdMap[gi] = cgid;
      } else {
        await chrome.tabs.group({ tabIds: [tabId], groupId: groupIdMap[gi] });
      }
    } catch {}
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Recovery
  $('recoveryRestore').addEventListener('click', restoreSnapshot);
  $('recoveryClose').addEventListener('click', () => {
    $('recoveryBanner').classList.add('hidden');
    recoverySnapshot = null;
  });

  // Navigation
  $('openDashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());

  // Save flow
  $('saveBtn').addEventListener('click', openNameBar);
  $('cancelSave').addEventListener('click', closeNameBar);
  $('confirmSave').addEventListener('click', () => doSave(false));
  $('confirmSaveClose').addEventListener('click', () => doSave(true));
  $('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter')  doSave(false);
    if (e.key === 'Escape') closeNameBar();
  });

  // Search
  $('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    $('clearSearch').classList.toggle('hidden', !searchQuery);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 150);
  });
  $('clearSearch').addEventListener('click', () => {
    $('search').value = ''; searchQuery = '';
    $('clearSearch').classList.add('hidden');
    $('search').focus(); render();
  });

  // Tag filter row
  $('tagFilterRow').addEventListener('click', e => {
    const chip = e.target.closest('.tf-chip');
    if (!chip) return;
    activeTag = chip.dataset.tag || null;
    renderTagFilter();
    render();
  });

  // Session list — delegation
  const list = $('sessionsList');
  list.addEventListener('click', e => {
    if (e.target.classList.contains('rename-input')) return; // editing in place — don't restore
    const fav = e.target.closest('.fav');
    if (fav?.dataset.url) {
      e.stopPropagation();
      chrome.tabs.create({ url: fav.dataset.url });
      return;
    }
    const btn  = e.target.closest('[data-action]');
    if (btn) { e.stopPropagation(); handleAction(btn.dataset.action, btn.dataset.id, btn); return; }
    const item = e.target.closest('.session-item');
    if (item) handleAction('restore-new', item.dataset.id, item);
  });

  // Context menu
  document.addEventListener('click', e => {
    if (!$('contextMenu').contains(e.target)) hideMenu();
    if (!$('tagPopover').contains(e.target) && !e.target.closest('[data-action="tag"]')) hideTagPopover();
  });

  // Global keyboard handler: Escape + session list navigation from any focus state
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideMenu(); hideTagPopover(); return; }

    // Let text inputs handle their own keys
    const focused = document.activeElement;
    if (focused?.tagName === 'INPUT' || focused?.tagName === 'TEXTAREA') return;

    const items = [...$('sessionsList').querySelectorAll('.session-item')];
    if (!items.length) return;

    const current = focused?.closest?.('.session-item') ?? null;
    const idx     = current ? items.indexOf(current) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[idx + 1] ?? items[0]).focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (items[idx > 0 ? idx - 1 : items.length - 1]).focus();
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      handleAction('restore-new', current.dataset.id, current);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && current) {
      e.preventDefault();
      deleteWithUndo(current.dataset.id);
    }
  });
  $('contextMenu').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (btn && activeMenuId) { handleMenuAction(btn.dataset.action, activeMenuId); hideMenu(); }
  });

  // Tag popover
  $('tagPopInput').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim();
    if (!name || !activeTagSessionId) return;
    const color = await upsertTag(name);
    allTags[name] = color;
    const s = allSessions.find(s => s.id === activeTagSessionId);
    const tags = [...new Set([...(s?.tags || []), name])];
    await setSessionTags(activeTagSessionId, tags);
    allSessions = await getSessions();
    e.target.value = '';
    render(); renderTagFilter(); renderTagPopover(activeTagSessionId);
  });

  // Live auto-refresh
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.tabvault_theme) {
      document.documentElement.setAttribute('data-theme', changes.tabvault_theme.newValue ?? 'dark');
    }
    if (changes.tabvault_sessions) {
      allSessions = changes.tabvault_sessions.newValue || [];
      render();
    }
    if (changes.tabvault_tags) {
      allTags = changes.tabvault_tags.newValue || {};
      renderTagFilter();
      render();
    }
  });
}

// ── Name bar ──────────────────────────────────────────────────────────────────
function openNameBar() {
  const bar   = $('nameBar');
  const input = $('nameInput');
  bar.classList.remove('hidden');
  input.value = '';
  input.placeholder = 'Name this session…';
  input.focus();
}

function closeNameBar() {
  $('nameBar').classList.add('hidden');
  $('nameInput').value = '';
  $('nameInput').placeholder = 'Name this session…';
}

async function doSave(closeAfter = false) {
  const name     = $('nameInput').value.trim();
  const tabs     = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) { showToast('No saveable tabs in this window'); return; }

  const { tabsWithGroups, groups } = await captureTabGroups(saveable);
  const session = await createSession(name, tabsWithGroups, false, groups);

  if (closeAfter) {
    const tabIds = saveable.filter(t => !t.pinned).map(t => t.id);
    if (tabIds.length) await chrome.tabs.remove(tabIds);
    showToast(`Saved & closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''}`);
    return;
  }

  allSessions = await getSessions();
  closeNameBar(); render();
  showToast(`Saved "${session.name}" · ${session.tabs.length} tabs`);
}

// ── Session actions ───────────────────────────────────────────────────────────
async function handleAction(action, id, el) {
  if (action === 'restore-new') {
    const s = allSessions.find(s => s.id === id);
    if (s) await restoreWithGroups(s);
    return;
  }
  if (action === 'tag')  { showTagPopover(id, el); return; }
  if (action === 'menu') { showMenu(id, el); return; }
}

async function handleMenuAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore-new') { await restoreWithGroups(s); return; }

  if (action === 'restore-here') {
    const win = await chrome.windows.getCurrent();
    for (const t of s.tabs) await chrome.tabs.create({ url: t.url, windowId: win.id });
    return;
  }

  if (action === 'duplicate') {
    await duplicateSession(id);
    allSessions = await getSessions();
    render();
    showToast(`Duplicated "${truncate(s.name, 24)}"`);
    return;
  }

  if (action === 'rename') {
    const item   = document.querySelector(`.session-item[data-id="${id}"]`);
    if (!item) return;
    const nameEl = item.querySelector('.session-name');
    const oldName = s.name;
    nameEl.innerHTML = `<input class="rename-input" value="${escapeHtml(oldName)}" maxlength="60" />`;
    const inp = nameEl.querySelector('input');
    inp.focus(); inp.select();
    const commit = async () => {
      const newName = inp.value.trim() || oldName;
      await renameSession(id, newName); allSessions = await getSessions(); render();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { nameEl.textContent = oldName; }
    });
    return;
  }

  if (action === 'pin') {
    await pinSession(id, !s.pinned); allSessions = await getSessions();
    render(); showToast(s.pinned ? 'Unpinned' : 'Pinned to top');
    return;
  }

  if (action === 'delete') { deleteWithUndo(id); return; }
}

// ── Undo delete ───────────────────────────────────────────────────────────────
async function deleteWithUndo(id) {
  clearTimeout(deleteTimer);
  pendingDelete = null;

  const session = allSessions.find(s => s.id === id);
  if (!session) return;

  await deleteSession(id);                          // commit to storage immediately
  pendingDelete   = session;
  allSessions     = allSessions.filter(s => s.id !== id);
  render();

  showToast(`"${truncate(session.name, 22)}" deleted`, async () => {
    clearTimeout(deleteTimer);
    if (pendingDelete) {
      await restoreSession(pendingDelete);
      allSessions   = await getSessions();
      pendingDelete = null;
      render();
    }
  });

  deleteTimer = setTimeout(() => { pendingDelete = null; }, 5000);
}

// ── Tags ──────────────────────────────────────────────────────────────────────
function showTagPopover(id, anchor) {
  activeTagSessionId = id;
  const pop  = $('tagPopover');
  renderTagPopover(id);
  const rect = anchor.getBoundingClientRect();
  const pw   = 200;
  let left   = rect.right - pw;
  let top    = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + 160 > window.innerHeight - 4) top = rect.top - 164;
  pop.style.left = left + 'px';
  pop.style.top  = top  + 'px';
  pop.classList.remove('hidden');
  $('tagPopInput').value = '';
  $('tagPopInput').focus();
}

function renderTagPopover(id) {
  const s     = allSessions.find(s => s.id === id);
  const stags = s?.tags || [];
  const list  = $('tagPopList');

  if (!Object.keys(allTags).length) {
    list.innerHTML = '<span class="no-tags-hint">Type below to create your first tag</span>';
    return;
  }

  list.innerHTML = Object.entries(allTags).map(([name, color]) => {
    const on = stags.includes(name);
    return `<button class="tag-toggle ${on ? 'on' : ''}" data-tag="${escapeHtml(name)}"
      style="--tc:${color}">${on ? '✓ ' : ''}${escapeHtml(name)}</button>`;
  }).join('');

  list.querySelectorAll('.tag-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.tag;
      const s    = allSessions.find(s => s.id === activeTagSessionId);
      if (!s) return;
      const cur  = s.tags || [];
      const next = cur.includes(name) ? cur.filter(t => t !== name) : [...cur, name];
      await setSessionTags(activeTagSessionId, next);
      allSessions = await getSessions();
      render(); renderTagFilter(); renderTagPopover(activeTagSessionId);
    });
  });
}

function hideTagPopover() {
  $('tagPopover').classList.add('hidden');
  activeTagSessionId = null;
}

// ── Context menu ──────────────────────────────────────────────────────────────
function showMenu(id, anchor) {
  activeMenuId = id;
  const menu = $('contextMenu');
  const s    = allSessions.find(s => s.id === id);
  menu.querySelector('[data-action="pin"]').textContent = s?.pinned ? 'Unpin' : 'Pin to top';
  const rect = anchor.getBoundingClientRect();
  menu.classList.remove('hidden');
  const mw = menu.offsetWidth, mh = menu.offsetHeight;

  let left = rect.right - mw;
  if (left < 4) left = 4;
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - mw - 4;

  let top = rect.bottom + 4;
  if (top + mh > window.innerHeight - 4) top = rect.top - mh - 4;
  if (top < 4) top = 4;

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

function hideMenu() { $('contextMenu').classList.add('hidden'); activeMenuId = null; }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, onUndo) {
  const toast   = $('toastEl');
  const undoBtn = $('toastUndo');
  $('toastMsg').textContent = msg;
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
