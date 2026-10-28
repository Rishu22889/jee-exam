// Shared: paper loading, scoring, attempt storage. Plain browser JS, also loadable by node for tests.
const JEE = {
  // paper.src(file) gives the URL of a question/solution image, whether the paper is bundled or uploaded
  async loadPaper(id) {
    const r = await fetch(`papers/${id}/paper.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) { const p = await r.json(); p.src = f => `papers/${id}/${f}`; return p; }
    const rec = await JEE.db.get(id);
    if (!rec) throw new Error(`paper ${id} not found`);
    const urls = {};
    rec.paper.src = f => urls[f] ??= URL.createObjectURL(rec.blobs[f]);
    return rec.paper;
  },
  // published papers (fresh: GitHub Pages and browsers cache index.json for minutes) + papers saved only in this browser
  async loadIndex() {
    let published = [];
    try { published = await (await fetch(`papers/index.json?t=${Date.now()}`, { cache: 'no-store' })).json(); } catch {}
    const ids = new Set(published.map(p => p.id));
    const local = (await JEE.db.all().catch(() => [])).filter(r => !ids.has(r.id)).map(r => JEE.indexEntry(r.paper, { local: true }));
    return [...published, ...local];
  },
  indexEntry: (p, extra) => ({ id: p.id, exam: p.exam || 'Uploaded', title: p.title, duration: p.duration / 60, maxMarks: p.maxMarks, questions: p.questions?.length, ...extra }),
  // uploaded papers live in IndexedDB: {id, paper, blobs:{file: Blob}}
  db: {
    open() {
      return new Promise((res, rej) => {
        const q = indexedDB.open('jee', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('papers', { keyPath: 'id' });
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
    },
    async tx(mode, fn) {
      const db = await JEE.db.open();
      return new Promise((res, rej) => { const r = fn(db.transaction('papers', mode).objectStore('papers')); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    },
    get(id) { return JEE.db.tx('readonly', s => s.get(id)); },
    all() { return JEE.db.tx('readonly', s => s.getAll()); },
    put(rec) { return JEE.db.tx('readwrite', s => s.put(rec)); },
    del(id) { return JEE.db.tx('readwrite', s => s.delete(id)); },
  },

  isAnswered(ans) { return !(ans == null || ans === '' || (Array.isArray(ans) && ans.length === 0)); },

  // returns {marks, verdict} ; verdict: correct | partial | wrong | skipped
  score(q, ans) {
    if (!JEE.isAnswered(ans)) return { marks: 0, verdict: 'skipped' };
    const key = String(q.answer).trim().toUpperCase();
    let ok;
    if (q.type === 'single' || q.type === 'matching') ok = ans === key;
    else if (q.type === 'multi') {
      const chosen = [...ans].sort(), correct = [...key].sort();
      if (chosen.some(c => !correct.includes(c))) return { marks: 0 - q.neg || 0, verdict: "wrong" };
      if (chosen.length === correct.length) return { marks: q.marks, verdict: 'correct' };
      if (q.partial === false) return { marks: 0 - q.neg || 0, verdict: 'wrong' };   // all-or-nothing scheme
      // JEE Advanced partial marking: +1 per correct option chosen when no wrong option is chosen
      return { marks: Math.min(chosen.length, q.marks - 1), verdict: 'partial' };
    } else if (q.type === 'integer') ok = Number(ans) === Number(key);
    else if (q.type === 'numeric') {
      const u = parseFloat(ans);
      if (Number.isNaN(u)) return { marks: 0 - q.neg || 0, verdict: "wrong" };
      const m = key.match(/^(-?[\d.]+)\s*TO\s*(-?[\d.]+)$/);
      ok = m ? u >= parseFloat(m[1]) - 1e-9 && u <= parseFloat(m[2]) + 1e-9
             : Math.abs(u - parseFloat(key)) <= 0.005 + 1e-9;
    }
    return ok ? { marks: q.marks, verdict: "correct" } : { marks: 0 - q.neg || 0, verdict: "wrong" };
  },

  // full analysis of an attempt: per question, per subject, per section
  analyse(paper, responses) {
    const rows = paper.questions.map(q => {
      const r = responses[q.n] || {};
      return { q, ans: r.ans ?? null, time: r.time || 0, status: r.status || 'nv', ...JEE.score(q, r.ans) };
    });
    const group = keyFn => {
      const g = {};
      for (const row of rows) {
        const k = keyFn(row.q);
        g[k] ??= { key: k, score: 0, max: 0, correct: 0, partial: 0, wrong: 0, skipped: 0, time: 0, count: 0 };
        const s = g[k]; s.score += row.marks; s.max += row.q.marks; s[row.verdict]++; s.time += row.time; s.count++;
      }
      return Object.values(g);
    };
    const total = group(() => 'Total')[0];
    return { rows, total, subjects: group(q => q.subject), sections: group(q => `${q.subject} · Sec ${q.section} (${q.type})`) };
  },

  // ---- attempts: kept in this browser; copied to the GitHub repo (results/<id>.json) when the device is linked
  attempts() { try { return JSON.parse(localStorage.getItem('jee.attempts') || '[]'); } catch { return []; } },
  setAttempts(all) { all.sort((a, b) => b.submittedAt - a.submittedAt); localStorage.setItem('jee.attempts', JSON.stringify(all)); },
  saveAttempt(a) { JEE.setAttempts([a, ...JEE.attempts().filter(x => x.id !== a.id)]); },
  async syncAttempts() { // push attempts not yet on GitHub; stops at the first failure and retries on the next page load
    if (!JEE.gh.linked()) return 0;
    let n = 0;
    for (const a of JEE.attempts().filter(a => !a.synced)) {
      const { synced, ...data } = a;
      try { await JEE.gh.putFile(`results/${a.id}.json`, JSON.stringify(data), `Result: ${a.name} · ${a.title} · ${a.score}/${a.max}`); }
      catch (e) { if (!/422/.test(e.message)) { console.warn('sync failed', e); break; } } // 422: already uploaded
      JEE.setAttempts(JEE.attempts().map(x => x.id === a.id ? { ...x, synced: true } : x)); n++;
    }
    return n;
  },
  async remoteAttempts() { // attempts in the repo, cached in this browser so each file is downloaded once
    let cache = {}; try { cache = JSON.parse(localStorage.getItem('jee.remote') || '{}'); } catch {}
    if (!JEE.gh.linked()) return Object.values(cache);
    const list = await JEE.gh.list('results');
    const want = new Map(list.filter(f => f.name.endsWith('.json')).map(f => [f.name.slice(0, -5), f.path]));
    for (const id of Object.keys(cache)) if (!want.has(id)) delete cache[id];
    await Promise.all([...want].filter(([id]) => !cache[id]).map(async ([id, path]) => { try { cache[id] = await JEE.gh.getJson(path); } catch {} }));
    try { localStorage.setItem('jee.remote', JSON.stringify(cache)); } catch {}
    return Object.values(cache);
  },
  async allAttempts() { // local first (newest data), then the repo's; one entry per attempt id
    const local = JEE.attempts(); let remote = [];
    try { remote = await JEE.remoteAttempts(); } catch (e) { console.warn(e); }
    const ids = new Set(local.map(a => a.id));
    return [...local, ...remote.filter(a => !ids.has(a.id))].sort((a, b) => b.submittedAt - a.submittedAt);
  },
  async findAttempt(id) {
    const a = JEE.attempts().find(x => x.id === id); if (a) return a;
    try { const c = JSON.parse(localStorage.getItem('jee.remote') || '{}'); if (c[id]) return c[id]; } catch {}
    if (JEE.gh.linked()) try { return await JEE.gh.getJson(`results/${id}.json`); } catch {}
    try { const r = await fetch(`results/${encodeURIComponent(id)}.json`, { cache: 'no-store' }); if (r.ok) return r.json(); } catch {}
    return null;
  },
  // per-subject summary of an attempt (stored at submit; older attempts are computed from the paper)
  async summary(a) {
    if (a.subjects) return a;
    try { const an = JEE.analyse(await JEE.loadPaper(a.paperId), a.responses); return { ...a, subjects: JEE.subjectSummary(an) }; } catch { return { ...a, subjects: [] }; }
  },
  subjectSummary: an => an.subjects.map(({ key, score, max, correct, partial, wrong, skipped, time }) => ({ key, score, max, correct, partial, wrong, skipped, time })),

  // ---- GitHub: repo, branch and token live in this browser only (localStorage)
  gh: {
    cfg() {
      const g = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
      return { repo: g('gh.repo') || JEE.gh.guessRepo(), branch: g('gh.branch') || 'main', token: g('gh.token') };
    },
    guessRepo() { // https://user.github.io/repo/... -> user/repo
      const m = location.hostname.match(/^([\w-]+)\.github\.io$/i), seg = location.pathname.split('/')[1];
      return m && seg && !seg.includes('.') ? `${m[1]}/${seg}` : '';
    },
    save({ repo, branch, token }) { localStorage.setItem('gh.repo', repo); localStorage.setItem('gh.branch', branch || 'main'); if (token) localStorage.setItem('gh.token', token); else localStorage.removeItem('gh.token'); },
    linked() { const c = JEE.gh.cfg(); return !!(c.repo && c.token); },
    async api(method, path, body, c = JEE.gh.cfg()) {
      const r = await fetch(`https://api.github.com/repos/${c.repo}/${path}`, { method, cache: 'no-store', headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body) });
      if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: ${r.status} ${(await r.json().catch(() => ({}))).message || ''}`);
      return r.status === 204 ? null : r.json();
    },
    b64: str => btoa(unescape(encodeURIComponent(str))),
    unb64: b => decodeURIComponent(escape(atob(b.replace(/\n/g, '')))),
    async list(dir) { const c = JEE.gh.cfg(); try { return await JEE.gh.api('GET', `contents/${dir}?ref=${c.branch}`); } catch (e) { if (/: 404/.test(e.message)) return []; throw e; } },
    async getJson(path) {
      const f = await JEE.gh.api('GET', `contents/${path}?ref=${JEE.gh.cfg().branch}`);
      if (f.content) return JSON.parse(JEE.gh.unb64(f.content));
      return JSON.parse(JEE.gh.unb64((await JEE.gh.api('GET', `git/blobs/${f.sha}`)).content)); // files over 1 MB
    },
    putFile(path, text, message) { return JEE.gh.api('PUT', `contents/${path}`, { message, content: JEE.gh.b64(text), branch: JEE.gh.cfg().branch }); },
    // one commit with many files. files: [{path, content (base64) | null to delete}]; retries if the branch moved meanwhile
    async commit(files, message, progress = () => {}) {
      const { api } = JEE.gh, branch = JEE.gh.cfg().branch, blobs = [], queue = files.map((f, i) => [f, i]);
      let done = 0;
      const worker = async () => { while (queue.length) { const [f, i] = queue.shift(); blobs[i] = f.content == null ? null : (await api('POST', 'git/blobs', { content: f.content, encoding: 'base64' })).sha; progress(++done, files.length); } };
      await Promise.all([worker(), worker(), worker(), worker()]);
      for (let attempt = 0; ; attempt++) {
        const headSha = (await api('GET', `git/ref/heads/${branch}`)).object.sha, baseTree = (await api('GET', `git/commits/${headSha}`)).tree.sha;
        const tree = await api('POST', 'git/trees', { base_tree: baseTree, tree: files.map((f, i) => ({ path: f.path, mode: '100644', type: 'blob', sha: blobs[i] })) });
        const c = await api('POST', 'git/commits', { message, tree: tree.sha, parents: [headSha] });
        try { await api('PATCH', `git/refs/heads/${branch}`, { sha: c.sha }); return c.sha; } catch (e) { if (attempt >= 2) throw e; }
      }
    },
    // a QR link carries {repo, branch, token} in the URL hash (never sent to a server); the page stores it and strips it
    linkUrl() { const c = JEE.gh.cfg(); return new URL('index.html', location.href).href.split('#')[0] + '#link=' + btoa(JSON.stringify({ r: c.repo, b: c.branch, t: c.token })); },
    acceptLink() {
      const m = location.hash.match(/^#link=(.+)$/); if (!m) return false;
      history.replaceState(null, '', location.pathname + location.search);
      try { const { r, b, t } = JSON.parse(atob(decodeURIComponent(m[1]))); JEE.gh.save({ repo: r, branch: b, token: t }); return true; } catch { return false; }
    },
  },

  fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return [h, m, s].map(x => String(x).padStart(2, '0')).join(':'); },
  esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  // question body: typed text + optional figure (a clipped band of the crop) when transcribed, else the crop images
  bodyHtml(q, src) {
    const psg = q.passageImages?.length ? `<div class="passage"><b>Paragraph</b>${q.passageImages.map(f => `<img src="${src(f)}" alt="paragraph">`).join('')}</div>` : '';
    return psg + JEE.questionHtml(q, src);
  },
  questionHtml(q, src) {
    if (!q.text) return q.images.map(f => `<img src="${src(f)}" alt="question ${q.n}">`).join('');
    const f = q.figure;
    const fig = f ? `<div class="fig"><img src="${src(f.image)}" alt="figure"></div>` : '';
    return `<div class="qtext">${q.text}</div>${fig}`;
  },
  typeset(el) { if (window.MathJax?.typesetPromise) return MathJax.typesetPromise([el]).catch(() => {}); },
  typeLabel: { single: 'Single Correct Option', multi: 'One or More Correct Options', matching: 'Matching List (one correct option)', integer: 'Single Digit Integer (0-9)', numeric: 'Numerical Value' },
  isChoice: q => q.type === 'single' || q.type === 'multi' || q.type === 'matching',
};
if (typeof module !== 'undefined') module.exports = JEE;
