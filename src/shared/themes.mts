const BUILT_IN = 'notes';
const CUSTOM = 'custom';

type Mode = Exclude<Theme, 'system'>;
type Rgb = number[];
type Scheme = { name: string, builtIn: true } | { name: string, builtIn?: false, light: ColorSeed, dark: ColorSeed };
type SeedInput = Partial<Record<keyof ColorSeed, unknown>> | null | undefined;

const SCHEMES: Record<string, Scheme> = {
  notes: { name: 'Notes', builtIn: true },
  paper: { name: 'Paper', light: { background: '#fafafa', text: '#1f1f1f', accent: '#3c6fd1' }, dark: { background: '#1c1c1e', text: '#ebebeb', accent: '#7aa2f7' } },
  slate: { name: 'Slate', light: { background: '#f3f5f8', text: '#1d2430', accent: '#2f6fd6' }, dark: { background: '#1b2028', text: '#e3e8ef', accent: '#8ab4f8' } },
  forest: { name: 'Forest', light: { background: '#f3f6ee', text: '#1f2a1a', accent: '#3f7a3a' }, dark: { background: '#1a2219', text: '#e3ebdc', accent: '#8cc46e' } },
  ocean: { name: 'Ocean', light: { background: '#eef5f8', text: '#14262e', accent: '#1c7a9c' }, dark: { background: '#15222a', text: '#dde9ef', accent: '#5fc0dc' } },
  rose: { name: 'Rose', light: { background: '#fbf3f4', text: '#2c1a1f', accent: '#c2375a' }, dark: { background: '#241a1e', text: '#f3e6ea', accent: '#e8809a' } },
  sepia: { name: 'Sepia', light: { background: '#f4ecd8', text: '#3b2f1e', accent: '#8a5a2b' }, dark: { background: '#2a2318', text: '#ead9bd', accent: '#d19a5a' } },
};
const BUILT_IN_SEEDS: Record<Mode, ColorSeed> = { light: { background: '#fffaf3', text: '#2a1a12', accent: '#f47b3e' }, dark: { background: '#211710', text: '#f6eadb', accent: '#f47b3e' } };

const TOKENS = [
  'chrome', 'base', 'paper', 'raised',
  'fg', 'fg-2', 'fg-3',
  'hover', 'pressed', 'selected', 'selected-fg', 'well',
  'line', 'line-2', 'field', 'field-bg', 'float-line', 'float-shadow', 'scroll-thumb',
  'accent', 'accent-fg', 'accent-hover', 'accent-text', 'focus',
  'danger', 'ok', 'document-bg',
  'syn-keyword', 'syn-string', 'syn-atom', 'syn-comment', 'syn-punct',
  'cream', 'peach', 'tangerine', 'ember', 'leaf', 'ink',
] as const;
type TokenName = (typeof TOKENS)[number];

