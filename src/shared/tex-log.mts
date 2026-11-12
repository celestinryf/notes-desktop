type TexIssueKind = TexIssue['kind'];

const WRAP_WIDTHS = [79, 255];
const FILE_LINE_ERROR = /^((?:[A-Za-z]:)?[^:\n]*?\.(?:tex|sty|cls|ltx|bib|bbl|dtx|ins|def|cfg|fd|clo)):(\d+): (.*)$/;
const CONTEXT_LINE = /^l\.(\d+) ?(.*)$/;
const WARNING = /^((?:La|pdf|Xe|Lua)?TeX|LaTeX(?: Font)?|Package [\w.-]+|Class [\w.-]+|Module [\w.-]+) Warning: (.*)$/;
const BAD_BOX = /^(Over|Under)full \\[hv]box \(([^)]*)\)(.*)$/;
const INPUT_LINE = /on input line (\d+)\.?/;
const LINES_RANGE = /at lines? (\d+)(?:--(\d+))?/;
const RERUN = /Rerun to get|Rerun LaTeX|Please rerun LaTeX|Label\(s\) may have changed|There were undefined references|Please \(re\)run Biber/;

export function unwrapLog(log: string | null | undefined) {
  const lines = String(log || '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let carry = '';
  for (const line of lines) {
    const joined = carry + line;
    if (WRAP_WIDTHS.includes(line.length) && !/^l\.\d+/.test(line)) { carry = joined; continue; }
    out.push(joined);
    carry = '';
  }
  if (carry) out.push(carry);
  return out;
}

function fileStack() {
  const stack: string[] = [];
  return {
    current: () => (stack.length ? stack[stack.length - 1] : null),
    read(line: string) {
      const re = /\((\.{0,2}[/\\]?[^\s()"]+\.(?:tex|sty|cls|ltx|bbl|aux|toc|out|def|cfg|fd|clo|lof|lot|ind|nav|snm|vrb))|\(|\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (m[0] === ')') stack.pop();
        else if (m[0] === '(') stack.push('');
        else stack.push(m[1]);
      }
    },
  };
}

const cleanFile = (file: string | null) => {
  if (!file) return null;
  const f = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return f || null;
};

export function parseTexLog(log: string | null | undefined): TexLog {
  const lines = unwrapLog(log);
  const files = fileStack();
  const issues: TexIssue[] = [];
  let fatal = false;
  let rerun = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (RERUN.test(line)) rerun = true;
    if (/==> Fatal error occurred/.test(line)) { fatal = true; continue; }
    const fileLine = FILE_LINE_ERROR.exec(line);
    if (line.startsWith('! ') || (fileLine && !/^\s/.test(line))) {
      const message = fileLine ? fileLine[3] : line.slice(2);
      let file = fileLine ? fileLine[1] : files.current();
      let at = fileLine ? Number(fileLine[2]) : null;
      const detail: string[] = [];
      let j = i + 1;
      for (; j < lines.length && j < i + 12; j++) {
        const next = lines[j];
        const context = CONTEXT_LINE.exec(next);
        if (context) {
          if (at === null) at = Number(context[1]);
          detail.push(next);
          if (j + 1 < lines.length && lines[j + 1].trim()) detail.push(lines[j + 1]);
          j += 1;
          break;
        }
        if (next.startsWith('! ') || FILE_LINE_ERROR.test(next)) { j -= 1; break; }
        if (next.trim()) detail.push(next);
      }
      if (/^Emergency stop\.?$/.test(message)) fatal = true;
      if (/^Emergency stop\.?$/.test(message) && issues.some((x) => x.kind === 'error')) { i = j; continue; }
      issues.push({ kind: 'error', file: cleanFile(file), line: at, message: message.trim(), detail: detail.join('\n') });
      i = j;
      continue;
    }
    const warning = WARNING.exec(line);
    if (warning) {
      let message = warning[2];
      const prefix = /^Package ([\w.-]+)/.exec(warning[1]);
      const cont = prefix ? '(' + prefix[1] + ')' : null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (cont && next.startsWith(cont)) { message += ' ' + next.slice(cont.length).trim(); continue; }
        if (!cont && next.trim() && /^\s{2,}\S/.test(next) && !INPUT_LINE.test(message)) { message += ' ' + next.trim(); continue; }
        break;
      }
      const at = INPUT_LINE.exec(message);
      issues.push({ kind: 'warning', file: cleanFile(files.current()), line: at ? Number(at[1]) : null, message: message.replace(/\s+/g, ' ').trim(), detail: warning[1] });
      i = j - 1;
      continue;
    }
    const box = BAD_BOX.exec(line);
    if (box) {
      const at = LINES_RANGE.exec(box[3]);
      issues.push({ kind: 'badbox', file: cleanFile(files.current()), line: at ? Number(at[1]) : null, message: (box[1] + 'full \\' + (line.includes('\\vbox') ? 'vbox' : 'hbox') + ' (' + box[2] + ')' + box[3]).trim(), detail: '' });
      continue;
    }
    files.read(line);
  }
  const count = (k: TexIssueKind) => issues.filter((x) => x.kind === k).length;
  return { issues, errors: count('error'), warnings: count('warning'), badBoxes: count('badbox'), rerun, fatal };
}
