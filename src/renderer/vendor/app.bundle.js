"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/shared/helpers.js
  var require_helpers = __commonJS({
    "src/shared/helpers.js"(exports, module) {
      "use strict";
      (function(root, factory) {
        if (typeof module === "object" && module.exports) module.exports = factory();
        else root.NotesHelpers = factory();
      })(typeof self !== "undefined" ? self : exports, function() {
        "use strict";
        const UNTITLED = "Untitled";
        function firstLine(text) {
          const lines = String(text || "").split(/\r?\n/);
          for (const line of lines) {
            const t = line.replace(/^#+\s*/, "").trim();
            if (t) return t;
          }
          return "";
        }
        function truncate(text, max) {
          const s = String(text || "");
          if (s.length <= max) return s;
          const points = Array.from(s);
          if (points.length <= max) return s;
          return points.slice(0, Math.max(0, max - 1)).join("").trimEnd() + "\u2026";
        }
        function deriveTitle(note) {
          if (!note) return UNTITLED;
          const explicit = String(note.title || "").trim();
          if (explicit) return explicit;
          const fromBody = firstLine(note.body);
          return fromBody ? truncate(fromBody, 60) : UNTITLED;
        }
        function snippet(note, max) {
          max = max || 100;
          const body = String(note && note.body || "").slice(0, Math.max(600, max * 8));
          const title = String(note && note.title || "").trim();
          const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          const start = !title && lines.length && !/^```/.test(lines[0]) ? 1 : 0;
          const kept = lines.slice(start);
          const isItem = (l) => /^([-*+]|\d+[.)])\s/.test(l);
          const listed = kept.map((l, i) => isItem(l) && isItem(kept[i + 1] || "") && !/[.,;:!?]$/.test(l) ? l + "," : l);
          const text = plainTextFromMarkdown(listed.join("\n")).replace(/\bcode block omitted\.\s*/g, "").replace(/\s+/g, " ").trim();
          return truncate(text, max);
        }
        function relativeTime(ts, now) {
          now = now == null ? Date.now() : now;
          const diff = Math.max(0, now - ts);
          const s = Math.floor(diff / 1e3);
          if (s < 45) return "just now";
          const m = Math.floor(s / 60);
          if (m < 60) return m + " min ago";
          const h = Math.floor(m / 60);
          if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
          const d = Math.floor(h / 24);
          if (d < 7) return d + (d === 1 ? " day ago" : " days ago");
          const date = new Date(ts);
          const sameYear = date.getFullYear() === new Date(now).getFullYear();
          const opts = sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" };
          return date.toLocaleDateString(void 0, opts);
        }
        function parseTags(input) {
          if (Array.isArray(input)) input = input.join(",");
          const seen = /* @__PURE__ */ new Set();
          const out = [];
          for (const raw of String(input || "").split(/[,\s]+/)) {
            const t = raw.replace(/^#+/, "").trim().toLowerCase();
            if (!t || seen.has(t)) continue;
            seen.add(t);
            out.push(t);
          }
          return out;
        }
        const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;
        function toggleTaskAt(body, index) {
          const lines = String(body || "").split("\n");
          let seen = 0;
          for (let i = 0; i < lines.length; i++) {
            const m = TASK_RE.exec(lines[i]);
            if (!m) continue;
            if (seen === index) {
              const checked = m[2].toLowerCase() === "x";
              lines[i] = lines[i].replace(TASK_RE, m[1] + (checked ? "[ ]" : "[x]"));
              return lines.join("\n");
            }
            seen++;
          }
          return String(body || "");
        }
        function countWords(text) {
          const t = String(text || "").trim();
          if (!t) return 0;
          return t.split(/\s+/).length;
        }
        function tokenize(query) {
          return String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
        }
        function matchesQuery(note, query) {
          const tokens = tokenize(query);
          if (!tokens.length) return true;
          const hay = (String(note.title || "") + "\n" + String(note.body || "") + "\n" + (note.tags || []).join(" ")).toLowerCase();
          return tokens.every((t) => hay.indexOf(t) !== -1);
        }
        const SORTS = {
          updated: (a, b) => b.updatedAt - a.updatedAt,
          created: (a, b) => b.createdAt - a.createdAt,
          title: (a, b) => deriveTitle(a).localeCompare(deriveTitle(b), void 0, { sensitivity: "base" })
        };
        function sortNotes(notes, sort) {
          const cmp = SORTS[sort] || SORTS.updated;
          return notes.slice().sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return cmp(a, b) || b.updatedAt - a.updatedAt;
          });
        }
        const MODIFIERS = /* @__PURE__ */ new Set(["commandorcontrol", "cmdorctrl", "control", "ctrl", "alt", "option", "shift", "super", "meta", "command", "cmd", "altgr"]);
        const NAMED_KEYS = /* @__PURE__ */ new Set(["space", "tab", "backspace", "delete", "insert", "return", "enter", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "escape", "esc", "plus", "numadd", "numsub", "nummult", "numdiv", "numdec"]);
        const SINGLE_KEY_RE = /^[a-z0-9`~!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|]$/i;
        const FKEY_RE = /^f([1-9]|1[0-9]|2[0-4])$/i;
        const NUMPAD_RE = /^num[0-9]$/i;
        function isBindableKey(key) {
          return SINGLE_KEY_RE.test(key) || FKEY_RE.test(key) || NUMPAD_RE.test(key) || NAMED_KEYS.has(key.toLowerCase());
        }
        function parseAccelerator(str) {
          const parts = String(str || "").split("+").map((p) => p.trim()).filter(Boolean);
          if (parts.length < 2) return { ok: false, reason: "A hotkey needs at least one modifier and a key, like Ctrl+Alt+N." };
          const key = parts[parts.length - 1];
          const mods = parts.slice(0, -1);
          if (!mods.every((m) => MODIFIERS.has(m.toLowerCase()))) return { ok: false, reason: 'Unknown modifier in "' + str + '".' };
          if (!mods.some((m) => m.toLowerCase() !== "shift")) return { ok: false, reason: "Use Ctrl, Alt, or Win together with the key (Shift alone would block normal typing)." };
          if (!isBindableKey(key)) return { ok: false, reason: '"' + key + '" is not a key that can be bound.' };
          const normMods = mods.map((m) => {
            const l = m.toLowerCase();
            if (l === "ctrl" || l === "control") return "Control";
            if (l === "cmdorctrl" || l === "commandorcontrol") return "CommandOrControl";
            return m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
          });
          const normKey = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
          return { ok: true, value: normMods.join("+") + "+" + normKey };
        }
        function displayAccelerator(str) {
          return String(str || "").replace(/CommandOrControl|CmdOrCtrl/gi, "Ctrl").replace(/Control/gi, "Ctrl").replace(/\+/g, " + ");
        }
        function noteToMarkdown(note) {
          const title = deriveTitle(note);
          const tags = (note.tags || []).length ? "\n\nTags: " + note.tags.map((t) => "#" + t).join(" ") : "";
          return "# " + title + "\n\n" + String(note.body || "").replace(/\s+$/, "") + tags + "\n";
        }
        function markdownToNote(filename, content) {
          const text = String(content || "").replace(/\r\n/g, "\n");
          let title = String(filename || "").replace(/\.(md|markdown|txt)$/i, "").trim();
          let body = text;
          const m = /^#\s+(.+)\n+/.exec(text);
          if (m) {
            title = m[1].trim();
            body = text.slice(m[0].length);
          }
          const tags = [];
          body = body.replace(/\n*Tags:\s*((?:#[\p{L}\p{N}_-]+\s*)+)\s*$/iu, (_, t) => {
            tags.push(...parseTags(t));
            return "";
          });
          return { title, body: body.replace(/\s+$/, ""), tags };
        }
        const PANE_LIMITS = {
          sidebarWidth: { min: 160, max: 420, def: 232 },
          listWidth: { min: 220, max: 560, def: 300 }
        };
        const EDITOR_MIN = 320;
        function clampPane(name, value) {
          const lim = PANE_LIMITS[name];
          const v = Number(value);
          if (!lim) return value;
          if (!Number.isFinite(v)) return lim.def;
          return Math.min(lim.max, Math.max(lim.min, Math.round(v)));
        }
        function formatWhen(ts, now) {
          now = now == null ? Date.now() : now;
          const d = new Date(ts), n = new Date(now);
          const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const dayOf = (x) => x.toDateString();
          const shift = (days) => {
            const c = new Date(n);
            c.setDate(n.getDate() + days);
            return dayOf(c);
          };
          if (dayOf(d) === dayOf(n)) return "today " + time;
          if (dayOf(d) === shift(1)) return "tomorrow " + time;
          if (dayOf(d) === shift(-1)) return "yesterday " + time;
          const sameYear = d.getFullYear() === n.getFullYear();
          return d.toLocaleDateString([], sameYear ? { weekday: "short", month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }) + " " + time;
        }
        function mailtoFor(note, limit) {
          limit = limit || 1900;
          const subject = truncate(deriveTitle(note) || "Note", 120);
          const body = String(note.body || "");
          const notice = "\n\n[Truncated for email. Share the full note as a PDF or Markdown file.]";
          const head = "mailto:?subject=" + encodeURIComponent(subject) + "&body=";
          const full = head + encodeURIComponent(body);
          if (full.length <= limit) return { url: full, truncated: false };
          const points = Array.from(body);
          let lo = 0, hi = points.length;
          const budget = Math.max(0, limit - head.length - encodeURIComponent(notice).length);
          while (lo < hi) {
            const mid = lo + hi + 1 >> 1;
            if (encodeURIComponent(points.slice(0, mid).join("")).length <= budget) lo = mid;
            else hi = mid - 1;
          }
          return { url: head + encodeURIComponent(points.slice(0, lo).join("") + notice), truncated: true };
        }
        function plainTextFromMarkdown(md) {
          let s = String(md || "").replace(/\r\n/g, "\n");
          s = s.replace(/```[\s\S]*?```/g, " code block omitted. ");
          s = s.replace(/`([^`\n]+)`/g, "$1");
          s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt) => alt ? alt + ". " : "");
          s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
          s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*$/gm, (_, h) => /[.!?:;]$/.test(h) ? h : h + ".");
          s = s.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "");
          s = s.replace(/^\s*[-*+]\s+/gm, "");
          s = s.replace(/^\s*\d+[.)]\s+/gm, "");
          s = s.replace(/^\s*>\s?/gm, "");
          s = s.replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, "");
          s = s.replace(/\|/g, " ");
          s = s.replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(.*?)\1/g, "$2").replace(/~~(.*?)~~/g, "$1");
          s = s.replace(/<[^>\n]+>/g, "");
          s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
          s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          return s;
        }
        function speechChunks(text, max) {
          max = max || 220;
          const out = [];
          for (const para of String(text || "").split(/\n+/)) {
            const sentences = para.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
            let cur = "";
            for (const sRaw of sentences) {
              const s = sRaw.trim();
              if (!s) continue;
              if (s.length > max) {
                if (cur) {
                  out.push(cur);
                  cur = "";
                }
                for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
                continue;
              }
              if ((cur + " " + s).trim().length > max && cur) {
                out.push(cur);
                cur = s;
              } else cur = (cur + " " + s).trim();
            }
            if (cur.trim()) out.push(cur.trim());
          }
          return out;
        }
        function noteLinkIds(body) {
          const out = [];
          const re = /note:\/\/([0-9a-f][0-9a-f-]{7,})/gi;
          let m;
          while ((m = re.exec(String(body || ""))) !== null) {
            const id = m[1].toLowerCase();
            if (!out.includes(id)) out.push(id);
          }
          return out;
        }
        function safeFilename(name) {
          let s = Array.from(String(name || UNTITLED).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim()).slice(0, 80).join("").replace(/[. ]+$/, "");
          if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = "note-" + s;
          return s || UNTITLED;
        }
        function isViewerOnlyFile8(note) {
          return !!(note && note.filePath && note.fileKind !== "text");
        }
        function extOf(filePath) {
          const base = String(filePath || "").split(/[\\/]/).pop().toLowerCase();
          if (!base.includes(".")) return base;
          return base.slice(base.lastIndexOf(".") + 1);
        }
        function isPlainTextFile5(note) {
          return !!(note && note.filePath && note.fileKind === "text" && !/\.(md|markdown|mdx)$/i.test(note.filePath));
        }
        function isNonMarkdownFile3(note) {
          return isPlainTextFile5(note) || isViewerOnlyFile8(note);
        }
        const WORD_EXT = /* @__PURE__ */ new Set(["docx", "docm", "dotx", "dotm", "doc", "dot", "rtf", "odt"]);
        const OOXML_EXT = /* @__PURE__ */ new Set(["docx", "docm", "dotx", "dotm"]);
        const WORD_TO_DOCX_EXT = /* @__PURE__ */ new Set(["doc", "dot", "rtf", "odt"]);
        const IMAGE_EXT = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);
        const IMAGE_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
        const SHEET_EXT = /* @__PURE__ */ new Set(["xlsx", "xlsm", "xls", "xlsb", "ods"]);
        const SHEET_TO_XLSX_EXT = /* @__PURE__ */ new Set(["xlsm", "xls", "xlsb", "ods"]);
        const CRAFT_OF = { docx: "wordcraft", sheet: "gridcraft" };
        const ZIP_DOC_EXT = /* @__PURE__ */ new Set([...OOXML_EXT, "odt", "xlsx", "xlsm", "xlsb", "ods", "epub", "zip"]);
        function isTableFile(note) {
          return isPlainTextFile5(note) && ["csv", "tsv"].includes(extOf(note.filePath));
        }
        function isOoxmlWordFile(note) {
          return !!(note && note.filePath && note.fileKind === "docx" && OOXML_EXT.has(extOf(note.filePath)));
        }
        function headingTitle(md) {
          const escaped = [];
          let s = String(md || "").replace(/\\([!-/:-@[-`{-~])/g, (_, c) => {
            escaped.push(c);
            return "\0" + (escaped.length - 1) + "";
          });
          s = s.replace(/`([^`]+)`/g, "$1");
          s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
          s = s.replace(/<[^>\n]+>/g, "");
          s = s.replace(/(\*\*|~~)(\S(?:.*?\S)?)\1/g, "$2").replace(/\*(\S(?:.*?\S)?)\*/g, "$1");
          s = s.replace(/(^|\W)(__?)(\S(?:.*?\S)?)\2(?!\w)/g, "$1$3");
          s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
          s = s.replace(/\u0000(\d+)\u0001/g, (_, i) => escaped[Number(i)]);
          return s.replace(/\s+/g, " ").trim();
        }
        function splitAtHeadings(markdown, fallbackName) {
          const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
          const heads = [];
          let fence = null;
          lines.forEach((line, i) => {
            const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            if (f) {
              const ch = f[1][0], len = f[1].length;
              if (!fence) {
                fence = { ch, len };
                return;
              }
              if (ch === fence.ch && len >= fence.len && !f[2].trim()) {
                fence = null;
                return;
              }
            }
            if (fence) return;
            const h = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
            if (!h) return;
            const text = headingTitle(String(h[2] || "").replace(/[ \t]+#+$/, "").replace(/^#+$/, ""));
            heads.push({ i, level: h[1].length, text });
          });
          let name = String(fallbackName || "").trim();
          let usable = heads;
          if (heads.length) {
            const top = Math.min(...heads.map((h) => h.level));
            const atTop = heads.filter((h) => h.level === top);
            const firstText = lines.findIndex((l) => l.trim());
            if (atTop.length === 1 && atTop[0].i === firstText) {
              if (atTop[0].text) name = atTop[0].text;
              usable = heads.filter((h) => h !== atTop[0]);
            }
          }
          const titleLine = usable === heads ? -1 : heads.find((h) => !usable.includes(h)).i;
          if (!usable.length) return { name: name || "Book", level: 0, pages: [] };
          const level = Math.min(...usable.map((h) => h.level));
          const cuts = usable.filter((h) => h.level === level);
          const trimBlank = (arr) => {
            let a = 0, b = arr.length;
            while (a < b && !arr[a].trim()) a++;
            while (b > a && !arr[b - 1].trim()) b--;
            return arr.slice(a, b).join("\n");
          };
          const pages = [];
          const intro = trimBlank(lines.slice(0, cuts[0].i).filter((_, i) => i !== titleLine));
          if (intro) pages.push({ title: "Introduction", body: intro });
          cuts.forEach((c, k) => {
            const end = k + 1 < cuts.length ? cuts[k + 1].i : lines.length;
            pages.push({ title: c.text || "Untitled", body: trimBlank(lines.slice(c.i + 1, end)) });
          });
          return { name: name || "Book", level, pages };
        }
        function imageBaseFor(note) {
          const p = note && note.filePath ? String(note.filePath).replace(/\\/g, "/") : "";
          if (!p || p.startsWith("//")) return null;
          const parts = p.split("/");
          parts.pop();
          return "file:///" + parts.map((s, i) => i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s)).join("/").replace(/^\/+/, "") + "/";
        }
        function fileStamp(date) {
          return new Date(date === void 0 ? Date.now() : date).toISOString().replace(/[:.]/g, "-");
        }
        function fuzzyScore(query, text) {
          const q = String(query || "").toLowerCase().replace(/\s+/g, " ").trim();
          const t = String(text || "").toLowerCase();
          if (!q) return 1;
          if (t.startsWith(q)) return 1e3 - t.length;
          const wordStart = (i) => i === 0 || /[\s\-_/.(#:"'“]/.test(t[i - 1]);
          for (let at = t.indexOf(q); at > 0; at = t.indexOf(q, at + 1)) {
            if (wordStart(at)) return 700 - at - t.length / 10;
          }
          let score = 0, ti = 0, run = 0;
          for (const ch of q) {
            if (ch === " ") {
              run = 0;
              continue;
            }
            let found = -1;
            for (let i = t.indexOf(ch, ti); i >= 0; i = t.indexOf(ch, i + 1)) {
              if (i === ti && ti > 0 && run > 0 || wordStart(i)) {
                found = i;
                break;
              }
            }
            if (found < 0) return 0;
            run = found === ti && run > 0 ? run + 1 : 1;
            score += 10 + (wordStart(found) ? 25 : 0) + run * 8;
            ti = found + 1;
          }
          return Math.max(1, score - t.length / 20);
        }
        return {
          fuzzyScore,
          splitAtHeadings,
          headingTitle,
          extOf,
          isViewerOnlyFile: isViewerOnlyFile8,
          isPlainTextFile: isPlainTextFile5,
          isNonMarkdownFile: isNonMarkdownFile3,
          isTableFile,
          isOoxmlWordFile,
          imageBaseFor,
          fileStamp,
          WORD_EXT,
          OOXML_EXT,
          WORD_TO_DOCX_EXT,
          IMAGE_EXT,
          IMAGE_MIME,
          SHEET_EXT,
          SHEET_TO_XLSX_EXT,
          CRAFT_OF,
          ZIP_DOC_EXT,
          UNTITLED,
          deriveTitle,
          firstLine,
          truncate,
          snippet,
          relativeTime,
          parseTags,
          toggleTaskAt,
          countWords,
          tokenize,
          matchesQuery,
          sortNotes,
          parseAccelerator,
          displayAccelerator,
          noteToMarkdown,
          markdownToNote,
          safeFilename,
          PANE_LIMITS,
          EDITOR_MIN,
          clampPane,
          plainTextFromMarkdown,
          speechChunks,
          formatWhen,
          mailtoFor,
          noteLinkIds
        };
      });
    }
  });

  // src/shared/themes.js
  var require_themes = __commonJS({
    "src/shared/themes.js"(exports, module) {
      "use strict";
      (function(root, factory) {
        if (typeof module === "object" && module.exports) module.exports = factory();
        else root.NotesThemes = factory();
      })(typeof self !== "undefined" ? self : exports, function() {
        const BUILT_IN = "notes";
        const CUSTOM = "custom";
        const SCHEMES = {
          notes: { name: "Notes", builtIn: true },
          paper: { name: "Paper", light: { background: "#fafafa", text: "#1f1f1f", accent: "#3c6fd1" }, dark: { background: "#1c1c1e", text: "#ebebeb", accent: "#7aa2f7" } },
          slate: { name: "Slate", light: { background: "#f3f5f8", text: "#1d2430", accent: "#2f6fd6" }, dark: { background: "#1b2028", text: "#e3e8ef", accent: "#8ab4f8" } },
          forest: { name: "Forest", light: { background: "#f3f6ee", text: "#1f2a1a", accent: "#3f7a3a" }, dark: { background: "#1a2219", text: "#e3ebdc", accent: "#8cc46e" } },
          ocean: { name: "Ocean", light: { background: "#eef5f8", text: "#14262e", accent: "#1c7a9c" }, dark: { background: "#15222a", text: "#dde9ef", accent: "#5fc0dc" } },
          rose: { name: "Rose", light: { background: "#fbf3f4", text: "#2c1a1f", accent: "#c2375a" }, dark: { background: "#241a1e", text: "#f3e6ea", accent: "#e8809a" } },
          sepia: { name: "Sepia", light: { background: "#f4ecd8", text: "#3b2f1e", accent: "#8a5a2b" }, dark: { background: "#2a2318", text: "#ead9bd", accent: "#d19a5a" } }
        };
        const BUILT_IN_SEEDS = { light: { background: "#fffaf3", text: "#2a1a12", accent: "#f47b3e" }, dark: { background: "#211710", text: "#f6eadb", accent: "#f47b3e" } };
        const TOKENS = [
          "chrome",
          "base",
          "paper",
          "raised",
          "fg",
          "fg-2",
          "fg-3",
          "hover",
          "pressed",
          "selected",
          "selected-fg",
          "well",
          "line",
          "line-2",
          "field",
          "field-bg",
          "float-line",
          "float-shadow",
          "scroll-thumb",
          "accent",
          "accent-fg",
          "accent-hover",
          "accent-text",
          "focus",
          "danger",
          "ok",
          "document-bg",
          "syn-keyword",
          "syn-string",
          "syn-atom",
          "syn-comment",
          "syn-punct",
          "cream",
          "peach",
          "tangerine",
          "ember",
          "leaf",
          "ink"
        ];
        const BUILT_IN_WINDOW = { light: { background: "#fffaf3", foreground: "#2a1a12" }, dark: { background: "#211710", foreground: "#f6eadb" } };
        const HEX = /^#[0-9a-f]{6}$/i;
        const isHex = (v) => typeof v === "string" && HEX.test(v);
        const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
        const mix = (a, b, t) => {
          const x = parse(a), y = parse(b);
          return toHex(x.map((v, i) => v + (y[i] - v) * t));
        };
        const rgba = (hex, alpha) => "rgba(" + parse(hex).join(", ") + ", " + alpha + ")";
        const over = (hex, alpha, bg) => mix(bg, hex, alpha);
        function luminance(hex) {
          const [r, g, b] = parse(hex).map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        function contrast(a, b) {
          const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
          return (x + 0.05) / (y + 0.05);
        }
        const worstContrast = (color, surfaces) => Math.min(...surfaces.map((s) => contrast(color, s)));
        function legible(color, surfaces, min, towardDark) {
          const end = towardDark ? "#000000" : "#ffffff";
          for (let t = 0; t <= 1.0001; t += 0.04) {
            const c = mix(color, end, Math.min(1, t));
            if (worstContrast(c, surfaces) >= min) return c;
          }
          return end;
        }
        function readableBackground(bg) {
          const light = luminance(bg) > 0.179;
          const end = light ? "#ffffff" : "#000000", ink = light ? "#000000" : "#ffffff";
          for (let t = 0; t <= 1.0001; t += 0.02) {
            const c = mix(bg, end, Math.min(1, t));
            if (contrast(c, ink) >= 8) return c;
          }
          return end;
        }
        function derive(seed) {
          const bg = readableBackground(seed.background), light = luminance(bg) > 0.179;
          const towardDark = light;
          const paper = bg;
          const base = light ? mix(bg, seed.text, 0.04) : mix(bg, "#000000", 0.22);
          const chrome = light ? mix(bg, seed.text, 0.07) : mix(bg, "#000000", 0.36);
          const raised = light ? mix(bg, "#ffffff", 0.5) : mix(bg, seed.text, 0.1);
          const surfaces = [chrome, base, paper, raised];
          const fg = legible(seed.text, surfaces, 7, towardDark);
          const grounds = surfaces.concat(surfaces.map((s) => over(fg, 0.1, s)));
          const fg2 = legible(mix(fg, bg, 0.25), grounds, 4.5, towardDark);
          const fg3 = legible(mix(fg, bg, 0.38), grounds, 4.5, towardDark);
          const accent = seed.accent;
          const accentText = legible(accent, grounds, 4.5, towardDark);
          const onAccent = [fg, bg].sort((a, b) => contrast(b, accent) - contrast(a, accent))[0];
          const accentFg = legible(onAccent, [accent], 4.5, luminance(accent) > 0.179);
          const selected = light ? mix(bg, accent, 0.28) : over(accent, 0.22, paper);
          const selectedFg = legible(fg, [selected], 4.5, luminance(selected) > 0.179);
          const ok = legible(light ? "#3f6a2c" : "#9ccf80", grounds, 4.5, towardDark);
          return {
            chrome,
            base,
            paper,
            raised,
            fg,
            "fg-2": fg2,
            "fg-3": fg3,
            hover: rgba(fg, 0.06),
            pressed: rgba(fg, 0.1),
            selected,
            "selected-fg": selectedFg,
            well: rgba(fg, light ? 0.05 : 0.06),
            // Lines are darker than the surfaces they sit on, never light (the user's rule); none round floating layers in dark.
            line: light ? rgba(fg, 0.1) : "rgba(0, 0, 0, 0.42)",
            "line-2": light ? rgba(fg, 0.16) : "rgba(0, 0, 0, 0.55)",
            field: light ? rgba(fg, 0.45) : "rgba(0, 0, 0, 0.6)",
            "field-bg": light ? raised : mix(bg, "#000000", 0.35),
            "float-line": light ? rgba(fg, 0.16) : "transparent",
            "float-shadow": light ? "0 0 2px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.14)" : "none",
            // not a colour: the lift under a floating layer, light only
            "scroll-thumb": rgba(fg, light ? 0.2 : 0.16),
            accent,
            "accent-fg": accentFg,
            "accent-hover": mix(accent, "#ffffff", 0.12),
            "accent-text": accentText,
            focus: accentText,
            danger: legible(light ? "#a8340c" : "#ff8a66", grounds, 4.5, towardDark),
            ok,
            "document-bg": light ? mix(bg, fg, 0.1) : mix(bg, "#000000", 0.45),
            "syn-keyword": accentText,
            "syn-string": legible(light ? "#8a5200" : "#e8b860", grounds, 4.5, towardDark),
            "syn-atom": legible(light ? "#3f6a2c" : "#9ccf80", grounds, 4.5, towardDark),
            "syn-comment": fg3,
            "syn-punct": fg2,
            cream: paper,
            peach: selected,
            tangerine: accent,
            ember: accentText,
            leaf: ok,
            ink: fg
          };
        }
        const cleanSeed = (s) => s && typeof s === "object" && isHex(s.background) && isHex(s.text) && isHex(s.accent) ? { background: s.background.toLowerCase(), text: s.text.toLowerCase(), accent: s.accent.toLowerCase() } : null;
        function cleanCustom(input) {
          if (!input || typeof input !== "object") return null;
          const out = {};
          for (const mode of ["light", "dark"]) {
            const s = cleanSeed(input[mode]);
            if (s) out[mode] = s;
          }
          return Object.keys(out).length ? out : null;
        }
        function cleanSchemeId(id, customColors) {
          if (id === CUSTOM) return customColors ? CUSTOM : BUILT_IN;
          return Object.prototype.hasOwnProperty.call(SCHEMES, id) ? id : BUILT_IN;
        }
        function seedFor(settings, mode) {
          const id = settings && settings.colorScheme;
          if (id === CUSTOM) return settings.customColors && settings.customColors[mode] || null;
          const scheme = SCHEMES[id];
          return scheme && !scheme.builtIn ? scheme[mode] || null : null;
        }
        function resolve(settings, mode) {
          const seed = seedFor(settings, mode);
          return seed ? derive(seed) : null;
        }
        function windowColors(settings, mode) {
          const tokens = resolve(settings, mode);
          return tokens ? { background: tokens.paper, foreground: tokens.fg } : BUILT_IN_WINDOW[mode === "dark" ? "dark" : "light"];
        }
        function seedsOf(id, customColors, mode) {
          const m = mode === "dark" ? "dark" : "light";
          if (id === CUSTOM) return customColors && customColors[m] || BUILT_IN_SEEDS[m];
          const scheme = SCHEMES[id];
          return scheme && !scheme.builtIn ? scheme[m] : BUILT_IN_SEEDS[m];
        }
        function swatch(id, customColors, mode) {
          const seed = seedsOf(id, customColors, mode);
          if (id === BUILT_IN || id !== CUSTOM && !(SCHEMES[id] && !SCHEMES[id].builtIn)) return { paper: seed.background, text: seed.text, accent: seed.accent };
          const t = derive(seed);
          return { paper: t.paper, text: t.fg, accent: t.accent };
        }
        return { BUILT_IN, CUSTOM, SCHEMES, TOKENS, BUILT_IN_SEEDS, derive, resolve, windowColors, seedsOf, swatch, cleanCustom, cleanSchemeId, contrast, isHex };
      });
    }
  });

  // src/renderer/icons.js
  var require_icons = __commonJS({
    "src/renderer/icons.js"(exports, module) {
      "use strict";
      (function() {
        const PATHS = {
          "panel-left": '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" />',
          "list": '<path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" />',
          "folder-tree": '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" /><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" /><path d="M3 5a2 2 0 0 0 2 2h3" /><path d="M3 3v13a2 2 0 0 0 2 2h3" />',
          "columns-2": '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 3v18" />',
          "ellipsis": '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
          "search": '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
          "command": '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />',
          "x": '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
          "plus": '<path d="M5 12h14" /><path d="M12 5v14" />',
          "minus": '<path d="M5 12h14" />',
          "chevron-right": '<path d="m9 18 6-6-6-6" />',
          "chevron-left": '<path d="m15 18-6-6 6-6" />',
          "chevron-down": '<path d="m6 9 6 6 6-6" />',
          "arrow-up": '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />',
          "arrow-down": '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />',
          "external-link": '<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
          "square-pen": '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />',
          "folder-open": '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />',
          "notebook-text": '<path d="M2 6h4" /><path d="M2 10h4" /><path d="M2 14h4" /><path d="M2 18h4" /><rect width="16" height="20" x="4" y="2" rx="2" /><path d="M9.5 8h5" /><path d="M9.5 12H16" /><path d="M9.5 16H14" />',
          "star": '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
          "bell": '<path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />',
          "trash-2": '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
          "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
          "folder-plus": '<path d="M12 10v6" /><path d="M9 13h6" /><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />',
          "book-open": '<path d="M12 5v16" /><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />',
          "book-plus": '<path d="M12 7v6" /><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" /><path d="M9 10h6" />',
          "hash": '<line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" /><line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" />',
          "file-text": '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />',
          "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
          "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />',
          "history": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" />',
          "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
          "pin": '<path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />',
          "code-xml": '<path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" />',
          "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.364 18.364a9 9 0 0 0 0-12.728" />',
          "mic": '<path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" />',
          "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
          "lock-open": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />',
          "alarm-clock": '<circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" /><path d="M6.38 18.7 4 21" /><path d="M17.64 18.67 20 21" />',
          "paperclip": '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />',
          "audio-lines": '<path d="M2 10v3" /><path d="M6 6v11" /><path d="M10 3v18" /><path d="M14 8v7" /><path d="M18 5v13" /><path d="M22 10v3" />',
          "printer": '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /><rect x="6" y="14" width="12" height="8" rx="1" />',
          "sticky-note": '<path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" /><path d="M15 3v5a1 1 0 0 0 1 1h5" />',
          "bot": '<path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />',
          "download": '<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />',
          "share-2": '<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" x2="15.42" y1="13.51" y2="17.49" /><line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />',
          "replace": '<path d="M14 4a1 1 0 0 1 1-1" /><path d="M15 10a1 1 0 0 1-1-1" /><path d="M21 4a1 1 0 0 0-1-1" /><path d="M21 9a1 1 0 0 1-1 1" /><path d="m3 7 3 3 3-3" /><path d="M6 10V5a2 2 0 0 1 2-2h2" /><rect x="3" y="14" width="7" height="7" rx="1" />',
          "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
          "file-output": '<path d="M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="m5 11-3 3" /><path d="m5 17-3-3h10" />',
          "terminal": '<path d="M12 19h8" /><path d="m4 17 6-6-6-6" />',
          "radio": '<path d="M16.247 7.761a6 6 0 0 1 0 8.478" /><path d="M19.075 4.933a10 10 0 0 1 0 14.134" /><path d="M4.925 19.067a10 10 0 0 1 0-14.134" /><path d="M7.753 16.239a6 6 0 0 1 0-8.478" /><circle cx="12" cy="12" r="2" />',
          "sun-moon": '<path d="M12 2v2" /><path d="M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715" /><path d="M16 12a4 4 0 0 0-4-4" /><path d="m19 5-1.256 1.256" /><path d="M20 12h2" />',
          "settings": '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
          "check": '<path d="M20 6 9 17l-5-5" />',
          "circle-alert": '<circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />',
          "save": '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />',
          "pin-off": '<path d="M12 17v5" /><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" /><path d="m2 2 20 20" /><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />',
          "book": '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />',
          "mail": '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /><rect x="2" y="4" width="20" height="16" rx="2" />',
          "list-filter": '<path d="M2 5h20" /><path d="M6 12h12" /><path d="M9 19h6" />',
          "arrow-right-left": '<path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" />',
          "eye": '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />',
          "highlighter": '<path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />',
          "type": '<path d="M12 4v16" /><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" /><path d="M9 20h6" />',
          "pencil": '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
          "image": '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
          "signature": '<path d="m21 17-2.156-1.868A.5.5 0 0 0 18 15.5v.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1c0-2.545-3.991-3.97-8.5-4a1 1 0 0 0 0 5c4.153 0 4.745-11.295 5.708-13.5a2.5 2.5 0 1 1 3.31 3.284" /><path d="M3 21h18" />',
          "message-square": '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />',
          "layout-grid": '<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />',
          "undo-2": '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
          "redo-2": '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
          "zoom-in": '<circle cx="11" cy="11" r="8" /><line x1="21" x2="16.65" y1="21" y2="16.65" /><line x1="11" x2="11" y1="8" y2="14" /><line x1="8" x2="14" y1="11" y2="11" />',
          "rotate-cw": '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />',
          "bold": '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />',
          "italic": '<line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" />',
          "underline": '<path d="M6 4v6a6 6 0 0 0 12 0V4" /><line x1="4" x2="20" y1="20" y2="20" />',
          "square-stack": '<path d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" /><path d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2" /><rect width="8" height="8" x="14" y="14" rx="2" />',
          "palette": '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />'
        };
        function svg(name, size) {
          const body = PATHS[name];
          if (!body) throw new Error("Unknown icon: " + name);
          const s = size || 16;
          return '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
        }
        function hydrate(root) {
          (root || document).querySelectorAll("[data-icon]").forEach((el2) => {
            const first = el2.firstElementChild;
            if (first && first.classList.contains("icon") && first.dataset.name === el2.dataset.icon) return;
            if (first && first.classList.contains("icon")) first.remove();
            el2.insertAdjacentHTML("afterbegin", svg(el2.dataset.icon));
            el2.firstElementChild.dataset.name = el2.dataset.icon;
          });
        }
        const api = { svg, hydrate, names: Object.keys(PATHS) };
        if (typeof module === "object" && module.exports) module.exports = api;
        else window.NotesIcons = api;
      })();
    }
  });

  // src/renderer/app.js
  var import_helpers18 = __toESM(require_helpers());
  var import_themes = __toESM(require_themes());
  var import_icons5 = __toESM(require_icons());

  // src/renderer/palette.js
  var import_helpers = __toESM(require_helpers());
  var import_icons = __toESM(require_icons());
  var NotesPalette = /* @__PURE__ */ (function() {
    const I2 = (name) => name ? import_icons.default.svg(name) : "";
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    function marked(text, query) {
      const q = String(query || "").toLowerCase().replace(/\s+/g, "");
      if (!q) return esc(text);
      const lower = text.toLowerCase();
      const whole = lower.indexOf(String(query).toLowerCase().trim());
      if (whole >= 0) {
        const n = String(query).trim().length;
        return esc(text.slice(0, whole)) + "<mark>" + esc(text.slice(whole, whole + n)) + "</mark>" + esc(text.slice(whole + n));
      }
      let out = "", qi = 0;
      for (let i = 0; i < text.length; i++) {
        if (qi < q.length && lower[i] === q[qi]) {
          out += "<mark>" + esc(text[i]) + "</mark>";
          qi++;
        } else out += esc(text[i]);
      }
      return out;
    }
    function create({ dialog, input, list, source }) {
      let items = [];
      let active = 0;
      let ticket = 0;
      let returnFocus = null;
      function render(query) {
        list.innerHTML = "";
        if (!items.length) {
          const li = document.createElement("li");
          li.className = "palette-empty";
          li.textContent = query ? 'Nothing matches "' + query + '".' : "Type to find a note or a command.";
          list.append(li);
          input.removeAttribute("aria-activedescendant");
          return;
        }
        let group = null;
        items.forEach((it, i) => {
          if (it.group !== group) {
            group = it.group;
            const h = document.createElement("li");
            h.className = "palette-group";
            h.setAttribute("role", "presentation");
            h.textContent = group;
            list.append(h);
          }
          const li = document.createElement("li");
          li.className = "palette-item" + (i === active ? " is-active" : "");
          li.id = "palette-opt-" + i;
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", String(i === active));
          li.innerHTML = I2(it.icon || "command") + '<span class="palette-title">' + marked(it.title, query.replace(/^>\s*/, "")) + "</span>" + (it.hint ? '<span class="palette-hint">' + esc(it.hint) + "</span>" : "") + (it.keys ? '<span class="keys">' + esc(it.keys) + "</span>" : "");
          li.addEventListener("mousemove", () => {
            if (active !== i) {
              active = i;
              paint();
            }
          });
          li.addEventListener("click", (e) => choose(i, { newTab: e.ctrlKey || e.metaKey }));
          list.append(li);
        });
        paint();
      }
      function paint() {
        list.querySelectorAll(".palette-item").forEach((li, i) => {
          const on = i === active;
          li.classList.toggle("is-active", on);
          li.setAttribute("aria-selected", String(on));
          if (on) {
            li.scrollIntoView({ block: "nearest" });
            input.setAttribute("aria-activedescendant", li.id);
          }
        });
      }
      async function update() {
        const query = input.value;
        const mine = ++ticket;
        let got;
        try {
          got = await source(query);
        } catch (err) {
          got = [];
          console.error("palette: " + (err && err.message || err));
        }
        if (mine !== ticket) return;
        const order = [];
        for (const it of got || []) if (!order.includes(it.group)) order.push(it.group);
        items = order.flatMap((g) => (got || []).filter((it) => it.group === g));
        active = 0;
        render(query);
      }
      function move(delta) {
        if (!items.length) return;
        active = (active + delta + items.length) % items.length;
        paint();
      }
      function choose(i, opts) {
        const it = items[i];
        if (!it) return;
        close(false);
        setTimeout(() => it.run(opts || {}), 0);
      }
      function open(query) {
        if (dialog.open) {
          input.select();
          return;
        }
        returnFocus = document.activeElement;
        input.value = query || "";
        items = [];
        list.innerHTML = "";
        dialog.showModal();
        input.focus();
        input.select();
        update();
      }
      function close(restore) {
        if (!dialog.open) return;
        dialog.close();
        if (restore !== false && returnFocus && returnFocus.isConnected) returnFocus.focus();
        returnFocus = null;
      }
      input.addEventListener("input", update);
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "PageDown") {
          e.preventDefault();
          move(Math.min(8, items.length - 1 - active) || 0);
        } else if (e.key === "PageUp") {
          e.preventDefault();
          move(-Math.min(8, active));
        } else if (e.key === "Enter") {
          e.preventDefault();
          choose(active, { newTab: e.ctrlKey || e.metaKey });
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "Tab") e.preventDefault();
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
          e.preventDefault();
          close();
        }
      });
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        close();
      });
      dialog.addEventListener("mousedown", (e) => {
        if (e.target === dialog) close();
      });
      return { open, close, isOpen: () => dialog.open };
    }
    function rank(query, commands, notes) {
      const raw = String(query || "");
      const commandsOnly = /^\s*>/.test(raw);
      const q = raw.replace(/^\s*>\s*/, "").trim();
      const scored = (arr, text) => arr.map((x) => ({ x, s: import_helpers.default.fuzzyScore(q, text(x)) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s).map((r) => r.x);
      const cmds = scored(commands, (c) => c.title + (c.keywords ? " " + c.keywords : ""));
      if (commandsOnly || !notes) return cmds;
      if (!q) return notes.slice(0, 6).concat(cmds);
      const byTitle = scored(notes, (n) => n.title);
      const seen = new Set(byTitle.map((n) => n.id));
      const byBody = notes.filter((n) => !seen.has(n.id) && n.matches(q)).slice(0, 6);
      const noteHits = byTitle.slice(0, 8).concat(byBody);
      const strong = cmds.length && import_helpers.default.fuzzyScore(q, cmds[0].title) >= 500;
      return strong ? cmds.slice(0, 10).concat(noteHits) : noteHits.concat(cmds.slice(0, 8));
    }
    return { create, rank };
  })();

  // src/renderer/pdf-editor.js
  var NotesPdfEditor = (function() {
    "use strict";
    const PV = window.PdfView;
    if (!PV) return;
    const lib = PV.pdfjsLib;
    const PKG = new URL("../../node_modules/pdfjs-dist/", document.baseURI).href;
    lib.GlobalWorkerOptions.workerSrc = PKG + "build/pdf.worker.min.mjs";
    const T = lib.AnnotationEditorType;
    const plainFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options) {
      return plainFocus.call(this, options === void 0 && this.closest && this.closest(".pdf-viewport") ? { preventScroll: true } : options);
    };
    const LOAD_OPTIONS = {
      isEvalSupported: false,
      enableXfa: false,
      cMapUrl: PKG + "cmaps/",
      cMapPacked: true,
      standardFontDataUrl: PKG + "standard_fonts/",
      wasmUrl: PKG + "wasm/",
      iccUrl: PKG + "iccs/"
    };
    async function drawPage(d, index, canvas, width) {
      const page = await d.getPage(index + 1);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / ratio) + "px";
      await page.render({ canvas, viewport, annotationMode: lib.AnnotationMode.ENABLE_STORAGE }).promise;
    }
    const MODES = { select: T.NONE, highlight: T.HIGHLIGHT, text: T.FREETEXT, draw: T.INK, picture: T.STAMP };
    const MARKUP = /* @__PURE__ */ new Set([
      "Text",
      "Line",
      "Square",
      "Circle",
      "Polygon",
      "PolyLine",
      "Highlight",
      "Underline",
      "Squiggly",
      "StrikeOut",
      "Stamp",
      "Caret",
      "Ink",
      "FileAttachment",
      "Sound"
    ]);
    function refOf(id) {
      const m = /^(\d+)R(\d*)$/.exec(String(id || ""));
      return m ? [Number(m[1]), Number(m[2] || 0)] : null;
    }
    function create(root, hooks2) {
      const container = root.querySelector(".pdf-viewport");
      const eventBus = new PV.EventBus();
      const linkService = new PV.PDFLinkService({ eventBus });
      const viewer = new PV.PDFViewer({
        container,
        eventBus,
        linkService,
        annotationMode: lib.AnnotationMode.ENABLE_FORMS,
        annotationEditorMode: T.NONE,
        imageResourcesPath: PKG + "web/images/",
        // pdf.js's default palette (its viewer's highlightEditorColors). Without it the highlight tool throws.
        annotationEditorHighlightColors: "yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F,yellow_HCM=#FFFFCC,green_HCM=#53FFBC,blue_HCM=#80EBFF,pink_HCM=#F6B8FF,red_HCM=#C50043"
      });
      linkService.setViewer(viewer);
      let task = null, doc = null, seq = 0, dirty = false, mode = "select", savedHash = "", modeEpoch = 0;
      let touched = false;
      const undo = { canUndo: false, canRedo: false };
      const report = () => hooks2.onState && hooks2.onState({ mode, canUndo: undo.canUndo, canRedo: undo.canRedo, scale: viewer.currentScale || 1 });
      let location2 = null, restore = null;
      eventBus.on("updateviewarea", (e) => {
        location2 = e.location;
      });
      eventBus.on("pagesinit", () => {
        const at = restore;
        restore = null;
        if (!at || !doc) {
          viewer.currentScaleValue = "page-width";
          return;
        }
        viewer.currentScaleValue = typeof at.scale === "number" ? String(at.scale / 100) : at.scale;
        viewer.scrollPageIntoView({ pageNumber: Math.min(at.pageNumber, doc.numPages), destArray: [null, { name: "XYZ" }, at.left, at.top, null], allowNegativeOffset: true });
      });
      eventBus.on("scalechanging", report);
      let fittedWidth = 0;
      new ResizeObserver(() => {
        const w = container.clientWidth;
        if (!w || w === fittedWidth) return;
        fittedWidth = w;
        requestAnimationFrame(() => {
          const v = viewer.currentScaleValue;
          if (doc && (v === "page-width" || v === "page-fit" || v === "auto")) viewer.currentScaleValue = v;
        });
      }).observe(container);
      eventBus.on("annotationlayerrendered", () => {
        if (!touched && doc) {
          savedHash = currentHash();
          refreshDirty();
        }
      });
      eventBus.on("editingstateschanged", ({ details }) => {
        if ("hasSomethingToUndo" in details) undo.canUndo = details.hasSomethingToUndo;
        if ("hasSomethingToRedo" in details) undo.canRedo = details.hasSomethingToRedo;
        refreshDirty();
        report();
      });
      const EDIT_LAYERS = ".annotationLayer, .annotationEditorLayer";
      for (const type of ["pointerdown", "keydown"]) {
        container.addEventListener(type, (e) => {
          if (e.target && e.target.closest && e.target.closest(EDIT_LAYERS)) touched = true;
        }, true);
      }
      for (const type of ["pointerup", "keyup", "input", "change", "focusout"]) container.addEventListener(type, () => setTimeout(refreshDirty, 0));
      container.addEventListener("click", (e) => {
        const a = e.target && e.target.closest && e.target.closest("a[href]");
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (href.startsWith("#")) return;
        e.preventDefault();
        e.stopPropagation();
        if (hooks2.onLink) hooks2.onLink(e, a.href);
      }, true);
      const currentHash = () => doc ? doc.annotationStorage.serializable.hash : "";
      function refreshDirty() {
        const v = !!doc && currentHash() !== savedHash;
        if (dirty === v) return;
        dirty = v;
        if (hooks2.onDirty) hooks2.onDirty(v);
      }
      const others = /* @__PURE__ */ new Set();
      async function openOther(bytes) {
        const own = new Uint8Array(bytes);
        const t = lib.getDocument(Object.assign({ data: own.slice() }, LOAD_OPTIONS));
        others.add(t);
        const d = await t.promise;
        return { pages: d.numPages, draw: (i, canvas, width) => drawPage(d, i, canvas, width), bytes: own };
      }
      function closeOthers() {
        for (const t of others) t.destroy().catch(() => {
        });
        others.clear();
      }
      async function unload() {
        cancelPick();
        closeOthers();
        viewer.setDocument(null);
        linkService.setDocument(null);
        const t = task;
        task = null;
        doc = null;
        savedHash = "";
        refreshDirty();
        undo.canUndo = undo.canRedo = false;
        if (t) await t.destroy().catch(() => {
        });
      }
      async function open(bytes, opts) {
        const my = ++seq;
        const at = opts && opts.keepView ? location2 : null;
        await unload();
        if (my !== seq) return false;
        const t = lib.getDocument(Object.assign({ data: bytes }, LOAD_OPTIONS));
        task = t;
        const d = await t.promise;
        if (my !== seq) return false;
        if (d.numPages < 1) {
          task = null;
          await t.destroy().catch(() => {
          });
          throw new Error("this PDF has no pages.");
        }
        doc = d;
        restore = at;
        location2 = null;
        touched = false;
        savedHash = currentHash();
        doc.annotationStorage.onSetModified = refreshDirty;
        doc.annotationStorage.onResetModified = refreshDirty;
        viewer.setDocument(doc);
        linkService.setDocument(doc, null);
        mode = "select";
        report();
        return true;
      }
      async function close() {
        seq++;
        await unload();
      }
      function setMode(name, internal) {
        if (!doc || !(name in MODES)) return false;
        try {
          viewer.annotationEditorMode = { mode: MODES[name] };
        } catch (_) {
          return false;
        }
        if (!internal) {
          modeEpoch++;
          if (name !== "select") touched = true;
        }
        mode = name;
        report();
        return true;
      }
      function modeSwitched(t) {
        return new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            eventBus.off("annotationeditormodechanged", onChanged);
            resolve();
          };
          const onChanged = (e) => {
            if (e.mode === t) done();
          };
          const timer = setTimeout(done, 1e3);
          eventBus.on("annotationeditormodechanged", onChanged);
        });
      }
      async function commit() {
        if (!doc || mode === "select") return;
        const m = mode, epoch = modeEpoch;
        const left = modeSwitched(T.NONE);
        if (!setMode("select", true)) return;
        await left;
        if (modeEpoch !== epoch || !doc) return;
        const back = modeSwitched(MODES[m]);
        if (setMode(m, true)) await back;
      }
      async function placePicture(file) {
        if (!doc) return false;
        if (mode !== "picture") {
          const switched = modeSwitched(T.STAMP);
          if (!setMode("picture")) return false;
          await switched;
        }
        eventBus.dispatch("switchannotationeditorparams", { source: null, type: lib.AnnotationEditorParamsType.CREATE, value: { bitmapFile: file } });
        return true;
      }
      let picking = null;
      function pickPoint() {
        cancelPick();
        if (!doc) return Promise.resolve(null);
        if (mode !== "select") setMode("select");
        root.classList.add("picking");
        return new Promise((resolve) => {
          const onDown = (e) => {
            const pageEl = e.button === 0 && e.target.closest && e.target.closest(".page[data-page-number]");
            if (!pageEl) return;
            e.preventDefault();
            e.stopPropagation();
            const view = viewer.getPageView(Number(pageEl.dataset.pageNumber) - 1);
            const r = pageEl.getBoundingClientRect();
            const [x, y] = view.viewport.convertToPdfPoint(e.clientX - r.left - pageEl.clientLeft, e.clientY - r.top - pageEl.clientTop);
            const eat = (c) => {
              c.preventDefault();
              c.stopPropagation();
            };
            container.addEventListener("click", eat, true);
            setTimeout(() => container.removeEventListener("click", eat, true), 400);
            finish({ page: view.id - 1, x, y });
          };
          const onKey = (e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(null);
            }
          };
          function finish(value) {
            container.removeEventListener("pointerdown", onDown, true);
            window.removeEventListener("keydown", onKey, true);
            root.classList.remove("picking");
            picking = null;
            resolve(value);
          }
          container.addEventListener("pointerdown", onDown, true);
          window.addEventListener("keydown", onKey, true);
          picking = finish;
        });
      }
      function cancelPick() {
        if (picking) picking(null);
      }
      async function comments() {
        const d = doc, list = [];
        if (!d) return null;
        for (let i = 0; i < d.numPages; i++) {
          const annots = await (await d.getPage(i + 1)).getAnnotations();
          if (d !== doc) return null;
          for (const a of annots) {
            const text = a.contentsObj && a.contentsObj.str || "";
            if (!MARKUP.has(a.subtype) || a.subtype !== "Text" && !text.trim() || a.state) continue;
            list.push({
              id: a.id,
              page: i,
              ref: refOf(a.id),
              kind: a.subtype,
              text,
              author: a.titleObj && a.titleObj.str || "",
              date: lib.PDFDateString.toDateObject(a.modificationDate || a.creationDate || ""),
              rect: a.rect,
              replyTo: a.inReplyTo || null
            });
          }
        }
        return list;
      }
      function goTo(page, rect) {
        if (!doc || page >= doc.numPages) return;
        viewer.scrollPageIntoView({ pageNumber: page + 1, destArray: [null, { name: "XYZ" }, rect[0] - 40, rect[3] + 40, null], allowNegativeOffset: true });
      }
      async function save() {
        if (!doc) return null;
        const hash = currentHash();
        const bytes = await doc.saveDocument();
        return { bytes, hash };
      }
      return {
        open,
        close,
        setMode,
        commit,
        placePicture,
        pickPoint,
        cancelPick,
        comments,
        goTo,
        save,
        pageCount: () => doc ? doc.numPages : 0,
        drawPage: (i, canvas, width) => doc ? drawPage(doc, i, canvas, width) : Promise.resolve(),
        openOther,
        closeOthers,
        // A new PDF from pdf.js: pageInfos as for PDFDocumentProxy.extractPages (document null = this PDF). Only what
        // the kept pages use is written, so a removed page leaves nothing behind in the file.
        extractPages: (pageInfos) => doc.extractPages(pageInfos),
        markSaved(hash) {
          if (doc) {
            savedHash = hash;
            refreshDirty();
          }
        },
        isOpen: () => !!doc,
        isDirty: () => !!doc && currentHash() !== savedHash,
        // Unsaved edits, or a tool in use whose stroke or text is not committed yet.
        hasPendingWork: () => !!doc && (currentHash() !== savedHash || mode !== "select"),
        undo: () => eventBus.dispatch("editingaction", { source: null, name: "undo" }),
        redo: () => eventBus.dispatch("editingaction", { source: null, name: "redo" }),
        zoomIn: () => viewer.increaseScale(),
        zoomOut: () => viewer.decreaseScale(),
        fitWidth: () => {
          viewer.currentScaleValue = "page-width";
        }
      };
    }
    return { create, modes: Object.keys(MODES) };
  })();

  // src/renderer/pdf-pages.js
  var import_icons2 = __toESM(require_icons());
  var NotesPdfPages = (function() {
    "use strict";
    const THUMB_W = 130, THUMB_H = 170;
    function create(panel, ctl, hooks2) {
      const grid = panel.querySelector(".pdf-pages-grid");
      let items = [], sources = /* @__PURE__ */ new Map(), canvases = /* @__PURE__ */ new Map(), added = 0, working = false;
      function open() {
        items = [];
        for (let i = 0; i < ctl.pageCount(); i++) items.push({ src: "self", index: i, turn: 0 });
        sources = /* @__PURE__ */ new Map([["self", { name: "", draw: ctl.drawPage }]]);
        canvases = /* @__PURE__ */ new Map();
        added = 0;
        render();
      }
      function canvasFor(it) {
        const key = it.src + ":" + it.index;
        if (!canvases.has(key)) {
          const c = document.createElement("canvas");
          canvases.set(key, c);
          sources.get(it.src).draw(it.index, c, THUMB_W).then(() => fit(c), () => {
          });
        }
        return canvases.get(key);
      }
      function fit(c) {
        const turn = Number(c.dataset.turn || 0);
        const w = c.offsetWidth || THUMB_W, h = c.offsetHeight || THUMB_H;
        const scale = turn % 180 ? Math.min(1, THUMB_W / h, THUMB_H / w) : 1;
        c.style.transform = "rotate(" + turn + "deg) scale(" + scale + ")";
      }
      function button(act2, k, icon, title) {
        const b = document.createElement("button");
        b.className = "tool-btn icon-only";
        b.dataset.act = act2;
        b.dataset.k = k;
        b.innerHTML = import_icons2.default.svg(icon);
        b.title = title;
        b.setAttribute("aria-label", title);
        return b;
      }
      function render() {
        grid.replaceChildren(...items.map((it, k) => {
          const card = document.createElement("figure");
          card.className = "pdf-page-card";
          const box = document.createElement("div");
          box.className = "pdf-page-thumb";
          const c = canvasFor(it);
          c.dataset.turn = it.turn;
          fit(c);
          box.append(c);
          const cap = document.createElement("figcaption");
          cap.className = "pdf-page-num";
          const from = sources.get(it.src).name;
          cap.textContent = k + 1 + (from ? " \xB7 " + from + " p. " + (it.index + 1) : it.index !== k ? " \xB7 was " + (it.index + 1) : "");
          cap.title = cap.textContent;
          const acts = document.createElement("div");
          acts.className = "pdf-page-acts";
          acts.append(
            button("left", k, "chevron-left", "Move earlier"),
            button("turn-left", k, "rotate-ccw", "Turn left"),
            button("turn-right", k, "rotate-cw", "Turn right"),
            button("remove", k, "x", "Remove this page"),
            button("right", k, "chevron-right", "Move later")
          );
          card.append(box, cap, acts);
          return card;
        }));
      }
      function act(name, k) {
        const it = items[k];
        if (!it) return;
        if (name === "left" && k > 0) [items[k - 1], items[k]] = [items[k], items[k - 1]];
        else if (name === "right" && k < items.length - 1) [items[k + 1], items[k]] = [items[k], items[k + 1]];
        else if (name === "turn-left") it.turn = (it.turn + 270) % 360;
        else if (name === "turn-right") it.turn = (it.turn + 90) % 360;
        else if (name === "remove") items.splice(k, 1);
        else return;
        render();
      }
      async function addFromPdf() {
        const picked = await hooks2.pickPdf();
        if (!picked) return;
        let other;
        try {
          other = await ctl.openOther(picked.bytes);
        } catch (err) {
          hooks2.say("Could not read " + picked.name + ": " + (err.message || err));
          return;
        }
        const src2 = "added-" + ++added;
        sources.set(src2, { name: picked.name, draw: other.draw, bytes: other.bytes });
        for (let i = 0; i < other.pages; i++) items.push({ src: src2, index: i, turn: 0 });
        render();
        grid.scrollTop = grid.scrollHeight;
      }
      async function apply() {
        if (working) return;
        if (!items.length) {
          hooks2.say("A PDF needs at least one page. Use Cancel to keep it as it is.");
          return;
        }
        const reordered = items.length !== ctl.pageCount() || items.some((it, k) => it.src !== "self" || it.index !== k);
        const rotations = items.map((it) => it.turn);
        if (!reordered && !rotations.some(Boolean)) {
          hooks2.close();
          return;
        }
        let pageInfos = null;
        if (reordered) {
          const bySrc = /* @__PURE__ */ new Map();
          items.forEach((it, pos) => {
            if (!bySrc.has(it.src)) bySrc.set(it.src, []);
            bySrc.get(it.src).push({ index: it.index, pos });
          });
          pageInfos = [...bySrc].map(([src2, list]) => {
            list.sort((a, b) => a.index - b.index);
            return { document: src2 === "self" ? null : sources.get(src2).bytes, includePages: list.map((e) => e.index), pageIndices: list.map((e) => e.pos) };
          });
        }
        working = true;
        panel.classList.add("is-working");
        try {
          if (await hooks2.apply({ pageInfos, rotations })) hooks2.close();
        } finally {
          working = false;
          panel.classList.remove("is-working");
        }
      }
      grid.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-act]");
        if (b && !working) act(b.dataset.act, Number(b.dataset.k));
      });
      panel.querySelector(".pdf-pages-bar").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-pages-act]");
        if (!b || working) return;
        if (b.dataset.pagesAct === "add") addFromPdf();
        else if (b.dataset.pagesAct === "cancel") hooks2.close();
        else if (b.dataset.pagesAct === "apply") apply();
      });
      return { open };
    }
    return { create };
  })();

  // src/renderer/pdf-comments.js
  var NotesPdfComments = (function() {
    "use strict";
    const KIND_NAMES = {
      Text: "Note",
      Highlight: "Highlight",
      Underline: "Underline",
      Squiggly: "Squiggly underline",
      StrikeOut: "Strikethrough",
      Ink: "Drawing",
      Stamp: "Stamp",
      Square: "Rectangle",
      Circle: "Oval",
      Line: "Line",
      Polygon: "Shape",
      PolyLine: "Lines",
      Caret: "Insertion",
      FileAttachment: "Attachment",
      Sound: "Sound"
    };
    const DATE_FORMAT = new Intl.DateTimeFormat(void 0, { dateStyle: "medium", timeStyle: "short" });
    function create(panel, ctl, hooks2) {
      const listEl = panel.querySelector(".pdf-comments-list");
      const addBtn = panel.querySelector('[data-comments-act="add"]');
      const hint = panel.querySelector(".pdf-comments-hint");
      let list = [], editing = null, draft = null, picking = false, working = false, readSeq = 0;
      function el2(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== void 0) e.textContent = text;
        return e;
      }
      function button(act, text, title) {
        const b = el2("button", "tool-btn", text);
        b.type = "button";
        b.dataset.cAct = act;
        if (title) b.title = title;
        return b;
      }
      function editorCard(value, label) {
        const card = el2("div", "pdf-comment is-editing");
        card.append(el2("div", "pdf-comment-meta", label));
        const box = el2("textarea", "pdf-comment-input");
        box.value = value;
        box.rows = 4;
        box.setAttribute("aria-label", "Comment");
        box.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancelEdit();
          }
        });
        const acts = el2("div", "pdf-comment-acts");
        acts.append(button("cancel", "Cancel"), button("save", "Save", "Save (Ctrl+Enter)"));
        card.append(box, acts);
        return card;
      }
      function commentCard(c, reply) {
        if (editing === c.id) return editorCard(c.text, "Page " + (c.page + 1));
        const card = el2("div", "pdf-comment" + (reply ? " is-reply" : ""));
        card.dataset.id = c.id;
        const meta = [reply ? "Reply" : "Page " + (c.page + 1)];
        if (c.kind !== "Text") meta.push(KIND_NAMES[c.kind] || c.kind);
        if (c.author) meta.push(c.author);
        if (c.date) meta.push(DATE_FORMAT.format(c.date));
        card.append(el2("div", "pdf-comment-meta", meta.join(" \xB7 ")));
        card.append(el2("div", "pdf-comment-text", c.text || "(no text)"));
        const acts = el2("div", "pdf-comment-acts");
        if (c.ref) {
          acts.append(button("edit", "Edit"));
          if (c.kind === "Text") acts.append(button("delete", "Delete"));
        } else acts.title = "This comment is stored in a way Notes cannot change.";
        card.append(acts);
        return card;
      }
      function render() {
        addBtn.textContent = picking ? "Cancel" : "Add comment";
        addBtn.dataset.commentsAct = picking ? "cancel-pick" : "add";
        hint.textContent = picking ? "Click on the page where the comment goes. Esc cancels." : "";
        addBtn.disabled = working || !picking && !!editing;
        const cards = [];
        if (editing === "new") cards.push(editorCard("", "New comment \xB7 page " + (draft.page + 1)));
        const replies = /* @__PURE__ */ new Map();
        for (const c of list) if (c.replyTo) {
          if (!replies.has(c.replyTo)) replies.set(c.replyTo, []);
          replies.get(c.replyTo).push(c);
        }
        const ids = new Set(list.map((c) => c.id));
        const shown = /* @__PURE__ */ new Set();
        const withReplies = (c, reply) => {
          if (shown.has(c.id)) return;
          shown.add(c.id);
          cards.push(commentCard(c, reply));
          for (const r of replies.get(c.id) || []) withReplies(r, true);
        };
        for (const c of list) if (!(c.replyTo && ids.has(c.replyTo))) withReplies(c, false);
        if (!cards.length) cards.push(el2("p", "pdf-comments-empty", "No comments yet. Press Add comment, then click where it goes on the page."));
        listEl.replaceChildren(...cards);
        const box = listEl.querySelector(".pdf-comment-input");
        if (box) box.focus();
      }
      async function refresh() {
        const my = ++readSeq;
        editing = null;
        draft = null;
        listEl.replaceChildren(el2("p", "pdf-comments-empty", "Reading comments\u2026"));
        let read;
        try {
          read = await ctl.comments();
        } catch (err) {
          read = null;
          if (my === readSeq) hooks2.say("Could not read the comments: " + (err.message || err));
        }
        if (my !== readSeq || read === null) return;
        list = read;
        render();
      }
      async function startAdd() {
        picking = true;
        render();
        const at = await ctl.pickPoint();
        picking = false;
        if (at) {
          draft = at;
          editing = "new";
        }
        render();
      }
      function cancelEdit() {
        editing = null;
        draft = null;
        render();
      }
      async function run(ops) {
        working = true;
        panel.classList.add("is-working");
        try {
          return await hooks2.change(ops);
        } finally {
          working = false;
          panel.classList.remove("is-working");
        }
      }
      async function save() {
        if (working) return;
        const box = listEl.querySelector(".pdf-comment-input");
        const text = box ? box.value.trim() : "";
        if (!text) {
          hooks2.say("Write the comment first, or press Cancel.");
          return;
        }
        let op;
        if (editing === "new") op = { op: "add", page: draft.page, x: draft.x, y: draft.y, text };
        else {
          const c = list.find((x) => x.id === editing);
          if (!c) {
            cancelEdit();
            return;
          }
          if (text === c.text.trim()) {
            cancelEdit();
            return;
          }
          op = { op: "edit", page: c.page, ref: c.ref, text };
        }
        await run([op]);
      }
      function repliesTo(c) {
        const found = /* @__PURE__ */ new Set([c.id]);
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of list) if (x.page === c.page && x.replyTo && found.has(x.replyTo) && !found.has(x.id)) {
            found.add(x.id);
            grew = true;
          }
        }
        return found.size - 1;
      }
      async function remove(c) {
        const answers = repliesTo(c);
        if (!window.confirm("Delete this comment" + (answers ? " and its " + answers + (answers === 1 ? " reply" : " replies") : "") + "?")) return;
        await run([{ op: "delete", page: c.page, ref: c.ref }]);
      }
      listEl.addEventListener("click", (e) => {
        if (working) return;
        const b = e.target.closest("button[data-c-act]");
        const card = e.target.closest(".pdf-comment");
        const c = card && card.dataset.id ? list.find((x) => x.id === card.dataset.id) : null;
        if (!b) {
          if (c) ctl.goTo(c.page, c.rect);
          return;
        }
        const act = b.dataset.cAct;
        if (act === "save") save();
        else if (act === "cancel") cancelEdit();
        else if (act === "edit" && c && !editing) {
          editing = c.id;
          render();
        } else if (act === "delete" && c && !editing) remove(c);
      });
      addBtn.addEventListener("click", () => {
        if (working) return;
        if (addBtn.dataset.commentsAct === "cancel-pick") ctl.cancelPick();
        else if (!editing) startAdd();
      });
      return {
        refresh,
        // Stops picking a place (the panel is closing, or another PDF is shown).
        stop() {
          ctl.cancelPick();
          editing = null;
          draft = null;
        },
        // A comment is being written: the PDF must not be reloaded under it.
        busy: () => !!editing || working
      };
    }
    return { create };
  })();

  // src/renderer/docx-editor.js
  var NotesDocxEditor = (function() {
    "use strict";
    const DV = window.DocxView;
    if (!DV || !DV.Ooxml || !DV.JSZip) return;
    const X = DV.Ooxml;
    const TAB_SHOWN = "\u2003";
    const BREAK = { ch: X.PAGE_BREAK, fmt: {}, br: false };
    const NOT_TEXT = /* @__PURE__ */ new Set([X.PAGE_BREAK, X.PICTURE]);
    const PIC = "data-notes-picture";
    const REAL_BR = "data-notes-br";
    const ALLOWED = /* @__PURE__ */ new Set([
      "insertText",
      "insertReplacementText",
      "insertCompositionText",
      "insertParagraph",
      "insertLineBreak",
      "deleteContentBackward",
      "deleteContentForward",
      "deleteWordBackward",
      "deleteWordForward",
      "deleteSoftLineBackward",
      "deleteSoftLineForward",
      "deleteHardLineBackward",
      "deleteHardLineForward",
      "deleteByCut",
      "deleteContent",
      "formatBold",
      "formatItalic",
      "formatUnderline"
    ]);
    function create(hooks2) {
      let doc = null, xml = "", scan = null, baselines = /* @__PURE__ */ new Map(), dirty = false, edits = 0, seq = 0;
      let gen = 0;
      const SRC = "data-notes-src";
      const REST = "data-notes-rest";
      const map = {
        get(p) {
          const v = p.getAttribute(SRC);
          const m = v && /^(\d+):(\d+)$/.exec(v);
          return m && Number(m[1]) === gen ? Number(m[2]) : void 0;
        },
        has(p) {
          return map.get(p) !== void 0;
        },
        set(p, index) {
          p.setAttribute(SRC, gen + ":" + index);
        }
      };
      let saving = null;
      let styleCache = /* @__PURE__ */ new WeakMap();
      function setDirty(v) {
        if (dirty === v) return;
        dirty = v;
        if (hooks2.onDirty) hooks2.onDirty(v);
      }
      function fmtOf(el2) {
        if (styleCache.has(el2)) return styleCache.get(el2);
        const win = el2.ownerDocument.defaultView;
        const cs = win.getComputedStyle(el2);
        let u = false;
        for (let e = el2; e && !u; e = e.parentElement) {
          u = /underline/.test(win.getComputedStyle(e).textDecorationLine);
          if (e.tagName === "P") break;
        }
        const f = { b: parseInt(cs.fontWeight, 10) >= 600, i: /italic|oblique/.test(cs.fontStyle), u };
        styleCache.set(el2, f);
        return f;
      }
      function charsOf(p) {
        const out = [];
        styleCache = /* @__PURE__ */ new WeakMap();
        const walk = (node) => {
          for (let n = node.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3) {
              const fmt = fmtOf(n.parentElement);
              for (let k = 0; k < n.data.length; k++) if (!NOT_TEXT.has(n.data[k])) out.push({ ch: n.data[k] === TAB_SHOWN ? "	" : n.data[k], fmt, br: false });
            } else if (n.nodeType === 1) {
              if (n.tagName === "BR") out.push({ ch: "\n", fmt: fmtOf(n.parentElement), br: true, real: n.hasAttribute(REAL_BR) });
              else if (n.tagName === "DIV") out.push({ ch: X.PICTURE, fmt: fmtOf(n.parentElement), br: false, picture: n.getAttribute(PIC) });
              else walk(n);
            }
          }
        };
        walk(p);
        if (out.length && out[out.length - 1].br) out.pop();
        for (let k = out.length - 2; k >= 0; k--) if (out[k].br && !out[k].real && out[k + 1].ch === X.PICTURE) out.splice(k, 1);
        return out;
      }
      const textOf = (chars) => chars.map((c) => c.ch).join("");
      const baselineOf = (chars, empty) => ({ chars: chars.map((c) => c.fmt), pictures: chars.map((c) => c.picture || null), empty });
      let pictureSeq = 0;
      function namePictures(p) {
        for (const d of p.querySelectorAll("div")) {
          if (d.parentElement.closest("div, p") !== p || d.hasAttribute(PIC)) continue;
          d.setAttribute(PIC, String(++pictureSeq));
          d.contentEditable = "false";
        }
      }
      function shownByPage() {
        return [...doc.querySelectorAll('article[contenteditable="true"]')].map((art) => ({
          art,
          list: [...art.querySelectorAll("p")].filter((p) => !p.closest('[contenteditable="false"]'))
        }));
      }
      const shownParagraphs = () => shownByPage().flatMap((pg) => pg.list);
      function sources(list) {
        const out = /* @__PURE__ */ new Map();
        let last = null;
        for (const p of list) {
          if (map.has(p)) last = map.get(p);
          if (last !== null) out.set(p, last);
        }
        const firstKnown = list.find((p) => map.has(p));
        for (const p of list) if (!out.has(p) && firstKnown) out.set(p, map.get(firstKnown));
        return out;
      }
      async function open(frameDoc, bytes) {
        const my = ++seq;
        reset();
        const zip = await DV.JSZip.loadAsync(bytes);
        const part = zip.file("word/document.xml");
        let block = null, display = bytes, nextScan = null, nextXml = "";
        if (!part) block = "it has no main document part";
        else {
          nextXml = await part.async("string");
          const settings = zip.file("word/settings.xml");
          block = X.settingsBlock(settings ? await settings.async("string") : "");
          if (!block) {
            try {
              nextScan = X.scanDocument(nextXml);
            } catch (err) {
              block = err.message;
            }
            if (nextScan && !nextScan.prefix) block = "it is not a standard Word document";
          }
          if (!block && nextScan.paragraphs.some((p) => p.editable)) {
            zip.file("word/document.xml", X.markForDisplay(nextXml, nextScan));
            display = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
          }
        }
        if (my !== seq) return null;
        await DV.renderAsync(display, frameDoc.body, frameDoc.body, { useBase64URL: true, renderAltChunks: false });
        if (my !== seq) return null;
        doc = frameDoc;
        xml = nextXml;
        scan = block ? null : nextScan;
        const counts = scan ? attach() : { editable: 0, readOnly: 0 };
        if (scan && !counts.editable) scan = null;
        return Object.assign(counts, { block });
      }
      function attach() {
        let editable = 0;
        const pages = [...doc.querySelectorAll("section.docx > article")];
        const take = (id) => {
          const mark = doc.getElementById(id);
          const p = mark && mark.closest("p");
          if (mark) mark.remove();
          return p;
        };
        for (const para of scan.paragraphs) {
          if (!para.editable) continue;
          const p = take(X.MARK + para.index);
          const rest = para.pageBreaks.length ? take(X.BREAK_MARK + para.index) : null;
          for (const el2 of [p, rest]) {
            if (!el2) continue;
            namePictures(el2);
            for (const br of el2.querySelectorAll("br")) br.setAttribute(REAL_BR, "");
          }
          const shown = p && !map.has(p) && shownAs(para, p, rest, pages);
          if (!shown || textOf(shown.chars) !== para.text) continue;
          map.set(p, para.index);
          if (rest) {
            map.set(rest, para.index);
            rest.setAttribute(REST, "");
          }
          if (shown.mark) shown.mark();
          baselines.set(para.index, baselineOf(shown.chars, fmtOf(p)));
          editable++;
        }
        X.limitTo(scan, (i) => baselines.has(i));
        const readOnly = scan.paragraphs.length - editable;
        if (!editable) return { editable, readOnly };
        const holders = /* @__PURE__ */ new Set();
        for (const art of doc.querySelectorAll("section.docx > article")) {
          for (const p of art.querySelectorAll("p")) if (map.has(p)) for (let e = p.parentElement; e && e !== art; e = e.parentElement) holders.add(e);
          fix(art, holders);
          art.contentEditable = "true";
          art.spellcheck = true;
        }
        doc.addEventListener("beforeinput", onBeforeInput, true);
        doc.addEventListener("input", onInput, true);
        doc.addEventListener("paste", onPaste, true);
        doc.addEventListener("drop", (e) => e.preventDefault(), true);
        doc.addEventListener("keydown", onKeydown, true);
        doc.defaultView.addEventListener("blur", () => {
          if (hooks2.onBlur) hooks2.onBlur();
        });
        return { editable, readOnly };
      }
      function shownAs(para, p, rest, pages) {
        if (!para.pageBreaks.length) return { chars: charsOf(p) };
        if (para.pageBreaks.length > 1) return null;
        const page = p.parentElement, k = pages.indexOf(page);
        if (k < 0 || page.lastElementChild !== p) return null;
        if (!rest) return { chars: [...charsOf(p), BREAK], mark: () => {
          page.dataset.notesEnd = "";
        } };
        const next = pages[k + 1];
        if (!next || rest.parentElement !== next || next.firstElementChild !== rest || map.has(rest)) return null;
        return { chars: [...charsOf(p), BREAK, ...charsOf(rest)], mark: () => {
          next.dataset.notesJoin = "";
        } };
      }
      function fix(container, holders) {
        for (const el2 of container.children) {
          if (map.has(el2)) continue;
          if (holders.has(el2)) fix(el2, holders);
          else el2.contentEditable = "false";
        }
      }
      function close() {
        seq++;
        reset();
      }
      function reset() {
        doc = null;
        saving = null;
        xml = "";
        scan = null;
        gen++;
        baselines = /* @__PURE__ */ new Map();
        edits = 0;
        setDirty(false);
      }
      const paraOf = (node) => {
        const el2 = node && (node.nodeType === 1 ? node : node.parentElement);
        const p = el2 && el2.closest("p");
        return p && !p.closest('[contenteditable="false"]') && p.closest('article[contenteditable="true"]') ? p : null;
      };
      function rangeAllowed(range) {
        const a = paraOf(range.startContainer), b = paraOf(range.endContainer);
        if (!a || !b) return false;
        if (a === b) return true;
        const list = shownParagraphs();
        const src2 = sources(list);
        const i = list.indexOf(a), j = list.indexOf(b);
        if (i < 0 || j < 0) return false;
        const chain = scan.paragraphs[src2.get(a)].chain;
        for (let k = Math.min(i, j); k <= Math.max(i, j); k++) {
          if (scan.paragraphs[src2.get(list[k])].chain !== chain) return false;
          if (k > Math.min(i, j)) {
            const between = doc.createRange();
            between.setStartAfter(list[k - 1]);
            between.setEndBefore(list[k]);
            const frag = between.cloneContents();
            if (frag.querySelector && frag.querySelector('[contenteditable="false"]')) return false;
          }
        }
        return true;
      }
      function selectionAllowed() {
        const sel = doc && doc.getSelection();
        if (!sel || !sel.rangeCount) return false;
        for (let k = 0; k < sel.rangeCount; k++) if (!rangeAllowed(sel.getRangeAt(k))) return false;
        return true;
      }
      function onBeforeInput(e) {
        if (!scan) {
          e.preventDefault();
          return;
        }
        const t = e.inputType;
        if (t === "historyUndo" || t === "historyRedo") return;
        if (!ALLOWED.has(t)) {
          e.preventDefault();
          if (t !== "insertFromPaste") hooks2.say("That kind of change cannot be saved into a Word document here.");
          return;
        }
        const ranges = e.getTargetRanges ? e.getTargetRanges() : [];
        const ok = ranges.length ? ranges.every((r) => rangeAllowed(r)) : selectionAllowed();
        if (!ok) {
          e.preventDefault();
          hooks2.say("That part of the document cannot be changed here (a table, picture, link or similar is in the way).");
        }
      }
      function onInput(e) {
        edits++;
        setDirty(true);
        if (e.inputType === "insertLineBreak") {
          const sel = doc.getSelection();
          const p = sel && sel.rangeCount ? paraOf(sel.anchorNode) : null;
          if (p) {
            const caret = sel.getRangeAt(0);
            const typed = [...p.querySelectorAll("br")].filter((br) => caret.comparePoint(br, 0) <= 0).pop();
            if (typed) typed.setAttribute(REAL_BR, "");
          }
        }
      }
      function onPaste(e) {
        e.preventDefault();
        if (!scan) return;
        const text = e.clipboardData && e.clipboardData.getData("text/plain") || "";
        if (!text) return;
        if (!selectionAllowed()) {
          hooks2.say("That part of the document cannot be changed here.");
          return;
        }
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        lines.forEach((line, k) => {
          if (k) doc.execCommand("insertParagraph");
          if (line) doc.execCommand("insertText", false, line.replace(/\t/g, TAB_SHOWN).replace(/[\f\uFFFC]/g, ""));
        });
      }
      function onKeydown(e) {
        if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          if (selectionAllowed()) doc.execCommand("insertText", false, TAB_SHOWN);
          return;
        }
        if (hooks2.onKey) hooks2.onKey(e);
      }
      function exec(cmd) {
        if (!doc || !scan) return false;
        if (cmd === "undo" || cmd === "redo") return doc.execCommand(cmd);
        if (!selectionAllowed()) {
          hooks2.say("Select text in a paragraph you can edit first.");
          return false;
        }
        return doc.execCommand(cmd);
      }
      const sameChars = (chars, base, text) => chars.length === base.chars.length && X.sameShownText(text, textOf(chars)) && chars.every((c, k) => !c.fmt.b === !base.chars[k].b && !c.fmt.i === !base.chars[k].i && !c.fmt.u === !base.chars[k].u && (c.picture || null) === base.pictures[k]);
      function changes() {
        if (!scan || !dirty) return null;
        const list = shownParagraphs();
        const src2 = sources(list);
        for (const art of doc.querySelectorAll('article[contenteditable="true"]')) {
          for (const n of art.childNodes) if (n.nodeType === 3 && n.data.trim()) throw new Error("some text is outside any paragraph");
        }
        const pieces = [];
        const lost = () => new Error("a page break could not be placed");
        const endWithBreak = (last) => {
          if (last.chars.includes(BREAK)) pieces.push({ els: [], source: last.source, chars: [BREAK] });
          else last.chars.push(BREAK);
        };
        for (const { art, list: here } of shownByPage()) {
          const join = "notesJoin" in art.dataset, end = "notesEnd" in art.dataset;
          if ((join || end) && !here.length) throw lost();
          here.forEach((p, k) => {
            const chars = charsOf(p);
            const prev = pieces[pieces.length - 1];
            if (k === 0 && join && !prev) throw lost();
            if (k === 0 && join && p.hasAttribute(REST) && !prev.chars.includes(BREAK)) {
              prev.chars.push(BREAK, ...chars);
              prev.els.push(p);
              return;
            }
            if (k === 0 && join) endWithBreak(prev);
            pieces.push({ els: [p], source: src2.get(p), chars });
          });
          if (end) endWithBreak(pieces[pieces.length - 1]);
        }
        if (pieces.some((pc) => pc.source === void 0)) throw new Error("a paragraph could not be matched to the file");
        const known = new Set([...baselines.values()].flatMap((b) => b.pictures).filter(Boolean));
        if (pieces.some((pc) => pc.chars.some((c) => c.ch === X.PICTURE && !known.has(c.picture)))) {
          throw new Error("a picture deleted in an earlier save cannot be brought back with Undo");
        }
        const bySource = /* @__PURE__ */ new Map();
        for (const pc of pieces) {
          if (!bySource.has(pc.source)) bySource.set(pc.source, []);
          bySource.get(pc.source).push(pc);
        }
        const spans = /* @__PURE__ */ new Map();
        for (const para of scan.paragraphs) {
          if (!baselines.has(para.index)) continue;
          const pcs = bySource.get(para.index) || [];
          if (pcs.length === 1 && sameChars(pcs[0].chars, baselines.get(para.index), para.text)) continue;
          const sp = spans.get(para.chain);
          spans.set(para.chain, sp ? { first: sp.first, last: para.index } : { first: para.index, last: para.index });
        }
        if (!spans.size) return null;
        const patches = [], plan = [];
        for (const { first, last } of spans.values()) {
          const group = pieces.filter((pc) => pc.source >= first && pc.source <= last);
          const start = scan.paragraphs[first].start, end = scan.paragraphs[last].end;
          const out = X.rewriteParagraphs(xml, scan, first, last, group.map((pc) => ({ source: pc.source, chars: pc.chars })), baselines);
          patches.push({ start, end, old: xml.slice(start, end), xml: out });
          plan.push({ first, last, pieces: group });
        }
        return { patches, plan };
      }
      function save() {
        const c = changes();
        if (!c) {
          if (dirty && !saving) setDirty(false);
          return null;
        }
        saving = { plan: c.plan, patches: c.patches, edits };
        return { patches: c.patches };
      }
      function markSaved() {
        const s = saving;
        saving = null;
        if (!s || !scan) return { ok: false, lost: false };
        try {
          if (rebase(s)) return { ok: true, lost: false };
        } catch (_) {
        }
        return { ok: false, lost: edits !== s.edits };
      }
      function rebase(s) {
        const nextXml = X.applyPatches(xml, s.patches);
        const next = X.scanDocument(nextXml);
        const nextMap = /* @__PURE__ */ new Map(), nextBase = /* @__PURE__ */ new Map();
        const byFirst = new Map(s.plan.map((g) => [g.first, g]));
        let ni = 0;
        for (let i = 0; i < scan.paragraphs.length; ) {
          const g = byFirst.get(i);
          if (g) {
            for (const pc of g.pieces) {
              const para = next.paragraphs[ni];
              if (!para || !para.editable || !X.sameShownText(para.text, textOf(pc.chars))) return false;
              for (const el2 of pc.els) nextMap.set(el2, ni);
              nextBase.set(ni, baselineOf(pc.chars, (baselines.get(pc.source) || {}).empty || {}));
              ni++;
            }
            i = g.last + 1;
            continue;
          }
          if (baselines.has(i)) nextBase.set(ni, baselines.get(i));
          i++;
          ni++;
        }
        if (ni !== next.paragraphs.length) return false;
        const shift = /* @__PURE__ */ new Map();
        let at = 0;
        for (let i = 0; i < scan.paragraphs.length; ) {
          const g = byFirst.get(i);
          if (g) {
            at += g.pieces.length;
            i = g.last + 1;
            continue;
          }
          shift.set(i, at);
          at++;
          i++;
        }
        for (const p of shownParagraphs()) if (map.has(p) && shift.has(map.get(p)) && !nextMap.has(p)) nextMap.set(p, shift.get(map.get(p)));
        X.limitTo(next, (i) => nextBase.has(i));
        xml = nextXml;
        scan = next;
        gen++;
        for (const [p, index] of nextMap) map.set(p, index);
        baselines = nextBase;
        setDirty(edits !== s.edits);
        return true;
      }
      function saveFailed() {
        saving = null;
      }
      return {
        open,
        close,
        exec,
        save,
        markSaved,
        saveFailed,
        isOpen: () => !!doc,
        isEditable: () => !!scan,
        isDirty: () => dirty
      };
    }
    return { create };
  })();

  // src/renderer/craft-frame.js
  var NotesCraftFrame = /* @__PURE__ */ (function() {
    function create({ frame, origin, url, readyMs, theme, darkPage, onSave, onDirty, onOpened, onOpenFailed, onUnavailable }) {
      let ready = false;
      let loaded = false;
      let gaveUp = false;
      let readyTimer = null;
      let queued = null;
      let current = null;
      let dirty = false;
      let unsaved = false;
      let waiters = [];
      let saving = Promise.resolve();
      function post(msg, transfer) {
        if (frame.contentWindow) frame.contentWindow.postMessage(msg, origin, transfer || []);
      }
      window.addEventListener("message", (e) => {
        if (!loaded || e.source !== frame.contentWindow || e.origin !== origin || !e.data || typeof e.data !== "object") return;
        const m = e.data;
        if (gaveUp) return;
        if (m.type === "ready") {
          clearTimeout(readyTimer);
          ready = true;
          if (theme) post({ type: "theme", value: theme });
          if (typeof darkPage === "boolean") post({ type: "page", dark: darkPage });
          if (queued) {
            const q = queued;
            queued = null;
            open(q.name, q.bytes, q.context);
          }
          return;
        }
        if (!current || m.doc !== current.doc) return;
        if (m.type === "opened") {
          if (m.ok) {
            if (onOpened) onOpened();
          } else if (onOpenFailed) onOpenFailed(String(m.error || "the app could not open it"));
        } else if (m.type === "dirty") {
          dirty = !!m.dirty;
          if (onDirty) onDirty(dirty || unsaved);
        } else if (m.type === "save" && m.bytes instanceof Uint8Array && typeof m.name === "string") {
          const editedBefore = dirty || unsaved;
          const doc = current.doc;
          const context = current.context;
          saving = saving.then(() => onSave(m.name, m.bytes, context)).catch(() => ({ ok: false, own: true })).then((res) => {
            if (!current || current.doc !== doc) return;
            if (res.own) {
              unsaved = !res.ok;
              if (onDirty) onDirty(dirty || unsaved);
              const done = waiters;
              waiters = [];
              done.forEach((w) => w(res.ok));
            } else if (editedBefore) {
              unsaved = true;
              if (onDirty) onDirty(true);
            }
          });
        }
      });
      function load() {
        if (loaded) return;
        loaded = true;
        frame.src = url;
        readyTimer = setTimeout(() => {
          if (ready) return;
          gaveUp = true;
          close();
          if (onUnavailable) onUnavailable();
        }, readyMs || 3e4);
      }
      const token = () => window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
      function open(name, bytes, context) {
        load();
        if (gaveUp) return;
        dirty = false;
        unsaved = false;
        waiters.forEach((w) => w(false));
        waiters = [];
        current = { doc: token(), name, context };
        if (!ready) {
          queued = { name, bytes, context };
          return;
        }
        const copy = new Uint8Array(bytes);
        post({ type: "open", doc: current.doc, name, bytes: copy }, [copy.buffer]);
      }
      function requestSave(ms) {
        if (!ready || !current || !(dirty || unsaved)) return Promise.resolve(true);
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            waiters = waiters.filter((w) => w !== finish);
            resolve(false);
          }, ms || 15e3);
          function finish(ok) {
            clearTimeout(timer);
            resolve(ok);
          }
          waiters.push(finish);
          post({ type: "command", doc: current.doc, id: "file.save" });
        });
      }
      function close() {
        waiters.forEach((w) => w(false));
        waiters = [];
        current = null;
        dirty = false;
        unsaved = false;
        queued = null;
      }
      return { open, requestSave, isDirty: () => !!current && ready && (dirty || unsaved), close };
    }
    return { create };
  })();

  // src/renderer/csv-view.js
  var NotesCsv = /* @__PURE__ */ (function() {
    const MAX_ROWS = 2e3;
    const MAX_COLS = 200;
    const MAX_CELLS = 6e4;
    const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/;
    function detectDelimiter(text, ext) {
      if (ext === "tsv") return "	";
      const counts = { ",": 0, ";": 0, "	": 0 };
      let quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') quoted = !quoted;
        else if (!quoted && (c === "\n" || c === "\r")) break;
        else if (!quoted && c in counts) counts[c]++;
      }
      return Object.keys(counts).reduce((best, d) => counts[d] > counts[best] ? d : best, ",");
    }
    function parse(text, delim, limit) {
      const rows = [];
      let row = [], field = "", quoted = false, total = 0, line = 1, rowLine = 1;
      const endRow = () => {
        row.push(field);
        field = "";
        total++;
        if (rows.length < limit) {
          row.line = rowLine;
          rows.push(row);
        }
        row = [];
        rowLine = line;
      };
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "\n") line++;
        if (quoted) {
          if (c === "\r" && text[i + 1] !== "\n") line++;
          if (c !== '"') field += c;
          else if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else quoted = false;
          continue;
        }
        if (c === '"' && field === "") quoted = true;
        else if (c === delim) {
          row.push(field);
          field = "";
        } else if (c === "\r") {
          if (text[i + 1] === "\n") {
            i++;
            line++;
          } else line++;
          endRow();
        } else if (c === "\n") endRow();
        else field += c;
      }
      if (field !== "" || row.length) endRow();
      return { rows, total };
    }
    const note = (text) => Object.assign(document.createElement("p"), { className: "csv-note", textContent: text });
    const cell = (tag, text, className) => {
      const c = document.createElement(tag);
      c.textContent = text;
      if (className) c.className = className;
      if (text.length > 30) c.title = text;
      return c;
    };
    function render(container, text, ext) {
      container.replaceChildren();
      const src2 = String(text || "");
      const { rows, total } = parse(src2, detectDelimiter(src2, ext), MAX_ROWS + 1);
      if (!rows.length || rows.length === 1 && rows[0].length === 1 && rows[0][0] === "") {
        container.append(note("This file is empty. Switch to Text (Ctrl+E) to write in it."));
        return { rows: 0, cols: 0 };
      }
      const widest = rows.reduce((n, r) => Math.max(n, r.length), 0);
      const cols = Math.min(widest, MAX_COLS);
      const shown = rows.slice(1, 1 + Math.max(1, Math.floor(MAX_CELLS / Math.max(cols, 1))));
      const numeric = Array.from({ length: cols }, (_, c) => {
        let filled = 0, nums = 0;
        for (const r of shown) {
          const v = (r[c] || "").trim();
          if (!v) continue;
          filled++;
          if (NUMBER.test(v)) nums++;
        }
        return filled > 0 && nums / filled >= 0.8;
      });
      const table = document.createElement("table");
      table.className = "csv-table";
      const head = document.createElement("tr");
      const corner = cell("th", String(rows[0].line), "rownum");
      head.append(corner);
      for (let c = 0; c < cols; c++) {
        const th = cell("th", rows[0][c] || "", numeric[c] ? "num" : "");
        th.scope = "col";
        head.append(th);
      }
      const thead = document.createElement("thead");
      thead.append(head);
      const tbody = document.createElement("tbody");
      for (const r of shown) {
        const tr = document.createElement("tr");
        const num = cell("th", String(r.line), "rownum");
        num.scope = "row";
        tr.append(num);
        for (let c = 0; c < cols; c++) tr.append(cell("td", r[c] || "", numeric[c] ? "num" : ""));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      container.append(table);
      const rest = [];
      if (total - 1 > shown.length) rest.push("the first " + shown.length.toLocaleString() + " rows of " + (total - 1).toLocaleString());
      if (widest > cols) rest.push("the first " + cols + " columns of " + widest);
      if (rest.length) container.append(note("Showing " + rest.join(", and ") + ". Switch to Text (Ctrl+E) to see and edit all of it."));
      return { rows: total - 1, cols: widest };
    }
    return { detectDelimiter, parse, render };
  })();

  // src/renderer/sign-pad.js
  var NotesSignPad = (function() {
    "use strict";
    const INK = "#1b1f4a";
    const PAD = 6;
    function create(canvas) {
      const ctx = canvas.getContext("2d");
      let drawing = false, last = null, box = null, scale = 1;
      function fit() {
        const r = canvas.getBoundingClientRect();
        scale = window.devicePixelRatio || 1;
        canvas.width = Math.round((r.width || 600) * scale);
        canvas.height = Math.round((r.height || 220) * scale);
        box = null;
      }
      function point(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
      }
      function grow(p) {
        box = box ? { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      }
      function pen() {
        ctx.strokeStyle = INK;
        ctx.fillStyle = INK;
        ctx.lineWidth = 3 * scale;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
      function dot(p) {
        pen();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5 * scale, 0, Math.PI * 2);
        ctx.fill();
        grow(p);
      }
      function line(a, b) {
        pen();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        grow(a);
        grow(b);
      }
      canvas.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drawing = true;
        canvas.setPointerCapture(e.pointerId);
        last = point(e);
        dot(last);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drawing) return;
        const p = point(e);
        line(last, p);
        last = p;
      });
      const stop = () => {
        drawing = false;
        last = null;
      };
      canvas.addEventListener("pointerup", stop);
      canvas.addEventListener("pointercancel", stop);
      function clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        box = null;
      }
      async function load(blob) {
        clear();
        const img = await createImageBitmap(blob);
        const s = Math.min(1, canvas.width / img.width, canvas.height / img.height);
        const w = img.width * s, h = img.height * s, x = (canvas.width - w) / 2, y = (canvas.height - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        img.close();
        box = { x0: x, y0: y, x1: x + w, y1: y + h };
      }
      function writeName(name) {
        clear();
        const text = String(name || "").trim();
        if (!text) return false;
        let size = canvas.height * 0.45;
        ctx.fillStyle = INK;
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        const font = (px) => "italic 500 " + px + "px Fraunces, Georgia, serif";
        ctx.font = font(size);
        while (size > 8 && ctx.measureText(text).width > canvas.width * 0.9) ctx.font = font(size *= 0.9);
        const w = ctx.measureText(text).width;
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        box = { x0: (canvas.width - w) / 2, y0: canvas.height / 2 - size * 0.7, x1: (canvas.width + w) / 2, y1: canvas.height / 2 + size * 0.7 };
        return true;
      }
      function toBlob() {
        if (!box) return Promise.resolve(null);
        const pad = PAD * scale;
        const x0 = Math.max(0, Math.floor(box.x0 - pad)), y0 = Math.max(0, Math.floor(box.y0 - pad));
        const x1 = Math.min(canvas.width, Math.ceil(box.x1 + pad)), y1 = Math.min(canvas.height, Math.ceil(box.y1 + pad));
        const out = document.createElement("canvas");
        out.width = x1 - x0;
        out.height = y1 - y0;
        out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return new Promise((resolve) => out.toBlob(resolve, "image/png"));
      }
      return { fit, clear, load, writeName, toBlob, isEmpty: () => !box };
    }
    return { create };
  })();

  // src/renderer/dom.js
  var import_icons3 = __toESM(require_icons());
  var $ = (sel) => document.querySelector(sel);
  var I = (name) => import_icons3.default.svg(name);
  function setLabel(btn, text) {
    const l = btn.querySelector(".lbl");
    if (l) l.textContent = text;
    else btn.textContent = text;
  }
  function setIcon(btn, name) {
    if (btn.dataset.icon === name) return;
    btn.dataset.icon = name;
    import_icons3.default.hydrate(btn.parentElement);
  }
  function setPressed(btn, on) {
    btn.classList.toggle("is-on", !!on);
    btn.setAttribute("aria-pressed", String(!!on));
  }
  var el = {
    app: $("#app"),
    sidebar: $("#sidebar"),
    newNoteBtn: $("#newNoteBtn"),
    navItems: Array.from(document.querySelectorAll(".nav-item[data-view]")),
    countAll: $("#countAll"),
    countPinned: $("#countPinned"),
    countTrash: $("#countTrash"),
    countReminders: $("#countReminders"),
    remindBtn: $("#remindBtn"),
    remindDialog: $("#remindDialog"),
    remindForm: $("#remindForm"),
    remindInput: $("#remindInput"),
    remindQuick: $("#remindQuick"),
    remindCurrent: $("#remindCurrent"),
    remindClearBtn: $("#remindClearBtn"),
    remindCancelBtn: $("#remindCancelBtn"),
    shareBtn: $("#shareBtn"),
    shareMenu: $("#shareMenu"),
    shareReveal: $("#shareReveal"),
    lockBtn: $("#lockBtn"),
    lockMenu: $("#lockMenu"),
    lockDialog: $("#lockDialog"),
    lockForm: $("#lockForm"),
    lockDialogTitle: $("#lockDialogTitle"),
    lockDialogHint: $("#lockDialogHint"),
    lockPassword: $("#lockPassword"),
    lockPassword2: $("#lockPassword2"),
    lockConfirmRow: $("#lockConfirmRow"),
    lockError: $("#lockError"),
    lockCancelBtn: $("#lockCancelBtn"),
    lockSubmitBtn: $("#lockSubmitBtn"),
    liveRow: $("#liveRow"),
    liveText: $("#liveText"),
    liveLinkBtn: $("#liveLinkBtn"),
    liveStopBtn: $("#liveStopBtn"),
    shareLiveHost: $("#shareLiveHost"),
    shareLiveStop: $("#shareLiveStop"),
    liveDialog: $("#liveDialog"),
    liveForm: $("#liveForm"),
    liveDialogTitle: $("#liveDialogTitle"),
    liveDialogHint: $("#liveDialogHint"),
    liveLinkLabel: $("#liveLinkLabel"),
    liveLinkInput: $("#liveLinkInput"),
    liveError: $("#liveError"),
    liveCopyBtn: $("#liveCopyBtn"),
    liveCancelBtn: $("#liveCancelBtn"),
    liveSubmitBtn: $("#liveSubmitBtn"),
    pageMenu: $("#pageMenu"),
    bookMenu: $("#bookMenu"),
    newBookBtn: $("#newBookBtn"),
    splitBtn: $("#splitBtn"),
    splitDialog: $("#splitDialog"),
    splitForm: $("#splitForm"),
    splitLead: $("#splitLead"),
    splitPages: $("#splitPages"),
    splitName: $("#splitName"),
    splitKeep: $("#splitKeep"),
    splitCancelBtn: $("#splitCancelBtn"),
    bookReader: $("#bookReader"),
    bookReaderTitle: $("#bookReaderTitle"),
    bookReaderToc: $("#bookReaderToc"),
    bookReaderBody: $("#bookReaderBody"),
    bookReaderScroll: $("#bookReaderScroll"),
    bookReaderPdfBtn: $("#bookReaderPdfBtn"),
    bookReaderPrintBtn: $("#bookReaderPrintBtn"),
    bookReaderCloseBtn: $("#bookReaderCloseBtn"),
    bookStrip: $("#bookStrip"),
    bookName: $("#bookName"),
    bookTabs: $("#bookTabs"),
    bookPrevBtn: $("#bookPrevBtn"),
    bookNextBtn: $("#bookNextBtn"),
    bookAddBtn: $("#bookAddBtn"),
    relatedPanel: $("#relatedPanel"),
    relatedOut: $("#relatedOut"),
    relatedIn: $("#relatedIn"),
    relatedTags: $("#relatedTags"),
    folderMenuBook: $("#folderMenuBook"),
    lockScreen: $("#lockScreen"),
    lockScreenPassword: $("#lockScreenPassword"),
    lockScreenBtn: $("#lockScreenBtn"),
    lockScreenError: $("#lockScreenError"),
    tagList: $("#tagList"),
    themeBtn: $("#themeBtn"),
    settingsBtn: $("#settingsBtn"),
    hotkeyHint: $("#hotkeyHint"),
    hotkeyHint2: $("#hotkeyHint2"),
    searchInput: $("#searchInput"),
    sortSelect: $("#sortSelect"),
    listTitle: $("#listTitle"),
    emptyTrashBtn: $("#emptyTrashBtn"),
    noteList: $("#noteList"),
    listEmpty: $("#listEmpty"),
    editorEmpty: $("#editorEmpty"),
    editor: $("#editor"),
    editorPane: $("#editorPane"),
    paneMain: $("#paneMain"),
    tabBar: $("#tabBar"),
    tabList: $("#tabList"),
    tabAddBtn: $("#tabAddBtn"),
    splitViewBtn: $("#splitViewBtn"),
    paneCloseBtn: $("#paneCloseBtn"),
    splitDivider: $("#splitDivider"),
    toggleSidebarBtn: $("#toggleSidebarBtn"),
    toggleListBtn: $("#toggleListBtn"),
    hideListBtn: $("#hideListBtn"),
    pinBtn: $("#pinBtn"),
    sourceBtn: $("#sourceBtn"),
    editorColumn: $("#editorColumn"),
    richEditor: $("#richEditor"),
    linkDialog: $("#linkDialog"),
    linkForm: $("#linkForm"),
    linkInput: $("#linkInput"),
    linkRemoveBtn: $("#linkRemoveBtn"),
    linkCancelBtn: $("#linkCancelBtn"),
    alignSeg: $("#alignSeg"),
    editorWidthInput: $("#editorWidthInput"),
    editorWidthValue: $("#editorWidthValue"),
    editorFullWidthInput: $("#editorFullWidthInput"),
    gitEnabledInput: $("#gitEnabledInput"),
    gitRemoteInput: $("#gitRemoteInput"),
    gitStatus: $("#gitStatus"),
    gitCommitBtn: $("#gitCommitBtn"),
    gitPushBtn: $("#gitPushBtn"),
    exportBtn: $("#exportBtn"),
    duplicateBtn: $("#duplicateBtn"),
    restoreBtn: $("#restoreBtn"),
    deleteBtn: $("#deleteBtn"),
    destroyBtn: $("#destroyBtn"),
    titleInput: $("#titleInput"),
    tagsInput: $("#tagsInput"),
    bodyInput: $("#bodyInput"),
    codeHost: $("#codeHost"),
    csvView: $("#csvView"),
    imageViewer: $("#imageViewer"),
    imageView: $("#imageView"),
    statusWords: $("#statusWords"),
    statusChars: $("#statusChars"),
    statusUpdated: $("#statusUpdated"),
    statusSaved: $("#statusSaved"),
    statusCode: $("#statusCode"),
    settingsDialog: $("#settingsDialog"),
    settingsForm: $("#settingsForm"),
    hotkeyInput: $("#hotkeyInput"),
    hotkeyError: $("#hotkeyError"),
    themeSelect: $("#themeSelect"),
    schemeGrid: $("#schemeGrid"),
    customModeNote: $("#customModeNote"),
    customBgInput: $("#customBgInput"),
    customTextInput: $("#customTextInput"),
    customAccentInput: $("#customAccentInput"),
    schemeResetBtn: $("#schemeResetBtn"),
    settingsDirtyNote: $("#settingsDirtyNote"),
    cancelSettingsBtn: $("#cancelSettingsBtn"),
    saveSettingsBtn: $("#saveSettingsBtn"),
    settingsSaveDialog: $("#settingsSaveDialog"),
    settingsSaveKeepBtn: $("#settingsSaveKeepBtn"),
    settingsSaveDiscardBtn: $("#settingsSaveDiscardBtn"),
    settingsSaveList: $("#settingsSaveList"),
    fontSizeInput: $("#fontSizeInput"),
    fontSizeValue: $("#fontSizeValue"),
    openAtLoginInput: $("#openAtLoginInput"),
    alwaysOnTopInput: $("#alwaysOnTopInput"),
    importBtn: $("#importBtn"),
    exportAllBtn: $("#exportAllBtn"),
    dataFolderBtn: $("#dataFolderBtn"),
    settingsInfo: $("#settingsInfo"),
    toast: $("#toast"),
    sidebarResizer: $("#sidebarResizer"),
    listResizer: $("#listResizer"),
    newFolderBtn: $("#newFolderBtn"),
    folderTree: $("#folderTree"),
    folderSelect: $("#folderSelect"),
    folderMenu: $("#folderMenu"),
    navAll: document.querySelector('.nav-item[data-view="all"]'),
    openFileBtn: $("#openFileBtn"),
    fileRow: $("#fileRow"),
    fileKind: $("#fileKind"),
    filePath: $("#filePath"),
    fileRevealBtn: $("#fileRevealBtn"),
    fileOpenBtn: $("#fileOpenBtn"),
    fileReloadBtn: $("#fileReloadBtn"),
    docxView: $("#docxView"),
    docxEditor: $("#docxEditor"),
    docxSaveBtn: $("#docxSaveBtn"),
    fileConvertBtn: $("#fileConvertBtn"),
    convertMenu: $("#convertMenu"),
    fileBanner: $("#fileBanner"),
    pdfEditor: $("#pdfEditor"),
    pdfSaveBtn: $("#pdfSaveBtn"),
    pdfUndoBtn: $("#pdfUndoBtn"),
    pdfRedoBtn: $("#pdfRedoBtn"),
    pdfZoomLabel: $("#pdfZoom"),
    pdfPages: $("#pdfPages"),
    pdfComments: $("#pdfComments"),
    pdfCommentsBtn: $("#pdfCommentsBtn"),
    pdfCommentsClose: $("#pdfCommentsClose"),
    agentFilesBtn: $("#agentFilesBtn"),
    agentFilesStatus: $("#agentFilesStatus"),
    signDialog: $("#signDialog"),
    signForm: $("#signForm"),
    signPad: $("#signPad"),
    signRemember: $("#signRemember"),
    signClearBtn: $("#signClearBtn"),
    signForgetBtn: $("#signForgetBtn"),
    signCancelBtn: $("#signCancelBtn"),
    signPlaceBtn: $("#signPlaceBtn"),
    signName: $("#signName"),
    signTypeBtn: $("#signTypeBtn"),
    signStatus: $("#signStatus"),
    readAloudBtn: $("#readAloudBtn"),
    dictateBtn: $("#dictateBtn"),
    ttsVoiceSelect: $("#ttsVoiceSelect"),
    ttsRateInput: $("#ttsRateInput"),
    ttsRateValue: $("#ttsRateValue"),
    vaultList: $("#vaultList"),
    vaultAddFolderBtn: $("#vaultAddFolderBtn"),
    vaultCloneBtn: $("#vaultCloneBtn"),
    vaultDialog: $("#vaultDialog"),
    vaultForm: $("#vaultForm"),
    vaultUrlInput: $("#vaultUrlInput"),
    vaultDestInput: $("#vaultDestInput"),
    vaultDestBtn: $("#vaultDestBtn"),
    vaultNameInput: $("#vaultNameInput"),
    vaultError: $("#vaultError"),
    vaultCancelBtn: $("#vaultCancelBtn"),
    vaultCloneSubmitBtn: $("#vaultCloneSubmitBtn"),
    folderMenuSync: $("#folderMenuSync"),
    folderMenuOpen: $("#folderMenuOpen"),
    stickyBtn: $("#stickyBtn"),
    botBtn: $("#botBtn"),
    printBtn: $("#printBtn"),
    findBar: $("#findBar"),
    findInput: $("#findInput"),
    findCount: $("#findCount"),
    findPrevBtn: $("#findPrevBtn"),
    findNextBtn: $("#findNextBtn"),
    findCloseBtn: $("#findCloseBtn"),
    findReplaceToggle: $("#findReplaceToggle"),
    replaceRow: $("#replaceRow"),
    replaceInput: $("#replaceInput"),
    replaceOneBtn: $("#replaceOneBtn"),
    replaceAllBtn: $("#replaceAllBtn"),
    attachBtn: $("#attachBtn"),
    recordBtn: $("#recordBtn"),
    historyBtn: $("#historyBtn"),
    linkNoteSelect: $("#linkNoteSelect"),
    historyDialog: $("#historyDialog"),
    historyList: $("#historyList"),
    historyPreview: $("#historyPreview"),
    historyStatus: $("#historyStatus"),
    historyCloseBtn: $("#historyCloseBtn"),
    historyRestoreBtn: $("#historyRestoreBtn"),
    botPanel: $("#botPanel"),
    botScope: $("#botScope"),
    botAllowEdits: $("#botAllowEdits"),
    botTerminalBtn: $("#botTerminalBtn"),
    botCloseBtn: $("#botCloseBtn"),
    botPrompt: $("#botPrompt"),
    botRunBtn: $("#botRunBtn"),
    botOutput: $("#botOutput"),
    moreBtn: $("#moreBtn"),
    moreMenu: $("#moreMenu"),
    paletteBtn: $("#paletteBtn"),
    palette: $("#palette"),
    paletteInput: $("#paletteInput"),
    paletteList: $("#paletteList"),
    inlineMenu: $("#inlineMenu"),
    wordcraftFrame: $("#wordcraftFrame"),
    gridcraftFrame: $("#gridcraftFrame"),
    sidebarTop: $("#sidebarTop"),
    barToggles: $("#barToggles"),
    sidebarEdge: $("#sidebarEdge"),
    noteTree: $("#noteTree"),
    noteActions: $("#noteActions"),
    tagsFold: $("#tagsFold"),
    listModeSeg: $("#listModeSeg"),
    sidebarFloatInput: $("#sidebarFloatInput"),
    activityBar: $("#activityBar"),
    emptyNewNoteBtn: $("#emptyNewNoteBtn"),
    settingsNav: $("#settingsNav"),
    settingsScroll: $("#settingsScroll"),
    settingsSearch: $("#settingsSearch"),
    settingsEmpty: $("#settingsEmpty")
  };

  // src/renderer/state.js
  var lockedNow = () => !!(state.current && state.current.locked && !state.current.unlocked);
  var state = {
    view: "all",
    // all | pinned | trash | tag | folder
    tag: null,
    folderId: null,
    tree: [],
    folderPath: [],
    menuFolderId: null,
    editingFolder: null,
    // { mode: 'create' | 'rename', id, parentId }
    query: "",
    notes: [],
    currentId: null,
    current: null,
    sourceMode: false,
    // false: rendered editor, true: raw Markdown textarea
    rich: null,
    // rendered editor instance (window.NotesEditor)
    settings: null,
    info: null,
    systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    dirty: false,
    saveTimer: null,
    savingFor: null,
    lastTypedAt: 0,
    liveStatus: {},
    vaultStatus: {}
  };

  // src/renderer/find-state.js
  var find = { open: false, query: "", ranges: [], active: -1, sourceHits: [] };

  // src/renderer/text.js
  var import_helpers2 = __toESM(require_helpers());
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function highlight(text, query) {
    const raw = String(text);
    const tokens = import_helpers2.default.tokenize(query);
    if (!tokens.length) return escapeHtml(raw);
    const re = new RegExp("(" + tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig");
    return raw.split(re).map((part, i) => i % 2 ? '<span class="mark">' + escapeHtml(part) + "</span>" : escapeHtml(part)).join("");
  }
  function ipcErrorText(err) {
    return String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  }

  // src/renderer/toast.js
  var toastTimer = null;
  var toastMs = 0;
  el.toast.addEventListener("mouseenter", () => clearTimeout(toastTimer));
  el.toast.addEventListener("mouseleave", () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, Math.min(toastMs, 3e3));
  });
  function toast(message, action) {
    clearTimeout(toastTimer);
    el.toast.innerHTML = "";
    const text = document.createElement("span");
    text.textContent = message;
    el.toast.append(text);
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.addEventListener("click", () => {
        hideToast();
        action.run();
      });
      el.toast.append(b);
    }
    el.toast.classList.remove("hidden");
    const words = String(message).split(/\s+/).length;
    toastMs = action ? 8e3 : Math.min(8e3, Math.max(3e3, words * 250));
    toastTimer = setTimeout(hideToast, toastMs);
  }
  function hideToast() {
    el.toast.classList.add("hidden");
  }

  // src/renderer/activity.js
  var activities = /* @__PURE__ */ new Map();
  function setActivity(key, a) {
    const had = activities.get(key);
    if (!a) {
      if (had) {
        had.chip.remove();
        activities.delete(key);
      }
      return;
    }
    if (had) {
      had.a = a;
      had.chip.querySelector(".activity-text").textContent = a.text;
      had.chip.title = a.stopLabel;
      return;
    }
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "activity-chip";
    chip.title = a.stopLabel;
    chip.innerHTML = '<span class="activity-dot" aria-hidden="true"></span>' + I(a.icon) + '<span class="activity-text"></span>' + I("x");
    chip.querySelector(".activity-text").textContent = a.text;
    const entry = { chip, a };
    chip.addEventListener("click", () => entry.a.stop());
    activities.set(key, entry);
    el.activityBar.append(chip);
  }

  // src/renderer/tree.js
  var import_icons4 = __toESM(require_icons());
  function bookMark() {
    return '<span class="row-mark book-mark" title="Book: its notes are pages">' + import_icons4.default.svg("book") + "</span>";
  }
  function treeGroup(parentDepth, isHere) {
    const group = document.createElement("div");
    group.className = "tree-children" + (isHere ? " is-here" : "");
    group.setAttribute("role", "group");
    group.style.setProperty("--depth", parentDepth);
    return group;
  }
  function visibleRows(root) {
    return Array.from(root.querySelectorAll(".tree-row")).filter((r) => r.offsetParent);
  }
  function focusRow(root, row) {
    for (const r of root.querySelectorAll('.tree-row[tabindex="0"]')) r.tabIndex = -1;
    row.tabIndex = 0;
    row.focus();
  }
  function treeFocusKey(root) {
    const a = document.activeElement;
    return a && root.contains(a) && a.classList.contains("tree-row") ? a.dataset.key : null;
  }
  function restoreTreeFocus(root, key) {
    const rows = visibleRows(root);
    const target = key && rows.find((r) => r.dataset.key === key) || null;
    if (target) {
      focusRow(root, target);
      return;
    }
    const all = Array.from(root.querySelectorAll(".tree-row"));
    const first = all.find((r) => r.classList.contains("is-active")) || all[0];
    if (first) first.tabIndex = 0;
  }
  function bindTreeKeys(root) {
    root.addEventListener("keydown", (e) => {
      if (e.target.closest("input, select, textarea") || e.altKey || e.ctrlKey || e.metaKey) return;
      const row = e.target.closest(".tree-row");
      if (!row || !root.contains(row) || e.target !== row) return;
      const rows = visibleRows(root);
      const i = rows.indexOf(row);
      const go = (j) => {
        if (rows[j]) {
          e.preventDefault();
          focusRow(root, rows[j]);
        }
      };
      const expanded = row.getAttribute("aria-expanded");
      if (e.key === "ArrowDown") go(i + 1);
      else if (e.key === "ArrowUp") go(i - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(rows.length - 1);
      else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (expanded === "false" && row._toggle) row._toggle(true);
        else if (expanded === "true") go(i + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (expanded === "true" && row._toggle) row._toggle(false);
        else {
          const group = row.parentElement && row.parentElement.closest(".tree-children");
          const parent = group && group.previousElementSibling;
          if (parent && parent.classList.contains("tree-row")) focusRow(root, parent);
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        row.click();
      }
    });
    root.addEventListener("focusin", (e) => {
      const r = e.target.closest(".tree-row");
      if (r) {
        for (const x of root.querySelectorAll('.tree-row[tabindex="0"]')) if (x !== r) x.tabIndex = -1;
        r.tabIndex = 0;
      }
    });
  }

  // src/renderer/popover.js
  function placePopover(menu, anchor, ev) {
    menu.classList.remove("hidden");
    const rect = anchor.getBoundingClientRect();
    menu.style.left = "0px";
    menu.style.top = "0px";
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = ev ? ev.clientX : rect.left > window.innerWidth / 2 ? rect.right - mw : rect.left;
    let y = ev ? ev.clientY : rect.bottom + 4;
    if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight - 8) y = ev ? window.innerHeight - mh - 8 : rect.top - mh - 4;
    menu.style.left = Math.max(8, x) + "px";
    menu.style.top = Math.max(8, y) + "px";
    const first = menu.querySelector("button:not(.hidden):not(:disabled)");
    if (first) first.focus();
  }

  // src/renderer/more-menu.js
  function openMoreMenu() {
    if (!state.current) return;
    placePopover(el.moreMenu, el.moreBtn);
    el.moreBtn.setAttribute("aria-expanded", "true");
  }
  function closeMoreMenu() {
    el.moreMenu.classList.add("hidden");
    el.moreBtn.setAttribute("aria-expanded", "false");
  }
  function bindMenuKeys() {
    document.addEventListener("keydown", (e) => {
      const menu = e.target.closest && e.target.closest('.popover[role="menu"]');
      if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const items = [...menu.querySelectorAll("button")].filter((b) => b.offsetParent && !b.disabled);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }, true);
  }

  // src/renderer/note-html.js
  var import_helpers3 = __toESM(require_helpers());
  function currentHtml() {
    const live = !state.sourceMode && state.rich ? el.richEditor.querySelector(".rich-editor-content") : null;
    if (live) return live.innerHTML;
    return markdownToHtml(el.bodyInput.value, state.current);
  }
  function markdownToHtml(md, note) {
    if (!window.NotesEditor) return "<pre>" + escapeHtml(md) + "</pre>";
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "-99999px";
    document.body.append(host);
    try {
      let ed = null;
      try {
        ed = window.NotesEditor.create(host, { imageBase: () => import_helpers3.default.imageBaseFor(note) });
        ed.setMarkdown(String(md || ""));
        return host.querySelector(".rich-editor-content").innerHTML;
      } finally {
        if (ed) ed.destroy();
      }
    } finally {
      host.remove();
    }
  }

  // src/renderer/books.js
  var import_helpers4 = __toESM(require_helpers());
  var { isNonMarkdownFile } = import_helpers4.default;
  function createBooks({ api, flattenTree, selectNote, selectNoteNow, refresh, flushSave, clearEditor, setView, trashCurrent, syncTitleBar }) {
    const book = { id: null, pages: [], dragId: null, seq: 0 };
    function bookOf(note) {
      if (!note || !note.folderId || note.trashedAt) return null;
      const f = flattenTree(state.tree).find((x) => x.id === note.folderId);
      return f && f.book ? f : null;
    }
    async function renderBookStrip(note) {
      const seq = ++book.seq;
      const b = bookOf(note);
      el.bookStrip.classList.toggle("hidden", !b);
      if (!b) {
        book.id = null;
        book.pages = [];
        return;
      }
      const forNote = note.id;
      const pages = await api.notes.list({ folderId: b.id });
      if (seq !== book.seq || state.currentId !== forNote) return;
      book.id = b.id;
      book.pages = pages;
      el.bookName.textContent = b.name;
      el.bookTabs.innerHTML = "";
      pages.forEach((p, i) => {
        const tab = document.createElement("div");
        tab.tabIndex = 0;
        tab.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            tab.click();
          }
        });
        tab.className = "book-tab" + (p.id === note.id ? " is-active" : "");
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(p.id === note.id));
        tab.dataset.id = p.id;
        tab.draggable = true;
        tab.innerHTML = '<span class="no"></span><span class="t"></span>';
        tab.querySelector(".no").textContent = String(i + 1);
        tab.querySelector(".t").textContent = import_helpers4.default.truncate(import_helpers4.default.deriveTitle(p) || "Untitled", 28);
        tab.title = import_helpers4.default.deriveTitle(p) || "Untitled";
        tab.addEventListener("click", () => {
          if (p.id !== state.currentId) selectNote(p.id);
        });
        tab.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openPageMenu(p.id, tab, e);
        });
        tab.addEventListener("dragstart", (e) => {
          book.dragId = p.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "page");
        });
        tab.addEventListener("dragover", (e) => {
          if (!book.dragId || book.dragId === p.id) return;
          e.preventDefault();
          tab.classList.add("drop-before");
        });
        tab.addEventListener("dragleave", () => tab.classList.remove("drop-before"));
        tab.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          tab.classList.remove("drop-before");
          movePage(book.dragId, p.id);
        });
        tab.addEventListener("dragend", () => {
          book.dragId = null;
        });
        el.bookTabs.append(tab);
      });
      const idx = pages.findIndex((p) => p.id === note.id);
      el.bookPrevBtn.disabled = idx <= 0;
      el.bookNextBtn.disabled = idx === -1 || idx >= pages.length - 1;
      const active = el.bookTabs.querySelector(".is-active");
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    async function movePage(dragId, beforeId) {
      if (!book.id || !dragId || dragId === beforeId) return;
      const ids = book.pages.map((p) => p.id).filter((x) => x !== dragId);
      const at = ids.indexOf(beforeId);
      ids.splice(at === -1 ? ids.length : at, 0, dragId);
      await api.folders.reorderPages(book.id, ids);
      await refresh({ keepEditor: true });
      if (state.current) renderBookStrip(state.current);
    }
    function stepPage(delta) {
      if (!book.id || !state.currentId) return false;
      const idx = book.pages.findIndex((p) => p.id === state.currentId);
      const next = book.pages[idx + delta];
      if (idx === -1 || !next) return false;
      selectNote(next.id);
      return true;
    }
    async function addPage() {
      if (!book.id) return;
      await flushSave();
      let note;
      try {
        note = await api.notes.create({ folderId: book.id, title: "" });
      } catch (err) {
        toast("Could not add a page: " + (err.message || err));
        return;
      }
      await refresh({ keepEditor: true });
      await selectNoteNow(note.id);
      el.titleInput.focus();
    }
    async function toggleBook(folderId, on) {
      try {
        await api.folders.setBook(folderId, on);
      } catch (err) {
        toast("Could not change the folder: " + (err.message || err));
        return;
      }
      await refresh({ keepEditor: true });
      if (state.current) renderBookStrip(state.current);
      toast(on ? "This folder is now a book: its notes are pages you can page through and reorder." : "Back to an ordinary folder.");
    }
    async function openSplitDialog() {
      const note = state.current;
      if (!note || note.trashedAt) return;
      if (note.locked || note.lock) {
        toast("Unlock and remove the lock first: a locked note cannot be split.");
        return;
      }
      if (note.filePath) {
        toast("This note is a file on disk; only notes kept in the app can be split.");
        return;
      }
      await flushSave();
      if (!state.current || state.current.id !== note.id) return;
      const plan = import_helpers4.default.splitAtHeadings(state.current.body, import_helpers4.default.deriveTitle(state.current));
      if (plan.pages.length < 2) {
        toast("Add at least two headings (lines starting with #) to split this note into pages.");
        return;
      }
      state.splitNoteId = note.id;
      el.splitLead.textContent = "This makes a book with " + plan.pages.length + " pages, one per " + (plan.level ? "#".repeat(plan.level) + " heading" : "heading") + ":";
      el.splitPages.innerHTML = "";
      for (const p of plan.pages) {
        const li = document.createElement("li");
        li.textContent = p.title;
        const n = p.body ? p.body.split("\n").length : 0;
        const small = document.createElement("span");
        small.className = "lines";
        small.textContent = n ? n + (n === 1 ? " line" : " lines") : "empty";
        li.append(small);
        el.splitPages.append(li);
      }
      el.splitName.value = plan.name;
      el.splitKeep.checked = false;
      el.splitDialog.showModal();
      el.splitName.focus();
      el.splitName.select();
    }
    async function applySplit() {
      const id = state.splitNoteId;
      state.splitNoteId = null;
      el.splitDialog.close();
      if (!id) return;
      await flushSave();
      let r;
      try {
        r = await api.notes.splitIntoBook(id, { name: el.splitName.value, keepOriginal: el.splitKeep.checked });
      } catch (err) {
        toast("Could not split the note: " + ipcErrorText(err));
        return;
      }
      if (r.originalTrashed && state.currentId === id) clearEditor();
      await setView("folder", r.folder.id, { keepEditor: true });
      await selectNoteNow(r.pageIds[0]);
      toast('Made the book "' + import_helpers4.default.truncate(r.folder.name, 30) + '" with ' + r.pageIds.length + " pages" + (r.originalTrashed ? "; the original note is in the trash." : "."), {
        label: "Undo",
        run: async () => {
          await flushSave();
          try {
            await api.notes.undoSplit(r.folder.id, r.pageIds, r.originalTrashed ? id : null);
          } catch (err) {
            toast("Could not undo the split: " + ipcErrorText(err));
            return;
          }
          const inBook = state.view === "folder" && state.folderId === r.folder.id || r.pageIds.includes(state.currentId);
          if (!inBook) {
            await refresh();
            return;
          }
          clearEditor();
          await setView("all", null, { keepEditor: true });
          await selectNoteNow(id);
        }
      });
    }
    async function placePageAfter(id, afterId) {
      const pages = await api.notes.list({ folderId: book.id });
      const ids = pages.map((p) => p.id).filter((x) => x !== id);
      const at = ids.indexOf(afterId);
      ids.splice(at === -1 ? ids.length : at + 1, 0, id);
      await api.folders.reorderPages(book.id, ids);
    }
    function openPageMenu(id, anchor, ev) {
      closeAllBookMenus();
      state.menuPageId = id;
      state.menuBookId = book.id;
      const idx = book.pages.findIndex((p) => p.id === id);
      el.pageMenu.querySelector('[data-action="move-left"]').disabled = idx <= 0;
      el.pageMenu.querySelector('[data-action="move-right"]').disabled = idx === -1 || idx >= book.pages.length - 1;
      placePopover(el.pageMenu, anchor, ev);
    }
    function openBookMenu() {
      closeAllBookMenus();
      if (!book.id) return;
      placePopover(el.bookMenu, el.bookName, null);
    }
    function closeAllBookMenus() {
      state.menuPageId = null;
      state.menuBookId = null;
      el.pageMenu.classList.add("hidden");
      el.bookMenu.classList.add("hidden");
    }
    async function pageMenuAction(action) {
      const id = state.menuPageId;
      const bookId = state.menuBookId;
      closeAllBookMenus();
      if (!id || !bookId) return;
      await flushSave();
      if (book.id !== bookId) return;
      const idx = book.pages.findIndex((p) => p.id === id);
      const page = book.pages[idx];
      try {
        if (action === "rename") {
          if (id !== state.currentId) await selectNoteNow(id);
          el.titleInput.focus();
          el.titleInput.select();
        } else if (action === "insert-after") {
          const note = await api.notes.create({ folderId: book.id, title: "" });
          await placePageAfter(note.id, id);
          await refresh({ keepEditor: true });
          await selectNoteNow(note.id);
          el.titleInput.focus();
        } else if (action === "duplicate") {
          const copy = await api.notes.duplicate(id);
          await placePageAfter(copy.id, id);
          await refresh({ keepEditor: true });
          await selectNoteNow(copy.id);
          toast("Page duplicated");
        } else if (action === "move-left" || action === "move-right") {
          const ids = book.pages.map((p) => p.id);
          const to = idx + (action === "move-left" ? -1 : 1);
          if (idx === -1 || to < 0 || to >= ids.length) return;
          ids.splice(idx, 1);
          ids.splice(to, 0, id);
          await api.folders.reorderPages(book.id, ids);
          await refresh({ keepEditor: true });
          if (state.current) renderBookStrip(state.current);
        } else if (action === "copy-link") {
          await api.app.copy({ text: "[" + (import_helpers4.default.deriveTitle(page) || "Page") + "](note://" + id + ")" });
          toast("Copied. Paste it into another note to link to this page.");
        } else if (action === "delete") {
          if (id === state.currentId) {
            await trashCurrent();
            return;
          }
          const title = import_helpers4.default.deriveTitle(page) || "Untitled";
          await api.notes.trash(id);
          await refresh({ keepEditor: true });
          if (state.current) renderBookStrip(state.current);
          toast('Moved "' + import_helpers4.default.truncate(title, 30) + '" to trash', { label: "Undo", run: async () => {
            await api.notes.restore(id);
            await refresh({ keepEditor: true });
            if (state.current) renderBookStrip(state.current);
          } });
        }
      } catch (err) {
        toast("Could not change the page: " + (err.message || err));
      }
    }
    async function bookMenuAction(action) {
      closeAllBookMenus();
      if (!book.id) return;
      if (action === "read") openReader();
      else if (action === "export-md") exportBook("md");
      else if (action === "export-html") exportBook("html");
      else if (action === "export-pdf") exportBook("pdf");
      else if (action === "print") exportBook("print");
      else if (action === "rename") renameBookInline();
      else if (action === "unbook") toggleBook(book.id, false);
    }
    function renameBookInline() {
      const folder = flattenTree(state.tree).find((f) => f.id === book.id);
      if (!folder) return;
      const input = document.createElement("input");
      input.className = "book-name-input";
      input.value = folder.name;
      input.setAttribute("aria-label", "Book name");
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const name = input.value.trim();
        input.replaceWith(el.bookName);
        if (save && name && name !== folder.name) {
          try {
            await api.folders.rename(folder.id, name);
          } catch (err) {
            toast("Could not rename the book: " + (err.message || err));
          }
          await refresh({ keepEditor: true });
        }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
      el.bookName.replaceWith(input);
      input.focus();
      input.select();
    }
    async function collectBook(bookId) {
      await flushSave();
      const folder = flattenTree(state.tree).find((f) => f.id === bookId);
      const pages = await api.notes.list({ folderId: bookId });
      const bodies = [];
      for (const p of pages) bodies.push(p.locked && !p.unlocked ? "" : await pageMarkdown(p));
      return {
        name: folder ? folder.name : "Book",
        pages: pages.map((p, i) => {
          const locked = !!(p.locked && !p.unlocked);
          const body = locked ? "" : bodies[i];
          return { id: p.id, no: i + 1, title: import_helpers4.default.deriveTitle(p) || "Untitled", locked, body, html: locked ? "" : markdownToHtml(body, p) };
        })
      };
    }
    async function pageMarkdown(p) {
      if (!isNonMarkdownFile(p)) return String(p.body || "");
      try {
        const r = await api.files.asMarkdown(p.id);
        return r.ok ? r.markdown : "*Could not show this file: " + r.error + "*";
      } catch (err) {
        return "*Could not show this file: " + ipcErrorText(err) + "*";
      }
    }
    function bookMarkdown(b) {
      const toc = b.pages.map((p) => p.no + ". " + p.title).join("\n");
      const parts = b.pages.map((p) => "## " + p.title + "\n\n" + (p.locked ? "_This page is locked._" : p.body.trim()) + "\n");
      return "# " + b.name + "\n\n**Contents**\n\n" + toc + "\n\n" + parts.join("\n");
    }
    function bookHtml(b) {
      const toc = '<nav class="book-toc"><h2>Contents</h2><ol>' + b.pages.map((p) => '<li><a href="#page-' + p.no + '" data-page="' + p.no + '">' + escapeHtml(p.title) + "</a></li>").join("") + "</ol></nav>";
      const pages = b.pages.map((p) => '<section class="book-page" id="page-' + p.no + '"><h2>' + escapeHtml(p.title) + "</h2>" + (p.locked ? '<p class="book-page-locked">This page is locked.</p>' : p.html) + "</section>").join("\n");
      return "<h1>" + escapeHtml(b.name) + "</h1>" + toc + pages;
    }
    async function exportBook(format) {
      const bookId = readerOpen() ? reader.bookId : book.id;
      if (!bookId) return;
      const b = await collectBook(bookId);
      if (!b.pages.length) {
        toast("This book has no pages yet.");
        return;
      }
      const r = await api.book.export(format, { name: b.name, markdown: bookMarkdown(b), html: bookHtml(b) });
      if (r.ok) toast(format === "print" ? "Sent the book to the printer" : "Saved the book to " + r.filePath);
      else if (!r.canceled) toast("Could not export the book: " + r.error);
    }
    const reader = { bookId: null, seq: 0 };
    async function openReader() {
      const bookId = book.id;
      if (!bookId) return;
      const seq = ++reader.seq;
      const b = await collectBook(bookId);
      if (seq !== reader.seq || book.id !== bookId) return;
      reader.bookId = bookId;
      el.bookReaderTitle.textContent = b.name;
      el.bookReaderToc.innerHTML = "<h2>Contents</h2><ol>" + b.pages.map((p) => '<li><a data-page="' + p.no + '">' + escapeHtml(p.title) + "</a></li>").join("") + "</ol>";
      el.bookReaderBody.innerHTML = b.pages.map((p) => '<article class="book-page" id="reader-page-' + p.no + '"><div class="book-page-head"><span class="no">' + p.no + "</span><h2>" + escapeHtml(p.title) + '</h2><button class="tool-btn" data-edit="' + p.id + '">Edit</button></div>' + (p.locked ? '<p class="book-page-locked">This page is locked. Open it to unlock.</p>' : '<div class="rich-editor-content">' + p.html + "</div>") + "</article>").join("");
      el.bookReader.classList.remove("hidden");
      syncTitleBar();
      el.bookReaderScroll.scrollTop = 0;
      el.bookReaderCloseBtn.focus();
    }
    function closeReader() {
      reader.seq++;
      reader.bookId = null;
      el.bookReader.classList.add("hidden");
      el.bookReaderBody.innerHTML = "";
      syncTitleBar();
    }
    function readerOpen() {
      return !el.bookReader.classList.contains("hidden");
    }
    return { book, bookOf, renderBookStrip, stepPage, addPage, toggleBook, openSplitDialog, applySplit, openBookMenu, closeAllBookMenus, pageMenuAction, bookMenuAction, exportBook, reader, openReader, closeReader, readerOpen };
  }

  // src/renderer/related.js
  function createRelated({ api, followLink }) {
    let relatedTimer = null;
    function renderRelatedSoon() {
      clearTimeout(relatedTimer);
      relatedTimer = setTimeout(() => {
        if (state.current) renderRelated(state.current);
      }, 400);
    }
    async function renderRelated(note) {
      if (!note || note.trashedAt) {
        el.relatedPanel.classList.add("hidden");
        return;
      }
      const forNote = note.id;
      let r;
      try {
        r = await api.notes.related(note.id);
      } catch (_) {
        r = null;
      }
      if (state.currentId !== forNote) return;
      if (!r) {
        el.relatedPanel.classList.add("hidden");
        return;
      }
      const fill = (group, items) => {
        const ul = group.querySelector("ul");
        ul.innerHTML = "";
        for (const it of items) {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = (it.locked ? I("lock") : "") + escapeHtml(it.title);
          if (it.sharedTags && it.sharedTags.length) {
            const t = document.createElement("span");
            t.className = "tags";
            t.textContent = it.sharedTags.map((x) => "#" + x).join(" ");
            b.append(t);
          }
          if (it.missing) {
            b.classList.add("is-missing");
            b.disabled = true;
            b.title = "This link points at a note that no longer exists.";
          } else {
            b.title = it.trashed ? "In the trash" : "Open";
            b.addEventListener("click", () => followLink("note://" + it.id));
          }
          li.append(b);
          ul.append(li);
        }
        group.classList.toggle("hidden", !items.length);
      };
      fill(el.relatedOut, r.outgoing);
      fill(el.relatedIn, r.incoming);
      fill(el.relatedTags, r.byTags);
      el.relatedPanel.classList.toggle("hidden", !(r.outgoing.length || r.incoming.length || r.byTags.length));
    }
    return { renderRelated, renderRelatedSoon };
  }

  // src/renderer/reminders.js
  var import_helpers5 = __toESM(require_helpers());

  // src/renderer/remind-times.js
  function toLocalInputValue(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function quickPick(kind) {
    const d = /* @__PURE__ */ new Date();
    d.setSeconds(0, 0);
    if (kind === "1h") {
      d.setTime(d.getTime() + 3600 * 1e3);
      return d.getTime();
    }
    if (kind === "evening") {
      if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      return d.getTime();
    }
    if (kind === "tomorrow") {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }
    if (kind === "monday") {
      const add = (8 - d.getDay()) % 7 || 7;
      d.setDate(d.getDate() + add);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }
    return null;
  }

  // src/renderer/reminders.js
  function createReminders({ api, flushSave, refreshCurrentMeta }) {
    function renderRemindButton(note) {
      const on = !!(note && note.remindAt);
      el.remindBtn.classList.toggle("hidden", !note || !!note.trashedAt);
      el.remindBtn.classList.toggle("is-on", on);
      setLabel(el.remindBtn, on ? "Reminder: " + import_helpers5.default.formatWhen(note.remindAt) : "Remind me\u2026");
      el.remindBtn.title = on ? "Reminder set for " + import_helpers5.default.formatWhen(note.remindAt) + " (Ctrl+Shift+M to change)" : "Remind me about this note (Ctrl+Shift+M)";
    }
    function openRemindDialog() {
      const note = state.current;
      if (!note || note.trashedAt) return;
      const base = note.remindAt || Math.ceil(Date.now() / (3600 * 1e3)) * 3600 * 1e3;
      el.remindInput.value = toLocalInputValue(base);
      el.remindCurrent.textContent = note.remindAt ? "Currently: " + import_helpers5.default.formatWhen(note.remindAt) + (note.remindedAt ? " (went off)" : "") : "No reminder on this note.";
      el.remindClearBtn.classList.toggle("hidden", !note.remindAt);
      el.remindDialog.showModal();
      el.remindInput.focus();
    }
    async function setReminder(at) {
      const note = state.current;
      if (!note) return;
      el.remindDialog.close();
      await flushSave();
      try {
        await api.notes.update(note.id, { remindAt: at });
        await refreshCurrentMeta();
        toast(at ? "Reminder set for " + import_helpers5.default.formatWhen(at) : "Reminder cleared");
      } catch (err) {
        toast("Could not save the reminder: " + (err.message || err));
      }
    }
    return { renderRemindButton, openRemindDialog, setReminder };
  }

  // src/renderer/peer-notice.js
  function withPeerNotice(raw, onWrite) {
    const WRITES = {
      notes: ["create", "update", "togglePin", "duplicate", "splitIntoBook", "undoSplit", "trash", "restore", "destroy", "emptyTrash"],
      folders: ["create", "rename", "setBook", "reorderPages", "move", "delete"],
      lock: ["set", "unlock", "relock", "remove"],
      files: ["link", "refresh", "savePdf", "pdfApplyPages", "pdfRestore", "saveDocx", "saveCraft", "convert", "asMarkdown"],
      attachments: ["pick", "addPaths", "saveRecording"],
      stickies: ["open", "close", "create", "setColor", "setOnTop"],
      live: ["host", "join", "stop"],
      vaults: ["add", "clone", "update", "remove", "sync", "scan", "initRepo"],
      agentFiles: ["link"],
      bot: ["importWorkspace"],
      app: ["importMarkdown"]
    };
    if (!raw) return raw;
    const out = {};
    for (const ns of Object.keys(raw)) {
      const writes = WRITES[ns];
      if (!writes) {
        out[ns] = raw[ns];
        continue;
      }
      out[ns] = Object.assign({}, raw[ns]);
      for (const name of writes) {
        const fn = raw[ns][name];
        if (typeof fn === "function") out[ns][name] = (...args) => {
          const r = fn(...args);
          Promise.resolve(r).then(onWrite, () => {
          });
          return r;
        };
      }
    }
    return out;
  }

  // src/renderer/live-share.js
  function createLiveShare({ api, flushSave, refreshCurrentMeta, setView, selectNoteNow }) {
    function renderLiveRow(note) {
      const live = note && note.live;
      el.liveRow.classList.toggle("hidden", !live);
      if (!live) return;
      const s = state.liveStatus[note.id];
      const peers = s ? s.peers : 0;
      const connected = s ? s.connected : false;
      el.liveRow.classList.toggle("is-off", !connected);
      el.liveText.textContent = live.role === "host" ? "Live: you are sharing this note \xB7 " + peers + (peers === 1 ? " person" : " people") + " connected" + (s && s.localOnly ? " \xB7 no network found, the link only works on this computer" : "") + (s && s.error ? " \xB7 " + s.error : "") : connected ? "Live: following a shared note" + (s && s.pending ? " \xB7 sending your edits\u2026" : "") : "Live: reconnecting to the host\u2026" + (s && s.error ? " (" + s.error + ")" : "") + (s && s.pending ? " \xB7 your edits will be sent when it is back" : "");
    }
    async function startLiveHost() {
      const note = state.current;
      if (!note) return;
      const r = await api.live.host(note.id);
      if (!r.ok) {
        toast("Could not share: " + r.error);
        return;
      }
      await refreshCurrentMeta();
      openLiveDialog("link", r.status.url);
    }
    async function stopLive() {
      const note = state.current;
      if (!note || !note.live) return;
      await flushSave();
      await api.live.stop(note.id);
      delete state.liveStatus[note.id];
      await refreshCurrentMeta();
      toast("Live share ended. The note stays.");
    }
    function openLiveDialog(mode, url) {
      el.liveDialog.dataset.mode = mode;
      const hosting = mode === "link";
      el.liveDialogTitle.textContent = hosting ? "Live share link" : "Join a live share";
      el.liveDialogHint.textContent = hosting ? "Anyone on your local network with this link edits this note with you, live. The link is not encrypted, so use it on networks you trust. Windows may ask once to allow Notes through the firewall; say yes or nobody can connect. Stop sharing from the Share menu when you are done." : "Paste the link the other person shared. You get your own copy of the note that stays in step while the share lasts.";
      el.liveLinkLabel.textContent = hosting ? "Link" : "Link to join";
      el.liveLinkInput.value = hosting ? url : "";
      el.liveLinkInput.readOnly = hosting;
      el.liveCopyBtn.classList.toggle("hidden", !hosting);
      el.liveSubmitBtn.classList.toggle("hidden", hosting);
      el.liveCancelBtn.textContent = hosting ? "Close" : "Cancel";
      el.liveError.textContent = "";
      el.liveDialog.showModal();
      el.liveLinkInput.focus();
      el.liveLinkInput.select();
    }
    async function submitLiveDialog() {
      if (el.liveDialog.dataset.mode !== "join") {
        el.liveDialog.close();
        return;
      }
      const url = el.liveLinkInput.value.trim();
      if (!url) {
        el.liveError.textContent = "Paste a link.";
        return;
      }
      el.liveSubmitBtn.disabled = true;
      el.liveError.textContent = "Connecting\u2026";
      try {
        const r = await api.live.join(url, state.view === "folder" ? state.folderId : null);
        if (!r.ok) {
          el.liveError.textContent = r.error;
          return;
        }
        el.liveDialog.close();
        state.liveStatus[r.noteId] = r.status;
        await setView("all");
        await selectNoteNow(r.noteId);
        toast("Joined. Edits on either side show up here as they happen.");
      } finally {
        el.liveSubmitBtn.disabled = false;
      }
    }
    return { renderLiveRow, startLiveHost, stopLive, openLiveDialog, submitLiveDialog };
  }

  // src/renderer/sharing.js
  var import_helpers6 = __toESM(require_helpers());
  function createSharing({ api, flushSave, closeFind, GUEST, exportOfCurrent, exportCurrent, startLiveHost, openLiveDialog, stopLive }) {
    function syncShareMenu() {
      const n = state.current;
      if (!n) return;
      el.shareReveal.classList.toggle("hidden", !n.filePath);
      el.shareLiveHost.classList.toggle("hidden", !!n.live || !!n.locked || !!n.filePath);
      el.shareLiveStop.classList.toggle("hidden", !n.live);
    }
    function openShareMenu() {
      if (!state.current || state.current.trashedAt) return;
      syncShareMenu();
      placePopover(el.shareMenu, el.shareBtn);
    }
    function closeShareMenu() {
      el.shareMenu.classList.add("hidden");
    }
    async function shareAction(action) {
      closeShareMenu();
      let note = state.current;
      if (!note) return;
      if (note.locked && !note.unlocked) {
        toast("Unlock the note first.");
        return;
      }
      await flushSave();
      if (!state.current || state.current.id !== note.id) return;
      note = state.current;
      const titleLine = note.title ? note.title + "\n\n" : "";
      try {
        if (action === "copy-md") {
          await api.app.copy({ text: import_helpers6.default.noteToMarkdown(note) });
          toast("Copied as Markdown");
        } else if (action === "copy-text") {
          await api.app.copy({ text: titleLine + import_helpers6.default.plainTextFromMarkdown(el.bodyInput.value) });
          toast("Copied as plain text");
        } else if (action === "copy-html") {
          await api.app.copy({ text: import_helpers6.default.noteToMarkdown(note), html: (note.title ? "<h1>" + escapeHtml(note.title) + "</h1>" : "") + currentHtml() });
          toast("Copied as rich text");
        } else if (action === "copy-note-link") {
          await api.app.copy({ text: "[" + (import_helpers6.default.deriveTitle(note) || "Note") + "](note://" + note.id + ")" });
          toast("Copied. Paste it into another note to link here.");
        } else if (action === "email") {
          const r = await api.app.emailNote(note.id);
          toast(r.ok ? r.truncated ? "Opened your mail app. The note was long, so the email holds the first part; attach a PDF for the rest." : "Opened your mail app with the note." : "Could not open mail: " + r.error);
        } else if (action === "pdf") {
          if (find.open) closeFind();
          if (GUEST) {
            const r2 = await api.book.export("pdf", Object.assign(exportOfCurrent(), { dialogTitle: "Save as PDF" }));
            if (r2.ok) toast("Saved PDF to " + r2.filePath);
            else if (!r2.canceled) toast("Could not save PDF: " + r2.error);
            return;
          }
          const chosen = await api.app.pdfPath(note.id);
          if (!chosen.ok) {
            if (!chosen.canceled) toast("Could not save PDF: " + chosen.error);
            return;
          }
          if (state.currentId !== note.id || lockedNow()) {
            toast("The note changed while the dialog was open; nothing was saved.");
            return;
          }
          await flushSave();
          const r = await api.app.writePdf(chosen.filePath);
          if (r.ok) toast("Saved PDF to " + r.filePath);
          else toast("Could not save PDF: " + r.error);
        } else if (action === "html") {
          const r = await api.app.exportHtml(note.id, currentHtml());
          if (r.ok) toast("Saved HTML to " + r.filePath);
          else if (!r.canceled) toast("Could not save HTML: " + r.error);
        } else if (action === "md") {
          await exportCurrent();
        } else if (action === "reveal") {
          await api.files.reveal(note.id);
        } else if (action === "live-host") {
          await startLiveHost();
        } else if (action === "live-join") {
          openLiveDialog("join");
        } else if (action === "live-stop") {
          await stopLive();
        }
      } catch (err) {
        toast("Share failed: " + (err.message || err));
      }
    }
    return { syncShareMenu, openShareMenu, closeShareMenu, shareAction };
  }

  // src/renderer/sticky-button.js
  var import_helpers7 = __toESM(require_helpers());
  var { isViewerOnlyFile, isPlainTextFile } = import_helpers7.default;
  function createStickyButton({ api, flushSave, refreshCurrentMeta }) {
    function renderStickyButton(note) {
      const on = !!(note && note.sticky);
      el.stickyBtn.classList.toggle("is-on", on);
      setLabel(el.stickyBtn, on ? "Take off the desktop" : "Stick to the desktop");
      el.stickyBtn.title = on ? "Remove this note from the desktop (Ctrl+Shift+T)" : "Put this note on the desktop as a sticky (Ctrl+Shift+T)";
      const notMarkdown = isViewerOnlyFile(note) || isPlainTextFile(note);
      el.stickyBtn.disabled = !note || !!note.trashedAt || notMarkdown && !on || !!note.locked;
      el.stickyBtn.title = note && note.locked ? "Locked notes cannot be stickies" : el.stickyBtn.title;
    }
    async function toggleSticky() {
      const note = state.current;
      if (!note || el.stickyBtn.disabled) return;
      await flushSave();
      try {
        if (note.sticky) {
          await api.stickies.close(note.id, { forget: true });
          toast("Removed from the desktop. The note is kept.");
        } else {
          await api.stickies.open(note.id);
          toast("On the desktop. Drag its top bar to move it; its close button removes it, Esc just hides it (tray \u2192 Stickies brings it back).");
        }
      } catch (err) {
        toast("Could not change the sticky: " + (err.message || err));
      }
      await refreshCurrentMeta();
    }
    return { renderStickyButton, toggleSticky };
  }

  // src/renderer/bot-panel.js
  function createBotPanel({ api, flushSave, refresh, applyFreshFileBody }) {
    const bot = { open: false, running: false };
    function toggleBot(force) {
      bot.open = typeof force === "boolean" ? force : !bot.open;
      el.botPanel.classList.toggle("hidden", !bot.open);
      el.botBtn.classList.toggle("is-on", bot.open);
      if (bot.open) {
        describeBotScope();
        el.botPrompt.focus();
      }
    }
    function describeBotScope() {
      const n = state.current;
      let text = "Scope: all plain notes (exported to a workspace folder for the run)";
      if (n && n.vaultId) text = "Scope: this note\u2019s vault folder";
      else if (n && n.filePath) text = "Scope: the folder containing this file";
      el.botScope.textContent = text;
      el.botScope.title = text;
    }
    function botAppend(text, cls) {
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = text;
      el.botOutput.append(span);
      el.botOutput.scrollTop = el.botOutput.scrollHeight;
    }
    async function runBot() {
      if (bot.running) {
        await api.bot.cancel();
        return;
      }
      const prompt = el.botPrompt.value.trim();
      await flushSave();
      el.botOutput.textContent = "";
      if (!prompt) {
        const r = await api.bot.importWorkspace();
        botAppend(r.error ? "Import failed: " + r.error + "\n" : "Pulled in workspace edits. " + importSummary(r) + "\n" + (r.details || []).map((d) => "  " + d).join("\n") + (r.details && r.details.length ? "\n" : ""), r.error ? "bot-err" : "bot-meta");
        await refresh({ keepEditor: true });
        el.botPrompt.focus();
        return;
      }
      const res = await api.bot.run({ prompt, noteId: state.currentId, allowEdits: el.botAllowEdits.checked });
      if (!res.ok) {
        botAppend(res.error + "\n", "bot-err");
        return;
      }
    }
    function onBotEvent(ev) {
      if (ev.type === "start") {
        bot.running = true;
        el.botPanel.classList.add("is-running");
        el.botRunBtn.textContent = "Stop";
        botAppend("Claude Code, on your Claude " + (ev.plan ? ev.plan.charAt(0).toUpperCase() + ev.plan.slice(1) + " " : "") + "subscription (no API credits)\n", "bot-meta");
        botAppend("Working in " + ev.cwd + (ev.focus ? "  (looking at " + ev.focus + ")" : "") + "\n", "bot-meta");
        if (ev.imported && (ev.imported.updated || ev.imported.created || ev.imported.conflicts)) botAppend("Pulled in earlier workspace edits first. " + importSummary(ev.imported) + "\n", "bot-meta");
      } else if (ev.type === "out") {
        botAppend(ev.text);
      } else if (ev.type === "err") {
        botAppend(ev.text, "bot-err");
      } else if (ev.type === "end") {
        bot.running = false;
        el.botPanel.classList.remove("is-running");
        el.botRunBtn.textContent = "Run";
        if (ev.error) botAppend("\n" + ev.error + "\n", "bot-err");
        else {
          const imp = ev.imported;
          const summary = imp && !imp.error ? " " + importSummary(imp) : "";
          botAppend("\nDone" + (ev.code === 0 ? "" : " (exit code " + ev.code + ")") + "." + summary + "\n", "bot-meta");
          if (imp && imp.conflicts) botAppend((imp.details || []).filter((d) => d.startsWith("conflict")).map((d) => "  " + d).join("\n") + "\n", "bot-err");
        }
        refresh({ keepEditor: true }).then(async () => {
          if (state.currentId && !state.dirty) {
            const wanted = state.currentId;
            const fresh = await api.notes.get(wanted);
            if (fresh && fresh.id === state.currentId && !state.dirty && !state.inflight.has(fresh.id) && fresh.body !== el.bodyInput.value) {
              applyFreshFileBody(fresh);
              toast("This note was updated by the bot.");
            }
          }
        });
      } else if (ev.type === "reloaded") {
        refresh({ keepEditor: true });
      }
    }
    function importSummary(imp) {
      return "Notes updated: " + imp.updated + ", created: " + imp.created + (imp.conflicts ? ", conflicts: " + imp.conflicts : "") + (imp.missing ? ", files removed by the agent (notes kept): " + imp.missing : "") + ".";
    }
    async function openBotTerminal() {
      await flushSave();
      const res = await api.bot.openTerminal(state.currentId);
      if (!res.ok) {
        toast("Could not open a terminal: " + res.error);
        return;
      }
      toast("Claude Code opened in a terminal at " + res.cwd + (res.kind === "workspace" ? ". Its edits are pulled in on the next Run, or press Run with an empty prompt." : ""));
    }
    return { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal };
  }

  // src/renderer/code-editor.js
  var import_helpers8 = __toESM(require_helpers());
  var { isPlainTextFile: isPlainTextFile2 } = import_helpers8.default;
  var code = null;
  var codeOn = false;
  var codeFailed = false;
  var hooks = { runFind: () => {
  }, autoGrow: () => {
  }, scrollTextareaToSelection: () => {
  } };
  var src = {
    get value() {
      return el.bodyInput.value;
    },
    set value(text) {
      el.bodyInput.value = text;
      if (codeOn) code.setValue(el.bodyInput.value);
    },
    // Text that came from outside (the file changed on disk, a live or vault update, a lock): shown, not undoable.
    reload(text) {
      el.bodyInput.value = text;
      if (codeOn) code.setValue(el.bodyInput.value, { history: false });
    },
    get readOnly() {
      return el.bodyInput.readOnly;
    },
    get selectionStart() {
      return codeOn ? code.selectionStart : el.bodyInput.selectionStart;
    },
    get selectionEnd() {
      return codeOn ? code.selectionEnd : el.bodyInput.selectionEnd;
    },
    setSelectionRange(from, to) {
      if (codeOn) code.setSelectionRange(from, to);
      else el.bodyInput.setSelectionRange(from, to);
    },
    focus() {
      if (codeOn) code.focus();
      else el.bodyInput.focus();
    },
    hasFocus() {
      return codeOn ? code.hasFocus() : document.activeElement === el.bodyInput;
    },
    // Scrolls a position into view (a find match, a heading).
    reveal(at) {
      if (codeOn) code.reveal(at);
      else hooks.scrollTextareaToSelection(at);
    },
    // The input event goes to the textarea, whose listeners save, count and refresh the find bar.
    dispatchEvent(event) {
      return el.bodyInput.dispatchEvent(event);
    },
    get codeOn() {
      return codeOn;
    },
    // Undo or redo in the code editor when the keyboard is in it; false when it is not.
    undoRedo(cmd) {
      if (!codeOn || !code.contains(document.activeElement)) return false;
      code[cmd === "redo" ? "redo" : "undo"]();
      return true;
    }
  };
  var PROSE_EXT = /* @__PURE__ */ new Set(["txt", "text"]);
  var isProseFile = (note) => isPlainTextFile2(note) && PROSE_EXT.has(import_helpers8.default.extOf(note.filePath));
  function codeEditor() {
    if (!code) {
      code = window.NotesCode.create({
        parent: el.codeHost,
        onChange: (text) => {
          el.bodyInput.value = text;
          el.bodyInput.dispatchEvent(new Event("input", { bubbles: true }));
        },
        onSelection: renderCodePosition,
        // While the find bar is open, Enter steps between matches, as it does in the textarea.
        onEnter: (shift) => {
          if (!find.open) return false;
          hooks.runFind(!shift);
          return true;
        }
      });
    }
    return code;
  }
  function showCode(note, readOnly) {
    codeOn = !!window.NotesCode && !codeFailed && isPlainTextFile2(note) && !isProseFile(note);
    if (codeOn) {
      try {
        codeEditor().load(el.bodyInput.value, { ext: import_helpers8.default.extOf(note.filePath), readOnly, placeholder: "Plain text.", label: import_helpers8.default.deriveTitle(note) });
      } catch (err) {
        console.error("The code editor could not start:", err);
        codeFailed = true;
        codeOn = false;
        toast("The code editor could not start, so this file opens as plain text.");
      }
    }
    if (!codeOn && code) {
      try {
        code.load("", {});
      } catch (_) {
      }
    }
    el.bodyInput.classList.toggle("uses-code", codeOn);
    el.bodyInput.classList.toggle("is-prose", isProseFile(note));
    renderCodePosition();
    hooks.autoGrow();
  }
  function renderCodePosition() {
    const shown = codeOn && state.sourceMode;
    el.statusCode.classList.toggle("hidden", !shown);
    if (!shown) return;
    const at = code.position();
    el.statusCode.textContent = "Ln " + at.line + ", Col " + at.col;
  }
  function createCodeEditor({ runFind, autoGrow: autoGrow2, scrollTextareaToSelection }) {
    hooks = { runFind, autoGrow: autoGrow2, scrollTextareaToSelection };
    return { showCode };
  }

  // src/renderer/editor-view.js
  var import_helpers9 = __toESM(require_helpers());
  var { isViewerOnlyFile: isViewerOnlyFile2, isPlainTextFile: isPlainTextFile3 } = import_helpers9.default;
  function tableShown() {
    return !el.csvView.classList.contains("hidden");
  }
  function focusBody() {
    if (tableShown()) el.csvView.focus();
    else if (state.sourceMode || !state.rich) src.focus();
    else state.rich.focus();
  }
  function inTextField() {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable || el.richEditor.contains(a));
  }
  function bodyHasFocus() {
    return src.hasFocus() || el.richEditor.contains(document.activeElement);
  }
  function autoGrow() {
    const ta = el.bodyInput;
    if (ta.classList.contains("hidden") || ta.classList.contains("uses-code")) return;
    ta.style.height = "auto";
    ta.style.height = Math.max(320, ta.scrollHeight + 2) + "px";
  }
  function createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights }) {
    function createRichEditor() {
      if (!window.NotesEditor) {
        toast("Rendered editor failed to load; showing Markdown source.");
        applyEditorMode(true);
        return;
      }
      state.rich = window.NotesEditor.create(el.richEditor, {
        placeholder: "Start writing. Type / for headings, lists and tables, or [[ to link a note.",
        imageBase: () => import_helpers9.default.imageBaseFor(state.current),
        onTrigger: (t) => showInlineMenu(t),
        onTriggerKey: (e) => inlineMenuKey(e),
        onUpdate: (md) => {
          if (state.sourceMode || !state.currentId || isPlainTextFile3(state.current)) return;
          if (md === el.bodyInput.value) return;
          el.bodyInput.value = md;
          scheduleSave();
          if (find.open) runFind(true, true, true);
        }
      });
      el.richEditor.addEventListener("click", (e) => {
        const a = e.target.closest("a[href]");
        if (a && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          followLink(a.getAttribute("href"));
        }
      });
    }
    const SLASH = [
      { kind: "h1", title: "Heading 1", icon: "type", keys: "# ", words: "title big" },
      { kind: "h2", title: "Heading 2", icon: "type", keys: "## ", words: "subtitle section" },
      { kind: "h3", title: "Heading 3", icon: "type", keys: "### ", words: "small heading" },
      { kind: "text", title: "Text", icon: "file-text", keys: "", words: "paragraph plain normal" },
      { kind: "checklist", title: "Checklist", icon: "check", keys: "- [ ] ", words: "todo task checkbox" },
      { kind: "bullets", title: "Bulleted list", icon: "list", keys: "- ", words: "unordered bullet" },
      { kind: "numbers", title: "Numbered list", icon: "list", keys: "1. ", words: "ordered" },
      { kind: "quote", title: "Quote", icon: "message-square", keys: "> ", words: "blockquote citation" },
      { kind: "code", title: "Code block", icon: "code-xml", keys: "```", words: "snippet pre monospace" },
      { kind: "table", title: "Table", icon: "layout-grid", keys: "", words: "grid rows columns" },
      { kind: "divider", title: "Divider", icon: "minus", keys: "---", words: "rule line separator hr" },
      { kind: "date", title: "Today's date", icon: "bell", keys: "", words: "now day time" },
      { kind: "link", title: "Link to a note", icon: "link", keys: "[[", words: "note reference wiki" }
    ];
    const inline = { trigger: null, items: [], active: 0, dismissedAt: null, notes: null, seq: 0 };
    async function showInlineMenu(t) {
      const seq = ++inline.seq;
      if (!t || state.sourceMode || !state.rich) {
        if (!t) inline.dismissedAt = null;
        hideInlineMenu();
        return;
      }
      if (inline.dismissedAt === t.kind + ":" + t.from) {
        hideInlineMenu();
        return;
      }
      let items;
      if (t.kind === "slash") {
        items = SLASH.map((b) => ({ b, s: import_helpers9.default.fuzzyScore(t.query, b.title + " " + b.words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => Object.assign({ id: x.b.kind }, x.b));
        if (!t.query) items = SLASH.map((b) => Object.assign({ id: b.kind }, b));
      } else {
        if (!inline.notes || !inline.trigger || inline.trigger.kind !== "link") inline.notes = await api.notes.list({ sort: "updated" });
        if (seq !== inline.seq) return;
        const q = t.query.trim();
        const notes = inline.notes.filter((n) => n.id !== state.currentId && !n.trashedAt);
        const scored = q ? notes.map((n) => ({ n, s: import_helpers9.default.fuzzyScore(q, import_helpers9.default.deriveTitle(n)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.n) : notes;
        items = scored.slice(0, 8).map((n) => ({ id: n.id, title: import_helpers9.default.deriveTitle(n), icon: n.locked ? "lock" : "notebook-text", keys: import_helpers9.default.relativeTime(n.updatedAt), note: n }));
        if (q) items.push({ id: "new", title: 'New note "' + import_helpers9.default.truncate(q, 40) + '"', icon: "square-pen", keys: "", create: q });
      }
      inline.trigger = t;
      inline.items = items;
      inline.active = 0;
      if (!items.length) {
        hideInlineMenu();
        return;
      }
      renderInlineMenu();
    }
    function renderInlineMenu() {
      const menu = el.inlineMenu;
      menu.innerHTML = "";
      inline.items.forEach((it, i) => {
        const b = document.createElement("div");
        b.className = "inline-item" + (i === inline.active ? " is-active" : "");
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", String(i === inline.active));
        b.innerHTML = I(it.icon) + '<span class="lbl"></span>' + (it.keys ? '<span class="keys' + (inline.trigger.kind === "slash" ? " md" : "") + '"></span>' : "");
        b.querySelector(".lbl").textContent = it.title;
        if (it.keys) b.querySelector(".keys").textContent = it.keys;
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          chooseInline(i);
        });
        b.addEventListener("mousemove", () => {
          if (inline.active !== i) {
            inline.active = i;
            paintInline();
          }
        });
        menu.append(b);
      });
      menu.classList.remove("hidden");
      const r = inline.trigger.rect;
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      let x = Math.min(r.left, window.innerWidth - mw - 8);
      let y = r.bottom + 6;
      if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 6);
      menu.style.left = Math.max(8, x) + "px";
      menu.style.top = y + "px";
    }
    function paintInline() {
      [...el.inlineMenu.children].forEach((c, i) => {
        c.classList.toggle("is-active", i === inline.active);
        c.setAttribute("aria-selected", String(i === inline.active));
        if (i === inline.active) c.scrollIntoView({ block: "nearest" });
      });
    }
    function hideInlineMenu() {
      el.inlineMenu.classList.add("hidden");
      inline.trigger = null;
      inline.items = [];
    }
    function inlineMenuKey(e) {
      if (e.isComposing || e.keyCode === 229) return false;
      if (!inline.trigger || el.inlineMenu.classList.contains("hidden")) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = inline.items.length;
        inline.active = (inline.active + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        paintInline();
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        chooseInline(inline.active);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        inline.dismissedAt = inline.trigger.kind + ":" + inline.trigger.from;
        hideInlineMenu();
        return true;
      }
      return false;
    }
    async function chooseInline(i) {
      const it = inline.items[i];
      const t = inline.trigger;
      if (!it || !t || !state.rich) return;
      const range = { from: t.from, to: t.to };
      hideInlineMenu();
      if (t.kind === "slash") {
        if (it.kind === "date") {
          state.rich.insertTextAt(range, (/* @__PURE__ */ new Date()).toLocaleDateString(void 0, { year: "numeric", month: "long", day: "numeric" }));
          return;
        }
        if (it.kind === "link") {
          state.rich.insertTextAt(range, "[[");
          return;
        }
        state.rich.insertBlock(range, it.kind);
        return;
      }
      if (it.create) {
        const noteId = state.currentId;
        let created;
        try {
          created = await api.notes.create({ title: it.create, folderId: state.current ? state.current.folderId || null : null });
        } catch (err) {
          toast("Could not create the note: " + (err.message || err));
          return;
        }
        if (state.currentId !== noteId) return;
        const typed = "[[" + t.query;
        const at = state.rich.textAt(range) === typed ? range : null;
        if (at) state.rich.insertLinkAt(at, it.create, "note://" + created.id);
        else {
          const r = state.rich.selectionRange();
          state.rich.insertLinkAt({ from: r.to, to: r.to }, it.create, "note://" + created.id);
        }
        inline.notes = null;
        refresh({ keepEditor: true });
        toast('Created "' + import_helpers9.default.truncate(it.create, 40) + '". Ctrl+click the link to open it.');
        return;
      }
      state.rich.insertLinkAt(range, it.title, "note://" + it.note.id);
    }
    function syncTextViews(note) {
      const none = lockedNow() || isViewerOnlyFile2(note);
      const isTable = import_helpers9.default.isTableFile(note);
      const table = isTable && !state.sourceMode && !none;
      el.richEditor.classList.toggle("hidden", none || state.sourceMode || isTable);
      el.bodyInput.classList.toggle("hidden", none || !state.sourceMode);
      el.csvView.classList.toggle("hidden", !table);
      fillPane(table || !!note && note.fileKind === "image" && !lockedNow());
      if (table) renderTable2(note);
    }
    let tableDrawn = null;
    let tableStats = null;
    function renderTable2(note) {
      const text = el.bodyInput.value;
      if (!tableDrawn || tableDrawn.id !== note.id || tableDrawn.text !== text) {
        tableStats = NotesCsv.render(el.csvView, text, import_helpers9.default.extOf(note.filePath));
        tableDrawn = { id: note.id, text };
      }
      updateStatus(note);
    }
    function fillPane(on) {
      el.editorColumn.classList.toggle("fills-pane", on);
      el.editor.classList.toggle("fills-pane", on);
    }
    function syncSourceButton() {
      const table = import_helpers9.default.isTableFile(state.current);
      const label = state.sourceMode ? table ? "Table" : "Rendered" : table ? "Text" : "Source";
      const what = state.sourceMode ? table ? "Show as a table" : "Back to the rendered view" : table ? "Edit as text" : "Show Markdown source";
      setLabel(el.sourceBtn, label);
      el.sourceBtn.setAttribute("aria-label", what);
      el.sourceBtn.title = what + " (Ctrl+E)";
    }
    function applyEditorMode(source) {
      state.sourceMode = !!source;
      if (source) hideInlineMenu();
      if (find.open) {
        clearFindHighlights();
        setTimeout(() => {
          if (find.open) runFind(true, true);
        }, 0);
      }
      setPressed(el.sourceBtn, state.sourceMode);
      syncSourceButton();
      syncTextViews(state.current);
      renderCodePosition();
      if (state.sourceMode) autoGrow();
      else if (state.rich && state.currentId && !isViewerOnlyFile2(state.current) && !isPlainTextFile3(state.current)) state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
    }
    function toggleSource(force) {
      const next = typeof force === "boolean" ? force : !state.sourceMode;
      if (isViewerOnlyFile2(state.current)) {
        toast("This file is shown as it is; it has no Markdown view to switch to.");
        return;
      }
      if (next === state.sourceMode) return;
      if (!next && isPlainTextFile3(state.current) && !import_helpers9.default.isTableFile(state.current)) {
        toast("This is a plain-text file, so it is edited as the text it is.");
        return;
      }
      if (!next && !state.rich && !import_helpers9.default.isTableFile(state.current)) {
        toast("The rendered editor is unavailable; staying in Markdown source.");
        return;
      }
      if (!next && state.currentId && !isPlainTextFile3(state.current)) {
        state.currentLossless = state.rich.setMarkdown(el.bodyInput.value);
        if (state.current && state.current.filePath && state.currentLossless && !state.rich.lastRoundTripExact()) state.currentLossless = false;
        if (state.currentLossless === false) {
          state.lossyOverride = state.currentId;
          toast("Heads up: editing this note in the rendered view will rewrite formatting it cannot show.");
        }
      }
      applyEditorMode(next);
      if (!import_helpers9.default.isTableFile(state.current)) updateSettings({ editorMode: next ? "source" : "rendered" });
      focusBody();
    }
    async function followLink(href) {
      href = String(href || "");
      if (/^note:\/\//i.test(href)) {
        const id = href.replace(/^note:\/\//i, "").replace(/\/$/, "");
        const target = await api.notes.get(id);
        if (!target) {
          toast("That note no longer exists.");
          return;
        }
        await scopeListToNote(target);
        await selectNoteNow(id);
        return;
      }
      if (/^attachment:\/\//i.test(href)) {
        const r = await api.attachments.open(href);
        if (r) toast(String(r));
        return;
      }
      api.app.openExternal(href);
    }
    function openLinkDialog() {
      if (!state.rich || state.sourceMode) return;
      const existing = state.rich.activeLink();
      if (!existing && !state.rich.hasSelection()) {
        toast("Select the text to link first");
        return;
      }
      state.linkRange = state.rich.selectionRange();
      el.linkNoteSelect.innerHTML = '<option value="">\u2014 pick a note \u2014</option>';
      api.notes.list({ sort: "title" }).then((notes) => {
        for (const n of notes) {
          if (n.id === state.currentId) continue;
          const o = document.createElement("option");
          o.value = "note://" + n.id;
          o.textContent = import_helpers9.default.truncate(import_helpers9.default.deriveTitle(n), 60);
          el.linkNoteSelect.append(o);
        }
        if (/^note:\/\//.test(existing)) el.linkNoteSelect.value = existing;
      });
      el.linkInput.value = existing || "https://";
      el.linkRemoveBtn.classList.toggle("hidden", !existing);
      el.linkDialog.showModal();
      el.linkInput.focus();
      el.linkInput.select();
    }
    function tableStatsNow() {
      return tableStats;
    }
    return { createRichEditor, inline, showInlineMenu, inlineMenuKey, syncTextViews, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog };
  }

  // src/renderer/vaults-panel.js
  var import_helpers10 = __toESM(require_helpers());
  function createVaultsPanel({ api, refresh, flushSave, setView, leaveSettings, setExpanded }) {
    async function syncVault(id) {
      toast("Syncing vault\u2026");
      const r = await api.vaults.sync(id);
      if (r.ok) toast("Vault synced.");
      else if (r.skipped) toast("This vault is a plain folder (" + r.skipped + "). Add a remote in Settings to sync it.");
      else toast("Vault sync failed: " + r.error);
      await refresh({ keepEditor: true });
      renderVaultList();
    }
    async function removeVault(id) {
      if (!window.confirm("Remove this vault from Notes? The folder and its files stay on disk untouched.")) return;
      await flushSave();
      await api.vaults.remove(id);
      if (state.view === "folder") await setView("all");
      else await refresh({ keepEditor: true });
      renderVaultList();
      toast("Vault removed. Files kept.");
    }
    async function addVaultFolder() {
      const dir = await api.vaults.pickFolder();
      if (!dir) return;
      try {
        const v = await api.vaults.add({ path: dir });
        await leaveSettings();
        await setView("folder", v.rootFolderId);
        await setExpanded(v.rootFolderId, true);
        toast('Vault "' + v.name + '" added' + (v.status.isRepo ? " (git repository" + (v.status.remote ? ", syncing with " + v.status.remote : ", no remote") + ")" : ""));
      } catch (err) {
        toast("Could not add vault: " + (err.message || err));
      }
    }
    function openCloneDialog() {
      el.vaultUrlInput.value = "";
      el.vaultNameInput.value = "";
      el.vaultError.textContent = "";
      if (!el.vaultDestInput.value && state.info && state.info.documentsDir) el.vaultDestInput.value = state.info.documentsDir;
      el.vaultDialog.showModal();
      el.vaultUrlInput.focus();
    }
    async function submitClone() {
      const url = el.vaultUrlInput.value.trim();
      const dest = el.vaultDestInput.value.trim();
      if (!url) {
        el.vaultError.textContent = "Enter a repository URL.";
        return;
      }
      if (!dest) {
        el.vaultError.textContent = "Choose where to clone.";
        return;
      }
      el.vaultCloneSubmitBtn.disabled = true;
      el.vaultError.textContent = "Cloning\u2026";
      try {
        const r = await api.vaults.clone(url, dest, el.vaultNameInput.value.trim());
        if (!r.ok) {
          el.vaultError.textContent = r.error;
          return;
        }
        el.vaultDialog.close();
        await leaveSettings();
        await setView("folder", r.vault.rootFolderId);
        await setExpanded(r.vault.rootFolderId, true);
        toast('Cloned "' + r.vault.name + '". Changes will sync automatically.');
      } catch (err) {
        el.vaultError.textContent = String(err.message || err);
      } finally {
        el.vaultCloneSubmitBtn.disabled = false;
      }
    }
    async function renderVaultList() {
      if (!el.settingsDialog.open) return;
      let list;
      try {
        list = await api.vaults.list();
      } catch (_) {
        return;
      }
      el.vaultList.innerHTML = "";
      if (!list.length) {
        const d = document.createElement("div");
        d.className = "vault-empty";
        d.textContent = "No vaults yet. Add a folder of Markdown files, or clone a repository.";
        el.vaultList.append(d);
        return;
      }
      for (const v of list) {
        state.vaultStatus[v.id] = v.status;
        const item = document.createElement("div");
        item.className = "vault-item";
        item.dataset.id = v.id;
        const head = document.createElement("div");
        head.className = "vault-head";
        head.innerHTML = '<span></span><span class="vault-path"></span>';
        head.firstChild.textContent = v.name;
        head.lastChild.textContent = v.path;
        head.lastChild.title = v.path;
        item.append(head);
        const st = document.createElement("div");
        st.className = "vault-status" + (v.status.lastError || v.status.conflict ? " is-error" : "");
        st.textContent = describeVaultStatus(v);
        item.append(st);
        const actions = document.createElement("div");
        actions.className = "vault-actions";
        const remote = document.createElement("input");
        remote.className = "input";
        remote.placeholder = v.status.isRepo ? "Remote URL (origin)" : "Add a remote URL to turn this folder into a synced repo";
        remote.value = v.remote || v.status.remote || "";
        remote.addEventListener("change", async () => {
          const r = await api.vaults.update(v.id, { remote: remote.value.trim() });
          if (r && r.ok === false) toast(r.error);
          renderVaultList();
        });
        actions.append(remote);
        const mk = (label, fn, cls) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-small" + (cls ? " " + cls : "");
          b.textContent = label;
          b.addEventListener("click", fn);
          actions.append(b);
        };
        mk("Sync now", () => syncVault(v.id));
        mk("Rescan", async () => {
          const r = await api.vaults.scan(v.id);
          toast("Rescanned: +" + r.added + " changed " + r.updated + " removed " + r.removed);
          await refresh({ keepEditor: true });
        });
        mk("Open folder", () => api.vaults.openFolder(v.id));
        const auto = document.createElement("label");
        auto.className = "field-check";
        auto.innerHTML = '<input type="checkbox"><span>Auto-sync</span>';
        auto.firstChild.checked = v.autoSync;
        auto.firstChild.addEventListener("change", async () => {
          await api.vaults.update(v.id, { autoSync: auto.firstChild.checked });
          renderVaultList();
        });
        actions.append(auto);
        mk("Remove", () => removeVault(v.id), "btn-danger");
        item.append(actions);
        el.vaultList.append(item);
      }
    }
    function describeVaultStatus(v) {
      const s = v.status || {};
      if (!s.isRepo) return "Plain folder: notes mirror the files, no git. Add a remote URL to start syncing.";
      const parts = ["git on " + (s.branch || "?")];
      if (s.remote) parts.push(s.ahead || s.behind ? s.ahead + " ahead, " + s.behind + " behind" : "in sync with remote");
      else parts.push("no remote (local history only)");
      if (s.dirty) parts.push("uncommitted changes");
      if (s.syncing) parts.push("syncing\u2026");
      if (s.lastSyncAt) parts.push("last sync " + import_helpers10.default.relativeTime(s.lastSyncAt));
      if (s.conflict) parts.push("CONFLICT: resolve in the folder");
      if (s.lastError) parts.push("error: " + s.lastError);
      return parts.join(" \xB7 ");
    }
    return { syncVault, removeVault, addVaultFolder, openCloneDialog, submitClone, renderVaultList, describeVaultStatus };
  }

  // src/renderer/locking.js
  var import_helpers11 = __toESM(require_helpers());
  var { isViewerOnlyFile: isViewerOnlyFile3, isPlainTextFile: isPlainTextFile4 } = import_helpers11.default;
  function createLocking({ api, renderFileRow, flushSave, applyEditorMode, runFind, scheduleSave, renderStickyButton, updateStatus, refreshRow }) {
    function renderLockState(note) {
      const locked = !!(note && note.locked);
      const open = !!(note && note.unlocked);
      el.lockScreen.classList.toggle("hidden", !(locked && !open));
      el.lockScreenError.textContent = "";
      el.lockScreenPassword.value = "";
      el.lockBtn.classList.toggle("is-on", locked);
      setLabel(el.lockBtn, !locked ? "Lock" : open ? "Unlocked" : "Locked");
      setIcon(el.lockBtn, locked && open ? "lock-open" : "lock");
      el.lockBtn.title = !locked ? "Lock this note with a password (Ctrl+L)" : open ? "Unlocked for now: lock again or remove the lock (Ctrl+L)" : "Locked. Enter the password below to read it (Ctrl+L)";
      if (locked && !open) {
        el.richEditor.classList.add("hidden");
        el.bodyInput.classList.add("hidden");
        if (state.rich) state.rich.setEditable(false);
      } else if (note) {
        renderFileRow(note);
        if (state.rich) state.rich.setEditable(!note.trashedAt && !isViewerOnlyFile3(note) && !isPlainTextFile4(note));
      }
    }
    function onLockButton() {
      const note = state.current;
      if (!note || note.trashedAt || note.filePath) return;
      if (!note.locked) {
        openLockDialog("set");
        return;
      }
      if (!note.unlocked) {
        el.lockScreenPassword.focus();
        return;
      }
      placePopover(el.lockMenu, el.moreMenu.contains(el.lockBtn) ? el.moreBtn : el.lockBtn);
    }
    function openLockDialog(mode) {
      el.lockDialog.dataset.mode = mode;
      el.lockDialogTitle.textContent = mode === "set" ? "Lock note" : "Remove lock";
      el.lockDialogHint.textContent = mode === "set" ? "The text is encrypted with this password. There is no recovery: if you forget it, the note stays locked." : "Enter the password to store this note in clear again.";
      el.lockConfirmRow.classList.toggle("hidden", mode !== "set");
      el.lockSubmitBtn.textContent = mode === "set" ? "Lock" : "Remove lock";
      el.lockPassword.value = "";
      el.lockPassword2.value = "";
      el.lockError.textContent = "";
      el.lockDialog.showModal();
      el.lockPassword.focus();
    }
    async function submitLockDialog() {
      const note = state.current;
      if (!note) return;
      const mode = el.lockDialog.dataset.mode;
      const pw = el.lockPassword.value;
      if (!pw) {
        el.lockError.textContent = "Enter a password.";
        return;
      }
      if (mode === "set" && pw !== el.lockPassword2.value) {
        el.lockError.textContent = "The two passwords differ.";
        return;
      }
      await flushSave();
      try {
        const updated = mode === "set" ? await api.lock.set(note.id, pw) : await api.lock.remove(note.id, pw);
        el.lockDialog.close();
        applyLockedNote(updated);
        toast(mode === "set" ? "Locked. It stays readable until you hide the app or choose Lock now." : "Lock removed.");
      } catch (err) {
        el.lockError.textContent = ipcErrorText(err);
      }
    }
    async function unlockFromScreen() {
      const note = state.current;
      if (!note) return;
      const pw = el.lockScreenPassword.value;
      if (!pw) {
        el.lockScreenError.textContent = "Enter the password.";
        return;
      }
      try {
        const updated = await api.lock.unlock(note.id, pw);
        applyLockedNote(updated);
        focusBody();
      } catch (err) {
        el.lockScreenError.textContent = /wrong password/i.test(String(err.message)) ? "Wrong password." : ipcErrorText(err);
        el.lockScreenPassword.select();
      }
    }
    function applyLockedNote(updated) {
      if (!updated || updated.id !== state.currentId) return;
      state.current = updated;
      const keepTyping = state.dirty && updated.unlocked;
      if (!keepTyping) {
        state.dirty = false;
        src.reload(updated.body);
        if (state.rich) {
          state.currentLossless = state.rich.setMarkdown(updated.body);
          if (updated.unlocked && state.currentLossless === false && !state.sourceMode && state.lossyOverride !== updated.id) {
            applyEditorMode(true);
            toast("Switched to source: this note contains formatting the rendered view would change.");
          }
        }
        state.pending.delete(updated.id);
        autoGrow();
        if (find.open) runFind(true, true, true);
      } else scheduleSave();
      renderLockState(updated);
      renderStickyButton(updated);
      updateStatus(updated);
      const idx = state.notes.findIndex((n) => n.id === updated.id);
      if (idx !== -1) {
        state.notes[idx] = updated;
        refreshRow(updated);
      }
    }
    async function lockMenuAction(action) {
      el.lockMenu.classList.add("hidden");
      const note = state.current;
      if (!note || !note.locked) return;
      if (action === "relock") {
        const saved = await flushSave();
        if (!saved) {
          toast("Your latest typing could not be saved yet, so the note was not locked. Try again in a moment.");
          return;
        }
        state.pending.delete(note.id);
        applyLockedNote(await api.lock.relock(note.id));
        toast("Locked.");
      } else if (action === "remove") openLockDialog("remove");
    }
    return { renderLockState, onLockButton, submitLockDialog, unlockFromScreen, applyLockedNote, lockMenuAction };
  }

  // src/renderer/attachments.js
  var import_helpers12 = __toESM(require_helpers());
  var { isViewerOnlyFile: isViewerOnlyFile4 } = import_helpers12.default;
  function createAttachments({ api, flushSave, refresh }) {
    function insertAttachmentLinks(items) {
      const ok = items.filter((x) => x && !x.error);
      const bad = items.filter((x) => x && x.error);
      for (const it of ok) insertLinkIntoNote("\u{1F4CE} " + it.name, it.href);
      if (ok.length) toast(ok.length === 1 ? "Attached " + ok[0].name : "Attached " + ok.length + " files");
      for (const b of bad) toast("Could not attach " + b.name + ": " + b.error);
    }
    function refuseInTable() {
      if (!tableShown()) return false;
      toast("Switch to Text (Ctrl+E) to add this to the file.");
      return true;
    }
    function insertLinkIntoNote(text, href) {
      if (!state.current || lockedNow()) return;
      if (refuseInTable()) return;
      if (state.sourceMode || !state.rich) {
        const ta = src;
        if (ta.readOnly) return;
        const at = typeof ta.selectionStart === "number" ? ta.selectionStart : ta.value.length;
        const end = typeof ta.selectionEnd === "number" ? ta.selectionEnd : at;
        const md = "[" + text.replace(/[\[\]]/g, "") + "](" + href + ")";
        const before = ta.value.slice(0, at), after = ta.value.slice(end);
        const sep = before && !/\s$/.test(before) ? " " : "";
        ta.value = before + sep + md + " " + after;
        const pos = (before + sep + md + " ").length;
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        state.rich.insertLink(text, href);
      }
    }
    async function attachFiles() {
      if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile4(state.current)) {
        toast("Open an editable, unlocked note first.");
        return;
      }
      if (refuseInTable()) return;
      const forNote = state.current.id;
      await flushSave();
      const items = await api.attachments.pick();
      if (state.currentId === forNote) {
        insertAttachmentLinks(items);
        return;
      }
      const ok = items.filter((x) => x && !x.error);
      if (!ok.length) {
        insertAttachmentLinks(items);
        return;
      }
      const target = await api.notes.get(forNote);
      if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile4(target)) {
        const links = ok.map((it) => "[\u{1F4CE} " + it.name.replace(/[[\]]/g, "") + "](" + it.href + ")").join("\n");
        await api.notes.update(forNote, { body: (target.body ? target.body.replace(/\s*$/, "") + "\n\n" : "") + links + "\n" });
        toast('Attached to "' + import_helpers12.default.truncate(import_helpers12.default.deriveTitle(target), 30) + '", the note that was open when you chose the files.');
        refresh({ keepEditor: true });
      } else toast("Attached files are kept in the attachments folder; that note can no longer take them.");
    }
    const rec = { recorder: null, chunks: [], startedAt: 0, timer: null, noteId: null, starting: false };
    async function toggleRecording() {
      if (rec.recorder) {
        rec.recorder.stop();
        return;
      }
      if (rec.starting) return;
      if (!state.current || lockedNow() || state.current.trashedAt || isViewerOnlyFile4(state.current)) {
        toast("Open an editable, unlocked note first.");
        return;
      }
      if (refuseInTable()) return;
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        toast("Recording is not available here.");
        return;
      }
      rec.noteId = state.current.id;
      rec.starting = true;
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        rec.starting = false;
        toast("Microphone not available: " + (err.message || err));
        return;
      }
      rec.starting = false;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      rec.recorder = recorder;
      rec.chunks = [];
      rec.startedAt = Date.now();
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size) rec.chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(rec.timer);
        el.recordBtn.classList.remove("is-recording");
        setLabel(el.recordBtn, "Record a voice memo");
        setActivity("record", null);
        const seconds = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1e3));
        rec.recorder = null;
        const blob = new Blob(rec.chunks, { type: "audio/webm" });
        if (!blob.size) {
          toast("Nothing was recorded.");
          return;
        }
        try {
          const saved = await api.attachments.saveRecording(new Uint8Array(await blob.arrayBuffer()), "webm");
          const mm = String(Math.floor(seconds / 60)).padStart(2, "0"), ss = String(seconds % 60).padStart(2, "0");
          const label = "\u{1F399} Voice memo " + mm + ":" + ss;
          if (state.currentId === rec.noteId && !lockedNow()) {
            insertLinkIntoNote(label, saved.href);
            toast("Voice memo saved (" + mm + ":" + ss + "). Ctrl+click the link to play it.");
          } else {
            const target = await api.notes.get(rec.noteId);
            if (target && !target.locked && !target.trashedAt && !isViewerOnlyFile4(target)) {
              await api.notes.update(rec.noteId, { body: (target.body ? target.body.replace(/\s*$/, "") + "\n\n" : "") + "[" + label + "](" + saved.href + ")\n" });
              toast('Voice memo saved into "' + import_helpers12.default.truncate(import_helpers12.default.deriveTitle(target), 30) + '", the note it was recorded in.');
              refresh({ keepEditor: true });
            } else toast("Voice memo saved as " + saved.name + " (that note can no longer take it; Attach it where you want it).");
          }
        } catch (err) {
          toast("Could not save the recording: " + (err.message || err));
        }
      };
      recorder.start(250);
      el.recordBtn.classList.add("is-recording");
      const tick = () => {
        const s = Math.round((Date.now() - rec.startedAt) / 1e3);
        const clock = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
        setLabel(el.recordBtn, "Stop recording (" + clock + ")");
        setActivity("record", { text: "Recording " + clock, icon: "audio-lines", stop: toggleRecording, stopLabel: "Stop recording (Ctrl+Shift+G)" });
      };
      tick();
      rec.timer = setInterval(tick, 500);
    }
    return { attachFiles, toggleRecording };
  }

  // src/renderer/history-dialog.js
  var import_helpers13 = __toESM(require_helpers());
  var { isViewerOnlyFile: isViewerOnlyFile5 } = import_helpers13.default;
  function createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave }) {
    const hist = { versions: [], index: -1, noteId: null };
    async function openHistory() {
      const note = state.current;
      if (!note) return;
      if (note.trashedAt) {
        toast("Restore the note from the trash first; then its earlier versions can be restored.");
        return;
      }
      await flushSave();
      el.historyList.innerHTML = "";
      el.historyPreview.textContent = "";
      el.historyRestoreBtn.disabled = true;
      el.historyStatus.textContent = "Loading\u2026";
      el.historyDialog.showModal();
      const r = await api.app.historyVersions(note.id, 80);
      if (!r.ok) {
        el.historyStatus.textContent = r.error;
        return;
      }
      hist.noteId = note.id;
      hist.versions = r.versions.filter((v) => v.body !== r.current);
      hist.index = -1;
      el.historyStatus.textContent = hist.versions.length ? hist.versions.length + (hist.versions.length === 1 ? " earlier version" : " earlier versions") : "No earlier version differs from the current text yet.";
      hist.versions.forEach((v, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.dataset.index = i;
        const first = (v.body.split("\n").find((l) => l.trim()) || "(empty)").replace(/^#+\s*/, "");
        li.innerHTML = '<span class="when"></span><span class="first"></span>';
        li.querySelector(".when").textContent = new Date(v.at).toLocaleString() + " \xB7 " + v.chars + " chars";
        li.querySelector(".first").textContent = import_helpers13.default.truncate(first, 48);
        li.addEventListener("click", () => showVersion(i));
        el.historyList.append(li);
      });
      if (hist.versions.length) showVersion(0);
    }
    function showVersion(i) {
      hist.index = i;
      for (const li of el.historyList.children) li.classList.toggle("is-active", Number(li.dataset.index) === i);
      el.historyPreview.textContent = hist.versions[i].body;
      el.historyRestoreBtn.disabled = false;
    }
    async function restoreVersion() {
      const v = hist.versions[hist.index];
      const note = state.current;
      if (!v || !note) return;
      el.historyDialog.close();
      if (state.currentId !== hist.noteId || note.id !== hist.noteId || note.trashedAt || lockedNow() || isViewerOnlyFile5(note)) {
        toast("This note cannot take the restored text right now.");
        return;
      }
      src.value = v.body;
      if (state.rich) {
        let lossless = state.rich.setMarkdown(v.body);
        if (note.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
        state.currentLossless = lossless;
        state.lossyOverride = null;
        if (!lossless && !state.sourceMode) applyEditorMode(true);
      }
      autoGrow();
      if (find.open) runFind(true, true, true);
      scheduleSave();
      const ok = await flushSave();
      if (ok) toast("Restored the version from " + new Date(v.at).toLocaleString() + ". The text you had is still in history.");
      else if (state.conflictShown !== note.id) toast("Could not save the restored text yet; it will be retried.");
    }
    return { openHistory, restoreVersion };
  }

  // src/renderer/speech.js
  var import_helpers14 = __toESM(require_helpers());
  var { isViewerOnlyFile: isViewerOnlyFile6, isNonMarkdownFile: isNonMarkdownFile2 } = import_helpers14.default;
  function createSpeech({ api }) {
    const tts = { active: false, queue: [], index: 0 };
    function selectedTextForSpeech() {
      if (state.sourceMode) {
        const ta = src;
        if (ta.selectionStart !== ta.selectionEnd) return ta.value.slice(ta.selectionStart, ta.selectionEnd);
        return "";
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && el.richEditor.contains(sel.anchorNode)) return sel.toString();
      return "";
    }
    function textForSpeech() {
      const selected = selectedTextForSpeech().trim();
      if (selected) return selected;
      const title = el.titleInput.value.trim();
      const note = state.current;
      const body = isNonMarkdownFile2(note) ? el.bodyInput.value : import_helpers14.default.plainTextFromMarkdown(el.bodyInput.value);
      return (title ? title + ".\n" : "") + body;
    }
    function pickVoice() {
      const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
      const wanted = state.settings && state.settings.ttsVoice;
      return voices.find((v) => v.name === wanted) || null;
    }
    function setReadAloudState(active) {
      tts.active = active;
      setLabel(el.readAloudBtn, active ? "Stop reading" : "Read aloud");
      el.readAloudBtn.classList.toggle("is-on", active);
      setActivity("read", active ? { text: "Reading aloud", icon: "volume-2", stop: stopReadAloud, stopLabel: "Stop reading (Ctrl+Shift+R)" } : null);
    }
    function stopReadAloud() {
      tts.queue = [];
      tts.index = 0;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setReadAloudState(false);
    }
    function speakNext() {
      if (!tts.active || tts.index >= tts.queue.length) {
        setReadAloudState(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(tts.queue[tts.index++]);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.rate = state.settings && state.settings.ttsRate || 1;
      u.onend = () => speakNext();
      u.onerror = (e) => {
        if (e.error !== "interrupted" && e.error !== "canceled") toast("Read aloud stopped: " + e.error);
        setReadAloudState(false);
      };
      if (state.info && state.info.drySpeech) return;
      window.speechSynthesis.speak(u);
    }
    function toggleReadAloud() {
      if (!window.speechSynthesis) {
        toast("Speech is not available on this system.");
        return;
      }
      if (tts.active) {
        stopReadAloud();
        return;
      }
      if (!state.current) return;
      const text = textForSpeech();
      if (!text.trim()) {
        toast("Nothing to read yet.");
        return;
      }
      tts.queue = import_helpers14.default.speechChunks(text);
      tts.index = 0;
      setReadAloudState(true);
      window.speechSynthesis.cancel();
      speakNext();
    }
    function populateVoices() {
      if (!window.speechSynthesis) return;
      const voices = window.speechSynthesis.getVoices().slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
      const current = state.settings ? state.settings.ttsVoice : "";
      el.ttsVoiceSelect.innerHTML = '<option value="">System default</option>';
      for (const v of voices) {
        const o = document.createElement("option");
        o.value = v.name;
        o.textContent = v.name + " (" + v.lang + ")" + (v.default ? " \u2022 default" : "");
        el.ttsVoiceSelect.append(o);
      }
      el.ttsVoiceSelect.value = voices.some((v) => v.name === current) ? current : "";
    }
    async function startDictation() {
      if (!state.current || isViewerOnlyFile6(state.current) || state.current.trashedAt) {
        toast("Open an editable note first.");
        return;
      }
      focusBody();
      const res = await api.app.dictate();
      if (!res.ok) toast(res.error || "Dictation could not start.");
      else toast('Windows dictation opened: speak now. Say "stop dictating" or press Win+H to finish.');
    }
    return { tts, stopReadAloud, toggleReadAloud, populateVoices, startDictation };
  }

  // src/renderer/find-bar.js
  var import_helpers15 = __toESM(require_helpers());

  // src/renderer/find-text.js
  function isQueryText(text, q) {
    return new RegExp("^" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i").test(text);
  }
  function findOffsets(text, q) {
    const hits = [];
    if (!q) return hits;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push(m.index);
      if (m[0].length === 0) re.lastIndex++;
    }
    return hits;
  }

  // src/renderer/find-bar.js
  var { isViewerOnlyFile: isViewerOnlyFile7 } = import_helpers15.default;
  function createFindBar({ api, flushSave, GUEST }) {
    function openFind() {
      if (!state.current) return;
      find.open = true;
      el.findBar.classList.remove("hidden");
      const sel = String(window.getSelection && window.getSelection().toString() || "").trim();
      if (!sel && src.hasFocus()) {
        const t = src.value.slice(src.selectionStart, src.selectionEnd).trim();
        if (t) el.findInput.value = t;
      } else if (sel && sel.length < 200) el.findInput.value = sel;
      el.findInput.focus();
      el.findInput.select();
      runFind(true, true);
    }
    function toggleReplace(force) {
      const on = typeof force === "boolean" ? force : el.replaceRow.classList.contains("hidden");
      el.replaceRow.classList.toggle("hidden", !on);
      el.findReplaceToggle.setAttribute("aria-pressed", String(on));
      if (on) el.replaceInput.focus();
    }
    function replaceCurrent() {
      const q = el.findInput.value;
      const text = el.replaceInput.value;
      if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile7(state.current)) return;
      if (state.sourceMode) {
        const wanted = find.active;
        runFind(true, true, true);
        if (!find.sourceHits.length) {
          runFind(true, true);
          return;
        }
        find.active = Math.min(Math.max(wanted, 0), find.sourceHits.length - 1);
        const at = find.sourceHits[find.active];
        const ta = src;
        if (ta.readOnly) return;
        if (!isQueryText(ta.value.slice(at, at + q.length), q)) {
          showActiveMatch();
          return;
        }
        ta.value = ta.value.slice(0, at) + text + ta.value.slice(at + q.length);
        ta.setSelectionRange(at + text.length, at + text.length);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        runFind(true, true, true);
        if (find.sourceHits.length) {
          const next = find.sourceHits.findIndex((h) => h >= at + text.length);
          find.active = next === -1 ? 0 : next;
          showActiveMatch();
        }
        return;
      }
      if (tableShown()) {
        toast("Switch to Text (Ctrl+E) to replace in this file.");
        return;
      }
      if (!state.rich) return;
      const wantedIdx = find.active;
      runFind(true, true, true);
      if (!find.ranges.length) {
        runFind(true, true);
        return;
      }
      find.active = Math.min(Math.max(wantedIdx, 0), find.ranges.length - 1);
      const idx = find.active;
      if (!isQueryText(String(find.ranges[idx]), q)) {
        showActiveMatch();
        return;
      }
      state.rich.replaceRanges([find.ranges[idx]], text);
      runFind(true, true, true);
      const inside = findOffsets(text, q).length;
      if (find.ranges.length) {
        find.active = (idx + inside) % find.ranges.length;
        showActiveMatch();
      }
    }
    function showActiveMatch() {
      const q = el.findInput.value;
      if (state.sourceMode) {
        const at = find.sourceHits[find.active];
        if (at === void 0) return;
        if (document.activeElement !== el.replaceInput) src.focus();
        src.setSelectionRange(at, at + q.length);
        src.reveal(at);
        el.findCount.textContent = find.active + 1 + "/" + find.sourceHits.length;
        return;
      }
      if (window.CSS && CSS.highlights) CSS.highlights.set("notes-find-active", new Highlight(...find.active >= 0 && find.ranges[find.active] ? [find.ranges[find.active]] : []));
      const r = find.ranges[find.active];
      if (r) {
        const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        if (node && node.scrollIntoView) node.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      el.findCount.textContent = find.ranges.length ? find.active + 1 + "/" + find.ranges.length : "No matches";
    }
    function replaceAll() {
      const q = el.findInput.value;
      const text = el.replaceInput.value;
      if (!q || lockedNow() || !state.current || state.current.trashedAt || isViewerOnlyFile7(state.current)) return;
      let n = 0;
      if (state.sourceMode) {
        const ta = src;
        if (ta.readOnly) return;
        const hits = findOffsets(ta.value, q);
        n = hits.length;
        if (!n) {
          toast("No matches");
          return;
        }
        let out = "", last = 0;
        for (const at of hits) {
          out += ta.value.slice(last, at) + text;
          last = at + q.length;
        }
        ta.value = out + ta.value.slice(last);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        if (tableShown()) {
          toast("Switch to Text (Ctrl+E) to replace in this file.");
          return;
        }
        if (!state.rich) return;
        runFind(true, true, true);
        n = state.rich.replaceRanges(find.ranges, text);
        if (!n) {
          toast("No matches");
          return;
        }
      }
      runFind(true, true, true);
      toast("Replaced " + n + (n === 1 ? " match" : " matches"));
    }
    function closeFind() {
      if (!find.open) return;
      find.open = false;
      el.findBar.classList.add("hidden");
      toggleReplace(false);
      el.findCount.textContent = "";
      clearFindHighlights();
      focusBody();
    }
    function clearFindHighlights() {
      if (window.CSS && CSS.highlights) {
        CSS.highlights.delete("notes-find");
        CSS.highlights.delete("notes-find-active");
      }
      find.ranges = [];
      find.sourceHits = [];
      find.active = -1;
    }
    function findRangesIn(root, q) {
      const nodes = [];
      let text = "";
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      const blockOf = (n) => {
        let e = n.parentElement;
        while (e && e !== root && getComputedStyle(e).display === "inline") e = e.parentElement;
        return e;
      };
      let lastBlock = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.nodeType === 1) {
          if (n.tagName === "BR" || n.tagName === "IMG") text += "\n";
          continue;
        }
        const b = blockOf(n);
        if (lastBlock && b !== lastBlock) text += "\n";
        lastBlock = b;
        nodes.push({ node: n, start: text.length });
        text += n.nodeValue;
      }
      const locate = (pos) => {
        let lo = 0, hi = nodes.length - 1;
        while (lo < hi) {
          const mid = lo + hi + 1 >> 1;
          if (nodes[mid].start <= pos) lo = mid;
          else hi = mid - 1;
        }
        if (!nodes.length) return null;
        const node = nodes[lo].node;
        return { node, offset: Math.min(pos - nodes[lo].start, node.nodeValue.length) };
      };
      return findOffsets(text, q).map((pos) => {
        const s = locate(pos), e = locate(pos + q.length);
        if (!s || !e) return null;
        const r = document.createRange();
        r.setStart(s.node, s.offset);
        if (e.offset === 0 && pos + q.length > 0) {
          const prev = locate(pos + q.length - 1);
          r.setEnd(prev.node, prev.offset + 1);
        } else r.setEnd(e.node, e.offset);
        return r;
      }).filter(Boolean);
    }
    function runFind(forward, fresh, quiet) {
      const q = el.findInput.value;
      const sameQuery = q === find.query;
      find.query = q;
      if (!q) {
        clearFindHighlights();
        el.findCount.textContent = "";
        return;
      }
      if (state.sourceMode) {
        if (fresh || !sameQuery || !find.sourceHits.length) {
          find.sourceHits = findOffsets(el.bodyInput.value, q);
          const caret = src.selectionStart || 0;
          const idx = find.sourceHits.findIndex((h) => h >= caret);
          find.active = find.sourceHits.length ? idx === -1 ? 0 : idx : -1;
        } else if (find.sourceHits.length) {
          find.active = (find.active + (forward === false ? -1 : 1) + find.sourceHits.length) % find.sourceHits.length;
        }
        const n2 = find.sourceHits.length;
        if (n2 && find.active >= 0 && !quiet) {
          const at = find.sourceHits[find.active];
          if (!fresh) src.focus();
          src.setSelectionRange(at, at + q.length);
          src.reveal(at);
        }
        el.findCount.textContent = n2 ? find.active + 1 + "/" + n2 : "No matches";
        el.findCount.classList.toggle("is-none", !n2);
        return;
      }
      if (fresh || !sameQuery || !find.ranges.length) {
        find.ranges = findRangesIn(tableShown() ? el.csvView : el.richEditor, q);
        find.active = find.ranges.length ? sameQuery && find.active >= 0 ? Math.min(find.active, find.ranges.length - 1) : 0 : -1;
      } else if (find.ranges.length) {
        find.active = (find.active + (forward === false ? -1 : 1) + find.ranges.length) % find.ranges.length;
      }
      if (window.CSS && CSS.highlights) {
        CSS.highlights.set("notes-find", new Highlight(...find.ranges));
        CSS.highlights.set("notes-find-active", new Highlight(...find.active >= 0 ? [find.ranges[find.active]] : []));
      }
      const n = find.ranges.length;
      if (n && find.active >= 0 && !quiet) {
        const r = find.ranges[find.active];
        const elNode = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        if (elNode && elNode.scrollIntoView) elNode.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      el.findCount.textContent = n ? find.active + 1 + "/" + n : "No matches";
      el.findCount.classList.toggle("is-none", !n);
    }
    function scrollTextareaToSelection(at) {
      const ta = el.bodyInput;
      const scroller = ta.closest(".editor-scroll") || ta;
      const cs = getComputedStyle(ta);
      const mirror = document.createElement("div");
      for (const prop of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "padding", "border", "boxSizing", "whiteSpace", "wordBreak", "overflowWrap", "tabSize"]) mirror.style[prop] = cs[prop];
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.position = "absolute";
      mirror.style.visibility = "hidden";
      mirror.style.top = "0";
      mirror.style.left = "-99999px";
      mirror.style.width = ta.clientWidth + "px";
      mirror.textContent = ta.value.slice(0, at);
      const marker = document.createElement("span");
      marker.textContent = "\u200B";
      mirror.append(marker);
      document.body.append(mirror);
      const y = marker.offsetTop;
      mirror.remove();
      const target = ta.offsetTop + y - scroller.clientHeight / 2;
      if (scroller !== ta) scroller.scrollTop = Math.max(0, target);
      else ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
    }
    async function printNote() {
      if (!state.current) return;
      await flushSave();
      const r = GUEST ? await api.book.export("print", exportOfCurrent()) : await api.app.print();
      if (!r.ok) toast("Could not print: " + (r.error || "unknown error"));
      else if (r.dry) toast("Print: dry run");
    }
    function exportOfCurrent() {
      const title = import_helpers15.default.deriveTitle(state.current);
      return { name: title, html: (state.current.title ? "<h1>" + escapeHtml(state.current.title) + "</h1>" : "") + currentHtml() };
    }
    return { openFind, closeFind, runFind, toggleReplace, replaceCurrent, replaceAll, clearFindHighlights, scrollTextareaToSelection, printNote, exportOfCurrent };
  }

  // src/renderer/one-at-a-time.js
  function oneAtATime(fn) {
    let queue = Promise.resolve(true);
    return (opts) => {
      const run = queue.then(() => fn(opts || {}));
      queue = run.catch(() => false);
      return run;
    };
  }

  // src/renderer/pdf-note.js
  function createPdfNote({ api, externalLinkClick, showBanner, openFiles }) {
    let pdf = null;
    let pdfShownKey = null, pdfSeq = 0, pdfNote = null;
    function pdfController() {
      if (!pdf && NotesPdfEditor) {
        pdf = NotesPdfEditor.create(el.pdfEditor, {
          // Never disabled: a stroke or text box still in progress only counts once it is committed, which Save does.
          onDirty: (d) => {
            el.pdfSaveBtn.textContent = d ? "Save" : "Saved";
          },
          onState: (s) => {
            for (const b of el.pdfEditor.querySelectorAll("[data-pdf-mode]")) b.classList.toggle("is-on", b.dataset.pdfMode === s.mode);
            el.pdfUndoBtn.disabled = !s.canUndo;
            el.pdfRedoBtn.disabled = !s.canRedo;
            el.pdfZoomLabel.textContent = Math.round(s.scale * 100) + "%";
          },
          onLink: externalLinkClick
        });
      }
      return pdf;
    }
    function clearPdf() {
      closePdfPages();
      if (pdfComments) pdfComments.stop();
      pdfShownKey = null;
      pdfSeq++;
      pdfNote = null;
      el.pdfEditor.classList.add("hidden");
      if (pdf) pdf.close();
    }
    async function showPdf(note, opts) {
      const key = note.id + ":" + note.fileMtime;
      if (pdfShownKey === key) return;
      closePdfPages();
      if (pdfComments) pdfComments.stop();
      const ctl = pdfController();
      if (!ctl) {
        showBanner('The PDF viewer failed to load. Use "Open with\u2026" for your PDF app.');
        return;
      }
      pdfShownKey = key;
      const seq = ++pdfSeq;
      pdfNote = null;
      try {
        const bytes = await api.files.pdfBytes(note.id);
        if (seq !== pdfSeq) return;
        if (await ctl.open(bytes, opts) && seq === pdfSeq) {
          pdfNote = { id: note.id, fileMtime: note.fileMtime };
          if (pdfCommentsShown()) pdfComments.refresh();
        }
      } catch (err) {
        if (seq !== pdfSeq) return;
        pdfShownKey = null;
        showBanner("Could not show this PDF: " + ipcErrorText(err) + ' Use "Open with\u2026" for your PDF app.');
      }
    }
    const pdfDirty = () => !!(pdf && pdfNote && pdf.isDirty());
    const pdfBusy = () => !!(pdf && pdfNote && (pdf.hasPendingWork() || pdfComments && pdfComments.busy()));
    const flushPdf = oneAtATime((opts) => flushPdfNow(opts));
    async function flushPdfNow(opts) {
      let explicit = !!opts.explicit;
      for (let i = 0; i < 3; i++) {
        if (!pdf || !pdfNote) return true;
        if (opts.commit !== false) await pdf.commit();
        if (!pdfDirty()) return true;
        if (!await savePdfNow(explicit)) return false;
        explicit = false;
      }
      return !pdfDirty();
    }
    async function savePdfNow(explicit) {
      const target = pdfNote;
      try {
        const { bytes, hash } = await pdf.save();
        const r = await api.files.savePdf(target.id, bytes, target.fileMtime);
        if (pdfNote === target) pdf.markSaved(hash);
        if (reportFileSaved(target, r, explicit, "PDF") && pdfNote === target) pdfShownKey = target.id + ":" + r.mtime;
        return true;
      } catch (err) {
        toast("Could not save the PDF: " + ipcErrorText(err) + " Your changes are still here.");
        return false;
      }
    }
    function reportFileSaved(target, r, explicit, what) {
      if (r.savedAs) {
        if (r.newCopy || explicit) toast("This " + what + " changed on disk while you edited it, so your changes were saved as " + r.savedAs.split(/[\\/]/).pop() + ".", { label: "Open", run: () => openFiles([r.savedAs]) });
        return false;
      }
      noteFileWritten(target, r.mtime);
      if (explicit || r.backup) toast(r.backup ? "Saved your changes into the " + what + ". The original is backed up in the app's backups folder (Settings > Open data folder)." : "Saved your changes into the " + what + ".");
      return true;
    }
    let pdfPages = null, pdfPagesFor = null;
    function openPdfPages() {
      if (!pdf || !pdfNote || !NotesPdfPages) return;
      if (!pdfPages) pdfPages = NotesPdfPages.create(el.pdfPages, pdf, { pickPdf: pickPdfForPages, apply: applyPdfPages, close: closePdfPages, say: toast });
      pdfPagesFor = pdfNote;
      el.pdfEditor.classList.add("organizing");
      pdfPages.open();
    }
    function closePdfPages() {
      pdfPagesFor = null;
      el.pdfEditor.classList.remove("organizing");
      if (pdf) pdf.closeOthers();
    }
    async function callOk(promise) {
      try {
        return await promise;
      } catch (err) {
        return { ok: false, error: ipcErrorText(err) };
      }
    }
    async function pickPdfForPages() {
      const r = await callOk(api.files.pdfPickPages());
      if (r.canceled) return null;
      if (!r.ok) {
        toast("Could not add pages: " + r.error);
        return null;
      }
      return r;
    }
    function noteFileWritten(target, mtime) {
      target.fileMtime = mtime;
      if (state.current && state.current.id === target.id) state.current.fileMtime = mtime;
    }
    function reloadPdf(target, mtime, keepView) {
      noteFileWritten(target, mtime);
      if (state.current && state.current.id === target.id) showPdf(state.current, { keepView: !!keepView });
    }
    async function rewriting(promise) {
      el.pdfEditor.classList.add("rewriting");
      try {
        return await promise;
      } finally {
        el.pdfEditor.classList.remove("rewriting");
      }
    }
    function pdfRewritten(target, r, say, keepView) {
      reloadPdf(target, r.mtime, keepView);
      toast(say.done, { label: "Undo", run: () => undoPdfChange(target.id, r.backup, r.mtime, say.undone, keepView) });
    }
    async function applyPdfPages(plan) {
      const target = pdfNote;
      if (!target || pdfPagesFor !== target) {
        closePdfPages();
        toast("That PDF changed while the pages were open, so they were not changed.");
        return false;
      }
      if (!await flushPdf({ commit: true })) {
        toast("Your marks could not be saved, so the pages were not changed.");
        return false;
      }
      let bytes = null;
      if (plan.pageInfos) {
        let saved;
        try {
          saved = new Uint8Array(await api.files.pdfBytes(target.id));
        } catch (err) {
          toast("Could not read the PDF: " + ipcErrorText(err));
          return false;
        }
        const pageInfos = plan.pageInfos.map((info) => info.document === null ? Object.assign({}, info, { document: saved }) : info);
        try {
          bytes = await pdf.extractPages(pageInfos);
        } catch (err) {
          toast("Could not rearrange the pages: " + (err.message || err));
          return false;
        }
        let pages = 0;
        try {
          if (bytes) pages = (await pdf.openOther(bytes)).pages;
        } catch (_) {
          pages = 0;
        }
        if (pages !== plan.rotations.length) {
          toast("Could not rearrange the pages: a PDF involved could not be read.");
          return false;
        }
      }
      if (pdfNote !== target) return false;
      const r = await rewriting(callOk(api.files.pdfApplyPages(target.id, bytes, plan.rotations, target.fileMtime)));
      if (!r.ok) {
        toast("Could not change the pages: " + r.error);
        return false;
      }
      pdfRewritten(target, r, { done: "Pages updated.", undone: "The pages are back as they were." }, false);
      return true;
    }
    async function undoPdfChange(id, backup, mtime, undoneText, keepView) {
      if (!pdfNote || pdfNote.id !== id) {
        toast("Open that PDF again to undo.");
        return;
      }
      if (pdfComments && pdfComments.busy()) {
        toast("Save or cancel the comment you are writing first, then undo.");
        return;
      }
      const target = pdfNote;
      if (!await flushPdf({ commit: true })) {
        toast("Your marks could not be saved, so nothing was undone.");
        return;
      }
      if (pdfNote !== target) return;
      const r = await rewriting(callOk(api.files.pdfRestore(id, backup, mtime)));
      if (!r.ok) {
        toast("Could not undo: " + r.error);
        return;
      }
      reloadPdf(target, r.mtime, keepView);
      toast(undoneText);
    }
    let pdfComments = null;
    const pdfCommentsShown = () => !!pdfComments && el.pdfEditor.classList.contains("commenting");
    function showPdfComments(show) {
      if (show && (!pdf || !pdfNote || !NotesPdfComments)) return;
      if (show && !pdfComments) pdfComments = NotesPdfComments.create(el.pdfComments, pdf, { change: changePdfComments, say: toast });
      el.pdfEditor.classList.toggle("commenting", show);
      el.pdfCommentsBtn.classList.toggle("is-on", show);
      if (!pdfComments) return;
      if (show) pdfComments.refresh();
      else pdfComments.stop();
    }
    async function changePdfComments(ops) {
      const target = pdfNote;
      if (!target) {
        toast("The PDF is still opening. Try again in a moment.");
        return false;
      }
      if (!await flushPdf({ commit: true })) {
        toast("Your marks could not be saved, so the comment was not saved.");
        return false;
      }
      if (pdfNote !== target) {
        toast("That PDF changed meanwhile, so the comment was not saved.");
        return false;
      }
      const r = await rewriting(callOk(api.files.pdfComments(target.id, ops, target.fileMtime)));
      if (!r.ok) {
        toast("Could not save the comment: " + r.error);
        return false;
      }
      const op = ops[0].op;
      pdfRewritten(target, r, { done: op === "add" ? "Comment added." : op === "edit" ? "Comment changed." : "Comment deleted.", undone: "The comments are back as they were." }, true);
      return true;
    }
    let signPad = null, signFor = null, signBusy = false;
    const signSay = (text) => {
      el.signStatus.textContent = text;
    };
    async function openSignDialog() {
      if (!pdf || !pdfNote || !NotesSignPad || signBusy || el.signDialog.open) return;
      signBusy = true;
      try {
        if (!signPad) signPad = NotesSignPad.create(el.signPad);
        let saved = null;
        try {
          saved = await api.signature.get();
        } catch (_) {
          saved = null;
        }
        if (!pdfNote) return;
        signFor = pdfNote.id;
        signSay("");
        el.signName.value = "";
        el.signDialog.showModal();
        signPad.fit();
        el.signRemember.checked = !!saved;
        el.signForgetBtn.classList.toggle("hidden", !saved);
        if (saved) await signPad.load(new Blob([saved], { type: "image/png" })).catch(() => signPad.clear());
      } finally {
        signBusy = false;
      }
    }
    async function placeSignature() {
      if (signBusy) return;
      signBusy = true;
      try {
        const blob = signPad && await signPad.toBlob();
        if (!blob) {
          signSay("Draw your signature, or type your name and press Write it.");
          return;
        }
        el.signDialog.close();
        if (el.signRemember.checked) {
          const kept = await callOk(api.signature.set(new Uint8Array(await blob.arrayBuffer())));
          if (!kept.ok) toast("Could not remember the signature: " + kept.error);
        }
        if (!pdf || !pdfNote || pdfNote.id !== signFor) {
          toast("The PDF changed while you signed, so the signature was not placed.");
          return;
        }
        if (await pdf.placePicture(new File([blob], "signature.png", { type: "image/png" }))) toast("Signature placed. Drag it where it goes, or drag a corner to resize it.");
        else toast("This PDF does not allow changes.");
      } finally {
        signBusy = false;
      }
    }
    function onPdfToolbarClick(e) {
      const b = e.target.closest("button");
      if (!b || !pdf || !pdfNote) return;
      if (b.dataset.pdfMode) {
        if (!pdf.setMode(b.dataset.pdfMode)) toast("This PDF does not allow changes.");
        return;
      }
      const act = b.dataset.pdfAct;
      if (act === "undo") pdf.undo();
      else if (act === "redo") pdf.redo();
      else if (act === "zoom-in") pdf.zoomIn();
      else if (act === "zoom-out") pdf.zoomOut();
      else if (act === "fit") pdf.fitWidth();
      else if (act === "pages") openPdfPages();
      else if (act === "sign") openSignDialog();
      else if (act === "comments") showPdfComments(!pdfCommentsShown());
      else if (b === el.pdfSaveBtn) flushPdf({ commit: true, explicit: true });
    }
    async function commitPdf() {
      if (pdf && pdfNote) await pdf.commit();
    }
    function pdfOpen() {
      return !!pdfNote;
    }
    function forgetShownPdf() {
      pdfShownKey = null;
    }
    function bindPdfEvents() {
      el.pdfEditor.querySelector(".pdf-toolbar").addEventListener("click", onPdfToolbarClick);
      el.pdfCommentsClose.addEventListener("click", () => showPdfComments(false));
      el.signForm.addEventListener("submit", (e) => {
        e.preventDefault();
        placeSignature();
      });
      el.signClearBtn.addEventListener("click", () => {
        if (signPad) signPad.clear();
        signSay("");
      });
      el.signTypeBtn.addEventListener("click", () => {
        if (signPad && signPad.writeName(el.signName.value)) signSay("");
        else signSay("Type your name first.");
      });
      el.signName.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          el.signTypeBtn.click();
        }
      });
      el.signCancelBtn.addEventListener("click", () => el.signDialog.close());
      el.signForgetBtn.addEventListener("click", async () => {
        const r = await callOk(api.signature.forget());
        if (!r.ok) {
          signSay("Could not forget the signature: " + r.error);
          return;
        }
        el.signForgetBtn.classList.add("hidden");
        el.signRemember.checked = false;
        if (signPad) signPad.clear();
        signSay("The saved signature is gone from this PC.");
      });
    }
    return { clearPdf, showPdf, pdfDirty, pdfBusy, flushPdf, reportFileSaved, closePdfPages, commitPdf, pdfOpen, forgetShownPdf, bindPdfEvents };
  }

  // src/renderer/craft-notes.js
  var import_helpers16 = __toESM(require_helpers());
  function createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow }) {
    const CRAFT_UI = {
      wordcraft: { label: "WordCraft", what: "Word document", frame: () => el.wordcraftFrame, bytes: (id) => api.files.docxBytes(id), openWith: "Word", without: "Word documents open in the simple editor for now." },
      gridcraft: { label: "GridCraft", what: "spreadsheet", frame: () => el.gridcraftFrame, bytes: (id) => api.files.documentBytes(id), openWith: "Excel", without: "spreadsheets cannot be shown for now." }
    };
    function craftViewer(key) {
      const ui = CRAFT_UI[key];
      const frame = () => ui.frame();
      let fc = null, note = null, shownKey = null, seq = 0, down = false;
      const usable = () => !!(state.info && state.info.crafts && state.info.crafts[key]) && !GUEST && !down;
      function controller() {
        if (!fc) {
          fc = NotesCraftFrame.create({
            frame: frame(),
            origin: key + "://app",
            url: key + "://app/index.html?host",
            onSave: saveFromFrame,
            onDirty: (d) => {
              if (note && state.currentId === note.id) setSaved(d ? "Edited" : "Saved");
            },
            onOpened: () => {
              frame().classList.remove("is-opening");
              if (note && state.currentId === note.id) showBanner("");
            },
            onOpenFailed: (err) => {
              clear();
              showBanner(ui.label + " could not open this " + ui.what + ": " + err + '. Use "Open with\u2026" to open it in ' + ui.openWith + ".");
            },
            // The Craft apps are always dark: dark chrome and a dark page, whatever Notes' own theme (the user's choice,
            // 2026-10-19). The page's darkness is only how the app shows it; the file is unchanged.
            theme: "dark",
            darkPage: true,
            // The build is there but did not start: its documents do without it until Notes restarts.
            onUnavailable: () => {
              down = true;
              clear();
              const n = state.current;
              if (n && n.filePath && import_helpers16.default.CRAFT_OF[n.fileKind] === key) renderFileRow(n);
              toast(ui.label + " did not start, so " + ui.without);
            }
          });
        }
        return fc;
      }
      async function show(n) {
        const k = n.id + ":" + n.fileMtime;
        frame().classList.remove("hidden");
        if (shownKey === k) return;
        shownKey = k;
        const s = ++seq;
        note = null;
        if (fc) fc.close();
        frame().classList.add("is-opening");
        showBanner("Opening in " + ui.label + "\u2026");
        try {
          const bytes = await ui.bytes(n.id);
          if (s !== seq || !state.current || state.current.id !== n.id) return;
          const name = n.filePath.split(/[\\/]/).pop();
          note = { id: n.id, fileMtime: n.fileMtime, name };
          controller().open(name, bytes, note);
        } catch (err) {
          if (s !== seq) return;
          clear();
          showBanner("Could not open this " + ui.what + " in " + ui.label + ": " + ipcErrorText(err) + ' Use "Open with\u2026" to open it in ' + ui.openWith + ".");
        }
      }
      function clear() {
        seq++;
        shownKey = null;
        note = null;
        if (fc) fc.close();
        frame().classList.add("hidden");
      }
      async function saveFromFrame(name, bytes, target) {
        if (!target) return { ok: false, own: true };
        try {
          const r = await api.files.saveCraft(target.id, bytes, name, target.fileMtime);
          if (r.exported) {
            const copy = r.exported.split(/[\\/]/).pop();
            toast(r.own ? "Saved as " + copy + " beside this file, which is unchanged." : "Saved " + copy + " next to the " + ui.what + ".", { label: "Open", run: () => openFiles([r.exported]) });
            return { ok: true, own: !!r.own };
          }
          if (r.relinked) {
            movedTo(target, r);
            return { ok: true, own: true };
          }
          if (!r.savedAs) {
            target.fileMtime = r.mtime;
            if (note === target) shownKey = target.id + ":" + r.mtime;
          }
          reportFileSaved(target, r, false, ui.what);
          return { ok: true, own: true };
        } catch (err) {
          toast("Could not save the " + ui.what + ": " + ipcErrorText(err));
          return { ok: false, own: true };
        }
      }
      function movedTo(target, r) {
        target.fileMtime = r.mtime;
        toast("Saved as " + r.relinked.split(/[\\/]/).pop() + " beside the original, which is unchanged. This note is that file now.");
        setTimeout(async () => {
          const fresh = await api.notes.get(target.id);
          await refresh({ keepEditor: true });
          if (!fresh || !state.current || state.current.id !== fresh.id) return;
          state.current = fresh;
          el.titleInput.value = fresh.title;
          shownKey = null;
          renderFileRow(fresh);
        }, 0);
      }
      const dirty = () => !!(fc && note && fc.isDirty());
      const flush = async () => dirty() ? fc.requestSave(15e3) : true;
      const forget = () => {
        shownKey = null;
      };
      return { usable, show, clear, dirty, flush, forget };
    }
    const crafts = Object.fromEntries(Object.keys(CRAFT_UI).map((key) => [key, craftViewer(key)]));
    const useWordCraft = () => crafts.wordcraft.usable();
    const craftFor = (n) => n && n.filePath && import_helpers16.default.CRAFT_OF[n.fileKind] ? crafts[import_helpers16.default.CRAFT_OF[n.fileKind]] : null;
    const craftDirty = () => Object.values(crafts).some((c) => c.dirty());
    async function flushCrafts() {
      let ok = true;
      for (const c of Object.values(crafts)) ok = await c.flush() && ok;
      return ok;
    }
    function showCraftOnly(n) {
      const key = import_helpers16.default.CRAFT_OF[n.fileKind];
      if (crafts[key].usable()) {
        showBanner("");
        crafts[key].show(n);
        return;
      }
      showBanner("Notes shows ." + import_helpers16.default.extOf(n.filePath) + " files in " + CRAFT_UI[key].label + ', which is not available right now. Use "Open with\u2026" to open it in ' + CRAFT_UI[key].openWith + ".");
    }
    return { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly };
  }

  // src/renderer/word-note.js
  var import_helpers17 = __toESM(require_helpers());
  function createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft }) {
    const DOCX_FRAME = `<!doctype html><html><head><meta charset="utf-8"><meta name="notes-docx-frame"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><style>html, body { margin: 0; } html body .docx-wrapper { background: #e9e4da; padding: 16px; align-items: safe center; } html body .docx-wrapper > section.docx { box-shadow: none; }</style></head><body></body></html>`;
    let docxShownKey = null;
    let docxSeq = 0;
    let docx = null, docxNote = null, docxBanner = "";
    function clearDocx() {
      crafts.wordcraft.clear();
      docxShownKey = null;
      docxSeq++;
      docxNote = null;
      if (docx) docx.close();
      el.docxEditor.classList.add("hidden");
      el.docxView.removeAttribute("srcdoc");
    }
    function freshDocxFrame() {
      return new Promise((resolve) => {
        const onLoad = () => {
          const doc = el.docxView.contentDocument;
          if (!doc || !doc.querySelector('meta[name="notes-docx-frame"]')) return;
          el.docxView.removeEventListener("load", onLoad);
          resolve(doc);
        };
        el.docxView.addEventListener("load", onLoad);
        el.docxView.srcdoc = DOCX_FRAME;
      });
    }
    function onDocxLinkClick(e) {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#")) {
        const doc = a.ownerDocument, name = decodeURIComponent(href.slice(1));
        const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
        if (target) target.scrollIntoView();
        return;
      }
      externalLinkClick(e, href);
    }
    function docxController() {
      if (!docx && NotesDocxEditor) {
        docx = NotesDocxEditor.create({
          onDirty: (d) => {
            el.docxSaveBtn.textContent = d ? "Save" : "Saved";
          },
          say: toast,
          onBlur: () => flushSave({ fromBlur: true }),
          // Keys pressed in the document never reach this page: Ctrl+S saves, Escape hides the window as elsewhere.
          onKey: (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
              e.preventDefault();
              flushDocx({ explicit: true });
            } else if (e.key === "Escape" && !e.isComposing) {
              e.preventDefault();
              flushSave().then(() => api.app.hide());
            }
          }
        });
      }
      return docx;
    }
    function docxBannerFor(res) {
      const fixed = res.readOnly ? " " + res.readOnly + (res.readOnly === 1 ? " paragraph has" : " paragraphs have") + ' links, charts, text boxes, tracked changes or similar, and cannot be edited here; use "Open with\u2026" for those.' : "";
      if (res.editable) return "Click into the text to edit it. Ctrl+B, Ctrl+I and Ctrl+U (or the buttons) set bold, italic and underline. Save (Ctrl+S) writes your changes into the document, and the original is backed up first." + fixed;
      return "Word document, shown as laid out in the file. It cannot be edited here: " + (res.block || "none of its text is plain enough for Notes to write back safely") + '. Use "Open with\u2026" to edit it in Word.';
    }
    async function showDocx(note) {
      if (useWordCraft()) {
        crafts.wordcraft.show(note);
        return;
      }
      if (!import_helpers17.default.isOoxmlWordFile(note)) {
        el.docxEditor.classList.add("hidden");
        showBanner("Notes shows ." + import_helpers17.default.extOf(note.filePath) + ' files in WordCraft, which is not available right now. Use "Open with\u2026" to open it in Word.');
        return;
      }
      const key = note.id + ":" + note.fileMtime;
      if (docxShownKey === key) {
        if (docxBanner) showBanner(docxBanner);
        return;
      }
      docxShownKey = key;
      docxNote = null;
      docxBanner = "";
      const seq = ++docxSeq;
      try {
        const [doc, bytes] = await Promise.all([freshDocxFrame(), api.files.docxBytes(note.id)]);
        if (seq !== docxSeq) return;
        doc.addEventListener("click", onDocxLinkClick);
        const ctl = docxController();
        if (!ctl) throw new Error("the Word editor did not load.");
        const res = await ctl.open(doc, bytes);
        if (seq !== docxSeq || !res) return;
        if (ctl.isEditable()) docxNote = { id: note.id, fileMtime: note.fileMtime };
        el.docxEditor.classList.toggle("read-only", !ctl.isEditable());
        docxBanner = docxBannerFor(res);
        if (state.current && state.current.id === note.id) showBanner(docxBanner);
      } catch (err) {
        if (seq !== docxSeq) return;
        docxShownKey = null;
        el.docxView.removeAttribute("srcdoc");
        showBanner("Could not show this Word document: " + ipcErrorText(err) + ' Use "Open with\u2026" to open it in Word.');
      }
    }
    const docxDirty = () => !!(docx && docxNote && docx.isDirty());
    const flushDocx = oneAtATime(async (opts) => {
      let explicit = !!opts.explicit;
      for (let i = 0; i < 3; i++) {
        if (!docxDirty()) return true;
        if (!await saveDocxNow(explicit)) return false;
        explicit = false;
      }
      return !docxDirty();
    });
    async function saveDocxNow(explicit) {
      const target = docxNote;
      let c;
      try {
        c = docx.save();
      } catch (err) {
        toast("Could not save the document: " + (err.message || err) + ". Your changes are still here; use Reload to start again from the file.");
        return false;
      }
      if (!c) return true;
      try {
        const r = await api.files.saveDocx(target.id, c.patches, target.fileMtime);
        if (docxNote !== target) return true;
        const inPlace = reportFileSaved(target, r, explicit, "document");
        if (inPlace) docxShownKey = target.id + ":" + r.mtime;
        const synced = docx.markSaved();
        if (!synced.ok) {
          docxShownKey = null;
          if (state.current && state.current.id === target.id) showDocx(state.current);
          toast(synced.lost ? "Saved. The document is shown again from the file, so what you typed while it saved is not in it; please type that again." : "Saved. The document is shown again from the file.");
        }
        return true;
      } catch (err) {
        docx.saveFailed();
        toast("Could not save the document: " + ipcErrorText(err) + " Your changes are still here.");
        return false;
      }
    }
    function onDocxToolbarClick(e) {
      const b = e.target.closest("button");
      if (!b || !docx || !docxNote) return;
      if (b === el.docxSaveBtn) {
        flushDocx({ explicit: true });
        return;
      }
      if (b.dataset.docxAct) docx.exec(b.dataset.docxAct);
    }
    function docxOpen() {
      return !!docxNote;
    }
    function forgetShownDocx() {
      docxShownKey = null;
    }
    function bindDocxEvents() {
      const docxTools = el.docxEditor.querySelector(".docx-toolbar");
      docxTools.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) e.preventDefault();
      });
      docxTools.addEventListener("click", onDocxToolbarClick);
    }
    return { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents };
  }

  // src/renderer/images.js
  function createImages({ api, showBanner }) {
    let imageUrl = null, imageSeq = 0;
    async function showImage(note) {
      const seq = ++imageSeq;
      el.imageView.removeAttribute("src");
      el.imageViewer.classList.remove("hidden", "is-actual");
      syncImageToggle();
      try {
        const { bytes, mime } = await api.files.imageBytes(note.id);
        if (seq !== imageSeq || !state.current || state.current.id !== note.id) return;
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        el.imageView.alt = note.title;
        el.imageView.src = imageUrl;
      } catch (err) {
        if (seq !== imageSeq) return;
        clearImage();
        showBanner("Could not show this image: " + ipcErrorText(err) + ' Use "Open with\u2026" to open it.');
      }
    }
    function clearImage() {
      imageSeq++;
      el.imageViewer.classList.add("hidden");
      el.imageView.removeAttribute("src");
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
        imageUrl = null;
      }
    }
    function toggleImageSize() {
      el.imageViewer.classList.toggle("is-actual");
      syncImageToggle();
    }
    function syncImageToggle() {
      const actual = el.imageViewer.classList.contains("is-actual");
      el.imageView.setAttribute("aria-pressed", String(actual));
      el.imageView.title = actual ? "Actual size. Click or press Enter to fit it to the pane." : "Fitted to the pane. Click or press Enter for its actual size.";
      const w = el.imageView.naturalWidth, h = el.imageView.naturalHeight;
      if (!w || el.imageViewer.classList.contains("hidden")) return;
      el.statusCode.textContent = w + " \xD7 " + h + " px, " + (actual ? "actual size" : "fitted");
      el.statusCode.classList.remove("hidden");
      el.imageView.setAttribute("aria-label", (state.current ? state.current.title + ", " : "") + w + " by " + h + " pixels, " + (actual ? "actual size" : "fitted to the pane"));
    }
    return { showImage, clearImage, toggleImageSize, syncImageToggle };
  }

  // src/renderer/convert-menu.js
  function createConvertMenu({ api, flushSave, openFiles }) {
    async function openConvertMenu() {
      const note = state.current;
      if (!note || !note.filePath) return;
      let opts;
      try {
        opts = await api.files.convertOptions(note.id);
      } catch (err) {
        toast("Could not convert: " + ipcErrorText(err));
        return;
      }
      if (state.currentId !== note.id) return;
      if (!opts.length) {
        toast("Notes cannot convert this kind of file.");
        return;
      }
      el.convertMenu.replaceChildren(...opts.map((o) => {
        const b = document.createElement("button");
        b.setAttribute("role", "menuitem");
        b.dataset.to = o.to;
        b.append(o.label);
        if (o.note) {
          const n = document.createElement("span");
          n.className = "menu-note";
          n.textContent = o.note;
          b.append(n);
        }
        return b;
      }));
      placePopover(el.convertMenu, el.fileConvertBtn);
      el.convertMenu.querySelector("button").focus();
    }
    function closeConvertMenu() {
      el.convertMenu.classList.add("hidden");
    }
    let converting = false;
    async function convertCurrent(to) {
      closeConvertMenu();
      const note = state.current;
      if (!note || !note.filePath || converting) return;
      converting = true;
      el.fileConvertBtn.disabled = true;
      try {
        await flushSave();
        toast("Converting\u2026");
        const r = await api.files.convert(note.id, to);
        if (!r.ok) {
          toast("Could not convert: " + r.error);
          return;
        }
        const name = r.filePath.split(/[\\/]/).pop();
        toast("Saved " + name + " next to the original." + (r.warning ? " " + r.warning : ""), { label: "Open", run: () => openFiles([r.filePath]) });
      } catch (err) {
        toast("Could not convert: " + ipcErrorText(err));
      } finally {
        converting = false;
        el.fileConvertBtn.disabled = false;
      }
    }
    return { openConvertMenu, closeConvertMenu, convertCurrent };
  }

  // src/renderer/editor-text.js
  function createEditorText({ runFind, scheduleSave }) {
    function wrapSelection(before, after) {
      const ta = el.bodyInput;
      if (ta.readOnly) return;
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const selected = value.slice(s, e);
      const already = value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after;
      if (already) {
        ta.setRangeText(selected, s - before.length, e + after.length, "select");
      } else {
        ta.setRangeText(before + selected + after, s, e, "select");
        ta.setSelectionRange(s + before.length, s + before.length + selected.length);
      }
      scheduleSave();
    }
    function handleEditorKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (find.open && e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        runFind(!e.shiftKey);
        return;
      }
      const ta = el.bodyInput;
      if (e.key === "Tab" && e.shiftKey) {
        const value = ta.value;
        const lineStart = value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
        const indent = /^( {1,2}|\t)/.exec(value.slice(lineStart));
        if (!indent || ta.readOnly) return;
        e.preventDefault();
        const caret = ta.selectionStart;
        ta.setRangeText("", lineStart, lineStart + indent[0].length, "preserve");
        ta.setSelectionRange(Math.max(lineStart, caret - indent[0].length), Math.max(lineStart, caret - indent[0].length));
        scheduleSave();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (ta.readOnly) return;
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
        scheduleSave();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !ta.readOnly) {
        const value = ta.value;
        const lineStart = value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
        const line = value.slice(lineStart, ta.selectionStart);
        const m = /^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?(.*)$/.exec(line);
        if (!m) return;
        e.preventDefault();
        if (!m[4].trim() && !m[3]) {
          ta.setRangeText("", lineStart, ta.selectionStart, "end");
        } else if (!m[4].trim() && m[3]) {
          ta.setRangeText("", lineStart, ta.selectionStart, "end");
        } else {
          const marker = /^\d+/.test(m[2]) ? parseInt(m[2], 10) + 1 + m[2].slice(-1) : m[2];
          ta.setRangeText("\n" + m[1] + marker + " " + (m[3] ? "[ ] " : ""), ta.selectionStart, ta.selectionEnd, "end");
        }
        scheduleSave();
      }
    }
    return { wrapSelection, handleEditorKeydown };
  }

  // src/renderer/app.js
  (function() {
    "use strict";
    const api = withPeerNotice(window.notesApi, peerChanged);
    const { isViewerOnlyFile: isViewerOnlyFile8, isPlainTextFile: isPlainTextFile5, isNonMarkdownFile: isNonMarkdownFile3 } = import_helpers18.default;
    function effectiveTheme(settings) {
      const s = settings || state.settings;
      const t = s ? s.theme : "system";
      if (t === "light" || t === "dark") return t;
      return state.systemDark ? "dark" : "light";
    }
    function applyTheme(settings) {
      const theme = effectiveTheme(settings);
      document.documentElement.dataset.theme = theme;
      applyColorScheme(theme, settings || state.settings);
      syncTitleBar();
    }
    function applyColorScheme(mode, settings) {
      const tokens = import_themes.default.resolve(settings, mode);
      const style = document.documentElement.style;
      for (const name of import_themes.default.TOKENS) {
        if (tokens) style.setProperty("--" + name, tokens[name]);
        else style.removeProperty("--" + name);
      }
    }
    function applySettings(settings, opts) {
      state.settings = settings;
      applyTheme();
      document.documentElement.style.setProperty("--editor-font-size", settings.fontSize + "px");
      applySidebar();
      el.tagList.classList.toggle("hidden", !!settings.tagsCollapsed);
      el.tagsFold.setAttribute("aria-expanded", String(!settings.tagsCollapsed));
      el.tagsFold.classList.toggle("is-folded", !!settings.tagsCollapsed);
      syncListCollapsed();
      el.sortSelect.value = settings.sort;
      applyPaneWidths(settings.sidebarWidth, settings.listWidth);
      applyEditorLayout(settings);
      if (el.settingsDialog.open && settingsDirty()) previewSettings();
      if (opts && opts.fromPeer) return;
      if (import_helpers18.default.isTableFile(state.current)) return;
      const forcedSource = state.currentLossless === false && state.lossyOverride !== state.currentId || !state.rich || isPlainTextFile5(state.current);
      const wantSource = settings.editorMode === "source" || forcedSource;
      if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
    }
    function syncTitleBar() {
      if (GUEST) return;
      const css = getComputedStyle(document.documentElement);
      const color = css.getPropertyValue("--base").trim();
      const symbol = css.getPropertyValue("--fg").trim();
      const wco = navigator.windowControlsOverlay;
      const rect = wco && wco.visible ? wco.getTitlebarAreaRect() : null;
      const w = rect ? Math.max(0, Math.round(window.innerWidth - rect.x - rect.width)) : 0;
      const key = color + symbol + w + hasPeer();
      if (key === titleBarKey) return;
      titleBarKey = key;
      if (api.app.titleBar) api.app.titleBar({ color, symbol }).catch(() => {
      });
      document.documentElement.style.setProperty("--caption-w", w + "px");
      if (hasPeer()) toPeer({ type: "caption", w });
    }
    let titleBarKey = "";
    function applyEditorLayout(settings) {
      el.editorColumn.classList.remove("align-left", "align-center", "align-right");
      el.editorColumn.classList.add("align-" + settings.editorAlign);
      el.editorColumn.classList.toggle("full-width", !settings.editorWidth);
      el.editorColumn.style.setProperty("--editor-col-width", (settings.editorWidth || 760) + "px");
    }
    const NARROW_W = 1e3;
    const PEEK_EDGE_PX = 24;
    let sidebarPeek = null;
    let peekTimer = null;
    const isNarrow = () => window.innerWidth < NARROW_W;
    function sidebarLayout() {
      if (state.settings && state.settings.sidebarCollapsed) return "float";
      return isNarrow() ? "float" : "docked";
    }
    function sidebarHidden() {
      return sidebarLayout() !== "docked";
    }
    function applySidebar() {
      const layout = sidebarLayout();
      if (layout !== "float") sidebarPeek = null;
      el.app.classList.toggle("sidebar-collapsed", layout !== "docked");
      el.app.classList.toggle("sidebar-float", layout === "float");
      el.app.classList.toggle("sidebar-peek", layout === "float" && !!sidebarPeek);
      el.toggleSidebarBtn.classList.toggle("is-on", layout === "docked");
      el.toggleSidebarBtn.title = layout === "docked" ? "Hide the sidebar (Ctrl+\\). Point at the window\u2019s left edge to bring it back." : "Show the sidebar (Ctrl+\\)";
      const home = layout === "docked" ? el.sidebarTop : el.tabBar;
      if (el.barToggles.parentElement !== home) home.prepend(el.barToggles);
    }
    function peekSidebar(how) {
      if (GUEST || sidebarLayout() !== "float") return;
      clearTimeout(peekTimer);
      if (sidebarPeek === "sticky" && how === "hover") return;
      const fromKeyboard = how === "sticky" && !el.sidebar.contains(document.activeElement);
      sidebarPeek = how;
      applySidebar();
      if (fromKeyboard) {
        peekReturn = document.activeElement;
        const target = el.sidebar.querySelector(".nav-item.is-active, .folder-row.is-active") || el.newNoteBtn;
        setTimeout(() => {
          if (!state.editingFolder && !el.sidebar.contains(document.activeElement)) target.focus();
        }, 0);
      }
    }
    let peekReturn = null;
    function unpeekSidebar() {
      clearTimeout(peekTimer);
      if (!sidebarPeek) return;
      sidebarPeek = null;
      applySidebar();
      const back = peekReturn;
      peekReturn = null;
      if (el.sidebar.contains(document.activeElement)) {
        if (back && back.isConnected && !el.sidebar.contains(back)) back.focus();
        else if (state.current) focusBody();
      }
    }
    function showSidebar() {
      if (sidebarLayout() === "float") peekSidebar("sticky");
    }
    function toggleSidebar() {
      if (GUEST) {
        toPeer({ type: "command", name: "toggleSidebar" });
        return;
      }
      if (isNarrow()) {
        if (sidebarPeek) unpeekSidebar();
        else peekSidebar("sticky");
        return;
      }
      const collapsed = !!state.settings.sidebarCollapsed;
      sidebarPeek = null;
      updateSettings({ sidebarCollapsed: !collapsed });
    }
    function bindSidebarFloat() {
      if (GUEST) return;
      const busy = () => state.editingFolder || state.menuFolderId || document.body.classList.contains("is-resizing") || el.sidebar.contains(document.activeElement) && document.activeElement.matches("input, textarea, select");
      let nearEdge = false;
      const leaveSoon = () => {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(function check() {
          if (sidebarPeek !== "hover" || nearEdge || el.sidebar.matches(":hover")) return;
          if (busy()) {
            peekTimer = setTimeout(check, 500);
            return;
          }
          unpeekSidebar();
        }, 350);
      };
      document.addEventListener("mousemove", (e) => {
        const overSidebar = el.sidebar.contains(e.target);
        const near = e.clientX <= PEEK_EDGE_PX;
        if (near && !sidebarPeek) {
          clearTimeout(peekTimer);
          peekTimer = setTimeout(() => peekSidebar("hover"), 90);
        }
        if (near === nearEdge) return;
        nearEdge = near;
        if (near || overSidebar) return;
        if (sidebarPeek === "hover") leaveSoon();
        else if (!sidebarPeek) clearTimeout(peekTimer);
      });
      el.sidebarEdge.addEventListener("dragenter", () => peekSidebar("hover"));
      el.sidebar.addEventListener("mouseenter", () => {
        if (sidebarPeek === "hover") clearTimeout(peekTimer);
      });
      el.sidebar.addEventListener("mouseleave", () => {
        if (sidebarPeek === "hover") leaveSoon();
      });
      document.addEventListener("pointerdown", (e) => {
        if (!sidebarPeek || el.sidebar.contains(e.target) || el.sidebarEdge.contains(e.target) || el.barToggles.contains(e.target) || el.folderMenu.contains(e.target)) return;
        unpeekSidebar();
      }, true);
    }
    function paneBudget() {
      return Math.max(0, window.innerWidth - import_helpers18.default.EDITOR_MIN);
    }
    function fitPaneWidths(sidebar, list) {
      sidebar = import_helpers18.default.clampPane("sidebarWidth", sidebar);
      list = import_helpers18.default.clampPane("listWidth", list);
      const sidebarShown = sidebarHidden() ? 0 : sidebar;
      const over = sidebarShown + list - paneBudget();
      if (over > 0) {
        const listGive = Math.min(over, list - import_helpers18.default.PANE_LIMITS.listWidth.min);
        list -= listGive;
        const rest = over - listGive;
        if (rest > 0 && sidebarShown) sidebar = Math.max(import_helpers18.default.PANE_LIMITS.sidebarWidth.min, sidebar - rest);
      }
      return { sidebar, list };
    }
    function applyPaneWidths(sidebar, list) {
      const fit = fitPaneWidths(sidebar, list);
      el.app.style.setProperty("--sidebar-w", fit.sidebar + "px");
      el.app.style.setProperty("--list-w", fit.list + "px");
      return fit;
    }
    function currentPaneWidths() {
      return {
        sidebar: parseInt(el.app.style.getPropertyValue("--sidebar-w"), 10) || import_helpers18.default.PANE_LIMITS.sidebarWidth.def,
        list: parseInt(el.app.style.getPropertyValue("--list-w"), 10) || import_helpers18.default.PANE_LIMITS.listWidth.def
      };
    }
    function setupResizer(handle, key) {
      const other = key === "sidebarWidth" ? "list" : "sidebar";
      const mine = key === "sidebarWidth" ? "sidebar" : "list";
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const start = currentPaneWidths();
        const startX = e.clientX;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add("is-dragging");
        document.body.classList.add("is-resizing");
        let latest = start[mine];
        const onMove = (ev) => {
          const widths = { sidebar: start.sidebar, list: start.list };
          widths[mine] = start[mine] + (ev.clientX - startX);
          const fit = applyPaneWidths(widths.sidebar, widths.list);
          latest = fit[mine];
          if (fit[other] !== start[other]) start[other] = fit[other];
        };
        const onUp = () => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", onUp);
          handle.removeEventListener("pointercancel", onUp);
          handle.classList.remove("is-dragging");
          document.body.classList.remove("is-resizing");
          const widths = currentPaneWidths();
          updateSettings({ sidebarWidth: widths.sidebar, listWidth: widths.list });
        };
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        handle.addEventListener("pointercancel", onUp);
      });
      handle.addEventListener("dblclick", () => {
        const patch = {};
        patch[key] = import_helpers18.default.PANE_LIMITS[key].def;
        updateSettings(patch);
      });
    }
    function applyInfo(info) {
      state.info = info;
      const text = info.hotkeyRegistered ? info.hotkeyDisplay : "hotkey unavailable";
      el.hotkeyHint.textContent = text;
      el.hotkeyHint2.textContent = text;
      el.settingsInfo.textContent = "Data: " + info.dataDir + (info.hotkeyFallback ? "   (preferred hotkey was taken; using " + info.hotkeyDisplay + ")" : "");
      if (info.saveBlocked) toast("Your notes file could not be read (it may be locked by another program). Saving is paused so nothing is overwritten; restart Notes once it is free.");
      else if (info.loadError && info.recoveredNotes) toast("Notes file was damaged; restored " + info.recoveredNotes + (info.recoveredNotes === 1 ? " note" : " notes") + " from the newest backup. The damaged file was kept beside it.");
      else if (info.loadError) toast("Notes file was damaged and no backup was found. The damaged file was kept beside notes.json.");
    }
    async function updateSettings(patch) {
      const res = await api.settings.set(patch);
      applySettings(res.settings);
      applyInfo(res.info);
      toPeer({ type: "settings", settings: res.settings });
      return res;
    }
    async function refresh(opts) {
      opts = opts || {};
      const listOpts = { query: state.query, sort: state.settings.sort };
      if (state.view === "trash") listOpts.trashed = true;
      else if (state.query) {
      } else if (state.view === "pinned") listOpts.pinned = true;
      else if (state.view === "reminders") listOpts.reminders = true;
      else if (state.view === "tag") listOpts.tag = state.tag;
      else if (state.view === "folder") listOpts.folderId = state.folderId;
      const wantTree = state.settings.listMode === "tree" && !state.query && (state.view === "all" || state.view === "folder");
      const [notes, counts, tags, tree, folderPath, outline] = await Promise.all([
        api.notes.list(listOpts),
        api.notes.counts(),
        api.notes.tags(),
        api.folders.tree(),
        state.view === "folder" ? api.folders.path(state.folderId) : Promise.resolve([]),
        wantTree ? api.notes.outline(state.settings.sort) : Promise.resolve(null)
      ]);
      state.notes = notes;
      state.outline = outline;
      state.tree = tree;
      state.folderPath = folderPath;
      if (state.view === "folder" && !folderPath.length) {
        state.view = "all";
        state.folderId = null;
        if (state.settings.lastFolderId && !GUEST) updateSettings({ lastFolderId: null }).catch(() => {
        });
        el.navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.view === "all"));
        return refresh(opts);
      }
      renderCounts(counts);
      renderTags(tags);
      renderFolders();
      renderFolderSelect();
      renderList();
      if (state.current && (book.id || bookOf(state.current))) renderBookStrip(state.current);
      const inList = treeModeActive() ? inTreeScope(state.currentId) : notes.some((n) => n.id === state.currentId);
      if (!inList && !opts.keepEditor) {
        const tabId = tabs.ids[tabs.at];
        if (!state.currentId && tabId) await selectNote(tabId);
        else if (GUEST) {
        } else if (tabs.split && tabs.active === "right") {
          if (notes.length && !notes.some((n) => n.id === tabs.peerCurrent)) openNote(notes[0].id);
        } else if (notes.length) await selectNote(notes[0].id);
        else clearEditor();
      } else if (inList) {
        const fresh = notes.find((n) => n.id === state.currentId);
        if (fresh && !state.dirty) updateStatus(fresh);
      }
    }
    function renderCounts(c) {
      el.countAll.textContent = c.all;
      el.countPinned.textContent = c.pinned;
      el.countTrash.textContent = c.trash;
      el.countReminders.textContent = c.reminders;
      for (const b of [el.countPinned, el.countTrash, el.countReminders]) b.classList.toggle("is-zero", b.textContent === "0");
      el.countReminders.classList.toggle("is-overdue", !!c.overdue);
    }
    function renderTags(tags) {
      el.tagList.innerHTML = "";
      if (!tags.length) {
        const d = document.createElement("div");
        d.className = "tags-empty";
        d.textContent = "Add tags to a note to see them here.";
        el.tagList.append(d);
        return;
      }
      for (const { tag, count } of tags) {
        const b = document.createElement("button");
        b.className = "nav-item" + (state.view === "tag" && state.tag === tag ? " is-active" : "");
        b.innerHTML = '<span></span><span class="count"></span>';
        b.firstChild.textContent = tag;
        b.lastChild.textContent = count;
        b.addEventListener("click", () => setView("tag", tag));
        el.tagList.append(b);
      }
    }
    function renderList() {
      const q = state.query;
      const tree = treeModeActive();
      el.noteList.innerHTML = "";
      const empty = tree ? !treeHasContent() : !state.notes.length;
      el.noteList.classList.toggle("hidden", tree || empty);
      el.noteTree.classList.toggle("hidden", !tree || empty);
      el.listModeSeg.classList.toggle("hidden", !treeModePossible());
      syncListModeSeg();
      el.listEmpty.classList.toggle("hidden", !empty);
      if (empty) renderListEmpty();
      el.emptyTrashBtn.classList.toggle("hidden", !(state.view === "trash" && state.notes.length));
      const titles = { all: "All notes", pinned: "Pinned", trash: "Trash", reminders: "Reminders", tag: "#" + state.tag };
      el.listTitle.innerHTML = "";
      if (q) el.listTitle.textContent = "Results";
      else if (state.view === "folder") {
        state.folderPath.forEach((p, i) => {
          if (i < state.folderPath.length - 1) {
            const crumb = document.createElement("span");
            crumb.className = "list-crumb";
            crumb.textContent = p.name + " / ";
            el.listTitle.append(crumb);
          } else el.listTitle.append(document.createTextNode(p.name));
        });
      } else el.listTitle.textContent = titles[state.view];
      if (tree) {
        renderNoteTree();
        return;
      }
      const viewingBook = state.view === "folder" && !!(flattenTree(state.tree).find((x) => x.id === state.folderId) || {}).book;
      const frag = document.createDocumentFragment();
      state.notes.forEach((n, i) => {
        const li = document.createElement("li");
        li.className = "note-row" + (n.id === state.currentId ? " is-active" : "");
        li.dataset.id = n.id;
        li.setAttribute("role", "option");
        li.title = import_helpers18.default.deriveTitle(n);
        li.innerHTML = rowInner(n, q);
        if (viewingBook && !q) {
          const no = document.createElement("span");
          no.className = "page-no";
          no.textContent = "p. " + (i + 1);
          li.prepend(no);
        }
        li.addEventListener("click", (e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey }));
        li.addEventListener("auxclick", (e) => {
          if (e.button === 1) {
            e.preventDefault();
            openNote(n.id, { newTab: true });
          }
        });
        if (!n.trashedAt) {
          li.draggable = true;
          li.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/x-note-id", n.id);
            e.dataTransfer.effectAllowed = "move";
            li.classList.add("is-dragging");
            toPeer({ type: "drag", id: n.id });
          });
          li.addEventListener("dragend", () => {
            li.classList.remove("is-dragging");
            toPeer({ type: "drag", id: null });
          });
        }
        frag.append(li);
      });
      el.noteList.append(frag);
    }
    function treeHasContent() {
      const out = state.outline || {};
      if (state.view !== "folder") return state.tree.length > 0 || (out[""] || []).length > 0;
      const node = flattenTree(state.tree).find((f) => f.id === state.folderId);
      return !!node && (node.children.length > 0 || (out[node.id] || []).length > 0);
    }
    function renderListEmpty() {
      const [title, sub] = state.query ? ["No matches", 'Nothing in this list has "' + state.query + '". Ctrl+P searches everything.'] : state.view === "trash" ? ["Trash is empty", "Notes you delete wait here until you empty the trash."] : state.view === "pinned" ? ["Nothing pinned", "Pin a note (Ctrl+D) to keep it at the top."] : state.view === "reminders" ? ["No reminders", "Set one from a note\u2019s More menu, or press Ctrl+Shift+M."] : state.view === "tag" ? ["No notes with this tag", ""] : state.view === "folder" ? ["This folder is empty", "Press Ctrl+N to write a note here."] : ["No notes yet", "Press Ctrl+N to write your first note."];
      el.listEmpty.querySelector(".empty-title").textContent = title;
      el.listEmpty.querySelector(".empty-sub").textContent = sub;
    }
    function reminderMark(n) {
      if (!n.remindAt || n.trashedAt) return "";
      const overdue = n.remindAt <= Date.now();
      return '<span class="row-meta remind-mark' + (overdue ? " is-overdue" : "") + '" title="' + (overdue ? "Reminder went off" : "Reminder") + '">' + I("bell") + escapeHtml(import_helpers18.default.formatWhen(n.remindAt)) + "</span>";
    }
    function rowInner(n, q) {
      const title = n.body === void 0 ? n.title : import_helpers18.default.deriveTitle(n);
      const fileMark = n.filePath ? '<span class="file-mark" title="' + escapeHtml(n.filePath) + '">' + escapeHtml(fileBadge(n)) + "</span>" : "";
      const marks = (n.pinned ? '<span class="row-mark pin" title="Pinned">' + I("star") + "</span>" : "") + (n.sticky ? '<span class="row-mark sticky-mark" title="On the desktop as a sticky">' + I("sticky-note") + "</span>" : "") + (n.locked ? '<span class="row-mark lock-mark" title="' + (n.unlocked ? "Locked (unlocked for now)" : "Locked") + '">' + I(n.unlocked ? "lock-open" : "lock") + "</span>" : "") + (n.live ? '<span class="row-mark live-mark" title="Live share' + (n.live.role ? " (" + n.live.role + ")" : "") + '">' + I("radio") + "</span>" : "");
      const inTitle = !q || import_helpers18.default.tokenize(q).some((t) => title.toLowerCase().includes(t));
      const why = inTitle || n.locked && !n.unlocked ? "" : '<span class="row-meta match">' + highlight(matchExcerpt(n, q), q) + "</span>";
      return '<span class="row-name">' + highlight(title, q) + "</span>" + why + marks + fileMark + reminderMark(n) + whereMark(n);
    }
    function matchExcerpt(n, q) {
      const body = String(n.body || "").replace(/\s+/g, " ");
      const low = body.toLowerCase();
      const at = import_helpers18.default.tokenize(q).map((t) => low.indexOf(t)).filter((i) => i !== -1).sort((a, b) => a - b)[0];
      if (at === void 0) return (n.tags || []).filter((t) => import_helpers18.default.tokenize(q).some((w) => t.toLowerCase().includes(w))).map((t) => "#" + t).join(" ") || import_helpers18.default.snippet(n, 80);
      const start = Math.max(0, at - 30);
      let text = body.slice(start, start + 80);
      if (start > 0) text = "\u2026" + text.replace(/^\S*\s/, "");
      if (start + 80 < body.length) text = text.replace(/\s\S*$/, "") + "\u2026";
      return text;
    }
    function whereMark(n) {
      if (!n.folderId || treeModeActive() || state.view === "folder" && !state.query) return "";
      const f = flattenTree(state.tree).find((x) => x.id === n.folderId);
      return f ? '<span class="row-meta where">' + I(f.book ? "book-open" : "folder") + escapeHtml(f.name) + "</span>" : "";
    }
    function refreshRow(note) {
      if (tabs.ids.includes(note.id)) {
        tabs.titles.set(note.id, import_helpers18.default.deriveTitle(note));
        renderActiveTabTitle();
      }
      if (state.outline) {
        const title = import_helpers18.default.deriveTitle(note);
        for (const list of Object.values(state.outline)) {
          const e = list.find((x) => x.id === note.id);
          if (e) {
            e.title = title;
            e.pinned = !!note.pinned;
          }
        }
        const row = el.noteTree.querySelector('.tree-note[data-id="' + note.id + '"]');
        if (row) {
          row.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span>' + rowInner(note, "");
          row.title = title;
        }
      }
      const li = el.noteList.querySelector('.note-row[data-id="' + note.id + '"]');
      if (!li) return;
      const pageNo = li.querySelector(".page-no");
      li.innerHTML = rowInner(note, state.query);
      li.title = import_helpers18.default.deriveTitle(note);
      if (pageNo) li.prepend(pageNo);
    }
    async function setView(view, arg, refreshOpts) {
      await flushSave();
      state.view = view;
      state.tag = view === "tag" ? arg : null;
      state.folderId = view === "folder" ? arg : null;
      el.navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
      if (!GUEST && (state.settings.lastFolderId || null) !== state.folderId) updateSettings({ lastFolderId: state.folderId }).catch(() => {
      });
      await refresh(refreshOpts);
    }
    async function scopeListToNote(note) {
      if (!note || state.query) return;
      if (note.trashedAt) {
        if (state.view !== "trash") await setView("trash", null, { keepEditor: true });
        return;
      }
      if (note.folderId) {
        if (!(state.view === "folder" && state.folderId === note.folderId)) await setView("folder", note.folderId, { keepEditor: true });
        return;
      }
      if (state.view === "folder" || state.view === "trash") await setView("all", null, { keepEditor: true });
    }
    let searchTimer = null;
    async function endSearchStep() {
      const had = !!state.query;
      state.query = el.searchInput.value.trim();
      await refresh({ keepEditor: true });
      if (had && !state.query) await scopeListToNote(state.current);
    }
    function syncListCollapsed() {
      const collapsed = !!(state.settings && state.settings.listCollapsed && state.current);
      el.app.classList.toggle("list-collapsed", collapsed);
      if (el.toggleListBtn) el.toggleListBtn.classList.toggle("is-on", !collapsed);
    }
    function toggleList() {
      updateSettings({ listCollapsed: !state.settings.listCollapsed });
    }
    async function showList() {
      if (state.settings.listCollapsed) await updateSettings({ listCollapsed: false });
    }
    function folderParents() {
      const m = /* @__PURE__ */ new Map();
      for (const f of flattenTree(state.tree)) m.set(f.id, f.parentId || null);
      return m;
    }
    function pathTo(id) {
      const parents = folderParents();
      const out = [];
      for (let x = id; x && parents.has(x) && out.length < 200; x = parents.get(x)) out.unshift(x);
      return out;
    }
    function expandedSet() {
      const list = state.settings && state.settings.expandedFolders || [];
      if (!list.length) return /* @__PURE__ */ new Set();
      const open = /* @__PURE__ */ new Set();
      for (const id of pathTo(list[list.length - 1])) {
        if (!list.includes(id)) break;
        open.add(id);
      }
      return open;
    }
    async function setExpanded(id, open) {
      let next;
      if (open) next = pathTo(id);
      else {
        const cur = Array.from(expandedSet());
        const i = cur.indexOf(id);
        next = i >= 0 ? cur.slice(0, i) : cur;
      }
      await updateSettings({ expandedFolders: next });
      renderFolders();
    }
    function flattenTree(nodes, out) {
      out = out || [];
      for (const n of nodes) {
        out.push(n);
        flattenTree(n.children, out);
      }
      return out;
    }
    function editKey(edit) {
      return edit ? edit.mode + ":" + (edit.id || edit.parentId || "root") : "";
    }
    function renderFolders() {
      const open = expandedSet();
      const editing = state.editingFolder;
      const liveInput = el.folderTree.querySelector(".folder-input");
      if (editing && liveInput && liveInput.dataset.editKey === editKey(editing)) return;
      const refocus = treeFocusKey(el.folderTree);
      el.folderTree.innerHTML = "";
      if (!state.tree.length && !(editing && editing.mode === "create" && !editing.parentId)) {
        const d = document.createElement("div");
        d.className = "folders-empty";
        d.textContent = "No folders yet. Press + to make one.";
        el.folderTree.append(d);
        return;
      }
      const here = new Set(state.view === "folder" ? pathTo(state.folderId) : []);
      const holding = state.current && state.current.folderId ? state.current.folderId : null;
      for (const id of holding ? pathTo(holding) : []) here.add(id);
      const addRow = (node, into) => {
        const kids = node.children.length > 0;
        const isOpen = kids && open.has(node.id);
        const row = document.createElement("div");
        row.className = "folder-row tree-row" + (state.view === "folder" && state.folderId === node.id ? " is-active" : "") + (node.id === holding ? " holds-note" : "");
        row.dataset.id = node.id;
        row.dataset.key = "f:" + node.id;
        row.style.setProperty("--depth", node.depth);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(node.depth + 1));
        if (kids) row.setAttribute("aria-expanded", String(isOpen));
        row.setAttribute("aria-selected", String(row.classList.contains("is-active")));
        row.tabIndex = -1;
        row.draggable = !(editing && editing.mode === "rename" && editing.id === node.id);
        row._toggle = kids ? (on) => setExpanded(node.id, on) : null;
        const chevron = document.createElement("button");
        chevron.className = "folder-chevron" + (kids ? isOpen ? " is-open" : "" : " is-leaf");
        chevron.tabIndex = -1;
        chevron.innerHTML = I("chevron-right");
        chevron.title = isOpen ? "Collapse" : "Expand";
        chevron.setAttribute("aria-label", chevron.title);
        chevron.addEventListener("click", (e) => {
          e.stopPropagation();
          setExpanded(node.id, !isOpen);
        });
        row.append(chevron);
        if (editing && editing.mode === "rename" && editing.id === node.id) {
          row.append(folderInput(node.name, (value) => commitFolderEdit(value)));
        } else {
          const name = document.createElement("span");
          name.className = "row-name";
          name.textContent = node.name;
          name.title = node.name;
          row.append(name);
          if (node.book) row.insertAdjacentHTML("beforeend", bookMark());
          if (node.isVaultRoot) {
            const st = state.vaultStatus[node.vaultId] || {};
            const badge = document.createElement("span");
            badge.className = "vault-badge" + (st.syncing ? " is-syncing" : "") + (st.lastError || st.conflict ? " is-error" : "");
            badge.innerHTML = I(st.isRepo ? "refresh-cw" : "folder-open");
            badge.title = st.isRepo ? "git" + (st.remote ? " \xB7 " + st.remote : " \xB7 no remote") + (st.lastError ? "\n" + st.lastError : "") : "Folder vault (no git)";
            row.append(badge);
          }
          const count = document.createElement("span");
          count.className = "count";
          count.textContent = node.count;
          row.append(count);
          const menu = document.createElement("button");
          menu.className = "folder-menu-btn";
          menu.tabIndex = -1;
          menu.innerHTML = I("ellipsis");
          menu.title = "Folder actions";
          menu.setAttribute("aria-label", "Folder actions for " + node.name);
          menu.addEventListener("click", (e) => {
            e.stopPropagation();
            openFolderMenu(node.id, menu);
          });
          row.append(menu);
        }
        row.addEventListener("click", () => {
          if (editing && editing.id === node.id) return;
          if (kids && !isOpen) setExpanded(node.id, true);
          setView("folder", node.id);
        });
        row.addEventListener("dblclick", (e) => {
          if (!e.target.closest(".folder-input")) {
            e.preventDefault();
            startRename(node.id);
          }
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openFolderMenu(node.id, row, e);
        });
        wireDropTarget(row, node.id);
        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/x-folder-id", node.id);
          e.dataTransfer.effectAllowed = "move";
          row.classList.add("is-dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        into.append(row);
        const creatingHere = editing && editing.mode === "create" && editing.parentId === node.id;
        if (isOpen || creatingHere) {
          const group = treeGroup(node.depth, here.has(node.id));
          if (creatingHere) group.append(createRow(node.depth + 1));
          if (isOpen) node.children.forEach((c) => addRow(c, group));
          into.append(group);
        }
      };
      const createRow = (depth) => {
        const row = document.createElement("div");
        row.className = "folder-row is-active";
        row.style.setProperty("--depth", depth);
        row.append(document.createElement("span"));
        row.firstChild.className = "folder-chevron is-leaf";
        row.append(folderInput("", (value) => commitFolderEdit(value)));
        if (editing.book) row.insertAdjacentHTML("beforeend", bookMark());
        return row;
      };
      const frag = document.createDocumentFragment();
      if (editing && editing.mode === "create" && !editing.parentId) frag.append(createRow(0));
      state.tree.forEach((n) => addRow(n, frag));
      el.folderTree.append(frag);
      const input = el.folderTree.querySelector(".folder-input");
      if (input) {
        input.focus();
        input.select();
      } else restoreTreeFocus(el.folderTree, refocus);
    }
    function treeModePossible() {
      return !state.query && (state.view === "all" || state.view === "folder");
    }
    function treeModeActive() {
      return !!state.settings && state.settings.listMode === "tree" && treeModePossible();
    }
    function inTreeScope(noteId) {
      const out = state.outline || {};
      const scope = state.view === "folder" ? state.folderId : null;
      const ids = scope ? /* @__PURE__ */ new Set([scope, ...flattenTree((flattenTree(state.tree).find((f) => f.id === scope) || { children: [] }).children).map((f) => f.id)]) : null;
      for (const [folder, notes] of Object.entries(out)) {
        if (ids && !ids.has(folder)) continue;
        if (notes.some((n) => n.id === noteId)) return true;
      }
      return false;
    }
    function headingsOf(md) {
      const out = [];
      let fence = false;
      for (const line of String(md || "").split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) {
          fence = !fence;
          continue;
        }
        if (fence) continue;
        const m = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
        if (m) out.push({ level: m[1].length, text: m[2].replace(/\*\*|__(?=\S)|(?<=\S)__|[*`]|~~|\[([^\]]*)\]\([^)]*\)/g, (x, t) => t || "").trim() });
      }
      return out;
    }
    function currentHeadings() {
      const n = state.current;
      if (!n || n.locked || isNonMarkdownFile3(n)) return [];
      if (!state.sourceMode && state.rich) {
        return Array.from(el.richEditor.querySelectorAll(".rich-editor-content :is(h1, h2, h3, h4, h5, h6)")).slice(0, 60).map((h) => ({ level: Number(h.tagName.slice(1)), text: h.textContent.trim() })).filter((h) => h.text);
      }
      const md = state.currentId === n.id ? el.bodyInput.value : n.body;
      return headingsOf(md).slice(0, 60);
    }
    function jumpToHeading(i) {
      if (state.sourceMode) {
        const lines = el.bodyInput.value.split("\n");
        let fence = false, count = -1, at = 0;
        for (const line of lines) {
          if (/^\s*(```|~~~)/.test(line)) fence = !fence;
          else if (!fence && /^\s{0,3}#{1,6}\s+\S/.test(line) && ++count === i) break;
          at += line.length + 1;
        }
        src.focus();
        src.setSelectionRange(at, at);
        src.reveal(at);
        return;
      }
      const h = el.richEditor.querySelectorAll(".rich-editor-content :is(h1, h2, h3, h4, h5, h6)")[i];
      if (h) h.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    function renderNoteTree() {
      const root = el.noteTree;
      const refocus = treeFocusKey(root);
      root.innerHTML = "";
      const out = state.outline || {};
      const open = new Set(state.settings.treeExpanded || []);
      const scopeId = state.view === "folder" ? state.folderId : null;
      const scopeNode = scopeId ? flattenTree(state.tree).find((f) => f.id === scopeId) : null;
      const here = new Set(state.current && state.current.folderId ? pathTo(state.current.folderId) : []);
      const heads = currentHeadings();
      const minLevel = heads.length ? Math.min(...heads.map((h) => h.level)) : 1;
      const setOpen = (id, on) => {
        const next = new Set(state.settings.treeExpanded || []);
        if (on) next.add(id);
        else next.delete(id);
        updateSettings({ treeExpanded: Array.from(next) }).then(renderNoteTree);
      };
      const noteRow = (n, depth, into) => {
        const row = document.createElement("div");
        const active2 = n.id === state.currentId;
        row.className = "tree-row tree-note note-row" + (active2 ? " is-active" : "");
        row.dataset.id = n.id;
        row.dataset.key = "n:" + n.id;
        row.style.setProperty("--depth", depth);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        row.setAttribute("aria-selected", String(active2));
        row.tabIndex = -1;
        row.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span>' + rowInner(n, "");
        row.title = n.title;
        row.addEventListener("click", (e) => openNote(n.id, { newTab: e.ctrlKey || e.metaKey }));
        row.addEventListener("auxclick", (e) => {
          if (e.button === 1) {
            e.preventDefault();
            openNote(n.id, { newTab: true });
          }
        });
        row.draggable = true;
        row.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/x-note-id", n.id);
          e.dataTransfer.effectAllowed = "move";
          row.classList.add("is-dragging");
          toPeer({ type: "drag", id: n.id });
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("is-dragging");
          toPeer({ type: "drag", id: null });
        });
        into.append(row);
        if (active2 && heads.length > 1) {
          const group = treeGroup(depth, true);
          group.classList.add("tree-outline");
          heads.forEach((h, i) => {
            const hr = document.createElement("div");
            hr.className = "tree-row tree-heading";
            hr.dataset.key = "h:" + n.id + ":" + i;
            hr.style.setProperty("--depth", depth + 1 + (h.level - minLevel));
            hr.setAttribute("role", "treeitem");
            hr.setAttribute("aria-level", String(depth + 2 + (h.level - minLevel)));
            hr.tabIndex = -1;
            hr.innerHTML = '<span class="tree-spacer" aria-hidden="true"></span><span class="row-name"></span>';
            hr.querySelector(".row-name").textContent = h.text;
            hr.title = h.text;
            hr.addEventListener("click", () => jumpToHeading(i));
            group.append(hr);
          });
          into.append(group);
        }
      };
      const folderRow = (node, depth, into) => {
        const notes = out[node.id] || [];
        const kids = node.children.length + notes.length > 0;
        const isOpen = kids && (open.has(node.id) || here.has(node.id) && state.revealInTree === state.currentId);
        const row = document.createElement("div");
        row.className = "tree-row tree-folder" + (here.has(node.id) ? " is-here" : "");
        row.dataset.id = node.id;
        row.dataset.key = "f:" + node.id;
        row.style.setProperty("--depth", depth);
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth + 1));
        if (kids) row.setAttribute("aria-expanded", String(isOpen));
        row.tabIndex = -1;
        row._toggle = kids ? (on) => setOpen(node.id, on) : null;
        row.innerHTML = '<span class="tree-chevron' + (isOpen ? " is-open" : "") + (kids ? "" : " is-leaf") + '" aria-hidden="true">' + I("chevron-right") + '</span><span class="row-name"></span>' + (node.book ? bookMark() : "") + '<span class="count"></span>';
        row.querySelector(".row-name").textContent = node.name;
        row.querySelector(".count").textContent = node.count || "";
        row.title = node.name;
        row.addEventListener("click", () => {
          if (kids) setOpen(node.id, !isOpen);
        });
        row.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openFolderMenu(node.id, row, e);
        });
        wireDropTarget(row, node.id);
        into.append(row);
        if (isOpen) {
          const group = treeGroup(depth, here.has(node.id));
          node.children.forEach((c) => folderRow(c, depth + 1, group));
          notes.forEach((n) => noteRow(n, depth + 1, group));
          into.append(group);
        }
      };
      const frag = document.createDocumentFragment();
      if (scopeNode) {
        scopeNode.children.forEach((c) => folderRow(c, 0, frag));
        (out[scopeNode.id] || []).forEach((n) => noteRow(n, 0, frag));
      } else {
        state.tree.forEach((c) => folderRow(c, 0, frag));
        (out[""] || []).forEach((n) => noteRow(n, 0, frag));
      }
      root.append(frag);
      restoreTreeFocus(root, refocus);
      const active = root.querySelector(".tree-note.is-active");
      if (active && state.revealInTree === state.currentId) {
        active.scrollIntoView({ block: "nearest" });
        state.revealInTree = null;
      }
    }
    function revealInSidebar(note) {
      if (GUEST) return;
      const parents = note && note.folderId ? pathTo(note.folderId).slice(0, -1) : [];
      const open = expandedSet();
      if (parents.every((id) => open.has(id))) {
        renderFolders();
        return;
      }
      setExpanded(parents[parents.length - 1], true);
    }
    function revealInTree(note) {
      if (GUEST || !treeModeActive() || !note || !note.folderId) return;
      const path = pathTo(note.folderId);
      const have = new Set(state.settings.treeExpanded || []);
      const missing = path.filter((id) => !have.has(id));
      state.revealInTree = note.id;
      if (missing.length) updateSettings({ treeExpanded: Array.from(have).concat(missing) }).then(renderNoteTree);
      else renderNoteTree();
    }
    let outlineTimer = null, outlineSig = "";
    function scheduleOutline() {
      if (!treeModeActive()) return;
      clearTimeout(outlineTimer);
      outlineTimer = setTimeout(() => {
        const sig = state.currentId + "|" + currentHeadings().map((h) => h.level + h.text).join("|");
        if (sig !== outlineSig) {
          outlineSig = sig;
          renderNoteTree();
        }
      }, 500);
    }
    function folderInput(value, commit) {
      const input = document.createElement("input");
      input.className = "folder-input";
      input.dataset.editKey = editKey(state.editingFolder);
      input.value = value;
      const what = state.editingFolder && state.editingFolder.book ? "Book name" : "Folder name";
      input.placeholder = what;
      input.setAttribute("aria-label", what);
      input.spellcheck = false;
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        if (save) commit(input.value);
        else cancelFolderEdit();
      };
      input.addEventListener("blur", () => {
        if (input.isConnected) finish(true);
      });
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("dblclick", (e) => e.stopPropagation());
      return input;
    }
    function startCreateFolder(parentId, asBook) {
      closeFolderMenu();
      showSidebar();
      state.editingFolder = { mode: "create", parentId: parentId || null, book: !!asBook };
      if (parentId && !expandedSet().has(parentId)) {
        setExpanded(parentId, true);
        return;
      }
      renderFolders();
    }
    function startRename(id) {
      closeFolderMenu();
      state.editingFolder = { mode: "rename", id };
      renderFolders();
    }
    function cancelFolderEdit() {
      state.editingFolder = null;
      renderFolders();
    }
    async function commitFolderEdit(value) {
      const edit = state.editingFolder;
      state.editingFolder = null;
      if (!edit) return;
      const name = String(value || "").trim();
      try {
        if (edit.mode === "create") {
          if (!name) {
            renderFolders();
            return;
          }
          const folder = await api.folders.create({ name, parentId: edit.parentId });
          if (edit.book) {
            await api.folders.setBook(folder.id, true);
            const page = await api.notes.create({ folderId: folder.id, title: "" });
            await setView("folder", folder.id, { keepEditor: true });
            await selectNoteNow(page.id);
            el.titleInput.focus();
            toast('Book "' + import_helpers18.default.truncate(folder.name, 30) + '" created. Give the first page a title; + Page adds more.');
            return;
          }
          await setView("folder", folder.id);
          toast('Folder "' + import_helpers18.default.truncate(folder.name, 30) + '" created');
        } else {
          if (name) await api.folders.rename(edit.id, name);
          await refresh({ keepEditor: true });
        }
      } catch (err) {
        renderFolders();
        toast("Could not save the folder: " + (err.message || err));
      }
    }
    async function deleteFolder(id) {
      closeFolderMenu();
      const node = flattenTree(state.tree).find((n) => n.id === id);
      if (!node) return;
      const what = [];
      if (node.count) what.push(node.count + (node.count === 1 ? " note" : " notes"));
      if (node.children.length) what.push(node.children.length + (node.children.length === 1 ? " subfolder (with its contents)" : " subfolders (with their contents)"));
      const detail = what.length ? " Its " + what.join(" and ") + " move up one level; nothing is deleted." : "";
      if (!window.confirm('Delete folder "' + node.name + '"?' + detail)) return;
      await flushSave();
      const res = await api.folders.delete(id);
      if (state.current && state.current.folderId === id) state.current.folderId = res ? res.parentId : null;
      if (state.view === "folder" && (state.folderId === id || !flattenTree(state.tree).some((n) => n.id === state.folderId))) {
        if (res && res.parentId) await setView("folder", res.parentId);
        else await setView("all");
      } else await refresh({ keepEditor: true });
      toast("Folder deleted");
    }
    async function moveNoteToFolder(noteId, folderId) {
      const existing = state.notes.find((n) => n.id === noteId) || (state.currentId === noteId ? state.current : null);
      if (existing && (existing.folderId || null) === (folderId || null)) return;
      await flushSave();
      let updated;
      try {
        updated = await api.notes.update(noteId, { folderId: folderId || null });
      } catch (err) {
        const msg = ipcErrorText(err);
        toast(/locked/i.test(msg) ? msg : /vault/i.test(msg) ? "Vault notes stay inside their vault; move them between its folders instead." : "Could not move: " + msg);
        renderFolderSelect();
        return;
      }
      if (state.currentId === noteId && updated) state.current = updated;
      await refresh({ keepEditor: true });
      const name = folderId ? (flattenTree(state.tree).find((n) => n.id === folderId) || {}).name : null;
      toast(name ? "Moved to " + import_helpers18.default.truncate(name, 30) : "Moved out of folders");
    }
    async function moveFolderTo(folderId, parentId) {
      const res = await api.folders.move(folderId, parentId || null);
      if (res && res.error) {
        toast(res.error);
        return;
      }
      if (parentId && !expandedSet().has(parentId)) await setExpanded(parentId, true);
      await refresh({ keepEditor: true });
    }
    function wireDropTarget(target, folderId) {
      const accepts = (e) => e.dataTransfer && (e.dataTransfer.types.includes("text/x-note-id") || e.dataTransfer.types.includes("text/x-folder-id"));
      target.addEventListener("dragover", (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        target.classList.add("is-drop-target");
      });
      target.addEventListener("dragleave", () => target.classList.remove("is-drop-target"));
      target.addEventListener("drop", (e) => {
        target.classList.remove("is-drop-target");
        const noteId = e.dataTransfer.getData("text/x-note-id");
        const movingFolder = e.dataTransfer.getData("text/x-folder-id");
        if (!noteId && !movingFolder) return;
        e.preventDefault();
        e.stopPropagation();
        if (noteId) moveNoteToFolder(noteId, folderId);
        else if (movingFolder && movingFolder !== folderId) moveFolderTo(movingFolder, folderId);
      });
    }
    function renderFolderSelect() {
      const sel = el.folderSelect;
      const current = state.current ? state.current.folderId || "" : "";
      sel.innerHTML = "";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "No folder";
      sel.append(none);
      const path = [];
      for (const node of flattenTree(state.tree)) {
        path.length = node.depth;
        path.push(node.name);
        const opt = document.createElement("option");
        opt.value = node.id;
        opt.textContent = path.join(" / ");
        sel.append(opt);
      }
      sel.value = current;
      if (sel.value !== current) sel.value = "";
      const f = current ? flattenTree(state.tree).find((x) => x.id === current) : null;
      setIcon(sel.parentElement, f && f.book ? "book" : "folder");
    }
    function openFolderMenu(id, anchor, ev) {
      state.menuFolderId = id;
      const menu = el.folderMenu;
      const node = flattenTree(state.tree).find((n) => n.id === id) || {};
      el.folderMenuSync.classList.toggle("hidden", !node.isVaultRoot);
      el.folderMenuBook.textContent = node.book ? "Turn back into a folder" : "Turn into a book";
      el.folderMenuOpen.classList.toggle("hidden", !node.vaultId);
      menu.querySelector('[data-action="delete"]').textContent = node.isVaultRoot ? "Remove vault (keeps files)" : "Delete folder";
      placePopover(menu, anchor, ev);
    }
    function closeFolderMenu() {
      state.menuFolderId = null;
      el.folderMenu.classList.add("hidden");
    }
    async function folderMenuAction(action) {
      const id = state.menuFolderId;
      closeFolderMenu();
      if (!id) return;
      const node = flattenTree(state.tree).find((n) => n.id === id) || {};
      if (action === "new-note") {
        await setView("folder", id);
        await newNote();
      } else if (action === "new-subfolder") startCreateFolder(id);
      else if (action === "rename") startRename(id);
      else if (action === "toggle-book") toggleBook(id, !node.book);
      else if (action === "sync" && node.vaultId) syncVault(node.vaultId);
      else if (action === "open-folder" && node.vaultId) api.vaults.openFolder(node.vaultId);
      else if (action === "delete" && node.isVaultRoot) removeVault(node.vaultId);
      else if (action === "delete") deleteFolder(id);
    }
    const { syncVault, removeVault, addVaultFolder, openCloneDialog, submitClone, renderVaultList, describeVaultStatus } = createVaultsPanel({ api, refresh, flushSave, setView, leaveSettings, setExpanded });
    const GUEST = new URLSearchParams(location.search).get("pane") === "right";
    const SIDE = GUEST ? "right" : "left";
    const tabs = {
      ids: [],
      // note ids in tab order; null is an empty tab
      at: 0,
      // the tab on screen
      titles: /* @__PURE__ */ new Map(),
      // id -> title shown on a tab that is not on screen
      split: false,
      // left side: the right side is open
      active: "left",
      // left side: the side the list opens notes in (the one last clicked or typed in)
      activeHere: false,
      // right side: this side is the active one
      ratio: 0.5,
      // left side: its share of the width
      frame: null,
      // left side: the right side's iframe
      peerReady: false,
      queue: [],
      // left side: messages for the right side sent before it was ready
      peerIds: [],
      // the other side's open notes
      peerCurrent: null,
      dragIndex: null,
      // a tab of this side being dragged
      peerDrag: null
      // a tab or note card being dragged on the other side
    };
    function peerWindow() {
      return GUEST ? window.parent : tabs.frame && tabs.frame.contentWindow;
    }
    function toPeer(msg) {
      if (!GUEST && !tabs.split) return;
      if (!GUEST && !tabs.peerReady) {
        tabs.queue.push(msg);
        return;
      }
      const w = peerWindow();
      if (!w || w === window) return;
      w.postMessage(Object.assign({ notesPane: true }, msg), "*");
    }
    function hasPeer() {
      return GUEST || tabs.split;
    }
    function peerHas(id) {
      return !!id && hasPeer() && tabs.peerIds.includes(id);
    }
    let peerChangedTimer = null;
    function peerChanged() {
      if (!hasPeer()) return;
      clearTimeout(peerChangedTimer);
      peerChangedTimer = setTimeout(() => toPeer({ type: "changed" }), 250);
    }
    const mainEvents = {};
    function fromMain(name, handler) {
      mainEvents[name] = handler;
      api.on[name]((arg) => {
        handler(arg);
        if (tabs.split) toPeer({ type: "event", name, arg });
      });
    }
    function panesOf(settings) {
      return settings && settings.panes || { split: false, ratio: 0.5, active: "left", left: { ids: [], current: null }, right: { ids: [], current: null } };
    }
    function restoreTabs(settings) {
      const panes = panesOf(settings);
      const mine = panes[SIDE];
      tabs.ids = mine.ids.slice();
      tabs.at = Math.max(0, tabs.ids.indexOf(mine.current));
      if (GUEST) {
        renderTabs();
        return;
      }
      tabs.ratio = panes.ratio;
      tabs.active = panes.split ? panes.active : "left";
      tabs.peerIds = panes.split ? panes.right.ids.slice() : [];
      tabs.peerCurrent = panes.split ? panes.right.current : null;
      renderTabs();
    }
    function openIds() {
      return tabs.ids.filter(Boolean);
    }
    function tabTitle(id) {
      if (!id) return "New tab";
      if (id === state.currentId && state.current) return import_helpers18.default.deriveTitle({ title: el.titleInput.value, body: el.bodyInput.value });
      return tabs.titles.get(id) || "\u2026";
    }
    function renderTabs() {
      const frag = document.createDocumentFragment();
      tabs.ids.forEach((id, i) => {
        const t = document.createElement("div");
        const on = i === tabs.at;
        t.className = "tab" + (on ? " is-active" : "");
        t.setAttribute("role", "tab");
        t.setAttribute("aria-selected", String(on));
        t.dataset.index = String(i);
        t.draggable = true;
        const title = tabTitle(id);
        t.title = title + (id ? "\nCtrl+click a note in the list to open it in a new tab. Middle-click closes." : "");
        const label = document.createElement("span");
        label.className = "tab-title";
        label.textContent = title;
        const x = document.createElement("button");
        x.type = "button";
        x.className = "tab-close";
        x.innerHTML = I("x");
        x.title = "Close tab (Ctrl+W)";
        x.setAttribute("aria-label", "Close " + title);
        t.append(label, x);
        frag.append(t);
      });
      el.tabList.replaceChildren(frag);
      const active = el.tabList.querySelector(".tab.is-active");
      if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
      el.tabBar.classList.toggle("is-solo", !GUEST && !tabs.split && tabs.ids.length === 1 && !!tabs.ids[0]);
      syncTitleBar();
      el.splitViewBtn.classList.toggle("hidden", GUEST || tabs.split);
      el.paneCloseBtn.classList.toggle("hidden", !GUEST);
      const missing = openIds().filter((id) => id !== state.currentId && !tabs.titles.has(id));
      if (missing.length) loadTabTitles(missing);
    }
    function renderActiveTabTitle() {
      const label = el.tabList.querySelector(".tab.is-active .tab-title");
      if (label && state.current) label.textContent = tabTitle(state.currentId);
    }
    let titlesLoading = false;
    async function loadTabTitles(ids) {
      if (titlesLoading) return;
      titlesLoading = true;
      let gone = [];
      try {
        const notes = await Promise.all(ids.map((id) => api.notes.get(id).catch(() => void 0)));
        notes.forEach((n, i) => {
          if (n) tabs.titles.set(ids[i], import_helpers18.default.deriveTitle(n));
          else if (n === null) gone.push(ids[i]);
        });
      } finally {
        titlesLoading = false;
      }
      gone = gone.filter((id) => id !== state.currentId);
      for (const id of gone) {
        const i = tabs.ids.indexOf(id);
        if (i >= 0) removeTabAt(i);
      }
      if (gone.length) tabsChanged();
      else renderTabs();
    }
    function removeTabAt(i) {
      tabs.ids.splice(i, 1);
      if (i < tabs.at || tabs.at >= tabs.ids.length) tabs.at = Math.max(0, tabs.at - 1);
    }
    function placeInTab(id, newTab) {
      const i = tabs.ids.indexOf(id);
      if (i >= 0) tabs.at = i;
      else if (!tabs.ids.length) {
        tabs.ids = [id];
        tabs.at = 0;
      } else if (newTab && tabs.ids[tabs.at] !== null) {
        tabs.ids.splice(tabs.at + 1, 0, id);
        tabs.at += 1;
      } else tabs.ids[tabs.at] = id;
      tabsChanged();
    }
    function tabsChanged() {
      renderTabs();
      toPeer({ type: "tabs", ids: openIds(), current: state.currentId });
      if (!GUEST) saveLayoutSoon();
    }
    let layoutTimer = null;
    function saveLayoutSoon() {
      if (GUEST) return;
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => {
        const panes = {
          split: tabs.split,
          ratio: tabs.ratio,
          active: tabs.active,
          left: { ids: openIds(), current: state.currentId },
          right: { ids: tabs.split ? tabs.peerIds.slice() : [], current: tabs.split ? tabs.peerCurrent : null }
        };
        if (JSON.stringify(panes) === JSON.stringify(state.settings.panes)) return;
        updateSettings({ panes }).catch(() => {
        });
      }, 1500);
    }
    function inTurn(fn) {
      const run = state.selecting.then(fn).catch((err) => console.error("tab change failed", err));
      state.selecting = run;
      return run;
    }
    async function leaveNote() {
      if (tts.active) stopReadAloud();
      if (!await flushDocuments({ commit: true }) && !window.confirm("Your changes to this document could not be saved (is it open in another app?). Leave it anyway and lose them?")) return false;
      let guard = 0;
      while (state.dirty && guard++ < 3) await flushSave();
      stashIfDirty();
      return true;
    }
    function showTab(i) {
      return inTurn(async () => {
        if (i < 0 || i >= tabs.ids.length) return;
        const id = tabs.ids[i];
        if (id) {
          await selectNoteNow(id);
          return;
        }
        if (i === tabs.at && !state.currentId) return;
        if (!await leaveNote()) return;
        blankEditor();
        tabs.at = i;
        tabsChanged();
      });
    }
    function newEmptyTab() {
      return inTurn(async () => {
        if (tabs.ids[tabs.at] === null && !state.currentId) return;
        if (!await leaveNote()) return;
        blankEditor();
        const at = tabs.ids.length ? tabs.at + 1 : 0;
        tabs.ids.splice(at, 0, null);
        tabs.at = at;
        tabsChanged();
      });
    }
    function closeTab(i) {
      return inTurn(async () => {
        if (i < 0 || i >= tabs.ids.length) return;
        if (i !== tabs.at) {
          removeTabAt(i);
          tabsChanged();
          return;
        }
        if (tabs.ids.length > 1) {
          const j = i + 1 < tabs.ids.length ? i + 1 : i - 1;
          const nextId = tabs.ids[j];
          if (nextId) {
            await selectNoteNow(nextId);
            if (state.currentId !== nextId) return;
          } else {
            if (!await leaveNote()) return;
            blankEditor();
          }
          tabs.at = j;
          removeTabAt(i);
          tabsChanged();
          return;
        }
        if (!await leaveNote()) return;
        blankEditor();
        tabs.ids = [];
        tabs.at = 0;
        tabsChanged();
        if (GUEST) toPeer({ type: "close" });
      });
    }
    function cycleTab(step) {
      if (tabs.ids.length < 2) return;
      showTab((tabs.at + step + tabs.ids.length) % tabs.ids.length);
    }
    function openNote(id, opts) {
      opts = opts || {};
      if (!GUEST && tabs.split && !tabs.ids.includes(id) && (peerHas(id) || tabs.active === "right")) {
        toPeer({ type: "open", id, newTab: !!opts.newTab, focus: opts.focus || null });
        if (opts.focus) tabs.frame.focus();
        return Promise.resolve();
      }
      return selectNote(id, opts);
    }
    function setActiveSide(side) {
      if (GUEST || tabs.active === side) return;
      tabs.active = side;
      el.paneMain.classList.toggle("is-active-side", tabs.split && side === "left");
      toPeer({ type: "active", on: side === "right" });
      saveLayoutSoon();
    }
    function applyRatio() {
      el.editorPane.style.setProperty("--peer-w", Math.round((1 - tabs.ratio) * 1e3) / 10 + "%");
    }
    function openSplit(restoring) {
      if (GUEST || tabs.split) return;
      tabs.split = true;
      tabs.peerReady = false;
      tabs.queue = [];
      if (!restoring) {
        tabs.peerIds = [];
        tabs.peerCurrent = null;
      }
      const f = document.createElement("iframe");
      f.className = "pane-peer";
      f.id = "panePeer";
      f.title = "Right side";
      f.src = "index.html?pane=right";
      tabs.frame = f;
      let loads = 0;
      f.addEventListener("load", () => {
        if (++loads > 1 && tabs.frame === f) {
          dropFrame();
          toast("The right side left its page, so it was closed.");
        }
      });
      applyRatio();
      el.editorPane.classList.add("is-split");
      el.splitDivider.classList.remove("hidden");
      el.editorPane.append(f);
      if (!restoring) tabs.active = "right";
      el.paneMain.classList.toggle("is-active-side", tabs.active === "left");
      renderTabs();
      if (!restoring) saveLayoutSoon();
    }
    async function closeSplit() {
      if (GUEST || !tabs.split) return;
      if (!await flushPeer({ leave: true })) return;
      if (!tabs.split) return;
      dropFrame();
    }
    function dropFrame() {
      tabs.frame.remove();
      tabs.frame = null;
      tabs.split = false;
      tabs.peerReady = false;
      tabs.queue = [];
      tabs.peerIds = [];
      tabs.peerCurrent = null;
      tabs.peerDrag = null;
      el.editorPane.classList.remove("is-split");
      el.splitDivider.classList.add("hidden");
      tabs.active = "left";
      el.paneMain.classList.remove("is-active-side");
      renderTabs();
      saveLayoutSoon();
    }
    let flushSeq = 0;
    const peerWaits = /* @__PURE__ */ new Map();
    function askPeer(msg, ms) {
      const seq = ++flushSeq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          peerWaits.delete(seq);
          resolve(null);
        }, ms);
        peerWaits.set(seq, (reply) => {
          clearTimeout(timer);
          peerWaits.delete(seq);
          resolve(reply);
        });
        toPeer(Object.assign({ seq }, msg));
      });
    }
    async function flushPeer(opts) {
      if (GUEST || !tabs.split || !tabs.peerReady) return true;
      const leave = !!(opts && opts.leave);
      const reply = await askPeer({ type: "flush", leave }, leave ? 10 * 60 * 1e3 : 5e3);
      if (leave) return !!(reply && reply.ok);
      return true;
    }
    async function takeFromPeer(id) {
      if (!peerHas(id)) return true;
      const reply = await askPeer({ type: "release", id }, 10 * 60 * 1e3);
      return !!(reply && reply.ok);
    }
    async function onPeerMessage(m) {
      switch (m.type) {
        case "hello": {
          tabs.peerReady = true;
          const queued = tabs.queue;
          tabs.queue = [];
          toPeer({ type: "active", on: tabs.active === "right" });
          toPeer({ type: "tabs", ids: openIds(), current: state.currentId });
          queued.forEach(toPeer);
          return;
        }
        case "tabs":
          tabs.peerIds = Array.isArray(m.ids) ? m.ids : [];
          tabs.peerCurrent = m.current || null;
          saveLayoutSoon();
          return;
        case "open":
          if (!GUEST && m.focus) {
            setActiveSide("left");
            window.focus();
          }
          await selectNote(m.id, { newTab: !!m.newTab, focus: m.focus || null });
          return;
        case "changed":
          await onPeerWrite();
          return;
        case "settings":
          applySettings(m.settings, { fromPeer: true });
          return;
        case "caption":
          if (GUEST) document.documentElement.style.setProperty("--caption-w", (Number(m.w) || 0) + "px");
          return;
        case "focus":
          setActiveSide("right");
          return;
        case "active":
          tabs.activeHere = !!m.on;
          el.paneMain.classList.toggle("is-active-side", tabs.activeHere);
          return;
        case "event":
          if (m.name === "editCommand") runEditCommand(m.arg);
          else if (mainEvents[m.name]) await mainEvents[m.name](m.arg);
          return;
        case "flush": {
          let ok = false;
          try {
            if (m.leave) ok = await inTurn(leaveNote) === true && !state.pending.size;
            else {
              await flushSave();
              await retryPending();
              ok = true;
            }
          } finally {
            toPeer({ type: "reply", seq: m.seq, ok });
          }
          if (m.leave && !ok && state.pending.size) toast("Some text here could not be saved yet, so this side stays open. It is retried; try again in a moment.");
          return;
        }
        case "release": {
          const i = tabs.ids.indexOf(m.id);
          if (i >= 0) await closeTab(i);
          const ok = !tabs.ids.includes(m.id) && !state.pending.has(m.id);
          if (!ok && state.pending.has(m.id)) toast("That note has text that could not be saved yet; it stays here until it is.");
          toPeer({ type: "reply", seq: m.seq, ok });
          return;
        }
        case "reply": {
          const wait = peerWaits.get(m.seq);
          if (wait) wait(m);
          return;
        }
        case "command":
          runSideCommand(m.name, m);
          return;
        case "close":
          await closeSplit();
          return;
        case "drag":
          tabs.peerDrag = m.id || null;
          return;
        default:
          return;
      }
    }
    async function onPeerWrite() {
      if (!GUEST) await refresh({ keepEditor: true });
      tabs.titles.clear();
      renderTabs();
      const id = state.currentId;
      if (id && !state.dirty && !await api.notes.get(id) && state.currentId === id) {
        clearEditor();
        if (!GUEST) await refresh();
      }
    }
    function runSideCommand(name, m) {
      if (GUEST) return;
      if (name === "newNote") newNote({ title: m && typeof m.title === "string" ? m.title : "" });
      else if (name === "search") showList().then(() => {
        el.searchInput.focus();
        el.searchInput.select();
      });
      else if (name === "openFiles") openFiles();
      else if (name === "settings") openSettings();
      else if (name === "newFolder") startCreateFolder(state.view === "folder" ? state.folderId : null);
      else if (name === "toggleSidebar") toggleSidebar();
    }
    function runEditCommand(cmd) {
      if (!GUEST && tabs.frame && document.activeElement === tabs.frame) {
        toPeer({ type: "event", name: "editCommand", arg: cmd });
        return;
      }
      if (state.rich && !state.sourceMode && el.richEditor.contains(document.activeElement)) state.rich.editor.chain().focus()[cmd === "redo" ? "redo" : "undo"]().run();
      else if (!src.undoRedo(cmd)) document.execCommand(cmd === "redo" ? "redo" : "undo");
    }
    function dropIndex(e) {
      const t = e.target.closest(".tab");
      return t ? Number(t.dataset.index) : tabs.ids.length;
    }
    function onTabDrop(e) {
      el.tabBar.classList.remove("is-drop-target");
      const at = dropIndex(e);
      if (tabs.dragIndex !== null) {
        e.preventDefault();
        const from = tabs.dragIndex;
        tabs.dragIndex = null;
        if (at === from || at === from + 1) return;
        const moving = tabs.ids[from];
        const shown = tabs.ids[tabs.at];
        const wasShown = from === tabs.at;
        tabs.ids.splice(from, 1);
        const to = at > from ? at - 1 : at;
        tabs.ids.splice(to, 0, moving);
        tabs.at = wasShown ? to : tabs.ids.indexOf(shown);
        tabsChanged();
        return;
      }
      const id = e.dataTransfer.getData("text/x-note-id") || tabs.peerDrag;
      tabs.peerDrag = null;
      if (!id) return;
      e.preventDefault();
      (async () => {
        if (!await takeFromPeer(id)) return;
        if (!GUEST) setActiveSide("left");
        else toPeer({ type: "focus" });
        await selectNote(id, { newTab: true, focus: "body" });
      })();
    }
    function bindTabs() {
      el.tabList.addEventListener("click", (e) => {
        const t = e.target.closest(".tab");
        if (!t) return;
        const i = Number(t.dataset.index);
        if (e.target.closest(".tab-close")) closeTab(i);
        else showTab(i);
      });
      el.tabList.addEventListener("auxclick", (e) => {
        const t = e.target.closest(".tab");
        if (t && e.button === 1) {
          e.preventDefault();
          closeTab(Number(t.dataset.index));
        }
      });
      el.tabList.addEventListener("mousedown", (e) => {
        if (e.button === 1) e.preventDefault();
      });
      el.tabList.addEventListener("dragstart", (e) => {
        const t = e.target.closest(".tab");
        if (!t) return;
        tabs.dragIndex = Number(t.dataset.index);
        e.dataTransfer.setData("text/x-notes-tab", t.dataset.index);
        e.dataTransfer.effectAllowed = "move";
        toPeer({ type: "drag", id: tabs.ids[tabs.dragIndex] || null });
      });
      el.tabList.addEventListener("dragend", () => {
        tabs.dragIndex = null;
        toPeer({ type: "drag", id: null });
      });
      el.tabBar.addEventListener("dragover", (e) => {
        if (tabs.dragIndex === null && !tabs.peerDrag && !e.dataTransfer.types.includes("text/x-note-id")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        el.tabBar.classList.add("is-drop-target");
      });
      el.tabBar.addEventListener("dragleave", (e) => {
        if (!el.tabBar.contains(e.relatedTarget)) el.tabBar.classList.remove("is-drop-target");
      });
      el.tabBar.addEventListener("drop", onTabDrop);
      el.tabAddBtn.addEventListener("click", newEmptyTab);
      el.splitViewBtn.addEventListener("click", () => openSplit(false));
      el.paneCloseBtn.addEventListener("click", () => toPeer({ type: "close" }));
      window.addEventListener("message", (e) => {
        const m = e.data;
        if (!m || m.notesPane !== true || !e.source || e.source !== peerWindow()) return;
        onPeerMessage(m).catch((err) => console.error("split view message failed", err));
      });
      if (GUEST) {
        const claim = () => {
          if (!tabs.activeHere) toPeer({ type: "focus" });
        };
        document.addEventListener("focusin", claim);
        document.addEventListener("pointerdown", claim, true);
        return;
      }
      el.paneMain.addEventListener("focusin", () => setActiveSide("left"));
      el.paneMain.addEventListener("pointerdown", () => setActiveSide("left"), true);
      el.splitDivider.addEventListener("pointerdown", (e) => {
        if (!tabs.split) return;
        e.preventDefault();
        el.splitDivider.setPointerCapture(e.pointerId);
        el.splitDivider.classList.add("is-dragging");
        el.editorPane.classList.add("is-resizing");
        const move = (ev) => {
          const r = el.editorPane.getBoundingClientRect();
          tabs.ratio = Math.min(0.8, Math.max(0.2, (ev.clientX - r.left) / r.width));
          applyRatio();
        };
        const up = () => {
          el.splitDivider.removeEventListener("pointermove", move);
          el.splitDivider.removeEventListener("pointerup", up);
          el.splitDivider.removeEventListener("pointercancel", up);
          el.splitDivider.classList.remove("is-dragging");
          el.editorPane.classList.remove("is-resizing");
          saveLayoutSoon();
        };
        el.splitDivider.addEventListener("pointermove", move);
        el.splitDivider.addEventListener("pointerup", up);
        el.splitDivider.addEventListener("pointercancel", up);
      });
      el.splitDivider.addEventListener("dblclick", () => {
        tabs.ratio = 0.5;
        applyRatio();
        saveLayoutSoon();
      });
    }
    function clearEditor() {
      blankEditor();
      if (tabs.ids.length) {
        tabs.ids[tabs.at] = null;
        tabsChanged();
      }
    }
    function blankEditor() {
      stashIfDirty();
      clearPdf();
      state.currentId = null;
      state.current = null;
      state.dirty = false;
      syncListCollapsed();
      el.editor.classList.add("hidden");
      el.editorEmpty.classList.remove("hidden");
      markActiveRow(null);
    }
    state.selecting = Promise.resolve();
    function selectNote(id, opts) {
      const run = state.selecting.then(() => selectNoteNow(id, opts)).catch((err) => console.error("selectNote failed", err));
      state.selecting = run;
      return run;
    }
    async function selectNoteNow(id, opts) {
      opts = opts || {};
      if (peerHas(id)) {
        toPeer({ type: "open", id, focus: opts.focus || "body" });
        return;
      }
      if (state.currentId === id && state.current) {
        focusAfterOpen(opts.focus);
        return;
      }
      if (!await leaveNote()) return;
      if (state.inflight.has(id)) await state.inflight.get(id);
      const note = await api.notes.get(id);
      if (!note) {
        const gone = tabs.ids.indexOf(id);
        if (gone >= 0 && id !== state.currentId) {
          removeTabAt(gone);
          tabsChanged();
        }
        return;
      }
      if (state.dirty) {
        await flushSave();
        stashIfDirty();
      }
      state.currentId = note.id;
      state.current = note;
      state.dirty = false;
      syncListCollapsed();
      closeAllBookMenus();
      if (readerOpen() && (bookOf(note) || {}).id !== reader.bookId) closeReader();
      el.titleInput.value = note.title;
      el.tagsInput.value = note.tags.join(", ");
      el.bodyInput.value = note.body;
      const hasPending = applyPendingTo(note);
      const plainFile = isPlainTextFile5(note);
      const markdown = !plainFile && !isViewerOnlyFile8(note);
      let lossless = true;
      if (state.rich) {
        lossless = state.rich.setMarkdown(markdown ? el.bodyInput.value : "");
        if (markdown && note.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
      }
      state.currentLossless = lossless;
      state.lossyOverride = null;
      el.bodyInput.placeholder = plainFile ? "Plain text." : "Markdown source. Ctrl+E switches back to the rendered view.";
      const wantSource = import_helpers18.default.isTableFile(note) ? false : plainFile || state.settings.editorMode === "source" || !lossless || !state.rich;
      if (wantSource !== state.sourceMode) applyEditorMode(wantSource);
      if (markdown && !lossless && state.lossyToastFor !== note.id) {
        state.lossyToastFor = note.id;
        toast(note.filePath ? "Opened as source: the rendered view would reformat this file. Ctrl+E switches anyway." : "Opened as Markdown source: the rendered view would change some of this note\u2019s formatting.");
      }
      autoGrow();
      const inTrash = !!note.trashedAt;
      const fileReadOnly = isViewerOnlyFile8(note);
      el.sourceBtn.classList.toggle("hidden", plainFile && !import_helpers18.default.isTableFile(note) || fileReadOnly);
      syncSourceButton();
      [el.titleInput, el.tagsInput].forEach((i) => {
        i.readOnly = inTrash;
      });
      el.bodyInput.readOnly = inTrash || fileReadOnly;
      showCode2(note, inTrash || fileReadOnly);
      renderLockState(note);
      if (state.rich) state.rich.setEditable(!inTrash && !fileReadOnly && !plainFile);
      renderFileRow(note);
      renderStickyButton(note);
      renderRemindButton(note);
      renderLiveRow(note);
      renderBookStrip(note);
      renderRelated(note);
      el.shareBtn.classList.toggle("hidden", !!note.trashedAt);
      if (find.open) closeFind();
      if (bot.open) describeBotScope();
      el.pinBtn.classList.toggle("hidden", inTrash);
      el.deleteBtn.classList.toggle("hidden", inTrash);
      el.lockBtn.classList.toggle("hidden", inTrash || !!note.filePath || !!note.vaultId);
      el.attachBtn.classList.toggle("hidden", inTrash || fileReadOnly);
      el.recordBtn.classList.toggle("hidden", inTrash || fileReadOnly);
      el.historyBtn.classList.toggle("hidden", inTrash);
      el.duplicateBtn.classList.toggle("hidden", inTrash);
      el.splitBtn.classList.toggle("hidden", inTrash);
      el.restoreBtn.classList.toggle("hidden", !inTrash);
      el.destroyBtn.classList.toggle("hidden", !inTrash);
      renderPinButton(note.pinned);
      el.folderSelect.disabled = inTrash;
      renderFolderSelect();
      el.editorEmpty.classList.add("hidden");
      el.editor.classList.remove("hidden");
      markActiveRow(id);
      revealInTree(note);
      revealInSidebar(note);
      updateStatus(note);
      if (hasPending) {
        state.dirty = true;
        setSaved("Save failed");
        scheduleRetry();
      } else setSaved("Saved");
      placeInTab(note.id, opts.newTab);
      focusAfterOpen(opts.focus);
    }
    function markActiveRow(id) {
      for (const root of [el.noteList, el.noteTree]) {
        root.querySelectorAll(".note-row").forEach((r) => {
          const on = !!id && r.dataset.id === id;
          r.classList.toggle("is-active", on);
          if (r.hasAttribute("aria-selected")) r.setAttribute("aria-selected", String(on));
        });
      }
    }
    function focusAfterOpen(where) {
      if (where === "title") el.titleInput.focus();
      else if (where === "body") focusBody();
    }
    function updateStatus(note) {
      const body = el.bodyInput.value;
      const stats = tableStatsNow();
      if (stats && tableShown()) {
        el.statusWords.textContent = stats.rows.toLocaleString() + (stats.rows === 1 ? " row" : " rows");
        el.statusChars.textContent = stats.cols + (stats.cols === 1 ? " column" : " columns");
      } else {
        const words = import_helpers18.default.countWords(body);
        el.statusWords.textContent = words + (words === 1 ? " word" : " words");
        el.statusChars.textContent = body.length + (body.length === 1 ? " character" : " characters");
      }
      el.statusUpdated.textContent = note.trashedAt ? "Trashed " + import_helpers18.default.relativeTime(note.trashedAt) : "Edited " + import_helpers18.default.relativeTime(note.updatedAt);
    }
    function setSaved(label) {
      el.statusSaved.textContent = label;
      el.statusSaved.classList.toggle("is-saving", label === "Saving\u2026");
      el.statusSaved.classList.toggle("is-saved", label === "Saved");
    }
    const { book, bookOf, renderBookStrip, stepPage, addPage, toggleBook, openSplitDialog, applySplit, openBookMenu, closeAllBookMenus, pageMenuAction, bookMenuAction, exportBook, reader, openReader, closeReader, readerOpen } = createBooks({ api, flattenTree, selectNote, selectNoteNow, refresh, flushSave, clearEditor, setView, trashCurrent, syncTitleBar });
    const { renderLiveRow, startLiveHost, stopLive, openLiveDialog, submitLiveDialog } = createLiveShare({ api, flushSave, refreshCurrentMeta, setView, selectNoteNow });
    const { openFind, closeFind, runFind, toggleReplace, replaceCurrent, replaceAll, clearFindHighlights, scrollTextareaToSelection, printNote, exportOfCurrent } = createFindBar({ api, flushSave, GUEST });
    const { createRichEditor, inline, showInlineMenu, inlineMenuKey, syncTextViews, tableStatsNow, syncSourceButton, applyEditorMode, toggleSource, followLink, openLinkDialog } = createEditorView({ api, refresh, updateStatus, updateSettings, scopeListToNote, selectNoteNow, scheduleSave, runFind, clearFindHighlights });
    const { renderRelated, renderRelatedSoon } = createRelated({ api, followLink });
    const { renderStickyButton, toggleSticky } = createStickyButton({ api, flushSave, refreshCurrentMeta });
    const { renderLockState, onLockButton, submitLockDialog, unlockFromScreen, applyLockedNote, lockMenuAction } = createLocking({ api, renderFileRow, flushSave, applyEditorMode, runFind, scheduleSave, renderStickyButton, updateStatus, refreshRow });
    const { renderRemindButton, openRemindDialog, setReminder } = createReminders({ api, flushSave, refreshCurrentMeta });
    const { syncShareMenu, openShareMenu, closeShareMenu, shareAction } = createSharing({ api, flushSave, closeFind, GUEST, exportOfCurrent, exportCurrent, startLiveHost, openLiveDialog, stopLive });
    const { attachFiles, toggleRecording } = createAttachments({ api, flushSave, refresh });
    const { openHistory, restoreVersion } = createHistoryDialog({ api, flushSave, applyEditorMode, runFind, scheduleSave });
    async function refreshCurrentMeta() {
      if (!state.currentId) return;
      const fresh = await api.notes.get(state.currentId);
      if (!fresh || !state.current || fresh.id !== state.current.id) return;
      state.current.sticky = fresh.sticky;
      state.current.pinned = fresh.pinned;
      state.current.remindAt = fresh.remindAt;
      state.current.remindedAt = fresh.remindedAt;
      state.current.live = fresh.live;
      renderStickyButton(state.current);
      renderRemindButton(state.current);
      renderLiveRow(state.current);
      await refresh({ keepEditor: true });
    }
    const { bot, toggleBot, describeBotScope, runBot, onBotEvent, openBotTerminal } = createBotPanel({ api, flushSave, refresh, applyFreshFileBody });
    const { tts, stopReadAloud, toggleReadAloud, populateVoices, startDictation } = createSpeech({ api });
    const { clearPdf, showPdf, pdfDirty, pdfBusy, flushPdf, reportFileSaved, closePdfPages, commitPdf, pdfOpen, forgetShownPdf, bindPdfEvents } = createPdfNote({ api, externalLinkClick, showBanner, openFiles });
    const { crafts, useWordCraft, craftFor, craftDirty, flushCrafts, showCraftOnly } = createCraftNotes({ api, GUEST, setSaved, showBanner, openFiles, reportFileSaved, refresh, renderFileRow });
    const { clearDocx, showDocx, docxDirty, flushDocx, docxOpen, forgetShownDocx, bindDocxEvents } = createWordNote({ api, flushSave, showBanner, reportFileSaved, externalLinkClick, crafts, useWordCraft });
    function externalLinkClick(e, href) {
      if (!/^https?:\/\//i.test(href)) return;
      if (e.ctrlKey || e.metaKey) api.app.openExternal(href);
      else toast("This link goes to " + href + ". Ctrl+click to open it.");
    }
    const { showImage, clearImage, toggleImageSize, syncImageToggle } = createImages({ api, showBanner });
    function fileBadge(note) {
      if (["docx", "sheet", "image"].includes(note.fileKind)) return import_helpers18.default.extOf(note.filePath).toUpperCase();
      if (note.fileKind !== "text") return (note.fileKind || "file").toUpperCase();
      if (!isPlainTextFile5(note)) return "Markdown";
      if (import_helpers18.default.isTableFile(note)) return import_helpers18.default.extOf(note.filePath).toUpperCase();
      return window.NotesCode ? window.NotesCode.languageFor(import_helpers18.default.extOf(note.filePath)).name : "Plain text";
    }
    function renderFileRow(note) {
      const isFile = !!(note && note.filePath);
      el.fileRow.classList.toggle("hidden", !isFile);
      el.fileBanner.classList.add("hidden");
      if (!(isFile && note.fileKind === "docx")) clearDocx();
      for (const [kind, key] of Object.entries(import_helpers18.default.CRAFT_OF)) if (!(isFile && note.fileKind === kind)) crafts[key].clear();
      if (!(isFile && note.fileKind === "pdf")) clearPdf();
      if (!(isFile && note.fileKind === "image")) clearImage();
      closeConvertMenu();
      el.editorColumn.classList.toggle("shows-document", isFile && (note.fileKind === "pdf" || !!import_helpers18.default.CRAFT_OF[note.fileKind]));
      el.editor.classList.toggle("shows-image", isFile && note.fileKind === "image");
      const inCraft = isFile && !!craftFor(note) && craftFor(note).usable();
      el.editorColumn.classList.toggle("shows-craft", inCraft);
      el.editor.classList.toggle("shows-craft", inCraft);
      syncTextViews(note);
      if (!isFile) return;
      el.fileKind.textContent = fileBadge(note);
      el.fileConvertBtn.classList.add("hidden");
      api.files.convertOptions(note.id).then((opts) => {
        if (state.currentId === note.id) el.fileConvertBtn.classList.toggle("hidden", !opts.length);
      }).catch(() => {
      });
      el.filePath.textContent = note.filePath;
      el.filePath.title = note.filePath;
      if (note.fileKind === "pdf") {
        el.pdfEditor.classList.remove("hidden");
        showBanner("Highlight, add text, draw or add a picture with the tools above; with a tool on, click a mark to move or delete it. Save writes your changes into this PDF, and the original is backed up first.");
        showPdf(note);
      } else if (note.fileKind === "docx") {
        el.docxEditor.classList.toggle("hidden", useWordCraft());
        showBanner(useWordCraft() ? "" : "Opening the Word document\u2026");
        showDocx(note);
      } else if (note.fileKind === "sheet") {
        showCraftOnly(note);
      } else if (note.fileKind === "image") {
        showBanner("");
        showImage(note);
      } else if (note.fileKind === "binary") {
        showBanner('This file type cannot be shown here. Use "Open with\u2026" to open it in its own app.');
      }
    }
    const { openConvertMenu, closeConvertMenu, convertCurrent } = createConvertMenu({ api, flushSave, openFiles });
    const documentDirty = () => pdfDirty() || docxDirty() || craftDirty();
    const documentBusy = () => pdfBusy() || docxDirty() || craftDirty();
    async function flushDocuments(opts) {
      const pdfSaved = await flushPdf(opts);
      const docxSaved = await flushDocx(opts);
      const craftSaved = await flushCrafts();
      return pdfSaved && docxSaved && craftSaved;
    }
    function showBanner(text) {
      el.fileBanner.textContent = text;
      el.fileBanner.classList.toggle("hidden", !text);
    }
    async function openFiles(paths) {
      await flushSave();
      let res;
      try {
        res = paths ? await api.files.link(paths) : await api.files.openDialog();
      } catch (err) {
        toast("Could not open: " + (err.message || err));
        return;
      }
      if (res.canceled) return;
      if (res.linked.length) {
        state.query = "";
        el.searchInput.value = "";
        if (state.view === "trash") {
          state.view = "all";
          el.navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.view === "all"));
        }
        await refresh({ keepEditor: true });
        if (res.firstId === state.currentId) {
          const fresh = await api.notes.get(res.firstId);
          if (fresh && state.currentId === fresh.id && !state.dirty && !state.inflight.has(fresh.id) && (fresh.body !== el.bodyInput.value || fresh.fileMtime !== state.current.fileMtime)) applyFreshFileBody(fresh);
        } else await openNote(res.firstId);
      }
      const failed = res.failed.length ? " Could not open: " + res.failed.join(", ") : "";
      toast((res.linked.length ? "Opened " + res.linked.length + (res.linked.length === 1 ? " file" : " files") : "Nothing opened") + failed);
    }
    async function pollCurrentFile() {
      const note = state.current;
      if (!note || !note.filePath || state.dirty || document.hidden || documentBusy()) return;
      let res;
      try {
        res = await api.files.refresh(note.id);
      } catch (_) {
        return;
      }
      if (documentBusy()) return;
      if (state.currentId !== note.id) return;
      if (res.missing) {
        showBanner("The file no longer exists at " + note.filePath + ". Your last view is kept here as a plain note.");
        return;
      }
      if (res.changed && !state.dirty) {
        const fresh = await api.notes.get(note.id);
        if (state.currentId !== note.id || state.dirty || state.inflight.has(note.id) || !fresh || documentBusy()) return;
        applyFreshFileBody(fresh);
        toast("Reloaded from disk: the file changed outside Notes.");
      }
    }
    function applyFreshFileBody(fresh) {
      state.current = fresh;
      if (!state.dirty) state.pending.delete(fresh.id);
      src.reload(fresh.body);
      if (isViewerOnlyFile8(fresh)) {
        showCode2(fresh, true);
        renderFileRow(fresh);
        updateStatus(fresh);
        return;
      }
      if (import_helpers18.default.isTableFile(fresh) && tableShown()) renderTable(fresh);
      if (state.rich && !isPlainTextFile5(fresh)) {
        let lossless = state.rich.setMarkdown(fresh.body, { keepSelection: true });
        if (fresh.filePath && lossless && !state.rich.lastRoundTripExact()) lossless = false;
        state.currentLossless = lossless;
        if (!lossless && !state.sourceMode && state.lossyOverride !== fresh.id) {
          applyEditorMode(true);
          toast("Switched to source: the file now contains formatting the rendered view would change.");
        }
      }
      autoGrow();
      updateStatus(fresh);
      if (find.open) runFind(true, true, true);
    }
    async function reloadCurrentFile() {
      if (!state.current || !state.current.filePath) return;
      await commitPdf();
      if ((state.dirty || documentDirty()) && !window.confirm("Discard your unsaved edits and reload from disk?")) return;
      const id = state.currentId;
      state.dirty = false;
      forgetShownPdf();
      forgetShownDocx();
      for (const c of Object.values(crafts)) c.forget();
      const res = await api.files.refresh(id);
      const fresh = await api.notes.get(id);
      if (state.currentId !== id || !fresh) return;
      applyFreshFileBody(fresh);
      toast(res.missing ? "File not found on disk." : res.changed ? "Reloaded from disk." : "Already up to date.");
    }
    async function addAgentFiles() {
      el.agentFilesStatus.textContent = "Looking\u2026";
      try {
        const res = await api.agentFiles.link();
        el.agentFilesStatus.textContent = "Found " + res.found + ", linked " + res.linked.length + (res.failed.length ? ", failed " + res.failed.length : "") + ".";
        el.settingsDialog.close();
        await setView("folder", res.folderId);
        toast('Agent files are in the "Agent files" folder. Edits write to the real files.');
      } catch (err) {
        el.agentFilesStatus.textContent = "Failed: " + (err.message || err);
      }
    }
    function scheduleSave() {
      state.lastTypedAt = Date.now();
      scheduleOutline();
      if (!state.currentId || state.current && state.current.trashedAt) return;
      state.dirty = true;
      if (find.open && state.sourceMode) runFind(true, true, true);
      setSaved("Saving\u2026");
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(flushSave, 350);
      if (state.current) updateStatus(state.current);
    }
    state.pending = /* @__PURE__ */ new Map();
    function currentPatch() {
      const patch = { title: el.titleInput.value, body: el.bodyInput.value, tags: el.tagsInput.value };
      if (isViewerOnlyFile8(state.current)) delete patch.body;
      if (lockedNow()) delete patch.body;
      return patch;
    }
    function scheduleRetry() {
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(async () => {
        if (state.pending.has(state.currentId)) {
          state.dirty = true;
          await flushSave();
        }
        await retryPending();
      }, 3e3);
    }
    function offerConflictChoice(id, patch) {
      if (state.conflictShown === id) return;
      state.conflictShown = id;
      toast("This file changed on disk while you were editing. Reload it (your edit is dropped) or keep yours.", {
        label: "Keep mine",
        run: async () => {
          state.conflictShown = null;
          const latest = state.currentId === id ? currentPatch() : state.pending.get(id) || patch;
          try {
            const updated = await api.notes.update(id, Object.assign({}, latest, { force: true }));
            if (state.pending.get(id) === patch || state.pending.get(id) === latest) state.pending.delete(id);
            if (state.currentId === id && updated) {
              state.current = updated;
              const same2 = JSON.stringify(currentPatch()) === JSON.stringify(latest);
              state.dirty = !same2;
              if (same2) setSaved("Saved");
              else scheduleSave();
              refreshRow(updated);
            }
          } catch (err) {
            reportSaveFailure(err);
            scheduleRetry();
          }
        }
      });
      setTimeout(() => {
        if (state.conflictShown === id) state.conflictShown = null;
      }, 12e3);
    }
    function reportSaveFailure(err) {
      if (state.saveErrorShown) return;
      state.saveErrorShown = true;
      toast("Could not save: " + (err && err.message ? err.message : err) + ". Retrying.");
      setTimeout(() => {
        state.saveErrorShown = false;
      }, 1e4);
    }
    async function retryPending() {
      let failed = false;
      for (const id of Array.from(state.pending.keys())) {
        if (id === state.currentId) continue;
        const patch = state.pending.get(id);
        if (!patch) continue;
        try {
          const updated = await api.notes.update(id, patch);
          if (state.pending.get(id) === patch) state.pending.delete(id);
          if (updated) {
            const idx = state.notes.findIndex((n) => n.id === id);
            if (idx !== -1) {
              state.notes[idx] = updated;
              refreshRow(updated);
            }
            toast('Saved earlier changes to "' + import_helpers18.default.truncate(import_helpers18.default.deriveTitle(updated), 30) + '"');
          }
        } catch (err) {
          if (/changed on disk/i.test(String(err && err.message))) {
            offerConflictChoice(id, patch);
            continue;
          }
          failed = true;
          reportSaveFailure(err);
        }
      }
      if (failed) scheduleRetry();
    }
    function stashIfDirty() {
      if (state.dirty && state.currentId) state.pending.set(state.currentId, currentPatch());
      if (state.pending.size) scheduleRetry();
    }
    function applyPendingTo(note) {
      const p = state.pending.get(note.id);
      if (!p) return false;
      el.titleInput.value = p.title;
      el.tagsInput.value = p.tags;
      if (typeof p.body === "string" && !(note.locked && !note.unlocked)) el.bodyInput.value = p.body;
      return true;
    }
    state.inflight = /* @__PURE__ */ new Map();
    async function flushSave(opts) {
      const docsSaved = await flushDocuments({ commit: !(opts && opts.fromBlur === true) });
      const textSaved = await flushTextSave();
      return docsSaved && textSaved;
    }
    async function flushTextSave() {
      clearTimeout(state.saveTimer);
      if (!state.dirty || !state.currentId) return true;
      const id = state.currentId;
      const patch = currentPatch();
      state.dirty = false;
      let updated;
      const write = api.notes.update(id, patch);
      state.inflight.set(id, write.then(() => void 0, () => void 0));
      try {
        updated = await write;
        if (state.pending.get(id) !== patch) state.pending.delete(id);
      } catch (err) {
        state.pending.set(id, patch);
        if (state.currentId === id) {
          state.dirty = true;
          setSaved("Save failed");
        }
        if (/changed on disk/i.test(String(err && err.message))) {
          offerConflictChoice(id, patch);
          return false;
        }
        reportSaveFailure(err);
        scheduleRetry();
        return false;
      } finally {
        state.inflight.delete(id);
      }
      if (!updated) return true;
      if (state.currentId === id) {
        state.current = updated;
        updateStatus(updated);
        setSaved(state.dirty ? "Saving\u2026" : "Saved");
        renderRelatedSoon();
        if (book.id && patch.title !== void 0) {
          const t = el.bookTabs.querySelector('.book-tab[data-id="' + id + '"] .t');
          if (t) t.textContent = import_helpers18.default.truncate(import_helpers18.default.deriveTitle(updated) || "Untitled", 28);
        }
        if (updated.filePath && el.filePath.textContent !== updated.filePath) {
          el.filePath.textContent = updated.filePath;
          el.filePath.title = updated.filePath;
        }
        if (el.titleInput.value === patch.title && updated.title !== patch.title && !state.dirty) el.titleInput.value = updated.title;
      }
      const idx = state.notes.findIndex((n) => n.id === id);
      if (idx !== -1) {
        const prevTags = (state.notes[idx].tags || []).join(",");
        state.notes[idx] = updated;
        refreshRow(updated);
        if (state.settings.sort === "updated" && idx !== 0) await refresh({ keepEditor: true });
        else if (updated.tags.join(",") !== prevTags) await refresh({ keepEditor: true });
      }
      api.notes.tags().then(renderTags);
      return true;
    }
    async function newNote(opts) {
      const title = opts && typeof opts.title === "string" ? opts.title.trim() : "";
      await flushSave();
      if (state.view === "trash") {
        state.view = "all";
        el.navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.view === "all"));
      }
      const data = {};
      if (state.view === "tag" && state.tag) data.tags = [state.tag];
      if (state.view === "pinned") data.pinned = true;
      if (state.view === "folder" && state.folderId) data.folderId = state.folderId;
      if (title) data.title = title;
      let note;
      try {
        note = await api.notes.create(data);
      } catch (err) {
        toast("Could not create a note: " + (err.message || err));
        return;
      }
      state.query = "";
      el.searchInput.value = "";
      await refresh({ keepEditor: true });
      await openNote(note.id, { newTab: true, focus: title ? "body" : "title" });
    }
    function renderPinButton(on) {
      setPressed(el.pinBtn, on);
      el.pinBtn.title = on ? "Unpin (Ctrl+D)" : "Pin to the top (Ctrl+D)";
      el.pinBtn.setAttribute("aria-label", on ? "Unpin note" : "Pin note");
    }
    async function togglePin() {
      if (!state.current || state.current.trashedAt) return;
      await flushSave();
      const updated = await api.notes.togglePin(state.currentId);
      state.current = updated;
      renderPinButton(updated.pinned);
      await refresh({ keepEditor: true });
      toast(updated.pinned ? "Pinned" : "Unpinned");
    }
    async function trashCurrent() {
      if (!state.current || state.current.trashedAt) return;
      const id = state.currentId;
      const title = import_helpers18.default.deriveTitle(state.current);
      await flushSave();
      if (documentDirty() && !window.confirm("Your changes to this document could not be saved. Move it to the trash anyway and lose them?")) return;
      await api.notes.trash(id);
      clearEditor();
      await refresh();
      toast('Moved "' + import_helpers18.default.truncate(title, 30) + '" to trash', { label: "Undo", run: async () => {
        await api.notes.restore(id);
        await refresh({ keepEditor: true });
        await selectNote(id);
      } });
    }
    async function restoreCurrent() {
      if (!state.current || !state.current.trashedAt) return;
      const id = state.currentId;
      await api.notes.restore(id);
      clearEditor();
      await refresh();
      toast("Restored");
    }
    async function destroyCurrent() {
      if (!state.current) return;
      if (!window.confirm('Delete "' + import_helpers18.default.deriveTitle(state.current) + '" forever? This cannot be undone.')) return;
      state.pending.delete(state.currentId);
      state.dirty = false;
      await api.notes.destroy(state.currentId);
      clearEditor();
      await refresh();
      toast("Deleted");
    }
    async function emptyTrash() {
      const listed = state.notes.slice();
      const n = listed.length;
      if (!n) return;
      const scope = state.query ? " matching your search" : " in the trash";
      if (!window.confirm("Permanently delete " + n + (n === 1 ? " note" : " notes") + scope + "? This cannot be undone.")) return;
      if (state.query) {
        for (const note of listed) await api.notes.destroy(note.id);
      } else await api.notes.emptyTrash();
      clearEditor();
      await refresh();
      toast(state.query ? "Deleted " + n + (n === 1 ? " note" : " notes") : "Trash emptied");
    }
    async function duplicateCurrent() {
      if (!state.current) return;
      await flushSave();
      let copy;
      try {
        copy = await api.notes.duplicate(state.currentId);
      } catch (err) {
        toast("Could not duplicate: " + (err.message || err));
        return;
      }
      await refresh({ keepEditor: true });
      await selectNote(copy.id);
      toast("Duplicated");
    }
    async function exportCurrent() {
      if (!state.current) return;
      await flushSave();
      try {
        const res = await api.app.exportNote(state.currentId);
        if (res.ok) toast("Exported to " + res.filePath);
      } catch (err) {
        toast("Export failed: " + (err.message || err));
      }
    }
    const { showCode: showCode2 } = createCodeEditor({ runFind, autoGrow, scrollTextareaToSelection });
    const { wrapSelection, handleEditorKeydown } = createEditorText({ runFind, scheduleSave });
    function openSettings() {
      const s = state.settings;
      draft = {};
      el.hotkeyInput.value = import_helpers18.default.displayAccelerator(s.hotkey).replace(/ /g, "");
      el.hotkeyError.textContent = "";
      el.themeSelect.value = s.theme;
      renderSchemeGrid();
      syncSettingsDirty();
      el.fontSizeInput.value = s.fontSize;
      el.fontSizeValue.textContent = s.fontSize + "px";
      el.openAtLoginInput.checked = s.openAtLogin;
      el.alwaysOnTopInput.checked = s.alwaysOnTop;
      syncAlignSeg(s.editorAlign);
      el.sidebarFloatInput.checked = !!s.sidebarCollapsed;
      el.editorFullWidthInput.checked = !s.editorWidth;
      el.editorWidthInput.disabled = !s.editorWidth;
      el.editorWidthInput.value = s.editorWidth || 760;
      el.editorWidthValue.textContent = (s.editorWidth || 760) + "px";
      el.gitEnabledInput.checked = s.gitEnabled;
      el.gitRemoteInput.value = s.gitRemote;
      populateVoices();
      el.settingsSearch.value = "";
      filterSettings();
      el.settingsDialog.showModal();
      renderVaultList();
      el.ttsRateInput.value = s.ttsRate;
      el.ttsRateValue.textContent = Number(s.ttsRate).toFixed(1) + "\xD7";
      refreshGitStatus();
      el.settingsScroll.scrollTop = 0;
      markSettingsSection();
      el.settingsSearch.focus();
    }
    let draft = {};
    const same = (a, b) => JSON.stringify(a === void 0 ? null : a) === JSON.stringify(b === void 0 ? null : b);
    const draftSettings = () => Object.assign({}, state.settings, draft);
    function settingsDirty() {
      return Object.keys(draft).some((k) => !same(draft[k], state.settings[k]));
    }
    function setDraft(patch) {
      for (const k of Object.keys(patch)) {
        if (same(patch[k], state.settings[k])) delete draft[k];
        else draft[k] = patch[k];
      }
      previewSettings();
      syncSettingsDirty();
    }
    function previewSettings() {
      const s = draftSettings();
      applyTheme(s);
      document.documentElement.style.setProperty("--editor-font-size", s.fontSize + "px");
      applyEditorLayout(s);
      renderSchemeGrid();
    }
    function syncSettingsDirty() {
      const dirty = settingsDirty();
      el.saveSettingsBtn.disabled = !dirty;
      el.settingsDirtyNote.textContent = dirty ? "Unsaved changes" : "";
      el.cancelSettingsBtn.textContent = dirty ? "Cancel" : "Close";
      const gitPending = "gitEnabled" in draft || "gitRemote" in draft;
      el.gitCommitBtn.disabled = gitPending || el.gitCommitBtn.dataset.off === "1";
      el.gitPushBtn.disabled = gitPending || el.gitPushBtn.dataset.off === "1";
    }
    async function saveSettings() {
      if (!settingsDirty()) {
        closeSettings();
        return true;
      }
      const patch = Object.assign({}, draft);
      const res = await updateSettings(patch);
      draft = {};
      if (res.error) {
        el.hotkeyError.textContent = res.error;
        el.hotkeyInput.value = import_helpers18.default.displayAccelerator(res.settings.hotkey).replace(/ /g, "");
        syncSettingsDirty();
        el.hotkeyInput.focus();
        return false;
      }
      if ("gitEnabled" in patch || "gitRemote" in patch) refreshGitStatus();
      closeSettings();
      toast(patch.hotkey ? "Settings saved. Hotkey is now " + res.info.hotkeyDisplay : "Settings saved");
      return true;
    }
    function discardSettings() {
      draft = {};
      applySettings(state.settings);
      closeSettings();
    }
    function closeSettings() {
      draft = {};
      el.settingsDialog.close();
    }
    function requestCloseSettings() {
      if (!settingsDirty()) {
        closeSettings();
        return;
      }
      const names = Object.keys(draft).filter((k) => !same(draft[k], state.settings[k])).map((k) => SETTING_NAMES[k] || k);
      el.settingsSaveList.textContent = "Not saved yet: " + names.join(", ") + ".";
      el.settingsSaveDialog.showModal();
    }
    async function leaveSettings() {
      if (settingsDirty()) await saveSettings();
      else closeSettings();
    }
    const SETTING_NAMES = {
      hotkey: "Global hotkey",
      theme: "Theme",
      colorScheme: "Colour scheme",
      customColors: "Custom colours",
      sidebarCollapsed: "Hide the sidebar",
      openAtLogin: "Start at sign-in",
      alwaysOnTop: "Keep above other windows",
      fontSize: "Text size",
      editorWidth: "Column width",
      editorAlign: "Column position",
      ttsVoice: "Read-aloud voice",
      ttsRate: "Read-aloud speed",
      gitEnabled: "Git history",
      gitRemote: "Git remote"
    };
    const T = () => import_themes.default;
    function renderSchemeGrid() {
      const s = draftSettings();
      const mode = effectiveTheme(s);
      const ids = Object.keys(T().SCHEMES).concat(T().CUSTOM);
      if (el.schemeGrid.children.length !== ids.length) {
        el.schemeGrid.innerHTML = "";
        for (const id of ids) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "scheme-swatch";
          b.dataset.scheme = id;
          b.setAttribute("role", "radio");
          const sample = document.createElement("span");
          sample.className = "swatch-sample";
          sample.setAttribute("aria-hidden", "true");
          const aa = document.createElement("span");
          aa.textContent = "Aa";
          const dot = document.createElement("span");
          dot.className = "swatch-accent";
          sample.append(aa, dot);
          sample.insertAdjacentHTML("beforeend", I("check"));
          sample.lastElementChild.classList.add("swatch-check");
          const name = document.createElement("span");
          name.className = "swatch-name";
          name.textContent = id === T().CUSTOM ? "Custom" : T().SCHEMES[id].name;
          b.append(sample, name);
          el.schemeGrid.append(b);
        }
      }
      for (const b of el.schemeGrid.children) {
        const id = b.dataset.scheme;
        const picked = s.customColors && s.customColors[mode];
        const sw = id === T().CUSTOM && !picked ? T().swatch(s.colorScheme, s.customColors, mode) : T().swatch(id, s.customColors, mode);
        const sample = b.firstChild;
        sample.style.background = sw.paper;
        sample.style.color = sw.text;
        sample.querySelector(".swatch-accent").style.background = sw.accent;
        const on = id === s.colorScheme;
        b.setAttribute("aria-checked", String(on));
        b.tabIndex = on ? 0 : -1;
      }
      const seed = T().seedsOf(s.colorScheme, s.customColors, mode);
      el.customBgInput.value = seed.background;
      el.customTextInput.value = seed.text;
      el.customAccentInput.value = seed.accent;
      el.customModeNote.textContent = "(" + mode + ")";
      el.schemeResetBtn.disabled = s.colorScheme === T().BUILT_IN;
    }
    function chooseScheme(id) {
      setDraft({ colorScheme: id });
    }
    function pickCustomColor() {
      const s = draftSettings();
      const mode = effectiveTheme(s);
      const custom = Object.assign({}, s.customColors || {});
      custom[mode] = { background: el.customBgInput.value, text: el.customTextInput.value, accent: el.customAccentInput.value };
      setDraft({ colorScheme: T().CUSTOM, customColors: custom });
    }
    function bindAppearance() {
      el.schemeGrid.addEventListener("click", (e) => {
        const b = e.target.closest(".scheme-swatch");
        if (b) chooseScheme(b.dataset.scheme);
      });
      el.schemeGrid.addEventListener("keydown", (e) => {
        const cols = getComputedStyle(el.schemeGrid).gridTemplateColumns.split(" ").length;
        const step = { ArrowRight: 1, ArrowDown: cols, ArrowLeft: -1, ArrowUp: -cols }[e.key];
        if (!step) return;
        e.preventDefault();
        const all = [...el.schemeGrid.children];
        const i = all.findIndex((b) => b.getAttribute("aria-checked") === "true");
        const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
        if (next === all[i]) return;
        chooseScheme(next.dataset.scheme);
        next.focus();
      });
      for (const input of [el.customBgInput, el.customTextInput, el.customAccentInput]) input.addEventListener("input", pickCustomColor);
      el.schemeResetBtn.addEventListener("click", () => setDraft({ colorScheme: T().BUILT_IN, customColors: null }));
    }
    function markSettingsSection() {
      const top = el.settingsScroll.getBoundingClientRect().top;
      const sections = [...el.settingsScroll.querySelectorAll(".settings-section")].filter((s) => s.offsetParent);
      let current = sections[0];
      for (const sec of sections) if (sec.getBoundingClientRect().top - top < 80) current = sec;
      if (el.settingsScroll.scrollTop + el.settingsScroll.clientHeight >= el.settingsScroll.scrollHeight - 4) current = sections[sections.length - 1];
      el.settingsNav.querySelectorAll("a").forEach((a) => a.classList.toggle("is-active", !!current && a.getAttribute("href") === "#" + current.id));
    }
    function bindSettingsNav() {
      el.settingsNav.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        if (a.classList.contains("is-dim")) {
          el.settingsSearch.value = "";
          filterSettings();
        }
        const sec = el.settingsScroll.querySelector(a.getAttribute("href"));
        if (sec) sec.scrollIntoView({ block: "start" });
      });
      el.settingsScroll.addEventListener("scroll", markSettingsSection, { passive: true });
      el.settingsSearch.addEventListener("input", filterSettings);
      el.settingsSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") e.preventDefault();
        else if (e.key === "Escape" && el.settingsSearch.value) {
          e.preventDefault();
          e.stopPropagation();
          el.settingsSearch.value = "";
          filterSettings();
        }
      });
      el.settingsDialog.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
          e.preventDefault();
          el.settingsSearch.focus();
          el.settingsSearch.select();
        }
      });
    }
    function filterSettings() {
      const tokens = import_helpers18.default.tokenize(el.settingsSearch.value);
      const ranges = [];
      let any = false;
      for (const sec of el.settingsScroll.querySelectorAll(".settings-section")) {
        let hits = 0;
        for (const unit of sec.children) {
          if (unit.tagName === "H3") continue;
          const text = unit.textContent.toLowerCase();
          const ok = tokens.every((t) => text.includes(t));
          unit.classList.toggle("is-filtered", !ok);
          if (!ok) continue;
          hits++;
          if (tokens.length) collectMatches(unit, tokens, ranges);
        }
        sec.classList.toggle("is-filtered", tokens.length > 0 && !hits);
        const link = el.settingsNav.querySelector('a[href="#' + sec.id + '"]');
        if (link) link.classList.toggle("is-dim", tokens.length > 0 && !hits);
        if (hits) any = true;
      }
      el.settingsEmpty.classList.toggle("hidden", any);
      if (window.CSS && CSS.highlights) {
        if (ranges.length) CSS.highlights.set("settings-match", new Highlight(...ranges));
        else CSS.highlights.delete("settings-match");
      }
      markSettingsSection();
    }
    function collectMatches(root, tokens, out) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node; node = walker.nextNode(); ) {
        const text = node.textContent.toLowerCase();
        for (const t of tokens) {
          for (let i = text.indexOf(t); i !== -1; i = text.indexOf(t, i + t.length)) {
            const r = new Range();
            r.setStart(node, i);
            r.setEnd(node, i + t.length);
            out.push(r);
          }
        }
      }
    }
    function syncListModeSeg() {
      const mode = state.settings.listMode;
      el.listModeSeg.querySelectorAll("button").forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-checked", String(on));
      });
    }
    function syncAlignSeg(value) {
      el.alignSeg.querySelectorAll("button[data-align]").forEach((b) => {
        const on = b.dataset.align === value;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-checked", String(on));
      });
    }
    async function refreshGitStatus() {
      renderGitStatus(await api.git.status());
    }
    function renderGitStatus(s) {
      if (!s) return;
      let text;
      if (!s.enabled) text = "Off. Your notes file is still backed up to the backups folder.";
      else if (s.available === false) text = "git was not found on this computer, so no history is being kept.";
      else if (!s.commits) text = s.pending ? "First commit coming up\u2026" : "Repository ready; no commits yet.";
      else text = s.commits + (s.commits === 1 ? " commit" : " commits") + ", last " + import_helpers18.default.relativeTime(s.lastCommitAt) + (s.pending ? ", changes waiting" : "") + (s.remote ? s.lastPushAt ? ", pushed " + import_helpers18.default.relativeTime(s.lastPushAt) : ", not pushed yet" : "");
      if (s.lastError) text += "  Error: " + s.lastError;
      el.gitStatus.textContent = text;
      el.gitPushBtn.dataset.off = !s.enabled || !s.remote ? "1" : "0";
      el.gitCommitBtn.dataset.off = !s.enabled ? "1" : "0";
      syncSettingsDirty();
    }
    function acceleratorFromEvent(e) {
      const mods = [];
      if (e.ctrlKey) mods.push("Control");
      if (e.altKey) mods.push("Alt");
      if (e.shiftKey) mods.push("Shift");
      if (e.metaKey) mods.push("Super");
      const ignore = ["Control", "Alt", "Shift", "Meta", "AltGraph", "OS"];
      if (ignore.includes(e.key)) return { partial: mods.join("+") + "+" };
      let key = e.key;
      const numpad = { NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", NumpadDecimal: "numdec" };
      if (numpad[e.code]) key = numpad[e.code];
      else if (/^Numpad[0-9]$/.test(e.code)) key = "num" + e.code.slice(-1);
      else if (key === "+") key = "Plus";
      else if (key === " ") key = "Space";
      else if (key === "Escape") key = "Esc";
      else if (key === "ArrowUp") key = "Up";
      else if (key === "ArrowDown") key = "Down";
      else if (key === "ArrowLeft") key = "Left";
      else if (key === "ArrowRight") key = "Right";
      else if (key.length === 1) key = key.toUpperCase();
      return { partial: null, value: mods.concat(key).join("+") };
    }
    function commitHotkey(value) {
      const parsed = import_helpers18.default.parseAccelerator(value);
      if (!parsed.ok) {
        el.hotkeyError.textContent = parsed.reason;
        return;
      }
      el.hotkeyError.textContent = "";
      el.hotkeyInput.value = import_helpers18.default.displayAccelerator(parsed.value).replace(/ /g, "");
      setDraft({ hotkey: parsed.value });
    }
    let palette = null;
    function openPalette(query) {
      if (!palette) palette = NotesPalette.create({ dialog: el.palette, input: el.paletteInput, list: el.paletteList, source: paletteItems });
      closeMoreMenu();
      closeShareMenu();
      palette.open(query);
    }
    const buttonWords = (b) => ((b.querySelector(".lbl") || {}).textContent || b.getAttribute("aria-label") || b.textContent || "").trim();
    const shortcutIn = (b) => ((b.querySelector(".keys") || {}).textContent || (/\((Ctrl[^)]*|F\d+|Esc)\)/.exec(b.title || "") || [])[1] || "").trim();
    const usable = (b) => !!b && !b.disabled && !b.classList.contains("hidden") && getComputedStyle(b).display !== "none";
    function commandList() {
      const noteOpen = !!state.current && !el.editor.classList.contains("hidden");
      const fromButton = (b, group, extra) => Object.assign({ id: b.id, group, title: buttonWords(b), icon: b.dataset.icon, keys: shortcutIn(b), ok: usable(b) && (group !== "This note" || noteOpen), run: () => b.click() }, extra);
      const cmd = (id, group, title, icon, keys, run, ok, keywords) => ({ id, group, title, icon, keys, run, ok: ok === void 0 ? true : ok, keywords });
      const side = (name, fn) => GUEST ? () => toPeer({ type: "command", name }) : fn;
      if (noteOpen) syncShareMenu();
      const list = [
        cmd("new-note", "Create", "New note", "square-pen", "Ctrl+N", side("newNote", newNote)),
        cmd("open-file", "Create", "Open a file as a note\u2026", "folder-open", "Ctrl+O", side("openFiles", () => openFiles()), true, "markdown pdf word docx txt"),
        cmd("new-folder", "Create", "New folder", "folder-plus", "Ctrl+Shift+N", () => startCreateFolder(state.view === "folder" ? state.folderId : null), !GUEST),
        cmd("new-book", "Create", "New book", "book-plus", "", () => startCreateFolder(null, true), !GUEST),
        fromButton(el.pinBtn, "This note", { title: state.current && state.current.pinned ? "Unpin" : "Pin to the top", keys: "Ctrl+D" }),
        fromButton(el.sourceBtn, "This note", { title: state.sourceMode ? "Show the rendered view" : "Show Markdown source", keys: "Ctrl+E" }),
        cmd("find", "This note", "Find in this note", "search", "Ctrl+Shift+F", () => openFind(), noteOpen),
        cmd("image-size", "This note", "Image: actual size, or fitted to the pane", "zoom-in", "Enter on the picture", () => toggleImageSize(), !!(state.current && state.current.fileKind === "image"), "zoom 100% fit picture"),
        cmd("replace", "This note", "Find and replace", "replace", "Ctrl+H", () => {
          if (!find.open) openFind();
          toggleReplace(true);
        }, noteOpen),
        ...[...el.moreMenu.querySelectorAll(".menu-item")].map((b) => fromButton(b, "This note")),
        fromButton(el.restoreBtn, "This note"),
        fromButton(el.destroyBtn, "This note"),
        ...[...el.shareMenu.querySelectorAll("button[data-action]")].map((b) => ({ id: "share-" + b.dataset.action, group: "Share", title: b.textContent.trim(), icon: "share-2", keys: "", ok: noteOpen && !state.current.trashedAt && !b.classList.contains("hidden"), run: () => shareAction(b.dataset.action) })),
        cmd("sidebar", "View", sidebarLayout() === "docked" ? "Hide the sidebar" : "Show the sidebar", "panel-left", "Ctrl+\\", toggleSidebar, !GUEST, "auto hide float compact zen"),
        cmd("list", "View", el.app.classList.contains("list-collapsed") ? "Show the note list" : "Hide the note list", "list", "Ctrl+Shift+\\", toggleList, !GUEST),
        cmd("list-mode", "View", state.settings && state.settings.listMode === "tree" ? "Note list: show as a list" : "Note list: show folders with their notes", state.settings && state.settings.listMode === "tree" ? "list" : "folder-open", "", () => updateSettings({ listMode: state.settings.listMode === "tree" ? "list" : "tree" }).then(() => refresh({ keepEditor: true })), !GUEST, "tree outline view"),
        cmd("focus", "View", "Focus: hide the sidebar and the list", "eye", "", () => updateSettings({ sidebarCollapsed: true, listCollapsed: true }), !GUEST && !(state.settings && state.settings.sidebarCollapsed && state.settings.listCollapsed), "zen distraction free writing"),
        cmd("width", "View", state.settings && state.settings.editorWidth ? "Writing column: full width" : "Writing column: readable width", "columns-2", "", () => updateSettings({ editorWidth: state.settings.editorWidth ? 0 : 760 }), !!state.settings, "measure line length narrow wide"),
        fromButton(el.splitViewBtn, "View", { title: "Split view: open a second side", ok: usable(el.splitViewBtn) }),
        cmd("new-tab", "View", "New tab", "plus", "Ctrl+T", newEmptyTab),
        cmd("close-tab", "View", "Close this tab", "x", "Ctrl+W", () => closeTab(tabs.at), tabs.ids.length > 0),
        cmd("theme", "View", effectiveTheme() === "dark" ? "Switch to light" : "Switch to dark", "sun-moon", "Ctrl+Shift+L", () => updateSettings({ theme: effectiveTheme() === "dark" ? "light" : "dark" }), true, "theme dark light mode"),
        ...["all", "pinned", "reminders", "trash"].map((v) => cmd("go-" + v, "Go to", { all: "All notes", pinned: "Pinned", reminders: "Reminders", trash: "Trash" }[v], { all: "notebook-text", pinned: "star", reminders: "bell", trash: "trash-2" }[v], "", () => setView(v), !GUEST)),
        ...flattenTree(state.tree).map((f) => cmd("folder-" + f.id, "Go to", (f.book ? "Book: " : "Folder: ") + f.name, f.book ? "book-open" : "folder", "", () => setView("folder", f.id), !GUEST)),
        ...[...el.tagList.querySelectorAll(".nav-item")].map((b) => cmd("tag-" + b.firstChild.textContent, "Go to", "Tag: #" + b.firstChild.textContent, "hash", "", () => b.click(), !GUEST)),
        cmd("settings", "App", "Settings", "settings", "Ctrl+,", side("settings", openSettings), true, "preferences options hotkey font search"),
        ...Object.keys(import_themes.default.SCHEMES).map((id) => cmd("scheme-" + id, "View", "Colour scheme: " + import_themes.default.SCHEMES[id].name, "palette", "", () => updateSettings({ colorScheme: id }), !GUEST && (state.settings && state.settings.colorScheme) !== id, "theme colors appearance")),
        cmd("scheme-custom", "View", "Colour scheme: custom colours\u2026", "palette", "", side("settings", () => {
          openSettings();
          document.getElementById("set-appearance").scrollIntoView({ block: "start" });
        }), true, "theme colors appearance pick"),
        cmd("import", "App", "Import Markdown files\u2026", "download", "", () => el.importBtn.click(), !GUEST),
        cmd("export-all", "App", "Export all notes\u2026", "download", "", () => el.exportAllBtn.click(), !GUEST, "backup json"),
        cmd("data-folder", "App", "Open the data folder", "folder-open", "", () => el.dataFolderBtn.click(), !GUEST),
        cmd("hide", "App", "Hide Notes", "x", "Esc", () => flushSave().then(() => api.app.hide()))
      ];
      return list.filter((c) => c.ok && c.title);
    }
    async function paletteItems(query) {
      const commands = commandList();
      const commandsOnly = /^\s*>/.test(query);
      let notes = null;
      if (!commandsOnly) {
        const all = await api.notes.list({ sort: "updated" });
        const folders = new Map(flattenTree(state.tree).map((f) => [f.id, f.name]));
        notes = all.filter((n) => n.id !== state.currentId).map((n) => ({
          id: "note-" + n.id,
          group: "Notes",
          title: import_helpers18.default.deriveTitle(n),
          icon: n.filePath ? "file-text" : n.locked ? "lock" : n.pinned ? "star" : "notebook-text",
          hint: n.folderId && folders.get(n.folderId) || import_helpers18.default.relativeTime(n.updatedAt),
          matches: (q) => !n.locked && import_helpers18.default.matchesQuery(n, q),
          run: (opts) => (opts.newTab ? openNote(n.id, { newTab: true }) : scopeListToNote(n).then(() => openNote(n.id))).then(() => focusBody())
        }));
      }
      const out = NotesPalette.rank(query, commands, notes);
      const title = query.replace(/^\s*>\s*/, "").trim();
      if (title && !commandsOnly) out.push({ id: "create", group: "Create", title: 'New note "' + import_helpers18.default.truncate(title, 60) + '"', icon: "square-pen", keys: "", run: () => GUEST ? toPeer({ type: "command", name: "newNote", title }) : newNote({ title }) });
      return out;
    }
    function onKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const inDialog = el.palette.open || el.settingsDialog.open || el.splitDialog.open || el.linkDialog.open || el.remindDialog.open || el.lockDialog.open || el.liveDialog.open || el.historyDialog.open || el.signDialog.open;
      if (ctrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s" && (pdfOpen() || docxOpen())) {
        e.preventDefault();
        if (pdfOpen()) flushPdf({ commit: true, explicit: true });
        if (docxOpen()) flushDocx({ explicit: true });
        return;
      }
      if (e.key === "Escape") {
        if (inDialog) return;
        if (el.pdfEditor.contains(document.activeElement)) return;
        if (find.open) {
          e.preventDefault();
          closeFind();
          return;
        }
        if (!el.moreMenu.classList.contains("hidden")) {
          e.preventDefault();
          closeMoreMenu();
          el.moreBtn.focus();
          return;
        }
        if (!el.shareMenu.classList.contains("hidden")) {
          e.preventDefault();
          closeShareMenu();
          el.shareBtn.focus();
          return;
        }
        if (!el.convertMenu.classList.contains("hidden")) {
          e.preventDefault();
          closeConvertMenu();
          el.fileConvertBtn.focus();
          return;
        }
        if (!el.lockMenu.classList.contains("hidden")) {
          e.preventDefault();
          el.lockMenu.classList.add("hidden");
          el.lockBtn.focus();
          return;
        }
        if (state.menuFolderId) {
          e.preventDefault();
          closeFolderMenu();
          return;
        }
        if (!el.pageMenu.classList.contains("hidden") || !el.bookMenu.classList.contains("hidden")) {
          e.preventDefault();
          closeAllBookMenus();
          return;
        }
        if (sidebarPeek) {
          e.preventDefault();
          unpeekSidebar();
          return;
        }
        if (readerOpen()) {
          e.preventDefault();
          closeReader();
          return;
        }
        if (document.activeElement === el.searchInput && el.searchInput.value) {
          el.searchInput.value = "";
          clearTimeout(searchTimer);
          endSearchStep();
          return;
        }
        e.preventDefault();
        flushSave().then(() => api.app.hide());
        return;
      }
      if (inDialog) return;
      if (GUEST && ctrl && !e.altKey) {
        const k = e.key.toLowerCase();
        const cmd = e.shiftKey ? k === "n" ? "newFolder" : null : { n: "newNote", f: "search", o: "openFiles", ",": "settings" }[k];
        if (cmd) {
          e.preventDefault();
          toPeer({ type: "command", name: cmd });
          return;
        }
      }
      if (ctrl && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "t":
            e.preventDefault();
            newEmptyTab();
            return;
          case "w":
            e.preventDefault();
            closeTab(tabs.at);
            return;
          case "n":
            e.preventDefault();
            newNote();
            return;
          case "o":
            e.preventDefault();
            openFiles();
            return;
          case "l":
            e.preventDefault();
            onLockButton();
            return;
          case "h":
            e.preventDefault();
            if (!find.open) openFind();
            toggleReplace(true);
            return;
          case "f":
            e.preventDefault();
            showList().then(() => {
              el.searchInput.focus();
              el.searchInput.select();
            });
            return;
          case "e":
            e.preventDefault();
            if (state.current) toggleSource();
            return;
          case "p":
            e.preventDefault();
            openPalette();
            return;
          case "d":
            e.preventDefault();
            togglePin();
            return;
          case "s":
            e.preventDefault();
            flushSave().then((ok) => toast(ok ? "Saved" : "Save failed, will retry"));
            return;
          case ",":
            e.preventDefault();
            openSettings();
            return;
          case "\\":
            e.preventDefault();
            toggleSidebar();
            return;
          // Ctrl+Delete deletes the next word inside text fields; only trash when focus is elsewhere.
          case "delete":
            if (!inTextField()) {
              e.preventDefault();
              trashCurrent();
            }
            return;
          // In the rendered view, Ctrl+B and Ctrl+I are handled by the editor itself.
          case "b":
            if (document.activeElement === el.bodyInput && !isPlainTextFile5(state.current)) {
              e.preventDefault();
              wrapSelection("**", "**");
            }
            return;
          case "i":
            if (document.activeElement === el.bodyInput && !isPlainTextFile5(state.current)) {
              e.preventDefault();
              wrapSelection("_", "_");
            }
            return;
          case "k":
            if (document.activeElement === el.bodyInput) {
              if (!isPlainTextFile5(state.current)) {
                e.preventDefault();
                wrapSelection("[", "](url)");
              }
            } else if (bodyHasFocus() && !src.codeOn) {
              e.preventDefault();
              openLinkDialog();
            }
            return;
          default:
            break;
        }
      }
      if (ctrl && e.shiftKey && e.key === "Delete") {
        e.preventDefault();
        trashCurrent();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        updateSettings({ theme: effectiveTheme() === "dark" ? "light" : "dark" });
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        startCreateFolder(state.view === "folder" ? state.folderId : null);
        return;
      }
      if (ctrl && e.shiftKey && !e.altKey && e.code === "Backslash") {
        e.preventDefault();
        toggleList();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        toggleReadAloud();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        toggleBot();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        toggleSticky();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openFind();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        attachFiles();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        toggleRecording();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        openHistory();
        return;
      }
      if (ctrl && !e.shiftKey && (e.key === "PageDown" || e.key === "PageUp")) {
        if (stepPage(e.key === "PageDown" ? 1 : -1)) e.preventDefault();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        openRemindDialog();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        openShareMenu();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        printNote();
        return;
      }
      if (e.key === "F3" && find.open) {
        e.preventDefault();
        runFind(!e.shiftKey);
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        startDictation();
        return;
      }
      if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const idx = state.notes.findIndex((n) => n.id === state.currentId);
        const next = state.notes[idx + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) selectNote(next.id).then(() => focusBody());
      }
    }
    function bind() {
      el.newNoteBtn.addEventListener("click", newNote);
      el.emptyNewNoteBtn.addEventListener("click", newNote);
      el.paletteBtn.addEventListener("click", () => openPalette());
      el.moreBtn.addEventListener("click", () => {
        if (el.moreMenu.classList.contains("hidden")) openMoreMenu();
        else closeMoreMenu();
      });
      el.moreMenu.addEventListener("click", (e) => {
        if (e.target.closest(".menu-item")) closeMoreMenu();
      });
      bindMenuKeys();
      bindSettingsNav();
      bindSidebarFloat();
      el.tagsFold.addEventListener("click", () => updateSettings({ tagsCollapsed: !state.settings.tagsCollapsed }));
      bindTreeKeys(el.folderTree);
      bindTreeKeys(el.noteTree);
      el.listModeSeg.addEventListener("click", (e) => {
        const b = e.target.closest("[data-mode]");
        if (b) updateSettings({ listMode: b.dataset.mode }).then(() => {
          syncListModeSeg();
          refresh({ keepEditor: true });
        });
      });
      el.sidebarFloatInput.addEventListener("change", () => {
        sidebarPeek = null;
        setDraft({ sidebarCollapsed: el.sidebarFloatInput.checked });
      });
      el.openFileBtn.addEventListener("click", () => openFiles());
      el.fileRevealBtn.addEventListener("click", () => state.currentId && api.files.reveal(state.currentId));
      bindDocxEvents();
      bindPdfEvents();
      el.fileConvertBtn.addEventListener("click", () => {
        if (el.convertMenu.classList.contains("hidden")) openConvertMenu();
        else closeConvertMenu();
      });
      el.convertMenu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-to]");
        if (b) convertCurrent(b.dataset.to);
      });
      el.fileOpenBtn.addEventListener("click", async () => {
        if (!state.currentId) return;
        const err = await api.files.openExternal(state.currentId);
        if (err) toast("Could not open: " + err);
      });
      el.fileReloadBtn.addEventListener("click", reloadCurrentFile);
      el.imageView.addEventListener("click", toggleImageSize);
      el.imageView.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleImageSize();
        }
      });
      el.imageView.addEventListener("load", syncImageToggle);
      el.imageView.addEventListener("error", () => {
        if (!el.imageView.getAttribute("src")) return;
        showBanner('This image could not be shown: the file may be damaged, or in a format Notes cannot show. Use "Open with\u2026" to open it.');
      });
      el.agentFilesBtn.addEventListener("click", addAgentFiles);
      el.vaultAddFolderBtn.addEventListener("click", addVaultFolder);
      el.vaultCloneBtn.addEventListener("click", openCloneDialog);
      el.vaultDestBtn.addEventListener("click", async () => {
        const d = await api.vaults.pickFolder();
        if (d) el.vaultDestInput.value = d;
      });
      el.vaultCancelBtn.addEventListener("click", () => el.vaultDialog.close());
      el.vaultForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitClone();
      });
      fromMain("vaultStatus", ({ id, status }) => {
        const before = state.vaultStatus[id] || {};
        state.vaultStatus[id] = status;
        if (status.lastError && status.lastError !== before.lastError) toast("Vault: " + status.lastError);
        renderFolders();
        const typing = document.activeElement && el.vaultList.contains(document.activeElement);
        if (typing) {
          const item = el.vaultList.querySelector('.vault-item[data-id="' + id + '"] .vault-status');
          if (item) {
            item.textContent = describeVaultStatus({ status });
            item.classList.toggle("is-error", !!(status.lastError || status.conflict));
          }
        } else renderVaultList();
      });
      el.readAloudBtn.addEventListener("click", toggleReadAloud);
      el.dictateBtn.addEventListener("click", startDictation);
      el.stickyBtn.addEventListener("click", toggleSticky);
      el.printBtn.addEventListener("click", printNote);
      el.remindBtn.addEventListener("click", openRemindDialog);
      el.lockBtn.addEventListener("click", onLockButton);
      el.bookPrevBtn.addEventListener("click", () => stepPage(-1));
      el.bookNextBtn.addEventListener("click", () => stepPage(1));
      el.bookAddBtn.addEventListener("click", addPage);
      el.bookName.addEventListener("click", openBookMenu);
      el.newBookBtn.addEventListener("click", () => startCreateFolder(null, true));
      el.pageMenu.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", () => pageMenuAction(b.dataset.action)));
      el.bookMenu.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", () => bookMenuAction(b.dataset.action)));
      el.bookReaderCloseBtn.addEventListener("click", closeReader);
      el.bookReaderPdfBtn.addEventListener("click", () => exportBook("pdf"));
      el.bookReaderPrintBtn.addEventListener("click", () => exportBook("print"));
      el.bookReaderToc.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-page]");
        if (!a) return;
        const sec = document.getElementById("reader-page-" + a.dataset.page);
        if (sec) sec.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      el.bookReaderBody.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-edit]");
        if (btn) {
          const id = btn.dataset.edit;
          closeReader();
          selectNote(id);
          return;
        }
        const link = e.target.closest("a[href]");
        if (link) {
          e.preventDefault();
          followLink(link.getAttribute("href"));
        }
      });
      el.liveLinkBtn.addEventListener("click", async () => {
        const s = state.current && await api.live.status(state.current.id);
        if (s && s.url) openLiveDialog("link", s.url);
      });
      el.liveStopBtn.addEventListener("click", stopLive);
      el.liveForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitLiveDialog();
      });
      el.liveCancelBtn.addEventListener("click", () => el.liveDialog.close());
      el.liveCopyBtn.addEventListener("click", async () => {
        await api.app.copy({ text: el.liveLinkInput.value });
        toast("Link copied");
      });
      el.liveDialog.addEventListener("close", () => focusBody());
      fromMain("liveStatus", ({ id, status }) => {
        if (status && status.ended) {
          delete state.liveStatus[id];
          if (state.current && state.current.id === id) {
            refreshCurrentMeta();
            toast("The host ended the live share. Your copy of the note stays.");
          }
          return;
        }
        if (status) state.liveStatus[id] = status;
        else delete state.liveStatus[id];
        if (state.current && state.current.id === id) {
          if (!status && state.current.live) refreshCurrentMeta();
          else renderLiveRow(state.current);
        }
      });
      el.lockMenu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-action]");
        if (b) lockMenuAction(b.dataset.action);
      });
      el.lockForm.addEventListener("submit", (e) => {
        e.preventDefault();
        submitLockDialog();
      });
      el.lockCancelBtn.addEventListener("click", () => el.lockDialog.close());
      el.lockDialog.addEventListener("close", () => focusBody());
      el.lockScreen.addEventListener("submit", (e) => {
        e.preventDefault();
        unlockFromScreen();
      });
      fromMain("relocked", async (ids) => {
        for (const id of ids) state.pending.delete(id);
        for (const id of ids) tabs.titles.delete(id);
        renderTabs();
        if (readerOpen()) closeReader();
        if (state.currentId && ids.includes(state.currentId)) {
          state.dirty = false;
          const fresh = await api.notes.get(state.currentId);
          if (fresh) applyLockedNote(fresh);
        }
        refresh({ keepEditor: true });
      });
      el.remindQuick.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pick]");
        if (b) setReminder(quickPick(b.dataset.pick));
      });
      el.remindForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const t = Date.parse(el.remindInput.value);
        if (!Number.isFinite(t)) {
          toast("Pick a date and time");
          return;
        }
        setReminder(t);
      });
      el.remindClearBtn.addEventListener("click", () => setReminder(null));
      el.remindCancelBtn.addEventListener("click", () => el.remindDialog.close());
      el.remindDialog.addEventListener("close", () => focusBody());
      api.on.notice((text) => toast(String(text)));
      api.on.editCommand(runEditCommand);
      api.on.reminderFired(({ id, title }) => {
        toast("\u23F0 " + (title || "Reminder"), { label: "Open", run: async () => {
          await setView("all");
          await openNote(id, { focus: "body" });
        } });
        refresh({ keepEditor: true }).then(() => {
          if (state.currentId === id) refreshCurrentMeta();
        });
      });
      el.shareBtn.addEventListener("click", () => {
        if (el.shareMenu.classList.contains("hidden")) openShareMenu();
        else closeShareMenu();
      });
      el.shareMenu.addEventListener("click", (e) => {
        const b = e.target.closest("[data-action]");
        if (b) shareAction(b.dataset.action);
      });
      el.findNextBtn.addEventListener("click", () => runFind(true));
      el.findReplaceToggle.addEventListener("click", () => toggleReplace());
      el.replaceOneBtn.addEventListener("click", replaceCurrent);
      el.replaceAllBtn.addEventListener("click", replaceAll);
      el.replaceInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey || e.altKey) replaceAll();
          else replaceCurrent();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeFind();
        }
      });
      el.attachBtn.addEventListener("click", attachFiles);
      el.recordBtn.addEventListener("click", toggleRecording);
      el.historyBtn.addEventListener("click", openHistory);
      el.historyCloseBtn.addEventListener("click", () => el.historyDialog.close());
      el.historyRestoreBtn.addEventListener("click", restoreVersion);
      el.historyDialog.addEventListener("close", () => focusBody());
      el.linkNoteSelect.addEventListener("change", () => {
        if (el.linkNoteSelect.value) el.linkInput.value = el.linkNoteSelect.value;
      });
      el.findPrevBtn.addEventListener("click", () => runFind(false));
      el.findCloseBtn.addEventListener("click", closeFind);
      el.findInput.addEventListener("input", () => runFind(true, true));
      el.bodyInput.addEventListener("input", () => {
        if (find.open && state.sourceMode) runFind(true, true, true);
      });
      el.findInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          runFind(!e.shiftKey);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeFind();
        }
      });
      fromMain("stickiesChanged", () => {
        refreshCurrentMeta();
      });
      api.on.openNote(async (id) => {
        await setView("all");
        await openNote(id, { focus: "body" });
      });
      el.botBtn.addEventListener("click", () => toggleBot());
      el.botCloseBtn.addEventListener("click", () => toggleBot(false));
      el.botRunBtn.addEventListener("click", runBot);
      el.botTerminalBtn.addEventListener("click", openBotTerminal);
      el.botPrompt.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          runBot();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          toggleBot(false);
        }
      });
      api.on.botEvent(onBotEvent);
      if (window.speechSynthesis) {
        populateVoices();
        window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
      }
      el.ttsVoiceSelect.addEventListener("change", () => setDraft({ ttsVoice: el.ttsVoiceSelect.value }));
      el.ttsRateInput.addEventListener("input", () => {
        el.ttsRateValue.textContent = Number(el.ttsRateInput.value).toFixed(1) + "\xD7";
      });
      el.ttsRateInput.addEventListener("change", () => setDraft({ ttsRate: Number(el.ttsRateInput.value) }));
      setInterval(pollCurrentFile, 3e3);
      let dragDepth = 0;
      document.addEventListener("dragenter", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
          dragDepth++;
          el.app.classList.add("is-dropping");
        }
      });
      document.addEventListener("dragleave", () => {
        if (--dragDepth <= 0) {
          dragDepth = 0;
          el.app.classList.remove("is-dropping");
        }
      });
      document.addEventListener("dragover", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
      });
      document.addEventListener("drop", (e) => {
        dragDepth = 0;
        el.app.classList.remove("is-dropping");
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        const paths = Array.from(e.dataTransfer.files).map((f) => api.files.pathFor(f)).filter(Boolean);
        if (paths.length) openFiles(paths);
      });
      el.navItems.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
      el.themeBtn.addEventListener("click", () => updateSettings({ theme: effectiveTheme() === "dark" ? "light" : "dark" }));
      el.settingsBtn.addEventListener("click", openSettings);
      el.toggleSidebarBtn.addEventListener("click", toggleSidebar);
      el.toggleListBtn.addEventListener("click", toggleList);
      el.hideListBtn.addEventListener("click", toggleList);
      setupResizer(el.sidebarResizer, "sidebarWidth");
      setupResizer(el.listResizer, "listWidth");
      el.newFolderBtn.addEventListener("click", () => startCreateFolder(state.view === "folder" ? state.folderId : null));
      el.folderSelect.addEventListener("change", () => {
        if (state.currentId) moveNoteToFolder(state.currentId, el.folderSelect.value || null);
      });
      el.folderMenu.querySelectorAll("button[data-action]").forEach((b) => b.addEventListener("click", () => folderMenuAction(b.dataset.action)));
      document.addEventListener("pointerdown", (e) => {
        if (state.menuFolderId && !el.folderMenu.contains(e.target)) closeFolderMenu();
        if ((!el.pageMenu.classList.contains("hidden") || !el.bookMenu.classList.contains("hidden")) && !el.pageMenu.contains(e.target) && !el.bookMenu.contains(e.target) && !el.bookName.contains(e.target)) closeAllBookMenus();
        if (!el.shareMenu.classList.contains("hidden") && !el.shareMenu.contains(e.target) && !el.shareBtn.contains(e.target)) closeShareMenu();
        if (!el.moreMenu.classList.contains("hidden") && !el.moreMenu.contains(e.target) && !el.moreBtn.contains(e.target)) closeMoreMenu();
        if (!el.convertMenu.classList.contains("hidden") && !el.convertMenu.contains(e.target) && !el.fileConvertBtn.contains(e.target)) closeConvertMenu();
        if (!el.lockMenu.classList.contains("hidden") && !el.lockMenu.contains(e.target) && !el.lockBtn.contains(e.target)) el.lockMenu.classList.add("hidden");
      });
      wireDropTarget(el.navAll, null);
      window.addEventListener("resize", () => {
        if (!state.settings) return;
        applySidebar();
        applyPaneWidths(state.settings.sidebarWidth, state.settings.listWidth);
      });
      el.searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(endSearchStep, 120);
      });
      el.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && state.notes.length) {
          selectNote(state.notes[0].id).then(() => focusBody());
        }
        if (e.key === "ArrowDown" && state.notes.length) {
          e.preventDefault();
          selectNote(state.notes[0].id).then(() => focusBody());
        }
      });
      el.sortSelect.addEventListener("change", () => updateSettings({ sort: el.sortSelect.value }).then(() => refresh({ keepEditor: true })));
      el.emptyTrashBtn.addEventListener("click", emptyTrash);
      el.pinBtn.addEventListener("click", togglePin);
      el.sourceBtn.addEventListener("click", () => toggleSource());
      el.bodyInput.addEventListener("input", autoGrow);
      el.richEditor.addEventListener("mousedown", (e) => {
        if (e.target === el.richEditor && state.rich) {
          e.preventDefault();
          state.rich.focus("end");
        }
      });
      el.linkForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const href = el.linkInput.value.trim();
        el.linkDialog.close();
        if (state.rich) state.rich.setLink(href && href !== "https://" ? href : "", state.linkRange);
      });
      el.linkRemoveBtn.addEventListener("click", () => {
        el.linkDialog.close();
        if (state.rich) state.rich.setLink("", state.linkRange);
      });
      el.linkCancelBtn.addEventListener("click", () => el.linkDialog.close());
      el.linkDialog.addEventListener("close", () => focusBody());
      el.alignSeg.querySelectorAll("button[data-align]").forEach((b) => b.addEventListener("click", () => {
        setDraft({ editorAlign: b.dataset.align });
        syncAlignSeg(b.dataset.align);
      }));
      el.editorWidthInput.addEventListener("input", () => {
        el.editorWidthValue.textContent = el.editorWidthInput.value + "px";
        el.editorColumn.style.setProperty("--editor-col-width", el.editorWidthInput.value + "px");
      });
      el.editorWidthInput.addEventListener("change", () => setDraft({ editorWidth: Number(el.editorWidthInput.value) }));
      el.editorFullWidthInput.addEventListener("change", () => {
        const full = el.editorFullWidthInput.checked;
        el.editorWidthInput.disabled = full;
        setDraft({ editorWidth: full ? 0 : Number(el.editorWidthInput.value) || 760 });
      });
      el.gitEnabledInput.addEventListener("change", () => setDraft({ gitEnabled: el.gitEnabledInput.checked }));
      const commitRemote = () => setDraft({ gitRemote: el.gitRemoteInput.value.trim() });
      el.gitRemoteInput.addEventListener("change", commitRemote);
      el.gitRemoteInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRemote();
        }
      });
      el.gitCommitBtn.addEventListener("click", async () => {
        await flushSave();
        const r = await api.git.commit();
        toast(r.ok ? r.nothingToCommit ? "Nothing new to commit" : "Committed" : "Commit failed: " + (r.error || r.skipped));
        refreshGitStatus();
      });
      el.gitPushBtn.addEventListener("click", async () => {
        const r = await api.git.push();
        toast(r.ok ? "Pushed" : "Push failed: " + (r.error || r.skipped));
        refreshGitStatus();
      });
      fromMain("gitStatus", (s) => renderGitStatus(s));
      el.exportBtn.addEventListener("click", exportCurrent);
      el.duplicateBtn.addEventListener("click", duplicateCurrent);
      el.splitBtn.addEventListener("click", openSplitDialog);
      el.splitForm.addEventListener("submit", (e) => {
        e.preventDefault();
        applySplit();
      });
      el.splitCancelBtn.addEventListener("click", () => {
        state.splitNoteId = null;
        el.splitDialog.close();
      });
      el.restoreBtn.addEventListener("click", restoreCurrent);
      el.deleteBtn.addEventListener("click", trashCurrent);
      el.destroyBtn.addEventListener("click", destroyCurrent);
      el.titleInput.addEventListener("input", scheduleSave);
      el.titleInput.addEventListener("input", renderActiveTabTitle);
      el.tagsInput.addEventListener("input", scheduleSave);
      el.bodyInput.addEventListener("input", scheduleSave);
      el.titleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          focusBody();
        }
      });
      el.tagsInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          focusBody();
        }
      });
      el.tagsInput.addEventListener("blur", flushSave);
      el.bodyInput.addEventListener("keydown", handleEditorKeydown);
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) flushSave({ fromBlur: true });
      });
      window.addEventListener("blur", () => flushSave({ fromBlur: true }));
      window.addEventListener("beforeunload", flushSave);
      el.hotkeyInput.addEventListener("keydown", (e) => {
        if (e.key === "Tab") return;
        e.preventDefault();
        const r = acceleratorFromEvent(e);
        if (r.partial !== null) {
          el.hotkeyInput.value = r.partial;
          return;
        }
        el.hotkeyInput.value = r.value;
        commitHotkey(r.value);
      });
      el.hotkeyInput.addEventListener("blur", () => {
        const v = el.hotkeyInput.value.trim();
        if (v && !v.endsWith("+") && v !== import_helpers18.default.displayAccelerator(draftSettings().hotkey).replace(/ /g, "")) commitHotkey(v);
        else if (!v || v.endsWith("+")) el.hotkeyInput.value = import_helpers18.default.displayAccelerator(draftSettings().hotkey).replace(/ /g, "");
      });
      el.themeSelect.addEventListener("change", () => setDraft({ theme: el.themeSelect.value }));
      el.fontSizeInput.addEventListener("input", () => {
        el.fontSizeValue.textContent = el.fontSizeInput.value + "px";
        document.documentElement.style.setProperty("--editor-font-size", el.fontSizeInput.value + "px");
      });
      el.fontSizeInput.addEventListener("change", () => setDraft({ fontSize: Number(el.fontSizeInput.value) }));
      el.openAtLoginInput.addEventListener("change", () => setDraft({ openAtLogin: el.openAtLoginInput.checked }));
      el.alwaysOnTopInput.addEventListener("change", () => setDraft({ alwaysOnTop: el.alwaysOnTopInput.checked }));
      el.importBtn.addEventListener("click", async () => {
        let res;
        try {
          res = await api.app.importMarkdown();
        } catch (err) {
          toast("Import failed: " + (err.message || err));
          return;
        }
        if (res.canceled) return;
        if (res.count) {
          await leaveSettings();
          await refresh({ keepEditor: true });
          if (res.firstId) await selectNote(res.firstId);
        }
        const failed = res.failed && res.failed.length ? ". Could not read: " + res.failed.join(", ") : "";
        toast((res.count ? "Imported " + res.count + (res.count === 1 ? " note" : " notes") : "Nothing imported") + failed);
      });
      el.exportAllBtn.addEventListener("click", async () => {
        try {
          const res = await api.app.exportAll();
          if (res.ok) toast("Exported to " + res.filePath);
        } catch (err) {
          toast("Export failed: " + (err.message || err));
        }
      });
      el.dataFolderBtn.addEventListener("click", () => api.app.openDataFolder());
      el.settingsDialog.addEventListener("close", () => {
        if (state.current) focusBody();
      });
      el.settingsForm.addEventListener("submit", (e) => {
        e.preventDefault();
        saveSettings();
      });
      el.settingsDialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        requestCloseSettings();
      });
      el.cancelSettingsBtn.addEventListener("click", requestCloseSettings);
      el.settingsDialog.addEventListener("mousedown", (e) => {
        if (e.target === el.settingsDialog) requestCloseSettings();
      });
      el.settingsSaveDialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        el.settingsSaveDialog.close();
      });
      el.settingsSaveKeepBtn.addEventListener("click", () => el.settingsSaveDialog.close());
      el.settingsSaveDiscardBtn.addEventListener("click", () => {
        el.settingsSaveDialog.close();
        discardSettings();
      });
      el.settingsSaveDialog.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        el.settingsSaveDialog.close();
        saveSettings();
      });
      bindAppearance();
      let shownBusy = false;
      api.on.shown(async () => {
        if (shownBusy) return;
        shownBusy = true;
        try {
          await state.initDone;
          if (el.settingsDialog.open) return;
          if (state.current) {
            if (state.current.title || state.current.body) focusBody();
            else el.titleInput.focus();
            return;
          }
          if (state.notes.length) {
            await selectNote(state.notes[0].id);
            focusBody();
            return;
          }
          const counts = await api.notes.counts();
          if (counts.all === 0) await newNote();
        } finally {
          shownBusy = false;
        }
      });
      api.on.newNote(newNote);
      api.on.flush(async () => {
        try {
          await Promise.all([flushSave().then(retryPending), flushPeer()]);
        } finally {
          api.app.flushDone();
        }
      });
      fromMain("reloaded", async (info) => {
        const reason = info && info.reason;
        await refresh({ keepEditor: true });
        tabs.titles.clear();
        renderTabs();
        if (state.currentId) {
          const wanted = state.currentId;
          const fresh = await api.notes.get(wanted);
          if (fresh && fresh.id !== state.currentId) return;
          if (!fresh && wanted === state.currentId && !state.dirty) {
            clearEditor();
            if (!GUEST) await refresh();
            return;
          }
          if (fresh && reason === "live" && fresh.body === el.bodyInput.value && fresh.title !== el.titleInput.value && !state.dirty) {
            el.titleInput.value = fresh.title;
            state.current.title = fresh.title;
            refreshRow(fresh);
          }
          if (fresh && isViewerOnlyFile8(fresh) && fresh.fileMtime !== state.current.fileMtime) applyFreshFileBody(fresh);
          else if (fresh && fresh.body !== el.bodyInput.value) {
            if (reason === "live") {
              if (!state.dirty && !state.inflight.has(state.currentId) || Date.now() - state.lastTypedAt > 1500) {
                state.dirty = false;
                applyFreshFileBody(fresh);
                if (fresh.title !== el.titleInput.value) el.titleInput.value = fresh.title;
              }
            } else if (!state.dirty && !state.inflight.has(fresh.id)) {
              applyFreshFileBody(fresh);
              if (reason === "vault") toast("This note was updated from the vault.");
            } else toast("This note changed elsewhere while you were editing. Your text is kept; " + (fresh.filePath ? "use Reload to take the disk version." : "reopen the note to see the other version."));
          }
        }
        if (reason === "recovered") toast("Your notes file is readable again; saving resumed.");
      });
      fromMain("settingsChanged", (s) => applySettings(s));
      fromMain("systemTheme", (t) => {
        state.systemDark = t === "dark";
        applyTheme();
      });
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
        state.systemDark = ev.matches;
        applyTheme();
      });
      setInterval(() => {
        if (!document.hidden) {
          renderList();
          if (state.current) updateStatus(state.current);
        }
      }, 6e4);
    }
    async function init() {
      import_icons5.default.hydrate(document);
      if (navigator.windowControlsOverlay) navigator.windowControlsOverlay.addEventListener("geometrychange", syncTitleBar);
      const [settings, info] = await Promise.all([api.settings.get(), api.app.info()]);
      if (GUEST) document.body.classList.add("pane-guest");
      createRichEditor();
      applySettings(settings);
      applyInfo(info);
      restoreTabs(settings);
      bind();
      bindTabs();
      if (settings.lastFolderId) {
        state.view = "folder";
        state.folderId = settings.lastFolderId;
        el.navItems.forEach((b) => b.classList.remove("is-active"));
      }
      await refresh();
      if (GUEST) {
        toPeer({ type: "hello" });
        return;
      }
      if (!state.currentId && state.notes.length) await selectNote(state.notes[0].id);
      if (panesOf(settings).split) openSplit(true);
      if (state.current) focusBody();
      api.app.rendererReady().catch(() => {
      });
    }
    window.addEventListener("error", (e) => console.error("Uncaught: " + e.message));
    window.addEventListener("unhandledrejection", (e) => console.error("Unhandled rejection: " + (e.reason && e.reason.message || e.reason)));
    let markInitDone;
    state.initDone = new Promise((resolve) => {
      markInitDone = resolve;
    });
    init().catch((err) => {
      console.error(err);
      toast("Something went wrong starting Notes: " + err.message);
    }).finally(() => markInitDone());
  })();
})();
