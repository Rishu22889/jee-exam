// Shared: paper loading, scoring, attempt storage. Plain browser JS, also loadable by node for tests.
const JEE = {
  async loadPaper(id) {
    const r = await fetch(`papers/${id}/paper.json`);
    if (!r.ok) throw new Error(`paper ${id} not found`);
    return r.json();
  },
  async loadIndex() { return (await fetch('papers/index.json')).json(); },

  isAnswered(ans) { return !(ans == null || ans === '' || (Array.isArray(ans) && ans.length === 0)); },

  // returns {marks, verdict} ; verdict: correct | partial | wrong | skipped
  score(q, ans) {
    if (!JEE.isAnswered(ans)) return { marks: 0, verdict: 'skipped' };
    const key = String(q.answer).trim().toUpperCase();
    let ok;
    if (q.type === 'single') ok = ans === key;
    else if (q.type === 'multi') {
      const chosen = [...ans].sort(), correct = [...key].sort();
      if (chosen.some(c => !correct.includes(c))) return { marks: 0 - q.neg || 0, verdict: "wrong" };
      if (chosen.length === correct.length) return { marks: q.marks, verdict: 'correct' };
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

  attempts() { try { return JSON.parse(localStorage.getItem('jee.attempts') || '[]'); } catch { return []; } },
  saveAttempt(a) { const all = JEE.attempts().filter(x => x.id !== a.id); all.unshift(a); localStorage.setItem('jee.attempts', JSON.stringify(all)); },
  fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return [h, m, s].map(x => String(x).padStart(2, '0')).join(':'); },
  esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  typeLabel: { single: 'Single Correct Option', multi: 'One or More Correct Options', integer: 'Single Digit Integer (0-9)', numeric: 'Numerical Value' },
};
if (typeof module !== 'undefined') module.exports = JEE;
