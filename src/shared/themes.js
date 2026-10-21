'use strict';
/* Color schemes: the groundwork for Settings > Appearance (premade schemes, and colours the person picks).

   The built-in scheme, "Notes", is the stylesheet itself (styles.css :root and [data-theme="dark"]); choosing it sets
   nothing. Every other scheme is three seed colours per mode (background, text, accent), and derive() makes the
   whole set of colour tokens from them, so a scheme can never be half-finished. Whatever the seeds, text colours are
   pushed until they read at 4.5:1 or more on every surface (7:1 for body text where that can be reached), and the
   colour on the accent is whichever of dark or light reads on it: picking colours can never make the app unreadable.

   Shared by the main process (the window's background before the page paints), the store (settings) and the page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotesThemes = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BUILT_IN = 'notes';
  const CUSTOM = 'custom';

  // Premade schemes: { id: { name, light: seed, dark: seed } }, a seed being { background, text, accent }.
  // The seeds are only a start: derive() makes every token from them and keeps the text readable. The order here
  // is the order of the swatches in Settings. Names and seeds were chosen by the agent on 2026-10-20; change freely.
  const SCHEMES = {
    notes: { name: 'Notes', builtIn: true },
    paper: { name: 'Paper', light: { background: '#fafafa', text: '#1f1f1f', accent: '#3c6fd1' }, dark: { background: '#1c1c1e', text: '#ebebeb', accent: '#7aa2f7' } },
    slate: { name: 'Slate', light: { background: '#f3f5f8', text: '#1d2430', accent: '#2f6fd6' }, dark: { background: '#1b2028', text: '#e3e8ef', accent: '#8ab4f8' } },
    forest: { name: 'Forest', light: { background: '#f3f6ee', text: '#1f2a1a', accent: '#3f7a3a' }, dark: { background: '#1a2219', text: '#e3ebdc', accent: '#8cc46e' } },
    ocean: { name: 'Ocean', light: { background: '#eef5f8', text: '#14262e', accent: '#1c7a9c' }, dark: { background: '#15222a', text: '#dde9ef', accent: '#5fc0dc' } },
    rose: { name: 'Rose', light: { background: '#fbf3f4', text: '#2c1a1f', accent: '#c2375a' }, dark: { background: '#241a1e', text: '#f3e6ea', accent: '#e8809a' } },
    sepia: { name: 'Sepia', light: { background: '#f4ecd8', text: '#3b2f1e', accent: '#8a5a2b' }, dark: { background: '#2a2318', text: '#ead9bd', accent: '#d19a5a' } },
  };
  // The built-in scheme's own seeds (styles.css --paper, --fg and --accent), for its swatch and as the custom
  // pickers' starting colours.
  const BUILT_IN_SEEDS = { light: { background: '#fffaf3', text: '#2a1a12', accent: '#f47b3e' }, dark: { background: '#211710', text: '#f6eadb', accent: '#f47b3e' } };

  // The colour tokens a scheme sets (styles.css defines them all for the built-in scheme). Brand names that the
  // stylesheet uses directly (carets, checkboxes, the live dot) are included so they follow the scheme too.
  const TOKENS = [
    'chrome', 'base', 'paper', 'raised',
    'fg', 'fg-2', 'fg-3',
    'hover', 'pressed', 'selected', 'selected-fg', 'well',
    'line', 'line-2', 'field', 'field-bg', 'float-line', 'float-shadow', 'scroll-thumb',
    'accent', 'accent-fg', 'accent-hover', 'accent-text', 'focus',
    'danger', 'ok', 'document-bg',
    'syn-keyword', 'syn-string', 'syn-atom', 'syn-comment', 'syn-punct',
    'cream', 'peach', 'tangerine', 'ember', 'leaf', 'ink',
  ];

  // The built-in scheme's window colours (styles.css --paper and --fg), for the window before the page paints.
  const BUILT_IN_WINDOW = { light: { background: '#fffaf3', foreground: '#2a1a12' }, dark: { background: '#211710', foreground: '#f6eadb' } };

  // ---- colour arithmetic (sRGB, #rrggbb) ----------------------------------------------------------------

  const HEX = /^#[0-9a-f]{6}$/i;
  const isHex = (v) => typeof v === 'string' && HEX.test(v);
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  // a with t (0..1) of b mixed in
  const mix = (a, b, t) => { const x = parse(a), y = parse(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const rgba = (hex, alpha) => 'rgba(' + parse(hex).join(', ') + ', ' + alpha + ')';
  // what a colour at alpha looks like over a background
  const over = (hex, alpha, bg) => mix(bg, hex, alpha);
  function luminance(hex) {
    const [r, g, b] = parse(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  const worstContrast = (color, surfaces) => Math.min(...surfaces.map((s) => contrast(color, s)));
  // Moves a colour toward black or white, a step at a time, until it reads at `min` on every surface; the end colour
  // if nothing short of it does.
  function legible(color, surfaces, min, towardDark) {
    const end = towardDark ? '#000000' : '#ffffff';
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const c = mix(color, end, Math.min(1, t));
      if (worstContrast(c, surfaces) >= min) return c;
    }
    return end;
  }

  // ---- deriving a scheme --------------------------------------------------------------------------------

  // A background text can be read on: one in the middle (too light for white text, too dark for black) is moved
  // toward the end it is nearer, only as far as it takes black or white to read on it at 8:1, so the surfaces made
  // from it a step either side still leave room for 4.5:1.
  function readableBackground(bg) {
    const light = luminance(bg) > 0.179;
    const end = light ? '#ffffff' : '#000000', ink = light ? '#000000' : '#ffffff';
    for (let t = 0; t <= 1.0001; t += 0.02) { const c = mix(bg, end, Math.min(1, t)); if (contrast(c, ink) >= 8) return c; }
    return end;
  }

  // The whole token set from a seed. Which way things go (darker or lighter) follows the background itself, not the
  // mode it is picked for, so a dark background chosen for "light" still gets readable text.
  function derive(seed) {
    const bg = readableBackground(seed.background), light = luminance(bg) > 0.179; // above it, dark text reads better
    const towardDark = light;
    const paper = bg;
    const base = light ? mix(bg, seed.text, 0.04) : mix(bg, '#000000', 0.22);
    const chrome = light ? mix(bg, seed.text, 0.07) : mix(bg, '#000000', 0.36);
    const raised = light ? mix(bg, '#ffffff', 0.5) : mix(bg, seed.text, 0.1);
    const surfaces = [chrome, base, paper, raised];

    const fg = legible(seed.text, surfaces, 7, towardDark);
    // Text also sits on rows under a hover or pressed fill (the pressed one is the stronger): it must read there too.
    const grounds = surfaces.concat(surfaces.map((s) => over(fg, 0.1, s)));
    const fg2 = legible(mix(fg, bg, 0.25), grounds, 4.5, towardDark);
    const fg3 = legible(mix(fg, bg, 0.38), grounds, 4.5, towardDark);

    const accent = seed.accent;
    const accentText = legible(accent, grounds, 4.5, towardDark);
    // The colour on an accent fill: dark or light, whichever reads on it (one of the two always reaches 4.5:1).
    const onAccent = [fg, bg].sort((a, b) => contrast(b, accent) - contrast(a, accent))[0];
    const accentFg = legible(onAccent, [accent], 4.5, luminance(accent) > 0.179);

    const selected = light ? mix(bg, accent, 0.28) : over(accent, 0.22, paper);
    const selectedFg = legible(fg, [selected], 4.5, luminance(selected) > 0.179); // its own way: a strong accent can turn it
    const ok = legible(light ? '#3f6a2c' : '#9ccf80', grounds, 4.5, towardDark);

    return {
      chrome, base, paper, raised,
      fg, 'fg-2': fg2, 'fg-3': fg3,
      hover: rgba(fg, 0.06), pressed: rgba(fg, 0.1), selected, 'selected-fg': selectedFg, well: rgba(fg, light ? 0.05 : 0.06),
      // Lines are darker than the surfaces they sit on, never light (the user's rule); none round floating layers in dark.
      line: light ? rgba(fg, 0.1) : 'rgba(0, 0, 0, 0.42)',
      'line-2': light ? rgba(fg, 0.16) : 'rgba(0, 0, 0, 0.55)',
      field: light ? rgba(fg, 0.45) : 'rgba(0, 0, 0, 0.6)',
      'field-bg': light ? raised : mix(bg, '#000000', 0.35),
      'float-line': light ? rgba(fg, 0.16) : 'transparent',
      'float-shadow': light ? '0 0 2px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.14)' : 'none', // not a colour: the lift under a floating layer, light only
      'scroll-thumb': rgba(fg, light ? 0.2 : 0.16),
      accent, 'accent-fg': accentFg, 'accent-hover': mix(accent, '#ffffff', 0.12), 'accent-text': accentText, focus: accentText,
      danger: legible(light ? '#a8340c' : '#ff8a66', grounds, 4.5, towardDark),
      ok,
      'document-bg': light ? mix(bg, fg, 0.1) : mix(bg, '#000000', 0.45),
      'syn-keyword': accentText,
      'syn-string': legible(light ? '#8a5200' : '#e8b860', grounds, 4.5, towardDark),
      'syn-atom': legible(light ? '#3f6a2c' : '#9ccf80', grounds, 4.5, towardDark),
      'syn-comment': fg3,
      'syn-punct': fg2,
      cream: paper, peach: selected, tangerine: accent, ember: accentText, leaf: ok, ink: fg,
    };
  }

  // ---- settings -----------------------------------------------------------------------------------------

  const cleanSeed = (s) => (s && typeof s === 'object' && isHex(s.background) && isHex(s.text) && isHex(s.accent)
    ? { background: s.background.toLowerCase(), text: s.text.toLowerCase(), accent: s.accent.toLowerCase() } : null);

  // customColors: { light?: seed, dark?: seed }, or null when neither mode has a whole seed.
  function cleanCustom(input) {
    if (!input || typeof input !== 'object') return null;
    const out = {};
    for (const mode of ['light', 'dark']) { const s = cleanSeed(input[mode]); if (s) out[mode] = s; }
    return Object.keys(out).length ? out : null;
  }

  // The scheme setting, made valid: a known scheme, or "custom" while there are custom colours.
  function cleanSchemeId(id, customColors) {
    if (id === CUSTOM) return customColors ? CUSTOM : BUILT_IN;
    return Object.prototype.hasOwnProperty.call(SCHEMES, id) ? id : BUILT_IN;
  }

  // The seed in use for a mode, or null for the built-in scheme (and for a mode a scheme has no colours for).
  function seedFor(settings, mode) {
    const id = settings && settings.colorScheme;
    if (id === CUSTOM) return (settings.customColors && settings.customColors[mode]) || null;
    const scheme = SCHEMES[id];
    return scheme && !scheme.builtIn ? scheme[mode] || null : null;
  }

  // The tokens to set on the page for these settings in this mode, or null: the stylesheet's own colours.
  function resolve(settings, mode) {
    const seed = seedFor(settings, mode);
    return seed ? derive(seed) : null;
  }

  // The window's colours before the page paints (and for the caption buttons), in this mode.
  function windowColors(settings, mode) {
    const tokens = resolve(settings, mode);
    return tokens ? { background: tokens.paper, foreground: tokens.fg } : BUILT_IN_WINDOW[mode === 'dark' ? 'dark' : 'light'];
  }

  // The seeds a scheme starts from in a mode: the built-in scheme's own colours, a premade scheme's seed, or the
  // custom colours (falling back to the built-in ones while none are picked for that mode).
  function seedsOf(id, customColors, mode) {
    const m = mode === 'dark' ? 'dark' : 'light';
    if (id === CUSTOM) return (customColors && customColors[m]) || BUILT_IN_SEEDS[m];
    const scheme = SCHEMES[id];
    return scheme && !scheme.builtIn ? scheme[m] : BUILT_IN_SEEDS[m];
  }

  // What a scheme looks like in a mode, for its swatch in Settings: { paper, text, accent }, the derived colours
  // (so the sample matches the page), or the built-in scheme's own.
  function swatch(id, customColors, mode) {
    const seed = seedsOf(id, customColors, mode);
    if (id === BUILT_IN || (id !== CUSTOM && !(SCHEMES[id] && !SCHEMES[id].builtIn))) return { paper: seed.background, text: seed.text, accent: seed.accent };
    const t = derive(seed);
    return { paper: t.paper, text: t.fg, accent: t.accent };
  }

  return { BUILT_IN, CUSTOM, SCHEMES, TOKENS, BUILT_IN_SEEDS, derive, resolve, windowColors, seedsOf, swatch, cleanCustom, cleanSchemeId, contrast, isHex };
});
