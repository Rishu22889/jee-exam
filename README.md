# JEE mock exam site

Static site: no server, no database, no cost. Papers and reports are files in this repository, written through the GitHub API.

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000

## Deploy
GitHub Pages (Settings → Pages → Deploy from branch `main`, folder `/`). The site is plain static files, so Vercel also works
(`npx vercel --prod`) but changes nothing; on Vercel the repository name is not guessed and must be typed on the upload page.

## Two links
- Exam site (for the student): `https://<user>.github.io/jee-exam/`. Dashboard (score trend, subject strength, best score per
  paper), papers, past tests and their analysis.
- Upload page (for you): `https://<user>.github.io/jee-exam/upload.html`.
  - **GitHub connection**: repository + a fine-grained personal access token for this repo only, Contents read/write, kept in that browser.
  - **Tests**: every published test and every test saved only in that browser; publish or delete them. Delete removes the
    paper's files and its index entry in one commit; reports of its attempts stay.
  - **Reports**: every test taken on a linked device, with the same dashboard and the full analysis.
  - **Add a test**: reads the PDFs in the browser, you check and edit every question, then **Publish to exam site**
    (one commit; Pages rebuilds in about a minute) or save on that laptop only (other devices do not see it).

## Reports from the student's device
Open *Link a device* on the upload page and scan the QR code with the student's phone or tablet. The link carries the repo and
token in the URL hash (never sent to a server); the exam site stores them and strips the hash. After every test the result is
written to `results/<attempt id>.json`; a failed upload is retried on the next page load. Without linking, results stay on that device.
The repository is public (GitHub Pages free plan), so these result files are public too: they hold the name typed on the
instructions page, answers, times and scores.

Every result and every publish is a commit, so pull before pushing from your own clone: `git pull --rebase && git push`.

## One sitting
The clock is wall-clock time: closing the page, switching apps or locking the screen does not stop it, and the paper resumes
with the time that is left. The exam asks for full screen, warns before closing, keeps the Back button inside the test, and
records every time the student leaves the window (count and time away) and leaves full screen. The report shows both.

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
