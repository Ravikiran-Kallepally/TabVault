import {
  getSessions, createSession, duplicateSession, deleteSession, restoreSession, renameSession, pinSession,
  exportSessions, importSessions,
  updateNotes, setSessionTags, getTags, upsertTag, removeTagGlobal,
} from '../utils/storage.js';
import { timeAgo, getDomain, getFavLetter, domainColor, truncate, isValidUrl, escapeHtml } from '../utils/helpers.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allSessions   = [];
let allTags       = {};
let selectedId    = null;
let selectedWinId = null;
let activeFilter  = 'all';
let activeTag     = null;
let searchQuery   = '';
let sortMode      = 'newest';
let liveWindows   = [];
let pendingDelete = null;
let deleteTimer   = null;
let toastTimer    = null;
let notesTimer    = null;
let searchTimer   = null;

const $ = id => document.getElementById(id);

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

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadTheme();
  $('themeToggle').addEventListener('click', toggleTheme);

  [allSessions, allTags] = await Promise.all([getSessions(), getTags()]);
  updateStats();
  renderTagSidebar();
  render();
  bindEvents();
}

function updateStats() {
  const now  = Date.now();
  const WEEK = 7 * 86400000;
  $('statSessions').textContent = allSessions.length;
  $('statTabs').textContent     = allSessions.reduce((n, s) => n + s.tabs.length, 0);
  $('statWeek').textContent     = allSessions.filter(s => now - s.createdAt < WEEK).length;
  $('statPinned').textContent   = allSessions.filter(s => s.pinned).length;
}

// ── Tag sidebar ───────────────────────────────────────────────────────────────
function renderTagSidebar() {
  const list  = $('tagList');
  const names = Object.keys(allTags);
  if (!names.length) { list.innerHTML = '<span class="no-tags-note">No tags yet</span>'; return; }

  list.innerHTML = names.map(name => {
    const color = allTags[name];
    return `<div class="sidebar-tag ${activeTag === name ? 'active' : ''}" data-tag="${escapeHtml(name)}" style="--tc:${color}" draggable="true" title="Drag to a session card to tag it">
      <span class="sidebar-tag-dot"></span>
      <span class="sidebar-tag-name">${escapeHtml(name)}</span>
      <button class="sidebar-tag-del" data-tag="${escapeHtml(name)}" title="Delete tag">×</button>
    </div>`;
  }).join('');
}

// ── Filtering / sorting ───────────────────────────────────────────────────────
function getFiltered() {
  const now  = Date.now();
  const DAY  = 86400000;
  const WEEK = 7 * DAY;
  let sessions = [...allSessions];

  if (activeFilter === 'pinned') sessions = sessions.filter(s => s.pinned);
  else if (activeFilter === 'today') sessions = sessions.filter(s => now - s.createdAt < DAY);
  else if (activeFilter === 'week')  sessions = sessions.filter(s => now - s.createdAt < WEEK);

  if (activeTag) sessions = sessions.filter(s => (s.tags || []).includes(activeTag));

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
    if (sortMode === 'name')   return a.name.localeCompare(b.name);
    if (sortMode === 'tabs')   return b.tabs.length - a.tabs.length;
    return 0;
  });

  const pinned = sessions.filter(s => s.pinned);
  const rest   = sessions.filter(s => !s.pinned);
  return [...pinned, ...rest];
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  if (activeFilter === 'live') { renderLiveWindows(); return; }
  $('sortWrap').style.display = '';

  const filtered = getFiltered();
  const grid  = $('sessionGrid');
  const empty = $('emptyState');

  if (!filtered.length) {
    grid.innerHTML      = '';
    empty.style.display = 'flex';
    $('emptyTitle').textContent = (searchQuery || activeTag) ? 'No matches found' : 'No sessions yet';
    $('emptyMsg').textContent   = (searchQuery || activeTag) ? 'Try different keywords or tags.' : 'Open the extension popup and save your first session.';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(s => cardHTML(s)).join('');

  grid.querySelectorAll('.card-fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.card-fav');
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent      = getFavLetter(fav.dataset.url || '');
    });
  });
}

