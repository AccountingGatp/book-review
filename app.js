import { runReview, loadPayeeList, VERSION } from "./src/engine.js";
import { parseWorkbookRows } from "./src/xlsx_io.js";
import { buildReport } from "./src/build_report.js";
import DEFAULT_RULES from "./rules.json";
const $ = (s) => document.querySelector(s);
const ROLES = {
  td: "Transaction Detail by Account",
  gl: "General Ledger",
  pl: "Profit & Loss Detail",
  bs: "Balance Sheet Detail",
  tb: "Trial Balance",
  ar: "A/R Aging",
  ap: "A/P Aging",
};
// Nothing company-specific is in the code: file-name patterns, thresholds, accounts and rules all come from the rules text.
function deepMerge(base, over) {
  if (over === undefined) return base;
  if (Array.isArray(base) || base === null || typeof base !== "object" || Array.isArray(over) || over === null || typeof over !== "object") return over;
  const o = { ...base };
  for (const k of Object.keys(over)) o[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return o;
}
function currentRules() {
  let user = {};
  try { user = JSON.parse($("#rules").value || "{}"); } catch (_) {}
  return { merged: deepMerge(DEFAULT_RULES, user), user };
}
// file names the Python engine recognises
const fmt = (n) => (n == null ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let files = [];            // {file, role}
let defaultRules = "";
let payeeFile = null;
let xlsxBytes = null;

defaultRules = JSON.stringify(DEFAULT_RULES, null, 2);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
$("#rules").value = store.get("books.rules") || defaultRules;
$("#company").value = store.get("books.company") || "";
$("#rulesDl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("#rules").value], { type: "application/json" })); a.download = "rules.json"; a.click(); };
$("#rulesLoad").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const t = await f.text(); JSON.parse(t); $("#rules").value = t; store.set("books.rules", t); $("#rulesMsg").textContent = "Rules loaded from " + f.name; } catch (err) { $("#rulesMsg").textContent = "That file is not valid JSON."; } };
$("#rules").addEventListener("change", () => store.set("books.rules", $("#rules").value));
$("#company").addEventListener("change", () => store.set("books.company", $("#company").value));

function guess(name) {
  const b = name.toLowerCase().replace(/[_\-.]+/g, " ");
  const pats = currentRules().merged.file_patterns || {};
  for (const [k, ps] of Object.entries(pats)) { try { if (new RegExp(ps).test(b)) return k; } catch (_) {} }
  return "";
}
function addFiles(list) {
  const bad = [];
  for (const f of list) {
    if (!/\.xls[xm]$/i.test(f.name)) { bad.push(f.name); continue; }
    if (files.some((x) => x.file.name === f.name)) continue;
    files.push({ file: f, role: guess(f.name) });
  }
  renderFiles();
  if (bad.length) $("#fmsg").textContent = "Not accepted (only .xlsx files work — in Excel use Save As > Excel Workbook): " + bad.join(", ");
}
function renderFiles() {
  const tb = $("#files tbody");
  tb.innerHTML = "";
  files.forEach((x, i) => {
    const tr = document.createElement("tr");
    const opts = ['<option value="">— not used —</option>'].concat(Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${x.role === k ? "selected" : ""}>${l}</option>`)).join("");
    tr.innerHTML = `<td>${esc(x.file.name)}</td><td><select data-i="${i}">${opts}</select></td><td><button data-rm="${i}">Remove</button></td>`;
    tb.appendChild(tr);
  });
  $("#files").classList.toggle("hide", !files.length);
  tb.querySelectorAll("select").forEach((s) => (s.onchange = () => { files[+s.dataset.i].role = s.value; check(); }));
  tb.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); renderFiles(); }));
  check();
}
function check() {
  const roles = files.map((x) => x.role).filter(Boolean);
  const dup = roles.find((r, i) => roles.indexOf(r) !== i);
  const missing = ["td", "gl"].filter((r) => !roles.includes(r));
  const opt = Object.keys(ROLES).filter((r) => !roles.includes(r) && !["td", "gl"].includes(r)).map((r) => ROLES[r]);
  let msg = "";
  if (dup) msg = `Two files are marked "${ROLES[dup]}" — pick one.`;
  else if (missing.length) msg = "Still needed: " + missing.map((r) => ROLES[r]).join(", ") + ".";
  else if (opt.length) msg = "Optional reports not added (some checks will be skipped): " + opt.join(", ") + ".";
  else if (files.length) msg = "All 7 reports ready.";
  $("#fmsg").textContent = msg;
  $("#run").disabled = !(files.length && !dup && !missing.length);
}

const drop = $("#drop");
drop.onclick = () => $("#pick").click();
$("#pick").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
$("#payee").onchange = (e) => { payeeFile = e.target.files[0] || null; };
$("#rulesReset").onclick = () => { $("#rules").value = defaultRules; store.set("books.rules", defaultRules); $("#rulesMsg").textContent = "Reset."; };

function setStatus(msg, pct) { $("#status").textContent = msg; if (pct != null) $("#bar").style.width = pct + "%"; }

const tick = () => new Promise((r) => setTimeout(r, 30));
$("#run").onclick = async () => {
  const rules = $("#rules").value;
  let rulesObj;
  let filled = [];
  try { const u = JSON.parse(rules); rulesObj = deepMerge(DEFAULT_RULES, u); filled = Object.keys(DEFAULT_RULES).filter((k) => !(k in u) && !k.startsWith("_")); } catch (err) { setStatus("The rules text is not valid JSON: " + err.message, 0); $("#status").classList.add("bad"); return; }
  $("#status").classList.remove("bad");
  $("#run").disabled = true;
  try {
    const rowsByRole = {};
    const use = files.filter((x) => x.role);
    for (let i = 0; i < use.length; i++) {
      setStatus(`Reading ${use[i].file.name}…`, 5 + (60 * i) / use.length); await tick();
      rowsByRole[use[i].role] = await parseWorkbookRows(await use[i].file.arrayBuffer(), window.ExcelJS);
    }
    let payeeRows = null;
    if (payeeFile) payeeRows = loadPayeeList(await parseWorkbookRows(await payeeFile.arrayBuffer(), window.ExcelJS));
    setStatus("Reviewing every line…", 70); await tick();
    const rv = runReview({ rowsByRole, rules: rulesObj, payeeRows, company: $("#company").value.trim() });
    setStatus("Building the Excel report…", 88); await tick();
    const detected = Object.fromEntries(use.map((x) => [x.role, x.file.name]));
    const out = await buildReport(rv, { company: $("#company").value.trim(), rulesName: "rules.json", ExcelJS: window.ExcelJS, detected });
    xlsxBytes = await out.workbook.xlsx.writeBuffer();
    setStatus("Done.", 100);
    if (filled.length) out.summary.notes.push("These settings were missing from your rules, so the standard values from the bundled rules.json were used: " + filled.join(", ") + ".");
    show(out.summary);
  } catch (err) {
    console.error(err);
    setStatus("Problem: " + (err && err.message ? err.message : err), 0); $("#status").classList.add("bad");
  }
  $("#run").disabled = false;
};

function table(el, head, rows) {
  el.innerHTML = "<thead><tr>" + head.map((h) => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("") + "</tr></thead><tbody>" +
    rows.map((r) => "<tr>" + r.map((c, i) => `<td class="${head[i].num ? "num" : ""}">${c}</td>`).join("") + "</tr>").join("") + "</tbody>";
}
function show(r) {
  $("#out").classList.remove("hide");
  $("#period").textContent = `Period ${r.period[0]} to ${r.period[1]} · ${r.lines.total.toLocaleString()} ledger lines (${r.lines.checked.toLocaleString()} checked, ${r.lines.flagged.toLocaleString()} flagged)`;
  const s = r.severity;
  const qd = r.queue || { items: 0, high: 0, medium: 0, lines: 0, rows: [] };
  $("#stats").innerHTML = [["Items to review", qd.items], ["High", qd.high], ["Medium", qd.medium], ["Ledger lines in them", qd.lines], ["Optional flags (not in the list)", (s.Low || 0) + (s.Info || 0)], ["Report differences (grouped in the list)", qd.recon_items || 0]]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#notes").innerHTML = (r.run_problems.length ? `<span class="bad">Some checks were skipped: ${r.run_problems.map((p) => esc(p.step + " – " + p.message)).join("; ")}</span><br>` : "") + r.notes.map(esc).join("<br>");
  table($("#ck"), [{ t: "Area" }, { t: "Issue" }, { t: "Lines", num: 1 }, { t: "Amount", num: 1 }, { t: "Where" }],
    r.checklist.map((c) => [esc(c.area), esc(c.issue), c.lines ?? "", fmt(c.amount), esc(c.where_to_look)]));
  const okable = (t) => t.lines > 0 && !/^(D|E7|F|G)/.test(t.check) && t.account;
  table($("#top"), [{ t: "Item" }, { t: "Sev" }, { t: "Lines", num: 1 }, { t: "Name" }, { t: "Account" }, { t: "Amount", num: 1 }, { t: "What to do" }, { t: "If this is fine" }],
    qd.rows.map((t, i) => [t.item, `<span class="tag ${t.sev}">${t.sev}</span>`, t.lines || "", esc(t.name), esc(t.account), fmt(t.total), esc(t.what + (t.suggested ? " (suggested: " + t.suggested + ")" : "")),
      okable(t) ? `<button data-ok="${i}">Always OK</button>` : ""]));
  $("#top").querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => {
    const t = qd.rows[+b.dataset.ok];
    let o; try { o = JSON.parse($("#rules").value); } catch (_) { alert("The rules text is not valid JSON."); return; }
    if (t.name) {
      o.approved_pairs = o.approved_pairs || [];
      if (!o.approved_pairs.some((x) => x.name === t.name && x.account === t.account)) o.approved_pairs.push({ name: t.name, account: t.account });
    } else if (t.memo_key) {
      o.approved_memo = o.approved_memo || [];
      if (!o.approved_memo.some((x) => x.memo_key === t.memo_key && x.account === t.account)) o.approved_memo.push({ memo_key: t.memo_key, account: t.account });
    } else return;
    $("#rules").value = JSON.stringify(o, null, 2); store.set("books.rules", $("#rules").value);
    b.disabled = true; b.textContent = "Saved - applies on the next run";
  }));
  table($("#bychk"), [{ t: "Check" }, { t: "High", num: 1 }, { t: "Medium", num: 1 }, { t: "Low", num: 1 }, { t: "Total", num: 1 }], r.by_check.map((c) => [esc(c.check), c.High || "", c.Medium || "", c.Low || "", c.total]));
  if (r.netted && r.netted.pairs) $("#notes").innerHTML += `<br><b>Offsetting +/- entries:</b> ${r.netted.pairs} pairs (${r.netted.lines} lines) net to zero, so they are not flagged as errors or duplicates (${r.netted.flags_cleared} flags cleared). Listed on the "Netted Pairs" tab of the Excel report.`;
  if (r.skipped_rules) $("#notes").innerHTML += `<br><b>Rules not applied:</b> ${r.skipped_rules} built-in rule(s) expect accounts that do not exist in these books, so they were skipped instead of flagging every matching line (see "Rules Not Applied" tab).`;
  if (r.learned && r.learned.rules) $("#notes").innerHTML += `<br><b>Learned from this company\u2019s books:</b> for ${r.learned.rules} built-in rule(s) the books consistently use a different account than the rule expects, so that is accepted (${r.learned.flags_cleared} flags cleared). See the "Learned Rules" tab.`;
  if (r.routine && r.routine.flags_cleared) $("#notes").innerHTML += `<br><b>Routine items:</b> ${r.routine.items} vendor/customer-to-account patterns repeat consistently (for example the same monthly bill to the same account), so ${r.routine.flags_cleared} low-level flags on them were cleared. Listed on the "Routine Items" tab.` + (r.routine.repeat_downgraded ? ` ${r.routine.repeat_downgraded} repeated same-size charges that recur on many dates were set to Info.` : "");
  const nr = r.new_related || [];
  $("#newrel").classList.toggle("hide", !nr.length);
  $("#newrelList").innerHTML = nr.map((c) => `<div class="row" style="margin-bottom:8px"><b>${esc(c)}</b><button data-conf="${esc(c)}">Confirm as related company</button><span class="mute"></span></div>`).join("");
  $("#newrelList").querySelectorAll("[data-conf]").forEach((b) => (b.onclick = () => {
    const o = JSON.parse($("#rules").value); o.related_parties = o.related_parties || {}; o.related_parties.names = [...new Set([...(o.related_parties.names || []), b.dataset.conf])];
    $("#rules").value = JSON.stringify(o, null, 2); store.set("books.rules", $("#rules").value);
    b.disabled = true; b.nextElementSibling.textContent = "Added and remembered. Run the review again to apply.";
  }));
  const ck = r.checkpoints || [];
  $("#ckpt").classList.toggle("hide", !ck.length);
  table($("#ckptTable"), [{ t: "Checkpoint" }, { t: "Date" }, { t: "Type" }, { t: "Name" }, { t: "Memo" }, { t: "Account" }, { t: "Amount", num: 1 }],
    ck.map((c) => [esc(c.checkpoint), c.date, esc(c.type), esc(c.name), esc(c.memo), esc(c.account), fmt(c.amount)]));
  $("#out").scrollIntoView({ behavior: "smooth" });
}
$("#dl").onclick = () => {
  const c = ($("#company").value.trim() || "Books").replace(/[^\w-]+/g, "_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([xlsxBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `${c}_Review_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
};
const verEl = document.getElementById("ver"); if (verEl) verEl.textContent = "Engine " + VERSION;
window.__booksReady = true;
