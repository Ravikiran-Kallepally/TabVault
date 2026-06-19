import { createSession } from '../utils/storage.js';
import { isValidUrl } from '../utils/helpers.js';

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-session') return;
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = tabs.filter(t => isValidUrl(t.url));
  if (!saveable.length) return;
  await createSession('', saveable);
});
