/* string-deformer: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['string-deformer'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const starts = ['z1', 'z2', 'x1', 'x2', 'z1z2', 'identity'];
  function normalizeParams(raw = {}) {
    raw = raw || {};
    const value = typeof raw.L === 'number' || typeof raw.L === 'string' && raw.L.trim() !== '' ? Number(raw.L) : NaN;
    return {
      L: Number.isFinite(value) ? Math.max(3, Math.min(6, Math.round(value))) : 4,
      start: starts.includes(raw.start) ? raw.start : 'z1',
      tool: ['z-face', 'x-star'].includes(raw.tool) ? raw.tool : 'z-face'
    };
  }
  function lattice(L) {
    if (!Number.isInteger(L) || L < 3 || L > 6) throw new RangeError('L must be an integer from 3 to 6.');
    const wrap = n => (n + L) % L;
    const edge = (axis, x, y) => `${axis}(${wrap(x)},${wrap(y)})`;
    const edges = [], stars = [], faces = [];
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      for (const axis of ['h', 'v']) edges.push({
        id: edge(axis, x, y), axis, x, y,
        ends: [[x, y], [x + Number(axis === 'h'), y + Number(axis === 'v')]]
      });
      stars.push({id: `A:${x},${y}`, type: 'X', x, y, support: [
        edge('h', x, y), edge('h', x - 1, y), edge('v', x, y), edge('v', x, y - 1)
      ]});
      faces.push({id: `B:${x},${y}`, type: 'Z', x, y, support: [
        edge('h', x, y), edge('v', x + 1, y), edge('h', x, y + 1), edge('v', x, y)
      ]});
    }
    return {L, n: edges.length, edges, stars, faces, checks: [...stars, ...faces]};
  }
  function startOperator(L, start = 'z1') {
    lattice(L);
    if (!starts.includes(start)) throw new RangeError('Choose a listed starting operator.');
    const x = [], z = [];
    for (let i = 0; i < L; i++) {
      if (start === 'z1' || start === 'z1z2') z.push(`h(${i},0)`);
      if (start === 'z2' || start === 'z1z2') z.push(`v(0,${i})`);
      if (start === 'x1') x.push(`h(0,${i})`);
      if (start === 'x2') x.push(`v(${i},0)`);
    }
    return {x: x.sort(), z: z.sort()};
  }
  // Arrays are the JSON representation of binary edge sets. Global phase is omitted.
  function applyCheck(op, check) {
    if (!check || !['X', 'Z'].includes(check.type) || !Array.isArray(check.support)) throw new TypeError('A check needs its Pauli type and support.');
    const x = new Set(op.x), z = new Set(op.z), target = check.type === 'X' ? x : z;
    for (const edge of check.support) target.has(edge) ? target.delete(edge) : target.add(edge);
    return {x: [...x].sort(), z: [...z].sort()};
  }
  function operatorSummary(L, op) {
    const code = lattice(L), x = new Set(op.x), z = new Set(op.z);
    const allowed = new Set(code.edges.map(e => e.id));
    for (const edge of [...x, ...z]) if (!allowed.has(edge)) throw new RangeError(`Unknown edge ${edge}.`);
    const parity = (support, set) => support.reduce((sum, edge) => sum ^ Number(set.has(edge)), 0);
    const z1 = startOperator(L, 'z1').z, z2 = startOperator(L, 'z2').z;
    const x1 = startOperator(L, 'x1').x, x2 = startOperator(L, 'x2').x;
    const winding = [parity(x1, z), parity(x2, z)];
    // Partner order Z1,Z2, not horizontal/vertical geometric order on the dual lattice.
    const dual = [parity(z1, x), parity(z2, x)];
    const signs = {z1: 1 - 2 * dual[0], z2: 1 - 2 * dual[1], x1: 1 - 2 * winding[0], x2: 1 - 2 * winding[1]};
    const syndrome = code.checks.map(check => ({id: check.id, bit: parity(check.support, check.type === 'X' ? z : x)}));
    const zeroSyndrome = syndrome.every(check => check.bit === 0);
    const action = [];
    for (let j = 0; j < 2; j++) if (signs[`x${j + 1}`] < 0) action.push(`Z${j + 1}`);
    for (let j = 0; j < 2; j++) if (signs[`z${j + 1}`] < 0) action.push(`X${j + 1}`);
    const y = [...x].filter(edge => z.has(edge)).length;
    return {
      weight: x.size + z.size - y, counts: {x: x.size - y, z: z.size - y, y},
      winding, dual, signs, syndrome, zeroSyndrome,
      logicalAction: zeroSyndrome ? `acts as ${action.join(' ') || 'the identity'}` : 'not a closed logical operator'
    };
  }
  function activeChecks(code, applied) {
    const allowed = new Set(code.checks.map(check => check.id)), active = new Set();
    for (const id of Array.isArray(applied) ? applied : []) {
      if (!allowed.has(id)) continue;
      active.has(id) ? active.delete(id) : active.add(id);
    }
    return [...active];
  }
  function replay(L, start, applied) {
    const code = lattice(L), active = activeChecks(code, applied);
    const checks = new Map(code.checks.map(check => [check.id, check]));
    let operator = startOperator(L, start);
    const weight = op => new Set([...op.x, ...op.z]).size;
    const points = [[0, weight(operator)]];
    active.forEach((id, index) => {
      operator = applyCheck(operator, checks.get(id));
      points.push([index + 1, weight(operator)]);
    });
    if (points.length === 1) points.push([1, points[0][1]]);
    return {code, applied: active, operator, points};
  }
  function weightSeries(L, start, applied = []) { return replay(L, start, applied).points; }
  function evaluate(params = {}, applied) {
    const p = normalizeParams(params), r = replay(p.L, p.start, applied === undefined ? params?.applied : applied);
    return {...r, params: p, summary: operatorSummary(p.L, r.operator)};
  }
  return {normalizeParams, lattice, startOperator, applyCheck, operatorSummary, weightSeries, evaluate};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function drawLattice(svg, result, model) {
    const {code, operator, applied} = result, step = 400 / code.L;
    const xSet = new Set(operator.x), zSet = new Set(operator.z), placed = new Set(applied);
    const xy = (x, y) => [90 + step * x, 80 + step * y];
    function node(tag, attrs, content, parent = svg) {
      const el = svg.ownerDocument.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
      if (content !== undefined) el.textContent = content;
      parent.appendChild(el);
      return el;
    }
    function segment(a, b, attrs = {}, parent = svg) {
      const [x1, y1] = xy(...a), [x2, y2] = xy(...b);
      return node('line', {x1, y1, x2, y2, stroke: 'var(--line)', 'stroke-width': 1.5, ...attrs}, undefined, parent);
    }
    function label(x, y, text, attrs = {}, parent = svg) {
      return node('text', {x, y, fill: 'var(--text)', 'font-size': 13, 'text-anchor': 'middle', ...attrs}, text, parent);
    }
    svg.replaceChildren();
    node('title', {}, 'Toric code. Tab to a check, then press Enter or Space to toggle it with the matching tool.');
    node('style', {}, `#${svg.id} [data-check]{cursor:pointer}#${svg.id} [data-check]:focus{outline:none}#${svg.id} [data-check]:focus .check-focus{stroke:var(--text);stroke-dasharray:3 2}`);
    for (const edge of code.edges) segment(...edge.ends);
    for (let i = 0; i < code.L; i++) {
      segment([code.L, i], [code.L, i + 1], {opacity: 0.35});
      segment([i, code.L], [i + 1, code.L], {opacity: 0.35});
    }
    // Offset reference supports keep faint guides distinct from occupied qubits.
    for (const id of ['z1', 'z2', 'x1', 'x2']) {
      const isX = id[0] === 'x', guide = model.startOperator(code.L, id);
      const group = node('g', {'data-guide': id, opacity: 0.3, 'aria-hidden': 'true'});
      for (const edge of code.edges.filter(edge => guide[isX ? 'x' : 'z'].includes(edge.id))) {
        const offset = (isX ? -7 : 7) / step;
        const ends = edge.ends.map(([x, y]) => edge.axis === 'h' ? [x, y + offset] : [x + offset, y]);
        segment(...ends, {stroke: 'var(--muted)', 'stroke-width': 3, 'stroke-dasharray': isX ? 'none' : '3 3'}, group);
      }
    }
    function paintEdge(edge, dx = 0, dy = 0, copy = false) {
      const hasX = xSet.has(edge.id), hasZ = zSet.has(edge.id);
      const pauli = hasX ? hasZ ? 'Y' : 'X' : hasZ ? 'Z' : 'I';
      const group = node('g', copy ? {'data-copy': edge.id, opacity: 0.3, 'aria-hidden': 'true'} : {'data-edge': edge.id, 'data-pauli': pauli});
      if (!copy) node('title', {}, `${edge.id}: ${pauli === 'I' ? 'identity' : pauli}`, group);
      const ends = edge.ends.map(([x, y]) => [x + dx, y + dy]);
      if (hasX) segment(...ends, {stroke: 'var(--plot-primary)', 'stroke-width': 5}, group);
      if (hasZ) segment(...ends, {stroke: 'var(--plot-secondary)', 'stroke-width': hasX ? 2.5 : 5, 'stroke-dasharray': '7 4'}, group);
      const [cx, cy] = xy(edge.x + dx + Number(edge.axis === 'h') / 2, edge.y + dy + Number(edge.axis === 'v') / 2);
      node('circle', {cx, cy, r: 5, fill: hasX ? 'var(--plot-primary)' : 'var(--bg)', stroke: 'var(--text)', 'stroke-width': 1.5}, undefined, group);
      if (pauli !== 'I') label(cx + (edge.axis === 'v' ? 14 : 0), cy + (edge.axis === 'v' ? 4 : -12), pauli, {'font-weight': 'bold'}, group);
    }
    for (const edge of code.edges) {
      paintEdge(edge);
      if (edge.axis === 'v' && edge.x === 0) paintEdge(edge, code.L, 0, true);
      if (edge.axis === 'h' && edge.y === 0) paintEdge(edge, 0, code.L, true);
    }
    for (const check of code.checks) {
      const isStar = check.type === 'X', selected = placed.has(check.id);
      const [x, y] = xy(check.x + (isStar ? 0 : 0.5), check.y + (isStar ? 0 : 0.5));
      const group = node('g', {
        'data-check': check.id, tabindex: 0, role: 'button', 'aria-pressed': selected,
        'aria-label': `${isStar ? 'A' : 'B'}(${check.x},${check.y}), ${isStar ? 'X star' : 'Z face'}, ${selected ? 'placed; remove' : 'place'} with the ${isStar ? 'X stars' : 'Z faces'} tool`
      });
      node('rect', {x: x - 15, y: y - 15, width: 30, height: 30, class: 'check-focus', fill: 'var(--bg)', 'fill-opacity': 0, stroke: selected ? 'var(--plot-accent)' : 'none', 'stroke-width': 2}, undefined, group);
      node('rect', {x: x - 5, y: y - 5, width: 10, height: 10, fill: isStar ? 'var(--plot-primary)' : 'var(--bg)', stroke: isStar ? 'var(--plot-primary)' : 'var(--plot-secondary)', 'stroke-width': 2}, undefined, group);
      if (selected) label(x + 12, y - 10, '✓', {'font-size': 12}, group);
      if (isStar && (check.x === 0 || check.y === 0)) {
        const copies = [];
        if (check.x === 0) copies.push([code.L, check.y]);
        if (check.y === 0) copies.push([check.x, code.L]);
        if (check.x === 0 && check.y === 0) copies.push([code.L, code.L]);
        for (const point of copies) {
          const [cx, cy] = xy(...point);
          node('rect', {x: cx - 4, y: cy - 4, width: 8, height: 8, fill: 'var(--plot-primary)', opacity: 0.3, 'aria-hidden': 'true'});
        }
      }
    }
    for (let i = 0; i <= code.L; i++) {
      label(xy(i, 0)[0], 57, String(i % code.L), {fill: 'var(--muted)'});
      label(66, xy(0, i)[1] + 4, String(i % code.L), {fill: 'var(--muted)'});
    }
    label(290, 24, '⇕ Opposite sides join without a twist');
    label(37, 280, '⇔'); label(535, 280, '⇔'); label(290, 509, '⇕');
    label(290, 539, '○ data qubit   ■ X star   □ Z face   ✓ placed check');
    label(290, 563, 'X: solid + filled   Z: dashed + hollow   Y: both + Y');
    label(290, 587, 'Faint guides: Z1 on h(x,0); Z2 on v(0,y)');
    label(290, 611, 'X1 on h(0,y); X2 on v(x,0)');
    label(290, 635, 'Faded seam copies are the same qubits.');
  }
  StudyLab.register('string-deformer', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    const gateRoot = root.closest('[data-kind="lab"]') || root;
    ctx.controls.fromCard(layout.controls);
    // createState restores card keys only. Keep placements local rather than imply reload support.
    let applied = [], previous = ctx.model.normalizeParams(ctx.state.all()), message = '';
    ctx.controls.button(layout.controls, {label: 'Reset', onClick() {
      applied = []; message = 'Placed checks cleared.'; draw();
    }});
    const holder = doc.createElement('div');
    holder.style.overflowX = 'auto';
    holder.setAttribute('tabindex', '0');
    holder.setAttribute('aria-label', 'Torus lattice; scroll horizontally on narrow screens');
    layout.plots.appendChild(holder);
    const svg = doc.createElementNS(NS, 'svg');
    svg.id = `${ctx.id}-lattice`;
    svg.setAttribute('viewBox', '0 0 600 650');
    svg.setAttribute('width', '100%');
    svg.style.minWidth = '600px'; svg.style.maxWidth = '800px';
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Pauli support with keyboard-accessible star and face checks');
    holder.appendChild(svg);
    const status = doc.createElement('p');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    layout.notes.appendChild(status);
    const chart = ctx.plot(layout.plots, {
      title: 'Weight after placing checks', x: {label: 'Checks applied', domain: 'auto'},
      y: {label: 'Weight of the operator', domain: 'auto'}, legend: true
    });
    function draw() {
      const r = ctx.model.evaluate(ctx.state.all(), applied), s = r.summary;
      applied = r.applied;
      drawLattice(svg, r, ctx.model);
      chart.update([{id: 'weight', label: 'Weight (qubits)', role: 'primary', kind: 'line', points: r.points}]);
      ctx.readouts(layout.readouts, [
        {label: 'Total weight', value: s.weight, units: 'qubits'},
        {label: 'X edges', value: s.counts.x}, {label: 'Z edges', value: s.counts.z}, {label: 'Y edges', value: s.counts.y},
        {label: 'Z crossing bits (w_x, w_y)', value: `(${s.winding.join(', ')})`},
        {label: 'X crossing bits (c_1, c_2), odd overlap with Z1 then Z2', value: `(${s.dual.join(', ')})`},
        ...['z1', 'z2', 'x1', 'x2'].map(id => ({label: `Commutation with ${id.toUpperCase()}`, value: s.signs[id] === 1 ? '+ (plus)' : '− (minus)'})),
        {label: 'Logical action', value: s.logicalAction}, {label: 'Checks applied', value: applied.length},
        {label: 'Syndrome', value: s.zeroSyndrome ? 'every check reads +1' : 'a check reads −1'}
      ]);
      status.textContent = message || 'Choose a square with the matching tool. Place it again to undo it.';
      ctx.notes(layout.notes, 'X and Z edge counts exclude Y edges. Crossing bits count odd overlap with the named logical partners. The line replays the still-placed checks in placement order; removing one rebuilds that line.');
    }
    function place(event) {
      if (gateRoot.dataset.gated === 'true') return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      const target = event.target.closest('[data-check]');
      if (!target || !svg.contains(target)) return;
      event.preventDefault();
      const id = target.getAttribute('data-check'), isStar = id[0] === 'A';
      if ((previous.tool === 'x-star') !== isStar) {
        message = `Switch the tool to place ${isStar ? 'X stars' : 'Z faces'} here`;
        status.textContent = message;
        return;
      }
      const removing = applied.includes(id);
      applied = removing ? applied.filter(check => check !== id) : [...applied, id];
      message = `${removing ? 'Removed' : 'Placed'} ${id[0]}(${id.slice(2)}).`;
      draw();
      svg.querySelector(`[data-check="${id}"]`)?.focus();
    }
    svg.addEventListener('click', place); svg.addEventListener('keydown', place);
    const unsubscribe = ctx.state.onChange(() => {
      const next = ctx.model.normalizeParams(ctx.state.all());
      if (next.L !== previous.L || next.start !== previous.start) applied = [];
      previous = next; message = ''; draw();
    });
    draw();
    return {destroy() {
      unsubscribe(); svg.removeEventListener('click', place); svg.removeEventListener('keydown', place);
      chart.destroy?.(); holder.remove(); status.remove();
    }};
  });
})();

}).call(window);
