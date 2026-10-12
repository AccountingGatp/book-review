// Books Review engine - faithful JS port of review_books.py (no imports, runs in Node 22 and in Web Workers).
// All inputs are already-read row arrays (see xlsx_io.js). All dates are JS Date objects at UTC midnight.

export const SEV_RANK = { High: 3, Medium: 2, Low: 1, Info: 0 };
export const RANK_SEV = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Info' };

const VENDOR_TYPES = new Set(['Check', 'Credit Card Charge', 'Bill', 'Credit', 'Credit Card Credit', 'Item Receipt', 'Bill Pmt -Check']);
const CUSTOMER_TYPES = new Set(['Invoice', 'Payment', 'Credit Memo']);
const MULTILINE_TYPES = new Set(['Invoice', 'General Journal', 'Credit Memo', 'Bill', 'Payment', 'Credit', 'Item Receipt']);
const VENDOR_OR_DEPOSIT = new Set([...VENDOR_TYPES, 'Deposit']);
const STOP = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'the', 'and', 'of', 'company', 'limited', 'usa', 'com', 'www',
  'group', 'services', 'service', 'store', 'enterprises', 'pos', 'sig', 'visa', 'purchase']);
const NAME_STOP = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'limited', 'the']);

// ------------------------------------------------------------------ python-compat helpers
class PyError extends Error {
  constructor(name, msg) { super(msg); this.pyName = name; }
}

/** find_files: given file names, return {role: name} using the same first-match-per-file logic */
export function findFiles(names, patterns) {
  const found = {};
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const f of sorted) {
    const b = f.toLowerCase().replace(/[_\-.]+/g, ' ');
    if (b.startsWith('~$')) continue;
    if (!/\.xls/.test(f.toLowerCase())) continue;
    for (const [k, ps] of Object.entries(patterns || {})) {
      if (!(k in found) && new RegExp(ps).test(b)) { found[k] = f; break; }
    }
  }
  return found;
}

/** Python regex -> JS RegExp (handles leading (?i), (?P<name>), \Z, \A) */
export function pyRegex(pattern, flags = '') {
  let p = pattern;
  let fl = flags;
  const m = /^\(\?([aiLmsux]+)\)/.exec(p);
  if (m) {
    p = p.slice(m[0].length);
    if (m[1].includes('i') && !fl.includes('i')) fl += 'i';
    if (m[1].includes('m') && !fl.includes('m')) fl += 'm';
    if (m[1].includes('s') && !fl.includes('s')) fl += 's';
  }
  p = p.replace(/\(\?P</g, '(?<').replace(/\(\?P=(\w+)\)/g, '\\k<$1>').replace(/\\Z/g, '$').replace(/\\A/g, '^');
  return new RegExp(p, fl);
}

const PYWS = '[\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const PYWS_RE = new RegExp('^' + PYWS + '+|' + PYWS + '+$', 'g');
const pyStrip = s => s.replace(PYWS_RE, '');

export function nz(s) {
  if (s === null || s === undefined) return '';
  if (typeof s === 'number') return Number.isNaN(s) ? '' : String(s);
  if (s instanceof Date) return isoDate(s) + ' 00:00:00';
  return String(s);
}
const pyS = x => (x === null || x === undefined ? 'None' : (x instanceof Date ? isoDate(x) : String(x)));

export function isoDate(d) { return d.toISOString().slice(0, 10); }
const pad2 = n => String(n).padStart(2, '0');
export function ymKey(d) { return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
const DAY = 86400000;
const dayDiff = (a, b) => Math.floor((a.getTime() - b.getTime()) / DAY); // (a - b).days
function mkDate(y, m, d) {
  if (!(y >= 1677 && y <= 2262)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** Python-exact fixed formatting (round half even on the exact binary value) */
export function fmtFixed(x, d) {
  if (x === null || x === undefined) return 'None';
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const neg = x < 0 || Object.is(x, -0);
  const ax = Math.abs(x);
  let out;
  if (ax >= 1e21) { out = BigInt(ax).toString() + (d > 0 ? '.' + '0'.repeat(d) : ''); return (neg ? '-' : '') + out; }
  const s = ax.toFixed(Math.min(100, d + 45));
  const dot = s.indexOf('.');
  const frac = s.slice(dot + 1);
  if (frac[d] === '5' && /^0*$/.test(frac.slice(d + 1))) {
    const trunc = d > 0 ? s.slice(0, dot + 1 + d) : s.slice(0, dot);
    const last = trunc[trunc.length - 1];
    if ((last.charCodeAt(0) - 48) % 2 === 0) out = trunc; else out = ax.toFixed(d);
  } else out = ax.toFixed(d);
  return (neg ? '-' : '') + out;
}
export function fmtComma(x, d) {
  const s = fmtFixed(x, d);
  if (!/^-?\d/.test(s)) return s;
  const neg = s[0] === '-';
  const body = neg ? s.slice(1) : s;
  const [i, f] = body.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + ii + (f !== undefined ? '.' + f : '');
}
const pct0 = x => fmtFixed(x * 100, 0) + '%';
/** Python builtin round(x, d) on a float */
export function pyRound(x, d = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return x;
  const r = Number(fmtFixed(x, d));
  return r;
}
function rint(x) { // half-even
  const f = Math.floor(x); const diff = x - f;
  if (diff < 0.5) return f; if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
/** numpy np.round(x, d) */
export function npRound(x, d = 2) {
  if (x === null || x === undefined || !Number.isFinite(x)) return x;
  const p = 10 ** d;
  return rint(x * p) / p;
}
/** numpy pairwise float sum */
function pairwise(a, lo, n) {
  if (n < 8) { let res = 0; for (let i = 0; i < n; i++) res += a[lo + i]; return res; }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i;
    for (i = 8; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2); n2 -= n2 % 8;
  return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
}
export function npSum(arr) { // NaN/null treated as 0 like pandas skipna
  const a = arr.map(v => (v === null || v === undefined || Number.isNaN(v) ? 0 : v));
  return pairwise(a, 0, a.length);
}
function kahanSum(arr) { // pandas groupby-sum
  let s = 0, c = 0;
  for (const v of arr) { if (v === null || v === undefined || Number.isNaN(v)) continue; const y = v - c; const t = s + y; c = t - s - y; s = t; }
  return s;
}
function median(arr) {
  const a = [...arr].sort((x, y) => x - y); const n = a.length;
  if (n === 0) return NaN;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
/** Python str.title() */
export function pyTitle(s) {
  let out = ''; let prevCased = false;
  for (const ch of s) {
    const cased = ch.toLowerCase() !== ch.toUpperCase();
    if (cased) { out += prevCased ? ch.toLowerCase() : ch.toUpperCase(); prevCased = true; }
    else { out += ch; prevCased = false; }
  }
  return out;
}
function pyReprStr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let o = s.replace(/\\/g, '\\\\');
  if (q === "'") o = o.replace(/'/g, "\\'");
  o = o.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return q + o + q;
}
function pyReprNum(x) { return Number.isInteger(x) ? x.toFixed(1) : String(x); }

const cmpv = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** python-style value_counts: sorted by count desc, ties by first appearance */
function valueCounts(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  const arr = [...m.entries()];
  const idx = new Map(arr.map((e, i) => [e[0], i]));
  arr.sort((a, b) => (b[1] - a[1]) || (idx.get(a[0]) - idx.get(b[0])));
  return arr; // [[key,count],...]
}
class Dist {
  constructor(vc, n) { this.items = vc; this.n = n; this.map = new Map(vc); }
  get(k) { return this.map.get(k) || 0; }
}
/** pandas groupby(key) -> sorted [[key, rows]] (null keys dropped) */
function groupSorted(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(r);
  }
  return [...m.entries()].sort((a, b) => cmpv(a[0], b[0]));
}
function groupKeyed(rows, keyFn, cmp) { // key may be tuple-string; cmp compares representative key tuples
  const m = new Map();
  for (const r of rows) {
    const [id, tup] = keyFn(r);
    let e = m.get(id); if (!e) { e = { tup, rows: [] }; m.set(id, e); } e.rows.push(r);
  }
  return [...m.values()].sort((a, b) => cmp(a.tup, b.tup));
}
const cmpNullLast = (a, b) => {
  const an = a === null || a === undefined, bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
};
const cmpTuple = (a, b) => { for (let i = 0; i < a.length; i++) { const c = cmpNullLast(a[i], b[i]); if (c) return c; } return 0; };

// ------------------------------------------------------------------ difflib.SequenceMatcher.ratio
export function seqRatio(a, b) {
  const A = Array.from(a), B = Array.from(b);
  const la = A.length, lb = B.length;
  if (la + lb === 0) return 1.0;
  const b2j = new Map();
  for (let i = 0; i < lb; i++) { let l = b2j.get(B[i]); if (!l) { l = []; b2j.set(B[i], l); } l.push(i); }
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [e, idx] of [...b2j.entries()]) if (idx.length > ntest) b2j.delete(e);
  }
  const findLongest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const nj = new Map();
      const lst = b2j.get(A[i]);
      if (lst) {
        for (const j of lst) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          nj.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
      }
      j2len = nj;
    }
    while (besti > alo && bestj > blo && A[besti - 1] === B[bestj - 1]) { besti--; bestj--; bestsize++; }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && A[besti + bestsize] === B[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = findLongest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2.0 * matches) / (la + lb);
}

// ------------------------------------------------------------------ parsing
function normKey(pathList) {
  let parts = pathList.map(p => pyStrip(p));
  if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === parts[parts.length - 2].toLowerCase() + ' - other') parts = parts.slice(0, -1);
  return parts.join(' > ');
}
const isNum = v => typeof v === 'number';
function toFloat(v) {
  if (v === null || v === undefined || v === 0 || v === '' || v === false) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim().replace(/_/g, '');
    if (t === '' || !/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf(inity)?|nan)$/i.test(t)) throw new PyError('ValueError', `could not convert string to float: ${pyReprStr(v)}`);
    return Number(t.replace(/^([+-]?)inf(inity)?$/i, '$1Infinity').replace(/^[+-]?nan$/i, 'NaN'));
  }
  throw new PyError('TypeError', "float() argument must be a string or a real number");
}

export function parseDetail(rows, label) {
  let hdr = null, cols = {};
  const NAMES = ['Type', 'Date', 'Num', 'Name', 'Memo', 'Class', 'Clr', 'Split', 'Amount', 'Balance'];
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const s = rows[i].map(c => (c !== null && c !== undefined ? pyStrip(nz(c)) : ''));
    if (s.includes('Type') && s.includes('Date') && s.includes('Amount')) {
      hdr = i; cols = {};
      for (const n of NAMES) if (s.includes(n)) cols[n] = s.indexOf(n);
      break;
    }
  }
  if (hdr === null) throw new PyError('ValueError', `${label}: could not find the header row (Type/Date/Amount)`);
  const tcol = cols.Type;
  const lines = []; const meta = new Map();
  let cur = []; // sorted [[level,label]]
  const setMeta = (key, k, v) => { let m = meta.get(key); if (!m) { m = {}; meta.set(key, m); } m[k] = v; };
  const hasBal = 'Balance' in cols;
  for (let ri = hdr + 1; ri < rows.length; ri++) {
    const ridx = ri + 1; // python: enumerate(rows[hdr+1:], start=hdr+2)
    const r = rows[ri];
    const get = i => (i < r.length ? r[i] : null);
    const t = get(tcol), d = get(cols.Date);
    if (t !== null && t !== undefined && d instanceof Date) {
      const levels = cur.filter(x => x[0] < tcol).map(x => x[1]);
      if (!levels.length) continue;
      const g = n => (n in cols ? get(cols[n]) : null);
      const account = normKey(levels);
      const sp = account.split(' > ');
      lines.push({
        src: label, src_row: ridx, type: pyStrip(nz(t)), date: d, num: g('Num'), name: g('Name'),
        memo: g('Memo'), cls: g('Class'), split: g('Split'), amount: toFloat(g('Amount')), balance: g('Balance'),
        path: levels, account, leaf: sp[sp.length - 1],
      });
    } else {
      for (let l = 0; l < tcol; l++) {
        const v = get(l);
        if (v === null || v === undefined) continue;
        const lab = pyStrip(nz(v));
        if (lab.startsWith('Total ')) {
          const key = normKey(cur.filter(x => x[0] <= l).map(x => x[1]));
          setMeta(key, 'total_amt', get(cols.Amount));
          setMeta(key, 'total_bal', hasBal ? get(cols.Balance) : null);
          cur = cur.filter(x => x[0] < l);
        } else {
          cur = cur.filter(x => x[0] < l);
          cur.push([l, lab]);
          const key = normKey(cur.map(x => x[1]));
          if (hasBal && get(cols.Balance) !== null && get(cols.Balance) !== undefined && (get(cols.Amount) === null || get(cols.Amount) === undefined)) setMeta(key, 'open_bal', get(cols.Balance));
        }
        break;
      }
    }
  }
  return { lines, meta };
}

