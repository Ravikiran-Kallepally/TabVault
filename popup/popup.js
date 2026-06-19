import {
  getSessions, createSession, deleteSession, renameSession, pinSession,
  getTags, upsertTag, setSessionTags,
  getSnapshots, getApiKey,
  hasOnboarded, markOnboarded
} from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';
import { suggestSessionName, suggestTabGroups } from '../utils/ai.js';

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
let proposedGroups     = [];
let recoverySnapshot   = null;

const $ = id => document.getElementById(id);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  if (!(await hasOnboarded())) { showOnboarding(); return; }
  await loadAll();
  await checkRecovery();
  render();
  renderTagFilter();
  bindEvents();
}

async function loadAll() {
  [allSessions, allTags] = await Promise.all([getSessions(), getTags()]);
  const tabs  = await chrome.tabs.query({ currentWindow: true });
  $('currentTabCount').textContent = tabs.filter(t => isValidUrl(t.url)).length;
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const OB_TOTAL = 4;

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
  $('obNext').textContent = obStep === OB_TOTAL - 1 ? 'Get Started →' : 'Next';
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

  const banner = $('recoveryBanner');
  $('recoverySub').textContent = `${totalTabs} tabs · ${timeAgo(recoverySnapshot.savedAt)}`;
  banner.classList.remove('hidden');
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

  let filtered    = sessions;
  const matchMap  = {};

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
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent      = getFavLetter(fav.dataset.url || '');
    });
  });
}

function renderTagFilter() {
  const row   = $('tagFilterRow');
  const names = Object.keys(allTags);
  if (!names.length) { row.classList.add('hidden'); return; }

  row.classList.remove('hidden');
  row.innerHTML = (activeTag ? `<button class="tf-chip tf-all" data-tag="">All</button>` : '') +
    names.map(name => {
      const color = allTags[name];
      return `<button class="tf-chip ${activeTag === name ? 'active' : ''}"
        data-tag="${escapeHtml(name)}" style="--tc:${color}">${escapeHtml(name)}</button>`;
    }).join('');
}

