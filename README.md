# Notes

A tray-resident notes app for Windows. Press **Ctrl + Alt + N** anywhere to toggle it. It starts hidden at login so the hotkey always works.

**Status:** in development. Notes runs on Windows, from source. macOS support and installers are planned. Parts of this README predate recent changes, and a full rewrite is planned.

## Run

Requires Node.js 24 or later and npm.

```
git clone https://github.com/celestinryf/notes-desktop.git
cd notes-desktop
npm install
npm run install:shortcuts   # Start Menu + desktop shortcuts, launches the app
```

The renderer and the editors are prebuilt bundles in `src/renderer/vendor/`. After changing their sources, run `npm run build`.

The app adds its own autostart entry (Settings → "Start Notes when I log in"). Quit from the tray icon.

## Features

- Notes with title, tags, Markdown body, autosave, pin, duplicate, trash with undo, restore, delete forever, empty trash
- Open files as notes (Ctrl+O, the Open file… button, or drag files onto the window): Markdown, text, LaTeX, JSON, code and any other text file are editable and written back to the file in place (hard links such as CLAUDE.md ↔ AGENTS.md stay joined; CRLF files stay CRLF). PDFs open in a viewer where you can comment, sign and rearrange pages. Word documents show as laid out in the file and can be edited in place, or in WordCraft when its web build is present. "Open with…" opens any file in its native app. Changes made by other programs are picked up while the note is open.
- Agent files: Settings → "Add my agent files" links your global CLAUDE.md/AGENTS.md, Claude commands, output styles, memory notes, and every project's CLAUDE.md/AGENTS.md into an "Agent files" folder. Editing them in Notes edits the real files.
- Folders, nested as deep as you like: create with the + next to Folders or Ctrl+Shift+N, right-click or the ⋯ button for new subfolder / rename / delete, double-click to rename, drag notes onto folders and folders onto folders (or onto All notes to move to the top level). Deleting a folder lifts its contents one level up; nothing is lost. The editor toolbar also has a folder picker.
- Instant search across title, body, and tags with match highlighting; sort by last edited, newest, or title; filter by tag
- Markdown renders as you type: `## ` becomes a heading, `- ` a list, `- [ ] ` a checklist, `**bold**` bold; tables and images render too. Ctrl+E shows the raw Markdown source and Ctrl+E again returns. Markdown is always what gets stored.
- Safety net: if a note contains Markdown the rendered view cannot show faithfully (inline HTML, footnotes), it opens as source with a notice, so just looking at it never rewrites it.
- Ctrl+B / Ctrl+I for bold and italic, Ctrl+K for a link, Tab / Shift+Tab to nest and un-nest list items
- Vaults (Settings → Vaults): add a folder, or clone a git repository, and its Markdown files become notes under a folder of the same name, subfolders included. New notes become files named after their title, renames rename the file, moves move it, trash uses `<vault>/.trash`. A watcher picks up changes made by other programs or by a `git pull`. For a repository with a remote, changes are committed a few seconds after you stop typing, pulled with rebase, and pushed; on an interval too; and before quit. Conflicts are never resolved for you: the sync stops, your local commit stays, and the status tells you to resolve in the folder. This is the obsidian-git model, so the same vault works in Obsidian or any editor.
- Desktop stickies (📌 Stick or Ctrl+Shift+T, tray → New sticky note): any note can sit on the desktop as a small frameless window with the same rendered editor, so a `- [ ]` checklist is a to-do sticky. Drag the top bar to move, drag edges to resize, pick a tint, toggle floating above other windows. ✕ removes it from the desktop (the note stays); Esc hides it until tray → Stickies shows it again. Position, size and tint are remembered and stickies come back at login. Edits in a sticky show up in the main window and vice versa.
- Bot (🤖 or Ctrl+Shift+A): a panel that runs Claude Code (`claude -p`) over your notes and streams its output. For a vault note it works in the vault folder; for other file notes, in that file's folder; for plain notes, in a workspace folder that mirrors them as Markdown and is read back afterwards (edits update notes, new files become notes, deletions are reported but kept). "Allow edits" controls whether the agent may write files. "Open terminal" starts an interactive Claude Code session in that same folder. Requires the Claude Code CLI on your PATH.
- Live share (Share ▾ → Live share this note…): edit one note together over your local network, no account or service. The host's app serves that single note at a link with a random token; whoever joins gets their own copy that stays in step both ways while the share lasts (last writer wins per note; if two people type at the same moment the later save stands). Stop from the Share menu or the Live bar; the note stays on every side. Shares resume after a restart. Locked and file-backed notes cannot be shared live.
- Lock a note (🔒 Lock or Ctrl+L): the text is encrypted on disk with a password (scrypt + AES-256-GCM); the title stays visible and searchable, the body does not. It stays readable until you hide the app or choose Lock now. There is no recovery for a forgotten password. File-backed notes cannot be locked.
- Reminders (⏰ Remind or Ctrl+Shift+M): quick picks or a date and time. A Windows notification appears when it is due (click it to open the note), the app shows a toast, the card badge turns red, and the Reminders view lists what is coming up, soonest first.
- Share (Share ▾ or Ctrl+Shift+S): copy as Markdown, rich text or plain text; email it; save as PDF, HTML or Markdown; show the file in Explorer for file-backed notes.
- Replace in the open note (Ctrl+H, or ⇄ in the find bar): one match at a time or all at once, in either view.
- Earlier versions (🕘 History or Ctrl+Shift+H): every saved change of a note, from the local git history; preview and restore any of them.
- Attachments (📎 Attach or Ctrl+Shift+O) and voice memos (🎙 Record or Ctrl+Shift+G): files are copied into the app's attachments folder and linked from the note; Ctrl+click a link to open it. Programs and scripts are never launched.
- Books (prototype; folder menu → Turn into a book): a folder whose notes are pages in a set order. Opening a page shows a strip of page tabs like Google Docs' document tabs: click to jump, ‹ › or Ctrl+PageUp/PageDown to turn pages, + Page to add one at the end, drag a tab to reorder. The note list shows the pages numbered in reading order.
- Related notes: under each note, the notes it links to, the notes that link to it, and notes that share its tags; click one to open it.
- Links between notes: in the link dialog (Ctrl+K) pick a note, or Share ▾ → Copy link to this note and paste it elsewhere. Ctrl+click follows it.
- Find in the open note (Ctrl+Shift+F; Enter/Shift+Enter or F3 step through, Esc closes). Ctrl+F searches all notes.
- Print the open note (🖨 Print or Ctrl+Shift+P): just the note, no chrome.
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
| Ctrl+P | Command palette: find any note or command |
| Ctrl+D | Pin / unpin |
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

## Licence

MIT, see [LICENSE](LICENSE). Third-party code and fonts are listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
