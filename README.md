# Books Review - pure JavaScript, static site

No Python, no server, no build step, no runtime downloads. Everything runs in the browser; files never leave the machine.

Deploy: `npx vercel --prod` in this folder, or import it in Vercel (Framework "Other", no build command, output = root).
Local test: `python3 -m http.server 8000` (any static server) and open http://localhost:8000

- index.html / app.js : UI
- src/engine.js       : review engine (all checks), no dependencies
- src/xlsx_io.js      : reads the uploaded .xlsx files
- src/build_report.js : writes the Excel report
- vendor/exceljs.min.js : Excel library (bundled)
- rules.json          : default rules (editable in the page)

Results match the original Python tool exactly on the test data (574 of 574 exceptions identical).
Reviewed items are not remembered between runs (no database).

## Less noise in the review (v2)

- **Offsetting +/- entries**: same account, same name, same amount with opposite sign, within 62 days, are treated as net zero. They are not duplicates, and their flags are cleared. Listed on the **Netted Pairs** tab.
- **Routine items**: if a name (or memo, with digits ignored) posts to the same account 4+ times and at least 90% of the time, it is treated as correct and not sent to review. Listed on the **Routine Items** tab. Agreed company rules are never cleared this way.
- **Repeat billing** (same amount on 3+ dates) is downgraded to Info.
- Settings: `netting` and `routine` blocks in `rules.json`. After changing code, run `npm run build`.

## The "To Review" list (v3)

Work from the **To Review** tab only (also shown on the page). It has one row per decision:
- A line with several flags shows once.
- The same issue on the same payee and account (for example 13 cash withdrawals) is one row with a count and total.
- Report-to-report differences are grouped into one row per cause.
- Offsetting +/- pairs also net when one side has no name, or when the account is a clearing/catch-all account.
- Same memo, account and amount in 3+ different months (a standing monthly charge) is treated as routine.
- Weak flags become optional (Low/Info) using the `review` block in `rules.json`: `small_floor` (25), `e1_min_amount` (1000), `e1_min_multiple` (5), `dup_min_amount` (5), `a1_min_amount` (0 = every missing name stays; raise it to hide small ones).
- The Account/Name/Duplicates/Unusual tabs show High and Medium only. Low and Info are on the Exceptions tab.
- File names with underscores (`AR_Report.xlsx`, `p_and_l_detail.xlsx`) are now recognised.

## Nothing is hardcoded (v4)

All company-specific values live in `rules.json`; the code contains none:
- `accounts` (undeposited funds, A/R and A/P control accounts, petty-cash split, low-value accounts)
- `patterns` (bank-feed memo, purchase-date memo, payroll-check-date memo, related-company account names)
- `file_patterns` (how uploaded file names are matched to the 7 reports)
- `thresholds`, `netting`, `routine`, `review` (including `check_priority`)
- `keyword_rules` (each can carry `names`, `protected` via `routine.protected_rule_ids`, and `checklist` wording)
- `upwork` (including its `label`), `allocation_rules`, `related_parties`, `approved_vendor_accounts`, `review_notes`
If a setting is missing from the rules text on the page, the value from the bundled `rules.json` is used and the page says which ones.

## New vendors, other companies (v5)

- **Rules not applied**: a built-in rule is skipped when none of the accounts it expects exist in the uploaded books (different chart of accounts). Listed on the "Rules Not Applied" tab.
- **Learned rules**: if a rule matches 5+ lines and 80%+ of them go to one account the rule does not list, that is treated as this company's way of booking. Listed on the "Learned Rules" tab. Settings: `rule_learning` in `rules.json`. Rules in `routine.protected_rule_ids` are never overridden.
- **Always OK** button on each row of the review list: remembers the vendor + account (`approved_pairs`) or, for lines with no name, the memo wording + account (`approved_memo`), so it does not come back next month. Saved on this computer.
- **Download rules / Load rules file** (under "Review rules"): carry the saved approvals to another computer or person.
- New vendors with no history are not flagged just for being new; checks that need history only start once a vendor has enough lines.

## v6
- Rows are grouped per vendor + account family (not per check), so one vendor with several issues is one row.
- Checks listed in `review.group_checks` (missing names `A1`, catch-all `B5`) are one row each that points to the tab to work through.
- The page footer and the workbook Summary show the engine version. If you do not see "Engine v6", the site is serving old files: replace the whole folder and redeploy (index.html loads `app.bundle.js?v=6`).
