// Port of build_outputs(): builds the Excel review workbook with ExcelJS and the summary object used by the web UI.
// ExcelJS is resolved from opts.ExcelJS, then globalThis.ExcelJS (browser vendor build), then the npm package (Node).
import { SEV_RANK, RANK_SEV, pyTitle, isoDate, npRound, npSum, nz } from './engine.js';

let _ExcelJS = globalThis.ExcelJS || null;

const HDR_FILL = 'FF1F3A5F';
const SEV_FILL = { High: 'FFF8CBAD', Medium: 'FFFFE699', Low: 'FFE2EFDA', Info: 'FFDDEBF7' };
const NUMFMT = '#,##0.00';
const AMT_COLS = new Set(['amount', 'expected', 'actual', 'difference', 'net_activity', 'gross_amount']);
const SEVS = ['High', 'Medium', 'Low', 'Info'];
const cmpv = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// xlsxwriter writes numbers with 16 significant digits; mimic so float noise (1519.8600000000001) never reaches the sheet
const num16 = v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(16)) : v);
const blank = v => (v === undefined || v === '' ? null : num16(v));

function solid(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb }, bgColor: { argb } }; }
function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function styleHeader(cell) {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = solid(HDR_FILL);
  cell.alignment = { wrapText: true, vertical: 'top' };
  const b = { style: 'thin' };
  cell.border = { top: b, left: b, bottom: b, right: b };
}

/** columns: array of keys; rows: array of arrays (same order). opts: {widths, sev, sevCol(false), textFlag} */
function addSheet(wb, name, columns, rows, opts = {}) {
  const ws = wb.addWorksheet(name);
  const widths = opts.widths || {};
  ws.addRow(columns.map(c => pyTitle(c.replace(/_/g, ' '))));
  ws.getRow(1).eachCell(styleHeader);
  const spec = columns.map(c => {
    const isAmt = AMT_COLS.has(c);
    const w = widths[c] === undefined ? 14 : widths[c];
    return { c, isAmt, w: isAmt ? 14 : w, wrap: !isAmt && w > 30 };
  });
  spec.forEach((s, j) => { ws.getColumn(j + 1).width = s.w + 0.7109375; });
  for (const r of rows) {
    const row = ws.addRow(r.map(blank));
    for (let j = 0; j < spec.length; j++) {
      const v = r[j];
      const s = spec[j];
      if (v instanceof Date) { row.getCell(j + 1).numFmt = 'YYYY-MM-DD'; }
      else if (s.isAmt) row.getCell(j + 1).numFmt = NUMFMT;
      else if (s.wrap) row.getCell(j + 1).alignment = { wrapText: true, vertical: 'top' };
      if (s.isAmt && v instanceof Date === false) row.getCell(j + 1).numFmt = NUMFMT;
    }
  }
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, rows.length + 1), column: columns.length } };
  const n = rows.length;
  if (opts.sev && n) {
    const j = columns.indexOf('severity');
    if (j >= 0) {
      const L = colLetter(j + 1);
      ws.addConditionalFormatting({
        ref: `${L}2:${L}${n + 1}`,
        rules: SEVS.map((s, i) => ({
          type: 'cellIs', operator: 'equal', formulae: [`"${s}"`], priority: i + 1,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SEV_FILL[s] } }, font: s === 'High' ? { bold: true } : {} },
        })),
      });
    }
  }
  if (opts.textFlag && n) {
    const { col, text, argb } = opts.textFlag;
    const L1 = colLetter(col[0] + 1), L2 = colLetter(col[1] + 1);
    ws.addConditionalFormatting({
      ref: `${L1}2:${L2}${n + 1}`,
      rules: [{ type: 'containsText', operator: 'containsText', text, formulae: [`NOT(ISERROR(SEARCH("${text}",${L1}2)))`], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } }, font: argb === SEV_FILL.High ? { bold: true } : {} } }],
    });
  }
  return ws;
}

function cellOrBlank(v) { return v === undefined ? null : v; }

