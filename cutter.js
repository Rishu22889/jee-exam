// cutter.js: finds subjects, sections, paragraphs and questions in a text-based question-paper PDF and reads answer keys.
// Pure layout logic on pdf.js text; rendering and ink measurement are passed in, so the same code runs in the browser and in tests.
// Works from the paper's own headings, so no fixed pattern: numbering may be continuous (Narayana, FIITJEE) or restart
// per section (Allen); pages may be A4 or Letter, one or two columns.
(function (root) {
  const SUBJECT_RE = /^(?:PART\s*[-–—]?\s*[IVX\d]+\s*[:.\-–—]?\s*)?(PHYSICS|CHEMISTRY|MATHEMATICS|MATHS?)\b/i;
  const SECTION_RE = /^SECTION\s*[-–—:]?\s*[A-Z0-9]/i;               // "SECTION – 1 (…)", "SECTION-I(i) : …", "SECTION– A"
  const PASSAGE_RE = /^(PARAGRAPH|PASSAGE|COMPREHENSION)\b/i;          // "Paragraph for Question Nos. 14 and 15"
  const CUT_RE = /Space for Rough Work|For More Join/i;                // always ends the block above it
  const LABEL_RE = /^(?:Q\.?\s*(\d{1,3})(?![\d.])|(\d{1,3})\s*\.(?!\d))/; // "12.", "12. text", "Q.12"
  const ANSWER_RE = /^(-?\d*\.?\d+ TO -?\d*\.?\d+|[A-D]{1,4}|-?\d*\.?\d+)$/;
  const SUBJECT_NAME = { P: 'Physics', C: 'Chemistry', M: 'Mathematics' };

  // ---- pdf.js text content -> lines [{x, x1, y0, y1, text}] in pt, y from the top
  async function pageLines(page) {
    const vp = page.getViewport({ scale: 1 }), H = vp.height;
    const items = (await page.getTextContent()).items.filter(i => i.str.trim()).map(i => ({ x: i.transform[4], y: H - i.transform[5], h: i.height || 10, w: i.width, s: i.str }));
    return { W: vp.width, H, items, lines: toLines(items) };
  }
  function toLines(items) {
    items = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const L = lines.find(l => Math.abs(l.base - it.y) < 3 && it.x - l.endX < 2 * it.h + 2 && it.x >= l.endX - 2);
      if (L) { L.text += (it.x - L.endX > 0.3 * it.h ? ' ' : '') + it.s; L.endX = it.x + it.w; L.h = Math.max(L.h, it.h); }
      else lines.push({ base: it.y, x: it.x, endX: it.x + it.w, h: it.h, text: it.s });
    }
    return lines.map(l => ({ y0: l.base - l.h, y1: l.base + 0.25 * l.h, x: l.x, x1: l.endX, text: l.text.trim() })).sort((a, b) => a.y0 - b.y0 || a.x - b.x);
  }
  // English and Hindi side by side (Allen JEE Main): Hindi text only ever in the right half -> x where the Hindi half starts, else null.
  // Papers with Hindi mixed into both columns (Allen Advanced) are left alone.
  const HINDI = /[\u0900-\u097F]/;
  function hindiHalf(pages) {
    const hi = pages.flatMap(pg => (pg.items || []).filter(i => HINDI.test(i.s)).map(i => ({ i, W: pg.W })));
    const pagesWith = pages.filter(pg => (pg.items || []).filter(i => HINDI.test(i.s)).length >= 5).length;
    if (pagesWith < Math.max(2, 0.3 * pages.length) || hi.some(({ i, W }) => i.x < W * 0.45)) return null;
    return Math.min(...hi.map(({ i }) => i.x)) - 4;
  }

  const subjectOf = t => { const m = t.length < 32 && t.match(SUBJECT_RE); return m ? SUBJECT_NAME[m[1][0].toUpperCase()] : null; };
  const mode = (xs, step = 2) => { const c = new Map(); let best = null, n = 0; for (const x of xs) { const k = Math.round(x / step) * step; const v = (c.get(k) || 0) + 1; c.set(k, v); if (v > n) { n = v; best = k; } } return best; };

  // ---- question type and marks from a section's instruction text; defaults come from the exam preset
  function inferType(info) {
    if (/one\s*or\s*more|more\s*than\s*one/i.test(info)) return 'multi';
    if (/match/i.test(info)) return 'matching';
    if (/single\s*-?\s*digit|\b0\s*(?:to|-|–)\s*9\b/i.test(info)) return 'integer';
    if (/numerical|integer|decimal/i.test(info)) return 'numeric';
    return 'single';
  }
  function inferMarks(info) {
    const full = info.match(/Full\s*Marks\s*:?\s*\+?\s*(\d+)/i), neg = info.match(/Negative\s*Marks\s*:?\s*[-–−]\s*(\d+)/i);
    return { marks: full ? +full[1] : null, neg: neg ? +neg[1] : (full ? 0 : null) };
  }

  // ---- layout analysis
  // pages: [{p, W, H, lines}] from pageLines. opts.ink(p, x0, x1) -> boolean rows per pt (optional, makes cuts land in white space).
  async function analyse(pages, opts = {}) {
    const N = pages.length;
    const hindiAt = hindiHalf(pages);
    if (hindiAt) for (const pg of pages) pg.lines = toLines(pg.items.filter(i => i.x < hindiAt)); // English half only
    // 1. classify lines
    const norm = t => t.replace(/[\d\s]+/g, ' ').trim().toLowerCase(), at = l => norm(l.text) + '@' + Math.round(l.y0 / 15);
    const seen = new Map(), bump = k => seen.set(k, (seen.get(k) || 0) + 1);
    for (const pg of pages) { new Set(pg.lines.map(l => norm(l.text))).forEach(bump); new Set(pg.lines.map(at)).forEach(bump); }
    const repeated = k => k && seen.get(k) >= Math.max(3, N * 0.3);
    const slot = l => '#' + Math.round(l.x / 20) + '@' + Math.round(l.y0 / 10);    // bare page numbers: same spot on many pages
    for (const pg of pages) new Set(pg.lines.filter(l => !norm(l.text)).map(slot)).forEach(bump);
    for (const pg of pages) for (const l of pg.lines) {
      const t = l.text; let m;
      if (t.length < 50 && SECTION_RE.test(t)) l.kind = 'section';
      else if (subjectOf(t)) { l.kind = 'subject'; l.subject = subjectOf(t); }
      else if (t.length < 90 && PASSAGE_RE.test(t)) l.kind = 'passage';
      else if ((m = t.match(LABEL_RE))) { l.kind = 'cand'; l.num = +(m[1] || m[2]); }
      else if (CUT_RE.test(t)) l.kind = 'cut';
      else l.kind = repeated(at(l)) && t.length >= 12 ? 'chrome' : 'text';   // watermark text
    }
    for (const pg of pages) {
      const isRun = l => l.kind === 'cut' || l.kind === 'chrome' || (l.kind === 'text' && (norm(l.text) ? repeated(norm(l.text)) || repeated(at(l)) : repeated(slot(l))));
      const mark = (ls, inBand) => { for (const l of ls) { if (!inBand(l)) break; if (!isRun(l)) break; if (l.kind === 'text') l.kind = 'chrome'; l.edge = true; } };
      const sorted = [...pg.lines].sort((a, b) => a.y0 - b.y0);
      mark(sorted, l => l.y0 < pg.H * 0.12);
      // footers sit in the bottom 15%, or higher (Allen Main: 78%) when the line repeats at the same spot on many pages
      const samePlace = l => l.kind === 'cut' || l.kind === 'chrome' || (norm(l.text) ? repeated(at(l)) : repeated(slot(l)));
      mark(sorted.reverse(), l => l.y0 > pg.H * 0.85 || (l.y0 > pg.H * 0.75 && samePlace(l)));
    }
    // 2. content starts at the first subject or section heading (skips the instruction page's own numbered list)
    let started = false;
    for (const pg of pages) for (const l of pg.lines) { if (!started && (l.kind === 'section' || l.kind === 'subject')) started = true; l.live = started; }
    // 3. columns: labels near mid-page on many pages => two columns
    const cands = pages.flatMap(pg => pg.lines.filter(l => l.live && l.kind === 'cand').map(l => ({ l, pg })));
    const right = cands.filter(({ l, pg }) => l.x > pg.W * 0.45 && l.x < pg.W * 0.62);
    const pagesWith = s => new Set(s.map(c => c.pg.p)).size;
    const twoCol = right.length >= 2 && pagesWith(right) >= Math.max(1, 0.3 * pagesWith(cands));
    const split = twoCol ? Math.min(...right.map(c => c.l.x)) - 6 : Infinity;
    const vps = [];
    for (const pg of pages) {
      const head = pg.lines.filter(l => l.edge && l.kind === 'chrome' && l.y0 < pg.H * 0.12), foot = pg.lines.filter(l => l.edge && l.kind === 'chrome' && l.y0 > pg.H * 0.75);
      const top = head.length ? Math.max(...head.map(l => l.y1)) + 1 : pg.H * 0.05, bottom = foot.length ? Math.min(...foot.map(l => l.y0)) : pg.H * 0.97;
      const cols = twoCol ? [[pg.W * 0.03, split], [split, pg.W * 0.97]] : [[pg.W * 0.03, hindiAt ?? pg.W * 0.97]];
      // two columns that begin under a full-width part (title, key table): columns start below the last line crossing the gutter
      const firstLabel = Math.min(...pg.lines.filter(l => l.live && l.kind === 'cand').map(l => l.y0));
      const colTop = twoCol ? Math.max(top, ...pg.lines.filter(l => l.x < split - 10 && l.x1 > split + 10 && l.y1 < firstLabel).map(l => l.y1 + 1)) : top;
      cols.forEach(([x0, x1], c) => vps.push({ p: pg.p, c, x0, x1, W: pg.W, H: pg.H, top: colTop, bottom, lines: pg.lines.filter(l => ((l.x < split ? 0 : 1) === c || !twoCol) && l.y1 > colTop) })); // by bottom edge: a heading may touch the header line (Narayana)
    }
    // 4. label column and body text column per column index
    const labelX = [0, 1].map(c => mode(cands.filter(({ l }) => (l.x < split ? 0 : 1) === c).map(({ l }) => l.x)));
    const bodyMax = labelX.map((lx, c) => {
      if (lx == null) return Infinity;
      const bx = mode(vps.filter(v => v.c === c).flatMap(v => v.lines.filter(l => l.live && l.kind === 'text' && l.x > lx + 8 && l.x < lx + 80).map(l => l.x)));
      return (bx ?? lx + 36) + 22;
    });
    // 5. walk lines in reading order
    const starts = [], sections = [], passages = [], qs = [], missing = [];
    let want = 1, fresh = true, subject = null, sec = -1, psg = null;
    const ensureSection = () => { if (sec < 0 || sections[sec].subject !== subject) { sections.push({ subject, title: '', info: '', vi: null, y: null, count: 0 }); sec = sections.length - 1; } };
    vps.forEach((v, vi) => v.lines.forEach(l => {
      if (!l.live) return;
      v.cuts ??= [];
      if (l.kind === 'subject') { if (l.subject !== subject) { subject = l.subject; sec = -1; v.newSubject ??= l.y0; } v.cuts.push(l.y0); fresh = true; psg = null; return; }
      if (l.kind === 'section') { sections.push({ subject, title: l.text, info: '', vi, y: l.y0, count: 0 }); sec = sections.length - 1; v.cuts.push(l.y0); fresh = true; psg = null; return; }
      if (l.kind === 'cut') { v.cuts.push(l.y0); return; }
      if (l.kind === 'passage') { const r = l.text.match(/(\d+)\D+?(\d+)/); psg = passages.length; passages.push({ vi, y: l.y0, range: r ? [+r[1], +r[2]] : null }); starts.push({ vi, y: l.y0, kind: 'p', idx: psg }); return; }
      if (l.kind === 'cand' && Math.abs(l.x - labelX[v.c]) <= 6) {
        const k = l.num; let ok = false;
        if (k === want) ok = true;
        else if (fresh && k <= 2 && k < want) { ok = true; if (k === 2) missing.push(qs.length); }   // numbering restarts after a heading
        else if (k === want + 1) { ok = true; missing.push(qs.length); }                            // one label unreadable
        if (ok) {
          ensureSection();
          if (psg != null && passages[psg].range && (k < passages[psg].range[0] || k > passages[psg].range[1])) psg = null; // paragraph covers only its named questions
          if (missing.at(-1) === qs.length) qs.push({ subject, sec, num: k - 1, passage: psg, missing: true });
          const q = { subject, sec, num: k, passage: psg, line: l }; qs.push(q); starts.push({ vi, y: l.y0, kind: 'q', q });
          want = k + 1; fresh = false; return;
        }
      }
      if (l.kind === 'text' && sec >= 0 && !qs.some(q => q.sec === sec)) sections[sec].info += ' ' + l.text;
    }));
    vps.forEach(v => v.cuts ??= []);
    // 6. block boundaries
    const inkCache = {};
    const inkOf = async vi => opts.ink ? (inkCache[vi] ??= await opts.ink(vps[vi].p, vps[vi].x0 + vps[vi].W * 0.03, vps[vi].x1 - vps[vi].W * 0.03)) : null;
    const textOf = v => v.lines.filter(l => l.kind === 'text' || (l.kind === 'cand' && !starts.some(s => s.q?.line === l)));
    const isBody = (l, c) => l.x <= bodyMax[c] && l.text.replace(/\s/g, '').length >= 3;   // 1-2 char lines are math fragments (limits, exponents)
    const topOf = async (vi, y) => { // previous block's body text ends at B; cut in the middle of the first white band (>=3pt) above the label
      const v = vps[vi];
      const body = textOf(v).filter(l => l.y1 <= y + 2 && isBody(l, v.c)).map(l => l.y1);
      const B = Math.max(v.top, ...body, ...v.cuts.filter(c => c < y - 2).map(c => c + 12));
      const rows = await inkOf(vi);
      if (rows) for (let r = Math.floor(y) + 5; r > B; r--) {
        if (rows[r]) continue;
        let t = r; while (t - 1 > B && !rows[t - 1]) t--;
        if (r - t + 1 >= 3) return Math.max(v.top, Math.min(y, (t + r + 1) / 2));
        r = t;
      }
      return Math.max(v.top, (B + y) / 2);
    };
    const blocks = [];
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i], nxt = starts[i + 1], segs = [];
      let vi = s.vi, y0 = await topOf(vi, s.y);
      for (;;) {
        const v = vps[vi], ends = v.cuts.filter(c => c > y0 + 2);
        if (nxt && nxt.vi === vi) ends.push(await topOf(vi, nxt.y));
        const end = Math.min(v.bottom - 5, ...ends);
        segs.push([v.p, y0, end, v.x0, v.x1]);
        if (end >= v.bottom - 9 && vi < vps.length - 1 && (!nxt || nxt.vi > vi)) {
          vi++; const w = vps[vi]; y0 = w.top;
          const firstCut = Math.min(...w.cuts.filter(c => c > y0 - 8), nxt && nxt.vi === vi ? await topOf(vi, nxt.y) : Infinity);
          if (w.newSubject === firstCut) break; // a page opening a new subject: lines above its heading are a title ("Topic : Full Syllabus")
          if (!textOf(w).some(l => l.y0 > y0 && l.y1 < firstCut && isBody(l, w.c))) break; // nothing of ours on the next page
          continue;
        }
        break;
      }
      blocks.push(segs);
    }
    starts.forEach((s, i) => { if (s.kind === 'q') s.q.segs = blocks[i]; else passages[s.idx].segs = blocks[i]; });
    qs.forEach((q, i) => { if (q.missing) q.segs = (qs[i - 1] || qs[i + 1]).segs; });
    for (const s of sections) {
      s.count = qs.filter(q => sections[q.sec] === s).length;
      if (s.vi == null) continue;
      const v = vps[s.vi], first = starts.find(t => t.vi === s.vi && t.y > s.y);
      const end = Math.min(first ? await topOf(s.vi, first.y) : v.bottom, ...v.cuts.filter(c => c > s.y + 2));
      s.segs = [[v.p, s.y - 2, end, v.x0, v.x1]];
    }
    const cover = coverScheme(pages);
    for (const s of sections) {
      const own = inferMarks(s.info); s.type = inferType(s.info);
      const max = s.title.match(/Max\w*\s*Marks?\s*:?\s*(\d+)/i), letter = (s.title.match(/^SECTION\s*[-–—:]?\s*([A-Z0-9]+)/i) || [])[1];
      const fromCover = cover.filter(c => c.key === letter?.toUpperCase());
      const cv = fromCover.find(c => inferType(c.kind) === s.type) || (s.type === 'matching' && fromCover.find(c => inferType(c.kind) === 'single')) || (fromCover.length === 1 && fromCover[0]);
      s.marks = own.marks ?? (max && s.count ? Math.round(+max[1] / s.count) : null) ?? cv?.marks ?? null;
      s.neg = own.neg ?? (own.marks == null && cv ? cv.neg : null);
    }
    const kept = sections.filter(s => s.count), idx = sections.map(s => kept.indexOf(s));
    return { questions: qs.map(({ line, ...q }) => ({ ...q, sec: idx[q.sec], label: line })), sections: kept, passages, missing: missing.map(i => i + 1), twoCol, hindiAt, labelX, bodyMax };
  }

  // ---- marking scheme printed once on the cover: rows "Section–A (Single Correct): …", "Full Marks : +3", "Negative Marks : –1"
  function coverScheme(pages) {
    const out = []; let cur = null;
    for (const pg of pages.slice(0, 2)) {
      const rows = [];
      for (const l of [...pg.lines].sort((a, b) => a.y0 - b.y0)) { const r = rows.find(r => Math.abs(r.y - l.y0) < 3); if (r) r.ls.push(l); else rows.push({ y: l.y0, ls: [l] }); }
      for (const r of rows) {
        const t = r.ls.sort((a, b) => a.x - b.x).map(l => l.text).join(' ');
        const h = t.match(/^Section\s*[-–—]?\s*([A-Z0-9]+)\s*(?:\(([^)]*)\))?\s*:/i);
        if (h) { cur = { key: h[1].toUpperCase(), kind: h[2] || '', marks: null, neg: null }; out.push(cur); continue; }
        if (!cur) continue;
        const f = t.match(/^Full\s*Marks\s*:?\s*\+?\s*(\d+)/i), n = t.match(/^Negative\s*Marks\s*:?\s*[-–−]?\s*(\d+)/i);
        if (f && cur.marks == null) cur.marks = +f[1];
        if (n && cur.neg == null) cur.neg = +n[1];
      }
    }
    return out.filter(c => c.marks != null).map(c => ({ ...c, neg: c.neg ?? 0 }));
  }

  // ---- answer keys. Each parser returns answers in question order (array, index 0 = first question).
  function normAnswer(s) {
    if (s == null) return null;
    s = String(s).toUpperCase().replace(/^ANS(WER)?\.?\s*[:\-]?\s*/, '').replace(/^\(|\)$/g, '').replace(/\s+/g, ' ').trim();
    let m;
    if ((m = s.match(/^(-?\d*\.?\d+)\s*(?:TO|~|–|—)\s*(-?\d*\.?\d+)$/))) return `${m[1]} TO ${m[2]}`;
    if (/^[A-D](?:\s*(?:,|&|AND)?\s*[A-D])*$/.test(s)) return [...new Set(s.replace(/\bAND\b/g, ' ').replace(/[^A-D]/g, ''))].sort().join('');
    if (/^-?\d*\.?\d+$/.test(s)) return s;
    return null;
  }
  // "1. Ans(D)", or a label line with the answer beside it ("1."  "B, C, D") or on the next line
  function keyInline(an, pages) {
    const all = pages.flatMap(pg => pg.lines);
    return an.questions.map(q => {
      if (!q.label) return null;
      const l = q.label, rest = l.text.replace(LABEL_RE, '').trim();
      const beside = all.filter(o => o !== l && Math.abs(o.y0 - l.y0) < 4 && o.x > l.x && o.x < l.x + 80 && pages.find(pg => pg.lines.includes(o)) === pages.find(pg => pg.lines.includes(l)));
      for (const cand of [rest, ...beside.map(o => o.text)]) {
        const a = cand.match(/Ans(?:wer)?\.?\s*[:\-]?\s*\(?\s*([^)]*)\)?/i);
        const v = normAnswer(a ? a[1] : cand); if (v) return v;
      }
      return null;
    });
  }
  // Allen-style table: a "Q." row of numbers with an "A." row of answers under it
  function keyQA(pages) {
    const out = [];
    for (const pg of pages) {
      const row = l0 => pg.lines.filter(o => Math.abs(o.y0 - l0.y0) < 4 && o.x > l0.x + 5).sort((a, b) => a.x - b.x);
      for (const q of pg.lines.filter(l => l.text === 'Q.')) {
        const a = pg.lines.find(l => l.text === 'A.' && l.y0 > q.y0 && l.y0 < q.y0 + 30 && Math.abs(l.x - q.x) < 10);
        if (!a) continue;
        const ans = row(a);
        for (const n of row(q)) { const c = ans.filter(o => Math.abs((o.x + o.x1) / 2 - (n.x + n.x1) / 2) < 25).map(o => o.text).join(' '); out.push(normAnswer(c)); }
      }
    }
    return out;
  }
  // Narayana-style grid on page 1: number cell then answer cell, ranges stacked over two lines
  function keyGrid(page, total) {
    const items = page.items.map(i => ({ x: i.x, y: i.y, s: i.s.trim() }));
    items.sort((a, b) => Math.round(a.y / 6) - Math.round(b.y / 6) || a.x - b.x);
    const TOKEN = /^([A-D]{1,4}|-?\d+(\.\d+)?|TO)$/;
    const cellOf = it => items.filter(o => o.x > it.x + 3 && o.x < it.x + 80 && Math.abs(o.y - it.y) < 18 && TOKEN.test(o.s)).sort((a, b) => a.y - b.y).map(o => o.s).join(' ');
    const one = items.find(i => i.s === '1' && ANSWER_RE.test(cellOf(i)));
    const row1 = one ? items.filter(o => Math.abs(o.y - one.y) < 6 && TOKEN.test(o.s)).sort((a, b) => a.x - b.x) : [];
    const cols = row1.filter((_, i) => i % 2 === 0).map(o => o.x);
    const out = []; let want = 1;
    for (const it of items) {
      if (want > total || !cols.length) break;
      if (!cols.some(c => Math.abs(c - it.x) < 6)) continue;
      if (it.s === String(want + 1)) want++;
      if (it.s !== String(want)) continue;
      const c = cellOf(it); out[want - 1] = ANSWER_RE.test(c) ? c : null; want++;
    }
    return out;
  }
  // try all parsers, keep the one that reads the most answers (ties: table formats first)
  function readKey(solAn, solPages, total, prefer) {
    const tries = { grid: keyGrid(solPages[0], total), qa: keyQA(solPages), inline: solAn ? keyInline(solAn, solPages) : [] };
    const order = [prefer, 'qa', 'grid', 'inline'].filter((x, i, a) => x && a.indexOf(x) === i && tries[x]);
    const score = k => tries[k].slice(0, total).filter(Boolean).length;
    const best = order.reduce((b, k) => score(k) > score(b) ? k : b, order[0]);
    return { answers: Array.from({ length: total }, (_, i) => tries[best][i] || ''), format: best, found: score(best) };
  }

  // ---- browser only: page rendering, ink rows and crops (canvas)
  const DPI = 150, SCALE = DPI / 72, PAD = 1;
  function renderer(pdf) {
    const canv = {}, sizes = {};
    const render = async p => {
      if (canv[p]) return canv[p];
      const page = await pdf.getPage(p), vp = page.getViewport({ scale: SCALE });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      sizes[p] = page.getViewport({ scale: 1 }); return (canv[p] = c);
    };
    // rows per pt: true if any pixel row inside that pt has ink between x0 and x1 (pt)
    const ink = async (p, x0, x1) => {
      const c = await render(p), ctx = c.getContext('2d'), px0 = Math.round(x0 * SCALE), w = Math.max(1, Math.round((x1 - x0) * SCALE));
      const d = ctx.getImageData(px0, 0, w, c.height).data, pxRows = new Uint8Array(c.height);
      for (let y = 0; y < c.height; y++) { let n = 0; for (let i = y * w * 4; i < (y + 1) * w * 4; i += 4) if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 170 && ++n >= 2) { pxRows[y] = 1; break; } }
      const H = Math.round(c.height / SCALE), rows = [];
      for (let y = 0; y < H; y++) { let on = false; for (let r = Math.floor(y * SCALE); r < Math.floor((y + 1) * SCALE) && r < c.height; r++) if (pxRows[r]) { on = true; break; } rows.push(on); }
      return rows;
    };
    // segs [[p, y0, y1, x0, x1], ...] -> PNG blobs, padded a little so a cut a few pt off never clips a line
    const crop = async segs => {
      const out = [];
      for (const [p, yA, yB, x0, x1] of segs) {
        const src = await render(p), H = src.height / SCALE, y0 = Math.max(0, yA - PAD), y1 = Math.min(H, yB + PAD);
        const c = document.createElement('canvas'), sx = x0 * SCALE, sy = y0 * SCALE, sw = (x1 - x0) * SCALE, sh = Math.max(4, (y1 - y0) * SCALE);
        c.width = sw; c.height = sh; c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
        out.push(await new Promise(r => c.toBlob(r, 'image/png')));
      }
      return out;
    };
    return { render, ink, crop };
  }
  async function readPdf(pdf, onPage) { // -> pages [{p, W, H, items, lines}]
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) { onPage?.(p, pdf.numPages); pages.push({ p, ...(await pageLines(await pdf.getPage(p))) }); }
    return pages;
  }

  const api = { pageLines, readPdf, analyse, readKey, renderer, normAnswer, inferType, inferMarks, ANSWER_RE };
  if (typeof module !== 'undefined') module.exports = api; else root.Cutter = api;
})(typeof window !== 'undefined' ? window : globalThis);