function cardHTML(s) {
  const sc      = s.tabs.length ? domainColor(s.tabs[0].url) : '#6366f1';
  const preview = s.tabs.slice(0, 8);
  const favsHTML = preview.map(t => {
    const color  = domainColor(t.url);
    const letter = getFavLetter(t.url);
    if (t.favIconUrl?.startsWith('http')) {
      return `<div class="card-fav" data-url="${escapeHtml(t.url)}" style="background:${color}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`;
    }
    return `<div class="card-fav" style="background:${color}">${letter}</div>`;
  }).join('');

  const tagsHTML = (s.tags || []).slice(0, 3).map(tag => {
    const c = allTags[tag] || '#6366f1';
    return `<span class="card-tag" style="--tc:${c}">${escapeHtml(tag)}</span>`;
  }).join('');

  const aiDot = s.aiNamed ? `<span class="card-ai-dot" title="AI-named">✨</span>` : '';

  return `<div class="session-card ${s.pinned ? 'pinned' : ''} ${selectedId === s.id ? 'selected' : ''}" data-id="${s.id}" style="--sc:${sc}" draggable="true">
    <div class="card-favicons">${favsHTML}</div>
    <div class="card-name" title="${escapeHtml(s.name)}">${escapeHtml(truncate(s.name, 32))}${aiDot}</div>
    <div class="card-meta">
      <span>${s.tabs.length} tab${s.tabs.length !== 1 ? 's' : ''}</span>
      <span class="card-dot">·</span>
      <span>${timeAgo(s.createdAt)}</span>
    </div>
    ${tagsHTML ? `<div class="card-tags">${tagsHTML}</div>` : ''}
    <div class="card-actions">
      <button class="card-btn" data-id="${s.id}" data-action="restore">Open</button>
      <button class="card-btn" data-id="${s.id}" data-action="duplicate">Copy</button>
      <button class="card-btn del" data-id="${s.id}" data-action="delete">Delete</button>
    </div>
  </div>`;
}

