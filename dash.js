// dash.js: progress dashboard shared by index.html (student) and upload.html (reports).
// Stat tiles, score-trend line, subject strength bars, attempts table. Plain SVG/HTML, no chart library.
const Dash = {
  pct: (s, m) => (m ? Math.round((100 * s) / m) : 0),
  date: t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  when: t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),

  tiles(atts) {
    const p = atts.map(a => Dash.pct(a.score, a.max));
    const last = atts[0], best = atts.reduce((b, a) => (!b || a.score / a.max > b.score / b.max ? a : b), null);
    const avg = p.length ? Math.round(p.reduce((s, x) => s + x, 0) / p.length) : null;
    const hours = atts.reduce((s, a) => s + (a.submittedAt - a.startedAt), 0) / 3600e3;
    const tile = (k, v, s) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
    return `<div class="tiles">${[
      tile('Tests taken', atts.length, `${hours.toFixed(1)} h of exam time`),
      tile('Latest score', last ? Dash.pct(last.score, last.max) + '%' : '–', last ? `${last.score} / ${last.max} · ${JEE.esc(last.title)}` : ''),
      tile('Best score', best ? Dash.pct(best.score, best.max) + '%' : '–', best ? `${best.score} / ${best.max} · ${Dash.date(best.submittedAt)}` : ''),
      tile('Average', avg == null ? '–' : avg + '%', p.length ? `over ${p.length} test${p.length > 1 ? 's' : ''}` : ''),
    ].join('')}</div>`;
  },

  // percentage of maximum marks per test, oldest to newest; single series, so no legend box
  trend(el, atts) {
    const pts = [...atts].sort((a, b) => a.submittedAt - b.submittedAt).map(a => ({ a, v: Dash.pct(a.score, a.max) }));
    if (pts.length < 2) { el.innerHTML = `<div class="empty">${pts.length ? 'One test so far. The trend line appears after the second test.' : 'No tests yet.'}</div>`; return; }
    let lastW = 0;
    const draw = () => {
      const W = Math.round(el.clientWidth); if (!W || W === lastW) return; lastW = W;
      const H = 220, L = 38, R = 40, T = 14, B = 26, n = pts.length;
      const lo = Math.min(0, Math.floor(Math.min(...pts.map(p => p.v)) / 25) * 25), hi = 100;
      const x = i => L + ((W - L - R) * i) / (n - 1), y = v => T + ((H - T - B) * (hi - v)) / (hi - lo);
      const ticks = []; for (let t = lo; t <= hi; t += 25) ticks.push(t);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      const area = `${line}L${x(n - 1).toFixed(1)},${y(Math.max(lo, 0))}L${x(0).toFixed(1)},${y(Math.max(lo, 0))}Z`;
      const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 70))));
      const xl = pts.map((p, i) => (i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${Dash.date(p.a.submittedAt)}</text>` : '').join('');
      el.innerHTML = `<svg height="${H}" role="img" aria-label="Score trend: ${pts.map(p => p.v + '%').join(', ')}">
        ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--${t === 0 ? 'axis' : 'grid'})" stroke-width="1"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`).join('')}
        <path d="${area}" fill="var(--series-1)" fill-opacity=".1"/>
        <path d="${line}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line class="xh" y1="${T}" y2="${H - B}" stroke="var(--axis)" stroke-width="1" visibility="hidden"/>
        ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="4" fill="var(--series-1)" stroke="var(--chart-surface)" stroke-width="2"/>`).join('')}
        <text class="end" x="${x(n - 1) + 8}" y="${y(pts[n - 1].v) + 4}">${pts[n - 1].v}%</text>
        ${xl}
        <rect x="${L - 10}" y="0" width="${W - L - R + 20}" height="${H}" fill="transparent" class="hit"/>
      </svg>`;
      const svg = el.querySelector('svg'), xh = svg.querySelector('.xh');
      const move = e => {
        const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - L) / (W - L - R)) * (n - 1)))), p = pts[i];
        xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
        Dash.showTip(`<b>${p.v}%</b> · ${p.a.score} / ${p.a.max}<br>${JEE.esc(p.a.title)}<br><span class="muted">${Dash.when(p.a.submittedAt)}${p.a.name ? ' · ' + JEE.esc(p.a.name) : ''}</span>`, e);
      };
      svg.onpointermove = svg.onpointerdown = move;
      svg.onpointerleave = () => { xh.setAttribute('visibility', 'hidden'); Dash.hideTip(); };
    };
    draw();
    if (window.ResizeObserver) new ResizeObserver(draw).observe(el);
  },

  // marks % per subject over all tests (sum of marks / sum of maximum), single series
  subjects(atts) {
    const g = {};
    for (const a of atts) for (const s of a.subjects || []) {
      const t = (g[s.key] ??= { key: s.key, score: 0, max: 0, correct: 0, partial: 0, wrong: 0, n: 0 });
      t.score += s.score; t.max += s.max; t.correct += s.correct; t.partial += s.partial; t.wrong += s.wrong; t.n++;
    }
    const rows = Object.values(g);
    if (!rows.length) return '<div class="empty">Subject strength appears after the first test.</div>';
    return `<div class="hbars">${rows.map(s => {
      const p = Dash.pct(s.score, s.max), tried = s.correct + s.partial + s.wrong;
      const tip = `<b>${s.key}</b><br>${s.score} / ${s.max} marks over ${s.n} test${s.n > 1 ? 's' : ''}<br>accuracy ${tried ? Dash.pct(s.correct, tried) : 0}% (${s.correct} correct, ${s.wrong} wrong)`;
      return `<div class="hbar" data-tip="${JEE.esc(tip)}"><span class="lab">${s.key}</span><div class="track"><i style="width:${Math.max(0, p)}%"></i></div><span class="val">${p}%</span></div>`;
    }).join('')}</div>`;
  },

  table(atts, href = a => `result.html?a=${encodeURIComponent(a.id)}`, del = false) {
    if (!atts.length) return '<div class="empty">No tests taken yet.</div>';
    return `<div class="tablewrap"><table><tr><th>Date</th><th>Paper</th><th class="hide-sm">Name</th><th class="num">Score</th><th style="min-width:110px">%</th><th>Left test</th><th></th></tr>${atts.map(a => {
      const p = Dash.pct(a.score, a.max), away = a.away?.count || 0;
      return `<tr><td>${Dash.when(a.submittedAt)}</td><td>${JEE.esc(a.title)}</td><td class="hide-sm">${JEE.esc(a.name || '')}</td><td class="num"><b>${a.score}</b> / ${a.max}</td>
        <td><div class="row" style="flex-wrap:nowrap"><div class="meter" style="flex:1"><i style="width:${Math.max(0, p)}%"></i></div><span class="num" style="width:38px">${p}%</span></div></td>
        <td>${away ? `<span class="badge warn" title="left the exam window ${away} times, ${JEE.fmtTime(a.away.secs)} in total">${away}× · ${a.away.secs < 60 ? Math.round(a.away.secs) + ' s' : Math.round(a.away.secs / 60) + ' min'}</span>` : '<span class="muted">no</span>'}</td>
        <td><div class="row" style="flex-wrap:nowrap"><a class="btn small" href="${href(a)}">Analysis</a>${del ? `<button class="btn small danger" data-delrep="${JEE.esc(a.id)}">Delete</button>` : ''}</div></td></tr>`;
    }).join('')}</table></div>`;
  },

  // tooltips for any [data-tip] element: hover with a mouse, tap on touch screens
  tipEl: null,
  showTip(html, e) {
    const t = (Dash.tipEl ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tip' })));
    t.innerHTML = html; t.classList.remove('hidden');
    const w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, e.clientX + 12)) + 'px';
    t.style.top = (e.clientY - h - 12 < 8 ? e.clientY + 16 : e.clientY - h - 12) + 'px';
  },
  hideTip() { Dash.tipEl?.classList.add('hidden'); },
  tips(root) {
    root.addEventListener('pointermove', e => { const el = e.target.closest('[data-tip]'); if (el) Dash.showTip(el.dataset.tip, e); });
    root.addEventListener('pointerdown', e => { const el = e.target.closest('[data-tip]'); if (el) Dash.showTip(el.dataset.tip, e); });
    root.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]') && !e.relatedTarget?.closest?.('[data-tip]')) Dash.hideTip(); });
  },

  // tiles + trend + subject strength into root; returns the attempts with subject summaries
  async render(root, atts) {
    atts = await Promise.all(atts.map(JEE.summary));
    root.innerHTML = `${Dash.tiles(atts)}<div class="grid2"><div class="card"><h3>Score trend <span class="muted" style="font-weight:normal;font-size:13px">% of maximum marks</span></h3><div class="chart"></div></div>
      <div class="card"><h3>Subject strength <span class="muted" style="font-weight:normal;font-size:13px">% of marks, all tests</span></h3>${Dash.subjects(atts)}</div></div>`;
    Dash.trend(root.querySelector('.chart'), atts);
    Dash.tips(root);
    return atts;
  },
};
