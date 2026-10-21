# notes-app

Project docs live in the Obsidian vault at `C:\Users\celes\Documents\projects-docs\notes-app\`, not in this repo.

Before doing any work, read from that folder:

1. The newest `Notes App - Handoff <date>.md`
2. `Notes App Project.md`
3. The note your task touches: Architecture, Features, Decisions and Findings, or Testing and Gotchas
4. For any change a person can see (layout, styles, a button, a menu, a dialog, copy): `Notes App - Design System.md`

Write handoffs, decisions, and findings back to that folder.

## UI work (required for any visible change)
- Follow the `ui-design` skill: brief, options, a spec in numbers, build, then the screenshot loop. Audit with the `ui-audit` skill; for anything bigger than a small fix, have the `design-reviewer` agent review it.
- Look at the result before saying it is done: `npm run shots -- --scene <names> --eval "C:\Users\celes\.claude\skills\ui-audit\scripts\ui-metrics.js"`, read the PNGs in `%TEMP%\shots-notes-app`, then `node "C:\Users\celes\.claude\skills\ui-audit\scripts\summarize.js" "%TEMP%\shots-notes-app"`. Add a scene to `scripts/shots.js` for any new surface.
- Hard rules, from the design system note:
  - Use only the tokens in `src/renderer/styles.css`. No new colours, sizes or radii without adding them to the note.
  - Icons come from `src/renderer/icons.js` (`data-icon="name"`, `I('name')`; add names in `scripts/make-icons.js`, then `npm run icons`). Never emoji or Unicode glyphs.
  - Every command is reachable from the command palette (`commandList()` in `app.js`). Rare actions go in the More menu, not on the toolbar.
  - **No dark borders round things, and no shadows except `--float-shadow`: the user dislikes them** (2026-10-19, amended 2026-10-20). Floating layers stand apart by their `--raised` tone, with a thin warm hairline (`--float-line`) and the faint `--float-shadow` lift in light only; both are off in dark. Buttons and pills are flat. Never add any other `box-shadow` that is not a coloured indicator (a focus halo, a drop target).
  - The tab pills show only while two or more tabs are open (the user's rule). Keep agreed behaviour when restructuring.
  - Colours come from tokens only; a colour scheme sets them (`src/shared/themes.js`). A new colour token goes into `TOKENS` and `derive()` too.
  - Dropdowns are native `<select>` elements styled with `appearance: base-select`; never build a custom dropdown widget.
- Do not "polish" in place of fixing structure: the `ui-audit` skill starts at structure for a reason.

Gate before any PR: `npm run test:all` (typecheck, unit, UI, e2e). `npm run typecheck` runs `tsc` over the files marked `// @ts-check` (store, main, preload, themes) against `src/types.d.ts`, which holds the domain types and the IPC contract; a new IPC channel goes into `IpcContract` and `NotesApi` there first. The e2e and hotkey checks send real keystrokes, so never run them while the user is at the keyboard. The UI suite and the shots set `NOTES_APP_DRY_SPEECH=1`, so read aloud says nothing; keep that flag on any new runner.
