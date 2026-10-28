#!/usr/bin/env python3
"""Build a paper folder (question/solution crops + paper.json) from a QP pdf, a Key&Sol pdf and a key file.

usage: build_paper.py --id adv-gta1-p1 --title "..." --qp QP.pdf --sol SOL.pdf --key key.txt --layout adv-p1 --out papers/

key.txt: one line per question: "<n> <answer>"  e.g. "7 BCD", "34 0.78 TO 0.82", "13 9".
layout: a preset (adv-p1 | adv-p2 | mains) or a spec "type:+marks:-marks:count,..." per subject,
        e.g. "single:3:1:4,multi:4:2:3,numeric:4:0:6,integer:3:1:4" (JEE Advanced changes this every year).
        types: single | multi | integer (0-9 keypad) | numeric (decimal). Needs poppler (pdftotext, pdftoppm).
"""
import argparse, json, os, re, subprocess, sys, xml.etree.ElementTree as ET

DPI = 150
SCALE = DPI / 72
X0, X1 = 22, 573          # crop width in pt (A4 = 595 wide)
PAD = 8                   # pt added above and below each crop: a sliver of the neighbour beats a clipped line
SUBJECTS = ["Mathematics", "Physics", "Chemistry"]
FOOTER_RE = re.compile(r"Page\.?\s*No|Pg\.?\s*No|^SR[._]", re.I)
SECTION_RE = re.compile(r"^SECTION\b.*Max", re.I)
HEADER_RE = re.compile(r"Narayana|GTA|Rankers|JAYATHE|GROUP|MAX\.MARKS|^(MATHEMATICS|PHYSICS|CHEMISTRY)$|For More Join|Page\.? ?No|^SR[._]", re.I)

# (type, +marks, -marks, count) per section, repeated per subject
LAYOUTS = {
    "adv-p1": [("single", 3, 1, 6), ("multi", 4, 2, 6), ("numeric", 4, 0, 6)],
    "adv-p2": [("integer", 3, 1, 6), ("multi", 4, 2, 6), ("numeric", 4, 0, 6)],
    "mains":  [("single", 4, 1, 20), ("numeric", 4, 1, 5)],
}

def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True).stdout

