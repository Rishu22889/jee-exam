# Transcription spec for papers/<id>/latex_<Subject>.json

A JSON array, one object per question, in question order:

{
  "n": 7,
  "text": "Which of the following is/are odd functions? (where \\([.]\\) denotes G.I.F)",
  "options": {"A": "\\(f:\\mathbb{R}\\to\\mathbb{R}\\) such that \\(f(x)=\\dfrac{x\\,.\\,x}{1+x+x^2}\\)", "B": "...", "C": "...", "D": "..."},
  "figure": {"page": 9, "y0": 612, "y1": 700}
}

Rules
- `text` and each option are HTML strings. Math goes in `\(...\)` (inline) or `\[...\]` (display). Use `\ce{NH4NO2}` (mhchem) for chemical formulas and reactions.
- Transcribe VERBATIM: same wording, same symbols, same order of options, same numbers. Do not fix grammar, do not solve, do not simplify expressions.
- Multi-line statements, lists (1), 2), a., b.) and tables are written as HTML (`<br>`, `<ol>`, `<table>`).
- `options`: only for questions that show options A) B) C) D). Omit the key for integer / numerical questions.
- `figure`: only when the question contains something that cannot be typed (a diagram, a drawn circuit, a chemical structure drawing, a graph). `page` is the PDF page, `y0`/`y1` the top and bottom of the drawing in page points (A4 = 842pt tall, y from the top). `tools/merge_latex.py` renders it to fNN.png. Never put the whole question as the figure; the text still has to be typed. Omit the key when there is no drawing.
- Keep `\dfrac` for fractions in running text, `\int_0^x`, `\sum_{r=1}^{4}`, `\lim_{n\to\infty}`, `\vec{a}`, `\hat{i}`, `\Delta`, `\angle`, `^\circ`, `\mathrm{}` for units.
- Matrices: `\begin{bmatrix} ... \end{bmatrix}`.