export function buildReport(rv, opts = {}) {
  const ExcelJS = opts.ExcelJS || _ExcelJS;
  if (!ExcelJS) throw new Error('ExcelJS not available: pass opts.ExcelJS or load exceljs.min.js first');
  const company = opts.company ?? rv.company ?? '';
  const rulesName = opts.rulesName || 'built-in';

  // ---------------- sorted flags
  const fl = rv.flags.map((f, i) => ({ ...f, _i: i, sev_rank: SEV_RANK[f.severity], abs_amt: f.amount === null || f.amount === undefined || Number.isNaN(f.amount) ? 0 : Math.abs(f.amount) }));
  fl.sort((a, b) => (b.sev_rank - a.sev_rank) || (b.abs_amt - a.abs_amt) || (a._i - b._i));
  fl.forEach((f, i) => { f.ref = `EX-${String(i + 1).padStart(4, '0')}`; });
  const lineFl = fl.filter(f => f.line_id >= 0);

  const cnt = new Map(), worst = new Map(), firstIssue = new Map();
  for (const f of lineFl) {
    cnt.set(f.line_id, (cnt.get(f.line_id) || 0) + 1);
    if (!worst.has(f.line_id) || f.sev_rank > worst.get(f.line_id)) worst.set(f.line_id, f.sev_rank);
    if (!firstIssue.has(f.line_id)) firstIssue.set(f.line_id, f.issue);
  }
  const td = rv.td.map(l => {
    const n = cnt.get(l.id) || 0;
    return {
      ...l, n_flags: n, worst: worst.has(l.id) ? RANK_SEV[worst.get(l.id)] : '', top_issue: firstIssue.get(l.id) || '',
      basis: rv.basis.get(l.id) ?? '', status: n > 0 ? 'FLAGGED' : (l.is_funding ? 'Funding side' : 'OK'),
    };
  });
  const rc = rv.recon;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Summary');
  ws.getColumn(1).width = 34 + 0.7109375;
  for (let c = 2; c <= 5; c++) ws.getColumn(c).width = 16 + 0.7109375;
  ws.getColumn(6).width = 70 + 0.7109375;
  const put = (r, c, v, style) => { const cell = ws.getCell(r + 1, c + 1); if (v !== null && v !== undefined && v !== '') cell.value = num16(v); if (style) style(cell); return cell; };
  const bold = cell => { cell.font = { bold: true }; };
  const sevStyle = s => cell => { cell.fill = solid(SEV_FILL[s]); if (s === 'High') cell.font = { bold: true }; };

  const lines = rv.td.length, checked = rv.td.filter(l => !l.is_funding).length;
  const fmtN = n => n.toLocaleString('en-US');
  put(0, 0, `Books Review - ${company || 'Exceptions Report'}`, c => { c.font = { bold: true, size: 16 }; });
  put(1, 0, `Period reviewed: ${isoDate(rv.period[0])} to ${isoDate(rv.period[1])}   |   Lines reviewed: ${fmtN(lines)} (${fmtN(checked)} account-side lines checked)`);
  const now = new Date(); const p2 = n => String(n).padStart(2, '0');
  put(2, 0, `Generated ${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}   |   Rules: ${rulesName}`);
  const r0 = 5;
  put(r0, 0, 'Exceptions by severity', bold);
  const sevCount = {}; for (const s of SEVS) sevCount[s] = fl.filter(f => f.severity === s).length;
  SEVS.forEach((s, i) => { put(r0 + 1 + i, 0, s, sevStyle(s)); put(r0 + 1 + i, 1, sevCount[s]); });
  put(r0 + 5, 0, 'Total exceptions', bold); put(r0 + 5, 1, fl.length);
  const linesFlagged = new Set(lineFl.map(f => f.line_id)).size;
  put(r0 + 6, 0, 'Distinct ledger lines flagged', bold); put(r0 + 6, 1, linesFlagged);
  const reconBad = rc.filter(r => r.status === 'MISMATCH').length;
  put(r0 + 7, 0, 'Reconciliation checks failing', bold); put(r0 + 7, 1, reconBad);
  const tl = td.filter(l => !l.is_funding);
  const noBasis = tl.filter(l => l.basis === 'none').length;
  const cov = tl.length ? (tl.length - noBasis) / tl.length : NaN;
  const pctStr = Number.isNaN(cov) ? 'nan%' : pctFmt(cov);
  put(r0 + 8, 0, 'Account-side lines with a rule/history basis', bold); put(r0 + 8, 1, pctStr);
  put(r0 + 8, 2, `(${fmtN(noBasis)} lines had NO basis to judge - see Name Audit 'basis' column; extend rules.json to cover them)`);

  // by check
  const r1 = r0 + 11;
  put(r1, 0, 'Exceptions by check', bold);
  ['Check', 'High', 'Medium', 'Low', 'Info', 'Total'].forEach((h, j) => put(r1 + 1, j, h, styleHeader));
  const pv = new Map();
  for (const f of fl) { let e = pv.get(f.check); if (!e) { e = { High: 0, Medium: 0, Low: 0, Info: 0 }; pv.set(f.check, e); } e[f.severity]++; }
  const pvKeys = [...pv.keys()].sort(cmpv);
  pvKeys.forEach((k, i) => {
    const v = pv.get(k);
    put(r1 + 2 + i, 0, k);
    SEVS.forEach((s, j) => put(r1 + 2 + i, 1 + j, v[s]));
    put(r1 + 2 + i, 5, v.High + v.Medium + v.Low + v.Info);
  });
  const r2 = r1 + 4 + pvKeys.length;
  put(r2, 0, 'Reconciliation status', bold);
  ['Check', 'Items', 'Mismatches'].forEach((h, j) => put(r2 + 1, j, h, styleHeader));
  const rg = new Map();
  for (const r of rc) { let e = rg.get(r.check); if (!e) { e = { items: 0, bad: 0 }; rg.set(r.check, e); } e.items++; if (r.status === 'MISMATCH') e.bad++; }
  const rgKeys = [...rg.keys()].sort(cmpv);
  rgKeys.forEach((k, i) => { put(r2 + 2 + i, 0, k); put(r2 + 2 + i, 1, rg.get(k).items); put(r2 + 2 + i, 2, rg.get(k).bad); });
  const r3 = r2 + 4 + rgKeys.length;
  put(r3, 0, 'Top 15 items to look at first', bold);
  ['Ref', 'Severity', 'Date', 'Name', 'Amount', 'Issue'].forEach((h, j) => put(r3 + 1, j, h, styleHeader));
  lineFl.slice(0, 15).forEach((x, i) => {
    put(r3 + 2 + i, 0, x.ref); put(r3 + 2 + i, 1, x.severity, sevStyle(x.severity));
    put(r3 + 2 + i, 2, x.date ? isoDate(x.date) : ''); put(r3 + 2 + i, 3, nz(x.name));
    put(r3 + 2 + i, 4, x.amount, c => { c.numFmt = NUMFMT; }); put(r3 + 2 + i, 5, x.issue);
  });
  const r4 = r3 + 19;
  put(r4, 0, 'Notes & limits', bold);
  const notes = [...rv.notes,
    'Account/name suggestions are rule- and history-based. They are leads for a human reviewer, not automatic corrections.',
    'Reviewer columns (Action / Notes) on the Exceptions tab are blank for you to fill in.',
    "'Funding side' lines (bank, credit card, A/R, A/P, undeposited funds) are not categorised; they are checked via duplicates and reconciliations."];
  notes.forEach((n, i) => put(r4 + 1 + i, 0, n));

  // ---------------- Exceptions + theme tabs
  const exCols = ['ref', 'severity', 'check', 'issue', 'detail', 'date', 'type', 'num', 'name', 'memo', 'account', 'cls', 'amount', 'split', 'suggested_account', 'suggested_name', 'confidence', 'source', 'reviewer_action', 'reviewer_notes'];
  const exRows = fl.map(f => exCols.map(c => (c === 'reviewer_action' || c === 'reviewer_notes' ? null : cellOrBlank(f[c]))));
  const exW = { issue: 48, detail: 60, memo: 50, account: 28, name: 26, suggested_account: 26, suggested_name: 24 };
  addSheet(wb, 'Exceptions', exCols, exRows, { widths: exW, sev: true });
  const themes = {
    'Account Review': ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C3'], 'Name Review': ['A1', 'C1', 'C2', 'C4', 'C5'],
    Duplicates: ['D1', 'D2', 'D3'], Unusual: ['A2', 'E1', 'E2', 'E4', 'E5', 'E6', 'E7'],
  };
  const ci = exCols.indexOf('check');
  for (const [tab, pref] of Object.entries(themes)) addSheet(wb, tab, exCols, exRows.filter(r => pref.includes(r[ci].slice(0, 2))), { widths: exW, sev: true });

  // ---------------- Reconciliation
  const rcCols = ['check', 'item', 'expected', 'actual', 'difference', 'status', 'note'];
  addSheet(wb, 'Reconciliation', rcCols, rc.map(r => rcCols.map(c => cellOrBlank(r[c]))), { widths: { item: 60, note: 80, check: 34 }, textFlag: { col: [0, 6], text: 'MISMATCH', argb: SEV_FILL.High } });

  // ---------------- Name Audit
  const tl2 = td.filter(l => !l.is_funding && l.name !== null);
  const bg = new Map();
  for (const l of tl2) { let e = bg.get(l.name); if (!e) { e = { all: true, any: false }; bg.set(l.name, e); } const none = l.basis === 'none'; if (!none) e.all = false; if (none) e.any = true; }
  const nm = rv.name_master_rows.map(r => ({ ...r, basis: bg.has(r.name) ? (bg.get(r.name).all ? 'none' : bg.get(r.name).any ? 'partial' : 'covered') : '(funding side only)' }));
  nm.sort((a, b) => cmpv(a.basis, b.basis) || (b.gross_amount - a.gross_amount));
  const nmCols = ['name', 'role', 'lines', 'gross_amount', 'first_used', 'last_used', 'accounts_used', 'notes', 'basis'];
  addSheet(wb, 'Name Audit', nmCols, nm.map(r => nmCols.map(c => cellOrBlank(r[c]))), { widths: { name: 38, accounts_used: 70, notes: 70 } });

  // ---------------- Account Audit
  const flaggedIds = new Set(lineFl.map(f => f.line_id));
  const ag = new Map();
  for (const l of rv.td) {
    const k = l.account + '\u0001' + l.acct_type;
    let e = ag.get(k); if (!e) { e = { account: l.account, acct_type: l.acct_type, lines: 0, amts: [] }; ag.set(k, e); }
    e.lines++; e.amts.push(l.amount);
  }
  const namesBy = new Map(), flaggedBy = new Map();
  for (const l of rv.td) {
    let s = namesBy.get(l.account); if (!s) { s = new Set(); namesBy.set(l.account, s); }
    if (l.name !== null) s.add(l.name);
    if (flaggedIds.has(l.id)) flaggedBy.set(l.account, (flaggedBy.get(l.account) || 0) + 1);
  }
  let am = [...ag.values()].sort((a, b) => cmpv(a.account, b.account) || cmpv(a.acct_type, b.acct_type)).map(e => {
    const fl_ = flaggedBy.get(e.account) || 0;
    let s = 0, c = 0; for (const v of e.amts) { const y = v - c; const t = s + y; c = t - s - y; s = t; }
    return { account: e.account, acct_type: e.acct_type, lines: e.lines, net_activity: s, names_used: namesBy.get(e.account).size, flagged_lines: fl_, pct_flagged: npRound(fl_ / e.lines, 3) };
  });
  // pandas sort_values('flagged_lines', ascending=False) uses numpy's (CPU-dependent, non-stable) quicksort, so the order of
  // equal counts in the Python workbook is arbitrary; we use a stable order (ties keep account A-Z).
  am = am.map((r, i) => ({ r, i })).sort((a, b) => (b.r.flagged_lines - a.r.flagged_lines) || (a.i - b.i)).map(x => x.r);
  const amCols = ['account', 'acct_type', 'lines', 'net_activity', 'names_used', 'flagged_lines', 'pct_flagged'];
  addSheet(wb, 'Account Audit', amCols, am.map(r => amCols.map(c => r[c])), { widths: { account: 50 } });

  // ---------------- Vendor-Account Map
  let lr = [];
  for (const [fam, hist] of [['Vendor-side', rv.hist_name_v], ['Customer-side', rv.hist_name_c]]) {
    for (const [k, h] of hist) {
      if (h.n >= 3) lr.push({ family: fam, name: k, lines: h.n, usual_account: h.items[0][0], share: npRound(h.items[0][1] / h.n, 3), other_accounts: h.items.slice(1, 5).map(([a, c]) => `${a} (${c})`).join('; '), approved_account: null });
    }
  }
  lr = lr.map((r, i) => ({ r, i })).sort((a, b) => cmpv(a.r.family, b.r.family) || (b.r.lines - a.r.lines) || (a.i - b.i)).map(x => x.r);
  const lrCols = ['family', 'name', 'lines', 'usual_account', 'share', 'other_accounts', 'approved_account'];
  addSheet(wb, 'Vendor-Account Map', lrCols, lr.map(r => lrCols.map(c => r[c])), { widths: { name: 38, usual_account: 34, other_accounts: 70 } });

  // ---------------- All Lines
  const alCols = ['line', 'status', 'worst', 'n_flags', 'top_issue', 'source_row', 'date', 'type', 'num', 'name', 'memo', 'cls', 'account', 'split', 'amount', 'acct_type', 'basis'];
  const alRows = td.map(l => [l.id, l.status, l.worst, l.n_flags, l.top_issue, l.src_row, l.date, l.type, l.num, l.name, l.memo, l.cls, l.account, l.split, l.amount, l.acct_type, l.basis]);
  addSheet(wb, 'All Lines', alCols, alRows, { widths: { top_issue: 50, memo: 50, account: 30, name: 26 }, textFlag: { col: [1, 1], text: 'FLAGGED', argb: SEV_FILL.Medium } });

  // ---------------- Checklist etc.
  const ckCols = ['area', 'issue', 'lines', 'amount', 'where_to_look', 'status', 'reviewer_notes'];
  const ckWs = addSheet(wb, 'Review Checklist', ckCols, rv.checklist.map(r => ckCols.map(c => cellOrBlank(r[c]))), { widths: { issue: 80, where_to_look: 36, reviewer_notes: 40, area: 16 } });
  if (rv.checklist.length) {
    ckWs.dataValidations.add(`F2:F${rv.checklist.length + 1}`, { type: 'list', allowBlank: true, formulae: ['"Open,In progress,Resolved,Accepted as is"'] });
  }
  const aCols = ['worker', 'month', 'entity', 'amount', 'share_of_worker_month', 'rule'];
  addSheet(wb, 'Upwork Allocation', aCols, rv.alloc_rows.map(r => aCols.map(c => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
  const uCols = ['month', 'upwork_charged', 'hours_billed', 'difference', 'status'];
  addSheet(wb, 'Upwork Recharge', uCols, rv.recharge_rows.map(r => uCols.map(c => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
  const cCols = ['date', 'amount', 'bank_memo', 'expensed_to', 'payee', 'form_1099', 'status'];
  addSheet(wb, 'Cash & 1099', cCols, rv.cash_rows.map(r => cCols.map(c => cellOrBlank(r[c]))), { widths: { rule: 60, bank_memo: 50, expensed_to: 30, status: 34 } });
  const lgCols = ['step', 'status', 'message'];
  addSheet(wb, 'Run Log', lgCols, rv.run_log.map(r => lgCols.map(c => r[c])), { widths: { step: 40, message: 90 } });
  addSheet(wb, 'Related Parties', ['related_party'], [...rv.related].sort(cmpv).map(x => [x]), { widths: { related_party: 40 } });
  const rrCols = ['id', 'applies_to', 'pattern', 'expected_accounts', 'severity', 'note'];
  addSheet(wb, 'Rules Used', rrCols, rv.rules.keyword_rules.map(r => [r.id, r.scope, r.pattern, (r.expected || []).join(', '), r.severity, r.note]), { widths: { pattern: 60, expected_accounts: 60, note: 60 } });

  // ---------------- UI summary object
  const by_check = pvKeys.map(k => { const v = pv.get(k); return { check: k, High: v.High, Medium: v.Medium, Low: v.Low, Info: v.Info, total: v.High + v.Medium + v.Low + v.Info }; });
  const summary = {
    total: fl.length,
    severity: { High: sevCount.High, Medium: sevCount.Medium, Low: sevCount.Low, Info: sevCount.Info },
    recon_bad: reconBad,
    period: [isoDate(rv.period[0]), isoDate(rv.period[1])],
    lines: { total: lines, checked, flagged: linesFlagged },
    run_problems: rv.run_log.filter(x => x.status !== 'OK'),
    checklist: rv.checklist,
    by_check,
    top: lineFl.slice(0, 25).map(f => ({ ref: f.ref, sev: f.severity, date: f.date ? isoDate(f.date) : '', name: f.name || '', amount: f.amount, issue: f.issue })),
    notes: notes.slice(0, rv.notes.length),
    detected: opts.detected || null,
    coverage: Number.isNaN(cov) ? null : cov,
    no_basis_lines: noBasis,
  };
  return { workbook: wb, summary, flags: fl, recon: rc };
}

function pctFmt(x) { // python f"{x:.0%}"
  const v = x * 100; const f = Math.floor(v); const d = v - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);
  return r + '%';
}