function firstLabel(r) {
  for (let i = 0; i < 2; i++) {
    const c = i < r.length ? r[i] : null;
    if (c !== null && c !== undefined && !isNum(c)) return pyStrip(nz(c));
  }
  return null;
}
export function parseTb(rows) {
  const out = new Map();
  for (const r0 of rows) {
    const r = [...r0, null, null, null, null, null, null];
    const lab = firstLabel(r);
    const nums = r.slice(2, 6).filter(isNum);
    if (lab && lab.toUpperCase() !== 'TOTAL' && nums.length) {
      const deb = isNum(r[2]) ? r[2] : 0;
      const cre = isNum(r[3]) ? r[3] : 0;
      out.set(lab.replace(/:/g, ' > '), deb - cre);
    } else if (lab && lab.toUpperCase() === 'TOTAL') {
      out.set('__TOTAL_DEBIT__', Number(r[2] || 0));
      out.set('__TOTAL_CREDIT__', Number(r[3] || 0));
    }
  }
  return out;
}
export function parseAging(rows) {
  const out = new Map();
  for (const r0 of rows) {
    const r = [...r0, null, null, null, null, null, null, null, null, null];
    const lab = firstLabel(r);
    if (lab && isNum(r[7])) {
      out.set(lab, { current: r[2] || 0, b1_30: r[3] || 0, b31_60: r[4] || 0, b61_90: r[5] || 0, over90: r[6] || 0, total: r[7] || 0 });
    }
  }
  return out;
}
export function accountTypeFromPath(e) {
  if (!e || !e.length) return null;
  if (e[0] === 'Ordinary Income/Expense') {
    if (e.length > 1 && e[1] === 'Income') return 'Income';
    if (e.length > 1 && e[1] === 'Cost of Goods Sold') return 'COGS';
    return 'Expense';
  }
  if (e[0] === 'Other Income/Expense') return e.length > 1 && e[1] === 'Other Income' ? 'OtherIncome' : 'OtherExpense';
  if (e[0] === 'ASSETS') {
    if (e.length > 2 && e[1] === 'Current Assets') return ({ 'Checking/Savings': 'Bank', 'Accounts Receivable': 'AR' })[e[2]] || 'OtherAsset';
    return 'FixedAsset';
  }
  if (e[0].startsWith('LIABILITIES')) {
    if (e.length > 3 && e[2] === 'Current Liabilities') return ({ 'Accounts Payable': 'AP', 'Credit Cards': 'CreditCard' })[e[3]] || 'Liability';
    if (e.length > 1 && e[1] === 'Equity') return 'Equity';
    return 'Liability';
  }
  return null;
}

// ------------------------------------------------------------------ helpers
export function normName(s) {
  let x = nz(s).toLowerCase();
  x = x.replace(/[^a-z0-9 ]+/g, ' ');
  return x.split(/\s+/).filter(t => t && !NAME_STOP.has(t)).join(' ');
}
export function tokens(s, minlen = 3) {
  const out = [];
  const m = nz(s).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const t of m) {
    if (STOP.has(t)) continue;
    if (t.length >= minlen || (/^\d+$/.test(t) && t.length >= 2)) out.push(t);
  }
  return out;
}
export function sevAdjust(base, amount, th) {
  let r = SEV_RANK[base];
  if (base === 'Info') return base;
  const a = Math.abs(amount);
  if (a >= th.high_amount) r = Math.min(3, r + 1);
  else if (a < th.tiny_amount) r = Math.max(1, r - 1);
  return RANK_SEV[r];
}
export function memoSignature(memo) {
  let m = nz(memo);
  if (m.includes(' - ')) m = m.split(' - ')[0];
  m = pyStrip(m).toLowerCase().replace(/\d+(\.\d+)?/g, '#');
  return Array.from(m).slice(0, 60).join('');
}
export function skuPrefix(memo) {
  const m = pyStrip(nz(memo));
  if (m.includes(' - ')) {
    const sku = m.split(' - ')[0];
    if (/^[A-Za-z0-9]+-/.test(sku)) return sku.split('-')[0].toUpperCase();
  }
  return null;
}
const REF_RE = /(?=[A-Z0-9*]*\d)(?=[A-Z0-9*]*[A-Z])[A-Z0-9*]{7,}/g;
const findRefs = s => (s ? (s.match(REF_RE) || []) : []);
const IGNORE_MEMO = /landed cost|vendor deposit|shipping - shipping fee|^FB:/i;

