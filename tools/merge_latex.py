#!/usr/bin/env python3
"""Merge papers/<id>/latex_*.json into paper.json (adds text/options/figure to each question).
usage: merge_latex.py papers/<id> <question paper pdf>
A figure is {"page": p, "y0": pt, "y1": pt} in page coordinates; it is rendered to fNN.png straight from the PDF."""
import glob, json, os, subprocess, sys
pdir, qp = sys.argv[1], sys.argv[2]; pj = os.path.join(pdir, "paper.json"); paper = json.load(open(pj)); byn = {q["n"]: q for q in paper["questions"]}
DPI = 150; SCALE = DPI / 72; X0, X1 = 22, 573
n = 0
for f in sorted(glob.glob(os.path.join(pdir, "latex_*.json"))):
    for t in json.load(open(f)):
        q = byn[t["n"]]; q["text"] = t["text"]
        q.pop("options", None); q.pop("figure", None)
        if t.get("options"): q["options"] = t["options"]
        if t.get("figure"):
            g = t["figure"]; out = os.path.join(pdir, f"f{q['n']:02d}")
            subprocess.run(["pdftoppm", "-f", str(g["page"]), "-l", str(g["page"]), "-r", str(DPI), "-png", "-singlefile",
                            "-x", str(int(X0 * SCALE)), "-y", str(int(g["y0"] * SCALE)), "-W", str(int((X1 - X0) * SCALE)), "-H", str(int((g["y1"] - g["y0"]) * SCALE)), qp, out], check=True)
            q["figure"] = {"image": f"f{q['n']:02d}.png", **g}
        n += 1
json.dump(paper, open(pj, "w"), indent=1)
print(f"merged {n} questions into {pj}; without text: {[q['n'] for q in paper['questions'] if not q.get('text')]}")
