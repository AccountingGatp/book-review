import { runReview, loadPayeeList } from "./src/engine.js";
import { parseWorkbookRows } from "./src/xlsx_io.js";
import { buildReport } from "./src/build_report.js";
import DEFAULT_RULES from "./rules.json";
const $ = (s) => document.querySelector(s);
const ROLES = {
  td: ["Transaction Detail by Account", /tract?(s|i)?ional|transaction.*detail|trans.*by.*acc/],
  gl: ["General Ledger", /general ledger/],
  pl: ["Profit & Loss Detail", /p\s*(and|&)\s*l|profit.*loss/],
  bs: ["Balance Sheet Detail", /balance sheet/],
  tb: ["Trial Balance", /trial balance/],
  ar: ["A/R Aging", /\bar\b.*report|a\/r|receivable/],
  ap: ["A/P Aging", /\bap\b.*report|a\/p|payable/],
};
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
    const opts = ['<option value="">— not used —</option>'].concat(Object.entries(ROLES).map(([k, [l]]) => `<option value="${k}" ${x.role === k ? "selected" : ""}>${l}</option>`)).join("");
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
  const opt = Object.keys(ROLES).filter((r) => !roles.includes(r) && !["td", "gl"].includes(r)).map((r) => ROLES[r][0]);
  let msg = "";
  if (dup) msg = `Two files are marked "${ROLES[dup][0]}" — pick one.`;
  else if (missing.length) msg = "Still needed: " + missing.map((r) => ROLES[r][0]).join(", ") + ".";
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
  try { rulesObj = JSON.parse(rules); } catch (err) { setStatus("The rules text is not valid JSON: " + err.message, 0); $("#status").classList.add("bad"); return; }
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
  $("#stats").innerHTML = [["Total exceptions", r.total], ["High", s.High || 0], ["Medium", s.Medium || 0], ["Low", s.Low || 0], ["Reconciliation mismatches", r.recon_bad]]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#notes").innerHTML = (r.run_problems.length ? `<span class="bad">Some checks were skipped: ${r.run_problems.map((p) => esc(p.step + " – " + p.message)).join("; ")}</span><br>` : "") + r.notes.map(esc).join("<br>");
  table($("#ck"), [{ t: "Area" }, { t: "Issue" }, { t: "Lines", num: 1 }, { t: "Amount", num: 1 }, { t: "Where" }],
    r.checklist.map((c) => [esc(c.area), esc(c.issue), c.lines ?? "", fmt(c.amount), esc(c.where_to_look)]));
  table($("#top"), [{ t: "Ref" }, { t: "Sev" }, { t: "Date" }, { t: "Name" }, { t: "Amount", num: 1 }, { t: "Issue" }],
    r.top.map((t) => [t.ref, `<span class="tag ${t.sev}">${t.sev}</span>`, t.date, esc(t.name), fmt(t.amount), esc(t.issue)]));
  table($("#bychk"), [{ t: "Check" }, { t: "High", num: 1 }, { t: "Medium", num: 1 }, { t: "Low", num: 1 }, { t: "Total", num: 1 }], r.by_check.map((c) => [esc(c.check), c.High || "", c.Medium || "", c.Low || "", c.total]));
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
window.__booksReady = true;
