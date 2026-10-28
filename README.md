# JEE mock exam site

Static site: no server, no database, no cost. Results are stored in the browser's localStorage.

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000

## Deploy (Vercel, free)
    npx vercel --prod

## Two links
- Exam site (for the student): `https://<user>.github.io/jee-exam/` — lists bundled papers and papers published from the upload page. No upload link on it.
- Upload page (for you): `https://<user>.github.io/jee-exam/upload.html` — reads the PDFs in the browser, lets you check and edit every question, then either
  saves the paper in that browser only, or **publishes** it: one commit into this repository through the GitHub API (needs a fine-grained personal
  access token for this repo with Contents read/write). GitHub Pages rebuilds in about a minute and the exam site shows the paper.

## How the upload page reads a paper (cutter.js)
No fixed pattern. From the PDF's own text it finds subject headings (PHYSICS / PART-1 : PHYSICS / Physics), SECTION headings,
question labels (`12.`, numbering continuous or restarting per section), paragraphs ("Paragraph for Question Nos. 14 and 15"),
running headers/footers/watermarks, one- or two-column pages, A4 or Letter. Each section's type (single, multi, matching,
integer, numeric) and marks come from its instruction text, its "Maximum Marks" heading, or a marking scheme on the cover;
anything missing falls back to the JEE Advanced / JEE Main defaults and is flagged in the marking-scheme table.
The answer key is read three ways (Narayana grid, Allen "Q./A." table, inline "1. Ans(D)" / FIITJEE "1.  B, C, D") and the
one that finds the most answers wins. Cuts are placed in measured white space on the rendered page.

Checked on Narayana GTA-1 P1/P2, Allen Nurture mock P1/P2 and FIITJEE AITS P1/P2. Scanned (image-only) PDFs are not supported.

Dev check: serve the folder and open `tools/cutter_check.html?qp=<pdf url>&sol=<pdf url>&from=1&to=20&showsol=1`
to see every crop, the detected sections and the key.

## Add a paper from the command line (Narayana layout only)
Needs poppler (`brew install poppler`). Write a key file (one `n answer` per line, ranges as `0.78 TO 0.82`), then:

    python3 tools/build_paper.py --id adv-2026-p1 --title "JEE Advanced 2026 Paper 1" \
      --qp QP.pdf --sol KeySol.pdf --key key.txt --layout "single:3:1:4,multi:4:2:3,numeric:4:0:6,integer:3:1:4"

`--layout` is the per-subject section list `type:+marks:-marks:count` (JEE Advanced changes this every year),
or a preset: `adv-p1`, `adv-p2`, `mains` (20 single +4/-1, 5 numeric +4/-1 per subject). Types: single, multi, integer (0-9), numeric.
Then add the paper to `papers/index.json`. The PDF must be text-based with question numbers like `12.` at the left margin.
