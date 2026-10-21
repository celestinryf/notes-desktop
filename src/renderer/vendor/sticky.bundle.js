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
        function isViewerOnlyFile(note) {
          return !!(note && note.filePath && note.fileKind !== "text");
        }
        function extOf(filePath) {
          const base = (String(filePath || "").split(/[\\/]/).pop() || "").toLowerCase();
          if (!base.includes(".")) return base;
          return base.slice(base.lastIndexOf(".") + 1);
        }
        function isPlainTextFile(note) {
          return !!(note && note.filePath && note.fileKind === "text" && !/\.(md|markdown|mdx)$/i.test(note.filePath));
        }
        function isNonMarkdownFile(note) {
          return isPlainTextFile(note) || isViewerOnlyFile(note);
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
          return isPlainTextFile(note) && ["csv", "tsv"].includes(extOf(note.filePath));
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
          isViewerOnlyFile,
          isPlainTextFile,
          isNonMarkdownFile,
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
          (root || document).querySelectorAll("[data-icon]").forEach((el) => {
            const first = el.firstElementChild;
            if (first && first.classList.contains("icon") && first.dataset.name === el.dataset.icon) return;
            if (first && first.classList.contains("icon")) first.remove();
            el.insertAdjacentHTML("afterbegin", svg(el.dataset.icon));
            el.firstElementChild.dataset.name = el.dataset.icon;
          });
        }
        const api = { svg, hydrate, names: Object.keys(PATHS) };
        if (typeof module === "object" && module.exports) module.exports = api;
        else window.NotesIcons = api;
      })();
    }
  });

  // src/renderer/sticky.js
  var import_helpers = __toESM(require_helpers());
  var import_icons = __toESM(require_icons());
  (function() {
    const api = window.notesApi;
    const $ = (s) => document.querySelector(s);
    const el = {
      title: $("#stickyTitle"),
      colors: $("#stickyColors"),
      topBtn: $("#stickyTopBtn"),
      openBtn: $("#stickyOpenBtn"),
      closeBtn: $("#stickyCloseBtn"),
      editor: $("#stickyEditor"),
      missing: $("#stickyMissing"),
      status: $("#stickyStatus")
    };
    import_icons.default.hydrate(document);
    const id = new URLSearchParams(location.search).get("id");
    const COLORS = ["peach", "cream", "leaf", "sky", "rose", "ink"];
    const state = { note: null, rich: null, saveTimer: null, dirty: false, saving: false, readOnly: false, systemDark: window.matchMedia("(prefers-color-scheme: dark)").matches, settings: null };
    function effectiveTheme() {
      const t = state.settings && state.settings.theme;
      if (t === "light" || t === "dark") return t;
      return state.systemDark ? "dark" : "light";
    }
    function applySticky(sticky) {
      const color = sticky && sticky.color || "peach";
      document.documentElement.dataset.color = color;
      for (const b of el.colors.querySelectorAll("button")) b.classList.toggle("is-on", b.dataset.color === color);
      const onTop = !sticky || sticky.onTop !== false;
      el.topBtn.setAttribute("aria-pressed", String(onTop));
      el.topBtn.title = onTop ? "Floating above other windows (click to let windows cover it)" : "Behind other windows (click to float on top)";
    }
    function render(note) {
      state.note = note;
      if (!note || note.trashedAt) {
        el.editor.classList.add("hidden");
        el.missing.classList.remove("hidden");
        el.title.textContent = "Sticky";
        return;
      }
      const title = note.title || (note.body.split("\n").find((l) => l.trim()) || "Untitled").replace(/^#+\s*/, "").slice(0, 80);
      el.title.textContent = title;
      document.title = title;
      applySticky(note.sticky);
      if (state.rich && !state.dirty && (note.body !== state.shownBody || !state.shownOnce)) {
        state.shownBody = note.body;
        state.shownOnce = true;
        const lossless = state.rich.setMarkdown(note.body);
        const viewerOnly = import_helpers.default.isViewerOnlyFile(note);
        const plain = import_helpers.default.isPlainTextFile(note);
        const exactEnough = lossless && (!note.filePath || state.rich.lastRoundTripExact());
        setReadOnly(viewerOnly || plain || !exactEnough, viewerOnly ? "Read-only file. Open in Notes to view it." : plain ? "Plain-text file. Edit it in Notes (\u2197)." : "Has formatting this sticky cannot show. Edit it in Notes (\u2197).");
      }
    }
    function setReadOnly(on, why) {
      state.readOnly = on;
      if (state.rich) state.rich.setEditable(!on);
      document.documentElement.classList.toggle("is-readonly", on);
      el.status.textContent = on ? why : "";
    }
    function scheduleSave() {
      if (state.readOnly) return;
      state.dirty = true;
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(save, 500);
    }
    async function save() {
      if (!state.dirty || !state.rich || !state.note) return;
      const body = state.rich.getMarkdown();
      state.saving = true;
      try {
        const updated = await api.notes.update(id, { body });
        if (updated) {
          state.note = updated;
          state.shownBody = body;
          state.dirty = state.rich.getMarkdown() !== body;
          el.status.textContent = "";
        } else {
          state.dirty = false;
          setReadOnly(true, "This note is gone.");
        }
        if (state.dirty) scheduleSave();
      } catch (err) {
        if (/changed on disk/i.test(String(err.message))) {
          state.dirty = false;
          try {
            await api.files.refresh(id);
          } catch (_) {
          }
          state.shownBody = null;
          await reload();
          el.status.textContent = "The file changed on disk; showing the new version. Your last edit was not saved.";
          return;
        }
        el.status.textContent = "Save failed: " + (err.message || err);
        setTimeout(scheduleSave, 3e3);
      } finally {
        state.saving = false;
      }
    }
    async function reload() {
      const note = await api.notes.get(id);
      render(note);
    }
    function init() {
      for (const c of COLORS) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.color = c;
        b.title = c;
        b.addEventListener("click", () => api.stickies.setColor(id, c).catch((err) => {
          el.status.textContent = "Could not save: " + (err.message || err);
        }));
        el.colors.append(b);
      }
      el.topBtn.addEventListener("click", () => {
        const on = el.topBtn.getAttribute("aria-pressed") === "true";
        api.stickies.setOnTop(id, !on).catch((err) => {
          el.status.textContent = "Could not save: " + (err.message || err);
        });
      });
      el.openBtn.addEventListener("click", () => api.stickies.openInNotes(id));
      el.title.addEventListener("dblclick", () => api.stickies.openInNotes(id));
      el.closeBtn.addEventListener("click", async () => {
        await flush();
        api.stickies.close(id, { forget: true });
      });
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          flush().finally(() => api.stickies.close(id, { forget: false }));
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          flush();
        }
      });
      window.addEventListener("blur", () => {
        if (state.dirty) flush();
      });
      api.on.flush(async () => {
        try {
          await flush();
        } finally {
          api.app.flushDone();
        }
      });
      window.addEventListener("beforeunload", () => {
        if (state.dirty) {
          try {
            api.notes.update(id, { body: state.rich.getMarkdown() });
          } catch (_) {
          }
        }
      });
      if (window.NotesEditor) {
        state.rich = window.NotesEditor.create(el.editor, {
          placeholder: "Jot something\u2026 - [ ] makes a checkbox.",
          onUpdate: () => {
            if (!state.readOnly && state.note && state.rich.getMarkdown() !== state.note.body) scheduleSave();
          }
        });
        el.editor.addEventListener("click", (e) => {
          const a = e.target.closest("a[href]");
          if (a && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            const href = a.getAttribute("href") || "";
            if (/^note:\/\//i.test(href)) api.stickies.openInNotes(href.replace(/^note:\/\//i, "").replace(/\/$/, ""));
            else if (/^attachment:\/\//i.test(href)) api.attachments.open(href).then((r) => {
              if (r) el.status.textContent = String(r);
            });
            else api.app.openExternal(href);
          }
        });
      } else {
        el.status.textContent = "Editor failed to load";
      }
      api.on.settingsChanged((s) => {
        state.settings = s;
        document.documentElement.dataset.theme = effectiveTheme();
      });
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (ev) => {
        state.systemDark = ev.matches;
        document.documentElement.dataset.theme = effectiveTheme();
      });
      api.on.stickyChanged((sticky) => applySticky(sticky));
      api.on.editCommand((cmd) => {
        if (state.rich && !state.readOnly) state.rich.editor.chain().focus()[cmd === "redo" ? "redo" : "undo"]().run();
      });
      api.on.noteChanged((info) => {
        if (info && info.id === id && !state.dirty) reload();
      });
      api.on.reloaded(() => {
        if (!state.dirty) reload();
      });
      api.settings.get().then((settings) => {
        state.settings = settings;
        document.documentElement.dataset.theme = effectiveTheme();
        return reload();
      }).then(() => {
        if (state.rich) state.rich.focus();
      });
    }
    async function flush() {
      clearTimeout(state.saveTimer);
      await save();
    }
    init();
  })();
})();
