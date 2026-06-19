import { createSession, getSessions } from '../utils/storage.js';
import { isValidUrl } from '../utils/helpers.js';

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-session') return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) return;
  await createSession('', saveable);
});

async function refreshBadge() {
  const sessions = await getSessions();
  const n = sessions.length;
  chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tabvault_sessions) refreshBadge();
});