def ink_rows(pdf, page):
    """list indexed by y (pt): True if any pixel row inside that pt has ink within the crop width.
    Rendered at DPI so thin drawing lines stay dark (at 72 dpi they fade to light grey)."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        run("pdftoppm", "-gray", "-r", str(DPI), "-f", str(page), "-l", str(page), "-singlefile", pdf, f"{d}/p")
        data = open(f"{d}/p.pgm", "rb").read()
    parts = data.split(maxsplit=4); w, h = int(parts[1]), int(parts[2])   # P5 header: magic width height maxval
    table = bytes(1 if v < 170 else 0 for v in range(256))
    px = parts[4].translate(table)
    x0, x1 = int((X0 + 18) * SCALE), int((X1 - 18) * SCALE)  # inside the page's vertical border lines
    rows = [px[r * w + x0:r * w + x1].count(b"\x01") >= 2 for r in range(h)]
    return [any(rows[int(y * SCALE):int((y + 1) * SCALE)]) for y in range(842)]

def page_lines(pdf):
    """[(page, [(yMin, yMax, xMin, text), ...]), ...] sorted by y."""
    xml = run("pdftotext", "-bbox-layout", pdf, "/dev/stdout").decode("utf-8", "replace")
    root = ET.fromstring(xml)
    ns = {"x": "http://www.w3.org/1999/xhtml"}
    out = []
    for i, page in enumerate(root.iter("{http://www.w3.org/1999/xhtml}page"), 1):
        lines = []
        for line in page.iter("{http://www.w3.org/1999/xhtml}line"):
            words = [w.text or "" for w in line.iter("{http://www.w3.org/1999/xhtml}word")]
            lines.append((float(line.get("yMin")), float(line.get("yMax")), float(line.get("xMin")), " ".join(words)))
        lines.sort()
        out.append((i, lines))
    return out

def find_blocks(pages, first_page, expect_n, tolerance=10, pdf=None):
    """Locate numbered blocks 1..expect_n (any order). Returns {n: [(page, y0, y1), ...]}.
    A block whose number label is missing from the text layer gets the previous block's images."""
    starts = []  # (page, y, n) in document order
    seen = set()
    text_lines = {}  # page -> lines (watermark / running header excluded)
    sections = []    # (page, y) of SECTION headings
    cuts = {}    # page -> y positions where content must be cut (section headers, footer)
    tops = {}    # page -> y where content starts (below running header)
    for p, lines in pages:
        if p < first_page:
            continue
        cuts[p] = []
        tops[p] = 50
        text_lines[p] = [l for l in lines if not HEADER_RE.search(l[3])]
        for (y0, y1, x, text) in lines:
            if y0 < 50 and ("Narayana" in text or "GTA" in text):
                tops[p] = max(tops[p], y1 + 1)
            m = re.match(r"^(\d+)\.(\s|$)", text)
            if m and x < 60 and 1 <= int(m.group(1)) <= expect_n and int(m.group(1)) not in seen:
                seen.add(int(m.group(1))); starts.append((p, y0, int(m.group(1))))
            elif SECTION_RE.match(text):  # a section heading is never a running header, cut at any y
                cuts[p].append(y0); sections.append((p, y0 - 2))
            elif text.strip() in [s.upper() for s in SUBJECTS] or FOOTER_RE.search(text):
                if y0 > 60: cuts[p].append(y0)
            if "For More Join" in text and y0 > 700:
                cuts[p].append(y0)
    missing = sorted(set(range(1, expect_n + 1)) - seen)
    if len(missing) > expect_n // tolerance:
        sys.exit(f"too many blocks missing: {missing}")
    if missing:
        print(f"warning: number labels not found for {missing}; they share the previous block's crop", file=sys.stderr)
    ink = {}
    def top_of(p, y):
        """y where the block labelled at y really starts. The previous block's body text (label x~32, text x~68)
        ends at B. Between B and the label there may be drawings or math belonging to either side, so cut in the
        first blank band (>= 3pt of white in the rendered page) found scanning upward from the label; with no
        such band, cut midway."""
        above = [l for l in text_lines[p] if l[1] <= y + 2]
        body = [l[1] for l in above if l[2] <= 90]
        B = max(body) if body else tops[p]
        if pdf:
            if p not in ink: ink[p] = ink_rows(pdf, p)
            rows = ink[p]; r = int(y) + 6; run = 0   # the label's line box starts above its glyphs: scan from a little below
            while r > B:
                r -= 1
                run = run + 1 if not rows[r] else 0
                if run >= 3: return max(tops[p], min(y, r + run / 2))
        return max(tops[p], (B + y) / 2)
    blocks = {}
    last_page = max(cuts)
    for i, (p, y, n) in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else None
        segs = []
        page = p; y0 = top_of(p, y)
        while True:
            ends = [c for c in cuts.get(page, []) if c > y0 + 2]
            if nxt and nxt[0] == page:
                ends.append(top_of(page, nxt[1]))
            end = min(ends) if ends else 800
            segs.append((page, y0, end))
            # continue onto the next page only if this page ended at its footer and the next block is on a later page
            if end >= 700 and page < last_page and (nxt is None or nxt[0] > page):
                page += 1; y0 = tops[page]
                if any(sp == page and sy < y0 + 25 for sp, sy in sections):  # next page opens with a section heading
                    break
                first_cut = min([c for c in cuts.get(page, []) if c > y0] + [top_of(page, nxt[1]) if nxt and nxt[0] == page else 9e9])
                # body text starts at x~68; a band holding only math fragments (x>90) is the next question's overhang
                if not any(y0 < l[0] and l[1] < first_cut and l[2] <= 90 for l in text_lines[page]):
                    break
                continue
            break
        blocks[n] = segs
    for n in missing:
        blocks[n] = blocks.get(n - 1) or blocks[n + 1]
    # section instruction blocks: from a SECTION heading to the first question label after it
    blocks["sections"] = []
    for (p, y) in sections:
        after = [top_of(sp, sy) for (sp, sy, _) in starts if sp == p and sy > y]
        blocks["sections"].append([(p, y, min(after) if after else 800)])
    return blocks