// ── Live Windows view ─────────────────────────────────────────────────────────
async function renderLiveWindows() {
  $('sortWrap').style.display = 'none';
  liveWindows = await chrome.windows.getAll({ populate: true });
  const currentWin = await chrome.windows.getCurrent();
  const grid  = $('sessionGrid');
  const empty = $('emptyState');
  const valid = liveWindows.filter(w => w.type === 'normal' && w.tabs.some(t => isValidUrl(t.url)));

  if (!valid.length) {
    grid.innerHTML = ''; empty.style.display = 'flex';
    $('emptyTitle').textContent = 'No windows found';
    $('emptyMsg').textContent   = '';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = valid.map(w => windowCardHTML(w, w.id === currentWin.id)).join('');

  grid.querySelectorAll('.card-fav img').forEach(img => {
    img.addEventListener('error', () => {
      const fav = img.closest('.card-fav');
      fav.style.background = domainColor(fav.dataset.url || '');
      fav.textContent      = getFavLetter(fav.dataset.url || '');
    });
  });
}

function windowCardHTML(win, isCurrent) {
  const validTabs = win.tabs.filter(t => isValidUrl(t.url));
  const preview   = validTabs.slice(0, 8);
  const favsHTML  = preview.map(t => {
    if (t.favIconUrl?.startsWith('http')) {
      return `<div class="card-fav" data-url="${escapeHtml(t.url)}" style="background:${domainColor(t.url)}">
        <img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`;
    }
    return `<div class="card-fav" style="background:${domainColor(t.url)}">${getFavLetter(t.url)}</div>`;
  }).join('');

  return `<div class="session-card window-card ${isCurrent ? 'current-win' : ''} ${selectedWinId === win.id ? 'selected' : ''}" data-winid="${win.id}">
    ${isCurrent ? '<div class="live-badge">Current</div>' : ''}
    <div class="card-favicons">${favsHTML}</div>
    <div class="card-name">${isCurrent ? 'This Window' : `Window ${win.id}`}</div>
    <div class="card-meta">
      <span>${validTabs.length} tab${validTabs.length !== 1 ? 's' : ''}</span>
      <span class="card-dot">·</span><span class="live-text">Live</span>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-winid="${win.id}" data-action="save-window">Save</button>
    </div>
  </div>`;
}

// ── Detail panel – session ────────────────────────────────────────────────────
function showDetail(id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  selectedId = id; selectedWinId = null;
  $('windowDetailContent').classList.add('hidden');
  render();

  $('detailEmpty').style.display = 'none';
  $('detailContent').classList.remove('hidden');
  $('sharePanel').classList.add('hidden');

  $('detailTitle').textContent = s.name;
  $('detailMeta').textContent  = `${s.tabs.length} tabs · saved ${timeAgo(s.createdAt)}`;

  // Tags on detail
  renderDetailTags(s);

  $('detailRestore').onclick = () => restoreWithGroups(s);

  // Tab group chips
  const GC = { grey:'#5f6368',blue:'#1a73e8',red:'#d93025',yellow:'#f9ab00',green:'#34a853',pink:'#e91e8c',purple:'#9c27b0',cyan:'#00bcd4',orange:'#f57c00' };
  const dg = $('detailGroups');
  if (s.groups?.length) {
    dg.classList.remove('hidden');
    dg.innerHTML = s.groups.map(g =>
      `<span class="detail-group-chip" style="--gc:${GC[g.color]||'#888'}">
        <span class="detail-group-dot"></span>${escapeHtml(g.title || g.color)}
      </span>`
    ).join('');
  } else {
    dg.classList.add('hidden');
  }

  $('sessionNotes').value = s.notes || '';
  clearTimeout(notesTimer);

  $('tabsList').innerHTML = s.tabs.map(t => tabItemHTML(t)).join('');
  $('tabsList').querySelectorAll('.tab-fav img').forEach(imgFallback);
  $('tabsList').querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => chrome.tabs.create({ url: el.dataset.url }));
  });
}

function renderDetailTags(s) {
  const wrap = $('detailTags');
  const stags = s?.tags || [];
  const names = Object.keys(allTags);

  wrap.innerHTML = stags.map(tag => {
    const c = allTags[tag] || '#6366f1';
    return `<span class="detail-tag" data-tag="${escapeHtml(tag)}" style="--tc:${c}">
      ${escapeHtml(tag)} <button class="detail-tag-rm" data-tag="${escapeHtml(tag)}">×</button>
    </span>`;
  }).join('') + (names.length
    ? `<select class="detail-tag-add" id="detailTagAdd">
        <option value="">+ Tag</option>
        ${names.filter(n => !stags.includes(n)).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
      </select>` : '');

  wrap.querySelectorAll('.detail-tag-rm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const tag  = btn.dataset.tag;
      const sess = allSessions.find(s => s.id === selectedId);
      if (!sess) return;
      const next = (sess.tags || []).filter(t => t !== tag);
      await setSessionTags(selectedId, next);
      allSessions = await getSessions();
      updateStats(); render();
      renderDetailTags(allSessions.find(s => s.id === selectedId));
    });
  });

  const addSel = $('detailTagAdd');
  if (addSel) {
    addSel.addEventListener('change', async e => {
      const tag  = e.target.value;
      if (!tag) return;
      const sess = allSessions.find(s => s.id === selectedId);
      if (!sess) return;
      const next = [...new Set([...(sess.tags || []), tag])];
      await setSessionTags(selectedId, next);
      allSessions = await getSessions();
      updateStats(); render();
      renderDetailTags(allSessions.find(s => s.id === selectedId));
    });
  }
}

