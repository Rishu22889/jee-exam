# JEE mock exam site

Static site: no server, no database, no cost. Results are stored in the browser's localStorage.

## Run locally
    python3 -m http.server 8000     # then open http://localhost:8000

## Deploy (Vercel, free)
    npx vercel --prod

## Add a paper
Needs poppler (`brew install poppler`). Write a key file (one `n answer` per line, ranges as `0.78 TO 0.82`), then:

    python3 tools/build_paper.py --id adv-2026-p1 --title "JEE Advanced 2026 Paper 1" \
      --qp QP.pdf --sol KeySol.pdf --key key.txt --layout "single:3:1:4,multi:4:2:3,numeric:4:0:6,integer:3:1:4"

`--layout` is the per-subject section list `type:+marks:-marks:count` (JEE Advanced changes this every year),
or a preset: `adv-p1`, `adv-p2`, `mains` (20 single +4/-1, 5 numeric +4/-1 per subject). Types: single, multi, integer (0-9), numeric.
Then add the paper to `papers/index.json`. The PDF must be text-based with question numbers like `12.` at the left margin.