def crop(pdf, segs, prefix):
    files = []
    for k, (page, y0, y1) in enumerate(segs):
        y0, y1 = max(0, y0 - PAD), min(842, y1 + PAD)
        out = f"{prefix}_{k}"
        run("pdftoppm", "-f", str(page), "-l", str(page), "-r", str(DPI), "-png", "-singlefile",
            "-x", str(int(X0 * SCALE)), "-y", str(int(y0 * SCALE)),
            "-W", str(int((X1 - X0) * SCALE)), "-H", str(int((y1 - y0) * SCALE)), pdf, out)
        files.append(os.path.basename(out) + ".png")
    return files

def parse_key(path):
    key = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#"): continue
        n, ans = line.split(None, 1)
        key[int(n)] = ans.strip().upper()
    return key

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True); ap.add_argument("--title", required=True)
    ap.add_argument("--qp", required=True); ap.add_argument("--sol"); ap.add_argument("--key", required=True)
    ap.add_argument("--layout", required=True); ap.add_argument("--out", default="papers")
    ap.add_argument("--sol-first-page", type=int, default=2, help="solutions pdf page where solutions start")
    ap.add_argument("--duration", type=int, default=180, help="minutes")
    a = ap.parse_args()

    layout = LAYOUTS.get(a.layout) or [(t, int(p), int(m), int(c)) for t, p, m, c in
                                        (x.split(":") for x in a.layout.split(","))]
    assert all(t in ("single", "multi", "integer", "numeric") for t, *_ in layout), "unknown question type"
    per_subject = sum(c for *_, c in layout)
    total = per_subject * len(SUBJECTS)
    key = parse_key(a.key)
    missing = [n for n in range(1, total + 1) if n not in key]
    if missing: sys.exit(f"key missing for questions {missing}")

    outdir = os.path.join(a.out, a.id); os.makedirs(outdir, exist_ok=True)
    qblocks = find_blocks(page_lines(a.qp), 1, total, pdf=a.qp)
    sblocks = find_blocks(page_lines(a.sol), a.sol_first_page, total, tolerance=3, pdf=a.sol) if a.sol else {}  # solution labels are often images

    sec_imgs = [crop(a.qp, segs, os.path.join(outdir, f"sec{k:02d}"))[0] for k, segs in enumerate(qblocks["sections"])]
    if len(sec_imgs) != len(layout) * len(SUBJECTS):
        print(f"warning: found {len(sec_imgs)} SECTION headings, expected {len(layout) * len(SUBJECTS)}; section images dropped", file=sys.stderr)
        sec_imgs = []
    questions = []
    n = 1
    for si, subj in enumerate(SUBJECTS):
        for sec_i, (typ, plus, minus, count) in enumerate(layout):
            for _ in range(count):
                q = {"n": n, "subject": subj, "section": sec_i + 1, "type": typ, "marks": plus, "neg": minus,
                     "sectionImage": sec_imgs[si * len(layout) + sec_i] if sec_imgs else None,
                     "answer": key[n], "images": crop(a.qp, qblocks[n], os.path.join(outdir, f"q{n:02d}"))}
                if sblocks: q["solution"] = crop(a.sol, sblocks[n], os.path.join(outdir, f"s{n:02d}"))
                questions.append(q); n += 1
    paper = {"id": a.id, "title": a.title, "layout": a.layout, "duration": a.duration * 60,
             "maxMarks": sum(p * c for _, p, _, c in layout) * len(SUBJECTS), "subjects": SUBJECTS, "questions": questions}
    json.dump(paper, open(os.path.join(outdir, "paper.json"), "w"), indent=1)
    print(f"wrote {outdir}/paper.json with {total} questions, max {paper['maxMarks']}")

if __name__ == "__main__":
    main()
