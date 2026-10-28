#!/usr/bin/env python3
"""Render transcribed questions with MathJax and screenshot them next to the original crop, for checking.
usage: preview_latex.py papers/<id>/latex_<Subject>.json [n ...]   -> writes PNGs into the scratch dir, prints their paths"""
import json, os, subprocess, sys, tempfile
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MJ = '<script>MathJax={loader:{load:["[tex]/mhchem"]},tex:{inlineMath:[["\\\\(","\\\\)"]],displayMath:[["\\\\[","\\\\]"]],packages:{"[+]":["mhchem"]}}};</script><script src="https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-chtml.js"></script>'
src = sys.argv[1]; pdir = os.path.dirname(os.path.abspath(src))
data = json.load(open(src)); only = {int(x) for x in sys.argv[2:]}
out = os.environ.get("OUT", tempfile.mkdtemp(prefix="latex_preview_"))
paper = json.load(open(os.path.join(pdir, "paper.json"))); byn = {q["n"]: q for q in paper["questions"]}
for q in data:
    if only and q["n"] not in only: continue
    opts = "".join(f'<div style="margin:6px 0"><b>{k})</b> {v}</div>' for k, v in (q.get("options") or {}).items())
    fig = ""
    if q.get("figure"):
        fig = f'<div style="max-width:900px;border:1px dashed #09f"><img src="file://{os.path.join(pdir, f"f{q[chr(110)]:02d}.png")}" style="width:100%;display:block"></div>'
    crops = "".join(f'<img src="file://{os.path.join(pdir, im)}" style="width:100%;display:block;border:1px solid #999">' for im in byn[q["n"]]["images"])
    html = f'<!doctype html><html><head><meta charset="utf-8">{MJ}</head><body style="font:16px/1.5 Georgia,serif;margin:0;background:#fff"><div style="padding:10px;border-bottom:3px solid red"><b>Q{q["n"]} (rendered)</b><div>{q["text"]}</div>{fig}{opts}</div><div style="padding:10px"><b>original crop</b>{crops}</div></body></html>'
    hp = os.path.join(out, f"q{q['n']:02d}.html"); open(hp, "w").write(html)
    png = os.path.join(out, f"q{q['n']:02d}.png")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--window-size=1000,1400", "--virtual-time-budget=6000", f"--screenshot={png}", f"file://{hp}"], capture_output=True)
    print(png)