const BUILT_IN_WINDOW: Record<Mode, { background: string, foreground: string }> = { light: { background: '#fffaf3', foreground: '#2a1a12' }, dark: { background: '#211710', foreground: '#f6eadb' } };

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);
const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => { const x = parse(a), y = parse(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgba = (hex: string, alpha: number) => 'rgba(' + parse(hex).join(', ') + ', ' + alpha + ')';
const over = (hex: string, alpha: number, bg: string) => mix(bg, hex, alpha);
function luminance(hex: string) {
  const [r, g, b] = parse(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const worstContrast = (color: string, surfaces: string[]) => Math.min(...surfaces.map((s) => contrast(color, s)));
function legible(color: string, surfaces: string[], min: number, towardDark: boolean) {
  const end = towardDark ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const c = mix(color, end, Math.min(1, t));
    if (worstContrast(c, surfaces) >= min) return c;
  }
  return end;
}

function readableBackground(bg: string) {
  const light = luminance(bg) > 0.179;
  const end = light ? '#ffffff' : '#000000', ink = light ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1.0001; t += 0.02) { const c = mix(bg, end, Math.min(1, t)); if (contrast(c, ink) >= 8) return c; }
  return end;
}

function derive(seed: ColorSeed): Record<TokenName, string> {
  const bg = readableBackground(seed.background), light = luminance(bg) > 0.179;
  const towardDark = light;
  const paper = bg;
  const base = light ? mix(bg, seed.text, 0.04) : mix(bg, '#000000', 0.22);
  const chrome = light ? mix(bg, seed.text, 0.07) : mix(bg, '#000000', 0.36);
  const raised = light ? mix(bg, '#ffffff', 0.5) : mix(bg, seed.text, 0.1);
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
  const ok = legible(light ? '#3f6a2c' : '#9ccf80', grounds, 4.5, towardDark);

  return {
    chrome, base, paper, raised,
    fg, 'fg-2': fg2, 'fg-3': fg3,
    hover: rgba(fg, 0.06), pressed: rgba(fg, 0.1), selected, 'selected-fg': selectedFg, well: rgba(fg, light ? 0.05 : 0.06),
    line: light ? rgba(fg, 0.1) : 'rgba(0, 0, 0, 0.42)',
    'line-2': light ? rgba(fg, 0.16) : 'rgba(0, 0, 0, 0.55)',
    field: light ? rgba(fg, 0.45) : 'rgba(0, 0, 0, 0.6)',
    'field-bg': light ? raised : mix(bg, '#000000', 0.35),
    'float-line': light ? rgba(fg, 0.16) : 'transparent',
    'float-shadow': light ? '0 0 2px rgba(0, 0, 0, 0.12), 0 4px 8px rgba(0, 0, 0, 0.14)' : 'none',
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

const cleanSeed = (s: SeedInput) => (s && typeof s === 'object' && isHex(s.background) && isHex(s.text) && isHex(s.accent)
  ? { background: s.background.toLowerCase(), text: s.text.toLowerCase(), accent: s.accent.toLowerCase() } : null);

function cleanCustom(input: { light?: SeedInput, dark?: SeedInput } | null | undefined) {
  if (!input || typeof input !== 'object') return null;
  const out: CustomColors = {};
  for (const mode of ['light', 'dark'] as const) { const s = cleanSeed(input[mode]); if (s) out[mode] = s; }
  return Object.keys(out).length ? out : null;
}

function cleanSchemeId(id: string, customColors: CustomColors | null | undefined) {
  if (id === CUSTOM) return customColors ? CUSTOM : BUILT_IN;
  return Object.prototype.hasOwnProperty.call(SCHEMES, id) ? id : BUILT_IN;
}

function seedFor(settings: Settings | null, mode: Mode) {
  if (!settings) return null;
  const id = settings.colorScheme;
  if (id === CUSTOM) return (settings.customColors && settings.customColors[mode]) || null;
  const scheme = SCHEMES[id];
  return scheme && !scheme.builtIn ? scheme[mode] || null : null;
}

function resolve(settings: Settings | null, mode: Mode) {
  const seed = seedFor(settings, mode);
  return seed ? derive(seed) : null;
}

function windowColors(settings: Settings, mode: Mode) {
  const tokens = resolve(settings, mode);
  return tokens ? { background: tokens.paper, foreground: tokens.fg } : BUILT_IN_WINDOW[mode === 'dark' ? 'dark' : 'light'];
}

function seedsOf(id: string, customColors: CustomColors | null | undefined, mode: string) {
  const m = mode === 'dark' ? 'dark' : 'light';
  if (id === CUSTOM) return (customColors && customColors[m]) || BUILT_IN_SEEDS[m];
  const scheme = SCHEMES[id];
  return scheme && !scheme.builtIn ? scheme[m] : BUILT_IN_SEEDS[m];
}

function swatch(id: string, customColors: CustomColors | null | undefined, mode: string) {
  const seed = seedsOf(id, customColors, mode);
  if (id === BUILT_IN || (id !== CUSTOM && !(SCHEMES[id] && !SCHEMES[id].builtIn))) return { paper: seed.background, text: seed.text, accent: seed.accent };
  const t = derive(seed);
  return { paper: t.paper, text: t.fg, accent: t.accent };
}

export { BUILT_IN, CUSTOM, SCHEMES, TOKENS, BUILT_IN_SEEDS, derive, resolve, windowColors, seedsOf, swatch, cleanCustom, cleanSchemeId, contrast, isHex };
