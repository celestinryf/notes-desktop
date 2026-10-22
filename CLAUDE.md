# notes-app

Project docs live in the Obsidian vault at `C:\Users\celes\Documents\projects-docs\notes-app\`, not in this repo.

Before doing any work, read from that folder:

1. `Notes App - Current Status.md`
2. The newest `Notes App - Handoff <date>.md`
3. `Notes App Project.md`
4. The note your task touches: Architecture, Features, Decisions and Findings, or Testing and Gotchas
5. For any change a person can see (layout, styles, a button, a menu, a dialog, copy): `Notes App - Design System.md`

Write handoffs, decisions, and findings back to that folder. Update `Notes App - Current Status.md` at the end of every prompt: overwrite it with where things stand, what is in progress, what is next, and the decisions waiting on the user.

## UI work (required for any visible change)
- Follow the `ui-design` skill: brief, options, a spec in numbers, build, then the screenshot loop. Audit with the `ui-audit` skill; for anything bigger than a small fix, have the `design-reviewer` agent review it.
- Look at the result before saying it is done: `npm run shots -- --scene <names> --eval "C:\Users\celes\.claude\skills\ui-audit\scripts\ui-metrics.js"`, read the PNGs in `%TEMP%\shots-notes-app`, then `node "C:\Users\celes\.claude\skills\ui-audit\scripts\summarize.js" "%TEMP%\shots-notes-app"`. Add a scene to `scripts/shots.js` for any new surface.
- Hard rules, from the design system note:
  - Use only the tokens in `src/renderer/styles.css`. No new colours, sizes or radii without adding them to the note.
  - Icons come from `src/renderer/icons.js` (`data-icon="name"`, `I('name')`; add names in `scripts/make-icons.js`, then `npm run icons`). Never emoji or Unicode glyphs.
  - Every command is reachable from the command palette (`commandList()` in `app.ts`). Rare actions go in the More menu, not on the toolbar.
  - **No dark borders round things, and no shadows except `--float-shadow`: the user dislikes them** (2026-10-19, amended 2026-10-20). Floating layers stand apart by their `--raised` tone, with a thin warm hairline (`--float-line`) and the faint `--float-shadow` lift in light only; both are off in dark. Buttons and pills are flat. Never add any other `box-shadow` that is not a coloured indicator (a focus halo, a drop target).
  - The tab pills show only while two or more tabs are open (the user's rule). Keep agreed behaviour when restructuring.
  - Colours come from tokens only; a colour scheme sets them (`src/shared/themes.mts`). A new colour token goes into `TOKENS` and `derive()` too.
  - Dropdowns are native `<select>` elements styled with `appearance: base-select`; never build a custom dropdown widget.
- Do not "polish" in place of fixing structure: the `ui-audit` skill starts at structure for a reason.

The renderer is TypeScript and bundled: `src/renderer/app.ts`, `sticky.ts` and the modules they import are built by `npm run build:app` into `src/renderer/vendor/app.bundle.js` and `sticky.bundle.js`, which are tracked. Run it after any renderer edit; the unit test `renderer-bundle.test.js` fails when the tracked bundle is stale. The four vendor bundles (editor, docx, pdf, code) stay separate scripts and globals; their entries (`src/editor/index.ts` and the like) are TypeScript, built by `npm run build`, and typed for the renderer through `globals.d.ts`. Every renderer module is TypeScript except the generated `icons.js`. Page element handles (`el` in `dom.ts`, and the sticky page's) come from `pageElement(selector, Type)`, which checks at load that the element exists and is that class; a new handle uses the class of its tag in the HTML. Events from main reach the split view's right side through `fromMain`, typed per event.

The main process is TypeScript ES modules with no build step: every file in `src/` except `preload.js` is `.mts` (as are `src/shared/` and `src/docx-edit/ooxml.mts`), and Electron runs `src/main.mts` directly by stripping the types. Only erasable syntax is allowed (no enums, namespaces or parameter properties), and type-only imports say `import type`. `noImplicitAny` is on for the main process and the renderer. No `any`, no `as` casts but `as const`, no `!` assertions: untrusted input (JSON from disk or the network, the page's IPC arguments) is `unknown` and narrowed with `isRecord`/`isObjectLike` from the shared helpers, and a note known to have a file is a `FileNote` (`isFileNote` in the store). Imports name the file with its extension (`./store.mts`). Worker scripts are `.mts` too, named by file in `runWorker`. The preload stays JavaScript because a sandboxed preload is not type-stripped. Heavy libraries load on first use through `requireWhenNeeded` (`createRequire`), not at startup. The unit tests are CommonJS and `require()` the `.mts` files.

No comments anywhere in the repo (the user's rule; all of them were removed on 2026-10-21): names and structure carry the meaning, and the vault holds the reasoning. The only ones kept are what a tool reads: `// @ts-check`, a bare `// @ts-expect-error` above a library typing gap, JSDoc type tags in `preload.js` and the generated `icons.js`, and the Lucide licence notice `make-icons.js` writes into `icons.js`.

Gate before any PR: `npm run test:all` (typecheck, unit, UI, e2e). `npm run typecheck` runs `tsc` over the main process (`tsconfig.json`: the `.mts` files, `preload.js` and the types) and the renderer modules (`tsconfig.renderer.json`, which also reads `src/renderer/globals.d.ts` for `window` and the `state` shape). `src/types.d.ts` holds the domain types and the IPC contract; a new IPC channel goes into `IpcContract` and `NotesApi` there first. A new renderer module is a `.ts` file; a new main-process file is a `.mts` file; a new field on `state` goes into `RendererState` first. The e2e and hotkey checks send real keystrokes, so never run them while the user is at the keyboard. The UI suite and the shots set `NOTES_APP_DRY_SPEECH=1`, so read aloud says nothing; keep that flag on any new runner.
