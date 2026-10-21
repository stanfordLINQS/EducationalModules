/* check-circuit: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['check-circuit'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const defaults = { basis: 'X', gate: 'CNOT', data_h: false, order: 'Z', fault: 'I', k: 2, step: 4 };
  const orders = { Z: ['NE', 'NW', 'SE', 'SW'], N: ['NE', 'SE', 'NW', 'SW'], clockwise: ['NW', 'NE', 'SE', 'SW'] };
  const corners = ['NW', 'NE', 'SW', 'SE'];
  const weight = bits => { let n = 0; for (; bits; bits &= bits - 1) n++; return n; };
  const letter = (p, q) => ['I', 'X', 'Z', 'Y'][((p.x >> q) & 1) + 2 * ((p.z >> q) & 1)];
  // i^phase times a Hermitian tensor word, with Y = i X Z at each occupied wire.
  // Conjugation preserves Hermiticity, so phase is 0 or 2, including for Y faults.
  function fromWord(word, sign = 1) {
    if (!/^[IXYZ]{1,9}$/.test(word) || ![1, -1].includes(sign)) throw new RangeError('Use one to nine I, X, Y, Z letters and sign +1 or -1.');
    let x = 0, z = 0;
    [...word].forEach((v, q) => { if ('XY'.includes(v)) x |= 1 << q; if ('ZY'.includes(v)) z |= 1 << q; });
    return { x, z, phase: sign === 1 ? 0 : 2 };
  }
  function conjugate(p, gate, n = 5) {
    const arity = { H: 1, CNOT: 2, CZ: 2 }[gate?.type], qs = gate?.qubits;
    if (!Number.isInteger(n) || n < 1 || n > 9 || !arity || !Array.isArray(qs) || qs.length !== arity || new Set(qs).size !== arity || qs.some(q => !Number.isInteger(q) || q < 0 || q >= n)) throw new RangeError('Invalid Clifford gate or wires.');
    if (!p || ![p.x, p.z].every(b => Number.isInteger(b) && b >= 0 && b < 2 ** n) || ![0, 2].includes(p.phase)) throw new RangeError('Invalid signed Pauli.');
    let { x, z, phase } = p;
    const [a, b] = qs, xa = (x >> a) & 1, za = (z >> a) & 1;
    if (gate.type === 'H') {
      phase ^= 2 * xa * za;
      if (xa !== za) { x ^= 1 << a; z ^= 1 << a; }
    } else {
      const xb = (x >> b) & 1, zb = (z >> b) & 1;
      if (gate.type === 'CNOT') {
        phase ^= 2 * xa * zb * (xb ^ za ^ 1);
        x ^= xa << b; z ^= zb << a;
      } else {
        phase ^= 2 * xa * xb * (za ^ zb);
        z ^= (xa << b) | (xb << a);
      }
    }
    return { x, z, phase };
  }
  function operatorText(p, labels) {
    const factors = labels.flatMap((label, q) => letter(p, q) === 'I' ? [] : [letter(p, q) + label]);
    return (p.phase === 2 ? '-' : '') + (factors.join(' ') || 'I');
  }
  function canonicalPatch() {
    const supports = [[1,2,4,5], [5,6,8,9], [2,3], [7,8], [2,3,5,6], [4,5,7,8], [1,4], [6,9]];
    const positions = [[0.5,0.5], [1.5,1.5], [1.5,-0.45], [0.5,2.45], [1.5,0.5], [0.5,1.5], [-0.45,0.5], [2.45,1.5]];
    return {
      data: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, col: i % 3, row: Math.floor(i / 3) })),
      checks: supports.map((support, i) => ({ id: `${i < 4 ? 'X' : 'Z'}-${'abcd'[i % 4]}`, type: i < 4 ? 'X' : 'Z', support, col: positions[i][0], row: positions[i][1] })),
      logical: { X: [1,4,7], Z: [1,2,3] }
    };
  }
  function syndrome(data) {
    return canonicalPatch().checks.map(check => check.support.reduce((s, q) => s ^ (((check.type === 'X' ? data.z : data.x) >> (q - 1)) & 1), 0));
  }
  function makeCircuit(p) {
    const data = p.basis === 'X' ? [1,2,4,5] : [2,3,5,6], labels = ['A', ...data];
    const gates = [], add = (type, qubits, stage, block = null, corner = null) => gates.push({ type, qubits, stage, block, corner });
    const ancillaH = p.gate === 'CZ' || p.basis === 'X';
    if (ancillaH) add('H', [0], 'input');
    if (p.gate === 'CZ' && p.data_h) for (let q = 1; q <= 4; q++) add('H', [q], 'input');
    const checkpoints = [gates.length];
    orders[p.order].forEach((corner, i) => {
      const q = corners.indexOf(corner) + 1;
      add(p.gate, p.gate === 'CNOT' && p.basis === 'Z' ? [q, 0] : [0, q], 'entangling', i + 1, corner);
      checkpoints.push(gates.length);
    });
    if (p.gate === 'CZ' && p.data_h) for (let q = 1; q <= 4; q++) add('H', [q], 'output');
    if (ancillaH) add('H', [0], 'output');
    return { data, labels, gates, checkpoints, cornerOrder: orders[p.order].slice(), dataOrder: orders[p.order].map(c => data[corners.indexOf(c)]) };
  }
  function dataPart(p, data) {
    let x = 0, z = 0;
    data.forEach((q, i) => { x |= ((p.x >> (i + 1)) & 1) << (q - 1); z |= ((p.z >> (i + 1)) & 1) << (q - 1); });
    return { x, z, phase: 0 };
  }
  function projectAncilla(p, data) {
    const ancillaFactor = letter(p, 0), deterministic = ['I', 'Z'].includes(ancillaFactor);
    const operator = deterministic ? { ...dataPart(p, data), phase: p.phase } : null;
    return { deterministic, ancillaFactor, operator, text: operator ? operatorText(operator, [1,2,3,4,5,6,7,8,9]) : 'Not a deterministic Pauli measurement' };
  }
  function compute(params = {}) {
    const p = { ...defaults, ...params }, warnings = [];
    if (!['X','Z'].includes(p.basis)) warnings.push('Choose intended family X or Z.');
    if (!['CNOT','CZ'].includes(p.gate)) warnings.push('Choose CNOT or CZ gates.');
    if (!Object.hasOwn(orders, p.order)) warnings.push('Choose one of the three corner orders.');
    if (!['I','X','Y','Z'].includes(p.fault)) warnings.push('Choose I, X, Y or Z for the ancilla fault.');
    if (typeof p.data_h !== 'boolean') warnings.push('Data H must be on or off.');
    for (const key of ['k','step']) if (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > 4) warnings.push(`${key} must be an integer from 0 through 4.`);
    if (warnings.length) return { valid: false, params: p, warnings, readouts: {}, trace: [] };
    const circuit = makeCircuit(p), { gates, checkpoints, labels, data } = circuit, patch = canonicalPatch();
    const backward = Array(gates.length + 1);
    backward[gates.length] = fromWord('ZIIII');
    for (let i = gates.length - 1; i >= 0; i--) backward[i] = conjugate(backward[i + 1], gates[i]);
    const measurement = projectAncilla(backward[0], data);
    const mask = data.reduce((bits, q) => bits | (1 << (q - 1)), 0);
    const intended = { x: p.basis === 'X' ? mask : 0, z: p.basis === 'Z' ? mask : 0, phase: 0 };
    const match = measurement.deterministic && ['x','z','phase'].every(k => measurement.operator[k] === intended[k]);
    const injection = checkpoints[p.k], forward = [];
    let error = fromWord('IIIII');
    for (let i = 0; i <= gates.length; i++) {
      if (i) error = conjugate(error, gates[i - 1]);
      if (i === injection) error = fromWord(p.fault + 'IIII');
      forward.push({ ...error });
    }
    const final = forward.at(-1), dataError = dataPart(final, data), rawWeight = weight(dataError.x | dataError.z);
    const pureType = rawWeight === 0 ? null : dataError.z === 0 ? 'X' : dataError.x === 0 ? 'Z' : null;
    const canReduce = match && (rawWeight === 0 || pureType === p.basis);
    const modCheckWeight = canReduce ? Math.min(rawWeight, weight((dataError.x ^ intended.x) | (dataError.z ^ intended.z))) : null;
    const support = patch.data.filter(q => ((dataError.x | dataError.z) >> (q.id - 1)) & 1);
    let orientation = 'Not applicable', pairDirection = null;
    if (match && pureType === p.basis && support.length === 2) {
      pairDirection = support[0].row === support[1].row ? 'row' : support[0].col === support[1].col ? 'column' : 'diagonal';
      const logicalDirection = p.basis === 'X' ? 'vertical' : 'horizontal';
      orientation = pairDirection === 'diagonal' ? `Diagonal to ${logicalDirection} logical ${p.basis}`
        : `${(pairDirection === 'column') === (p.basis === 'X') ? 'Parallel' : 'Perpendicular'} to ${logicalDirection} logical ${p.basis}`;
    }
    const bits = syndrome(dataError), flagged = patch.checks.filter((c, i) => bits[i]).map(c => c.id);
    const sameSyndromeSingles = match && pureType === p.basis && rawWeight > 0 ? patch.data.flatMap(q => {
      const single = { x: pureType === 'X' ? 1 << (q.id - 1) : 0, z: pureType === 'Z' ? 1 << (q.id - 1) : 0 };
      return syndrome(single).every((bit, i) => bit === bits[i]) ? [pureType + q.id] : [];
    }) : [];
    const trace = forward.map((fault, afterGate) => ({
      afterGate, gate: afterGate ? gates[afterGate - 1] : null, checkpoint: checkpoints.indexOf(afterGate),
      injected: afterGate === injection, faultPresent: afterGate >= injection && p.fault !== 'I',
      forward: fault, backward: backward[afterGate], forwardText: operatorText(fault, labels), backwardText: operatorText(backward[afterGate], labels)
    }));
    const allLabels = patch.data.map(q => q.id), beforeOutput = dataPart(forward[checkpoints[4]], data);
    return { valid: true, params: p, warnings, circuit, patch, measurement, intended, match, dataError, bits, flagged,
      trace, current: trace[checkpoints[p.step]], final, support: support.map(q => q.id), pairDirection, sameSyndromeSingles,
      readouts: { measured: measurement.text, intended: operatorText(intended, allLabels), match: match ? 'yes' : 'no',
        dataError: operatorText(dataError, allLabels), rawWeight, modCheckWeight, orientation,
        syndrome: flagged.join(', ') || 'None', readoutFlip: final.x & 1,
        beforeOutput: operatorText(beforeOutput, allLabels), sameSyndromeSingles: sameSyndromeSingles.join(', ') || 'None' }
    };
  }
  return { compute, fromWord, conjugate, operatorText, letter, weight, canonicalPatch, syndrome, projectAncilla };
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function element(parent, tag, attrs = {}, text) {
    const node = parent.ownerDocument.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node); return node;
  }
  function text(parent, x, y, value, attrs = {}) {
    return element(parent, 'text', { x, y, fill: 'var(--text)', 'font-size': 13, 'text-anchor': 'middle', ...attrs }, value);
  }
  function line(parent, x1, y1, x2, y2, attrs = {}) {
    return element(parent, 'line', { x1, y1, x2, y2, stroke: 'var(--line)', 'stroke-width': 1.5, ...attrs });
  }
  function circuitDiagram(svg, r) {
    svg.replaceChildren();
    element(svg, 'title', {}, 'Time runs left to right. Select a checkpoint with Enter, Space or a pointer.');
    const y = q => 68 + 40 * q, gateX = g => g.stage === 'input' ? 62 : g.stage === 'output' ? 264 : 60 + 40 * g.block;
    r.circuit.labels.forEach((label, q) => {
      text(svg, 21, y(q) + 4, label);
      line(svg, 42, y(q), 323, y(q));
    });
    text(svg, 21, 47, '|0⟩', { 'font-size': 12 });
    text(svg, 62, 22, r.circuit.gates.some(g => g.stage === 'input') ? 'Input H' : 'Input', { 'font-size': 12 });
    text(svg, 264, 22, r.circuit.gates.some(g => g.stage === 'output') ? 'Output H' : 'Output', { 'font-size': 12 });
    text(svg, 160, 22, 'Time →');
    for (const gate of r.circuit.gates) {
      const x = gateX(gate), [a, b] = gate.qubits;
      const group = element(svg, 'g', { 'data-gate': gate.type, 'data-stage': gate.stage });
      element(group, 'title', {}, gate.type + ' on ' + gate.qubits.map(q => r.circuit.labels[q]).join(', '));
      if (gate.type === 'H') {
        element(group, 'rect', { x: x - 10, y: y(a) - 11, width: 20, height: 22, fill: 'var(--bg)', stroke: 'var(--plot-primary)' });
        text(group, x, y(a) + 4, 'H');
      } else {
        line(group, x, y(a), x, y(b), { stroke: 'var(--plot-primary)', 'stroke-width': 2 });
        element(group, 'circle', { cx: x, cy: y(a), r: 4, fill: 'var(--plot-primary)' });
        if (gate.type === 'CNOT') {
          element(group, 'circle', { cx: x, cy: y(b), r: 9, fill: 'var(--bg)', stroke: 'var(--plot-primary)', 'stroke-width': 2 });
          line(group, x - 6, y(b), x + 6, y(b), { stroke: 'var(--plot-primary)' });
          line(group, x, y(b) - 6, x, y(b) + 6, { stroke: 'var(--plot-primary)' });
        } else element(group, 'circle', { cx: x, cy: y(b), r: 4, fill: 'var(--plot-primary)' });
        text(svg, x, 43, gate.corner, { 'font-size': 12 });
      }
    }
    element(svg, 'rect', { x: 295, y: 57, width: 25, height: 22, fill: 'var(--bg)', stroke: 'var(--text)' });
    text(svg, 307, 72, 'Z');
    for (let j = 0; j <= 4; j++) {
      const x = 82 + 40 * j, active = j === r.params.step;
      const group = element(svg, 'g', { 'data-step': j, tabindex: 0, role: 'button', 'aria-pressed': String(active), 'aria-label': `Inspect checkpoint ${j}, before output H gates` });
      if (active) line(svg, x, 84, x, 242, { stroke: 'var(--plot-accent)', 'stroke-dasharray': '3 3' });
      element(group, 'rect', { x: x - 16, y: 250, width: 32, height: 30, rx: 4, fill: 'var(--bg)', stroke: active ? 'var(--plot-accent)' : 'var(--line)', 'stroke-width': active ? 2 : 1 });
      text(group, x, 270, j);
    }
    if (r.params.fault !== 'I') {
      const x = 82 + 40 * r.params.k;
      element(svg, 'path', { d: `M${x} 59 l7 9 l-7 9 l-7 -9 Z`, fill: 'var(--bg)', stroke: 'var(--plot-accent)', 'stroke-width': 2 });
      text(svg, x, 94, r.params.fault, { fill: 'var(--plot-accent)', 'font-weight': 'bold' });
    }
    text(svg, 170, 303, 'Checkpoint: completed entangling gates', { 'font-size': 12 });
  }
  function patchDiagram(svg, r, selected, model) {
    svg.replaceChildren();
    element(svg, 'title', {}, 'Final data error and its syndrome on the canonical patch. Select a check to inspect its support.');
    const xy = (col, row) => [78 + 88 * col, 78 + 88 * row];
    const chosen = r.patch.checks.find(c => c.id === selected);
    const logical = r.patch.logical[r.params.basis].map(q => r.patch.data[q - 1]);
    const [x1, y1] = xy(logical[0].col, logical[0].row), [x2, y2] = xy(logical[2].col, logical[2].row);
    line(svg, x1, y1, x2, y2, { stroke: 'var(--plot-reference)', 'stroke-width': 7, opacity: 0.35 });
    for (const check of r.patch.checks) {
      const [x, y] = xy(check.col, check.row), [a, b] = [check.support[0], check.support.at(-1)].map(q => r.patch.data[q - 1]);
      const [ax, ay] = xy(a.col, a.row), [bx, by] = xy(b.col, b.row);
      if (check.support.length === 4) element(svg, 'rect', { x: ax, y: ay, width: bx - ax, height: by - ay, fill: 'none', stroke: 'var(--line)', 'stroke-dasharray': check.type === 'Z' ? '4 4' : 'none' });
      else { line(svg, ax, ay, x, y); line(svg, x, y, bx, by); }
    }
    for (const q of r.patch.data) {
      const [x, y] = xy(q.col, q.row), p = model.letter(r.dataError, q.id - 1), active = chosen?.support.includes(q.id);
      element(svg, 'circle', { cx: x, cy: y, r: 13, fill: 'var(--bg)', stroke: active ? 'var(--plot-accent)' : 'var(--text)', 'stroke-width': active ? 3 : 1.5 });
      text(svg, x, y + 4, q.id);
      if (p !== 'I') {
        const attrs = { fill: 'none', 'stroke-width': 3, 'data-error': p };
        if (p === 'Y') {
          element(svg, 'path', { d: `M${x} ${y-18} A18 18 0 0 0 ${x} ${y+18}`, stroke: 'var(--plot-primary)', ...attrs });
          element(svg, 'path', { d: `M${x} ${y-18} A18 18 0 0 1 ${x} ${y+18}`, stroke: 'var(--plot-secondary)', 'stroke-dasharray': '4 3', ...attrs });
        } else element(svg, 'circle', { cx: x, cy: y, r: 18, stroke: p === 'X' ? 'var(--plot-primary)' : 'var(--plot-secondary)', 'stroke-dasharray': p === 'Z' ? '4 3' : 'none', ...attrs });
        text(svg, x + 22, y - 13, p, { 'font-weight': 'bold' });
      }
    }
    r.patch.checks.forEach((check, i) => {
      const [x, y] = xy(check.col, check.row), active = check.id === selected, flag = r.bits[i];
      const g = element(svg, 'g', { 'data-check': check.id, tabindex: 0, role: 'button', 'aria-pressed': String(active), 'aria-label': `${check.id}, ${check.type} on ${check.support.join(', ')}, syndrome ${flag}. Inspect support.` });
      element(g, 'rect', { x: x - 15, y: y - 15, width: 30, height: 30, rx: 3, fill: 'var(--bg)', 'fill-opacity': 0, stroke: active ? 'var(--plot-accent)' : 'none' });
      element(g, 'rect', { x: x - 5, y: y - 5, width: 10, height: 10, fill: check.type === 'X' ? 'var(--plot-primary)' : 'var(--bg)', stroke: check.type === 'X' ? 'var(--plot-primary)' : 'var(--plot-secondary)', 'stroke-width': 2 });
      if (flag) element(g, 'circle', { cx: x, cy: y, r: 11, fill: 'none', stroke: 'var(--plot-accent)', 'stroke-width': 2 });
      text(g, x, y + 27, check.id, { 'font-size': 12 });
    });
    text(svg, 170, 15, 'Column →     Row ↓');
    text(svg, 170, 345, '○ data    ■ X check    □ Z check', { 'font-size': 12 });
    text(svg, 170, 365, 'X solid · Z dashed · Y split · ring: syndrome 1', { 'font-size': 12 });
    text(svg, 170, 385, `Faint line: logical ${r.params.basis} on ${r.patch.logical[r.params.basis].join(', ')}`, { 'font-size': 12 });
    return chosen;
  }
  StudyLab.register('check-circuit', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const host = doc.createElement('div'); host.style.minWidth = '0'; host.style.gridColumn = '1 / -1'; layout.plots.appendChild(host);
    function panel(title, height, label) {
      const heading = doc.createElement('h4'); heading.textContent = title; host.appendChild(heading);
      const svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 340 ${height}`); svg.setAttribute('width', '100%'); svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', label);
      svg.style.maxWidth = '440px'; svg.style.display = 'block'; svg.style.margin = '0 auto'; host.appendChild(svg); return svg;
    }
    const circuit = panel('Measured operator and Pauli history', 315, 'Extraction circuit with selectable checkpoints');
    const history = doc.createElement('details'), summary = doc.createElement('summary'), rows = doc.createElement('ol');
    summary.textContent = 'Trace every gate, including the Hadamards'; history.appendChild(summary); history.appendChild(rows); host.appendChild(history);
    const patch = panel('Final data error on the canonical patch', 400, 'Canonical patch with selectable checks');
    const weights = ctx.plot(layout.plots, {
      title: 'Data-error weight versus fault time',
      x: { label: 'Completed entangling gates at fault insertion', domain: [0, 4] },
      y: { label: 'Final data-error weight (data qubits)', domain: [0, 4] }, legend: true
    });
    let selected = null;
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
      if (!r.valid) { circuit.replaceChildren(); patch.replaceChildren(); rows.replaceChildren(); weights.update([]); ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return; }
      circuitDiagram(circuit, r);
      const chosen = patchDiagram(patch, r, selected, ctx.model), v = r.readouts;
      const sweep = Array.from({ length: 5 }, (_, k) => ctx.model.compute({ ...r.params, k }).readouts);
      const markers = [
        { type: 'vline', x: r.params.k, label: 'Selected k', role: 'accent' },
        { type: 'point', x: r.params.k, y: v.rawWeight, role: 'primary' }
      ];
      if (v.modCheckWeight !== null && v.modCheckWeight !== v.rawWeight) markers.push({ type: 'point', x: r.params.k, y: v.modCheckWeight, role: 'secondary' });
      weights.update([
        { id: 'raw-weight', label: 'Raw weight', role: 'primary', kind: 'line', points: sweep.map((value, k) => [k, value.rawWeight]) },
        { id: 'mod-check-weight', label: v.modCheckWeight === null ? 'Modulo measured check: not applicable' : 'Modulo measured check', role: 'secondary', kind: 'line', dash: '6 4', points: sweep.map((value, k) => [k, value.modCheckWeight === null ? NaN : value.modCheckWeight]) }
      ], markers);
      rows.replaceChildren();
      for (const frame of r.trace) {
        const li = doc.createElement('li'), title = doc.createElement('strong');
        const gate = frame.gate;
        title.textContent = gate ? `After ${gate.type} on ${gate.qubits.map(q => r.circuit.labels[q]).join(', ')} (${gate.stage})` : 'Before input gates';
        if (frame.checkpoint >= 0) title.textContent += `; checkpoint ${frame.checkpoint}`;
        if (frame.injected && r.params.fault !== 'I') title.textContent += `; insert ${r.params.fault} on A here`;
        li.appendChild(title);
        for (const label of [`← Measured observable: ${frame.backwardText}`, `→ Fault: ${frame.forwardText}${frame.afterGate < r.circuit.checkpoints[r.params.k] ? ' (not yet inserted)' : ''}`]) {
          const p = doc.createElement('p'); p.textContent = label; p.style.overflowWrap = 'anywhere'; li.appendChild(p);
        }
        rows.appendChild(li);
      }
      ctx.readouts(layout.readouts, [
        { label: 'Measured operator', value: v.measured }, { label: 'Intended operator', value: v.intended },
        { label: 'Matches intended check', value: v.match }, { label: 'Final data error', value: v.dataError },
        { label: 'Raw / modulo-check weight', value: `${v.rawWeight} / ${v.modCheckWeight === null ? 'Not applicable' : v.modCheckWeight}` },
        { label: 'Pair orientation', value: v.orientation }, { label: 'Final data syndrome', value: v.syndrome },
        { label: 'Ancilla readout flip', value: v.readoutFlip }, { label: 'Data error before output H', value: v.beforeOutput },
        { label: `Backward observable at checkpoint ${r.params.step}`, value: r.current.backwardText },
        { label: `Forward fault at checkpoint ${r.params.step}`, value: r.current.forwardText },
        { label: 'Single data errors with the same syndrome', value: v.sameSyndromeSingles }
      ]);
      ctx.notes(layout.notes,
        `<p>Interaction order: ${r.circuit.cornerOrder.join(', ')}; data ${r.circuit.dataOrder.join(', ')}. The diamond marks the inserted physical ancilla fault. Checkpoint 4 is before the output Hadamards; final readouts include them.</p>` +
        (r.params.gate === 'CZ' && r.params.data_h && r.params.fault !== 'I' ? `<p>Before the output data Hadamards the data error is ${v.beforeOutput}. After them it is ${v.dataError}.</p>` : '') +
        (!r.match ? '<p>This circuit measures a different operator from the intended check. The same-type hook comparison and modulo-check reduction do not apply.</p>' : '') +
        `<p>${chosen ? `${chosen.id}: ${chosen.type} on ${chosen.support.join(', ')}. Syndrome bit ${r.bits[r.patch.checks.indexOf(chosen)]}.` : 'Select a patch check with a pointer or Tab then Enter or Space to inspect its support.'}</p>` +
        '<p>The syndrome describes the final data error. Matching this snapshot does not establish matching detector records over time. Pair orientation alone does not certify a full extraction schedule.</p>');
    }
    function inspect(event) {
      const onCircuit = circuit.contains(event.target), svg = onCircuit ? circuit : patch, attr = onCircuit ? 'data-step' : 'data-check';
      const target = event.target.closest(`[${attr}]`);
      if (!target || !svg.contains(target) || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
      event.preventDefault(); const value = target.getAttribute(attr);
      if (onCircuit) ctx.state.set('step', Number(value)); else { selected = value; draw(); }
      svg.querySelector(`[${attr}="${value}"]`)?.focus();
    }
    for (const svg of [circuit, patch]) { svg.addEventListener('click', inspect); svg.addEventListener('keydown', inspect); }
    const unsubscribe = ctx.state.onChange(() => { selected = null; draw(); }); draw();
    return { destroy() { unsubscribe(); for (const svg of [circuit, patch]) { svg.removeEventListener('click', inspect); svg.removeEventListener('keydown', inspect); } weights.destroy?.(); host.remove(); } };
  });
})();

}).call(window);