function tabItemHTML(t) {
  const color  = domainColor(t.url);
  const letter = getFavLetter(t.url);
  const favHTML = t.favIconUrl?.startsWith('http')
    ? `<div class="tab-fav" data-url="${escapeHtml(t.url)}" style="background:${color}"><img src="${escapeHtml(t.favIconUrl)}" alt="" loading="lazy" /></div>`
    : `<div class="tab-fav" style="background:${color}">${letter}</div>`;
  return `<div class="tab-item" data-url="${escapeHtml(t.url)}">
    ${favHTML}
    <div class="tab-info">
      <div class="tab-title" title="${escapeHtml(t.title)}">${escapeHtml(truncate(t.title, 38))}</div>
      <div class="tab-url">${escapeHtml(getDomain(t.url))}</div>
    </div>
  </div>`;
}

function imgFallback(img) {
  img.addEventListener('error', () => {
    const fav = img.closest('.tab-fav') || img.closest('.card-fav');
    if (fav) { fav.style.background = domainColor(fav.dataset.url || ''); fav.textContent = getFavLetter(fav.dataset.url || ''); }
  });
}

// ── Detail panel – live window ────────────────────────────────────────────────
function showWindowDetail(winId) {
  const win = liveWindows.find(w => w.id === winId);
  if (!win) return;

  selectedWinId = winId; selectedId = null;
  $('detailContent').classList.add('hidden');
  $('detailEmpty').style.display = 'none';
  $('windowDetailContent').classList.remove('hidden');
  render();

  const validTabs = win.tabs.filter(t => isValidUrl(t.url));
  $('windowDetailTitle').textContent = selectedWinId ? `Window ${win.id}` : 'Window';
  $('windowDetailMeta').textContent  = `${validTabs.length} tabs · Live`;

  $('saveWindowBtn').onclick = async () => {
    await createSession('', validTabs);
    allSessions = await getSessions();
    updateStats(); renderTagSidebar();
    showToast(`Saved ${validTabs.length} tabs as a session`);
  };

  $('windowTabsList').innerHTML = validTabs.map(tabItemHTML).join('');
  $('windowTabsList').querySelectorAll('.tab-fav img').forEach(imgFallback);
  $('windowTabsList').querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => chrome.tabs.create({ url: el.dataset.url }));
  });
}

// ── Tab group restore ─────────────────────────────────────────────────────────
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
        await chrome.tabGroups.update(cgid, { title: s.groups[gi]?.title || '', color: s.groups[gi]?.color || 'grey' });
        groupIdMap[gi] = cgid;
      } else {
        await chrome.tabs.group({ tabIds: [tabId], groupId: groupIdMap[gi] });
      }
    } catch {}
  }
}

// ── OneTab import ─────────────────────────────────────────────────────────────
function parseOneTab(text) {
  const sessions = [];
  const blocks   = text.trim().split(/\n\s*\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n').filter(l => l.trim());
    const tabs  = [];
    for (const line of lines) {
      let url, title;
      const trimmed = line.trim();
      if (trimmed.includes(' | ')) {
        const idx = trimmed.indexOf(' | ');
        url   = trimmed.slice(0, idx).trim();
        title = trimmed.slice(idx + 3).trim();
      } else if (trimmed.includes('\t')) {
        [url, title] = trimmed.split('\t');
      } else {
        url = trimmed;
      }
      url   = url?.trim();
      title = (title || url || '').trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        tabs.push({ url, title, favIconUrl: '' });
      }
    }
    if (tabs.length) sessions.push(tabs);
  }
  return sessions;
}

// ── Share encode / decode ─────────────────────────────────────────────────────
function encodeSession(s) {
  const compact = { n: s.name, t: s.tabs.map(t => [t.url, t.title || '']) };
  return 'tv1:' + btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
}

