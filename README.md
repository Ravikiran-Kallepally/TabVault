# TabVault – Tab & Session Manager

A Chrome extension that saves, searches and restores browser sessions. Local-first, no account required, no data leaves your browser.

## Features

- **Save sessions** — capture all open tabs in one click or with `Ctrl+Shift+S`
- **Instant search** — search across session names and every tab title/URL
- **Restore anywhere** — open a saved session in a new window or add tabs to the current one
- **Pin sessions** — keep important sessions at the top
- **Rename inline** — double-click any session name to edit it
- **Full dashboard** — filter by today/this week/pinned, sort by date or tab count, preview every tab
- **Export & Import** — back up all sessions as JSON, import on any machine
- **Favicon collage** — visual preview of sites in each session at a glance
- **Keyboard shortcut** — `Ctrl+Shift+S` / `Cmd+Shift+S` saves silently without opening the popup

## Stack

- Plain JavaScript — no framework, no build step
- Chrome Extension Manifest V3
- `chrome.storage.local` — all data stays in your browser
- ES Modules throughout

## Project Structure

```
TabVault/
├── manifest.json
├── background/
│   └── service-worker.js     # handles keyboard shortcut
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js              # main popup UI
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js          # full-page session manager
├── utils/
│   ├── storage.js            # CRUD for sessions via chrome.storage
│   └── helpers.js            # timeAgo, favicons, colors, escaping
└── icons/                    # add 16/48/128px PNGs here for store
```

## Installation (Development)

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select this folder
5. The TabVault icon appears in your toolbar

## Keyboard Shortcut

`Ctrl+Shift+S` (Windows/Linux) or `Cmd+Shift+S` (Mac) saves the current window as a session immediately — no popup needed. You can change the shortcut at `chrome://extensions/shortcuts`.

## Roadmap

- [ ] Icons and Chrome Web Store listing
- [ ] AI tab auto-grouping suggestions
- [ ] Cross-device sync (E2E encrypted, no server)
- [ ] Onboarding flow for new users
- [ ] Team session sharing (Pro tier)
- [ ] Chrome Tab Groups native integration

## License

MIT
