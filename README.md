# TabVault – Tab & Session Manager

A Chrome extension that saves, searches and restores browser sessions — now with AI. Local-first, no account required, no data leaves your browser.

## Features

- **Save sessions** — capture all open tabs in one click or with `Ctrl+Shift+S`
- **AI smart naming** — Claude suggests a meaningful session name based on your tabs (e.g. "Work: React Research" instead of "Jun 18, 3:45 PM")
- **AI smart grouping** — one click to let Claude analyze your tabs and split them into multiple named sessions automatically
- **Badge count** — session count always visible on the toolbar icon
- **Instant search** — search across session names and every tab title/URL, with match highlighting
- **Restore anywhere** — open a saved session in a new window or add tabs to the current one
- **Undo delete** — 5-second grace period with an Undo button so nothing is lost by accident
- **Keyboard navigation** — arrow keys to move through sessions, Enter to restore, Delete to remove
- **Pin sessions** — keep important sessions at the top
- **Rename inline** — click any session name to edit it in place
- **Full dashboard** — filter by today/this week/pinned, sort by date or tab count, preview every tab
- **Export & Import** — back up all sessions as JSON, import on any machine
- **Favicon collage** — visual preview of sites in each session at a glance
- **Keyboard shortcut** — `Ctrl+Shift+S` / `Cmd+Shift+S` saves silently without opening the popup

## AI Setup

AI features (smart naming and smart grouping) use the Claude API and require a free API key.

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
2. Open the **Dashboard** (grid icon in the popup header)
3. Paste your key under **AI Features → Save Key**

AI features are completely optional — the extension works fully without a key.

## Stack

- Plain JavaScript — no framework, no build step
- Chrome Extension Manifest V3
- `chrome.storage.local` — all data stays in your browser
- ES Modules throughout
- Claude Haiku via Anthropic API (optional, for AI features)

## Project Structure

```
TabVault/
├── manifest.json
├── background/
│   └── service-worker.js     # keyboard shortcut + badge count
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # main popup UI with AI naming + grouping
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js          # full-page session manager + API key settings
├── utils/
│   ├── storage.js            # CRUD for sessions via chrome.storage
│   ├── helpers.js            # timeAgo, favicons, colors, escaping
│   └── ai.js                 # Claude API calls for naming + grouping
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Installation (Development)

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this folder
5. The TabVault icon appears in your toolbar

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+S` / `Cmd+Shift+S` | Save current window silently |
| `↑` / `↓` | Navigate sessions in popup |
| `Enter` | Restore focused session |
| `Delete` / `Backspace` | Delete focused session (with Undo) |

You can change the save shortcut at `chrome://extensions/shortcuts`.

## Roadmap

- [ ] Chrome Web Store listing
- [ ] Cross-device sync (E2E encrypted, no server)
- [ ] Onboarding flow for new users
- [ ] Chrome Tab Groups native integration
- [ ] Team session sharing (Pro tier)

## License

MIT