function decodeSession(code) {
  if (!code.startsWith('tv1:')) return null;
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
    return { name: data.n, tabs: data.t.map(([url, title]) => ({ url, title, favIconUrl: '' })) };
  } catch { return null; }
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Search
  $('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 150);
  });
  $('sortSelect').addEventListener('change', e => { sortMode = e.target.value; render(); });

  // Filter nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      selectedId = null; selectedWinId = null;
      $('detailEmpty').style.display = 'flex';
      $('detailContent').classList.add('hidden');
      $('windowDetailContent').classList.add('hidden');
      render();
    });
  });

  // Tag sidebar
  $('tagNewBtn').addEventListener('click', () => {
    $('newTagForm').classList.toggle('hidden');
    if (!$('newTagForm').classList.contains('hidden')) $('newTagInput').focus();
  });

  $('newTagInput').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim();
    if (!name) return;
    await upsertTag(name);
    allTags = await getTags();
    e.target.value = '';
    $('newTagForm').classList.add('hidden');
    renderTagSidebar();
    render();
  });

  $('sidebarTags').addEventListener('click', async e => {
    const del = e.target.closest('.sidebar-tag-del');
    if (del) {
      e.stopPropagation();
      const name = del.dataset.tag;
      await removeTagGlobal(name);
      allTags    = await getTags();
      allSessions = await getSessions();
      if (activeTag === name) activeTag = null;
      renderTagSidebar(); updateStats(); render();
      if (selectedId) renderDetailTags(allSessions.find(s => s.id === selectedId));
      return;
    }
    const tag = e.target.closest('.sidebar-tag');
    if (tag) {
      activeTag = activeTag === tag.dataset.tag ? null : tag.dataset.tag;
      renderTagSidebar(); render();
    }
  });

  // Session grid clicks
  $('sessionGrid').addEventListener('click', async e => {
    // Window card
    const wc = e.target.closest('.window-card');
    if (wc) {
      const btn = e.target.closest('[data-action]');
      if (btn?.dataset.action === 'save-window') {
        e.stopPropagation();
        const win  = liveWindows.find(w => w.id === +wc.dataset.winid);
        if (!win) return;
        const tabs = win.tabs.filter(t => isValidUrl(t.url));
        await createSession('', tabs);
        allSessions = await getSessions();
        updateStats(); renderTagSidebar();
        showToast(`Saved ${tabs.length} tabs`);
        return;
      }
      showWindowDetail(+wc.dataset.winid);
      return;
    }
    // Session card
    const btn  = e.target.closest('[data-action]');
    if (btn) { e.stopPropagation(); await handleCardAction(btn.dataset.action, btn.dataset.id); return; }
    const card = e.target.closest('.session-card');
    if (card) showDetail(card.dataset.id);
  });

  // ── Close detail panel ───────────────────────────────────────
  function closeDetail() {
    selectedId = null; selectedWinId = null;
    $('detailContent').classList.add('hidden');
    $('windowDetailContent').classList.add('hidden');
    $('detailEmpty').style.display = 'flex';
    render();
  }
  $('closeDetailBtn').addEventListener('click', closeDetail);
  $('closeWinDetailBtn').addEventListener('click', closeDetail);

  // ── Drag tags → session cards ─────────────────────────────
  $('tagList').addEventListener('dragstart', e => {
    const tag = e.target.closest('.sidebar-tag[draggable]');
    if (!tag) return;
    e.dataTransfer.setData('text/tabvault-tag', tag.dataset.tag);
    e.dataTransfer.effectAllowed = 'copy';
  });

  const grid = $('sessionGrid');
  grid.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/tabvault-tag')) return;
    const card = e.target.closest('.session-card:not(.window-card)');
    if (!card) return;
    e.preventDefault();
    grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    card.classList.add('drag-over');
  });
  grid.addEventListener('dragleave', e => {
    if (!e.relatedTarget?.closest?.('.session-card')) {
      grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    }
  });
  grid.addEventListener('drop', async e => {
    grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    if (!e.dataTransfer.types.includes('text/tabvault-tag')) return;
    const card = e.target.closest('.session-card:not(.window-card)');
    if (!card) return;
    e.preventDefault();
    const tagName = e.dataTransfer.getData('text/tabvault-tag');
    if (!tagName || !allTags[tagName]) return;
    const s = allSessions.find(s => s.id === card.dataset.id);
    if (!s) return;
    const next = [...new Set([...(s.tags || []), tagName])];
    await setSessionTags(s.id, next);
    allSessions = await getSessions();
    updateStats(); render();
    if (selectedId === s.id) renderDetailTags(allSessions.find(x => x.id === s.id));
    showToast(`"${tagName}" → "${truncate(s.name, 22)}"`);
  });

  // ── Drag session cards → detail panel ────────────────────
  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.session-card:not(.window-card)');
    if (!card || e.target.closest('[data-action]') || e.target.closest('.card-tag')) return;
    if (e.dataTransfer.types.includes('text/tabvault-tag')) return; // tag drag takes priority
    e.dataTransfer.setData('text/tabvault-session', card.dataset.id);
    e.dataTransfer.effectAllowed = 'link';
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  grid.addEventListener('dragend', e => {
    const card = e.target.closest('.session-card');
    if (card) card.classList.remove('dragging');
  });

  const panel = $('detailPanel');
  panel.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/tabvault-session')) return;
    e.preventDefault();
    panel.classList.add('drop-target');
  });
  panel.addEventListener('dragleave', e => {
    if (!e.relatedTarget?.closest?.('#detailPanel')) panel.classList.remove('drop-target');
  });
  panel.addEventListener('drop', e => {
    panel.classList.remove('drop-target');
    if (!e.dataTransfer.types.includes('text/tabvault-session')) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/tabvault-session');
    if (id) showDetail(id);
  });

  // Notes autosave
  $('sessionNotes').addEventListener('input', e => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      if (!selectedId) return;
      await updateNotes(selectedId, e.target.value);
      allSessions = await getSessions();
    }, 800);
  });

  // Duplicate
  $('duplicateBtn').addEventListener('click', async () => {
    if (!selectedId) return;
    const s = allSessions.find(s => s.id === selectedId);
    if (!s) return;
    await duplicateSession(selectedId);
    allSessions = await getSessions();
    updateStats(); renderTagSidebar(); render();
    showToast(`Duplicated "${truncate(s.name, 28)}"`);
  });

  // Share
  $('shareBtn').addEventListener('click', () => {
    const panel = $('sharePanel');
    if (!selectedId) return;
    const s = allSessions.find(s => s.id === selectedId);
    if (!s) return;
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      $('shareCode').textContent = encodeSession(s);
    }
  });
  $('shareCopyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText($('shareCode').textContent);
    showToast('Share code copied');
  });

  // Import share code
  $('importCodeBtn').addEventListener('click', () => {
    $('importCodeWrap').classList.toggle('hidden');
    $('importOneTabWrap').classList.add('hidden');
    if (!$('importCodeWrap').classList.contains('hidden')) $('importCodeInput').focus();
  });
  $('importCodeSubmit').addEventListener('click', async () => {
    const code = $('importCodeInput').value.trim();
    const data = decodeSession(code);
    if (!data) { showToast('Invalid share code'); return; }
    await createSession(data.name, data.tabs);
    allSessions = await getSessions();
    updateStats(); renderTagSidebar(); render();
    $('importCodeInput').value = '';
    $('importCodeWrap').classList.add('hidden');
    showToast(`Imported "${data.name}"`);
  });

  // OneTab import
  $('importOneTabBtn').addEventListener('click', () => {
    $('importOneTabWrap').classList.toggle('hidden');
    $('importCodeWrap').classList.add('hidden');
    if (!$('importOneTabWrap').classList.contains('hidden')) $('importOneTabInput').focus();
  });
  $('importOneTabSubmit').addEventListener('click', async () => {
    const text = $('importOneTabInput').value.trim();
    if (!text) { showToast('Paste your OneTab export first'); return; }
    const groups = parseOneTab(text);
    if (!groups.length) { showToast('No valid URLs found'); return; }
    for (const tabs of groups) await createSession('', tabs);
    allSessions = await getSessions();
    updateStats(); renderTagSidebar(); render();
    $('importOneTabInput').value = '';
    $('importOneTabWrap').classList.add('hidden');
    showToast(`Imported ${groups.length} session${groups.length !== 1 ? 's' : ''} from OneTab`);
  });

  // Export / Import file
  $('exportBtn').addEventListener('click', async () => {
    const json = await exportSessions();
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url, download: `tabvault-${new Date().toISOString().slice(0,10)}.json`
    });
    a.click(); URL.revokeObjectURL(url);
    showToast('Sessions exported');
  });

  $('importFile').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const count = await importSessions(await file.text());
      allSessions = await getSessions();
      updateStats(); renderTagSidebar(); render();
      showToast(`Imported ${count} session${count !== 1 ? 's' : ''}`);
    } catch { showToast('Import failed — invalid file'); }
    e.target.value = '';
  });

  // Tab list click → open tab
  $('tabsList').addEventListener('click', e => {
    const item = e.target.closest('.tab-item');
    if (item?.dataset.url) chrome.tabs.create({ url: item.dataset.url });
  });

  // Live auto-refresh when popup or service worker mutates storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.tabvault_theme) {
      document.documentElement.setAttribute('data-theme', changes.tabvault_theme.newValue ?? 'dark');
    }
    if (changes.tabvault_sessions) {
      allSessions = changes.tabvault_sessions.newValue || [];
      updateStats();
      renderTagSidebar();
      render();
      // Sync detail panel without resetting notes textarea
      if (selectedId) {
        const s = allSessions.find(s => s.id === selectedId);
        if (s) {
          $('detailTitle').textContent = s.name;
          renderDetailTags(s);
        } else {
          selectedId = null;
          $('detailContent').classList.add('hidden');
          $('detailEmpty').style.display = 'flex';
        }
      }
    }
    if (changes.tabvault_tags) {
      allTags = changes.tabvault_tags.newValue || {};
      renderTagSidebar();
      render();
      if (selectedId) {
        const s = allSessions.find(s => s.id === selectedId);
        if (s) renderDetailTags(s);
      }
    }
  });
}

