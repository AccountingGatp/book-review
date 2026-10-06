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