export function merchantGuess(memo) {
  let m = nz(memo);
  m = m.replace(/^\s*(purchase|pos sig|pos deb|checkcard|recurring)\s*\d{0,2}\/?\d{0,2}\s*/i, '');
  m = m.replace(/visa\s*#?\d+/gi, ' ');
  m = m.replace(/[*#]+/g, ' ');
  const words = (m.match(/[A-Za-z][A-Za-z'&.\-]+/g) || []).filter(w => w.length > 2);
  return words.length ? pyTitle(words.slice(0, 3).join(' ')) : '';
}
const namesSorted = x => {
  const keyed = x.map(s => [nz(s).toLowerCase(), s]);
  keyed.sort((a, b) => cmpv(a[0], b[0]));
  return keyed.map(k => k[1]);
};

// ------------------------------------------------------------------ payee list
function parseLooseDate(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v / 1e6); // pandas treats numbers as ns since epoch
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s);
  if (m) { let a = +m[1], b = +m[2]; if (a > 12 && b <= 12) [a, b] = [b, a]; return mkDate(+m[3], a, b); }
  m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) { const mo = MONTHS[m[1].toLowerCase()]; if (mo) return mkDate(+m[3], mo, +m[2]); }
  return null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function loadPayeeList(rows) {
  let hdr = null;
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const labs = rows[i].map(c => (c !== null && c !== undefined ? pyStrip(nz(c)).toLowerCase() : ''));
    const joined = labs.join(' ');
    if (labs.filter(x => x).length >= 2 && ['amount', 'payee', 'vendor', '1099', 'paid'].some(k => joined.includes(k))) { hdr = i; break; }
  }
  if (hdr === null) return [];
  const labs = rows[hdr].map(c => (c !== null && c !== undefined ? pyStrip(nz(c)).toLowerCase() : ''));
  const find = (...keys) => { for (let j = 0; j < labs.length; j++) if (keys.some(k => labs[j].includes(k))) return j; return null; };
  const cd = find('date'), ca = find('amount', 'withdraw', 'paid', 'total'), cp = find('payee', 'vendor', 'contractor', 'worker', 'name'), cf = find('1099');
  if (ca === null) return [];
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = [...rows[i], ...new Array(20).fill(null)];
    const raw = pyStrip(pyS(r[ca]).replace(/,/g, '').replace(/\$/g, ''));
    if (raw === '' || !/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf(inity)?|nan)$/i.test(raw.replace(/_/g, ''))) continue;
    const amt = Number(raw.replace(/_/g, '').replace(/^([+-]?)inf(inity)?$/i, '$1Infinity').replace(/^[+-]?nan$/i, 'NaN'));
    const d = cd !== null && r[cd] !== null && r[cd] !== undefined ? parseLooseDate(r[cd]) : null;
    out.push({ date: d, amount: pyRound(Math.abs(amt), 2), payee: cp !== null ? nz(r[cp]) : '', f1099: cf !== null ? nz(r[cf]) : '' });
  }
  return out;
}

// ------------------------------------------------------------------ engine
class Review {
  /** Everything business-specific comes from the rules object. These accessors never invent values. */
  get acct() { return this.rules.accounts || {}; }
  get pat() { return this.rules.patterns || {}; }
  rx(key, flags = 'i') { const p = this.pat[key]; return p ? pyRegex(p, flags) : null; }
  cashNames() { const r = (this.rules.keyword_rules || []).find(x => x.action === 'review'); return new Set((r && r.names) || []); }
  upworkRx() { const u = this.rules.upwork; return u && u.charge_memo_pattern ? pyRegex(u.charge_memo_pattern, 'i') : null; }

  constructor(rowsByRole, rules, payeeRows) {
    this.rowsByRole = rowsByRole; this.rules = rules; this.th = rules.thresholds;
    this.payeeRows = payeeRows || null;
    this.flags = []; this.recon = []; this.notes = []; this.run_log = [];
    this.hist_name_v = new Map(); this.hist_name_c = new Map(); this.hist_sig = new Map(); this.hist_pre_cust = new Map();
    this.inv_pre = [];
    this.name_master_rows = []; this.basis = new Map();
    this.rule_ok_ids = new Set(); this.rule_matched_ids = new Set(); this.approved_ok = new Set();
    this.alloc_rows = []; this.recharge_rows = []; this.cash_rows = []; this.checklist = [];
    this.related = new Set(); this.names = [];
    this.cust = new Set(); this.vend = new Set();
  }

  load() {
    const f = this.rowsByRole;
    for (const k of ['td', 'gl']) if (!f[k]) throw new PyError('SystemExit', `Missing required report: ${k}`);
    const tdp = parseDetail(f.td, 'Transaction Detail'); this.td = tdp.lines; this.td_meta = tdp.meta;
    const glp = parseDetail(f.gl, 'General Ledger'); this.gl = glp.lines; this.gl_meta = glp.meta;
    this.pl = this.bs = null; this.type_map = new Map();
    const addTypes = lines => {
      const seen = new Set();
      for (const l of lines) {
        const key = l.path.join('\u0001');
        if (seen.has(key)) continue; seen.add(key);
        const nk = normKey(l.path).split(' > ');
        this.type_map.set(nk[nk.length - 1], accountTypeFromPath(l.path));
      }
    };
    if (f.pl) { this.pl = parseDetail(f.pl, 'P&L Detail').lines; addTypes(this.pl); }
    if (f.bs) { this.bs = parseDetail(f.bs, 'Balance Sheet Detail').lines; addTypes(this.bs); }
    this.tb = f.tb ? parseTb(f.tb) : null;
    this.ar = f.ar ? parseAging(f.ar) : null;
    this.ap = f.ap ? parseAging(f.ap) : null;
    const FUND = new Set(['Bank', 'CreditCard', 'AR', 'AP']);
    this.td.forEach((l, i) => {
      for (const c of ['name', 'memo', 'num', 'cls', 'split']) { const v = pyStrip(nz(l[c])); l[c] = v || null; }
      let at = this.type_map.get(l.leaf);
      if (at === undefined || at === null) at = 'Other';
      l.acct_type = at;
      l.is_funding = FUND.has(at) || (!!this.acct.undeposited_funds && l.leaf === this.acct.undeposited_funds);
      l.id = i;
    });
    let lo = this.td[0].date, hi = this.td[0].date;
    for (const l of this.td) { if (l.date < lo) lo = l.date; if (l.date > hi) hi = l.date; }
    this.period = [lo, hi];
    this.target = this.td.filter(l => !l.is_funding);
  }

  flag(row, check, baseSev, issue, detail = '', o = {}) {
    const amt = o.amount === undefined || o.amount === null ? row.amount : o.amount;
    const adjust = o.adjust === undefined ? true : o.adjust;
    const sev = adjust ? sevAdjust(baseSev, amt, this.th) : baseSev;
    this.flags.push({
      line_id: row.id, severity: sev, check, issue, detail,
      date: row.date, type: row.type, num: row.num, name: row.name, memo: row.memo,
      account: row.account, cls: row.cls, split: row.split, amount: row.amount,
      suggested_account: o.sug_acct || '', suggested_name: o.sug_name || '', confidence: o.conf || '',
      source: `${row.src} r${row.src_row}`, rule_id: o.rule_id === undefined ? null : o.rule_id,
    });
  }
  flagAccountLevel(check, sev, issue, detail, o = {}) {
    this.flags.push({
      line_id: -1, severity: sev, check, issue, detail, date: null, type: o.type_label || '(account level)',
      num: null, name: o.name === undefined ? null : o.name, memo: null, account: null, cls: null, split: null,
      amount: o.amount === undefined ? null : o.amount, suggested_account: '', suggested_name: '', confidence: '',
      source: o.source || 'Chart of accounts', rule_id: o.rule_id === undefined ? null : o.rule_id,
    });
  }

  // ---------------------------------------------------------------- A
  checkCompleteness() {
    const th = this.th;
    const LOWLEAF = new Set(this.acct.low_value_accounts || []);
    for (const r of this.target) {
      if (r.type === 'General Journal') {
        if (!r.memo && Math.abs(r.amount) >= th.journal_no_memo_min) this.flag(r, 'A2 Missing memo', 'Medium', 'Manual journal with no description', 'Journals must explain themselves.');
        continue;
      }
      if (!r.name && (VENDOR_TYPES.has(r.type) || CUSTOMER_TYPES.has(r.type) || r.type === 'Deposit')) {
        const base = LOWLEAF.has(r.leaf) ? 'Low' : 'Medium';
        const sug = this.suggestNameFromMemo(r.memo);
        let sugName;
        if (sug) sugName = sug[0];
        else {
          const mg = (this.rx('bank_feed_memo') || /$^/).test(nz(r.memo)) ? merchantGuess(r.memo) : null;
          sugName = mg ? `(new?) ${mg}` : '';
        }
        this.flag(r, 'A1 Missing name', base, 'No vendor/customer name', 'Name is blank on a posted transaction.' + (sug ? ` Memo suggests: ${sug[0]}` : ''),
          { sug_name: sugName, conf: sug ? sug[1] : 'Low' });
      }
      if (!r.memo && VENDOR_OR_DEPOSIT.has(r.type) && Math.abs(r.amount) >= 100) this.flag(r, 'A2 Missing memo', 'Low', 'No memo/description', 'Blank memo on a transaction >= $100.');
    }
  }

  // ---------------------------------------------------------------- B
  static dist(rows, keyFn, valFn) {
    const out = new Map();
    for (const [k, g] of groupSorted(rows, keyFn)) out.set(k, new Dist(valueCounts(g.map(valFn)), g.length));
    return out;
  }
  buildHistory() {
    const t = this.target;
    const v = t.filter(r => VENDOR_OR_DEPOSIT.has(r.type));
    const c = t.filter(r => CUSTOMER_TYPES.has(r.type));
    const leaf = r => r.leaf;
    this.hist_name_v = Review.dist(v, r => r.name, leaf);
    this.hist_name_c = Review.dist(c, r => r.name, leaf);
    const sigOf = r => (typeof r.memo === 'string' && r.memo.includes(' - ') ? memoSignature(r.memo) : null);
    this.hist_sig = Review.dist(c, sigOf, leaf);
    const inv = t.filter(r => r.type === 'Invoice' || r.type === 'Credit Memo').map(r => ({ r, pre: skuPrefix(r.memo) }));
    this.inv_pre = inv.filter(x => x.pre !== null && x.r.name !== null).map(x => ({ ...x.r, pre: x.pre }));
    this.hist_pre_cust = Review.dist(this.inv_pre, r => r.pre, r => r.name);
  }

  checkHistory() {
    const th = this.th;
    const ph = new Set(this.rules.placeholder_names);
    for (const r of this.target) {
      if (r.type === 'General Journal') continue;
      const fam = VENDOR_OR_DEPOSIT.has(r.type) ? 'v' : 'c';
      if (this.rule_ok_ids.has(r.id)) continue;
      if (r.name && fam === 'v' && !ph.has(r.name)) {
        const h = this.hist_name_v.get(r.name);
        if (h && h.n >= th.history_min_txns) {
          const [top, topn] = h.items[0]; const n = h.n;
          const share = topn / n; const mine = h.get(r.leaf) / n;
          if (share >= th.history_dominance && r.leaf !== top && mine <= 0.15) {
            this.flag(r, 'B2 Differs from history', 'Medium', `"${r.name}" is normally posted to ${top}`,
              `${topn} of ${n} similar lines (${pct0(share)}) use "${top}"; this line uses "${r.leaf}" (${h.get(r.leaf)} of ${n}).`,
              { sug_acct: top, conf: `${pct0(share)} of ${n}` });
          }
        }
      }
      if (fam === 'c' && r.memo && r.memo.includes(' - ')) {
        const sig = memoSignature(r.memo);
        const h = this.hist_sig.get(sig);
        if (h && h.n >= th.history_min_txns_memo) {
          const [top, topn] = h.items[0]; const n = h.n;
          const share = topn / n; const mine = h.get(r.leaf) / n;
          if (share >= th.history_dominance && r.leaf !== top && mine <= 0.15) {
            this.flag(r, 'B2 Differs from history', 'Medium', `Item "${sig}" is normally posted to ${top}`,
              `${topn} of ${n} lines with this item description use "${top}"; this one uses "${r.leaf}".`, { sug_acct: top, conf: `${pct0(share)} of ${n}` });
          }
        }
      }
    }
  }

  checkKeywordRules() {
    const rules = this.rules.keyword_rules.map(ru => ({ ...ru, _re: pyRegex(ru.pattern, 'i') }));
    this.rule_hits = new Map();
    // A rule can only be judged against this company's books if at least one account it expects exists there.
    const known = new Set(); for (const l of this.td) { known.add(l.leaf); known.add(l.account); }
    this.rules_skipped = [];
    for (const ru of rules) {
      ru._skip = ru.action !== 'review' && !(ru.expected || []).some(a => known.has(a));
      if (ru._skip) this.rules_skipped.push({ rule: ru.id, note: ru.note || '', expected: (ru.expected || []).slice(0, 3).join(', ') });
    }
    for (const r of this.target) {
      const name = nz(r.name), memo = nz(r.memo);
      const matches = [];
      for (const ru of rules) {
        if (ru._skip) continue;
        if ('types' in ru && !ru.types.includes(r.type)) continue;
        if ((ru.types_exclude || []).includes(r.type)) continue;
        const text = ru.scope === 'name' ? name : ru.scope === 'memo' ? memo : `${name} | ${memo}`;
        if (!pyStrip(text) || !ru._re.test(text)) continue;
        matches.push(ru);
      }
      if (!matches.length) continue;
      this.rule_matched_ids.add(r.id);
      for (const ru of matches) {
        if (ru.action === 'review') {
          if (ru.review_account_types.includes(r.acct_type) && Math.abs(r.amount) >= ru.min_amount) {
            this.flag(r, 'E7 Needs support', ru.severity, 'Cash withdrawal expensed without identified payee', ru.note, { conf: 'Rule', rule_id: ru.id });
          }
          continue;
        }
        const exp = ru.expected;
        const ok = exp.includes(r.leaf) || exp.includes(r.account);
        if (!this.rule_hits.has(ru.id)) this.rule_hits.set(ru.id, []);
        this.rule_hits.get(ru.id).push({ r, ok });
        if (ok) { this.rule_ok_ids.add(r.id); continue; }
        const satisfiedOther = matches.some(m => m !== ru && m.action !== 'review' && (m.expected.includes(r.leaf) || m.expected.includes(r.account)));
        if (satisfiedOther) {
          const others = matches.filter(m => m !== ru && (m.expected || []).includes(r.leaf));
          if (!others.length) throw new PyError('IndexError', 'list index out of range');
          const other = others[0];
          this.flag(r, 'C3 Name vs memo conflict', 'Medium', `Name/memo point to different accounts ("${ru.id}" vs "${other.id}")`,
            `${ru.note} | but memo also matches: ${other.note} Confirm which is right and that the vendor is correct.`,
            { sug_acct: exp[0], conf: 'Rule conflict', rule_id: ru.id });
        } else {
          this.flag(r, 'B1 Account vs description', ru.severity, `Posted to "${r.leaf}" but description indicates: ${ru.note}`,
            `Expected one of: ${exp.slice(0, 4).join(', ')}${exp.length > 4 ? '...' : ''}`, { sug_acct: exp[0], conf: 'Rule', rule_id: ru.id });
        }
      }
    }
  }

  checkAccountHygiene() {
    const sus = new Set(this.rules.suspense_accounts);
    for (const r of this.target) {
      if (sus.has(r.leaf)) this.flag(r, 'B5 Catch-all account', 'Medium', `Posted to catch-all account "${r.leaf}"`,
        'Catch-all/clearing accounts should be empty at period end; reclassify to the real account.', { conf: 'Policy' });
    }
    for (const r of this.target) {
      if (r.type === 'Invoice' && ['Expense', 'COGS', 'OtherExpense'].includes(r.acct_type) && r.amount !== 0) {
        this.flag(r, 'B4 Type vs account', 'Low', `Invoice line posted to expense account "${r.leaf}"`,
          'Customer invoice lines hitting expense accounts act as contra-expense (cost recharge). Confirm it is an intentional pass-through and not sales.', { conf: 'Logic' });
      }
      if (['Bill', 'Check', 'Credit Card Charge'].includes(r.type) && r.acct_type === 'Income' && r.amount > 0) {
        this.flag(r, 'B4 Type vs account', 'High', `${r.type} posted to income account "${r.leaf}"`, 'Vendor-type transaction increasing income.', { conf: 'Logic' });
      }
    }
    for (const g of this.rules.similar_account_groups) {
      const used = [g.preferred, ...g.also].filter(a => this.target.some(r => r.leaf === a));
      if (used.length > 1) {
        this.flagAccountLevel('B6 Overlapping accounts', 'Low', `Multiple accounts used for the same purpose: ${used.join(', ')}`, g.note + ` Preferred: "${g.preferred}".`);
        const usage = {};
        for (const a of used) usage[a] = this.target.filter(r => r.leaf === a).length;
        let dominant = used[0];
        for (const a of used) if (usage[a] > usage[dominant]) dominant = a;
        for (const a of used) {
          if (a === dominant) continue;
          for (const r of this.target.filter(x => x.leaf === a)) {
            if (r.type === 'General Journal') continue;
            this.flag(r, 'B6 Overlapping accounts', 'Low', `Posted to "${a}"; most similar spend (${usage[dominant]} lines) is in "${dominant}"`, g.note,
              { sug_acct: dominant, conf: 'Consistency', adjust: false });
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- C
  buildNameIndex() {
    const seen = new Set(); const names = [];
    for (const l of this.td) if (l.name !== null && l.name !== undefined && !seen.has(l.name)) { seen.add(l.name); names.push(l.name); }
    this.names = names;
    const tokmap = new Map();
    for (const n of names) for (const tk of new Set(tokens(n))) { let s = tokmap.get(tk); if (!s) { s = new Set(); tokmap.set(tk, s); } s.add(n); }
    this.alias_full = new Map();
    for (const n of names) { const k = normName(n); if (k.length >= 4) this.alias_full.set(k, n); }
    this.alias_full_list = [...this.alias_full.entries()].map(([full, n]) => [full, n, full.length]);
    this.alias_tok = new Map();
    for (const [tk, v] of tokmap) if (v.size === 1 && tk.length >= 5) this.alias_tok.set(tk, [...v][0]);
    this.cust = new Set(this.td.filter(l => CUSTOMER_TYPES.has(l.type) && l.name !== null).map(l => l.name));
    this.vend = new Set(this.td.filter(l => VENDOR_TYPES.has(l.type) && l.name !== null).map(l => l.name));
  }

  suggestNameFromMemo(memo) {
    const m = normName(memo);
    if (!m) return null;
    let best = null;
    for (const [full, n, len] of this.alias_full_list) {
      let found = false; let from = 0;
      while (true) {
        const i = m.indexOf(full, from);
        if (i < 0) break;
        const e = i + full.length;
        if ((i === 0 || m[i - 1] === ' ') && (e === m.length || m[e] === ' ')) { found = true; break; }
        from = i + 1;
      }
      if (found && (best === null || len > best[2])) best = [n, 'High', len];
    }
    if (best) return [best[0], best[1]];
    const mt = new Set(tokens(memo));
    const hits = [];
    for (const t of mt) if (this.alias_tok.has(t)) hits.push(this.alias_tok.get(t));
    if (hits.length) {
      const c = new Map(); for (const h of hits) c.set(h, (c.get(h) || 0) + 1);
      let bestk = null, bestc = -1;
      for (const [k, v] of c) if (v > bestc) { bestk = k; bestc = v; }
      return [bestk, 'Medium'];
    }
    return null;
  }

  checkNames() {
    const th = this.th;
    this.buildNameIndex();
    const ph = new Set(this.rules.placeholder_names);
    for (const r of this.target) {
      const name = r.name;
      if (!name) continue;
      if (['Check', 'Credit Card Charge', 'Bill', 'Credit Card Credit'].includes(r.type) && this.cust.has(name) && !this.vend.has(name)) {
        this.flag(r, 'C1 Customer/vendor mix-up', 'Medium', `Customer name "${name}" used on a ${r.type}`,
          'This name only appears as a customer elsewhere. If this is a refund/recharge it is fine; otherwise the payee is wrong.', { conf: 'Role' });
      }
      if ((r.type === 'Invoice' || r.type === 'Credit Memo') && this.vend.has(name) && !this.cust.has(name)) {
        this.flag(r, 'C1 Customer/vendor mix-up', 'Medium', `Vendor name "${name}" used on a ${r.type}`, 'This name only appears as a vendor elsewhere.', { conf: 'Role' });
      }
      const memo = nz(r.memo);
      if (['Check', 'Credit Card Charge', 'Deposit'].includes(r.type) && Array.from(memo).length >= 15 && (this.rx('bank_feed_memo') || /$^/).test(memo) && !ph.has(name)) {
        const nt = tokens(name); const mn = normName(memo); const mt = tokens(memo);
        const ok = !nt.length || nt.some(tk => mn.includes(tk)) || nt.some(tk => mt.some(m => seqRatio(tk, m) >= 0.85));
        if (!ok) {
          const alt = this.suggestNameFromMemo(memo);
          if (alt && normName(alt[0]) !== normName(name)) {
            this.flag(r, 'C2 Name vs memo', 'Medium', `Name "${name}" not found in memo; memo mentions "${alt[0]}"`, `Memo: ${Array.from(memo).slice(0, 90).join('')}`, { sug_name: alt[0], conf: alt[1] });
          } else {
            const g = merchantGuess(memo);
            this.flag(r, 'C2 Name vs memo', 'Low', `Name "${name}" does not appear in the bank memo`, `Memo looks like merchant "${g}". Confirm the payee.`, { sug_name: g ? `(check) ${g}` : '', conf: 'Low' });
          }
        }
      }
    }
    for (const [pre, h] of this.hist_pre_cust) {
      const n = h.n; const c0 = h.items[0][1];
      if (n >= 8 && c0 / n >= 0.9 && h.items.length >= 1 && c0 < n) {
        const top = h.items[0][0];
        for (const r of this.inv_pre.filter(x => x.pre === pre && x.name !== top)) {
          this.flag(r, 'C4 Customer vs product', 'Medium', `Product family "${pre}-" is almost always sold to "${top}"`,
            `${c0} of ${n} lines were billed to ${top}; this one is billed to "${r.name}".`, { sug_name: top, conf: `${pct0(c0 / n)} of ${n}` });
        }
      }
    }
    // name master
    this.name_master_rows = [];
    const usage = new Map();
    for (const l of this.td) {
      if (l.name === null) continue;
      let u = usage.get(l.name); if (!u) { u = { lines: 0, first: l.date, last: l.date, abs: [] }; usage.set(l.name, u); }
      u.lines++; if (l.date < u.first) u.first = l.date; if (l.date > u.last) u.last = l.date; u.abs.push(Math.abs(l.amount));
    }
    const accsBy = new Map();
    for (const [k, g] of groupSorted(this.target, r => r.name)) {
      accsBy.set(k, valueCounts(g.map(r => r.leaf)).slice(0, 4).map(([a, c]) => `${a} (${c})`).join(', '));
    }
    const nl = namesSorted(this.names);
    const similar = new Map();
    const addSim = (a, b) => { let l = similar.get(a); if (!l) { l = []; similar.set(a, l); } l.push(b); };
    const keys = nl.map(a => normName(a).replace(/[^a-z0-9]/g, ''));
    for (let i = 0; i < nl.length; i++) {
      const ka = keys[i];
      for (let j = i + 1; j < nl.length; j++) {
        const kb = keys[j];
        if (ka.length < 5 || kb.length < 5) continue;
        let sim = ka === kb;
        if (!sim) {
          const la = ka.length, lb = kb.length;
          if ((2 * Math.min(la, lb)) / (la + lb) < th.near_dup_name_ratio) continue; // can't reach threshold
          sim = seqRatio(ka, kb) >= th.near_dup_name_ratio && !kb.includes(ka);
        }
        if (sim) { addSim(nl[i], nl[j]); addSim(nl[j], nl[i]); }
      }
    }
    for (const n of nl) {
      const notes = [];
      if (/\s{2,}|^\s|\s$/.test(n)) notes.push('extra spaces in name');
      if (ph.has(n)) notes.push('placeholder/generic name - real payee unknown');
      if (this.cust.has(n) && this.vend.has(n)) notes.push('used as BOTH customer and vendor');
      const sim = similar.get(n);
      if (sim && sim.length) notes.push('similar to: ' + sim.join('; '));
      const role = this.cust.has(n) && !this.vend.has(n) ? 'Customer' : this.vend.has(n) && !this.cust.has(n) ? 'Vendor' : this.cust.has(n) ? 'Both' : 'Other';
      const u = usage.get(n);
      this.name_master_rows.push({ name: n, role, lines: u.lines, gross_amount: npRound(npSum(u.abs), 2), first_used: u.first, last_used: u.last, accounts_used: accsBy.get(n) || '', notes: notes.join('; '), basis: '' });
      if ((sim && sim.length) || /\s{2,}/.test(n)) {
        this.flags.push({
          line_id: -1, severity: 'Low', check: 'C5 Similar names', issue: `Possible duplicate / inconsistent name: "${n}"`,
          detail: sim && sim.length ? 'Similar to: ' + sim.join('; ') : 'Extra spaces in name (breaks lookups/matching).',
          date: null, type: '(name list)', num: null, name: n, memo: null, account: null, cls: null, split: null, amount: null,
          suggested_account: '', suggested_name: n.replace(/\s+/g, ' ').trim(), confidence: '', source: 'Name list', rule_id: null,
        });
      }
    }
  }

  // ---------------------------------------------------------------- D
  /** A +X and a -X in the same account for the same name net to zero: they are not errors and not duplicates. */
  computeNetPairs() {
    const cfg = this.rules.netting || {};
    this.net_pairs = []; this.netted = new Set(); this.net_flags_cleared = 0;
    if (cfg.enabled === false) return;
    const maxDays = cfg.max_days;
    const groups = new Map();
    for (const r of this.target) {
      if (!r.amount) continue;
      const k = r.account + '|' + normName(r.name || '') + '|' + Math.round(Math.abs(r.amount) * 100);
      let g = groups.get(k); if (!g) { g = { pos: [], neg: [] }; groups.set(k, g); }
      (r.amount > 0 ? g.pos : g.neg).push(r);
    }
    for (const g of groups.values()) {
      if (!g.pos.length || !g.neg.length) continue;
      const used = new Set();
      for (const p of g.pos.slice().sort((a, b) => a.date - b.date)) {
        let best = -1, bestGap = Infinity;
        g.neg.forEach((n, i) => { if (used.has(i)) return; const gap = Math.abs(dayDiff(n.date, p.date)); if (gap <= maxDays && gap < bestGap) { best = i; bestGap = gap; } });
        if (best >= 0) { used.add(best); const n = g.neg[best]; this.net_pairs.push({ pos: p, neg: n, gap: bestGap }); this.netted.add(p.id); this.netted.add(n.id); }
      }
    }
    // Second pass on what is left: the same amount in the same account with the opposite sign still nets to zero when one side
    // has no name (a journal/offset entry), or when the account is a clearing / catch-all account where only the balance matters.
    const susp = new Set(this.rules.suspense_accounts || []);
    const left = new Map();
    for (const r of this.target) {
      if (!r.amount || this.netted.has(r.id)) continue;
      const k = r.account + '|' + Math.round(Math.abs(r.amount) * 100);
      let g = left.get(k); if (!g) { g = { pos: [], neg: [] }; left.set(k, g); }
      (r.amount > 0 ? g.pos : g.neg).push(r);
    }
    for (const g of left.values()) {
      if (!g.pos.length || !g.neg.length) continue;
      const used = new Set();
      for (const p of g.pos.slice().sort((a, b) => a.date - b.date)) {
        let best = -1, bestGap = Infinity;
        g.neg.forEach((n, i) => {
          if (used.has(i)) return;
          const ok = !p.name || !n.name || susp.has(p.account) || normName(p.name) === normName(n.name);
          const gap = Math.abs(dayDiff(n.date, p.date));
          if (ok && gap <= maxDays && gap < bestGap) { best = i; bestGap = gap; }
        });
        if (best >= 0) { used.add(best); const n = g.neg[best]; this.net_pairs.push({ pos: p, neg: n, gap: bestGap, loose: true }); this.netted.add(p.id); this.netted.add(n.id); }
      }
    }
    this.net_pairs.sort((a, b) => Math.abs(b.pos.amount) - Math.abs(a.pos.amount));
  }

  applyNetting() {
    if (!this.netted || !this.netted.size) return;
    const keep = new Set(['D3', 'G1', 'G2', 'G3', 'B3', 'E7']);
    const cleared = new Map();
    this.flags = this.flags.filter(f => {
      if (f.line_id < 0 || !this.netted.has(f.line_id) || keep.has(f.check.slice(0, 2))) return true;
      cleared.set(f.line_id, (cleared.get(f.line_id) || 0) + 1);
      return false;
    });
    for (const np of this.net_pairs) np.cleared = (cleared.get(np.pos.id) || 0) + (cleared.get(np.neg.id) || 0);
    this.net_flags_cleared = [...cleared.values()].reduce((a, b) => a + b, 0);
  }

  /** Learn routine items from the file itself: same name always posted to the same account, repeatedly (rent, internet,
   *  phone, gateway fees...). For those, the low-level hygiene flags are noise, so they are cleared and listed for audit. */
  applyRoutine() {
    const cfg = this.rules.routine || {};
    this.routine_rows = []; this.routine_cleared = 0;
    if (cfg.enabled === false) return;
    const minN = cfg.min_count, minShare = cfg.min_share;
    const supp = new Set(cfg.suppress_checks || []);
    const protectedRules = new Set(cfg.protected_rule_ids || []);
    const ph = new Set(this.rules.placeholder_names || []);
    const memoKey = m => { const t = nz(m).toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').replace(/(#\s*)+/g, '# ').trim(); return t.length >= 6 ? t.slice(0, 40) : null; };
    const routine = new Map();
    const build = (keyFn, basis) => {
      const total = new Map(), pair = new Map();
      for (const r of this.target) {
        const k = keyFn(r); if (!k) continue;
        total.set(k, (total.get(k) || 0) + 1);
        const pk = k + '||' + r.leaf; let g = pair.get(pk); if (!g) { g = { k, label: basis === 'name' ? r.name : nz(r.memo), account: r.account, lines: [] }; pair.set(pk, g); }
        g.lines.push(r);
      }
      for (const g of pair.values()) {
        if (g.lines.length < minN || g.lines.length / total.get(g.k) < minShare) continue;
        const am = g.lines.map(l => Math.abs(l.amount)).sort((x, y) => x - y);
        const dates = g.lines.map(l => l.date).sort((x, y) => x - y);
        const row = { basis, name: g.label, account: g.account, lines: g.lines.length, first: dates[0], last: dates[dates.length - 1], min_amount: am[0], max_amount: am[am.length - 1], flags_cleared: 0 };
        this.routine_rows.push(row);
        for (const l of g.lines) if (!routine.has(l.id)) routine.set(l.id, row);
      }
    };
    build(r => (r.name && !ph.has(r.name) ? normName(r.name) : null), 'name');
    build(r => memoKey(r.memo), 'memo');
    // Same memo, same account, same amount in 3+ different months = a standing monthly charge (insurance, loan, subscription).
    {
      const gm = new Map(), minM = cfg.recurring_min_months;
      for (const r of this.target) {
        const k = memoKey(r.memo); if (!k || !r.amount) continue;
        const kk = k + '||' + r.leaf + '||' + Math.round(Math.abs(r.amount) * 100);
        let g = gm.get(kk); if (!g) { g = { label: nz(r.memo), account: r.account, lines: [], months: new Set() }; gm.set(kk, g); }
        g.lines.push(r); g.months.add(ymKey(r.date));
      }
      for (const g of gm.values()) {
        if (g.months.size < minM) continue;
        const dates = g.lines.map(l => l.date).sort((x, y) => x - y), a = Math.abs(g.lines[0].amount);
        const row = { basis: 'monthly same amount', name: g.label, account: g.account, lines: g.lines.length, first: dates[0], last: dates[dates.length - 1], min_amount: a, max_amount: a, flags_cleared: 0 };
        this.routine_rows.push(row);
        for (const l of g.lines) if (!routine.has(l.id)) routine.set(l.id, row);
      }
    }
    this.flags = this.flags.filter(f => {
      if (f.line_id < 0 || !supp.has(f.check.slice(0, 2)) || !routine.has(f.line_id)) return true;
      if (/^(B1|C3)/.test(f.check) && f.rule_id && protectedRules.has(f.rule_id)) return true;
      routine.get(f.line_id).flags_cleared++; this.routine_cleared++;
      return false;
    });
    this.routine_rows.sort((a, b) => b.flags_cleared - a.flags_cleared || b.lines - a.lines);
    // Same-size repeats of the same payee that happen on many different dates (daily ad charges, per-wire fees) are a billing
    // pattern, not a double posting: keep them visible but as Info.
    const minDates = cfg.repeat_pattern_min_dates, minVendorDates = cfg.repeat_vendor_min_dates;
    const kAmt = f => [f.account, Math.abs(f.amount)].join('|');
    const kVen = f => f.name ? [f.name, f.account].join('|') : null;
    const dAmt = new Map(), dVen = new Map();
    const add = (m, k, t) => { if (k === null) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); };
    for (const f of this.flags) if (f.line_id >= 0 && /^D[12]/.test(f.check)) { add(dAmt, kAmt(f), f.date.getTime()); add(dVen, kVen(f), f.date.getTime()); }
    this.repeat_downgraded = 0;
    for (const f of this.flags) {
      if (f.line_id < 0 || !/^D[12]/.test(f.check)) continue;
      const na = dAmt.get(kAmt(f)).size, nv = kVen(f) ? dVen.get(kVen(f)).size : 0;
      if (na >= minDates || nv >= minVendorDates) {
        f.severity = 'Info'; f.detail = (f.detail || '') + (na >= minDates ? ` | The same amount is repeated on ${na} different dates in this account` : ` | This payee has repeated same-day charges on ${nv} different dates`) + ', so this looks like a routine billing pattern, not a double posting.'; this.repeat_downgraded++;
      }
    }
  }

  /** Rules describe one company's habits. When THIS company consistently posts a rule's matches to a different account
   *  (a different chart of accounts, new vendors), that is its way of booking, not an error: accept it and say so once. */
  applyRuleLearning() {
    const cfg = this.rules.rule_learning || {};
    this.rule_learned = []; this.rule_learned_cleared = 0;
    if (cfg.enabled === false || !this.rule_hits) return;
    const protectedRules = new Set((this.rules.routine || {}).protected_rule_ids || []);
    const accept = new Map(); // line id -> learned row
    for (const [rid, hits] of this.rule_hits) {
      if (protectedRules.has(rid) || hits.length < cfg.min_lines) continue;
      const byAcct = new Map();
      for (const h of hits) { const k = h.r.leaf; byAcct.set(k, (byAcct.get(k) || 0) + 1); }
      const [top, n] = [...byAcct.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n / hits.length < cfg.min_share || hits.filter(h => h.ok && h.r.leaf === top).length) continue; // already agrees with the rule
      const ru = this.rules.keyword_rules.find(x => x.id === rid);
      const row = { rule: rid, note: ru ? ru.note : '', account: top, lines: n, of: hits.length, share: n / hits.length, expected: ((ru && ru.expected) || []).slice(0, 3).join(', '), flags_cleared: 0 };
      this.rule_learned.push(row);
      for (const h of hits) if (h.r.leaf === top) accept.set(h.r.id + '|' + rid, row);
    }
    this.flags = this.flags.filter(f => {
      if (f.line_id < 0 || !f.rule_id || !/^(B1|C3)/.test(f.check)) return true;
      const row = accept.get(f.line_id + '|' + f.rule_id);
      if (!row) return true;
      row.flags_cleared++; this.rule_learned_cleared++; return false;
    });
    this.rule_learned.sort((a, b) => b.flags_cleared - a.flags_cleared);
  }

  /** Weak flags are made optional (Low/Info) so only items that really need a decision reach the accountant. */
  refineSeverity() {
    const c = this.rules.review || {};
    const byLine = new Map();
    for (const f of this.flags) if (f.line_id >= 0) { if (!byLine.has(f.line_id)) byLine.set(f.line_id, new Set()); byLine.get(f.line_id).add(f.check.slice(0, 2)); }
    this.refined = 0;
    const down = (f, sev, why) => { f.severity = sev; f.detail = (f.detail ? f.detail + ' | ' : '') + why; this.refined++; };
    for (const f of this.flags) {
      if (f.line_id < 0 || SEV_RANK[f.severity] < 2) continue;
      const code = f.check.slice(0, 2), amt = Math.abs(f.amount || 0), other = byLine.get(f.line_id);
      if (SEV_RANK[f.severity] === 2 && amt < c.small_floor && !['D3', 'E7', 'B3', 'G1', 'G2', 'G3'].includes(code) && code !== 'E5') down(f, 'Low', `Small amount (under $${c.small_floor}): optional.`);
      else if (code === 'C2' && this.upworkRx() && this.upworkRx().test(nz(f.memo)) && this.related && this.related.has(f.name)) down(f, 'Info', 'Paid on behalf of a related company (agreed rule): the name is not expected in the bank memo.');
      else if (code === 'A1' && amt < c.a1_min_amount) down(f, 'Low', `Small amount (under $${c.a1_min_amount}): adding the name is optional.`);
      else if (code === 'E1') {
        const m = /is ([\d.]+) times the typical/.exec(f.issue || ''), mult = m ? +m[1] : 0;
        if (other.has('E7') || other.has('G1') || other.has('G2') || other.has('G3') || (this.upworkRx() && this.upworkRx().test(f.name || ''))) down(f, 'Info', 'Already covered by the cash / allocation checks.');
        else if (amt < c.e1_min_amount || mult < c.e1_min_multiple) down(f, 'Low', `Not large enough to need action (needs at least $${c.e1_min_amount} and ${c.e1_min_multiple} times the typical amount).`);
      } else if ((code === 'D1' || code === 'D2') && amt < c.dup_min_amount) down(f, 'Info', `Tiny amount (under $${c.dup_min_amount}).`);
    }
  }

  /** One row per thing the accountant must decide: lines with several flags show once, and the same issue on the same payee is grouped. */
  buildQueue() {
    const ORDER = (this.rules.review || {}).check_priority || [];
    const pri = f => SEV_RANK[f.severity] * 100 - (ORDER.indexOf(f.check.slice(0, 2)) + 1 || 50);
    const memoK = m => nz(m).toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').trim().slice(0, 30);
    const lineBy = new Map(), account = [];
    for (const f of this.flags) {
      if (f.line_id < 0) { if (SEV_RANK[f.severity] >= 2) account.push(f); continue; }
      if (!lineBy.has(f.line_id)) lineBy.set(f.line_id, []);
      lineBy.get(f.line_id).push(f);
    }
    const groups = new Map();
    for (const [id, fs] of lineBy) {
      fs.sort((a, b) => pri(b) - pri(a));
      const p = fs[0]; if (SEV_RANK[p.severity] < 2) continue;
      const code = p.check.slice(0, 2);
      const who = p.name ? normName(p.name) : memoK(p.memo);
      let key = [code, who, p.account].join('|');
      if (code[0] === 'D') key += '|' + isoDate(p.date) + '|' + Math.round(Math.abs(p.amount) * 100);
      let g = groups.get(key);
      if (!g) { g = { memo_key: nz(p.memo).toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').replace(/(#\s*)+/g, '# ').trim().slice(0, 40), severity: p.severity, check: p.check, action: p.issue, detail: p.detail, name: p.name || '', account: p.account, suggested_account: p.suggested_account || '', suggested_name: p.suggested_name || '', lines: 0, total: 0, dates: [], example_memo: nz(p.memo), also: new Set(), refs: [], line_ids: [] }; groups.set(key, g); }
      if (SEV_RANK[p.severity] > SEV_RANK[g.severity]) g.severity = p.severity;
      g.lines++; g.total += p.amount || 0; g.dates.push(p.date); g.refs.push(p.source); g.line_ids.push(id);
      for (const o of fs.slice(1)) g.also.add(o.check);
    }
    const q = [];
    for (const g of groups.values()) {
      g.dates.sort((a, b) => a - b);
      q.push({ severity: g.severity, check: g.check, what_to_do: g.action + (g.detail && g.lines === 1 ? ' - ' + g.detail : ''), name: g.name, account: g.account, suggested_account: g.suggested_account, suggested_name: g.suggested_name, lines: g.lines, total: g.total, first: g.dates[0], last: g.dates[g.dates.length - 1], example_memo: g.example_memo, memo_key: g.memo_key, also_flagged: [...g.also].sort().join('; '), where: g.refs.slice(0, 6).join(', ') + (g.refs.length > 6 ? ` (+${g.refs.length - 6} more)` : ''), line_ids: g.line_ids });
    }
    for (const f of account) q.push({ severity: f.severity, check: f.check, what_to_do: f.issue + (f.detail ? ' - ' + f.detail : ''), name: f.name || '', account: f.account || '', suggested_account: '', suggested_name: '', lines: 0, total: f.amount || 0, first: null, last: null, example_memo: '', also_flagged: '', where: f.source || '', line_ids: [] });
    // Report-to-report differences: many account-level mismatches usually have one cause (reports exported on different days or periods),
    // so they are shown as one decision per family instead of dozens of rows.
    const bad = (this.recon || []).filter(r => r.status === 'MISMATCH');
    const fam = k => bad.filter(r => r.check.startsWith(k));
    const addRec = (rows, check, sev, text) => { if (!rows.length) return; q.push({ severity: sev, check, what_to_do: text, name: '', account: '', suggested_account: '', suggested_name: '', lines: 0, total: rows.reduce((a, r) => a + Math.abs(r.difference || 0), 0), first: null, last: null, example_memo: rows.slice(0, 3).map(r => r.item).join('; '), also_flagged: '', where: 'Reconciliation tab (' + rows.length + ' rows)', line_ids: [], recon: true }); };
    const cross = [...fam('F0'), ...fam('F1'), ...fam('F3'), ...fam('F4')];
    addRec(cross, 'F1-F4 Reports disagree', cross.length >= 3 ? 'High' : 'Medium', cross.length >= 3
      ? `The reports do not agree with each other (${cross.length} differences, e.g. different line counts or account totals). This usually means they were exported on different days or for different periods. Re-export all reports together for the same period, then run again; do not fix these one by one.`
      : `${cross.length} difference(s) between the reports. See the Reconciliation tab.`);
    addRec([...fam('F5')], 'F5 Aging vs control account', 'Medium', 'A/R or A/P aging does not match its control account in the books. Check the aging report date and any open items.');
    addRec(fam('F6'), 'F6 Catch-all balance', 'Medium', 'Catch-all / clearing accounts should be zero at period end but are not. Reclassify or clear them.');
    q.sort((a, b) => (SEV_RANK[b.severity] - SEV_RANK[a.severity]) || (Math.abs(b.total) - Math.abs(a.total)));
    q.forEach((x, i) => { x.item = 'R-' + String(i + 1).padStart(3, '0'); });
    this.queue = q;
  }

  checkDuplicates() {
    const tAll = this.target.filter(r => r.type !== 'General Journal');
    const t = tAll.filter(r => !this.netted || !this.netted.has(r.id)).map(r => ({ r, amt: npRound(r.amount, 2), mkey: (r.memo || '').toLowerCase().replace(/\s+/g, ' ') }));
    const ph = new Set(this.rules.placeholder_names);
    const seen = new Set();
    const groups = groupKeyed(t, x => {
      const tup = [x.r.type, x.r.date.getTime(), x.r.name, x.amt === 0 ? 0 : x.amt, x.r.leaf, x.mkey];
      return [JSON.stringify(tup), tup];
    }, cmpTuple);
    for (const gg of groups) {
      const k = gg.tup; const grp = gg.rows.map(x => x.r);
      if (grp.length < 2 || k[3] === 0) continue;
      if (MULTILINE_TYPES.has(k[0])) {
        const nums = new Set(grp.filter(r => r.num !== null).map(r => String(r.num)));
        if (nums.size < 2) continue;
        if (k[2] !== null && ph.has(k[2])) continue;
      }
      const refs = findRefs(grp[0].memo || '');
      const sev = refs.length || Math.abs(k[3]) >= 1000 ? 'High' : 'Medium';
      for (const r of grp) {
        this.flag(r, 'D1 Exact duplicate', sev, `Identical transaction appears ${grp.length}x`,
          'Same date, name, amount, account and memo' + (refs.length ? ` (same bank reference ${refs[0]})` : '') +
          `. Other copies at source rows: ${grp.filter(x => x.src_row !== r.src_row).map(x => x.src_row).join(', ')}.`, { conf: 'Exact', adjust: false });
      }
      for (const r of grp) seen.add(r.id);
    }
    const th = this.th;
    const p = t.filter(x => ['Check', 'Credit Card Charge', 'Bill', 'Deposit'].includes(x.r.type) && x.r.name !== null && Math.abs(x.amt) >= th.probable_dup_min_amount);
    const pg = groupKeyed(p, x => { const tup = [x.r.name, x.amt === 0 ? 0 : x.amt, x.r.leaf]; return [JSON.stringify(tup), tup]; }, cmpTuple);
    for (const gg of pg) {
      if (gg.rows.length < 2) continue;
      const rows = gg.rows.map(x => x.r).sort((a, b) => a.date - b.date);
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i], b = rows[i + 1];
        const dd = dayDiff(b.date, a.date);
        if (!(dd > 0 && dd <= th.probable_dup_days) || seen.has(a.id) || seen.has(b.id)) continue;
        const ra = new Set(findRefs(a.memo || '')), rb = new Set(findRefs(b.memo || ''));
        if (ra.size && rb.size && !(ra.size === rb.size && [...ra].every(x => rb.has(x)))) continue;
        const r = this.td[b.id];
        this.flag(r, 'D2 Probable duplicate', ph.has(gg.tup[0]) ? 'Low' : 'Medium', `Same payee/amount/account ${dd} day(s) after another`,
          `Earlier: ${isoDate(a.date)} (row ${a.src_row}), this: ${isoDate(b.date)}. Check the bank statement - one may be double-posted.`, { conf: 'Pattern' });
      }
    }
    const d = tAll.filter(r => r.num !== null && ['Invoice', 'Credit Memo', 'Bill'].includes(r.type) && /^\d{3,}$/.test(String(r.num)));
    const dg = groupKeyed(d, r => { const tup = [r.type, String(r.num)]; return [JSON.stringify(tup), tup]; }, cmpTuple);
    for (const gg of dg) {
      const grp = gg.rows;
      const nm = []; const s = new Set();
      for (const r of grp) if (r.name !== null && !s.has(r.name)) { s.add(r.name); nm.push(r.name); }
      if (nm.length > 1) {
        const [ty, num] = gg.tup;
        this.flag(grp[0], 'D3 Number reused', 'High', `${ty} number ${num} used by different names`, `Names: ${nm.join(', ')}`, { conf: 'Exact', adjust: false });
      }
    }
  }

  // ---------------------------------------------------------------- E
  checkUnusual() {
    const th = this.th;
    const t = this.target;
    for (const r of t) {
      if (r.type === 'General Journal') continue;
      if (['Check', 'Credit Card Charge', 'Bill'].includes(r.type) && ['Expense', 'COGS'].includes(r.acct_type) && r.amount < 0 && !IGNORE_MEMO.test(nz(r.memo))) {
        this.flag(r, 'E5 Negative expense', 'Low', 'Credit/negative amount on an expense line', 'Refund or reversal? Confirm and make sure it hits the same account as the original.', { conf: 'Logic' });
      }
      if (['Check', 'Credit Card Charge', 'Bill', 'Invoice'].includes(r.type) && r.amount === 0 && !['AR', 'AP'].includes(r.acct_type)) {
        this.flag(r, 'E5 Zero amount', 'Info', 'Zero-dollar line', 'Zero lines add noise; remove unless needed.', { conf: 'Logic', adjust: false });
      }
      if (['Check', 'Credit Card Charge'].includes(r.type) && r.amount >= th.round_amount_min && r.amount % 100 === 0 && !this.cashNames().has(r.name)) {
        this.flag(r, 'E2 Round amount', 'Low', `Round-dollar payment $${fmtComma(r.amount, 0)}`, 'Large round amounts are worth checking to an invoice/contract.', { conf: 'Pattern', adjust: false });
      }
    }
    const v = t.filter(r => ['Check', 'Credit Card Charge', 'Bill'].includes(r.type) && r.name !== null && r.amount > 0 && ['Expense', 'COGS', 'OtherExpense'].includes(r.acct_type));
    const og = groupKeyed(v, r => { const tup = [r.name, r.leaf]; return [JSON.stringify(tup), tup]; }, cmpTuple);
    for (const gg of og) {
      const g = gg.rows; const [n, a] = gg.tup;
      if (g.length < th.outlier_min_txns) continue;
      const med = median(g.map(r => r.amount));
      if (med <= 0) continue;
      for (const r of g.filter(x => x.amount > med * th.outlier_multiple && x.amount >= th.outlier_min_amount)) {
        this.flag(r, 'E1 Amount outlier', 'Medium', `$${fmtComma(r.amount, 2)} is ${fmtFixed(r.amount / med, 1)} times the typical $${fmtComma(med, 2)} for ${n} / ${a}`,
          `Median of ${g.length} similar lines is $${fmtComma(med, 2)}.`, { conf: `${fmtFixed(r.amount / med, 1)}x median` });
      }
    }
    const RE1 = this.rx('purchase_date_memo') || /$^/;
    const RE2 = /pay period.*?([A-Za-z]{3})\w*\s+(\d{1,2}),?\s*(\d{4})\s*[-–]\s*([A-Za-z]{3})\w*\s+(\d{1,2}),?\s*(\d{4})/i;
    const RE3 = this.rx('payroll_check_date_memo', '') || /$^/;
    for (const r of t) {
      const memo = nz(r.memo);
      if (!memo) continue;
      let m = RE1.exec(memo);
      if (m) {
        const mo = +m[1], da = +m[2];
        let pdte = mkDate(r.date.getUTCFullYear(), mo, da);
        if (pdte) {
          if (dayDiff(pdte, r.date) > 180) pdte = mkDate(pdte.getUTCFullYear() - 1, mo, da);
          if (pdte) {
            const dd = dayDiff(r.date, pdte);
            if (dd < -1) this.flag(r, 'E4 Date vs memo', 'Medium', 'Booked BEFORE the purchase date in the memo', `Memo says purchase ${pad2(mo)}/${pad2(da)}, transaction dated ${isoDate(r.date)}.`, { conf: 'Date logic' });
            else if (dd > th.memo_date_late_days) this.flag(r, 'E4 Date vs memo', 'Low', `Booked ${dd} days after purchase date in memo`, `Memo says purchase ${pad2(mo)}/${pad2(da)}, transaction dated ${isoDate(r.date)}.`, { conf: 'Date logic' });
          }
        }
      }
      m = RE2.exec(memo);
      if (m) {
        const mon = MONTHS[m[4].toLowerCase()];
        const end = mon ? mkDate(+m[6], mon, +m[5]) : null;
        if (end) {
          const diff = dayDiff(r.date, end);
          if (diff < -7 || diff > th.pay_period_tolerance_days) {
            this.flag(r, 'E4 Date vs memo', 'Medium', 'Pay period in memo does not match transaction date',
              `Pay period ends ${isoDate(end)}, paid ${isoDate(r.date)} (${diff} days). Likely a year/date typo in the memo.`, { conf: 'Date logic' });
          }
        }
      }
      m = RE3.exec(memo);
      if (m && r.type === 'General Journal') {
        const pc = parseLooseDate(m[1]);
        if (pc && Math.abs(dayDiff(r.date, pc)) > th.pr_date_tolerance_days) {
          this.flag(r, 'E4 Date vs memo', 'Medium', 'Journal date differs from payroll check date in memo', `Memo date ${isoDate(pc)} vs journal ${isoDate(r.date)}.`, { conf: 'Date logic' });
        }
      }
    }
    const rv = t.filter(r => r.name !== null && !['General Journal', 'Invoice', 'Payment'].includes(r.type) && Math.abs(r.amount) >= 1000 && !IGNORE_MEMO.test(r.memo || ''));
    const rg = groupKeyed(rv, r => { const a = npRound(Math.abs(r.amount), 2); const tup = [r.name, a]; return [JSON.stringify(tup), tup]; }, cmpTuple);
    for (const gg of rg) {
      const g = gg.rows; const [n, a] = gg.tup;
      if (g.length >= 2 && g.some(x => x.amount > 0) && g.some(x => x.amount < 0)) {
        for (const r of g) this.flag(r, 'E6 Reversal pair', 'Info', `Offsetting entries for ${n} $${fmtComma(a, 2)}`,
          'A debit and credit of the same size exist: confirm the pair is intentional and not a mis-posting + correction left in the books.', { conf: 'Pattern', adjust: false });
      }
    }
  }

  // ---------------------------------------------------------------- F
  rec(check, item, expected, actual, note = '') {
    const diff = expected === null || expected === undefined || actual === null || actual === undefined ? null : pyRound(actual - expected, 2);
    const status = diff === null ? 'n/a' : (Math.abs(diff) <= this.th.tolerance ? 'OK' : 'MISMATCH');
    this.recon.push({ check, item, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual, difference: diff, status, note });
  }

  checkReconciliations() {
    const td = this.td, gl = this.gl;
    const tol = this.th.tolerance;
    const tdSum = npSum(td.map(l => l.amount)), glSum = npSum(gl.map(l => l.amount));
    this.rec('F0 Ledger balances', 'Transaction Detail total activity (should be 0.00)', 0, npRound(tdSum, 2));
    this.rec('F0 Ledger balances', 'General Ledger total activity (should be 0.00)', 0, npRound(glSum, 2));
    this.rec('F0 Ledger balances', 'GL activity vs Transaction Detail activity (all accounts)', npRound(tdSum, 2), npRound(glSum, 2));
    this.rec('F0 Ledger balances', 'Number of lines: GL vs Transaction Detail', td.length, gl.length);
    const sumBy = (rows, kf) => new Map(groupSorted(rows, kf).map(([k, g]) => [k, kahanSum(g.map(x => x.amount))]));
    const glAct = sumBy(gl, l => l.account), tdAct = sumBy(td, l => l.account);
    const allAcct = [...new Set([...glAct.keys(), ...tdAct.keys()])].sort(cmpv);
    for (const acct of allAcct) {
      const a = glAct.has(acct) ? glAct.get(acct) : 0, b = tdAct.has(acct) ? tdAct.get(acct) : 0;
      if (Math.abs(a - b) > tol) this.rec('F1 GL vs Transaction Detail', acct, npRound(b, 2), npRound(a, 2), 'Same account has different activity in the two reports');
    }
    // groupby.last() skips nulls
    const glEnd = new Map();
    for (const [k, g] of groupSorted(gl, l => l.account)) {
      let last = NaN;
      for (const l of g) if (l.balance !== null && l.balance !== undefined && !Number.isNaN(l.balance)) last = Number(l.balance);
      glEnd.set(k, last);
    }
    for (const [acct, m] of this.gl_meta) {
      if ('open_bal' in m && glAct.has(acct) && glEnd.has(acct)) {
        const exp = npRound(m.open_bal + glAct.get(acct), 2);
        const act = pyRound(Number(glEnd.get(acct)), 2);
        if (Math.abs(exp - act) > tol) this.rec('F1 GL roll-forward', acct, exp, act, 'Opening balance + activity <> ending running balance');
      }
    }
    if (this.tb && this.tb.size) {
      for (const k of ['__TOTAL_DEBIT__', '__TOTAL_CREDIT__']) if (!this.tb.has(k)) throw new PyError('KeyError', `'${k}'`);
      this.rec('F2 Trial balance', 'Total debits vs total credits', this.tb.get('__TOTAL_DEBIT__'), this.tb.get('__TOTAL_CREDIT__'));
      const tbk = new Map([...this.tb].filter(([k]) => !k.startsWith('__')));
      const tbkeys = [...tbk.keys()];
      const tbkey = acct => {
        let best = null;
        for (const k of tbkeys) if (acct === k || acct.startsWith(k + ' > ')) { if (best === null || k.length > best.length) best = k; }
        return best;
      };
      const endByTb = new Map();
      for (const [acct, bal] of glEnd) {
        const k = tbkey(acct);
        const key = k || '(no TB account) ' + acct;
        endByTb.set(key, (endByTb.get(key) || 0) + bal);
      }
      let bad = 0;
      for (const [k, v] of tbk) {
        const e = pyRound(endByTb.has(k) ? endByTb.get(k) : 0.0, 2);
        if (Math.abs(e - v) > tol) {
          if (!endByTb.has(k) && Math.abs(e) <= tol) {
            this.rec('F2 TB balances with no 2026 activity', k, pyRound(v, 2), null, "No GL activity in the period, so balance is brought forward: agree it to last period's closing balance.");
          } else {
            this.rec('F2 TB vs GL ending balance', k, pyRound(v, 2), e, 'Trial balance and GL disagree for this account');
            bad++;
          }
        }
      }
      for (const [k, val] of endByTb) {
        if (k.startsWith('(no TB account)') && Math.abs(val) > tol) this.rec('F2 TB vs GL ending balance', k, 0, pyRound(val, 2), 'Account in GL has no trial-balance line');
      }
      if (bad === 0) this.rec('F2 TB vs GL ending balance', `All ${tbk.size} trial-balance accounts agree with GL ending balances`, 0, 0);
      for (const [k, v] of tbk) {
        const sp = k.split(' > '); const leaf = sp[sp.length - 1];
        const ty = this.type_map.get(leaf);
        if ((ty === 'Income' || ty === 'OtherIncome') && v > tol) this.rec('F7 Abnormal balance', k, null, v, 'Income account has a DEBIT balance');
        if ((ty === 'Expense' || ty === 'COGS' || ty === 'OtherExpense') && v < -tol) this.rec('F7 Abnormal balance', k, null, v, 'Expense account has a CREDIT balance');
        if ((ty === 'Liability' || ty === 'AP' || ty === 'CreditCard') && v > tol) this.rec('F7 Abnormal balance', k, null, v, 'Liability account has a DEBIT balance');
        if ((ty === 'Bank' || ty === 'AR' || ty === 'OtherAsset') && v < -tol) this.rec('F7 Abnormal balance', k, null, v, 'Asset account has a CREDIT balance');
      }
      for (const s of this.rules.suspense_accounts) {
        for (const [k, v] of tbk) {
          const sp = k.split(' > ');
          if (sp[sp.length - 1] === s && Math.abs(v) > tol) this.rec('F6 Catch-all balance', k, 0, pyRound(v, 2), 'Catch-all / clearing account should be zero at period end');
        }
      }
      for (const [k, v] of tbk) {
        const kids = tbkeys.filter(x => x.startsWith(k + ' > '));
        if (kids.length && Math.abs(v) > tol) {
          let kidSum = 0; for (const x of kids) kidSum += tbk.get(x);
          this.rec('F8 Parent account balance', k, null, v, `Parent account holds a balance of ${fmtComma(v, 2)} directly while it has ${kids.length} sub-accounts (sub-account total ${fmtComma(kidSum, 2)}). Re-post to the sub-accounts.`);
        }
      }
    }
    if (this.pl) this.cmpReports(this.pl, 'F3 P&L Detail vs Transaction Detail', new Set(['Income', 'COGS', 'Expense', 'OtherIncome', 'OtherExpense']));
    if (this.bs) this.cmpReports(this.bs, 'F4 Balance Sheet Detail vs Transaction Detail', new Set(['Bank', 'AR', 'OtherAsset', 'FixedAsset', 'AP', 'CreditCard', 'Liability', 'Equity']));
    if (this.tb && this.tb.size) {
      const tbk = new Map([...this.tb].filter(([k]) => !k.startsWith('__')));
      if (this.ar && this.ar.size && this.acct.ar_control) {
        const tot = this.ar.has('TOTAL') ? this.ar.get('TOTAL').total : undefined;
        this.rec('F5 AR aging vs control account', `AR aging total vs ${this.acct.ar_control} (trial balance)`, pyRound(tbk.has(this.acct.ar_control) ? tbk.get(this.acct.ar_control) : 0, 2), tot !== undefined ? pyRound(tot, 2) : null,
          'Difference usually = unapplied payments/credits, a bad A/R entry, or an aging report run on a different date.');
      }
      if (this.ap && this.ap.size && this.acct.ap_control) {
        const tot = this.ap.has('TOTAL') ? this.ap.get('TOTAL').total : undefined;
        this.rec('F5 AP aging vs control account', `AP aging total vs ${this.acct.ap_control} (trial balance)`, pyRound(-(tbk.has(this.acct.ap_control) ? tbk.get(this.acct.ap_control) : 0), 2), tot !== undefined ? pyRound(tot, 2) : null,
          'Difference usually = unapplied vendor credits/payments or an entry posted straight to A/P.');
      }
    }
    const tdNames = new Set(td.filter(l => l.name !== null).map(l => pyStrip(l.name)));
    for (const [label, ag] of [['AR', this.ar], ['AP', this.ap]]) {
      if (!ag || !ag.size) continue;
      for (const [n, b] of ag) {
        if (n === 'TOTAL') continue;
        if (!tdNames.has(pyStrip(n)) && Math.abs(b.total) > 0) this.rec(`F5 ${label} aging names`, n, null, b.total, 'Name on aging report is not found in the 2026 ledger lines (spelling/space difference or old balance).');
        if (b.over90 && Math.abs(b.over90) > 0) this.rec(`F5 ${label} aged > 90 days`, n, null, b.over90, 'Balance older than 90 days - collectability / payment follow-up.');
        if (b.b61_90 && Math.abs(b.b61_90) > 0) this.rec(`F5 ${label} aged 61-90`, n, null, b.b61_90, 'Balance 61-90 days old.');
      }
    }
  }

  cmpReports(rep, label, types) {
    const td = this.td;
    const tdSub = td.filter(l => types.has(l.acct_type));
    const sumBy = (rows) => new Map(groupSorted(rows, l => l.leaf).map(([k, g]) => [k, npRound(kahanSum(g.map(x => x.amount)), 2)]));
    const repSum = sumBy(rep), tdSum = sumBy(tdSub);
    const leaves = [...new Set([...repSum.keys(), ...tdSum.keys()])].sort(cmpv);
    for (const leaf of leaves) {
      const a = repSum.has(leaf) ? repSum.get(leaf) : 0, b = tdSum.has(leaf) ? tdSum.get(leaf) : 0;
      if (Math.abs(a - b) > this.th.tolerance && Math.abs(a + b) > this.th.tolerance) this.rec(label, leaf, b, a, 'Account total differs between the two reports');
    }
    if (rep.length !== tdSub.length) this.rec(label, 'Line count', tdSub.length, rep.length, 'Different number of lines between reports');
    const keyf = rows => {
      const c = new Map();
      for (const l of rows) {
        const tup = [isoDate(l.date), l.type, pyStrip(nz(l.num)), pyStrip(nz(l.name)), npRound(Math.abs(l.amount), 2), l.leaf];
        const k = JSON.stringify(tup);
        const e = c.get(k); if (e) e.n++; else c.set(k, { n: 1, tup });
      }
      return c;
    };
    const k1 = keyf(tdSub), k2 = keyf(rep);
    const sub = (a, b) => { const out = []; for (const [k, e] of a) { const n = e.n - (b.has(k) ? b.get(k).n : 0); if (n > 0) out.push([e.tup, n]); } return out; };
    const miss1 = sub(k1, k2), miss2 = sub(k2, k1);
    const reprTup = tup => '(' + tup.map(x => (typeof x === 'string' ? pyReprStr(x) : pyReprNum(x))).join(', ') + ')';
    const tot = m => m.reduce((s, x) => s + x[1], 0);
    if (!miss1.length && !miss2.length) {
      let n = 0; for (const e of k1.values()) n += e.n;
      this.rec(label, `All ${n} lines match line-for-line (date, type, num, name, amount, account)`, 0, 0);
    } else {
      this.rec(label, 'Lines in Transaction Detail missing from this report', 0, tot(miss1), miss1.slice(0, 3).map(x => reprTup(x[0])).join('; '));
      this.rec(label, 'Lines in this report missing from Transaction Detail', 0, tot(miss2), miss2.slice(0, 3).map(x => reprTup(x[0])).join('; '));
    }
  }

  // ---------------------------------------------------------------- G
  detectRelatedParties() {
    const cfg = this.rules.related_parties || {};
    const keys = new Set(cfg.names || []);
    const cfgKeys = [...keys];
    const auto = new Set();
    const rxToFrom = this.rx('related_to_from'), rxCard = this.rx('related_card');
    if (cfg.auto_detect !== false) {
      const accts = []; const s = new Set();
      for (const l of this.td) if (!s.has(l.account)) { s.add(l.account); accts.push(l.account); }
      for (const a of accts) {
        const parts = a.split(' > ');
        const last = parts[parts.length - 1];
        let m = rxToFrom && rxToFrom.exec(last);
        if (m) { keys.add(pyStrip(m[1])); auto.add(pyStrip(m[1])); }
        m = rxCard && rxCard.exec(last);
        if (m && parts.length > 1) { keys.add(pyStrip(m[1])); auto.add(pyStrip(m[1])); }
      }
    }
    const rel = new Set();
    for (const n of this.names) {
      const nt = new Set(normName(n).split(/\s+/).filter(Boolean));
      for (const k of keys) {
        const kt = new Set(normName(k).split(/\s+/).filter(Boolean));
        if (kt.size && [...kt].every(x => nt.has(x))) rel.add(n);
      }
    }
    this.related = rel; this.related_keys = [...keys].sort(cmpv);
    // companies the books treat as related (To/From X, X Card accounts) that are NOT on the confirmed list
    const tk = x => new Set(normName(x).split(/\s+/).filter(Boolean));
    const known = cfgKeys.map(tk);
    this.new_related = [...auto].filter(a => { const t = tk(a); return t.size && !known.some(k => k.size && ([...k].every(x => t.has(x)) || [...t].every(x => k.has(x)))); }).sort(cmpv);
    this.notes.push('Related parties detected from the reports: ' + ([...rel].sort(cmpv).join(', ') || 'none'));
  }

  checkApprovedVendors() {
    // memo-based approvals for lines with no name (added with "Always OK" on the page): same memo wording + same account
    const am = this.rules.approved_memo || [];
    if (am.length) {
      const mk = m => nz(m).toLowerCase().replace(/\d+(\.\d+)?/g, '#').replace(/[^a-z#]+/g, ' ').replace(/(#\s*)+/g, '# ').trim().slice(0, 40);
      const set = new Set(am.map(x => x.memo_key + '||' + x.account));
      for (const r of this.target) if (!r.name && set.has(mk(r.memo) + '||' + r.account)) { this.rule_matched_ids.add(r.id); this.rule_ok_ids.add(r.id); this.approved_ok.add(r.id); }
    }
    // name + account pairs the reviewer accepted with "Always OK": that combination is fine; other accounts are not restricted
    const ap = this.rules.approved_pairs || [];
    if (ap.length) {
      const set = new Set(ap.map(x => normName(x.name) + '||' + x.account));
      for (const r of this.target) if (r.name && set.has(normName(r.name) + '||' + r.account)) { this.rule_matched_ids.add(r.id); this.rule_ok_ids.add(r.id); this.approved_ok.add(r.id); }
    }
    const appr = new Map();
    for (const [k, v] of Object.entries(this.rules.approved_vendor_accounts || {})) appr.set(normName(k), v);
    if (!appr.size) return;
    for (const r of this.target) {
      const exp = r.name ? appr.get(normName(r.name)) : null;
      if (!exp || !exp.length) continue;
      this.rule_matched_ids.add(r.id);
      if (exp.includes(r.leaf) || exp.includes(r.account)) { this.rule_ok_ids.add(r.id); this.approved_ok.add(r.id); }
      else this.flag(r, 'B3 Approved vendor account', 'Medium', `"${r.name}" is approved only for: ${exp.join(', ')}`, `Posted to "${r.leaf}".`, { sug_acct: exp[0], conf: 'Approved list' });
    }
  }

  checkAllocation() {
    const rules = this.rules.allocation_rules || [];
    this.alloc_rows = []; this.billed = [];
    if (!rules.length) return;
    const td = this.td;
    const ar = td.filter(l => (l.type === 'Invoice' || l.type === 'Credit Memo') && l.acct_type === 'AR');
    const th = ((this.rules.upwork || {}).split_drift_points ?? 15) / 100.0;
    for (const ru of rules) {
      const pat = pyRegex(ru.memo_pattern, 'i');
      const allowed = ru.allowed_entities;
      const sub = ar.filter(l => pat.test(l.memo || ''));
      const by = new Map(); // key "m\u0001ent" -> {m, e, v}
      const addBy = (m, e, v) => { const k = m + '\u0001' + e; const x = by.get(k); if (x) x.v += v; else by.set(k, { m, e, v }); };
      for (const r of sub) {
        const nt = new Set(normName(r.name).split(/\s+/).filter(Boolean));
        const ent = allowed.find(a => { const at = normName(a).split(/\s+/).filter(Boolean); return at.every(x => nt.has(x)); }) ?? null;
        const m = ymKey(r.date);
        addBy(m, ent || `OTHER: ${pyS(r.name)}`, r.amount);
        this.billed.push([r.id, m, r.amount]);
        if (ent === null) {
          this.flag(r, 'G1 Allocation', 'Medium', `${ru.worker} hours billed to "${pyS(r.name)}" - not an allowed entity`,
            `${ru.note} Allowed: ${allowed.join(', ')}.`, { sug_name: allowed.join(' / '), conf: 'Allocation rule' });
        }
      }
      const entries = [...by.values()];
      const months = [...new Set(entries.map(x => x.m))].sort(cmpv);
      const monthTot = m => { let s = 0; for (const x of entries) if (x.m === m) s += x.v; return s; };
      const sortedEntries = [...entries].sort((a, b) => cmpv(a.m, b.m) || cmpv(a.e, b.e));
      for (const m of months) {
        const tot = monthTot(m);
        for (const x of sortedEntries) {
          if (x.m === m) this.alloc_rows.push({ worker: ru.worker, month: m, entity: x.e, amount: pyRound(x.v, 2), share_of_worker_month: tot ? npRound(x.v / tot, 3) : null, rule: ru.note });
        }
      }
      if (allowed.length > 1) {
        const hist = [];
        for (const m of months) {
          const tot = monthTot(m);
          const e0 = by.get(m + '\u0001' + allowed[0]);
          const sh = tot ? (e0 ? e0.v : 0) / tot : 0;
          let hs = 0; for (const h of hist) hs += h;
          const avg = hist.length ? hs / hist.length : 0;
          if (hist.length >= 2 && Math.abs(sh - avg) > th) {
            this.flagAccountLevel('G2 Split drift', 'Medium', `${ru.worker}: ${allowed[0]} share in ${m} is ${pct0(sh)} vs usual ${pct0(avg)}`,
              `Earlier months averaged ${pct0(avg)} to ${allowed[0]}. Confirm the split for ${m} is intended.`, { source: 'Allocation', type_label: '(allocation)', name: ru.worker });
          }
          if (sh > 0) hist.push(sh);
        }
      }
    }
  }

  checkUpworkRecharge() {
    const cfg = this.rules.upwork;
    this.recharge_rows = [];
    if (!cfg || (!(this.billed && this.billed.length) && !(this.rules.allocation_rules && this.rules.allocation_rules.length))) return;
    const tol = cfg.tolerance_pct ?? 0.05;
    const pat = pyRegex(cfg.charge_memo_pattern, 'i');
    const ch = this.td.filter(l => ['Bank', 'CreditCard'].includes(l.acct_type) && l.amount < 0 && (pat.test(l.memo || '') || pat.test(l.name || '')));
    const charged = new Map();
    for (const [k, g] of groupSorted(ch, l => ymKey(l.date))) charged.set(k, npRound(-kahanSum(g.map(x => x.amount)), 2));
    const billed = new Map();
    for (const [, m, a] of this.billed) billed.set(m, (billed.get(m) || 0) + a);
    const months = [...new Set([...charged.keys(), ...billed.keys()])].sort(cmpv);
    let start = null;
    for (const m of months) {
      const c = charged.get(m) || 0;
      if (c && Math.abs((billed.get(m) || 0) - c) / c <= tol) { start = m; break; }
    }
    for (const m of months) {
      const c = charged.has(m) ? charged.get(m) : 0.0;
      const b = pyRound(billed.get(m) || 0.0, 2);
      const d = pyRound(c - b, 2);
      let st;
      if (start === null || m < start) st = 'Before recharge pattern (info)';
      else if (Math.abs(d) <= Math.max(tol * c, 1)) st = 'OK';
      else {
        st = 'GAP - check';
        this.flagAccountLevel('G3 Recharge check', Math.abs(d) >= 100 ? 'Medium' : 'Low',
          `${m}: ${cfg.label} charged ${fmtComma(c, 2)} but hours billed ${fmtComma(b, 2)} (difference ${fmtComma(d, 2)})`,
          `Since ${start} ${cfg.label} charges have matched hours billed to the related companies (${[...this.related].sort().join(', ')}). This month does not: either hours are not yet billed or a charge belongs to ${this.company || 'the main company'}.`,
          { amount: d, source: 'Recharge check', type_label: '(recharge)', name: cfg.label });
      }
      this.recharge_rows.push({ month: m, charged: c, hours_billed: b, difference: d, status: st });
    }
    if (start) this.notes.push(`${cfg.label} recharge: charges and hours billed matched from ${start}; earlier months are shown as information only.`);
  }

  checkCashPayees() {
    const cashRule = this.rules.keyword_rules.find(r => r.action === 'review');
    if (!cashRule) return;
    const pat = pyRegex(cashRule.pattern, 'i');
    const td = this.td;
    const w = td.filter(l => l.acct_type === 'Bank' && l.amount < 0 && (pat.test(l.memo || '') || (cashRule.names || []).includes(l.name)));
    const payees = this.payeeRows ? loadPayeeList(this.payeeRows) : null;
    if (this.payeeRows && !payees.length) this.notes.push('Payee list was supplied but no rows could be read - check its column headings (date, amount, payee, 1099).');
    const used = new Set(); const matched = new Set();
    for (const r of w) {
      const amt = pyRound(-r.amount, 2);
      let pay = '', f1099 = '', status = 'No payee list uploaded';
      if (this.acct.petty_cash_split && r.split === this.acct.petty_cash_split) status = `Moved to ${this.acct.petty_cash_split} (petty cash)`;
      else if (payees !== null) {
        const cand = [];
        payees.forEach((p, i) => { if (!used.has(i) && Math.abs(p.amount - amt) <= 0.01 && (p.date === null || Math.abs(dayDiff(p.date, r.date)) <= 7)) cand.push(i); });
        if (cand.length) {
          let bi = cand[0], bk = null;
          for (const i of cand) { const k = payees[i].date !== null ? Math.abs(dayDiff(payees[i].date, r.date)) : 0; if (bk === null || k < bk) { bk = k; bi = i; } }
          used.add(bi);
          pay = payees[bi].payee; f1099 = payees[bi].f1099; status = 'Matched to payee list';
          matched.add(r.date.getTime() + '|' + amt);
        } else status = 'NOT on payee list';
      }
      this.cash_rows.push({ date: r.date, amount: amt, bank_memo: r.memo, expensed_to: r.split, payee: pay, form_1099: f1099, status });
    }
    if (payees !== null) {
      this.flags = this.flags.filter(f => !(f.check.startsWith('E7') && f.date && f.amount !== null && matched.has(f.date.getTime() + '|' + pyRound(f.amount, 2))));
      for (const f of this.flags) if (f.check.startsWith('E7')) f.detail = (f.detail || '') + ' | Not found on the uploaded payee list.';
    }
  }

  buildChecklist() {
    const rows = [];
    const add = (area, issue, lines, amount, where) => rows.push({ area, issue, lines, amount, where_to_look: where, status: 'Open', reviewer_notes: '' });
    const fl = this.flags;
    const absSum = g => pyRound(npSum(g.map(x => (x.amount === null ? NaN : Math.abs(x.amount)))), 2);
    const grp = (rid, area, issue, where) => {
      const g = fl.filter(f => f.rule_id === rid);
      if (g.length) add(area, issue, g.length, absSum(g), where);
    };
    for (const ru of this.rules.keyword_rules || []) if (ru.checklist) grp(ru.id, ru.checklist.area, ru.checklist.text, ru.checklist.where);
    let g = fl.filter(f => f.check.startsWith('D1') && SEV_RANK[f.severity] >= 2);
    if (g.length) add('Duplicates', 'Exact duplicate transactions - confirm against bank and delete the extra', g.length, absSum(g), "Tab 'Duplicates'");
    g = fl.filter(f => f.check.startsWith('G1'));
    if (g.length) add('Allocation', `${(this.rules.upwork || {}).label || 'Contractor'} hours billed to an entity that is not allowed for that worker`, g.length, absSum(g), 'Exceptions: Check G1');
    for (const x of fl.filter(f => f.check.startsWith('G2') || f.check.startsWith('G3'))) add((this.rules.upwork || {}).label || 'Recharge', x.issue, 1, x.amount, "Tabs 'Recharge Check' / 'Allocation'");
    const famRows = new Map();
    for (const r of this.recon) if (r.status === 'MISMATCH' && ['F5', 'F6', 'F7', 'F8', 'F2', 'F3', 'F4', 'F1', 'F0'].includes(r.check.slice(0, 2))) { const k = r.check; if (!famRows.has(k)) famRows.set(k, []); famRows.get(k).push(r); }
    for (const [k, rows] of famRows) add('Reconciliation', `${k}: ${rows.length} difference(s). ${rows[0].note || ''} (first: ${rows[0].item}). Often caused by reports exported on different days - re-export together.`, rows.length, rows.reduce((a2, r) => a2 + Math.abs(r.difference || 0), 0), "Tab 'Reconciliation'");
    for (const c of this.new_related || []) {
      add('Checkpoint', `New related company found in the books: "${c}". Confirm it is a related company and add it to the related-company list (rules) so allocation and recharge checks include it.`, null, null, 'Page: "New related companies" / rules.json related_parties');
    }
    this.checkpoint_rows = [];
    for (const n of this.rules.review_notes || []) {
      const hit = n.name ? this.td.filter(l => (l.name || '').toLowerCase().includes(n.name.toLowerCase())) : [];
      for (const l of hit) this.checkpoint_rows.push({ checkpoint: n.name, date: l.date, type: l.type, num: l.num, name: l.name, memo: l.memo, account: l.account, amount: l.amount });
      if (hit.length || !n.name) add('Checkpoint', n.message, hit.length, hit.length ? pyRound(npSum(hit.map(l => Math.abs(l.amount))), 2) : null, n.where || "Tab 'Checkpoints'");
    }
    this.checklist = rows;
  }

  safe(name, fn) {
    try { fn.call(this); this.run_log.push({ step: name, status: 'OK', message: '' }); }
    catch (e) { this.run_log.push({ step: name, status: 'ERROR - skipped', message: `${e.pyName || e.name}: ${e.message}` }); }
  }

  computeBasis() {
    const th = this.th;
    const basis = new Map();
    for (const r of this.target) {
      const b = [];
      if (this.rule_matched_ids.has(r.id)) b.push('rule');
      const fam = VENDOR_OR_DEPOSIT.has(r.type) ? 'v' : 'c';
      if (r.name && fam === 'v') { const h = this.hist_name_v.get(r.name); if (h && h.n >= th.history_min_txns) b.push('history'); }
      if (fam === 'c' && r.memo && r.memo.includes(' - ')) { const h = this.hist_sig.get(memoSignature(r.memo)); if (h && h.n >= th.history_min_txns_memo) b.push('history'); }
      if (r.type === 'General Journal') b.push('journal-logic');
      basis.set(r.id, b.length ? b.join('+') : 'none');
    }
    this.basis = basis;
  }

  run() {
    this.load();
    const S = (n, f) => this.safe(n, f);
    S('build history', this.buildHistory);
    S('build name index', this.buildNameIndex);
    S('detect related parties', this.detectRelatedParties);
    S('net +/- pairs', this.computeNetPairs);
    S('A. completeness', this.checkCompleteness);
    S('B1/C3 keyword rules', this.checkKeywordRules);
    S('B3 approved vendors', this.checkApprovedVendors);
    S('B2 history', this.checkHistory);
    S('B4-B6 account hygiene', this.checkAccountHygiene);
    S('C. names', this.checkNames);
    S('D. duplicates', this.checkDuplicates);
    S('E. unusual items', this.checkUnusual);
    S('G1/G2 allocation', this.checkAllocation);
    S('G3 recharge', this.checkUpworkRecharge);
    S('E7 cash withdrawals / payee list', this.checkCashPayees);
    S('F. reconciliations', this.checkReconciliations);
    S('apply netting', this.applyNetting);
    S('routine items', this.applyRoutine);
    S('learn how this company books rule matches', this.applyRuleLearning);
    if (this.approved_ok.size) this.flags = this.flags.filter(f => !this.approved_ok.has(f.line_id) || ['D1', 'D2', 'D3'].includes(f.check.slice(0, 2)));
    S('make weak flags optional', this.refineSeverity);
    S('basis / coverage', this.computeBasis);
    S('review queue', this.buildQueue);
    S('review checklist', this.buildChecklist);
    this.inputNotes();
    return this;
  }

  inputNotes() {
    for (const [k, lab] of [['pl', 'P&L detail'], ['bs', 'Balance sheet detail'], ['tb', 'Trial balance'], ['ar', 'AR aging'], ['ap', 'AP aging']]) {
      if (!this.rowsByRole[k]) this.notes.push(`${lab} not supplied - the related tie-out checks were skipped (the review still ran).`);
    }
    const lo = this.period[0];
    if (!(lo.getUTCMonth() + 1 === 1 && lo.getUTCDate() <= 5)) this.notes.push(`Reports start ${isoDate(lo)}, not January 1 - 'same as older entries' history is limited to this window. Use a full year-to-date export for best results.`);
    if (!this.payeeRows) this.notes.push("No cash/1099 payee list supplied - see tab 'Cash & 1099' for the withdrawals that need payees.");
  }
}

/** Run the whole review. rowsByRole: {td,gl,pl,bs,tb,ar,ap} row arrays; payeeRows optional row array. */
export function runReview({ rowsByRole, rules, payeeRows, company } = {}) {
  const rv = new Review(rowsByRole, rules, payeeRows);
  rv.company = company || '';
  return rv.run();
}
export { Review, PyError };