function sessionHTML(s, matchCount, query) {
  const favs     = s.tabs.slice(0, 4);
  const favsHTML = favs.map(t => {
    const color  = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl && t.favIconUrl.startsWith('http')) {
      return `<div class="fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`;
    }
    return `<div class="fav" style="background:${color}">${letter}</div>`;
  }).join('');

  const matchHTML = (matchCount && query)
    ? `<div class="match-tabs">${matchCount} tab${matchCount > 1 ? 's' : ''} matched</div>` : '';

  const tagsHTML = (s.tags || []).length
    ? `<div class="session-tags">${(s.tags).slice(0, 3).map(tag => {
        const c = allTags[tag] || '#6366f1';
        return `<span class="tag-chip" style="--tc:${c}">${escapeHtml(tag)}</span>`;
      }).join('')}${s.tags.length > 3 ? `<span class="tag-chip tag-more">+${s.tags.length-3}</span>` : ''}</div>` : '';

  const aiDot = s.aiNamed ? `<span class="ai-dot" title="AI-named">✨</span>` : '';

  return `<div class="session-item ${s.pinned ? 'pinned' : ''}" data-id="${s.id}" tabindex="0">
    <div class="pin-dot"></div>
    <div class="favicons">${favsHTML}</div>
    <div class="session-info">
      <div class="session-name">${highlight(truncate(s.name, 34), query)}${aiDot}</div>
      <div class="session-meta">
        <span>${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''}</span>
        <span class="dot">·</span>
        <span>${timeAgo(s.createdAt)}</span>
      </div>
      ${matchHTML}${tagsHTML}
    </div>
    <div class="session-actions">
      <button class="action-btn restore" data-id="${s.id}" data-action="restore-new" title="Open">↗</button>
      <button class="action-btn" data-id="${s.id}" data-action="tag" title="Tags">🏷</button>
      <button class="action-btn" data-id="${s.id}" data-action="menu" title="More">⋯</button>
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

  // Session list — clicks + keyboard
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
    if (e.key === 'Enter')  { handleAction('restore-new', item.dataset.id, item); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); item.nextElementSibling?.focus(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); item.previousElementSibling?.focus(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteWithUndo(item.dataset.id); }
  });

  // Context menu
  document.addEventListener('click', e => {
    if (!$('contextMenu').contains(e.target)) hideMenu();
    if (!$('tagPopover').contains(e.target) && !e.target.closest('[data-action="tag"]')) hideTagPopover();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideMenu(); hideTagPopover(); }
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
    render();
    renderTagFilter();
    renderTagPopover(activeTagSessionId);
  });

  // Smart Group
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
  input.value = ''; input.disabled = false;
  badge.classList.add('hidden');
  input.placeholder = 'Name this session…';
  input.focus();

  if (!(await getApiKey())) return;

  input.disabled = true; input.placeholder = 'Getting AI name…';
  const tabs      = await chrome.tabs.query({ currentWindow: true });
  const saveable  = tabs.filter(t => isValidUrl(t.url));
  const suggestion = await suggestSessionName(saveable);
  input.disabled = false; input.placeholder = 'Name this session…';
  if (suggestion) { input.value = suggestion; badge.classList.remove('hidden'); input.select(); }
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
  const tabs    = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) { showToast('No saveable tabs in this window'); return; }
  const session = await createSession(name, saveable, aiNamed);
  allSessions   = await getSessions();
  closeNameBar(); render();
  showToast(`Saved "${session.name}" · ${saveable.length} tabs`);
}

// ── Session actions ───────────────────────────────────────────────────────────
async function handleAction(action, id, el) {
  if (action === 'restore-new') {
    const s = allSessions.find(s => s.id === id);
    if (s) await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) });
    return;
  }
  if (action === 'tag')  { showTagPopover(id, el); return; }
  if (action === 'menu') { showMenu(id, el); return; }
}

async function handleMenuAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore-new') { await chrome.windows.create({ url: s.tabs.map(t => t.url).filter(Boolean) }); return; }

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
function deleteWithUndo(id) {
  if (pendingDelete) { clearTimeout(deleteTimer); deleteSession(pendingDelete.id); }
  pendingDelete = allSessions.find(s => s.id === id);
  if (!pendingDelete) return;
  allSessions = allSessions.filter(s => s.id !== id);
  render();
  showToast(`"${truncate(pendingDelete.name, 22)}" deleted`, async () => {
    clearTimeout(deleteTimer);
    allSessions = await getSessions();
    pendingDelete = null; render();
  });
  deleteTimer = setTimeout(async () => {
    if (pendingDelete) { await deleteSession(pendingDelete.id); pendingDelete = null; }
  }, 5000);
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
  const s    = allSessions.find(s => s.id === id);
  const stags = s?.tags || [];
  const list  = $('tagPopList');

  if (!Object.keys(allTags).length) {
    list.innerHTML = '<span class="no-tags-hint">Type a name below to create your first tag</span>';
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
  let left = rect.right - mw, top = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight - 4) top = rect.top - mh - 4;
  menu.style.left = left + 'px'; menu.style.top = top + 'px';
}

function hideMenu() { $('contextMenu').classList.add('hidden'); activeMenuId = null; }

// ── Smart Group ───────────────────────────────────────────────────────────────
async function doSmartGroup() {
  if (!(await getApiKey())) { showToast('Add your Claude API key in Dashboard → Settings'); return; }

  $('groupOverlay').classList.remove('hidden');
  $('groupLoading').classList.remove('hidden');
  $('groupResults').classList.add('hidden');
  $('groupFooter').classList.add('hidden');

  const tabs     = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));

  if (saveable.length < 2) { closeGroupOverlay(); showToast('Not enough tabs to group'); return; }

  const result = await suggestTabGroups(saveable);
  $('groupLoading').classList.add('hidden');

  if (!result?.groups?.length) { closeGroupOverlay(); showToast('AI grouping failed — try again'); return; }

  proposedGroups = result.groups
    .filter(g => g.indices?.length)
    .map(g => ({ name: g.name, tabs: g.indices.map(i => saveable[i]).filter(Boolean) }));

  renderGroupResults();
  $('groupResults').classList.remove('hidden');
  $('groupFooter').classList.remove('hidden');
}

function renderGroupResults() {
  $('groupResults').innerHTML = proposedGroups.map((g, gi) => {
    const favs = g.tabs.slice(0, 5).map(t => {
      if (t.favIconUrl?.startsWith('http')) {
        return `<div class="gfav" data-url="${escapeHtml(t.url)}" style="background:${domainColor(t.url)}">
          <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`;
      }
      return `<div class="gfav" style="background:${domainColor(t.url)}">${getFavLetter(t.url)}</div>`;
    }).join('');
    return `<div class="group-card">
      <input class="group-name-input" data-gi="${gi}" value="${escapeHtml(g.name)}" maxlength="60" />
      <div class="group-favs">${favs}</div>
      <div class="group-tab-count">${g.tabs.length} tab${g.tabs.length !== 1 ? 's' : ''}</div>
    </div>`;
  }).join('');

  $('groupResults').querySelectorAll('.group-name-input').forEach(inp => {
    inp.addEventListener('input', e => { proposedGroups[+e.target.dataset.gi].name = e.target.value; });
  });
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
    if (g.tabs.length) { await createSession(g.name, g.tabs, true); saved++; }
  }
  allSessions = await getSessions();
  closeGroupOverlay(); render();
  showToast(`Saved ${saved} group${saved !== 1 ? 's' : ''} as sessions`);
}

function closeGroupOverlay() { $('groupOverlay').classList.add('hidden'); proposedGroups = []; }

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
