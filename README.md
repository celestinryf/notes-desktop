# Notes

A tray-resident notes app for Windows. Press **Ctrl + Alt + N** anywhere to toggle it. It starts hidden at login so the hotkey always works.

## Run

```
npm install
npm run install:shortcuts   # Start Menu shortcut + launches the app
```

The app adds its own autostart entry (Settings → "Start Notes when I log in"). Quit from the tray icon.

## Features

- Notes with title, tags, Markdown body, autosave, pin, duplicate, trash with undo, restore, delete forever, empty trash
- Instant search across title, body, and tags with match highlighting; sort by last edited, newest, or title; filter by tag
- Markdown preview (Ctrl+E) with clickable checklists that write back to the source
- List continuation on Enter, Tab indents, Ctrl+B / Ctrl+I / Ctrl+K wrap selection
- Light (cream) and dark (ink) themes, follows the system by default; adjustable editor font size; always-on-top option
- Drag the edge of the sidebar or the note list to resize them; widths persist, double-click an edge to reset
- Export a note as `.md`, export everything as JSON, import `.md`/`.txt` files
- Data lives in `%APPDATA%\notes-app\notes.json`, written atomically, with rolling backups in `backups\`

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Alt+N | Show / hide from anywhere (changeable in Settings) |
| Esc | Hide window |
| Ctrl+N | New note |
| Ctrl+F | Search |
| Ctrl+E | Toggle preview |
| Ctrl+P | Pin / unpin |
| Ctrl+Del | Move to trash |
| Ctrl+S | Save now |
| Ctrl+, | Settings |
| Ctrl+\ | Toggle sidebar |
| Ctrl+Shift+L | Toggle light / dark |
| Alt+↑ / Alt+↓ | Previous / next note |

## Tests

```
npm test          # unit tests for the store and helpers
npm run test:ui   # Playwright drives every feature in the real app (search, sort, pin, tags, duplicate,
                  # trash/undo/restore/delete/empty, preview checklists, settings, export/import, hotkey change)
npm run test:e2e  # launches the app, presses the real OS hotkey via SendKeys, types a note, checks disk
npm run test:all  # all three
```

The UI and e2e tests use isolated data folders and test-only hotkeys so they never touch your notes or your running instance. Export and import dialogs are stubbed inside the main process during the UI test so the real file writes still happen.
