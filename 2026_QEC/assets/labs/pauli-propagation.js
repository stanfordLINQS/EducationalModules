/* pauli-propagation: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['pauli-propagation'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EPS = 1e-12;
  const popcount = v => { let n = 0; for (; v; v &= v - 1) n++; return n; };
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const phase = e => [[1, 0], [0, 1], [-1, 0], [0, -1]][((e % 4) + 4) % 4];
  // Each term is c times the Hermitian word i^(x.z) X^x Z^z. Qubit 1 is the leftmost letter.
  function fromWord(word, coefficient = [1, 0]) {
    if (!/^[IXYZ]{1,7}$/.test(word)) throw new RangeError('Use one to seven I, X, Y, Z letters.');
    let x = 0, z = 0;
    [...word].forEach((p, q) => { if ('XY'.includes(p)) x |= 1 << q; if ('ZY'.includes(p)) z |= 1 << q; });
    return [{ x, z, coefficient: coefficient.slice() }];
  }
  const wordOf = (term, n) => Array.from({ length: n }, (_, q) => ['I', 'X', 'Z', 'Y'][((term.x >> q) & 1) + 2 * ((term.z >> q) & 1)]).join('');
  function collect(terms) {
    const found = new Map();
    for (const t of terms) {
      const key = `${t.x},${t.z}`, old = found.get(key) || { x: t.x, z: t.z, coefficient: [0, 0] };
      old.coefficient[0] += t.coefficient[0]; old.coefficient[1] += t.coefficient[1]; found.set(key, old);
    }
    return [...found.values()].filter(t => Math.hypot(...t.coefficient) > EPS).sort((a, b) => a.x - b.x || a.z - b.z);
  }
  function multiply(a, b) {
    const terms = [];
    for (const u of a) for (const v of b) {
      const x = u.x ^ v.x, z = u.z ^ v.z;
      const e = popcount(u.x & u.z) + popcount(v.x & v.z) + 2 * popcount(u.z & v.x) - popcount(x & z);
      terms.push({ x, z, coefficient: mul(mul(u.coefficient, v.coefficient), phase(e)) });
    }
    return collect(terms);
  }
  const singleton = (x, z, coefficient = [1, 0]) => [{ x, z, coefficient }];
  function generatorImage(axis, q, gate) {
    const bit = 1 << q, targets = gate.qubits;
    if (!targets.includes(q)) return singleton(axis === 'X' ? bit : 0, axis === 'Z' ? bit : 0);
    if (gate.type === 'H') return singleton(axis === 'Z' ? bit : 0, axis === 'X' ? bit : 0);
    if (gate.type === 'S') return singleton(axis === 'X' ? bit : 0, bit);
    if (gate.type === 'CNOT') return axis === 'X'
      ? singleton(bit | (q === targets[0] ? 1 << targets[1] : 0), 0)
      : singleton(0, bit | (q === targets[1] ? 1 << targets[0] : 0));
    if (gate.type === 'CZ') return singleton(axis === 'X' ? bit : 0, axis === 'Z' ? bit : 1 << targets.find(j => j !== q));
    if (gate.type === 'T') return axis === 'Z' ? singleton(0, bit)
      : [{ x: bit, z: 0, coefficient: [Math.SQRT1_2, 0] }, { x: bit, z: bit, coefficient: [Math.SQRT1_2, 0] }];
    if (gate.type === 'CCZ') {
      if (axis === 'Z') return singleton(0, bit);
      const [j, k] = targets.filter(v => v !== q).map(v => 1 << v);
      return [0, j, k, j | k].map((z, i) => ({ x: bit, z, coefficient: [i === 3 ? -0.5 : 0.5, 0] }));
    }
    throw new RangeError('Unknown gate.');
  }
  function conjugate(terms, gate, n) {
    if (!['H', 'S', 'CNOT', 'CZ', 'T', 'CCZ'].includes(gate.type)) throw new RangeError('Unknown gate.');
    const arity = { H: 1, S: 1, T: 1, CNOT: 2, CZ: 2, CCZ: 3 }[gate.type];
    if (!Number.isInteger(n) || n < 1 || n > 7 || gate.qubits.length !== arity || new Set(gate.qubits).size !== arity || gate.qubits.some(q => !Number.isInteger(q) || q < 0 || q >= n)) throw new RangeError('Invalid gate wires.');
    const output = [];
    for (const t of terms) {
      let image = singleton(0, 0, mul(t.coefficient, phase(popcount(t.x & t.z))));
      for (const axis of ['X', 'Z']) for (let q = 0; q < n; q++) if ((axis === 'X' ? t.x : t.z) & (1 << q)) image = multiply(image, generatorImage(axis, q, gate));
      output.push(...image);
    }
    return collect(output);
  }
  function circuit(id) {
    const g = (type, ...qubits) => ({ type, qubits });
    switch (id) {
      case 'z-check-ladder': return { id, n: 5, ancilla: 4, initialAncilla: '0', gates: [0, 1, 2, 3].map(q => g('CNOT', q, 4)) };
      case 'x-check': return { id, n: 5, ancilla: 4, initialAncilla: '+', gates: [...[0, 1, 2, 3].map(q => g('CNOT', 4, q)), g('H', 4)] };
      case 'steane-transversal-h': return { id, n: 7, gates: Array.from({ length: 7 }, (_, q) => g('H', q)) };
      case 'steane-transversal-s': return { id, n: 7, gates: Array.from({ length: 7 }, (_, q) => g('S', q)) };
      case 'three-cnots-swap': return { id, n: 2, gates: [g('CNOT', 0, 1), g('CNOT', 1, 0), g('CNOT', 0, 1)] };
      case 'reverse-cnot': return { id, n: 2, gates: [g('H', 0), g('H', 1), g('CNOT', 0, 1), g('H', 0), g('H', 1)] };
      case 'cz-to-cnot': return { id, n: 2, gates: [g('H', 1), g('CZ', 0, 1), g('H', 1)] };
      case 'cz-pair': return { id, n: 2, gates: [g('CZ', 0, 1)] };
      case 'hs-sequence': return { id, n: 1, gates: [g('H', 0), g('S', 0), g('H', 0)] };
      case 't-gate': return { id, n: 1, gates: [g('T', 0)] };
      case 'ccz': return { id, n: 3, gates: [g('CCZ', 0, 1, 2)] };
      default: throw new RangeError('Select a listed circuit.');
    }
  }
  function exactNumber(x) {
    if (Math.abs(x) < EPS) return '0';
    const s = x < 0 ? '-' : '', a = Math.abs(x);
    if (Math.abs(a - Math.SQRT1_2) < EPS) return `${s}1/√2`;
    if (Math.abs(a - 0.5) < EPS) return `${s}1/2`;
    if (Math.abs(a - 1) < EPS) return `${s}1`;
    return String(x);
  }
  function operatorText(terms, n, showPhase = true) {
    // Only an overall phase can be hidden. Relative signs in a sum remain visible.
    return terms.map((t, i) => {
      const word = wordOf(t, n), [re, im] = t.coefficient;
      if (terms.length === 1 && !showPhase) return word;
      if (Math.abs(im) < EPS) {
        const sign = re < 0 ? (i ? ' - ' : '-') : (i ? ' + ' : '+');
        return sign + (Math.abs(Math.abs(re) - 1) < EPS ? '' : `(${exactNumber(Math.abs(re))}) `) + word;
      }
      const c = Math.abs(re) < EPS ? `${im < 0 ? '-' : ''}${Math.abs(Math.abs(im) - 1) < EPS ? '' : exactNumber(Math.abs(im))}i` : `${exactNumber(re)}${im < 0 ? '' : '+'}${exactNumber(im)}i`;
      return `${i ? ' + ' : ''}(${c}) ${word}`;
    }).join('');
  }
  function frame(terms, n) {
    const support = terms.reduce((bits, t) => bits | t.x | t.z, 0), weights = terms.map(t => popcount(t.x | t.z));
    return { terms, text: operatorText(terms, n), isPauli: terms.length === 1, weight: terms.length === 1 ? weights[0] : null,
      supportWeight: popcount(support), termWeights: weights,
      letters: Array.from({ length: n }, (_, q) => [...new Set(terms.map(t => wordOf(t, n)[q]))].join('/')) };
  }
  function measure(c) {
    if (c.ancilla === undefined) return null;
    let terms = singleton(0, 1 << c.ancilla);
    const backward = [{ afterGate: c.gates.length, operator: operatorText(terms, c.n) }];
    // Both extraction circuits contain only self-inverse CNOT and H gates.
    for (let i = c.gates.length - 1; i >= 0; i--) {
      terms = conjugate(terms, c.gates[i], c.n);
      backward.push({ afterGate: i, operator: operatorText(terms, c.n) });
    }
    return { full: operatorText(terms, c.n), data: wordOf(terms[0], c.n).slice(0, 4), ancillaFactor: wordOf(terms[0], c.n)[4], backward };
  }
  function compute(params = {}) {
    const p = { circuit: 'z-check-ladder', qubit: 1, pauli: 'X', step: 8, show_phase: true, ...params }, warnings = [];
    let c;
    try { c = circuit(p.circuit); } catch (e) { warnings.push(e.message); }
    if (!Number.isInteger(p.qubit) || p.qubit < 1 || p.qubit > 7) warnings.push('Qubit must be an integer from 1 to 7.');
    if (!['X', 'Y', 'Z'].includes(p.pauli)) warnings.push('Select X, Y, or Z.');
    if (!Number.isInteger(p.step) || p.step < 0 || p.step > 8) warnings.push('Step must be an integer from 0 to 8.');
    if (typeof p.show_phase !== 'boolean') warnings.push('show_phase must be boolean.');
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };
    const qubit = Math.min(c.n, p.qubit), step = Math.min(c.gates.length, p.step);
    const input = 'I'.repeat(qubit - 1) + p.pauli + 'I'.repeat(c.n - qubit);
    let terms = fromWord(input); const frames = [frame(terms, c.n)];
    for (const gate of c.gates) { terms = conjugate(terms, gate, c.n); frames.push(frame(terms, c.n)); }
    const current = frames[step], measurement = measure(c);
    const isSteane = ['steane-transversal-h', 'steane-transversal-s'].includes(c.id);
    const checkMaps = isSteane ? ['XIXIXIX', 'IXXIIXX', 'IIIXXXX', 'ZIZIZIZ', 'IZZIIZZ', 'IIIZZZZ'].map(word => {
      let t = fromWord(word); for (const gate of c.gates.slice(0, step)) t = conjugate(t, gate, c.n);
      return { input: word, output: operatorText(t, c.n) };
    }) : [];
    // Ybar = i Xbar Zbar = -Y^7 for these weight-seven logical representatives.
    const logicalBasis = isSteane ? [
      { label: 'Xbar', word: 'XXXXXXX', sign: 1 },
      { label: 'Ybar', word: 'YYYYYYY', sign: -1 },
      { label: 'Zbar', word: 'ZZZZZZZ', sign: 1 }
    ] : [];
    const logicalMaps = logicalBasis.map(row => {
      const initial = fromWord(row.word, [row.sign, 0]);
      let t = initial; for (const gate of c.gates.slice(0, step)) t = conjugate(t, gate, c.n);
      const basis = logicalBasis.find(b => t.length === 1 && b.word === wordOf(t[0], c.n));
      const logicalOutput = step === c.gates.length && basis ? `${t[0].coefficient[0] * basis.sign > 0 ? '+' : '-'}${basis.label}` : null;
      return { label: row.label, input: operatorText(initial, c.n), output: operatorText(t, c.n), logicalOutput };
    });
    return { valid: true, params: p, warnings, circuit: c, qubit, step, input, frames, current, measurement, checkMaps, logicalMaps,
      series: { weight: frames.map((f, i) => [i, f.supportWeight]) },
      readouts: { operator: operatorText(current.terms, c.n, p.show_phase), weight: current.weight, supportWeight: current.supportWeight } };
  }
  return { compute, circuit, fromWord, wordOf, multiply, conjugate, operatorText, popcount };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('pauli-propagation', function mount(root, ctx) {
    const layout = ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const doc = root.ownerDocument, frame = doc.createElement('figure');
    frame.style.margin = '0'; frame.style.overflowX = 'auto'; frame.style.width = '100%';
    frame.tabIndex = 0;
    frame.setAttribute('aria-label', 'Circuit diagram; use arrow keys to scroll horizontally');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('role', 'img'); frame.appendChild(svg); layout.plots.appendChild(frame);
    const chart = ctx.plot(layout.plots, {
      title: 'Computed operator support after each gate',
      x: { label: 'Applied gate count (integer steps)', domain: [0, 8] },
      y: { label: 'Support size (Pauli weight for one term)', domain: [0, 7.3] }, legend: true
    });
    const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function diagram(result) {
      const c = result.circuit, spacing = 58, start = 110, end = start + (c.gates.length + 1) * spacing, width = end + 102, height = 88 + c.n * 44;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      svg.style.minWidth = `${width}px`; svg.style.maxWidth = 'none';
      svg.setAttribute('aria-label', `Computed ${c.id} circuit, step ${result.step} of ${c.gates.length}. Input ${result.input}; current operator ${result.current.text}${result.current.isPauli ? '' : ', not a Pauli'}.`);
      const y = q => 66 + q * 44;
      const text = (x, yy, s, anchor = 'middle', fill = 'currentColor') => `<text x="${x}" y="${yy}" text-anchor="${anchor}" fill="${fill}" font-size="13" font-family="sans-serif">${escape(s)}</text>`;
      const line = (x1, y1, x2, y2, stroke = 'var(--line)', extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="2" ${extra}/>`;
      const box = (x, yy, label) => `<rect x="${x - 15}" y="${yy - 15}" width="30" height="30" rx="3" fill="var(--bg)" stroke="currentColor"/>${text(x, yy + 5, label)}`;
      let content = `<title>${escape(c.id)} at gate step ${result.step}</title>` + text(8, 20, 'Computed circuit; time →', 'start') + text(end + 30, 38, 'At cut');
      for (let q = 0; q < c.n; q++) {
        content += line(88, y(q), end, y(q));
        content += text(7, y(q) + 5, q === c.ancilla ? `a${q + 1} |${c.initialAncilla}⟩` : `q${q + 1}`, 'start');
        if (q + 1 === result.qubit) content += `<circle cx="83" cy="${y(q)}" r="13" fill="var(--bg)" stroke="var(--plot-input)" stroke-width="2"/>` + text(83, y(q) + 5, result.params.pauli, 'middle', 'var(--plot-input)');
        content += text(end + 30, y(q) + 5, result.current.letters[q], 'middle', 'var(--plot-primary)');
      }
      c.gates.forEach((gate, i) => {
        const x = start + (i + 1) * spacing;
        content += text(x, height - 14, String(i + 1), 'middle', 'var(--muted)');
        if (gate.type === 'CNOT') {
          const [control, target] = gate.qubits;
          content += line(x, y(control), x, y(target), 'currentColor');
          content += `<circle cx="${x}" cy="${y(control)}" r="5" fill="currentColor"/>`;
          content += `<circle cx="${x}" cy="${y(target)}" r="12" fill="var(--bg)" stroke="currentColor"/>`;
          content += line(x - 8, y(target), x + 8, y(target), 'currentColor') + line(x, y(target) - 8, x, y(target) + 8, 'currentColor');
        } else if (gate.type === 'CZ' || gate.type === 'CCZ') {
          content += line(x, y(Math.min(...gate.qubits)), x, y(Math.max(...gate.qubits)), 'currentColor');
          for (const q of gate.qubits) content += `<circle cx="${x}" cy="${y(q)}" r="6" fill="currentColor"/>`;
          content += text(x, 39, gate.type);
        } else content += box(x, y(gate.qubits[0]), gate.type);
      });
      const cut = start + (result.step + 0.48) * spacing;
      content += line(cut, 43, cut, height - 32, 'var(--plot-accent)', 'stroke-dasharray="5 4"');
      content += text(cut, height - 1, `cut ${result.step}`, 'middle', 'var(--plot-accent)');
      if (c.ancilla !== undefined) content += text(end + 62, y(c.ancilla) + 23, 'MZ');
      svg.innerHTML = content;
    }
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
      if (!r.valid) { svg.innerHTML = ''; svg.setAttribute('aria-label', 'Invalid circuit parameters'); chart.update([]); ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return; }
      diagram(r);
      chart.update([
        { id: 'support-line', label: 'Computed support size', role: 'primary', kind: 'line', points: r.series.weight },
        { id: 'support-points', label: 'Discrete gate steps', role: 'accent', kind: 'scatter', points: r.series.weight }
      ], [{ type: 'vline', x: r.step, label: 'Current cut', role: 'accent' }]);
      const items = [
        { label: 'Computed effective input wire', value: r.qubit },
        { label: 'Computed applied gates', value: `${r.step} of ${r.circuit.gates.length}` },
        { label: `Computed operator${r.current.isPauli ? '' : ' (not a Pauli)'}`, value: r.readouts.operator },
        { label: 'Computed Pauli weight', value: r.current.isPauli ? r.current.weight : 'Not a Pauli' },
        { label: 'Computed support size', value: r.current.supportWeight }
      ];
      if (!r.current.isPauli) items.push({ label: 'Computed weights of expansion terms', value: r.current.termWeights.join(', ') });
      if (r.measurement) items.push({ label: 'Computed full backward observable', value: r.measurement.full }, { label: 'Computed measured data check', value: r.measurement.data });
      for (const row of r.logicalMaps) if (row.logicalOutput) items.push({ label: `Computed logical ${row.label} image (complete circuit)`, value: row.logicalOutput });
      ctx.readouts(layout.readouts, items);
      let notes = '<p><strong>Inspect, then change:</strong> Follow X copies forward and Z copies backward one gate at a time. Compare the two check circuits. Try a Y input in H then S then H and keep the phase visible. Finally, try to make T or CCZ preserve a Pauli by changing the input axis.</p>';
      notes += `<p>The requested wire ${r.params.qubit} uses effective wire ${r.qubit}; requested step ${r.params.step} uses cut ${r.step}. The right-hand letters refer to this cut. Gate spacing is illustrative.</p>`;
      if (['three-cnots-swap', 'reverse-cnot', 'cz-to-cnot'].includes(r.circuit.id)) notes += '<p><strong>Task: identify the two-wire gate.</strong> Keep phase visible and place the cut after all gates. Record the four signed images of X1, X2, Z1, Z2 by changing the input wire and Pauli. Which wire carries each output, and in which direction does an error copy? Explain why these images determine the gate up to global phase.</p>';
      if (r.circuit.id === 'hs-sequence') notes += '<p><strong>Task: identify HSH.</strong> Keep phase visible, use the final cut, and compare X, Y, and Z inputs. The computed images are +X, +Z, and -Y, respectively. Use these signed images to identify HSH as a square root of X up to global phase. Predict the conjugation images after repeating the sequence twice, then check them against conjugation by X.</p>';
      if (r.measurement) {
        notes += `<p>The ideal complete circuit measures ${r.measurement.data} on the data. The initial ancilla has ${r.measurement.ancillaFactor} expectation +1, removing that factor from ${r.measurement.full}.</p>`;
        notes += '<table><caption>Computed backward propagation of the final ancilla Z</caption><thead><tr><th>Cut after gate</th><th>Operator at that cut</th></tr></thead><tbody>' + r.measurement.backward.map(row => `<tr><td>${row.afterGate}</td><td>${escape(row.operator)}</td></tr>`).join('') + '</tbody></table>';
      }
      if (r.checkMaps.length) notes += '<table><caption>Computed Steane check images at the current cut</caption><thead><tr><th>Input generator</th><th>Conjugated operator</th></tr></thead><tbody>' + r.checkMaps.map(row => `<tr><td>${row.input}</td><td>${escape(row.output)}</td></tr>`).join('') + '</tbody></table>';
      if (r.logicalMaps.length) {
        notes += '<p>The declared logical representatives are Xbar = XXXXXXX, Zbar = ZZZZZZZ, and Ybar = i Xbar Zbar = -YYYYYYY. Check and logical tables always retain signs. Partial circuits need not preserve the code; logical image labels appear only at the complete circuit.</p>';
        notes += '<table><caption>Computed Steane logical images at the current cut</caption><thead><tr><th>Logical operator</th><th>Input physical operator</th><th>Conjugated physical operator</th><th>Complete-circuit logical image</th></tr></thead><tbody>' + r.logicalMaps.map(row => `<tr><td>${row.label}</td><td>${escape(row.input)}</td><td>${escape(row.output)}</td><td>${row.logicalOutput || 'Inspect the final cut'}</td></tr>`).join('') + '</tbody></table>';
      }
      if (r.circuit.id === 'steane-transversal-s') notes += '<p><strong>Task: separate physical and logical phase.</strong> Compare the complete-circuit images of weight-four checks with weight-seven logical operators. Each X check becomes the positive product of its matching X and Z checks, so the code is preserved. Explain why the signed logical images describe S dagger even though every physical gate is S.</p>';
      if (!r.current.isPauli) notes += '<p>Slash-separated wire letters do not specify independent choices. Read the full sum for its coefficients and correlated terms. The weight plot counts the union of their supports.</p>';
      ctx.notes(layout.notes, notes);
    }
    const unsubscribe = ctx.state.onChange(draw), unsubscribeTheme = ctx.onThemeChange(draw);
    draw();
    return { destroy() { unsubscribe(); unsubscribeTheme(); frame.remove(); } };
  });
})();

}).call(window);
