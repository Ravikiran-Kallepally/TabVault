import { createSession, getSessions, saveSnapshot } from '../utils/storage.js';
import { isValidUrl } from '../utils/helpers.js';

// ── Install / update ──────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({ id: 'save-tab',    title: 'Save tab to TabVault',      contexts: ['page'] });
  chrome.contextMenus.create({ id: 'save-window', title: 'Save all tabs to TabVault', contexts: ['page'] });
  chrome.alarms.create('auto-snapshot', { delayInMinutes: 1, periodInMinutes: 30 });
  await refreshBadge();
});

// ── Startup ───────────────────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  chrome.storage.local.set({ tabvault_startup: Date.now() });
  chrome.alarms.create('auto-snapshot', { delayInMinutes: 1, periodInMinutes: 30 });
  await refreshBadge();
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-session') return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) return;
  const { tabsWithGroups, groups } = await captureTabGroups(saveable);
  await createSession('', tabsWithGroups, false, groups);
});

// ── Context menu ──────────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-tab' && isValidUrl(tab.url)) {
    await createSession(tab.title || '', [tab]);
  } else if (info.menuItemId === 'save-window') {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    const saveable = tabs.filter(t => isValidUrl(t.url));
    if (!saveable.length) return;
    const { tabsWithGroups, groups } = await captureTabGroups(saveable);
    await createSession('', tabsWithGroups, false, groups);
  }
});

// ── Badge ─────────────────────────────────────────────────────────────────────
async function refreshBadge() {
  const sessions = await getSessions();
  const n = sessions.length;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tabvault_sessions) refreshBadge();
});

// ── Auto-save ─────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-snapshot') await takeSnapshot();
});

chrome.runtime.onSuspend.addListener(async () => {
  await takeSnapshot();
});

async function takeSnapshot() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const data = await Promise.all(
      windows
        .filter(w => w.type === 'normal')
        .map(async w => {
          const tabs = w.tabs.filter(t => isValidUrl(t.url));
          const { tabsWithGroups, groups } = await captureTabGroups(tabs);
          return { tabs: tabsWithGroups, groups };
        })
    );
    const valid = data.filter(w => w.tabs.length > 0);
    if (valid.length) await saveSnapshot(valid);
  } catch { /* silent */ }
}

// ── Tab Group capture ─────────────────────────────────────────────────────────
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
    url: t.url,
    title: t.title || '',
    favIconUrl: t.favIconUrl || '',
    groupIndex: (t.groupId != null && t.groupId !== -1) ? (groupIndexMap[t.groupId] ?? -1) : -1
  }));

  return { tabsWithGroups, groups };
}
