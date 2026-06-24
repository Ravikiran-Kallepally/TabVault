const KEY           = 'tabvault_sessions';
const SNAP_KEY      = 'tabvault_snapshots';
const TAGS_KEY      = 'tabvault_tags';
const API_KEY_STORE = 'tabvault_apikey';

const TAG_PALETTE = ['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#8b5cf6','#ef4444','#06b6d4'];

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getSessions() {
  const r = await chrome.storage.local.get(KEY);
  return r[KEY] || [];
}

export async function getSession(id) {
  const sessions = await getSessions();
  return sessions.find(s => s.id === id) || null;
}

export async function createSession(name, tabs, aiNamed = false, groups = []) {
  // Deduplicate by URL
  const seen = new Set();
  const uniqueTabs = tabs.filter(t => {
    if (!t.url || seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });

  const sessions = await getSessions();
  const session = {
    id: generateId(),
    name: name.trim() || autoName(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    aiNamed: aiNamed || false,
    pinned: false,
    tags: [],
    notes: '',
    groups: groups || [],
    tabs: uniqueTabs.map(t => {
      const tab = {
        url: t.url,
        title: (t.title || t.url).slice(0, 200),
        favIconUrl: t.favIconUrl?.startsWith('http') ? t.favIconUrl : '',
      };
      if ((t.groupIndex ?? -1) !== -1) tab.groupIndex = t.groupIndex;
      return tab;
    })
  };
  sessions.unshift(session);
  await chrome.storage.local.set({ [KEY]: sessions });
  return session;
}

export async function duplicateSession(id) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return null;
  const copy = {
    ...s,
    id: generateId(),
    name: s.name + ' (copy)',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pinned: false
  };
  const idx = sessions.indexOf(s);
  sessions.splice(idx + 1, 0, copy);
  await chrome.storage.local.set({ [KEY]: sessions });
  return copy;
}

export async function renameSession(id, name) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.name = name.trim() || s.name;
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function deleteSession(id) {
  const sessions = await getSessions();
  await chrome.storage.local.set({ [KEY]: sessions.filter(s => s.id !== id) });
}

export async function restoreSession(session) {
  const sessions = await getSessions();
  sessions.unshift(session);
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function pinSession(id, pinned) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.pinned = pinned;
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function removeTabFromSession(id, tabUrl) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.tabs      = s.tabs.filter(t => t.url !== tabUrl);
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function updateNotes(id, notes) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.notes = notes;
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function setSessionTags(id, tags) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.tags = Array.isArray(tags) ? tags : [];
  s.updatedAt = Date.now();
  await chrome.storage.local.set({ [KEY]: sessions });
}

export async function exportSessions() {
  const sessions = await getSessions();
  return JSON.stringify({ version: 1, exportedAt: Date.now(), sessions }, null, 2);
}

export async function importSessions(jsonText) {
  const data = JSON.parse(jsonText);
  const incoming = Array.isArray(data) ? data : data.sessions || [];
  const existing = await getSessions();
  const existingIds = new Set(existing.map(s => s.id));
  const merged = [...existing, ...incoming.filter(s => !existingIds.has(s.id))];
  await chrome.storage.local.set({ [KEY]: merged });
  return incoming.length;
}

// ── Auto-save snapshots ───────────────────────────────────────────────────────

export async function getSnapshots() {
  const r = await chrome.storage.local.get(SNAP_KEY);
  return r[SNAP_KEY] || [];
}

export async function saveSnapshot(windows) {
  const existing = await getSnapshots();
  const snap = { id: generateId(), savedAt: Date.now(), windows };
  await chrome.storage.local.set({ [SNAP_KEY]: [snap, ...existing].slice(0, 5) });
  return snap;
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function getTags() {
  const r = await chrome.storage.local.get(TAGS_KEY);
  return r[TAGS_KEY] || {};
}

export async function upsertTag(name, color) {
  const tags = await getTags();
  if (!color) {
    const used = Object.values(tags);
    color = TAG_PALETTE.find(c => !used.includes(c)) || TAG_PALETTE[Object.keys(tags).length % TAG_PALETTE.length];
  }
  tags[name.trim()] = color;
  await chrome.storage.local.set({ [TAGS_KEY]: tags });
  return color;
}

export async function removeTagGlobal(name) {
  const tags = await getTags();
  delete tags[name];
  await chrome.storage.local.set({ [TAGS_KEY]: tags });
  const sessions = await getSessions();
  sessions.forEach(s => { s.tags = (s.tags || []).filter(t => t !== name); });
  await chrome.storage.local.set({ [KEY]: sessions });
}

// ── API key ───────────────────────────────────────────────────────────────────

export async function getApiKey() {
  const r = await chrome.storage.local.get(API_KEY_STORE);
  return r[API_KEY_STORE] || null;
}

export async function setApiKey(key) {
  if (key && key.trim()) {
    await chrome.storage.local.set({ [API_KEY_STORE]: key.trim() });
  } else {
    await chrome.storage.local.remove(API_KEY_STORE);
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────────

export async function hasOnboarded() {
  const r = await chrome.storage.local.get('tabvault_onboarded');
  return !!r.tabvault_onboarded;
}

export async function markOnboarded() {
  await chrome.storage.local.set({ tabvault_onboarded: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function autoName() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}
