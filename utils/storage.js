const KEY = 'tabvault_sessions';

export async function getSessions() {
  const result = await chrome.storage.local.get(KEY);
  return result[KEY] || [];
}

export async function getSession(id) {
  const sessions = await getSessions();
  return sessions.find(s => s.id === id) || null;
}

export async function createSession(name, tabs) {
  const sessions = await getSessions();
  const session = {
    id: generateId(),
    name: name.trim() || autoName(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tabs: tabs.map(t => ({
      url: t.url,
      title: t.title || t.url,
      favIconUrl: t.favIconUrl || '',
      pinned: t.pinned || false
    }))
  };
  sessions.unshift(session);
  await chrome.storage.local.set({ [KEY]: sessions });
  return session;
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

export async function pinSession(id, pinned) {
  const sessions = await getSessions();
  const s = sessions.find(s => s.id === id);
  if (!s) return;
  s.pinned = pinned;
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

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function autoName() {
  return new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}
