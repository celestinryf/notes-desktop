# Notes

A tray-resident notes app for Windows. Press **Ctrl + Alt + N** anywhere to toggle it. It starts hidden at login so the hotkey always works.

## Run

```
npm install
npm run install:shortcuts   # Start Menu + desktop shortcuts, launches the app
```

The rendered editor is a prebuilt bundle at `src/renderer/vendor/editor.bundle.js`. After changing `src/editor/index.js`, run `npm run build`.

The app adds its own autostart entry (Settings → "Start Notes when I log in"). Quit from the tray icon.

## Features

- Notes with title, tags, Markdown body, autosave, pin, duplicate, trash with undo, restore, delete forever, empty trash
- Open files as notes (Ctrl+O, the Open file… button, or drag files onto the window): Markdown, text, LaTeX, JSON, code and any other text file are editable and written back to the file in place (hard links such as CLAUDE.md ↔ AGENTS.md stay joined; CRLF files stay CRLF). PDFs show in a viewer, Word documents are converted to Markdown for reading; both are read-only here with an "Open with…" button for the native app. Changes made by other programs are picked up while the note is open.
- Agent files: Settings → "Add my agent files" links your global CLAUDE.md/AGENTS.md, Claude commands, output styles, memory notes, and every project's CLAUDE.md/AGENTS.md into an "Agent files" folder. Editing them in Notes edits the real files.
- Folders, nested as deep as you like: create with the + next to Folders or Ctrl+Shift+N, right-click or the ⋯ button for new subfolder / rename / delete, double-click to rename, drag notes onto folders and folders onto folders (or onto All notes to move to the top level). Deleting a folder lifts its contents one level up; nothing is lost. The editor toolbar also has a folder picker.
- Instant search across title, body, and tags with match highlighting; sort by last edited, newest, or title; filter by tag
- Markdown renders as you type: `## ` becomes a heading, `- ` a list, `- [ ] ` a checklist, `**bold**` bold; tables and images render too. Ctrl+E shows the raw Markdown source and Ctrl+E again returns. Markdown is always what gets stored.
- Safety net: if a note contains Markdown the rendered view cannot show faithfully (inline HTML, footnotes), it opens as source with a notice, so just looking at it never rewrites it.
- Ctrl+B / Ctrl+I for bold and italic, Ctrl+K for a link, Tab / Shift+Tab to nest and un-nest list items
- Vaults (Settings → Vaults): add a folder, or clone a git repository, and its Markdown files become notes under a folder of the same name, subfolders included. New notes become files named after their title, renames rename the file, moves move it, trash uses `<vault>/.trash`. A watcher picks up changes made by other programs or by a `git pull`. For a repository with a remote, changes are committed a few seconds after you stop typing, pulled with rebase, and pushed; on an interval too; and before quit. Conflicts are never resolved for you: the sync stops, your local commit stays, and the status tells you to resolve in the folder. This is the obsidian-git model, so the same vault works in Obsidian or any editor.
- Bot (🤖 or Ctrl+Shift+A): a panel that runs Claude Code (`claude -p`) over your notes and streams its output. For a vault note it works in the vault folder; for other file notes, in that file's folder; for plain notes, in a workspace folder that mirrors them as Markdown and is read back afterwards (edits update notes, new files become notes, deletions are reported but kept). "Allow edits" controls whether the agent may write files. "Open terminal" starts an interactive Claude Code session in that same folder. Requires the Claude Code CLI on your PATH.
- Read aloud (🔊 Read or Ctrl+Shift+R) speaks the selection or the whole note with a system voice; voice and speed in Settings. Dictate (🎤 or Ctrl+Shift+D) opens Windows speech recognition (Win+H) into the editor; speech is handled by Windows, not this app.
- Writing column can sit left, center, or right of the editor pane at a chosen width, or use the full width (Settings)
- Git history: every change is committed to a git repo inside the data folder (only `notes.json` is tracked). Add an optional remote in Settings and each commit is pushed. Commit now / Push now buttons in Settings.
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
| Ctrl+O | Open files as notes |
| Ctrl+Shift+N | New folder (inside the current folder) |
| Ctrl+F | Search |
| Ctrl+E | Toggle Markdown source / rendered |
| Ctrl+P | Pin / unpin |
| Ctrl+Shift+Del | Move to trash (Ctrl+Del also works outside a text field) |
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
