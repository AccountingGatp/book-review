(() => {
  // src/engine.js
  var SEV_RANK = { High: 3, Medium: 2, Low: 1, Info: 0 };
  var RANK_SEV = { 3: "High", 2: "Medium", 1: "Low", 0: "Info" };
  var VENDOR_TYPES = /* @__PURE__ */ new Set(["Check", "Credit Card Charge", "Bill", "Credit", "Credit Card Credit", "Item Receipt", "Bill Pmt -Check"]);
  var CUSTOMER_TYPES = /* @__PURE__ */ new Set(["Invoice", "Payment", "Credit Memo"]);
  var MULTILINE_TYPES = /* @__PURE__ */ new Set(["Invoice", "General Journal", "Credit Memo", "Bill", "Payment", "Credit", "Item Receipt"]);
  var VENDOR_OR_DEPOSIT = /* @__PURE__ */ new Set([...VENDOR_TYPES, "Deposit"]);
  var STOP = /* @__PURE__ */ new Set([
    "inc",
    "llc",
    "ltd",
    "co",
    "corp",
    "the",
    "and",
    "of",
    "company",
    "limited",
    "usa",
    "com",
    "www",
    "group",
    "services",
    "service",
    "store",
    "enterprises",
    "pos",
    "sig",
    "visa",
    "purchase"
  ]);
  var NAME_STOP = /* @__PURE__ */ new Set(["inc", "llc", "ltd", "co", "corp", "limited", "the"]);
  var PyError = class extends Error {
    constructor(name, msg) {
      super(msg);
      this.pyName = name;
    }
  };
  function pyRegex(pattern, flags = "") {
    let p = pattern;
    let fl = flags;
    const m = /^\(\?([aiLmsux]+)\)/.exec(p);
    if (m) {
      p = p.slice(m[0].length);
      if (m[1].includes("i") && !fl.includes("i")) fl += "i";
      if (m[1].includes("m") && !fl.includes("m")) fl += "m";
      if (m[1].includes("s") && !fl.includes("s")) fl += "s";
    }
    p = p.replace(/\(\?P</g, "(?<").replace(/\(\?P=(\w+)\)/g, "\\k<$1>").replace(/\\Z/g, "$").replace(/\\A/g, "^");
    return new RegExp(p, fl);
  }
  var PYWS = "[\\t\\n\\v\\f\\r \\u001c-\\u001f\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
  var PYWS_RE = new RegExp("^" + PYWS + "+|" + PYWS + "+$", "g");
  var pyStrip = (s) => s.replace(PYWS_RE, "");
  function nz(s) {
    if (s === null || s === void 0) return "";
    if (typeof s === "number") return Number.isNaN(s) ? "" : String(s);
    if (s instanceof Date) return isoDate(s) + " 00:00:00";
    return String(s);
  }
  var pyS = (x) => x === null || x === void 0 ? "None" : x instanceof Date ? isoDate(x) : String(x);
  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }
  var pad2 = (n) => String(n).padStart(2, "0");
  function ymKey(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1);
  }
  var DAY = 864e5;
  var dayDiff = (a, b) => Math.floor((a.getTime() - b.getTime()) / DAY);
  function mkDate(y, m, d) {
    if (!(y >= 1677 && y <= 2262)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }
  function fmtFixed(x, d) {
    if (x === null || x === void 0) return "None";
    if (Number.isNaN(x)) return "nan";
    if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
    const neg = x < 0 || Object.is(x, -0);
    const ax = Math.abs(x);
    let out;
    if (ax >= 1e21) {
      out = BigInt(ax).toString() + (d > 0 ? "." + "0".repeat(d) : "");
      return (neg ? "-" : "") + out;
    }
    const s = ax.toFixed(Math.min(100, d + 45));
    const dot = s.indexOf(".");
    const frac = s.slice(dot + 1);
    if (frac[d] === "5" && /^0*$/.test(frac.slice(d + 1))) {
      const trunc = d > 0 ? s.slice(0, dot + 1 + d) : s.slice(0, dot);
      const last = trunc[trunc.length - 1];
      if ((last.charCodeAt(0) - 48) % 2 === 0) out = trunc;
      else out = ax.toFixed(d);
    } else out = ax.toFixed(d);
    return (neg ? "-" : "") + out;
  }
  function fmtComma(x, d) {
    const s = fmtFixed(x, d);
    if (!/^-?\d/.test(s)) return s;
    const neg = s[0] === "-";
    const body = neg ? s.slice(1) : s;
    const [i, f] = body.split(".");
    const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + ii + (f !== void 0 ? "." + f : "");
  }
  var pct0 = (x) => fmtFixed(x * 100, 0) + "%";
  function pyRound(x, d = 2) {
    if (x === null || x === void 0 || !Number.isFinite(x)) return x;
    const r = Number(fmtFixed(x, d));
    return r;
  }
  function rint(x) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff < 0.5) return f;
    if (diff > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }
  function npRound(x, d = 2) {
    if (x === null || x === void 0 || !Number.isFinite(x)) return x;
    const p = 10 ** d;
    return rint(x * p) / p;
  }
  function pairwise(a, lo, n) {
    if (n < 8) {
      let res = 0;
      for (let i = 0; i < n; i++) res += a[lo + i];
      return res;
    }
    if (n <= 128) {
      const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
      let i;
      for (i = 8; i < n - n % 8; i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
      let res = r[0] + r[1] + (r[2] + r[3]) + (r[4] + r[5] + (r[6] + r[7]));
      for (; i < n; i++) res += a[lo + i];
      return res;
    }
    let n2 = Math.floor(n / 2);
    n2 -= n2 % 8;
    return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
  }
  function npSum(arr) {
    const a = arr.map((v) => v === null || v === void 0 || Number.isNaN(v) ? 0 : v);
    return pairwise(a, 0, a.length);
  }
  function kahanSum(arr) {
    let s = 0, c = 0;
    for (const v of arr) {
      if (v === null || v === void 0 || Number.isNaN(v)) continue;
      const y = v - c;
      const t = s + y;
      c = t - s - y;
      s = t;
    }
    return s;
  }
  function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const n = a.length;
    if (n === 0) return NaN;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }
  function pyTitle(s) {
    let out = "";
    let prevCased = false;
    for (const ch of s) {
      const cased = ch.toLowerCase() !== ch.toUpperCase();
      if (cased) {
        out += prevCased ? ch.toLowerCase() : ch.toUpperCase();
        prevCased = true;
      } else {
        out += ch;
        prevCased = false;
      }
    }
    return out;
  }
  function pyReprStr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let o = s.replace(/\\/g, "\\\\");
    if (q === "'") o = o.replace(/'/g, "\\'");
    o = o.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    return q + o + q;
  }
  function pyReprNum(x) {
    return Number.isInteger(x) ? x.toFixed(1) : String(x);
  }
  var cmpv = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function valueCounts(values) {
    const m = /* @__PURE__ */ new Map();
    for (const v of values) m.set(v, (m.get(v) || 0) + 1);
    const arr = [...m.entries()];
    const idx = new Map(arr.map((e, i) => [e[0], i]));
    arr.sort((a, b) => b[1] - a[1] || idx.get(a[0]) - idx.get(b[0]));
    return arr;
  }
  var Dist = class {
    constructor(vc, n) {
      this.items = vc;
      this.n = n;
      this.map = new Map(vc);
    }
    get(k) {
      return this.map.get(k) || 0;
    }
  };
  function groupSorted(rows, keyFn) {
    const m = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (k === null || k === void 0) continue;
      let a = m.get(k);
      if (!a) {
        a = [];
        m.set(k, a);
      }
      a.push(r);
    }
    return [...m.entries()].sort((a, b) => cmpv(a[0], b[0]));
  }
  function groupKeyed(rows, keyFn, cmp) {
    const m = /* @__PURE__ */ new Map();
    for (const r of rows) {
      const [id, tup] = keyFn(r);
      let e = m.get(id);
      if (!e) {
        e = { tup, rows: [] };
        m.set(id, e);
      }
      e.rows.push(r);
    }
    return [...m.values()].sort((a, b) => cmp(a.tup, b.tup));
  }
  var cmpNullLast = (a, b) => {
    const an = a === null || a === void 0, bn = b === null || b === void 0;
    if (an || bn) return an && bn ? 0 : an ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  var cmpTuple = (a, b) => {
    for (let i = 0; i < a.length; i++) {
      const c = cmpNullLast(a[i], b[i]);
      if (c) return c;
    }
    return 0;
  };
  function seqRatio(a, b) {
    const A = Array.from(a), B = Array.from(b);
    const la = A.length, lb = B.length;
    if (la + lb === 0) return 1;
    const b2j = /* @__PURE__ */ new Map();
    for (let i = 0; i < lb; i++) {
      let l = b2j.get(B[i]);
      if (!l) {
        l = [];
        b2j.set(B[i], l);
      }
      l.push(i);
    }
    if (lb >= 200) {
      const ntest = Math.floor(lb / 100) + 1;
      for (const [e, idx] of [...b2j.entries()]) if (idx.length > ntest) b2j.delete(e);
    }
    const findLongest = (alo, ahi, blo, bhi) => {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = /* @__PURE__ */ new Map();
      for (let i = alo; i < ahi; i++) {
        const nj = /* @__PURE__ */ new Map();
        const lst = b2j.get(A[i]);
        if (lst) {
          for (const j of lst) {
            if (j < blo) continue;
            if (j >= bhi) break;
            const k = (j2len.get(j - 1) || 0) + 1;
            nj.set(j, k);
            if (k > bestsize) {
              besti = i - k + 1;
              bestj = j - k + 1;
              bestsize = k;
            }
          }
        }
        j2len = nj;
      }
      while (besti > alo && bestj > blo && A[besti - 1] === B[bestj - 1]) {
        besti--;
        bestj--;
        bestsize++;
      }
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
    return 2 * matches / (la + lb);
  }
  function normKey(pathList) {
    let parts = pathList.map((p) => pyStrip(p));
    if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === parts[parts.length - 2].toLowerCase() + " - other") parts = parts.slice(0, -1);
    return parts.join(" > ");
  }
  var isNum = (v) => typeof v === "number";
  function toFloat(v) {
    if (v === null || v === void 0 || v === 0 || v === "" || v === false) return 0;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = v.trim().replace(/_/g, "");
      if (t === "" || !/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf(inity)?|nan)$/i.test(t)) throw new PyError("ValueError", `could not convert string to float: ${pyReprStr(v)}`);
      return Number(t.replace(/^([+-]?)inf(inity)?$/i, "$1Infinity").replace(/^[+-]?nan$/i, "NaN"));
    }
    throw new PyError("TypeError", "float() argument must be a string or a real number");
  }
  function parseDetail(rows, label) {
    let hdr = null, cols = {};
    const NAMES = ["Type", "Date", "Num", "Name", "Memo", "Class", "Clr", "Split", "Amount", "Balance"];
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const s = rows[i].map((c) => c !== null && c !== void 0 ? pyStrip(nz(c)) : "");
      if (s.includes("Type") && s.includes("Date") && s.includes("Amount")) {
        hdr = i;
        cols = {};
        for (const n of NAMES) if (s.includes(n)) cols[n] = s.indexOf(n);
        break;
      }
    }
    if (hdr === null) throw new PyError("ValueError", `${label}: could not find the header row (Type/Date/Amount)`);
    const tcol = cols.Type;
    const lines = [];
    const meta = /* @__PURE__ */ new Map();
    let cur = [];
    const setMeta = (key, k, v) => {
      let m = meta.get(key);
      if (!m) {
        m = {};
        meta.set(key, m);
      }
      m[k] = v;
    };
    const hasBal = "Balance" in cols;
    for (let ri = hdr + 1; ri < rows.length; ri++) {
      const ridx = ri + 1;
      const r = rows[ri];
      const get = (i) => i < r.length ? r[i] : null;
      const t = get(tcol), d = get(cols.Date);
      if (t !== null && t !== void 0 && d instanceof Date) {
        const levels = cur.filter((x) => x[0] < tcol).map((x) => x[1]);
        if (!levels.length) continue;
        const g = (n) => n in cols ? get(cols[n]) : null;
        const account = normKey(levels);
        const sp = account.split(" > ");
        lines.push({
          src: label,
          src_row: ridx,
          type: pyStrip(nz(t)),
          date: d,
          num: g("Num"),
          name: g("Name"),
          memo: g("Memo"),
          cls: g("Class"),
          split: g("Split"),
          amount: toFloat(g("Amount")),
          balance: g("Balance"),
          path: levels,
          account,
          leaf: sp[sp.length - 1]
        });
      } else {
        for (let l = 0; l < tcol; l++) {
          const v = get(l);
          if (v === null || v === void 0) continue;
          const lab = pyStrip(nz(v));
          if (lab.startsWith("Total ")) {
            const key = normKey(cur.filter((x) => x[0] <= l).map((x) => x[1]));
            setMeta(key, "total_amt", get(cols.Amount));
            setMeta(key, "total_bal", hasBal ? get(cols.Balance) : null);
            cur = cur.filter((x) => x[0] < l);
          } else {
            cur = cur.filter((x) => x[0] < l);
            cur.push([l, lab]);
            const key = normKey(cur.map((x) => x[1]));
            if (hasBal && get(cols.Balance) !== null && get(cols.Balance) !== void 0 && (get(cols.Amount) === null || get(cols.Amount) === void 0)) setMeta(key, "open_bal", get(cols.Balance));
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
      if (c !== null && c !== void 0 && !isNum(c)) return pyStrip(nz(c));
    }
    return null;
  }
  function parseTb(rows) {
    const out = /* @__PURE__ */ new Map();
    for (const r0 of rows) {
      const r = [...r0, null, null, null, null, null, null];
      const lab = firstLabel(r);
      const nums = r.slice(2, 6).filter(isNum);
      if (lab && lab.toUpperCase() !== "TOTAL" && nums.length) {
        const deb = isNum(r[2]) ? r[2] : 0;
        const cre = isNum(r[3]) ? r[3] : 0;
        out.set(lab.replace(/:/g, " > "), deb - cre);
      } else if (lab && lab.toUpperCase() === "TOTAL") {
        out.set("__TOTAL_DEBIT__", Number(r[2] || 0));
        out.set("__TOTAL_CREDIT__", Number(r[3] || 0));
      }
    }
    return out;
  }
  function parseAging(rows) {
    const out = /* @__PURE__ */ new Map();
    for (const r0 of rows) {
      const r = [...r0, null, null, null, null, null, null, null, null, null];
      const lab = firstLabel(r);
      if (lab && isNum(r[7])) {
        out.set(lab, { current: r[2] || 0, b1_30: r[3] || 0, b31_60: r[4] || 0, b61_90: r[5] || 0, over90: r[6] || 0, total: r[7] || 0 });
      }
    }
    return out;
  }
  function accountTypeFromPath(e) {
    if (!e || !e.length) return null;
    if (e[0] === "Ordinary Income/Expense") {
      if (e.length > 1 && e[1] === "Income") return "Income";
      if (e.length > 1 && e[1] === "Cost of Goods Sold") return "COGS";
      return "Expense";
    }
    if (e[0] === "Other Income/Expense") return e.length > 1 && e[1] === "Other Income" ? "OtherIncome" : "OtherExpense";
    if (e[0] === "ASSETS") {
      if (e.length > 2 && e[1] === "Current Assets") return { "Checking/Savings": "Bank", "Accounts Receivable": "AR" }[e[2]] || "OtherAsset";
      return "FixedAsset";
    }
    if (e[0].startsWith("LIABILITIES")) {
      if (e.length > 3 && e[2] === "Current Liabilities") return { "Accounts Payable": "AP", "Credit Cards": "CreditCard" }[e[3]] || "Liability";
      if (e.length > 1 && e[1] === "Equity") return "Equity";
      return "Liability";
    }
    return null;
  }
  function normName(s) {
    let x = nz(s).toLowerCase();
    x = x.replace(/[^a-z0-9 ]+/g, " ");
    return x.split(/\s+/).filter((t) => t && !NAME_STOP.has(t)).join(" ");
  }
  function tokens(s, minlen = 3) {
    const out = [];
    const m = nz(s).toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const t of m) {
      if (STOP.has(t)) continue;
      if (t.length >= minlen || /^\d+$/.test(t) && t.length >= 2) out.push(t);
    }
    return out;
  }
  function sevAdjust(base, amount, th) {
    let r = SEV_RANK[base];
    if (base === "Info") return base;
    const a = Math.abs(amount);
    if (a >= th.high_amount) r = Math.min(3, r + 1);
    else if (a < th.tiny_amount) r = Math.max(1, r - 1);
    return RANK_SEV[r];
  }
  function memoSignature(memo) {
    let m = nz(memo);
    if (m.includes(" - ")) m = m.split(" - ")[0];
    m = pyStrip(m).toLowerCase().replace(/\d+(\.\d+)?/g, "#");
    return Array.from(m).slice(0, 60).join("");
  }
  function skuPrefix(memo) {
    const m = pyStrip(nz(memo));
    if (m.includes(" - ")) {
      const sku = m.split(" - ")[0];
      if (/^[A-Za-z0-9]+-/.test(sku)) return sku.split("-")[0].toUpperCase();
    }
    return null;
  }
  var REF_RE = /(?=[A-Z0-9*]*\d)(?=[A-Z0-9*]*[A-Z])[A-Z0-9*]{7,}/g;
  var findRefs = (s) => s ? s.match(REF_RE) || [] : [];
  var IGNORE_MEMO = /landed cost|vendor deposit|shipping - shipping fee|^FB:/i;
  var BANKY = /(purchase|pos sig|pos deb|visa|checkcard|\*)/i;
  function merchantGuess(memo) {
    let m = nz(memo);
    m = m.replace(/^\s*(purchase|pos sig|pos deb|checkcard|recurring)\s*\d{0,2}\/?\d{0,2}\s*/i, "");
    m = m.replace(/visa\s*#?\d+/gi, " ");
    m = m.replace(/[*#]+/g, " ");
    const words = (m.match(/[A-Za-z][A-Za-z'&.\-]+/g) || []).filter((w) => w.length > 2);
    return words.length ? pyTitle(words.slice(0, 3).join(" ")) : "";
  }
  var namesSorted = (x) => {
    const keyed = x.map((s) => [nz(s).toLowerCase(), s]);
    keyed.sort((a, b) => cmpv(a[0], b[0]));
    return keyed.map((k) => k[1]);
  };
  function parseLooseDate(v) {
    if (v === null || v === void 0) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    if (typeof v === "number") return new Date(v / 1e6);
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
    if (m) return mkDate(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s);
    if (m) {
      let a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) [a, b] = [b, a];
      return mkDate(+m[3], a, b);
    }
    m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return mkDate(+m[3], mo, +m[2]);
    }
    return null;
  }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function loadPayeeList(rows) {
    let hdr = null;
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const labs2 = rows[i].map((c) => c !== null && c !== void 0 ? pyStrip(nz(c)).toLowerCase() : "");
      const joined = labs2.join(" ");
      if (labs2.filter((x) => x).length >= 2 && ["amount", "payee", "vendor", "1099", "paid"].some((k) => joined.includes(k))) {
        hdr = i;
        break;
      }
    }
    if (hdr === null) return [];
    const labs = rows[hdr].map((c) => c !== null && c !== void 0 ? pyStrip(nz(c)).toLowerCase() : "");
    const find = (...keys) => {
      for (let j = 0; j < labs.length; j++) if (keys.some((k) => labs[j].includes(k))) return j;
      return null;
    };
    const cd = find("date"), ca = find("amount", "withdraw", "paid", "total"), cp = find("payee", "vendor", "contractor", "worker", "name"), cf = find("1099");
    if (ca === null) return [];
    const out = [];
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = [...rows[i], ...new Array(20).fill(null)];
      const raw = pyStrip(pyS(r[ca]).replace(/,/g, "").replace(/\$/g, ""));
      if (raw === "" || !/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?|inf(inity)?|nan)$/i.test(raw.replace(/_/g, ""))) continue;
      const amt = Number(raw.replace(/_/g, "").replace(/^([+-]?)inf(inity)?$/i, "$1Infinity").replace(/^[+-]?nan$/i, "NaN"));
      const d = cd !== null && r[cd] !== null && r[cd] !== void 0 ? parseLooseDate(r[cd]) : null;
      out.push({ date: d, amount: pyRound(Math.abs(amt), 2), payee: cp !== null ? nz(r[cp]) : "", f1099: cf !== null ? nz(r[cf]) : "" });
    }
    return out;
  }
  var Review = class _Review {
    constructor(rowsByRole, rules, payeeRows) {
      this.rowsByRole = rowsByRole;
      this.rules = rules;
      this.th = rules.thresholds;
      this.payeeRows = payeeRows || null;
      this.flags = [];
      this.recon = [];
      this.notes = [];
      this.run_log = [];
      this.hist_name_v = /* @__PURE__ */ new Map();
      this.hist_name_c = /* @__PURE__ */ new Map();
      this.hist_sig = /* @__PURE__ */ new Map();
      this.hist_pre_cust = /* @__PURE__ */ new Map();
      this.inv_pre = [];
      this.name_master_rows = [];
      this.basis = /* @__PURE__ */ new Map();
      this.rule_ok_ids = /* @__PURE__ */ new Set();
      this.rule_matched_ids = /* @__PURE__ */ new Set();
      this.approved_ok = /* @__PURE__ */ new Set();
      this.alloc_rows = [];
      this.recharge_rows = [];
      this.cash_rows = [];
      this.checklist = [];
      this.related = /* @__PURE__ */ new Set();
      this.names = [];
      this.cust = /* @__PURE__ */ new Set();
      this.vend = /* @__PURE__ */ new Set();
    }
    load() {
      const f = this.rowsByRole;
      for (const k of ["td", "gl"]) if (!f[k]) throw new PyError("SystemExit", `Missing required report: ${k}`);
      const tdp = parseDetail(f.td, "Transaction Detail");
      this.td = tdp.lines;
      this.td_meta = tdp.meta;
      const glp = parseDetail(f.gl, "General Ledger");
      this.gl = glp.lines;
      this.gl_meta = glp.meta;
      this.pl = this.bs = null;
      this.type_map = /* @__PURE__ */ new Map();
      const addTypes = (lines) => {
        const seen = /* @__PURE__ */ new Set();
        for (const l of lines) {
          const key = l.path.join("");
          if (seen.has(key)) continue;
          seen.add(key);
          const nk = normKey(l.path).split(" > ");
          this.type_map.set(nk[nk.length - 1], accountTypeFromPath(l.path));
        }
      };
      if (f.pl) {
        this.pl = parseDetail(f.pl, "P&L Detail").lines;
        addTypes(this.pl);
      }
      if (f.bs) {
        this.bs = parseDetail(f.bs, "Balance Sheet Detail").lines;
        addTypes(this.bs);
      }
      this.tb = f.tb ? parseTb(f.tb) : null;
      this.ar = f.ar ? parseAging(f.ar) : null;
      this.ap = f.ap ? parseAging(f.ap) : null;
      const FUND = /* @__PURE__ */ new Set(["Bank", "CreditCard", "AR", "AP"]);
      this.td.forEach((l, i) => {
        for (const c of ["name", "memo", "num", "cls", "split"]) {
          const v = pyStrip(nz(l[c]));
          l[c] = v || null;
        }
        let at = this.type_map.get(l.leaf);
        if (at === void 0 || at === null) at = "Other";
        l.acct_type = at;
        l.is_funding = FUND.has(at) || l.leaf === "Undeposited Funds";
        l.id = i;
      });
      let lo = this.td[0].date, hi = this.td[0].date;
      for (const l of this.td) {
        if (l.date < lo) lo = l.date;
        if (l.date > hi) hi = l.date;
      }
      this.period = [lo, hi];
      this.target = this.td.filter((l) => !l.is_funding);
    }
    flag(row, check2, baseSev, issue, detail = "", o = {}) {
      const amt = o.amount === void 0 || o.amount === null ? row.amount : o.amount;
      const adjust = o.adjust === void 0 ? true : o.adjust;
      const sev = adjust ? sevAdjust(baseSev, amt, this.th) : baseSev;
      this.flags.push({
        line_id: row.id,
        severity: sev,
        check: check2,
        issue,
        detail,
        date: row.date,
        type: row.type,
        num: row.num,
        name: row.name,
        memo: row.memo,
        account: row.account,
        cls: row.cls,
        split: row.split,
        amount: row.amount,
        suggested_account: o.sug_acct || "",
        suggested_name: o.sug_name || "",
        confidence: o.conf || "",
        source: `${row.src} r${row.src_row}`,
        rule_id: o.rule_id === void 0 ? null : o.rule_id
      });
    }
    flagAccountLevel(check2, sev, issue, detail, o = {}) {
      this.flags.push({
        line_id: -1,
        severity: sev,
        check: check2,
        issue,
        detail,
        date: null,
        type: o.type_label || "(account level)",
        num: null,
        name: o.name === void 0 ? null : o.name,
        memo: null,
        account: null,
        cls: null,
        split: null,
        amount: o.amount === void 0 ? null : o.amount,
        suggested_account: "",
        suggested_name: "",
        confidence: "",
        source: o.source || "Chart of accounts",
        rule_id: o.rule_id === void 0 ? null : o.rule_id
      });
    }
    // ---------------------------------------------------------------- A
    checkCompleteness() {
      const th = this.th;
      const LOWLEAF = /* @__PURE__ */ new Set(["Bank Service Charges", "Interest Expense", "Other Expense", "Other Income", "Credit Card Cash Rewards"]);
      for (const r of this.target) {
        if (r.type === "General Journal") {
          if (!r.memo && Math.abs(r.amount) >= th.journal_no_memo_min) this.flag(r, "A2 Missing memo", "Medium", "Manual journal with no description", "Journals must explain themselves.");
          continue;
        }
        if (!r.name && (VENDOR_TYPES.has(r.type) || CUSTOMER_TYPES.has(r.type) || r.type === "Deposit")) {
          const base = LOWLEAF.has(r.leaf) ? "Low" : "Medium";
          const sug = this.suggestNameFromMemo(r.memo);
          let sugName;
          if (sug) sugName = sug[0];
          else {
            const mg = BANKY.test(nz(r.memo)) ? merchantGuess(r.memo) : null;
            sugName = mg ? `(new?) ${mg}` : "";
          }
          this.flag(
            r,
            "A1 Missing name",
            base,
            "No vendor/customer name",
            "Name is blank on a posted transaction." + (sug ? ` Memo suggests: ${sug[0]}` : ""),
            { sug_name: sugName, conf: sug ? sug[1] : "Low" }
          );
        }
        if (!r.memo && VENDOR_OR_DEPOSIT.has(r.type) && Math.abs(r.amount) >= 100) this.flag(r, "A2 Missing memo", "Low", "No memo/description", "Blank memo on a transaction >= $100.");
      }
    }
    // ---------------------------------------------------------------- B
    static dist(rows, keyFn, valFn) {
      const out = /* @__PURE__ */ new Map();
      for (const [k, g] of groupSorted(rows, keyFn)) out.set(k, new Dist(valueCounts(g.map(valFn)), g.length));
      return out;
    }
    buildHistory() {
      const t = this.target;
      const v = t.filter((r) => VENDOR_OR_DEPOSIT.has(r.type));
      const c = t.filter((r) => CUSTOMER_TYPES.has(r.type));
      const leaf = (r) => r.leaf;
      this.hist_name_v = _Review.dist(v, (r) => r.name, leaf);
      this.hist_name_c = _Review.dist(c, (r) => r.name, leaf);
      const sigOf = (r) => typeof r.memo === "string" && r.memo.includes(" - ") ? memoSignature(r.memo) : null;
      this.hist_sig = _Review.dist(c, sigOf, leaf);
      const inv = t.filter((r) => r.type === "Invoice" || r.type === "Credit Memo").map((r) => ({ r, pre: skuPrefix(r.memo) }));
      this.inv_pre = inv.filter((x) => x.pre !== null && x.r.name !== null).map((x) => ({ ...x.r, pre: x.pre }));
      this.hist_pre_cust = _Review.dist(this.inv_pre, (r) => r.pre, (r) => r.name);
    }
    checkHistory() {
      const th = this.th;
      const ph = new Set(this.rules.placeholder_names);
      for (const r of this.target) {
        if (r.type === "General Journal") continue;
        const fam = VENDOR_OR_DEPOSIT.has(r.type) ? "v" : "c";
        if (this.rule_ok_ids.has(r.id)) continue;
        if (r.name && fam === "v" && !ph.has(r.name)) {
          const h = this.hist_name_v.get(r.name);
          if (h && h.n >= th.history_min_txns) {
            const [top, topn] = h.items[0];
            const n = h.n;
            const share = topn / n;
            const mine = h.get(r.leaf) / n;
            if (share >= th.history_dominance && r.leaf !== top && mine <= 0.15) {
              this.flag(
                r,
                "B2 Differs from history",
                "Medium",
                `"${r.name}" is normally posted to ${top}`,
                `${topn} of ${n} similar lines (${pct0(share)}) use "${top}"; this line uses "${r.leaf}" (${h.get(r.leaf)} of ${n}).`,
                { sug_acct: top, conf: `${pct0(share)} of ${n}` }
              );
            }
          }
        }
        if (fam === "c" && r.memo && r.memo.includes(" - ")) {
          const sig = memoSignature(r.memo);
          const h = this.hist_sig.get(sig);
          if (h && h.n >= th.history_min_txns_memo) {
            const [top, topn] = h.items[0];
            const n = h.n;
            const share = topn / n;
            const mine = h.get(r.leaf) / n;
            if (share >= th.history_dominance && r.leaf !== top && mine <= 0.15) {
              this.flag(
                r,
                "B2 Differs from history",
                "Medium",
                `Item "${sig}" is normally posted to ${top}`,
                `${topn} of ${n} lines with this item description use "${top}"; this one uses "${r.leaf}".`,
                { sug_acct: top, conf: `${pct0(share)} of ${n}` }
              );
            }
          }
        }
      }
    }
    checkKeywordRules() {
      const rules = this.rules.keyword_rules.map((ru) => ({ ...ru, _re: pyRegex(ru.pattern, "i") }));
      for (const r of this.target) {
        const name = nz(r.name), memo = nz(r.memo);
        const matches = [];
        for (const ru of rules) {
          if ("types" in ru && !ru.types.includes(r.type)) continue;
          if ((ru.types_exclude || []).includes(r.type)) continue;
          const text = ru.scope === "name" ? name : ru.scope === "memo" ? memo : `${name} | ${memo}`;
          if (!pyStrip(text) || !ru._re.test(text)) continue;
          matches.push(ru);
        }
        if (!matches.length) continue;
        this.rule_matched_ids.add(r.id);
        for (const ru of matches) {
          if (ru.action === "review") {
            if (ru.review_account_types.includes(r.acct_type) && Math.abs(r.amount) >= ru.min_amount) {
              this.flag(r, "E7 Needs support", ru.severity, "Cash withdrawal expensed without identified payee", ru.note, { conf: "Rule", rule_id: ru.id });
            }
            continue;
          }
          const exp = ru.expected;
          const ok = exp.includes(r.leaf) || exp.includes(r.account);
          if (ok) {
            this.rule_ok_ids.add(r.id);
            continue;
          }
          const satisfiedOther = matches.some((m) => m !== ru && m.action !== "review" && (m.expected.includes(r.leaf) || m.expected.includes(r.account)));
          if (satisfiedOther) {
            const others = matches.filter((m) => m !== ru && (m.expected || []).includes(r.leaf));
            if (!others.length) throw new PyError("IndexError", "list index out of range");
            const other = others[0];
            this.flag(
              r,
              "C3 Name vs memo conflict",
              "Medium",
              `Name/memo point to different accounts ("${ru.id}" vs "${other.id}")`,
              `${ru.note} | but memo also matches: ${other.note} Confirm which is right and that the vendor is correct.`,
              { sug_acct: exp[0], conf: "Rule conflict", rule_id: ru.id }
            );
          } else {
            this.flag(
              r,
              "B1 Account vs description",
              ru.severity,
              `Posted to "${r.leaf}" but description indicates: ${ru.note}`,
              `Expected one of: ${exp.slice(0, 4).join(", ")}${exp.length > 4 ? "..." : ""}`,
              { sug_acct: exp[0], conf: "Rule", rule_id: ru.id }
            );
          }
        }
      }
    }
    checkAccountHygiene() {
      const sus = new Set(this.rules.suspense_accounts);
      for (const r of this.target) {
        if (sus.has(r.leaf)) this.flag(
          r,
          "B5 Catch-all account",
          "Medium",
          `Posted to catch-all account "${r.leaf}"`,
          "Catch-all/clearing accounts should be empty at period end; reclassify to the real account.",
          { conf: "Policy" }
        );
      }
      for (const r of this.target) {
        if (r.type === "Invoice" && ["Expense", "COGS", "OtherExpense"].includes(r.acct_type) && r.amount !== 0) {
          this.flag(
            r,
            "B4 Type vs account",
            "Low",
            `Invoice line posted to expense account "${r.leaf}"`,
            "Customer invoice lines hitting expense accounts act as contra-expense (cost recharge). Confirm it is an intentional pass-through and not sales.",
            { conf: "Logic" }
          );
        }
        if (["Bill", "Check", "Credit Card Charge"].includes(r.type) && r.acct_type === "Income" && r.amount > 0) {
          this.flag(r, "B4 Type vs account", "High", `${r.type} posted to income account "${r.leaf}"`, "Vendor-type transaction increasing income.", { conf: "Logic" });
        }
      }
      for (const g of this.rules.similar_account_groups) {
        const used = [g.preferred, ...g.also].filter((a) => this.target.some((r) => r.leaf === a));
        if (used.length > 1) {
          this.flagAccountLevel("B6 Overlapping accounts", "Low", `Multiple accounts used for the same purpose: ${used.join(", ")}`, g.note + ` Preferred: "${g.preferred}".`);
          const usage = {};
          for (const a of used) usage[a] = this.target.filter((r) => r.leaf === a).length;
          let dominant = used[0];
          for (const a of used) if (usage[a] > usage[dominant]) dominant = a;
          for (const a of used) {
            if (a === dominant) continue;
            for (const r of this.target.filter((x) => x.leaf === a)) {
              if (r.type === "General Journal") continue;
              this.flag(
                r,
                "B6 Overlapping accounts",
                "Low",
                `Posted to "${a}"; most similar spend (${usage[dominant]} lines) is in "${dominant}"`,
                g.note,
                { sug_acct: dominant, conf: "Consistency", adjust: false }
              );
            }
          }
        }
      }
    }
    // ---------------------------------------------------------------- C
    buildNameIndex() {
      const seen = /* @__PURE__ */ new Set();
      const names = [];
      for (const l of this.td) if (l.name !== null && l.name !== void 0 && !seen.has(l.name)) {
        seen.add(l.name);
        names.push(l.name);
      }
      this.names = names;
      const tokmap = /* @__PURE__ */ new Map();
      for (const n of names) for (const tk of new Set(tokens(n))) {
        let s = tokmap.get(tk);
        if (!s) {
          s = /* @__PURE__ */ new Set();
          tokmap.set(tk, s);
        }
        s.add(n);
      }
      this.alias_full = /* @__PURE__ */ new Map();
      for (const n of names) {
        const k = normName(n);
        if (k.length >= 4) this.alias_full.set(k, n);
      }
      this.alias_full_list = [...this.alias_full.entries()].map(([full, n]) => [full, n, full.length]);
      this.alias_tok = /* @__PURE__ */ new Map();
      for (const [tk, v] of tokmap) if (v.size === 1 && tk.length >= 5) this.alias_tok.set(tk, [...v][0]);
      this.cust = new Set(this.td.filter((l) => CUSTOMER_TYPES.has(l.type) && l.name !== null).map((l) => l.name));
      this.vend = new Set(this.td.filter((l) => VENDOR_TYPES.has(l.type) && l.name !== null).map((l) => l.name));
    }
    suggestNameFromMemo(memo) {
      const m = normName(memo);
      if (!m) return null;
      let best = null;
      for (const [full, n, len] of this.alias_full_list) {
        let found = false;
        let from = 0;
        while (true) {
          const i = m.indexOf(full, from);
          if (i < 0) break;
          const e = i + full.length;
          if ((i === 0 || m[i - 1] === " ") && (e === m.length || m[e] === " ")) {
            found = true;
            break;
          }
          from = i + 1;
        }
        if (found && (best === null || len > best[2])) best = [n, "High", len];
      }
      if (best) return [best[0], best[1]];
      const mt = new Set(tokens(memo));
      const hits = [];
      for (const t of mt) if (this.alias_tok.has(t)) hits.push(this.alias_tok.get(t));
      if (hits.length) {
        const c = /* @__PURE__ */ new Map();
        for (const h of hits) c.set(h, (c.get(h) || 0) + 1);
        let bestk = null, bestc = -1;
        for (const [k, v] of c) if (v > bestc) {
          bestk = k;
          bestc = v;
        }
        return [bestk, "Medium"];
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
        if (["Check", "Credit Card Charge", "Bill", "Credit Card Credit"].includes(r.type) && this.cust.has(name) && !this.vend.has(name)) {
          this.flag(
            r,
            "C1 Customer/vendor mix-up",
            "Medium",
            `Customer name "${name}" used on a ${r.type}`,
            "This name only appears as a customer elsewhere. If this is a refund/recharge it is fine; otherwise the payee is wrong.",
            { conf: "Role" }
          );
        }
        if ((r.type === "Invoice" || r.type === "Credit Memo") && this.vend.has(name) && !this.cust.has(name)) {
          this.flag(r, "C1 Customer/vendor mix-up", "Medium", `Vendor name "${name}" used on a ${r.type}`, "This name only appears as a vendor elsewhere.", { conf: "Role" });
        }
        const memo = nz(r.memo);
        if (["Check", "Credit Card Charge", "Deposit"].includes(r.type) && Array.from(memo).length >= 15 && BANKY.test(memo) && !ph.has(name)) {
          const nt = tokens(name);
          const mn = normName(memo);
          const mt = tokens(memo);
          const ok = !nt.length || nt.some((tk) => mn.includes(tk)) || nt.some((tk) => mt.some((m) => seqRatio(tk, m) >= 0.85));
          if (!ok) {
            const alt = this.suggestNameFromMemo(memo);
            if (alt && normName(alt[0]) !== normName(name)) {
              this.flag(r, "C2 Name vs memo", "Medium", `Name "${name}" not found in memo; memo mentions "${alt[0]}"`, `Memo: ${Array.from(memo).slice(0, 90).join("")}`, { sug_name: alt[0], conf: alt[1] });
            } else {
              const g = merchantGuess(memo);
              this.flag(r, "C2 Name vs memo", "Low", `Name "${name}" does not appear in the bank memo`, `Memo looks like merchant "${g}". Confirm the payee.`, { sug_name: g ? `(check) ${g}` : "", conf: "Low" });
            }
          }
        }
      }
      for (const [pre, h] of this.hist_pre_cust) {
        const n = h.n;
        const c0 = h.items[0][1];
        if (n >= 8 && c0 / n >= 0.9 && h.items.length >= 1 && c0 < n) {
          const top = h.items[0][0];
          for (const r of this.inv_pre.filter((x) => x.pre === pre && x.name !== top)) {
            this.flag(
              r,
              "C4 Customer vs product",
              "Medium",
              `Product family "${pre}-" is almost always sold to "${top}"`,
              `${c0} of ${n} lines were billed to ${top}; this one is billed to "${r.name}".`,
              { sug_name: top, conf: `${pct0(c0 / n)} of ${n}` }
            );
          }
        }
      }
      this.name_master_rows = [];
      const usage = /* @__PURE__ */ new Map();
      for (const l of this.td) {
        if (l.name === null) continue;
        let u = usage.get(l.name);
        if (!u) {
          u = { lines: 0, first: l.date, last: l.date, abs: [] };
          usage.set(l.name, u);
        }
        u.lines++;
        if (l.date < u.first) u.first = l.date;
        if (l.date > u.last) u.last = l.date;
        u.abs.push(Math.abs(l.amount));
      }
      const accsBy = /* @__PURE__ */ new Map();
      for (const [k, g] of groupSorted(this.target, (r) => r.name)) {
        accsBy.set(k, valueCounts(g.map((r) => r.leaf)).slice(0, 4).map(([a, c]) => `${a} (${c})`).join(", "));
      }
      const nl = namesSorted(this.names);
      const similar = /* @__PURE__ */ new Map();
      const addSim = (a, b) => {
        let l = similar.get(a);
        if (!l) {
          l = [];
          similar.set(a, l);
        }
        l.push(b);
      };
      const keys = nl.map((a) => normName(a).replace(/[^a-z0-9]/g, ""));
      for (let i = 0; i < nl.length; i++) {
        const ka = keys[i];
        for (let j = i + 1; j < nl.length; j++) {
          const kb = keys[j];
          if (ka.length < 5 || kb.length < 5) continue;
          let sim = ka === kb;
          if (!sim) {
            const la = ka.length, lb = kb.length;
            if (2 * Math.min(la, lb) / (la + lb) < th.near_dup_name_ratio) continue;
            sim = seqRatio(ka, kb) >= th.near_dup_name_ratio && !kb.includes(ka);
          }
          if (sim) {
            addSim(nl[i], nl[j]);
            addSim(nl[j], nl[i]);
          }
        }
      }
      for (const n of nl) {
        const notes = [];
        if (/\s{2,}|^\s|\s$/.test(n)) notes.push("extra spaces in name");
        if (ph.has(n)) notes.push("placeholder/generic name - real payee unknown");
        if (this.cust.has(n) && this.vend.has(n)) notes.push("used as BOTH customer and vendor");
        const sim = similar.get(n);
        if (sim && sim.length) notes.push("similar to: " + sim.join("; "));
        const role = this.cust.has(n) && !this.vend.has(n) ? "Customer" : this.vend.has(n) && !this.cust.has(n) ? "Vendor" : this.cust.has(n) ? "Both" : "Other";
        const u = usage.get(n);
        this.name_master_rows.push({ name: n, role, lines: u.lines, gross_amount: npRound(npSum(u.abs), 2), first_used: u.first, last_used: u.last, accounts_used: accsBy.get(n) || "", notes: notes.join("; "), basis: "" });
        if (sim && sim.length || /\s{2,}/.test(n)) {
          this.flags.push({
            line_id: -1,
            severity: "Low",
            check: "C5 Similar names",
            issue: `Possible duplicate / inconsistent name: "${n}"`,
            detail: sim && sim.length ? "Similar to: " + sim.join("; ") : "Extra spaces in name (breaks lookups/matching).",
            date: null,
            type: "(name list)",
            num: null,
            name: n,
            memo: null,
            account: null,
            cls: null,
            split: null,
            amount: null,
            suggested_account: "",
            suggested_name: n.replace(/\s+/g, " ").trim(),
            confidence: "",
            source: "Name list",
            rule_id: null
          });
        }
      }
    }
    // ---------------------------------------------------------------- D
    checkDuplicates() {
      const t = this.target.filter((r) => r.type !== "General Journal").map((r) => ({ r, amt: npRound(r.amount, 2), mkey: (r.memo || "").toLowerCase().replace(/\s+/g, " ") }));
      const ph = new Set(this.rules.placeholder_names);
      const seen = /* @__PURE__ */ new Set();
      const groups = groupKeyed(t, (x) => {
        const tup = [x.r.type, x.r.date.getTime(), x.r.name, x.amt === 0 ? 0 : x.amt, x.r.leaf, x.mkey];
        return [JSON.stringify(tup), tup];
      }, cmpTuple);
      for (const gg of groups) {
        const k = gg.tup;
        const grp = gg.rows.map((x) => x.r);
        if (grp.length < 2 || k[3] === 0) continue;
        if (MULTILINE_TYPES.has(k[0])) {
          const nums = new Set(grp.filter((r) => r.num !== null).map((r) => String(r.num)));
          if (nums.size < 2) continue;
          if (k[2] !== null && ph.has(k[2])) continue;
        }
        const refs = findRefs(grp[0].memo || "");
        const sev = refs.length || Math.abs(k[3]) >= 1e3 ? "High" : "Medium";
        for (const r of grp) {
          this.flag(
            r,
            "D1 Exact duplicate",
            sev,
            `Identical transaction appears ${grp.length}x`,
            "Same date, name, amount, account and memo" + (refs.length ? ` (same bank reference ${refs[0]})` : "") + `. Other copies at source rows: ${grp.filter((x) => x.src_row !== r.src_row).map((x) => x.src_row).join(", ")}.`,
            { conf: "Exact", adjust: false }
          );
        }
        for (const r of grp) seen.add(r.id);
      }
      const th = this.th;
      const p = t.filter((x) => ["Check", "Credit Card Charge", "Bill", "Deposit"].includes(x.r.type) && x.r.name !== null && Math.abs(x.amt) >= th.probable_dup_min_amount);
      const pg = groupKeyed(p, (x) => {
        const tup = [x.r.name, x.amt === 0 ? 0 : x.amt, x.r.leaf];
        return [JSON.stringify(tup), tup];
      }, cmpTuple);
      for (const gg of pg) {
        if (gg.rows.length < 2) continue;
        const rows = gg.rows.map((x) => x.r).sort((a, b) => a.date - b.date);
        for (let i = 0; i < rows.length - 1; i++) {
          const a = rows[i], b = rows[i + 1];
          const dd = dayDiff(b.date, a.date);
          if (!(dd > 0 && dd <= th.probable_dup_days) || seen.has(a.id) || seen.has(b.id)) continue;
          const ra = new Set(findRefs(a.memo || "")), rb = new Set(findRefs(b.memo || ""));
          if (ra.size && rb.size && !(ra.size === rb.size && [...ra].every((x) => rb.has(x)))) continue;
          const r = this.td[b.id];
          this.flag(
            r,
            "D2 Probable duplicate",
            ph.has(gg.tup[0]) ? "Low" : "Medium",
            `Same payee/amount/account ${dd} day(s) after another`,
            `Earlier: ${isoDate(a.date)} (row ${a.src_row}), this: ${isoDate(b.date)}. Check the bank statement - one may be double-posted.`,
            { conf: "Pattern" }
          );
        }
      }
      const d = t.map((x) => x.r).filter((r) => r.num !== null && ["Invoice", "Credit Memo", "Bill"].includes(r.type) && /^\d{3,}$/.test(String(r.num)));
      const dg = groupKeyed(d, (r) => {
        const tup = [r.type, String(r.num)];
        return [JSON.stringify(tup), tup];
      }, cmpTuple);
      for (const gg of dg) {
        const grp = gg.rows;
        const nm = [];
        const s = /* @__PURE__ */ new Set();
        for (const r of grp) if (r.name !== null && !s.has(r.name)) {
          s.add(r.name);
          nm.push(r.name);
        }
        if (nm.length > 1) {
          const [ty, num] = gg.tup;
          this.flag(grp[0], "D3 Number reused", "High", `${ty} number ${num} used by different names`, `Names: ${nm.join(", ")}`, { conf: "Exact", adjust: false });
        }
      }
    }
    // ---------------------------------------------------------------- E
    checkUnusual() {
      const th = this.th;
      const t = this.target;
      for (const r of t) {
        if (r.type === "General Journal") continue;
        if (["Check", "Credit Card Charge", "Bill"].includes(r.type) && ["Expense", "COGS"].includes(r.acct_type) && r.amount < 0 && !IGNORE_MEMO.test(nz(r.memo))) {
          this.flag(r, "E5 Negative expense", "Low", "Credit/negative amount on an expense line", "Refund or reversal? Confirm and make sure it hits the same account as the original.", { conf: "Logic" });
        }
        if (["Check", "Credit Card Charge", "Bill", "Invoice"].includes(r.type) && r.amount === 0 && !["AR", "AP"].includes(r.acct_type)) {
          this.flag(r, "E5 Zero amount", "Low", "Zero-dollar line", "Zero lines add noise; remove unless needed.", { conf: "Logic", adjust: false });
        }
        if (["Check", "Credit Card Charge"].includes(r.type) && r.amount >= th.round_amount_min && r.amount % 100 === 0 && r.name !== "Cash Withdrawals") {
          this.flag(r, "E2 Round amount", "Low", `Round-dollar payment $${fmtComma(r.amount, 0)}`, "Large round amounts are worth checking to an invoice/contract.", { conf: "Pattern", adjust: false });
        }
      }
      const v = t.filter((r) => ["Check", "Credit Card Charge", "Bill"].includes(r.type) && r.name !== null && r.amount > 0 && ["Expense", "COGS", "OtherExpense"].includes(r.acct_type));
      const og = groupKeyed(v, (r) => {
        const tup = [r.name, r.leaf];
        return [JSON.stringify(tup), tup];
      }, cmpTuple);
      for (const gg of og) {
        const g = gg.rows;
        const [n, a] = gg.tup;
        if (g.length < th.outlier_min_txns) continue;
        const med = median(g.map((r) => r.amount));
        if (med <= 0) continue;
        for (const r of g.filter((x) => x.amount > med * th.outlier_multiple && x.amount >= th.outlier_min_amount)) {
          this.flag(
            r,
            "E1 Amount outlier",
            "Medium",
            `$${fmtComma(r.amount, 2)} is ${fmtFixed(r.amount / med, 1)}x the usual for ${n} / ${a}`,
            `Median of ${g.length} similar lines is $${fmtComma(med, 2)}.`,
            { conf: `${fmtFixed(r.amount / med, 1)}x median` }
          );
        }
      }
      const RE1 = /(?:purchase|pos sig|pos deb|checkcard)\s+(\d{2})\/(\d{2})\b/i;
      const RE2 = /pay period.*?([A-Za-z]{3})\w*\s+(\d{1,2}),?\s*(\d{4})\s*[-–]\s*([A-Za-z]{3})\w*\s+(\d{1,2}),?\s*(\d{4})/i;
      const RE3 = /PR check date\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/;
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
              if (dd < -1) this.flag(r, "E4 Date vs memo", "Medium", "Booked BEFORE the purchase date in the memo", `Memo says purchase ${pad2(mo)}/${pad2(da)}, transaction dated ${isoDate(r.date)}.`, { conf: "Date logic" });
              else if (dd > th.memo_date_late_days) this.flag(r, "E4 Date vs memo", "Low", `Booked ${dd} days after purchase date in memo`, `Memo says purchase ${pad2(mo)}/${pad2(da)}, transaction dated ${isoDate(r.date)}.`, { conf: "Date logic" });
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
              this.flag(
                r,
                "E4 Date vs memo",
                "Medium",
                "Pay period in memo does not match transaction date",
                `Pay period ends ${isoDate(end)}, paid ${isoDate(r.date)} (${diff} days). Likely a year/date typo in the memo.`,
                { conf: "Date logic" }
              );
            }
          }
        }
        m = RE3.exec(memo);
        if (m && r.type === "General Journal") {
          const pc = parseLooseDate(m[1]);
          if (pc && Math.abs(dayDiff(r.date, pc)) > th.pr_date_tolerance_days) {
            this.flag(r, "E4 Date vs memo", "Medium", "Journal date differs from payroll check date in memo", `Memo date ${isoDate(pc)} vs journal ${isoDate(r.date)}.`, { conf: "Date logic" });
          }
        }
      }
      const rv = t.filter((r) => r.name !== null && !["General Journal", "Invoice", "Payment"].includes(r.type) && Math.abs(r.amount) >= 1e3 && !IGNORE_MEMO.test(r.memo || ""));
      const rg = groupKeyed(rv, (r) => {
        const a = npRound(Math.abs(r.amount), 2);
        const tup = [r.name, a];
        return [JSON.stringify(tup), tup];
      }, cmpTuple);
      for (const gg of rg) {
        const g = gg.rows;
        const [n, a] = gg.tup;
        if (g.length >= 2 && g.some((x) => x.amount > 0) && g.some((x) => x.amount < 0)) {
          for (const r of g) this.flag(
            r,
            "E6 Reversal pair",
            "Info",
            `Offsetting entries for ${n} $${fmtComma(a, 2)}`,
            "A debit and credit of the same size exist: confirm the pair is intentional and not a mis-posting + correction left in the books.",
            { conf: "Pattern", adjust: false }
          );
        }
      }
    }
    // ---------------------------------------------------------------- F
    rec(check2, item, expected, actual, note = "") {
      const diff = expected === null || expected === void 0 || actual === null || actual === void 0 ? null : pyRound(actual - expected, 2);
      const status = diff === null ? "n/a" : Math.abs(diff) <= this.th.tolerance ? "OK" : "MISMATCH";
      this.recon.push({ check: check2, item, expected: expected === void 0 ? null : expected, actual: actual === void 0 ? null : actual, difference: diff, status, note });
    }
    checkReconciliations() {
      const td = this.td, gl = this.gl;
      const tol = this.th.tolerance;
      const tdSum = npSum(td.map((l) => l.amount)), glSum = npSum(gl.map((l) => l.amount));
      this.rec("F0 Ledger balances", "Transaction Detail total activity (should be 0.00)", 0, npRound(tdSum, 2));
      this.rec("F0 Ledger balances", "General Ledger total activity (should be 0.00)", 0, npRound(glSum, 2));
      this.rec("F0 Ledger balances", "GL activity vs Transaction Detail activity (all accounts)", npRound(tdSum, 2), npRound(glSum, 2));
      this.rec("F0 Ledger balances", "Number of lines: GL vs Transaction Detail", td.length, gl.length);
      const sumBy = (rows, kf) => new Map(groupSorted(rows, kf).map(([k, g]) => [k, kahanSum(g.map((x) => x.amount))]));
      const glAct = sumBy(gl, (l) => l.account), tdAct = sumBy(td, (l) => l.account);
      const allAcct = [.../* @__PURE__ */ new Set([...glAct.keys(), ...tdAct.keys()])].sort(cmpv);
      for (const acct of allAcct) {
        const a = glAct.has(acct) ? glAct.get(acct) : 0, b = tdAct.has(acct) ? tdAct.get(acct) : 0;
        if (Math.abs(a - b) > tol) this.rec("F1 GL vs Transaction Detail", acct, npRound(b, 2), npRound(a, 2), "Same account has different activity in the two reports");
      }
      const glEnd = /* @__PURE__ */ new Map();
      for (const [k, g] of groupSorted(gl, (l) => l.account)) {
        let last = NaN;
        for (const l of g) if (l.balance !== null && l.balance !== void 0 && !Number.isNaN(l.balance)) last = Number(l.balance);
        glEnd.set(k, last);
      }
      for (const [acct, m] of this.gl_meta) {
        if ("open_bal" in m && glAct.has(acct) && glEnd.has(acct)) {
          const exp = npRound(m.open_bal + glAct.get(acct), 2);
          const act = pyRound(Number(glEnd.get(acct)), 2);
          if (Math.abs(exp - act) > tol) this.rec("F1 GL roll-forward", acct, exp, act, "Opening balance + activity <> ending running balance");
        }
      }
      if (this.tb && this.tb.size) {
        for (const k of ["__TOTAL_DEBIT__", "__TOTAL_CREDIT__"]) if (!this.tb.has(k)) throw new PyError("KeyError", `'${k}'`);
        this.rec("F2 Trial balance", "Total debits vs total credits", this.tb.get("__TOTAL_DEBIT__"), this.tb.get("__TOTAL_CREDIT__"));
        const tbk = new Map([...this.tb].filter(([k]) => !k.startsWith("__")));
        const tbkeys = [...tbk.keys()];
        const tbkey = (acct) => {
          let best = null;
          for (const k of tbkeys) if (acct === k || acct.startsWith(k + " > ")) {
            if (best === null || k.length > best.length) best = k;
          }
          return best;
        };
        const endByTb = /* @__PURE__ */ new Map();
        for (const [acct, bal] of glEnd) {
          const k = tbkey(acct);
          const key = k || "(no TB account) " + acct;
          endByTb.set(key, (endByTb.get(key) || 0) + bal);
        }
        let bad = 0;
        for (const [k, v] of tbk) {
          const e = pyRound(endByTb.has(k) ? endByTb.get(k) : 0, 2);
          if (Math.abs(e - v) > tol) {
            if (!endByTb.has(k) && Math.abs(e) <= tol) {
              this.rec("F2 TB balances with no 2026 activity", k, pyRound(v, 2), null, "No GL activity in the period, so balance is brought forward: agree it to last period's closing balance.");
            } else {
              this.rec("F2 TB vs GL ending balance", k, pyRound(v, 2), e, "Trial balance and GL disagree for this account");
              bad++;
            }
          }
        }
        for (const [k, val] of endByTb) {
          if (k.startsWith("(no TB account)") && Math.abs(val) > tol) this.rec("F2 TB vs GL ending balance", k, 0, pyRound(val, 2), "Account in GL has no trial-balance line");
        }
        if (bad === 0) this.rec("F2 TB vs GL ending balance", `All ${tbk.size} trial-balance accounts agree with GL ending balances`, 0, 0);
        for (const [k, v] of tbk) {
          const sp = k.split(" > ");
          const leaf = sp[sp.length - 1];
          const ty = this.type_map.get(leaf);
          if ((ty === "Income" || ty === "OtherIncome") && v > tol) this.rec("F7 Abnormal balance", k, null, v, "Income account has a DEBIT balance");
          if ((ty === "Expense" || ty === "COGS" || ty === "OtherExpense") && v < -tol) this.rec("F7 Abnormal balance", k, null, v, "Expense account has a CREDIT balance");
          if ((ty === "Liability" || ty === "AP" || ty === "CreditCard") && v > tol) this.rec("F7 Abnormal balance", k, null, v, "Liability account has a DEBIT balance");
          if ((ty === "Bank" || ty === "AR" || ty === "OtherAsset") && v < -tol) this.rec("F7 Abnormal balance", k, null, v, "Asset account has a CREDIT balance");
        }
        for (const s of this.rules.suspense_accounts) {
          for (const [k, v] of tbk) {
            const sp = k.split(" > ");
            if (sp[sp.length - 1] === s && Math.abs(v) > tol) this.rec("F6 Catch-all balance", k, 0, pyRound(v, 2), "Catch-all / clearing account should be zero at period end");
          }
        }
        for (const [k, v] of tbk) {
          const kids = tbkeys.filter((x) => x.startsWith(k + " > "));
          if (kids.length && Math.abs(v) > tol) {
            let kidSum = 0;
            for (const x of kids) kidSum += tbk.get(x);
            this.rec("F8 Parent account balance", k, null, v, `Parent account holds a balance of ${fmtComma(v, 2)} directly while it has ${kids.length} sub-accounts (sub-account total ${fmtComma(kidSum, 2)}). Re-post to the sub-accounts.`);
          }
        }
      }
      if (this.pl) this.cmpReports(this.pl, "F3 P&L Detail vs Transaction Detail", /* @__PURE__ */ new Set(["Income", "COGS", "Expense", "OtherIncome", "OtherExpense"]));
      if (this.bs) this.cmpReports(this.bs, "F4 Balance Sheet Detail vs Transaction Detail", /* @__PURE__ */ new Set(["Bank", "AR", "OtherAsset", "FixedAsset", "AP", "CreditCard", "Liability", "Equity"]));
      if (this.tb && this.tb.size) {
        const tbk = new Map([...this.tb].filter(([k]) => !k.startsWith("__")));
        if (this.ar && this.ar.size) {
          const tot = this.ar.has("TOTAL") ? this.ar.get("TOTAL").total : void 0;
          this.rec(
            "F5 AR aging vs control account",
            "AR aging total vs Accounts Receivable (trial balance)",
            pyRound(tbk.has("Accounts Receivable") ? tbk.get("Accounts Receivable") : 0, 2),
            tot !== void 0 ? pyRound(tot, 2) : null,
            "Difference usually = unapplied payments/credits, a bad A/R entry, or an aging report run on a different date."
          );
        }
        if (this.ap && this.ap.size) {
          const tot = this.ap.has("TOTAL") ? this.ap.get("TOTAL").total : void 0;
          this.rec(
            "F5 AP aging vs control account",
            "AP aging total vs Accounts Payable (trial balance)",
            pyRound(-(tbk.has("Accounts Payable") ? tbk.get("Accounts Payable") : 0), 2),
            tot !== void 0 ? pyRound(tot, 2) : null,
            "Difference usually = unapplied vendor credits/payments or an entry posted straight to A/P."
          );
        }
      }
      const tdNames = new Set(td.filter((l) => l.name !== null).map((l) => pyStrip(l.name)));
      for (const [label, ag] of [["AR", this.ar], ["AP", this.ap]]) {
        if (!ag || !ag.size) continue;
        for (const [n, b] of ag) {
          if (n === "TOTAL") continue;
          if (!tdNames.has(pyStrip(n)) && Math.abs(b.total) > 0) this.rec(`F5 ${label} aging names`, n, null, b.total, "Name on aging report is not found in the 2026 ledger lines (spelling/space difference or old balance).");
          if (b.over90 && Math.abs(b.over90) > 0) this.rec(`F5 ${label} aged > 90 days`, n, null, b.over90, "Balance older than 90 days - collectability / payment follow-up.");
          if (b.b61_90 && Math.abs(b.b61_90) > 0) this.rec(`F5 ${label} aged 61-90`, n, null, b.b61_90, "Balance 61-90 days old.");
        }
      }
    }
    cmpReports(rep, label, types) {
      const td = this.td;
      const tdSub = td.filter((l) => types.has(l.acct_type));
      const sumBy = (rows) => new Map(groupSorted(rows, (l) => l.leaf).map(([k, g]) => [k, npRound(kahanSum(g.map((x) => x.amount)), 2)]));
      const repSum = sumBy(rep), tdSum = sumBy(tdSub);
      const leaves = [.../* @__PURE__ */ new Set([...repSum.keys(), ...tdSum.keys()])].sort(cmpv);
      for (const leaf of leaves) {
        const a = repSum.has(leaf) ? repSum.get(leaf) : 0, b = tdSum.has(leaf) ? tdSum.get(leaf) : 0;
        if (Math.abs(a - b) > this.th.tolerance && Math.abs(a + b) > this.th.tolerance) this.rec(label, leaf, b, a, "Account total differs between the two reports");
      }
      if (rep.length !== tdSub.length) this.rec(label, "Line count", tdSub.length, rep.length, "Different number of lines between reports");
      const keyf = (rows) => {
        const c = /* @__PURE__ */ new Map();
        for (const l of rows) {
          const tup = [isoDate(l.date), l.type, pyStrip(nz(l.num)), pyStrip(nz(l.name)), npRound(Math.abs(l.amount), 2), l.leaf];
          const k = JSON.stringify(tup);
          const e = c.get(k);
          if (e) e.n++;
          else c.set(k, { n: 1, tup });
        }
        return c;
      };
      const k1 = keyf(tdSub), k2 = keyf(rep);
      const sub = (a, b) => {
        const out = [];
        for (const [k, e] of a) {
          const n = e.n - (b.has(k) ? b.get(k).n : 0);
          if (n > 0) out.push([e.tup, n]);
        }
        return out;
      };
      const miss1 = sub(k1, k2), miss2 = sub(k2, k1);
      const reprTup = (tup) => "(" + tup.map((x) => typeof x === "string" ? pyReprStr(x) : pyReprNum(x)).join(", ") + ")";
      const tot = (m) => m.reduce((s, x) => s + x[1], 0);
      if (!miss1.length && !miss2.length) {
        let n = 0;
        for (const e of k1.values()) n += e.n;
        this.rec(label, `All ${n} lines match line-for-line (date, type, num, name, amount, account)`, 0, 0);
      } else {
        this.rec(label, "Lines in Transaction Detail missing from this report", 0, tot(miss1), miss1.slice(0, 3).map((x) => reprTup(x[0])).join("; "));
        this.rec(label, "Lines in this report missing from Transaction Detail", 0, tot(miss2), miss2.slice(0, 3).map((x) => reprTup(x[0])).join("; "));
      }
    }
    // ---------------------------------------------------------------- G
    detectRelatedParties() {
      const cfg = this.rules.related_parties || {};
      const keys = new Set(cfg.names || []);
      const cfgKeys = [...keys];
      const auto = /* @__PURE__ */ new Set();
      if (cfg.auto_detect !== false) {
        const accts = [];
        const s = /* @__PURE__ */ new Set();
        for (const l of this.td) if (!s.has(l.account)) {
          s.add(l.account);
          accts.push(l.account);
        }
        for (const a of accts) {
          const parts = a.split(" > ");
          const last = parts[parts.length - 1];
          let m = /^to\/from\s+(.+)$/i.exec(last);
          if (m) {
            keys.add(pyStrip(m[1]));
            auto.add(pyStrip(m[1]));
          }
          m = /^(.+?)\s+card$/i.exec(last);
          if (m && parts.length > 1) {
            keys.add(pyStrip(m[1]));
            auto.add(pyStrip(m[1]));
          }
        }
      }
      const rel = /* @__PURE__ */ new Set();
      for (const n of this.names) {
        const nt = new Set(normName(n).split(/\s+/).filter(Boolean));
        for (const k of keys) {
          const kt = new Set(normName(k).split(/\s+/).filter(Boolean));
          if (kt.size && [...kt].every((x) => nt.has(x))) rel.add(n);
        }
      }
      this.related = rel;
      this.related_keys = [...keys].sort(cmpv);
      const tk = (x) => new Set(normName(x).split(/\s+/).filter(Boolean));
      const known = cfgKeys.map(tk);
      this.new_related = [...auto].filter((a) => {
        const t = tk(a);
        return t.size && !known.some((k) => k.size && ([...k].every((x) => t.has(x)) || [...t].every((x) => k.has(x))));
      }).sort(cmpv);
      this.notes.push("Related parties detected from the reports: " + ([...rel].sort(cmpv).join(", ") || "none"));
    }
    checkApprovedVendors() {
      const appr = /* @__PURE__ */ new Map();
      for (const [k, v] of Object.entries(this.rules.approved_vendor_accounts || {})) appr.set(normName(k), v);
      if (!appr.size) return;
      for (const r of this.target) {
        const exp = r.name ? appr.get(normName(r.name)) : null;
        if (!exp || !exp.length) continue;
        this.rule_matched_ids.add(r.id);
        if (exp.includes(r.leaf) || exp.includes(r.account)) {
          this.rule_ok_ids.add(r.id);
          this.approved_ok.add(r.id);
        } else this.flag(r, "B3 Approved vendor account", "Medium", `"${r.name}" is approved only for: ${exp.join(", ")}`, `Posted to "${r.leaf}".`, { sug_acct: exp[0], conf: "Approved list" });
      }
    }
    checkAllocation() {
      const rules = this.rules.allocation_rules || [];
      this.alloc_rows = [];
      this.billed = [];
      if (!rules.length) return;
      const td = this.td;
      const ar = td.filter((l) => (l.type === "Invoice" || l.type === "Credit Memo") && l.acct_type === "AR");
      const th = ((this.rules.upwork || {}).split_drift_points ?? 15) / 100;
      for (const ru of rules) {
        const pat = pyRegex(ru.memo_pattern, "i");
        const allowed = ru.allowed_entities;
        const sub = ar.filter((l) => pat.test(l.memo || ""));
        const by = /* @__PURE__ */ new Map();
        const addBy = (m, e, v) => {
          const k = m + "" + e;
          const x = by.get(k);
          if (x) x.v += v;
          else by.set(k, { m, e, v });
        };
        for (const r of sub) {
          const nt = new Set(normName(r.name).split(/\s+/).filter(Boolean));
          const ent = allowed.find((a) => {
            const at = normName(a).split(/\s+/).filter(Boolean);
            return at.every((x) => nt.has(x));
          }) ?? null;
          const m = ymKey(r.date);
          addBy(m, ent || `OTHER: ${pyS(r.name)}`, r.amount);
          this.billed.push([r.id, m, r.amount]);
          if (ent === null) {
            this.flag(
              r,
              "G1 Allocation",
              "Medium",
              `${ru.worker} hours billed to "${pyS(r.name)}" - not an allowed entity`,
              `${ru.note} Allowed: ${allowed.join(", ")}.`,
              { sug_name: allowed.join(" / "), conf: "Allocation rule" }
            );
          }
        }
        const entries = [...by.values()];
        const months = [...new Set(entries.map((x) => x.m))].sort(cmpv);
        const monthTot = (m) => {
          let s = 0;
          for (const x of entries) if (x.m === m) s += x.v;
          return s;
        };
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
            const e0 = by.get(m + "" + allowed[0]);
            const sh = tot ? (e0 ? e0.v : 0) / tot : 0;
            let hs = 0;
            for (const h of hist) hs += h;
            const avg = hist.length ? hs / hist.length : 0;
            if (hist.length >= 2 && Math.abs(sh - avg) > th) {
              this.flagAccountLevel(
                "G2 Split drift",
                "Medium",
                `${ru.worker}: ${allowed[0]} share in ${m} is ${pct0(sh)} vs usual ${pct0(avg)}`,
                `Earlier months averaged ${pct0(avg)} to ${allowed[0]}. Confirm the split for ${m} is intended.`,
                { source: "Allocation", type_label: "(allocation)", name: ru.worker }
              );
            }
            if (sh > 0) hist.push(sh);
          }
        }
      }
    }
    checkUpworkRecharge() {
      const cfg = this.rules.upwork;
      this.recharge_rows = [];
      if (!cfg || !(this.billed && this.billed.length) && !(this.rules.allocation_rules && this.rules.allocation_rules.length)) return;
      const tol = cfg.tolerance_pct ?? 0.05;
      const pat = pyRegex(cfg.charge_memo_pattern, "i");
      const ch = this.td.filter((l) => ["Bank", "CreditCard"].includes(l.acct_type) && l.amount < 0 && (pat.test(l.memo || "") || pat.test(l.name || "")));
      const charged = /* @__PURE__ */ new Map();
      for (const [k, g] of groupSorted(ch, (l) => ymKey(l.date))) charged.set(k, npRound(-kahanSum(g.map((x) => x.amount)), 2));
      const billed = /* @__PURE__ */ new Map();
      for (const [, m, a] of this.billed) billed.set(m, (billed.get(m) || 0) + a);
      const months = [.../* @__PURE__ */ new Set([...charged.keys(), ...billed.keys()])].sort(cmpv);
      let start = null;
      for (const m of months) {
        const c = charged.get(m) || 0;
        if (c && Math.abs((billed.get(m) || 0) - c) / c <= tol) {
          start = m;
          break;
        }
      }
      for (const m of months) {
        const c = charged.has(m) ? charged.get(m) : 0;
        const b = pyRound(billed.get(m) || 0, 2);
        const d = pyRound(c - b, 2);
        let st;
        if (start === null || m < start) st = "Before recharge pattern (info)";
        else if (Math.abs(d) <= Math.max(tol * c, 1)) st = "OK";
        else {
          st = "GAP - check";
          this.flagAccountLevel(
            "G3 Upwork recharge",
            Math.abs(d) >= 100 ? "Medium" : "Low",
            `${m}: Upwork charged ${fmtComma(c, 2)} but hours billed ${fmtComma(b, 2)} (difference ${fmtComma(d, 2)})`,
            `Since ${start} Upwork charges have matched hours billed to LXP/Crysp. This month does not: either hours are not yet billed or a charge belongs to Bluntd.`,
            { amount: d, source: "Upwork recharge", type_label: "(recharge)", name: "UPWORK" }
          );
        }
        this.recharge_rows.push({ month: m, upwork_charged: c, hours_billed: b, difference: d, status: st });
      }
      if (start) this.notes.push(`Upwork recharge: charges and hours billed matched from ${start}; earlier months are shown as information only.`);
    }
    checkCashPayees() {
      const cashRule = this.rules.keyword_rules.find((r) => r.action === "review");
      if (!cashRule) return;
      const pat = pyRegex(cashRule.pattern, "i");
      const td = this.td;
      const w = td.filter((l) => l.acct_type === "Bank" && l.amount < 0 && (pat.test(l.memo || "") || l.name === "Cash Withdrawals"));
      const payees = this.payeeRows ? loadPayeeList(this.payeeRows) : null;
      if (this.payeeRows && !payees.length) this.notes.push("Payee list was supplied but no rows could be read - check its column headings (date, amount, payee, 1099).");
      const used = /* @__PURE__ */ new Set();
      const matched = /* @__PURE__ */ new Set();
      for (const r of w) {
        const amt = pyRound(-r.amount, 2);
        let pay = "", f1099 = "", status = "No payee list uploaded";
        if (r.split === "Cash Account") status = "Moved to Cash Account (petty cash)";
        else if (payees !== null) {
          const cand = [];
          payees.forEach((p, i) => {
            if (!used.has(i) && Math.abs(p.amount - amt) <= 0.01 && (p.date === null || Math.abs(dayDiff(p.date, r.date)) <= 7)) cand.push(i);
          });
          if (cand.length) {
            let bi = cand[0], bk = null;
            for (const i of cand) {
              const k = payees[i].date !== null ? Math.abs(dayDiff(payees[i].date, r.date)) : 0;
              if (bk === null || k < bk) {
                bk = k;
                bi = i;
              }
            }
            used.add(bi);
            pay = payees[bi].payee;
            f1099 = payees[bi].f1099;
            status = "Matched to payee list";
            matched.add(r.date.getTime() + "|" + amt);
          } else status = "NOT on payee list";
        }
        this.cash_rows.push({ date: r.date, amount: amt, bank_memo: r.memo, expensed_to: r.split, payee: pay, form_1099: f1099, status });
      }
      if (payees !== null) {
        this.flags = this.flags.filter((f) => !(f.check.startsWith("E7") && f.date && f.amount !== null && matched.has(f.date.getTime() + "|" + pyRound(f.amount, 2))));
        for (const f of this.flags) if (f.check.startsWith("E7")) f.detail = (f.detail || "") + " | Not found on the uploaded payee list.";
      }
    }
    buildChecklist() {
      const rows = [];
      const add = (area, issue, lines, amount, where) => rows.push({ area, issue, lines, amount, where_to_look: where, status: "Open", reviewer_notes: "" });
      const fl = this.flags;
      const absSum = (g2) => pyRound(npSum(g2.map((x) => x.amount === null ? NaN : Math.abs(x.amount))), 2);
      const grp = (rid, area, issue, where) => {
        const g2 = fl.filter((f) => f.rule_id === rid);
        if (g2.length) add(area, issue, g2.length, absSum(g2), where);
      };
      grp("auto_loan_mercedes", "Account", "Mercedes-Benz Financial payments posted to Bank Service Charges - should reduce the Mercedes loan", "Exceptions: Check B1");
      grp("finance_charge", "Account", "Card finance charges posted to Bank Service Charges - should be Interest Expense", "Exceptions: Check B1");
      grp("payroll_words", "Account", "Payroll journals ('Direct deposit employees') posted to Commissions - highlight and reclassify", "Exceptions: Check B1");
      grp("merchant_processor", "Account", "Card-processor (Greenlight) deposits/fees in Other Income or Bank Service Charges", "Exceptions: Check B1");
      grp("cash_expensed", "Support", "Cash withdrawals expensed to labor with no identified payee (1099/payroll support)", "Tab 'Cash & 1099'");
      let g = fl.filter((f) => f.check.startsWith("D1"));
      if (g.length) add("Duplicates", "Exact duplicate transactions - confirm against bank and delete the extra", g.length, absSum(g), "Tab 'Duplicates'");
      g = fl.filter((f) => f.check.startsWith("G1"));
      if (g.length) add("Allocation", "Upwork hours billed to an entity that is not allowed for that worker", g.length, absSum(g), "Exceptions: Check G1");
      for (const x of fl.filter((f) => f.check.startsWith("G2") || f.check.startsWith("G3"))) add("Upwork", x.issue, 1, x.amount, "Tab 'Upwork Recharge' / 'Upwork Allocation'");
      for (const r of this.recon) {
        if (r.status === "MISMATCH" && ["F5", "F6", "F7", "F8", "F2", "F3", "F4"].includes(r.check.slice(0, 2))) {
          add("Reconciliation", `${r.check}: ${r.item} - ${r.note}`, 1, r.difference !== null ? r.difference : r.actual, "Tab 'Reconciliation'");
        }
      }
      for (const c of this.new_related || []) {
        add("Checkpoint", `New related company found in the books: "${c}". Confirm it is a related company and add it to the related-company list (rules) so allocation and recharge checks include it.`, null, null, 'Page: "New related companies" / rules.json related_parties');
      }
      this.checkpoint_rows = [];
      for (const n of this.rules.review_notes || []) {
        const hit = n.name ? this.td.filter((l) => (l.name || "").toLowerCase().includes(n.name.toLowerCase())) : [];
        for (const l of hit) this.checkpoint_rows.push({ checkpoint: n.name, date: l.date, type: l.type, num: l.num, name: l.name, memo: l.memo, account: l.account, amount: l.amount });
        if (hit.length || !n.name) add("Checkpoint", n.message, hit.length, hit.length ? pyRound(npSum(hit.map((l) => Math.abs(l.amount))), 2) : null, n.where || "Tab 'Checkpoints'");
      }
      this.checklist = rows;
    }
    safe(name, fn) {
      try {
        fn.call(this);
        this.run_log.push({ step: name, status: "OK", message: "" });
      } catch (e) {
        this.run_log.push({ step: name, status: "ERROR - skipped", message: `${e.pyName || e.name}: ${e.message}` });
      }
    }
    computeBasis() {
      const th = this.th;
      const basis = /* @__PURE__ */ new Map();
      for (const r of this.target) {
        const b = [];
        if (this.rule_matched_ids.has(r.id)) b.push("rule");
        const fam = VENDOR_OR_DEPOSIT.has(r.type) ? "v" : "c";
        if (r.name && fam === "v") {
          const h = this.hist_name_v.get(r.name);
          if (h && h.n >= th.history_min_txns) b.push("history");
        }
        if (fam === "c" && r.memo && r.memo.includes(" - ")) {
          const h = this.hist_sig.get(memoSignature(r.memo));
          if (h && h.n >= th.history_min_txns_memo) b.push("history");
        }
        if (r.type === "General Journal") b.push("journal-logic");
        basis.set(r.id, b.length ? b.join("+") : "none");
      }
      this.basis = basis;
    }
    run() {
      this.load();
      const S = (n, f) => this.safe(n, f);
      S("build history", this.buildHistory);
      S("build name index", this.buildNameIndex);
      S("detect related parties", this.detectRelatedParties);
      S("A. completeness", this.checkCompleteness);
      S("B1/C3 keyword rules", this.checkKeywordRules);
      S("B3 approved vendors", this.checkApprovedVendors);
      S("B2 history", this.checkHistory);
      S("B4-B6 account hygiene", this.checkAccountHygiene);
      S("C. names", this.checkNames);
      S("D. duplicates", this.checkDuplicates);
      S("E. unusual items", this.checkUnusual);
      S("G1/G2 Upwork allocation", this.checkAllocation);
      S("G3 Upwork recharge", this.checkUpworkRecharge);
      S("E7 cash withdrawals / payee list", this.checkCashPayees);
      S("F. reconciliations", this.checkReconciliations);
      if (this.approved_ok.size) this.flags = this.flags.filter((f) => !this.approved_ok.has(f.line_id) || ["D1", "D2", "D3"].includes(f.check.slice(0, 2)));
      S("basis / coverage", this.computeBasis);
      S("review checklist", this.buildChecklist);
      this.inputNotes();
      return this;
    }
    inputNotes() {
      for (const [k, lab] of [["pl", "P&L detail"], ["bs", "Balance sheet detail"], ["tb", "Trial balance"], ["ar", "AR aging"], ["ap", "AP aging"]]) {
        if (!this.rowsByRole[k]) this.notes.push(`${lab} not supplied - the related tie-out checks were skipped (the review still ran).`);
      }
      const lo = this.period[0];
      if (!(lo.getUTCMonth() + 1 === 1 && lo.getUTCDate() <= 5)) this.notes.push(`Reports start ${isoDate(lo)}, not January 1 - 'same as older entries' history is limited to this window. Use a full year-to-date export for best results.`);
      if (!this.payeeRows) this.notes.push("No cash/1099 payee list supplied - see tab 'Cash & 1099' for the withdrawals that need payees.");
    }
  };
  function runReview({ rowsByRole, rules, payeeRows, company } = {}) {
    const rv = new Review(rowsByRole, rules, payeeRows);
    rv.company = company || "";
    return rv.run();
  }

  // src/xlsx_io.js
  var _ExcelJS = null;
  async function getExcelJS(lib) {
    if (lib) return lib;
    if (_ExcelJS) return _ExcelJS;
    if (globalThis.ExcelJS) {
      _ExcelJS = globalThis.ExcelJS;
      return _ExcelJS;
    }
    throw new Error("Excel library not loaded");
  }
  function cellValue(v) {
    if (v === void 0 || v === null) return null;
    if (v instanceof Date) return v;
    const t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") return v;
    if (t === "object") {
      if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("");
      if ("result" in v || "formula" in v || "sharedFormula" in v) return cellValue(v.result);
      if ("error" in v) return String(v.error);
      if ("text" in v) return cellValue(v.text);
      if ("hyperlink" in v) return String(v.hyperlink);
    }
    return String(v);
  }
  async function parseWorkbookRows(arrayBuffer, ExcelJSLib) {
    const ExcelJS = await getExcelJS(ExcelJSLib);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const nRows = ws.rowCount;
    const nCols = ws.columnCount;
    const out = new Array(nRows);
    for (let r = 1; r <= nRows; r++) {
      const row = ws.getRow(r);
      const arr = new Array(nCols).fill(null);
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > nCols) return;
        if (cell.type === 6) arr[c - 1] = cellValue(cell.result === void 0 ? null : cell.result);
        else arr[c - 1] = cellValue(cell.value);
      });
      out[r - 1] = arr;
    }
    return out;
  }

  // src/build_report.js
  var _ExcelJS2 = globalThis.ExcelJS || null;
  var HDR_FILL = "FF1F3A5F";
  var SEV_FILL = { High: "FFF8CBAD", Medium: "FFFFE699", Low: "FFE2EFDA", Info: "FFDDEBF7" };
  var NUMFMT = "#,##0.00";
  var AMT_COLS = /* @__PURE__ */ new Set(["amount", "expected", "actual", "difference", "net_activity", "gross_amount"]);
  var SEVS = ["High", "Medium", "Low", "Info"];
  var cmpv2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  var num16 = (v) => typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(16)) : v;
  var blank = (v) => v === void 0 || v === "" ? null : num16(v);
  function solid(argb) {
    return { type: "pattern", pattern: "solid", fgColor: { argb }, bgColor: { argb } };
  }
  function colLetter(n) {
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  function styleHeader(cell) {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = solid(HDR_FILL);
    cell.alignment = { wrapText: true, vertical: "top" };
    const b = { style: "thin" };
    cell.border = { top: b, left: b, bottom: b, right: b };
  }
  function addSheet(wb, name, columns, rows, opts = {}) {
    const ws = wb.addWorksheet(name);
    const widths = opts.widths || {};
    ws.addRow(columns.map((c) => pyTitle(c.replace(/_/g, " "))));
    ws.getRow(1).eachCell(styleHeader);
    const spec = columns.map((c) => {
      const isAmt = AMT_COLS.has(c);
      const w = widths[c] === void 0 ? 14 : widths[c];
      return { c, isAmt, w: isAmt ? 14 : w, wrap: !isAmt && w > 30 };
    });
    spec.forEach((s, j) => {
      ws.getColumn(j + 1).width = s.w + 0.7109375;
    });
    for (const r of rows) {
      const row = ws.addRow(r.map(blank));
      for (let j = 0; j < spec.length; j++) {
        const v = r[j];
        const s = spec[j];
        if (v instanceof Date) {
          row.getCell(j + 1).numFmt = "YYYY-MM-DD";
        } else if (s.isAmt) row.getCell(j + 1).numFmt = NUMFMT;
        else if (s.wrap) row.getCell(j + 1).alignment = { wrapText: true, vertical: "top" };
        if (s.isAmt && v instanceof Date === false) row.getCell(j + 1).numFmt = NUMFMT;
      }
    }
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, rows.length + 1), column: columns.length } };
    const n = rows.length;
    if (opts.sev && n) {
      const j = columns.indexOf("severity");
      if (j >= 0) {
        const L = colLetter(j + 1);
        ws.addConditionalFormatting({
          ref: `${L}2:${L}${n + 1}`,
          rules: SEVS.map((s, i) => ({
            type: "cellIs",
            operator: "equal",
            formulae: [`"${s}"`],
            priority: i + 1,
            style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: SEV_FILL[s] } }, font: s === "High" ? { bold: true } : {} }
          }))
        });
      }
    }
    if (opts.textFlag && n) {
      const { col, text, argb } = opts.textFlag;
      const L1 = colLetter(col[0] + 1), L2 = colLetter(col[1] + 1);
      ws.addConditionalFormatting({
        ref: `${L1}2:${L2}${n + 1}`,
        rules: [{ type: "containsText", operator: "containsText", text, formulae: [`NOT(ISERROR(SEARCH("${text}",${L1}2)))`], priority: 1, style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb } }, font: argb === SEV_FILL.High ? { bold: true } : {} } }]
      });
    }
    return ws;
  }
  function cellOrBlank(v) {
    return v === void 0 ? null : v;
  }
  function buildReport(rv, opts = {}) {
    const ExcelJS = opts.ExcelJS || _ExcelJS2;
    if (!ExcelJS) throw new Error("ExcelJS not available: pass opts.ExcelJS or load exceljs.min.js first");
    const company = opts.company ?? rv.company ?? "";
    const rulesName = opts.rulesName || "built-in";
    const fl = rv.flags.map((f, i) => ({ ...f, _i: i, sev_rank: SEV_RANK[f.severity], abs_amt: f.amount === null || f.amount === void 0 || Number.isNaN(f.amount) ? 0 : Math.abs(f.amount) }));
    fl.sort((a, b) => b.sev_rank - a.sev_rank || b.abs_amt - a.abs_amt || a._i - b._i);
    fl.forEach((f, i) => {
      f.ref = `EX-${String(i + 1).padStart(4, "0")}`;
    });
    const lineFl = fl.filter((f) => f.line_id >= 0);
    const cnt = /* @__PURE__ */ new Map(), worst = /* @__PURE__ */ new Map(), firstIssue = /* @__PURE__ */ new Map();
    for (const f of lineFl) {
      cnt.set(f.line_id, (cnt.get(f.line_id) || 0) + 1);
      if (!worst.has(f.line_id) || f.sev_rank > worst.get(f.line_id)) worst.set(f.line_id, f.sev_rank);
      if (!firstIssue.has(f.line_id)) firstIssue.set(f.line_id, f.issue);
    }
    const td = rv.td.map((l) => {
      const n = cnt.get(l.id) || 0;
      return {
        ...l,
        n_flags: n,
        worst: worst.has(l.id) ? RANK_SEV[worst.get(l.id)] : "",
        top_issue: firstIssue.get(l.id) || "",
        basis: rv.basis.get(l.id) ?? "",
        status: n > 0 ? "FLAGGED" : l.is_funding ? "Funding side" : "OK"
      };
    });
    const rc = rv.recon;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Summary");
    ws.getColumn(1).width = 34 + 0.7109375;
    for (let c = 2; c <= 5; c++) ws.getColumn(c).width = 16 + 0.7109375;
    ws.getColumn(6).width = 70 + 0.7109375;
    const put = (r, c, v, style) => {
      const cell = ws.getCell(r + 1, c + 1);
      if (v !== null && v !== void 0 && v !== "") cell.value = num16(v);
      if (style) style(cell);
      return cell;
    };
    const bold = (cell) => {
      cell.font = { bold: true };
    };
    const sevStyle = (s) => (cell) => {
      cell.fill = solid(SEV_FILL[s]);
      if (s === "High") cell.font = { bold: true };
    };
    const lines = rv.td.length, checked = rv.td.filter((l) => !l.is_funding).length;
    const fmtN = (n) => n.toLocaleString("en-US");
    put(0, 0, `Books Review - ${company || "Exceptions Report"}`, (c) => {
      c.font = { bold: true, size: 16 };
    });
    put(1, 0, `Period reviewed: ${isoDate(rv.period[0])} to ${isoDate(rv.period[1])}   |   Lines reviewed: ${fmtN(lines)} (${fmtN(checked)} account-side lines checked)`);
    const now = /* @__PURE__ */ new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    put(2, 0, `Generated ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}   |   Rules: ${rulesName}`);
    const r0 = 5;
    put(r0, 0, "Exceptions by severity", bold);
    const sevCount = {};
    for (const s of SEVS) sevCount[s] = fl.filter((f) => f.severity === s).length;
    SEVS.forEach((s, i) => {
      put(r0 + 1 + i, 0, s, sevStyle(s));
      put(r0 + 1 + i, 1, sevCount[s]);
    });
    put(r0 + 5, 0, "Total exceptions", bold);
    put(r0 + 5, 1, fl.length);
    const linesFlagged = new Set(lineFl.map((f) => f.line_id)).size;
    put(r0 + 6, 0, "Distinct ledger lines flagged", bold);
    put(r0 + 6, 1, linesFlagged);
    const reconBad = rc.filter((r) => r.status === "MISMATCH").length;
    put(r0 + 7, 0, "Reconciliation checks failing", bold);
    put(r0 + 7, 1, reconBad);
    const tl = td.filter((l) => !l.is_funding);
    const noBasis = tl.filter((l) => l.basis === "none").length;
    const cov = tl.length ? (tl.length - noBasis) / tl.length : NaN;
    const pctStr = Number.isNaN(cov) ? "nan%" : pctFmt(cov);
    put(r0 + 8, 0, "Account-side lines with a rule/history basis", bold);
    put(r0 + 8, 1, pctStr);
    put(r0 + 8, 2, `(${fmtN(noBasis)} lines had NO basis to judge - see Name Audit 'basis' column; extend rules.json to cover them)`);
    const r1 = r0 + 11;
    put(r1, 0, "Exceptions by check", bold);
    ["Check", "High", "Medium", "Low", "Info", "Total"].forEach((h, j) => put(r1 + 1, j, h, styleHeader));
    const pv = /* @__PURE__ */ new Map();
    for (const f of fl) {
      let e = pv.get(f.check);
      if (!e) {
        e = { High: 0, Medium: 0, Low: 0, Info: 0 };
        pv.set(f.check, e);
      }
      e[f.severity]++;
    }
    const pvKeys = [...pv.keys()].sort(cmpv2);
    pvKeys.forEach((k, i) => {
      const v = pv.get(k);
      put(r1 + 2 + i, 0, k);
      SEVS.forEach((s, j) => put(r1 + 2 + i, 1 + j, v[s]));
      put(r1 + 2 + i, 5, v.High + v.Medium + v.Low + v.Info);
    });
    const r2 = r1 + 4 + pvKeys.length;
    put(r2, 0, "Reconciliation status", bold);
    ["Check", "Items", "Mismatches"].forEach((h, j) => put(r2 + 1, j, h, styleHeader));
    const rg = /* @__PURE__ */ new Map();
    for (const r of rc) {
      let e = rg.get(r.check);
      if (!e) {
        e = { items: 0, bad: 0 };
        rg.set(r.check, e);
      }
      e.items++;
      if (r.status === "MISMATCH") e.bad++;
    }
    const rgKeys = [...rg.keys()].sort(cmpv2);
    rgKeys.forEach((k, i) => {
      put(r2 + 2 + i, 0, k);
      put(r2 + 2 + i, 1, rg.get(k).items);
      put(r2 + 2 + i, 2, rg.get(k).bad);
    });
    const r3 = r2 + 4 + rgKeys.length;
    put(r3, 0, "Top 15 items to look at first", bold);
    ["Ref", "Severity", "Date", "Name", "Amount", "Issue"].forEach((h, j) => put(r3 + 1, j, h, styleHeader));
    lineFl.slice(0, 15).forEach((x, i) => {
      put(r3 + 2 + i, 0, x.ref);
      put(r3 + 2 + i, 1, x.severity, sevStyle(x.severity));
      put(r3 + 2 + i, 2, x.date ? isoDate(x.date) : "");
      put(r3 + 2 + i, 3, nz(x.name));
      put(r3 + 2 + i, 4, x.amount, (c) => {
        c.numFmt = NUMFMT;
      });
      put(r3 + 2 + i, 5, x.issue);
    });
    const r4 = r3 + 19;
    put(r4, 0, "Notes & limits", bold);
    const notes = [
      ...rv.notes,
      "Account/name suggestions are rule- and history-based. They are leads for a human reviewer, not automatic corrections.",
      "Reviewer columns (Action / Notes) on the Exceptions tab are blank for you to fill in.",
      "'Funding side' lines (bank, credit card, A/R, A/P, undeposited funds) are not categorised; they are checked via duplicates and reconciliations."
    ];
    notes.forEach((n, i) => put(r4 + 1 + i, 0, n));
    const exCols = ["ref", "severity", "check", "issue", "detail", "date", "type", "num", "name", "memo", "account", "cls", "amount", "split", "suggested_account", "suggested_name", "confidence", "source", "reviewer_action", "reviewer_notes"];
    const exRows = fl.map((f) => exCols.map((c) => c === "reviewer_action" || c === "reviewer_notes" ? null : cellOrBlank(f[c])));
    const exW = { issue: 48, detail: 60, memo: 50, account: 28, name: 26, suggested_account: 26, suggested_name: 24 };
    addSheet(wb, "Exceptions", exCols, exRows, { widths: exW, sev: true });
    const themes = {
      "Account Review": ["B1", "B2", "B3", "B4", "B5", "B6", "C3"],
      "Name Review": ["A1", "C1", "C2", "C4", "C5"],
      Duplicates: ["D1", "D2", "D3"],
      Unusual: ["A2", "E1", "E2", "E4", "E5", "E6", "E7"]
    };
    const ci = exCols.indexOf("check");
    for (const [tab, pref] of Object.entries(themes)) addSheet(wb, tab, exCols, exRows.filter((r) => pref.includes(r[ci].slice(0, 2))), { widths: exW, sev: true });
    const rcCols = ["check", "item", "expected", "actual", "difference", "status", "note"];
    addSheet(wb, "Reconciliation", rcCols, rc.map((r) => rcCols.map((c) => cellOrBlank(r[c]))), { widths: { item: 60, note: 80, check: 34 }, textFlag: { col: [0, 6], text: "MISMATCH", argb: SEV_FILL.High } });
    const tl2 = td.filter((l) => !l.is_funding && l.name !== null);
    const bg = /* @__PURE__ */ new Map();
    for (const l of tl2) {
      let e = bg.get(l.name);
      if (!e) {
        e = { all: true, any: false };
        bg.set(l.name, e);
      }
      const none = l.basis === "none";
      if (!none) e.all = false;
      if (none) e.any = true;
    }
    const nm = rv.name_master_rows.map((r) => ({ ...r, basis: bg.has(r.name) ? bg.get(r.name).all ? "none" : bg.get(r.name).any ? "partial" : "covered" : "(funding side only)" }));
    nm.sort((a, b) => cmpv2(a.basis, b.basis) || b.gross_amount - a.gross_amount);
    const nmCols = ["name", "role", "lines", "gross_amount", "first_used", "last_used", "accounts_used", "notes", "basis"];
    addSheet(wb, "Name Audit", nmCols, nm.map((r) => nmCols.map((c) => cellOrBlank(r[c]))), { widths: { name: 38, accounts_used: 70, notes: 70 } });
    const flaggedIds = new Set(lineFl.map((f) => f.line_id));
    const ag = /* @__PURE__ */ new Map();
    for (const l of rv.td) {
      const k = l.account + "" + l.acct_type;
      let e = ag.get(k);
      if (!e) {
        e = { account: l.account, acct_type: l.acct_type, lines: 0, amts: [] };
        ag.set(k, e);
      }
      e.lines++;
      e.amts.push(l.amount);
    }
    const namesBy = /* @__PURE__ */ new Map(), flaggedBy = /* @__PURE__ */ new Map();
    for (const l of rv.td) {
      let s = namesBy.get(l.account);
      if (!s) {
        s = /* @__PURE__ */ new Set();
        namesBy.set(l.account, s);
      }
      if (l.name !== null) s.add(l.name);
      if (flaggedIds.has(l.id)) flaggedBy.set(l.account, (flaggedBy.get(l.account) || 0) + 1);
    }
    let am = [...ag.values()].sort((a, b) => cmpv2(a.account, b.account) || cmpv2(a.acct_type, b.acct_type)).map((e) => {
      const fl_ = flaggedBy.get(e.account) || 0;
      let s = 0, c = 0;
      for (const v of e.amts) {
        const y = v - c;
        const t = s + y;
        c = t - s - y;
        s = t;
      }
      return { account: e.account, acct_type: e.acct_type, lines: e.lines, net_activity: s, names_used: namesBy.get(e.account).size, flagged_lines: fl_, pct_flagged: npRound(fl_ / e.lines, 3) };
    });
    am = am.map((r, i) => ({ r, i })).sort((a, b) => b.r.flagged_lines - a.r.flagged_lines || a.i - b.i).map((x) => x.r);
    const amCols = ["account", "acct_type", "lines", "net_activity", "names_used", "flagged_lines", "pct_flagged"];
    addSheet(wb, "Account Audit", amCols, am.map((r) => amCols.map((c) => r[c])), { widths: { account: 50 } });
    let lr = [];
    for (const [fam, hist] of [["Vendor-side", rv.hist_name_v], ["Customer-side", rv.hist_name_c]]) {
      for (const [k, h] of hist) {
        if (h.n >= 3) lr.push({ family: fam, name: k, lines: h.n, usual_account: h.items[0][0], share: npRound(h.items[0][1] / h.n, 3), other_accounts: h.items.slice(1, 5).map(([a, c]) => `${a} (${c})`).join("; "), approved_account: null });
      }
    }
    lr = lr.map((r, i) => ({ r, i })).sort((a, b) => cmpv2(a.r.family, b.r.family) || b.r.lines - a.r.lines || a.i - b.i).map((x) => x.r);
    const lrCols = ["family", "name", "lines", "usual_account", "share", "other_accounts", "approved_account"];
    addSheet(wb, "Vendor-Account Map", lrCols, lr.map((r) => lrCols.map((c) => r[c])), { widths: { name: 38, usual_account: 34, other_accounts: 70 } });
    const alCols = ["line", "status", "worst", "n_flags", "top_issue", "source_row", "date", "type", "num", "name", "memo", "cls", "account", "split", "amount", "acct_type", "basis"];
    const alRows = td.map((l) => [l.id, l.status, l.worst, l.n_flags, l.top_issue, l.src_row, l.date, l.type, l.num, l.name, l.memo, l.cls, l.account, l.split, l.amount, l.acct_type, l.basis]);
    addSheet(wb, "All Lines", alCols, alRows, { widths: { top_issue: 50, memo: 50, account: 30, name: 26 }, textFlag: { col: [1, 1], text: "FLAGGED", argb: SEV_FILL.Medium } });
    const ckCols = ["area", "issue", "lines", "amount", "where_to_look", "status", "reviewer_notes"];
    const ckWs = addSheet(wb, "Review Checklist", ckCols, rv.checklist.map((r) => ckCols.map((c) => cellOrBlank(r[c]))), { widths: { issue: 80, where_to_look: 36, reviewer_notes: 40, area: 16 } });
    if (rv.checklist.length) {
      ckWs.dataValidations.add(`F2:F${rv.checklist.length + 1}`, { type: "list", allowBlank: true, formulae: ['"Open,In progress,Resolved,Accepted as is"'] });
    }
    const aCols = ["worker", "month", "entity", "amount", "share_of_worker_month", "rule"];
    addSheet(wb, "Upwork Allocation", aCols, rv.alloc_rows.map((r) => aCols.map((c) => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
    const uCols = ["month", "upwork_charged", "hours_billed", "difference", "status"];
    addSheet(wb, "Upwork Recharge", uCols, rv.recharge_rows.map((r) => uCols.map((c) => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
    const cCols = ["date", "amount", "bank_memo", "expensed_to", "payee", "form_1099", "status"];
    addSheet(wb, "Cash & 1099", cCols, rv.cash_rows.map((r) => cCols.map((c) => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
    const lgCols = ["step", "status", "message"];
    addSheet(wb, "Run Log", lgCols, rv.run_log.map((r) => lgCols.map((c) => r[c])), { widths: { step: 40, message: 90 } });
    addSheet(wb, "Related Parties", ["related_party", "status"], [...rv.related].sort(cmpv2).map((x) => [x, "In books"]).concat((rv.new_related || []).map((x) => [x, "NEW - confirm and add to rules"])), { widths: { related_party: 40, status: 34 } });
    const kCols = ["checkpoint", "date", "type", "num", "name", "memo", "account", "amount"];
    addSheet(wb, "Checkpoints", kCols, (rv.checkpoint_rows || []).map((r) => kCols.map((c) => cellOrBlank(c === "date" && r[c] ? r[c] : r[c]))), { widths: { memo: 50, account: 34, name: 28, checkpoint: 16 } });
    const rrCols = ["id", "applies_to", "pattern", "expected_accounts", "severity", "note"];
    addSheet(wb, "Rules Used", rrCols, rv.rules.keyword_rules.map((r) => [r.id, r.scope, r.pattern, (r.expected || []).join(", "), r.severity, r.note]), { widths: { pattern: 60, expected_accounts: 60, note: 60 } });
    const by_check = pvKeys.map((k) => {
      const v = pv.get(k);
      return { check: k, High: v.High, Medium: v.Medium, Low: v.Low, Info: v.Info, total: v.High + v.Medium + v.Low + v.Info };
    });
    const summary = {
      total: fl.length,
      severity: { High: sevCount.High, Medium: sevCount.Medium, Low: sevCount.Low, Info: sevCount.Info },
      recon_bad: reconBad,
      period: [isoDate(rv.period[0]), isoDate(rv.period[1])],
      lines: { total: lines, checked, flagged: linesFlagged },
      run_problems: rv.run_log.filter((x) => x.status !== "OK"),
      checklist: rv.checklist,
      by_check,
      top: lineFl.slice(0, 25).map((f) => ({ ref: f.ref, sev: f.severity, date: f.date ? isoDate(f.date) : "", name: f.name || "", amount: f.amount, issue: f.issue })),
      notes: notes.slice(0, rv.notes.length),
      new_related: rv.new_related || [],
      checkpoints: (rv.checkpoint_rows || []).map((r) => ({ date: r.date ? isoDate(r.date) : "", type: r.type, name: r.name || "", memo: r.memo || "", account: r.account, amount: r.amount, checkpoint: r.checkpoint })),
      detected: opts.detected || null,
      coverage: Number.isNaN(cov) ? null : cov,
      no_basis_lines: noBasis
    };
    return { workbook: wb, summary, flags: fl, recon: rc };
  }
  function pctFmt(x) {
    const v = x * 100;
    const f = Math.floor(v);
    const d = v - f;
    const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
    return r + "%";
  }

  // rules.json
  var rules_default = {
    _readme: "Editable rule book. keyword_rules: if the regex matches the Name and/or Memo and the posted account is NOT in 'expected', the line is flagged and the first expected account is suggested. Add/adjust rules as you learn the client's habits - no code change needed.",
    thresholds: {
      high_amount: 5e3,
      tiny_amount: 20,
      history_min_txns: 5,
      history_dominance: 0.8,
      history_min_txns_memo: 4,
      probable_dup_days: 3,
      probable_dup_min_amount: 20,
      outlier_min_txns: 6,
      outlier_multiple: 3,
      outlier_min_amount: 250,
      round_amount_min: 1e3,
      memo_date_late_days: 20,
      pr_date_tolerance_days: 3,
      pay_period_tolerance_days: 45,
      journal_no_memo_min: 1e3,
      near_dup_name_ratio: 0.9,
      cash_label_min_amount: 500,
      tolerance: 0.01
    },
    suspense_accounts: [
      "Other Expense",
      "Other Income",
      "Clearing Account",
      "Opening Balance Equity",
      "Payroll Receivable",
      "Ask My Accountant",
      "Uncategorized Expense",
      "Uncategorized Income",
      "Retainer"
    ],
    placeholder_names: [
      "Cash Withdrawals",
      "Bank Charges",
      "Wire Fee",
      "Finance Charges",
      "Cannabis",
      "Credit Card Misc.",
      "WooCommerce Customer",
      "Trade show #1",
      "Trade show #2"
    ],
    similar_account_groups: [
      {
        preferred: "Advertising and Promotion",
        also: [
          "Advertising"
        ],
        note: "Two advertising accounts (Advertising and Promotion vs Marketing:Advertising)."
      },
      {
        preferred: "Merchant Account Fees",
        also: [
          "Merchant Fees"
        ],
        note: "Card-processor fees are booked in 2-3 different accounts."
      },
      {
        preferred: "Software & Subscriptions",
        also: [
          "Dues and Subscriptions",
          "Computer and Internet Expenses"
        ],
        note: "Software/subscription spend split across three accounts."
      },
      {
        preferred: "Utilities",
        also: [
          "Electricity and water supply"
        ],
        note: "Utilities split across two accounts."
      },
      {
        preferred: "Freight Costs",
        also: [
          "Cost of Shipping & Freight"
        ],
        note: "Two freight accounts."
      },
      {
        preferred: "Rental Income",
        also: [
          "Lease/Rental Income"
        ],
        note: "Two rental-income accounts (one is Other Income)."
      }
    ],
    keyword_rules: [
      {
        id: "broker_commission",
        scope: "memo",
        pattern: "commission",
        expected: [
          "Commissions"
        ],
        severity: "Low",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Commission memo."
      },
      {
        id: "hardware_store",
        scope: "name",
        pattern: "harbor freight|home depot|lowe'?s|ace hardware",
        expected: [
          "Repairs and Maintenance",
          "Facility Supplies",
          "Office Supplies"
        ],
        severity: "Medium",
        note: "Hardware-store purchase (watch for 'Freight' in the name being mapped to Freight Costs)."
      },
      {
        id: "fuel",
        scope: "both",
        pattern: "\\b(shell (oil|service)|chevron|arco|76|ralphs? fuel|ralph's fuel|grand petroleum|gm oil|exxon|mobil|texaco|valero|circle k)\\b|\\bfuel\\b",
        expected: [
          "Auto and Truck Expenses"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Fuel purchase."
      },
      {
        id: "auto_loan_mercedes",
        scope: "both",
        pattern: "mbfs|mercedes[- ]benz",
        expected: [
          "Auto Loan - Mercedes",
          "Auto and Truck Expenses",
          "Interest Expense"
        ],
        severity: "High",
        types_exclude: [
          "Invoice"
        ],
        note: "Mercedes-Benz Financial payment: should reduce the Mercedes loan (and interest), not bank fees/expenses."
      },
      {
        id: "auto_loan_other",
        scope: "both",
        pattern: "gm financial|ally servicing|td auto|ford credit|ford motor credit|toyota financial",
        expected: [
          "TD Auto Finance Loan",
          "Ford Van Loan",
          "Auto Loan",
          "Auto Loan - Mercedes",
          "Interest Expense",
          "Auto and Truck Expenses"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "Vehicle finance payment."
      },
      {
        id: "auto_misc",
        scope: "both",
        pattern: "\\b(dmv|autozone|american tire|car wash|truck wash|oil co|galpin)\\b",
        expected: [
          "Auto and Truck Expenses"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Vehicle-related vendor."
      },
      {
        id: "airfare",
        scope: "both",
        pattern: "airlines?\\b|american air|alaska air|\\bdelta\\b|southwest|jetblue|united air|spirit air|british air",
        expected: [
          "Travel - Airfare"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Airline."
      },
      {
        id: "lodging",
        scope: "both",
        pattern: "airbnb|hotel|marriott|hilton|hyatt|motel",
        expected: [
          "Travel - Lodging"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Lodging."
      },
      {
        id: "rideshare",
        scope: "both",
        pattern: "\\buber\\b(?!\\s*\\*?\\s*eats)(?!\\.com)|lyft|taxi|\\bcab\\b|curb ",
        expected: [
          "Travel - Transportation",
          "Auto and Truck Expenses"
        ],
        severity: "Low",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Ride-share / taxi."
      },
      {
        id: "meals",
        scope: "both",
        pattern: "doordash|uber ?\\*? ?eats|grubhub|starbucks|mcdonald|in-?n-?out|burger|pizza|restaurant|cafe|coffee|donut|el pollo|taco|chipotle|snack|7-?eleven|food4less|cardenas|cipriani",
        expected: [
          "Meals and Entertainment",
          "Facility Supplies",
          "Office Supplies",
          "Travel - Transportation"
        ],
        severity: "Low",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Food/restaurant spend."
      },
      {
        id: "software",
        scope: "both",
        pattern: "hubspot|asana|age ?checker|ringcentral|microsoft|google|zoom|slack|dropbox|adobe|canva|quickbooks|intuit|fishbowl|amazon prime|shopify|godaddy|ring\\.com|ring multi",
        expected: [
          "Software & Subscriptions",
          "Dues and Subscriptions",
          "Computer and Internet Expenses"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Software / SaaS subscription."
      },
      {
        id: "shipping",
        scope: "both",
        pattern: "\\bups\\b|fedex|\\bdhl\\b|usps|priority-?1|shippo|shipping fee|freight(?! tool)|landed cost",
        expected: [
          "Freight Costs",
          "Cost of Shipping & Freight",
          "Shipping and Delivery Income",
          "Inventory Asset",
          "Cost of Goods Sold"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal"
        ],
        note: "Shipping / freight."
      },
      {
        id: "bank_fees",
        scope: "memo",
        pattern: "wire (transfer )?fee|service charge|overdraft|digital banking fee|paper statement fee|account analysis|international purchase transaction fee|monthly maintenance",
        expected: [
          "Bank Service Charges",
          "Merchant Account Fees",
          "Merchant Fees"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Bank fee."
      },
      {
        id: "bank_fee_names",
        scope: "name",
        pattern: "^(bank charges|wire fee)$",
        expected: [
          "Bank Service Charges"
        ],
        severity: "Medium",
        note: "Bank-fee placeholder vendor."
      },
      {
        id: "merchant_processor",
        scope: "both",
        pattern: "greenlight|authnet|authorize\\.?net|stripe|merchant svc|merchant service",
        expected: [
          "Merchant Account Fees",
          "Merchant Fees",
          "Undeposited Funds",
          "Accounts Receivable",
          "Customer Deposit",
          "Retail Products",
          "Fulfillment Services",
          "Clearing Account"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Card processor: fees go to merchant fees; deposits are sales/clearing - never Bank Service Charges or Other Income."
      },
      {
        id: "finance_charge",
        scope: "both",
        pattern: "finance charge|interest charge|purchase interest|interest paid",
        expected: [
          "Interest Expense"
        ],
        severity: "Medium",
        types_exclude: [
          "General Journal",
          "Invoice"
        ],
        note: "Finance/interest charges belong in Interest Expense."
      },
      {
        id: "payroll_words",
        scope: "both",
        pattern: "pay period|payroll|pr check date|direct deposit employees|gusto",
        expected: [
          "Payroll",
          "Payroll Tax",
          "Payroll Fees",
          "Payroll Liabilities",
          "Reimbursements",
          "WC Insurance",
          "Payroll Receivable",
          "Independent Contractor - Other",
          "Manufacturing Labor",
          "Accounts Receivable"
        ],
        severity: "High",
        types: [
          "General Journal",
          "Check",
          "Bill",
          "Credit Card Charge",
          "Deposit",
          "Credit"
        ],
        note: "Payroll-related memo posted to a non-payroll account."
      },
      {
        id: "rent",
        scope: "both",
        pattern: "carver commercial|\\brent\\b",
        expected: [
          "Rent Expense",
          "Rental Income",
          "Lease/Rental Income",
          "Security Deposit"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "Rent."
      },
      {
        id: "legal",
        scope: "both",
        pattern: "lawyer|law (office|firm|group)|attorney|\\besq\\b|\\blegal\\b",
        expected: [
          "Legal",
          "Professional Fees - Other"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "Legal service provider."
      },
      {
        id: "accounting",
        scope: "both",
        pattern: "aetius|\\bcpa\\b|bookkeep|tax prep|accounting|accountant",
        expected: [
          "Accounting/Bookkeeping/Tax Prep"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "Accounting / tax preparation."
      },
      {
        id: "state_filings",
        scope: "both",
        pattern: "franchise tax|secretary of state|statement of information",
        expected: [
          "Franchise Tax Expense",
          "Other Expense",
          "Professional Fees - Other"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "State filing / franchise tax."
      },
      {
        id: "sales_tax",
        scope: "both",
        pattern: "cdtfa|ca department|department of tax|sales tax",
        expected: [
          "Sales Tax Payable"
        ],
        severity: "Medium",
        note: "Sales-tax remittance."
      },
      {
        id: "insurance",
        scope: "both",
        pattern: "insurance|insurelinx|geico|workers comp",
        expected: [
          "Insurance Expense",
          "WC Insurance",
          "Auto and Truck Expenses",
          "FIRST Insurance Funding Loan",
          "Vendor Deposit",
          "Payroll Liabilities",
          "Payroll Receivable",
          "Accounts Payable"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice",
          "General Journal"
        ],
        note: "Insurance."
      },
      {
        id: "advertising",
        scope: "both",
        pattern: "facebook|meta ads|instagram|tiktok|google ads|linkedin|reddit",
        expected: [
          "Advertising and Promotion",
          "Advertising",
          "Social Media & Content",
          "Event Marketing",
          "Sales Collateral",
          "Web/Graphic Design Expense"
        ],
        severity: "Medium",
        types_exclude: [
          "Invoice"
        ],
        note: "Advertising platform."
      },
      {
        id: "web_design",
        scope: "both",
        pattern: "digicoal|web design|graphic design",
        expected: [
          "Web/Graphic Design Expense",
          "Social Media & Content",
          "Sales Collateral",
          "Software & Subscriptions"
        ],
        severity: "Low",
        types_exclude: [
          "Invoice"
        ],
        note: "Design / web vendor."
      },
      {
        id: "utilities",
        scope: "both",
        pattern: "ladwp|edison|socal gas|southern california gas|spectrum|at&t|verizon|t-mobile|electric",
        expected: [
          "Utilities",
          "Electricity and water supply",
          "Computer and Internet Expenses"
        ],
        severity: "Low",
        types_exclude: [
          "Invoice",
          "General Journal"
        ],
        note: "Utility / telecom."
      },
      {
        id: "invoice_shipping",
        scope: "memo",
        pattern: "^shipping",
        expected: [
          "Shipping and Delivery Income"
        ],
        severity: "Medium",
        types: [
          "Invoice",
          "Credit Memo"
        ],
        note: "Shipping charge on a sales document."
      },
      {
        id: "invoice_customer_deposit",
        scope: "memo",
        pattern: "customer deposit",
        expected: [
          "Customer Deposit",
          "Accounts Receivable"
        ],
        severity: "Medium",
        types: [
          "Invoice",
          "Credit Memo"
        ],
        note: "Customer deposit line."
      },
      {
        id: "invoice_fulfillment",
        scope: "memo",
        pattern: "service fee|customer support|club house hours|employer'?s tax|total pay|employee tax",
        expected: [
          "Fulfillment Services",
          "Accounts Receivable"
        ],
        severity: "Medium",
        types: [
          "Invoice",
          "Credit Memo"
        ],
        note: "Fulfilment / service-fee line."
      },
      {
        id: "invoice_rental",
        scope: "memo",
        pattern: "rental +expense reimbursement",
        expected: [
          "Rental Income",
          "Accounts Receivable"
        ],
        severity: "Medium",
        types: [
          "Invoice",
          "Credit Memo"
        ],
        note: "Rent reimbursement."
      },
      {
        id: "invoice_parts",
        scope: "memo",
        pattern: "capcover|band-sticker|filter-?mesh",
        expected: [
          "Inventory Part Income",
          "Accounts Receivable"
        ],
        severity: "Medium",
        types: [
          "Invoice",
          "Credit Memo"
        ],
        note: "Parts / accessories sale."
      },
      {
        id: "cash_expensed",
        scope: "both",
        pattern: "teller cashed check|cash withdrawal|teller [a-z0-9]+ +brn",
        action: "review",
        review_account_types: [
          "Expense",
          "COGS"
        ],
        min_amount: 500,
        severity: "Medium",
        types_exclude: [
          "General Journal"
        ],
        note: "Bank cash withdrawal expensed straight to labor/expense: payee unknown. Needs support (who was paid, 1099/payroll compliance)."
      }
    ],
    related_parties: {
      auto_detect: true,
      names: [
        "LXP",
        "Crysp",
        "Bravura"
      ]
    },
    allocation_rules: [
      {
        worker: "Mona",
        memo_pattern: "\\bmona",
        allowed_entities: [
          "Crysp",
          "LXP"
        ],
        note: "Mona's Upwork hours are split between Crysp and LXP."
      },
      {
        worker: "Catie",
        memo_pattern: "\\bcatie",
        allowed_entities: [
          "LXP"
        ],
        note: "Catie's Upwork hours go to LXP only."
      },
      {
        worker: "Chelsey",
        memo_pattern: "\\bchelsey",
        allowed_entities: [
          "LXP"
        ],
        note: "Chelsey's Upwork hours go to LXP only."
      }
    ],
    upwork: {
      charge_memo_pattern: "upwork",
      tolerance_pct: 0.05,
      split_drift_points: 15
    },
    approved_vendor_accounts: {
      "Kimberly Marrder": [
        "Social Media & Content"
      ]
    },
    review_notes: [
      {
        name: "Carter",
        message: "Carter (lawyer) - confirm treatment with the accountant; pending item, does not block the review.",
        where: "Name Audit"
      }
    ]
  };

  // app.js
  var $ = (s) => document.querySelector(s);
  var ROLES = {
    td: ["Transaction Detail by Account", /tract?(s|i)?ional|transaction.*detail|trans.*by.*acc/],
    gl: ["General Ledger", /general ledger/],
    pl: ["Profit & Loss Detail", /p\s*(and|&)\s*l|profit.*loss/],
    bs: ["Balance Sheet Detail", /balance sheet/],
    tb: ["Trial Balance", /trial balance/],
    ar: ["A/R Aging", /\bar\b.*report|a\/r|receivable/],
    ap: ["A/P Aging", /\bap\b.*report|a\/p|payable/]
  };
  var fmt = (n) => n == null ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var files = [];
  var defaultRules = "";
  var payeeFile = null;
  var xlsxBytes = null;
  defaultRules = JSON.stringify(rules_default, null, 2);
  var store = { get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  }, set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (_) {
    }
  } };
  $("#rules").value = store.get("books.rules") || defaultRules;
  $("#company").value = store.get("books.company") || "";
  $("#rules").addEventListener("change", () => store.set("books.rules", $("#rules").value));
  $("#company").addEventListener("change", () => store.set("books.company", $("#company").value));
  function guess(name) {
    const b = name.toLowerCase();
    for (const [k, [, re]] of Object.entries(ROLES)) if (re.test(b)) return k;
    return "";
  }
  function addFiles(list) {
    const bad = [];
    for (const f of list) {
      if (!/\.xls[xm]$/i.test(f.name)) {
        bad.push(f.name);
        continue;
      }
      if (files.some((x) => x.file.name === f.name)) continue;
      files.push({ file: f, role: guess(f.name) });
    }
    renderFiles();
    if (bad.length) $("#fmsg").textContent = "Not accepted (only .xlsx files work \u2014 in Excel use Save As > Excel Workbook): " + bad.join(", ");
  }
  function renderFiles() {
    const tb = $("#files tbody");
    tb.innerHTML = "";
    files.forEach((x, i) => {
      const tr = document.createElement("tr");
      const opts = ['<option value="">\u2014 not used \u2014</option>'].concat(Object.entries(ROLES).map(([k, [l]]) => `<option value="${k}" ${x.role === k ? "selected" : ""}>${l}</option>`)).join("");
      tr.innerHTML = `<td>${esc(x.file.name)}</td><td><select data-i="${i}">${opts}</select></td><td><button data-rm="${i}">Remove</button></td>`;
      tb.appendChild(tr);
    });
    $("#files").classList.toggle("hide", !files.length);
    tb.querySelectorAll("select").forEach((s) => s.onchange = () => {
      files[+s.dataset.i].role = s.value;
      check();
    });
    tb.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => {
      files.splice(+b.dataset.rm, 1);
      renderFiles();
    });
    check();
  }
  function check() {
    const roles = files.map((x) => x.role).filter(Boolean);
    const dup = roles.find((r, i) => roles.indexOf(r) !== i);
    const missing = ["td", "gl"].filter((r) => !roles.includes(r));
    const opt = Object.keys(ROLES).filter((r) => !roles.includes(r) && !["td", "gl"].includes(r)).map((r) => ROLES[r][0]);
    let msg = "";
    if (dup) msg = `Two files are marked "${ROLES[dup][0]}" \u2014 pick one.`;
    else if (missing.length) msg = "Still needed: " + missing.map((r) => ROLES[r][0]).join(", ") + ".";
    else if (opt.length) msg = "Optional reports not added (some checks will be skipped): " + opt.join(", ") + ".";
    else if (files.length) msg = "All 7 reports ready.";
    $("#fmsg").textContent = msg;
    $("#run").disabled = !(files.length && !dup && !missing.length);
  }
  var drop = $("#drop");
  drop.onclick = () => $("#pick").click();
  $("#pick").onchange = (e) => {
    addFiles([...e.target.files]);
    e.target.value = "";
  };
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  }));
  drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
  $("#payee").onchange = (e) => {
    payeeFile = e.target.files[0] || null;
  };
  $("#rulesReset").onclick = () => {
    $("#rules").value = defaultRules;
    store.set("books.rules", defaultRules);
    $("#rulesMsg").textContent = "Reset.";
  };
  function setStatus(msg, pct) {
    $("#status").textContent = msg;
    if (pct != null) $("#bar").style.width = pct + "%";
  }
  var tick = () => new Promise((r) => setTimeout(r, 30));
  $("#run").onclick = async () => {
    const rules = $("#rules").value;
    let rulesObj;
    try {
      rulesObj = JSON.parse(rules);
    } catch (err) {
      setStatus("The rules text is not valid JSON: " + err.message, 0);
      $("#status").classList.add("bad");
      return;
    }
    $("#status").classList.remove("bad");
    $("#run").disabled = true;
    try {
      const rowsByRole = {};
      const use = files.filter((x) => x.role);
      for (let i = 0; i < use.length; i++) {
        setStatus(`Reading ${use[i].file.name}\u2026`, 5 + 60 * i / use.length);
        await tick();
        rowsByRole[use[i].role] = await parseWorkbookRows(await use[i].file.arrayBuffer(), window.ExcelJS);
      }
      let payeeRows = null;
      if (payeeFile) payeeRows = loadPayeeList(await parseWorkbookRows(await payeeFile.arrayBuffer(), window.ExcelJS));
      setStatus("Reviewing every line\u2026", 70);
      await tick();
      const rv = runReview({ rowsByRole, rules: rulesObj, payeeRows, company: $("#company").value.trim() });
      setStatus("Building the Excel report\u2026", 88);
      await tick();
      const detected = Object.fromEntries(use.map((x) => [x.role, x.file.name]));
      const out = await buildReport(rv, { company: $("#company").value.trim(), rulesName: "rules.json", ExcelJS: window.ExcelJS, detected });
      xlsxBytes = await out.workbook.xlsx.writeBuffer();
      setStatus("Done.", 100);
      show(out.summary);
    } catch (err) {
      console.error(err);
      setStatus("Problem: " + (err && err.message ? err.message : err), 0);
      $("#status").classList.add("bad");
    }
    $("#run").disabled = false;
  };
  function table(el, head, rows) {
    el.innerHTML = "<thead><tr>" + head.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((c, i) => `<td class="${head[i].num ? "num" : ""}">${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
  }
  function show(r) {
    $("#out").classList.remove("hide");
    $("#period").textContent = `Period ${r.period[0]} to ${r.period[1]} \xB7 ${r.lines.total.toLocaleString()} ledger lines (${r.lines.checked.toLocaleString()} checked, ${r.lines.flagged.toLocaleString()} flagged)`;
    const s = r.severity;
    $("#stats").innerHTML = [["Total exceptions", r.total], ["High", s.High || 0], ["Medium", s.Medium || 0], ["Low", s.Low || 0], ["Reconciliation mismatches", r.recon_bad]].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
    $("#notes").innerHTML = (r.run_problems.length ? `<span class="bad">Some checks were skipped: ${r.run_problems.map((p) => esc(p.step + " \u2013 " + p.message)).join("; ")}</span><br>` : "") + r.notes.map(esc).join("<br>");
    table(
      $("#ck"),
      [{ t: "Area" }, { t: "Issue" }, { t: "Lines", num: 1 }, { t: "Amount", num: 1 }, { t: "Where" }],
      r.checklist.map((c) => [esc(c.area), esc(c.issue), c.lines ?? "", fmt(c.amount), esc(c.where_to_look)])
    );
    table(
      $("#top"),
      [{ t: "Ref" }, { t: "Sev" }, { t: "Date" }, { t: "Name" }, { t: "Amount", num: 1 }, { t: "Issue" }],
      r.top.map((t) => [t.ref, `<span class="tag ${t.sev}">${t.sev}</span>`, t.date, esc(t.name), fmt(t.amount), esc(t.issue)])
    );
    table($("#bychk"), [{ t: "Check" }, { t: "High", num: 1 }, { t: "Medium", num: 1 }, { t: "Low", num: 1 }, { t: "Total", num: 1 }], r.by_check.map((c) => [esc(c.check), c.High || "", c.Medium || "", c.Low || "", c.total]));
    const nr = r.new_related || [];
    $("#newrel").classList.toggle("hide", !nr.length);
    $("#newrelList").innerHTML = nr.map((c) => `<div class="row" style="margin-bottom:8px"><b>${esc(c)}</b><button data-conf="${esc(c)}">Confirm as related company</button><span class="mute"></span></div>`).join("");
    $("#newrelList").querySelectorAll("[data-conf]").forEach((b) => b.onclick = () => {
      const o = JSON.parse($("#rules").value);
      o.related_parties = o.related_parties || {};
      o.related_parties.names = [.../* @__PURE__ */ new Set([...o.related_parties.names || [], b.dataset.conf])];
      $("#rules").value = JSON.stringify(o, null, 2);
      store.set("books.rules", $("#rules").value);
      b.disabled = true;
      b.nextElementSibling.textContent = "Added and remembered. Run the review again to apply.";
    });
    const ck = r.checkpoints || [];
    $("#ckpt").classList.toggle("hide", !ck.length);
    table(
      $("#ckptTable"),
      [{ t: "Checkpoint" }, { t: "Date" }, { t: "Type" }, { t: "Name" }, { t: "Memo" }, { t: "Account" }, { t: "Amount", num: 1 }],
      ck.map((c) => [esc(c.checkpoint), c.date, esc(c.type), esc(c.name), esc(c.memo), esc(c.account), fmt(c.amount)])
    );
    $("#out").scrollIntoView({ behavior: "smooth" });
  }
  $("#dl").onclick = () => {
    const c = ($("#company").value.trim() || "Books").replace(/[^\w-]+/g, "_");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([xlsxBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `${c}_Review_${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.xlsx`;
    a.click();
  };
  window.__booksReady = true;
})();
