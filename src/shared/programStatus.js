/**
 * programStatus — what Claude Code says about itself in the terminal stream
 * (lead-agent spec, T02; plan D7 / D14).
 *
 * Claude Code ≥ 2.1.295 speaks the OSC 7501 "Program Status" protocol. It is
 * not formally documented; this is what 2.1.331 does (verified live and in
 * the CLI's code, PROJECT_NOTES 2026-11-25):
 *
 *   probe   CLI → terminal   ESC ] 7501 ; ?  BEL
 *   answer  terminal → CLI   an OSC 7501 whose data starts with "?"  (we send ESC ] 7501 ; ? BEL)
 *   report  CLI → terminal   ESC ] 7501 ; state=<s>:app=claude-code[:id=…][:kind=…][:progress=n][:title=b64][:msg=b64]  BEL|ST
 *
 *   states: working · blocked (kind permission | question | auth) · done · idle · error · clear
 *   A report with `id` describes a subtask, not the session — ignored here.
 *
 * The same pass watches DEC private mode 2004 (bracketed paste), which
 * Claude Code turns on: text sent to a terminal in that mode is wrapped so an
 * embedded newline cannot submit early.
 *
 * Pure apart from Buffer (base64): one scanner per terminal, fed every output
 * chunk. Sequences split across chunks are carried to the next feed. The
 * scanner only observes — the caller passes the stream on unchanged.
 */

const PROBE_ANSWER = '\x1b]7501;?\x07';

const OSC_7501 = /\x1b\]7501;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const DEC_PRIVATE = /\x1b\[\?([0-9;]+)([hl])/g;

// The longest tail we hold back waiting for a terminator. A real report is
// well under this; anything longer is not one of ours and is let go.
const MAX_CARRY = 4096;

const PREFIXES = ['\x1b]7501;', '\x1b[?'];

function decodeB64(v) {
  try {
    return Buffer.from(v, 'base64').toString('utf8');
  } catch (_) {
    return null;
  }
}

/** `state=working:app=claude-code:msg=…` → `{ state, app, kind?, id?, progress?, title?, msg? }`. */
function parseReport(data) {
  const out = {};
  for (const part of String(data).split(':')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    const val = part.slice(eq + 1);
    if (key === 'title' || key === 'msg') out[key] = decodeB64(val);
    else if (key === 'progress') {
      const n = Number(val);
      if (Number.isFinite(n)) out.progress = n;
    } else out[key] = val;
  }
  return out.state ? out : null;
}

/**
 * Where an unfinished sequence of interest starts at the end of `s`, or -1.
 * Only our two prefixes (or a prefix of them) are held back; any other
 * escape at the tail is none of our business.
 */
function carryStart(s) {
  const esc = s.lastIndexOf('\x1b');
  if (esc < 0 || s.length - esc > MAX_CARRY) return -1;
  const tail = s.slice(esc);
  for (const p of PREFIXES) {
    if (tail.length < p.length ? p.startsWith(tail) : tail.startsWith(p)) {
      // Complete already? Then nothing to carry.
      if (p === PREFIXES[0] && /[\x07]|\x1b\\/.test(tail.slice(1))) return -1;
      if (p === PREFIXES[1] && /^\x1b\[\?[0-9;]*[a-zA-Z]/.test(tail)) return -1;
      return esc;
    }
  }
  return -1;
}

function createScanner() {
  let carry = '';
  return {
    /**
     * Scan one output chunk.
     * @returns {{ probes: number, reports: object[], pasteMode: boolean|undefined }}
     *   probes    — how many `ESC]7501;?` probes arrived (answer each with PROBE_ANSWER)
     *   reports   — main-session status reports, in order (subtask reports dropped)
     *   pasteMode — the last bracketed-paste change in this chunk, or undefined
     */
    feed(chunk) {
      const result = { probes: 0, reports: [], pasteMode: undefined };
      if (typeof chunk !== 'string' || (!chunk && !carry)) return result;
      let s = carry + chunk;
      carry = '';
      const cut = carryStart(s);
      if (cut >= 0) {
        carry = s.slice(cut);
        s = s.slice(0, cut);
      }
      if (s.indexOf('\x1b') < 0) return result;

      OSC_7501.lastIndex = 0;
      let m;
      while ((m = OSC_7501.exec(s))) {
        const data = m[1];
        if (data.startsWith('?')) {
          result.probes += 1;
          continue;
        }
        const report = parseReport(data);
        if (report && report.id === undefined) result.reports.push(report);
      }
      DEC_PRIVATE.lastIndex = 0;
      while ((m = DEC_PRIVATE.exec(s))) {
        if (m[1].split(';').includes('2004')) result.pasteMode = m[2] === 'h';
      }
      return result;
    },
    /** The bytes held back for the next chunk (tests). */
    get pending() {
      return carry;
    },
    reset() {
      carry = '';
    }
  };
}

/** Text wrapped as one bracketed paste (D14). */
function bracketedPaste(text) {
  return `\x1b[200~${String(text).replace(/\x1b\[20[01]~/g, '')}\x1b[201~`;
}

module.exports = { PROBE_ANSWER, createScanner, parseReport, bracketedPaste, MAX_CARRY };