// ── Card actions + undo delete ────────────────────────────────────────────────
async function handleCardAction(action, id) {
  const s = allSessions.find(s => s.id === id);
  if (!s) return;

  if (action === 'restore') { await restoreWithGroups(s); return; }
  if (action === 'duplicate') {
    await duplicateSession(id);
    allSessions = await getSessions();
    updateStats(); renderTagSidebar(); render();
    showToast(`Duplicated "${truncate(s.name, 28)}"`);
    return;
  }
  if (action === 'pin') {
    await pinSession(id, !s.pinned);
    allSessions = await getSessions();
    updateStats(); render();
    if (selectedId === id) showDetail(id);
    return;
  }
  if (action === 'delete') { deleteWithUndo(id); return; }
}

async function deleteWithUndo(id) {
  clearTimeout(deleteTimer);
  pendingDelete = null;

  const session = allSessions.find(s => s.id === id);
  if (!session) return;

  await deleteSession(id);                          // commit to storage immediately
  pendingDelete = session;
  allSessions   = allSessions.filter(s => s.id !== id);

  if (selectedId === id) {
    selectedId = null;
    $('detailEmpty').style.display = 'flex';
    $('detailContent').classList.add('hidden');
  }
  updateStats(); render();

  showToast(`"${truncate(session.name, 28)}" deleted`, async () => {
    clearTimeout(deleteTimer);
    if (pendingDelete) {
      await restoreSession(pendingDelete);
      allSessions   = await getSessions();
      pendingDelete = null;
      updateStats(); renderTagSidebar(); render();
    }
  });

  deleteTimer = setTimeout(() => { pendingDelete = null; }, 5000);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, onUndo) {
  const toast   = $('toastEl');
  const undoBtn = $('toastUndo');
  $('toastMsg').textContent = msg;
  if (onUndo) {
    undoBtn.classList.remove('hidden');
    undoBtn.onclick = () => { onUndo(); toast.classList.remove('show'); };
  } else {
    undoBtn.classList.add('hidden'); undoBtn.onclick = null;
  }
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), onUndo ? 5000 : 2400);
}

init();
