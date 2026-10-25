/* gauging-stepper: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['gauging-stepper'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const outcomes = ['0000', '1100', '1010', '1001', '0110', '0101', '0011', '1111'];
  const bit = i => 1n << BigInt(i);
  const mask = support => support.reduce((a, i) => a ^ bit(i), 0n);
  function parity(a) { let p = 0; for (; a; a &= a - 1n) p ^= 1; return p; }
  function weight(a) { let w = 0; for (; a; a &= a - 1n) w++; return w; }
  const invalid = message => ({valid: false, message, warnings: [message]});
  function integer(value, lo, hi, name) {
    if (!Number.isInteger(value) || value < lo || value > hi) throw new RangeError(`${name} must be an integer from ${lo} to ${hi}.`);
  }
  function record(outcome) {
    if (typeof outcome !== 'string' || !outcomes.includes(outcome)) throw new RangeError('Outcome must be a four-bit even-parity string in vertex order.');
    return Array.from(outcome, Number);
  }
  // All exported geometry is ordinary JSON data. Masks stay local and use BigInt.
  function geometry() {
    const vertices = Array.from({length: 4}, (_, i) => ({index: i, x: i % 2, y: Math.floor(i / 2)}));
    const vertex = (x, y) => ((y + 2) % 2) * 2 + (x + 2) % 2;
    const h = (x, y) => vertex(x, y), v = (x, y) => 4 + vertex(x, y);
    const edges = [];
    for (const axis of ['h', 'v']) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      edges.push({index: edges.length, id: `${axis}(${x},${y})`, axis, x, y,
        endpoints: [vertex(x, y), vertex(x + Number(axis === 'h'), y + Number(axis === 'v'))]});
    }
    const D = edges.map(e => vertices.map(v => Number(e.endpoints.includes(v.index))));
    const stars = vertices.map(v => edges.filter(e => e.endpoints.includes(v.index)).map(e => e.index));
    const faces = vertices.map(({x, y}) => [h(x, y), v(x + 1, y), h(x, y + 1), v(x, y)].sort((a, b) => a - b));
    return {L: 2, vertices, edges, D, stars, faces, logicalZ: [[h(0, 0), h(1, 0)], [v(0, 0), v(0, 1)]]};
  }
  function pack(amplitudes) {
    const clean = {}; let normSquared = 0;
    for (const [basis, amplitude] of Object.entries(amplitudes)) if (amplitude !== 0) {
      integer(Number(basis), 0, 4095, 'Basis index');
      if (!Number.isSafeInteger(amplitude)) throw new RangeError('State amplitudes must be safe integers.');
      clean[basis] = amplitude; normSquared += amplitude * amplitude;
    }
    if (!Number.isSafeInteger(normSquared) || normSquared === 0) throw new RangeError('State must have a positive finite norm squared.');
    return {amplitudes: clean, normSquared};
  }
  function checkedState(state) {
    if (!state || !state.amplitudes || typeof state.amplitudes !== 'object' || Array.isArray(state.amplitudes)) throw new RangeError('State needs a sparse amplitude map.');
    const copy = pack(state.amplitudes);
    if (state.normSquared !== copy.normSquared) throw new RangeError('State norm squared does not match its amplitudes.');
    return copy;
  }
  function initialState() { return pack(Object.fromEntries(Array.from({length: 16}, (_, i) => [i, 1]))); }
  function copyParity(state, edgeIndex) {
    integer(edgeIndex, 0, 7, 'Edge index');
    let next = checkedState(state);
    const edge = geometry().edges[edgeIndex], target = bit(4 + edgeIndex);
    // Each endpoint is a separate CNOT permutation, including parallel links.
    for (const endpoint of edge.endpoints) {
      const amplitudes = {};
      for (const [key, value] of Object.entries(next.amplitudes)) {
        const basis = BigInt(key), destination = basis & bit(endpoint) ? basis ^ target : basis;
        amplitudes[Number(destination)] = value;
      }
      next = pack(amplitudes);
    }
    return next;
  }
  function projectMatterX(state, vertex, outcomeBit) {
    try {
      integer(vertex, 0, 3, 'Matter vertex'); integer(outcomeBit, 0, 1, 'Outcome bit');
      const old = checkedState(state), amplitudes = {}, sign = outcomeBit ? -1 : 1;
      for (const [key, value] of Object.entries(old.amplitudes)) {
        const partner = Number(BigInt(key) ^ bit(vertex));
        amplitudes[key] = (amplitudes[key] || 0) + value;
        amplitudes[partner] = (amplitudes[partner] || 0) + sign * value;
      }
      if (Object.values(amplitudes).every(a => a === 0)) return {...invalid('This matter outcome has zero probability.'), probability: 0, normSquared: 0};
      const next = pack(amplitudes), probability = next.normSquared / (4 * old.normSquared);
      return {valid: true, state: next, normSquared: next.normSquared, probability};
    } catch (error) { return invalid(error.message); }
  }
  function pauliMask(value) {
    if (typeof value === 'number') integer(value, 0, 4095, 'Pauli mask');
    else if (typeof value !== 'bigint') throw new RangeError('Pauli mask must be an integer.');
    const m = BigInt(value);
    if (m < 0n || m >= bit(12)) throw new RangeError('Pauli mask must fit the twelve-qubit register.');
    return m;
  }
  function expectPauli(state, xMask, zMask) {
    const s = checkedState(state), x = pauliMask(xMask), z = pauliMask(zMask);
    if (x & z) throw new RangeError('Overlapping X and Z masks require unsupported Pauli phases.');
    let sum = 0;
    for (const [key, a] of Object.entries(s.amplitudes)) {
      const basis = BigInt(key), b = s.amplitudes[Number(basis ^ x)] || 0;
      sum += a * b * (parity(basis & z) ? -1 : 1);
    }
    return sum / s.normSquared;
  }
  function canonicalCorrection(outcome) {
    const bits = record(outcome), g = geometry(); let best = null;
    for (let c = 0; c < 256; c++) {
      const boundary = g.stars.map(row => parity(mask(row) & BigInt(c)));
      if (!boundary.every((b, i) => b === bits[i])) continue;
      const w = weight(BigInt(c));
      if (!best || w < best.weight) best = {mask: c, weight: w, edges: g.edges.filter(e => BigInt(c) & bit(e.index)).map(e => e.index), boundary};
    }
    // Ascending enumeration resolves equal-weight candidates by unsigned mask.
    return best;
  }
  function applyLinkZ(state, linkMask) {
    integer(linkMask, 0, 255, 'Link correction mask');
    const s = checkedState(state), z = BigInt(linkMask) << 4n;
    return pack(Object.fromEntries(Object.entries(s.amplitudes).map(([key, a]) => [key, parity(BigInt(key) & z) ? -a : a])));
  }
  const coupledCount = stage => stage < 2 ? 0 : stage < 10 ? stage - 1 : 8;
  function progressLine() { return Array.from({length: 15}, (_, stage) => [stage, coupledCount(stage)]); }
  function stateAt(stage, outcome) {
    try {
      integer(stage, 0, 14, 'Stage'); const bits = record(outcome), g = geometry();
      const activeEdges = g.edges.slice(0, coupledCount(stage)).map(e => e.index);
      const measuredVertices = g.vertices.slice(0, stage < 10 ? 0 : Math.min(4, stage - 9)).map(v => v.index);
      let state = initialState(), cumulativeProbability = 1; const conditionalProbabilities = [];
      for (const e of activeEdges) state = copyParity(state, e);
      for (const v of measuredVertices) {
        const projected = projectMatterX(state, v, bits[v]);
        if (!projected.valid) return projected;
        state = projected.state; conditionalProbabilities.push(projected.probability);
        cumulativeProbability *= projected.probability;
      }
      const correction = canonicalCorrection(outcome);
      if (stage === 14) state = applyLinkZ(state, correction.mask);
      const linkMask = row => mask(row.map(e => e + 4));
      const A = g.stars.map(row => expectPauli(state, linkMask(row), 0n));
      const B = g.faces.map(row => expectPauli(state, 0n, linkMask(row)));
      // Retain internal G solely to check the discarded joint register correctly.
      const G = g.stars.map((row, v) => expectPauli(state, linkMask(row) | bit(v), 0n));
      const C = g.edges.map(e => expectPauli(state, 0n, mask([...e.endpoints, e.index + 4])));
      const logical = g.logicalZ.map(row => expectPauli(state, 0n, linkMask(row)));
      return {valid: true, stage, outcome, state, norm: Math.sqrt(state.normSquared), normSquared: state.normSquared,
        activeEdges, measuredVertices, cumulativeProbability, conditionalProbabilities,
        A, B, G, C, logical, correction,
        available: {links: stage > 0, matter: stage < 14, gauss: stage > 0 && stage < 14,
          logical: stage >= 9, edgeState: stage === 14}};
    } catch (error) { return invalid(error.message); }
  }
  function edgeState(state) {
    // Matter component 0000 has nonzero amplitude in every allowed branch.
    const terms = Object.entries(state.amplitudes).filter(([key]) => (BigInt(key) & 15n) === 0n)
      .map(([key, amplitude]) => ({mask: Number(BigInt(key) >> 4n), amplitude}));
    const normSquared = terms.reduce((s, t) => s + t.amplitude ** 2, 0);
    if (!normSquared) throw new RangeError('The chosen matter component has zero norm.');
    const support = terms.map(t => ({bits: Array.from({length: 8}, (_, e) => Number((BigInt(t.mask) & bit(e)) !== 0n)).join(''),
      mask: t.mask, amplitude: t.amplitude / Math.sqrt(normSquared)})).sort((a, b) => a.bits.localeCompare(b.bits));
    return {support, termCount: support.length, normSquared: support.reduce((s, t) => s + t.amplitude ** 2, 0), matterComponent: '0000'};
  }
  const signLabel = value => Math.abs(value) === 1 ? (value > 0 ? '+1' : '−1') : 'uncertain';
  const expectationLabel = values => values.map(signLabel).join(',');
  function compute(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return invalid('Parameters must be an object containing stage and outcome.');
    if (Object.keys(params).some(k => !['stage', 'outcome'].includes(k))) return invalid('Only stage and outcome are parameters.');
    const p = {stage: Object.hasOwn(params, 'stage') ? params.stage : 0, outcome: Object.hasOwn(params, 'outcome') ? params.outcome : '0000'};
    const r = stateAt(p.stage, p.outcome);
    if (!r.valid) return r;
    const g = geometry(), finalState = p.stage === 14 ? edgeState(r.state) : null;
    const absent = 'not yet present', links = r.available.links;
    const correctionSupport = r.correction.edges.map(e => g.edges[e].id).join(', ') || 'none';
    const readouts = {
      'coupled-count': links ? r.activeEdges.length : absent,
      'measured-count': r.measuredVertices.length,
      'branch-probability': r.cumulativeProbability,
      'star-expectations': links ? expectationLabel(r.A) : absent,
      'flux-expectations': links ? expectationLabel(r.B) : absent,
      'gauss-expectations': !links ? absent : r.available.gauss ? expectationLabel(r.G) : 'matter discarded',
      'correction-support': !links ? absent : p.stage < 13 ? 'awaiting matter record' : correctionSupport,
      'logical-z-signs': !links ? absent : r.available.logical ? expectationLabel(r.logical) : 'not yet established',
      'state-support-count': !links ? absent : finalState ? finalState.termCount : Object.keys(r.state.amplitudes).length
    };
    return {...r, params: p, geometry: g, warnings: [],
      summary: {jointTerms: Object.keys(r.state.amplitudes).length, normSquared: r.normSquared, edgeTerms: finalState?.termCount ?? null},
      checks: {A: links ? r.A : null, B: links ? r.B : null, G: r.available.gauss ? r.G : null, C: links && r.available.matter ? r.C : null},
      branchProbability: r.cumulativeProbability, logicalSigns: r.available.logical ? r.logical : null,
      edgeState: finalState, progress: progressLine(), readouts};
  }
  return {geometry, initialState, copyParity, projectMatterX, expectPauli, canonicalCorrection, applyLinkZ, stateAt, compute, progressLine};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const sign = x => Math.abs(x) === 1 ? (x > 0 ? '+1' : '−1') : 'uncertain';
  function board(svg, r) {
    const doc = svg.ownerDocument, g = r.geometry, cell = 126, ox = 64, oy = 72;
    const xy = (x, y) => [ox + cell * x, oy + cell * y];
    function el(tag, attrs, text, parent = svg) {
      const n = doc.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
      if (text !== undefined) n.textContent = text;
      parent.appendChild(n); return n;
    }
    const text = (x, y, content, attrs = {}, parent = svg) => el('text', {
      x, y, fill: 'var(--text)', 'font-size': 13, 'text-anchor': 'middle', ...attrs
    }, content, parent);
    svg.replaceChildren();
    el('title', {}, 'L = 2 torus. Four matter sites and eight distinct periodic links.');
    el('desc', {}, r.available.links ? 'Matching seam arrows identify opposite sides. Faint copies repeat the same qubits. Neutral ribbons mark transferred parities.' : 'Only the four matter qubits are shown. Link qubits are not yet present.');
    if (r.available.links) {
      for (const edge of g.edges) {
        const copies = [[0, 0, false]];
        if (edge.axis === 'h' && edge.y === 0) copies.push([0, 2, true]);
        if (edge.axis === 'v' && edge.x === 0) copies.push([2, 0, true]);
        for (const [dx, dy, copy] of copies) {
          const active = r.activeEdges.includes(edge.index), corrected = r.stage === 14 && r.correction.edges.includes(edge.index);
          const group = el('g', {'data-edge': edge.index, ...(copy ? {'data-copy': 'true', opacity: 0.35, 'aria-hidden': 'true'} : {} )});
          const [x1, y1] = xy(edge.x + dx, edge.y + dy);
          const [x2, y2] = xy(edge.x + dx + Number(edge.axis === 'h'), edge.y + dy + Number(edge.axis === 'v'));
          const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
          el('line', {x1, y1, x2, y2, stroke: 'var(--line)', 'stroke-width': active ? 9 : 2,
            ...(active ? {'data-parity-ribbon': edge.index} : {})}, undefined, group);
          if (corrected) el('line', {x1, y1, x2, y2, stroke: 'var(--plot-primary)', 'stroke-width': 5, 'stroke-dasharray': '7 4'}, undefined, group);
          el('circle', {cx, cy, r: 5, fill: 'var(--bg)', stroke: 'var(--text)', 'stroke-width': 1.5}, undefined, group);
          if (!copy) {
            const vertical = edge.axis === 'v';
            const attrs = vertical ? {transform: `rotate(-90 ${cx} ${cy})`} : {};
            text(cx, cy - 11, `${edge.id}${corrected ? ' Z' : ''}`, attrs, group);
            text(cx, cy + 19, active ? `x${edge.endpoints[0]}⊕x${edge.endpoints[1]}` : '|0⟩',
              {...attrs, 'data-parity-label': edge.index, 'font-size': 12}, group);
          }
        }
      }
      for (const vertex of g.vertices) {
        const [x, y] = xy(vertex.x + 0.5, vertex.y + 0.5);
        el('rect', {x: x - 4, y: y - 4, width: 8, height: 8, fill: 'var(--bg)', stroke: 'var(--plot-primary)', 'stroke-width': 2});
        text(x, y + 22, `B${vertex.index}`);
      }
      text(190, 24, '⇕ opposite sides identified ⇕');
      text(190, 365, '⇕'); text(24, 203, '⇔'); text(354, 203, '⇔');
    }
    for (const vertex of g.vertices) {
      const [x, y] = xy(vertex.x, vertex.y), measured = r.measuredVertices.includes(vertex.index);
      const group = el('g', {'data-vertex': vertex.index, 'data-matter': String(r.available.matter)});
      if (r.available.matter) {
        if (measured) {
          el('rect', {x: x - 14, y: y - 12, width: 28, height: 24, rx: 3, fill: 'var(--bg)', stroke: 'var(--text)', 'data-outcome-card': vertex.index}, undefined, group);
          text(x, y + 4, r.outcome[vertex.index], {}, group);
        } else {
          el('circle', {cx: x, cy: y, r: 11, fill: 'var(--bg)', stroke: 'var(--plot-secondary)', 'stroke-width': 2, 'data-matter-ring': vertex.index}, undefined, group);
          text(x, y + 4, `x${vertex.index}`, {'font-size': 12}, group);
        }
      } else el('rect', {x: x - 5, y: y - 5, width: 10, height: 10, fill: 'var(--plot-secondary)', 'data-star-marker': vertex.index}, undefined, group);
      text(x, y - 26, r.available.matter ? `matter ${vertex.index}` : `A${vertex.index} +1`, {}, group);
      if (r.available.links && vertex.x === 0) {
        el('rect', {x: ox + 2 * cell - 3, y: y - 3, width: 6, height: 6, fill: 'var(--muted)', 'data-copy': 'true', opacity: 0.35});
      }
      if (r.available.links && vertex.y === 0) {
        el('rect', {x: x - 3, y: oy + 2 * cell - 3, width: 6, height: 6, fill: 'var(--muted)', 'data-copy': 'true', opacity: 0.35});
      }
    }
    text(190, 395, r.available.links ? '○ link   ■ X star   □ Z face' : 'Links: not yet present');
  }
  StudyLab.register('gauging-stepper', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const chart = ctx.plot(layout.plots, {
      title: 'Construction progress', x: {label: 'Construction stage', domain: [0, 14]},
      y: {label: 'Number of coupled bonds', domain: [0, 8]}, legend: true
    });
    function html(tag, parent, text) {
      const node = doc.createElement(tag); if (text !== undefined) node.textContent = text;
      parent.appendChild(node); return node;
    }
    const panels = html('div', layout.plots);
    panels.style.display = 'flex'; panels.style.flexWrap = 'wrap'; panels.style.gap = '1rem';
    const holder = html('div', panels);
    holder.style.flex = '1 1 400px'; holder.style.minWidth = '0'; holder.style.overflowX = 'auto';
    holder.setAttribute('tabindex', '0'); holder.setAttribute('aria-label', 'Periodic torus; scroll horizontally on narrow screens');
    const svg = doc.createElementNS(NS, 'svg'); holder.appendChild(svg);
    svg.setAttribute('viewBox', '0 0 400 415'); svg.setAttribute('width', '100%');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Matter and link qubits on the L = 2 torus');
    svg.style.minWidth = '400px'; svg.style.maxWidth = '500px';
    const ledger = html('div', panels); ledger.style.flex = '1 1 260px'; ledger.style.minWidth = '0';
    const labels = {
      'coupled-count': 'Coupled bonds', 'measured-count': 'Measured matter vertices',
      'branch-probability': 'Branch probability', 'star-expectations': 'Star signs',
      'flux-expectations': 'Flux signs', 'gauss-expectations': 'Gauss signs',
      'correction-support': 'Correction support', 'logical-z-signs': 'Logical Z signs',
      'state-support-count': 'State support count'
    };
    function draw() {
      let r;
      try { r = ctx.model.compute(ctx.state.all()); }
      catch (error) { r = {valid: false, message: error.message}; }
      ctx.warn(layout.notes, r.valid ? null : r.message || 'The selected construction cannot be evaluated.');
      const points = r.valid ? r.progress : ctx.model.progressLine();
      chart.update([{id: 'coupled-bonds', label: 'Number of coupled bonds', role: 'primary', kind: 'line', points}],
        r.valid ? [{type: 'point', x: r.stage, y: r.activeEdges.length, label: 'Selected stage', role: 'accent'}] : []);
      ledger.replaceChildren();
      if (!r.valid) {
        svg.replaceChildren();
        const message = doc.createElementNS(NS, 'text');
        message.setAttribute('x', '20'); message.setAttribute('y', '60'); message.setAttribute('fill', 'var(--text)');
        message.textContent = 'Select a valid stage and outcome.'; svg.appendChild(message);
        html('p', ledger, r.message || 'The selected construction cannot be evaluated.');
        ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return;
      }
      board(svg, r);
      const operation = r.stage === 0 ? 'Matter only' : r.stage === 1 ? 'Reveal eight blank link qubits' :
        r.stage <= 9 ? `Copy bond parity onto ${r.geometry.edges[r.stage - 2].id}` :
        r.stage <= 13 ? `Measure matter vertex ${r.stage - 10} in X` : 'Apply canonical Z correction and discard matter';
      html('p', ledger, `Stage ${r.stage}: ${operation}`);
      if (r.available.links) {
        const table = html('table', ledger); table.style.width = '100%';
        html('caption', table, 'Signs in vertex and face order');
        const head = html('tr', html('thead', table));
        for (const label of ['Index', 'Star A', 'Flux B', ...(r.available.gauss ? ['Gauss G'] : [])]) html('th', head, label).setAttribute('scope', 'col');
        const body = html('tbody', table);
        r.geometry.vertices.forEach(v => {
          const row = html('tr', body); html('th', row, String(v.index)).setAttribute('scope', 'row');
          for (const values of [r.A, r.B, ...(r.available.gauss ? [r.G] : [])]) html('td', row, sign(values[v.index]));
        });
        for (const [name, values] of [['A', r.A], ['B', r.B], ...(r.available.gauss ? [['G', r.G]] : [])]) {
          html('p', ledger, `Expectations ⟨${name}⟩: ${values.join(',')}`).setAttribute('data-expectation-row', name);
        }
      } else html('p', ledger, 'Link checks: not yet present');
      if (r.edgeState) {
        html('p', ledger, 'Link superposition; common amplitude 1/√8. Edge 0 is leftmost.');
        const list = html('ul', ledger); list.style.columns = '2';
        for (const term of r.edgeState.support) html('code', html('li', list), term.bits);
      }
      const items = Object.entries(labels).filter(([id]) => id !== 'gauss-expectations' || r.stage < 14)
        .map(([id, label]) => ({id, label, value: r.readouts[id],
          ...(id === 'state-support-count' && r.stage > 0 ? {units: r.stage === 14 ? 'link terms' : 'joint terms'} : {})}));
      ctx.readouts(layout.readouts, items);
      ctx.notes(layout.notes, r.stage === 14 ? 'The full superposition has positive stars and fluxes. A single basis string does not carry the star eigenvalues.' :
        r.stage >= 10 ? 'The branch probability includes only the matter outcomes read so far. The fourth outcome is fixed by even parity.' :
        'Neutral ribbons label coherently copied parities. Zero expectation means uncertain, not an eigenvalue of zero.');
    }
    const unsubscribe = ctx.state.onChange(draw);
    draw();
    return {destroy() { unsubscribe(); chart.destroy?.(); panels.remove(); }};
  });
})();

}).call(window);
