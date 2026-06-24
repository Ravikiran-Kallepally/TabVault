# TabVault – Session Manager

A Chrome extension that saves, searches and restores browser sessions. Local-first, no account required, nothing leaves your browser.

![Version](https://img.shields.io/badge/version-1.2.0-blue) ![MV3](https://img.shields.io/badge/Manifest-V3-green) ![License](https://img.shields.io/badge/license-MIT-lightgrey) ![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Live-brightgreen)

---

## Features

### Core
- **Save sessions** — capture every open tab in one click, silently with `Ctrl+Shift+S`, or via right-click context menu
- **Save & Close** — saves tabs then closes them instantly, freeing memory (OneTab's core use case)
- **Restore anywhere** — open a saved session in a new window, or add tabs to the current one
- **Instant search** — search across session names and every tab title/URL simultaneously, with match highlighting
- **Undo delete** — 5-second grace period with an Undo button so nothing is lost by accident

### Organisation
- **Tags** — create colour-coded tags and assign them to sessions; filter by tag in the popup and dashboard
- **Drag tags to cards** — drag a tag from the sidebar onto a session card in the dashboard to assign instantly
- **Pin sessions** — keep important sessions permanently at the top of the list
- **Rename inline** — click any session name to edit in place; Backspace and cursor placement work correctly
- **Duplicate sessions** — clone any session with one click

### Dashboard
- **Full-page dashboard** — grid view of all sessions with favicon previews, tab count, and timestamps
- **Detail panel** — click or drag any card to the right panel to preview all tabs; click any tab to open it
- **Drag cards to detail** — drag a session card into the detail panel as an alternative to clicking
- **Close panel** — × button to dismiss the detail panel and expand the grid
- **Filters** — All · Pinned · Today · This Week · Live Windows
- **Sort** — newest, oldest, name A–Z, most tabs
- **Notes** — add free-text notes to any session; auto-saved as you type
- **Live Windows** — view and save currently open browser windows
- **Delete individual tabs** — hover any tab in the detail panel to reveal a trash icon; removes just that tab from the session

### Data & Sync
- **Export** — download all sessions as a JSON file
- **Import** — restore sessions from a JSON backup on any machine
- **Share codes** — encode any session as a `tv1:…` text code; paste on another machine to import
- **Import from OneTab** — paste a OneTab export directly; sessions are created automatically

### Reliability
- **Auto-save snapshots** — every 30 minutes, TabVault silently snapshots all open windows
- **Crash recovery** — on next launch, a recovery banner lets you restore tabs lost to a crash or restart
- **Window-close recovery** — closing a Chrome window by accident shows a one-click restore banner immediately, before the session is gone
- **Live auto-refresh** — popup and dashboard stay in sync with each other in real time via `chrome.storage.onChanged`

### UX
- **Dark / light mode** — toggle via the moon/sun icon; defaults to dark; syncs live across popup and dashboard
- **Google Material design** — clean light palette (`#F8F9FA` bg, `#1A73E8` accent) with full dark override
- **Onboarding** — 3-slide walkthrough on first launch
- **Chrome Tab Groups** — saves and restores native tab group names and colours; "Add to this window" automatically groups the restored tabs by session name
- **Rate shortcut** — amber ★ in the header opens the Chrome Web Store review page directly
- **Share** — share icon in the header opens a social share dialog (LinkedIn, Facebook, Reddit, X, WhatsApp) with a one-click copy link

---

## Why TabVault over OneTab?

| Feature | TabVault | OneTab |
|---|---|---|
| Full-text search | ✅ | ❌ |
| Auto-save / crash recovery | ✅ | ❌ |
| Window-close recovery | ✅ | ❌ |
| Chrome Tab Groups | ✅ | ❌ |
| Tags & filters | ✅ | ❌ |
| Dark mode | ✅ | ❌ |
| Session notes | ✅ | ❌ |
| Share codes (no server) | ✅ | ❌ |
| Undo delete | ✅ | ❌ |
| Dashboard view | ✅ | ❌ |
| Delete individual tabs | ✅ | ❌ |
| Social share | ✅ | ❌ |
| Import from OneTab | ✅ | — |
| Save & close tabs | ✅ | ✅ |
| Local-first / no account | ✅ | ✅ |

---

## Stack

- Plain JavaScript — no framework, no build step
- Chrome Extension Manifest V3
- `chrome.storage.local` — all persistent data stays on device
- `chrome.storage.session` — ephemeral window cache for close-recovery (cleared on browser exit)
- ES Modules throughout
- `chrome.tabGroups` for native group save/restore
- `chrome.alarms` for 30-minute auto-save
- `chrome.contextMenus` + `chrome.commands` for save shortcuts
- `chrome.windows.onRemoved` for window-close recovery

---

## Project Structure

```
TabVault/
├── manifest.json
├── background/
│   └── service-worker.js       # shortcuts, context menu, auto-save, window-close recovery
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js                # main popup UI
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js            # full-page session manager
├── utils/
│   ├── storage.js              # CRUD for sessions, tags, snapshots
│   └── helpers.js              # timeAgo, favicons, colors, escaping
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    └── index.html              # Privacy policy (served via GitHub Pages)
```

---

## Installation (Development)

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `TabVault` folder
5. Pin the icon to your toolbar

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` / `Cmd+Shift+S` | Save current window silently |
| `↑` / `↓` | Navigate sessions in popup |
| `Enter` | Restore focused session |
| `Delete` / `Backspace` | Delete focused session (with Undo) |

Change the save shortcut at `chrome://extensions/shortcuts`.

---

## Changelog

### v1.2.0 — 2026-06-24
- **Tab Groups on restore** — "Add to this window" now automatically creates a Chrome Tab Group named after the session, so restored tabs land visually grouped with the coloured border
- **Delete individual tabs** — hover any tab row in the dashboard detail panel to reveal a Material-style trash icon; removes just that tab from the saved session instantly

### v1.1.0 — 2026-06-24
- **Share modal** — share button in the popup header opens a dialog with LinkedIn, Facebook, Reddit, X and WhatsApp icons plus a one-click copy link to the Chrome Web Store listing

### v1.0.0 — 2026-06-23 (initial launch)
- Save, search and restore browser sessions
- Save & Close (free memory like OneTab)
- Full-page dashboard with grid view, detail panel, drag-and-drop
- Tags, filters (All · Pinned · Today · This Week · Live Windows), sort
- Session notes, pin, rename, duplicate
- Export / import JSON, share codes (`tv1:…`), OneTab import
- Auto-save snapshots every 30 minutes
- Crash recovery and window-close recovery banners
- Chrome Tab Groups save and restore
- Dark / light mode with live sync
- 3-slide onboarding walkthrough
- Keyboard shortcuts (`Ctrl+Shift+S`, arrow keys, Enter, Delete)

---

## Privacy

TabVault collects no user data. All sessions are stored locally using `chrome.storage.local`. Nothing is transmitted to any server.

Full privacy policy: [ravikiran-kallepally.github.io/TabVault](https://ravikiran-kallepally.github.io/TabVault/)

---

## Future Roadmap

- Cross-device sync (E2E encrypted, no server)
- Team session sharing
- Tab expiry warnings for sessions not opened in 30+ days

---

## License

MIT
