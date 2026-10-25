/* energy-barrier-lab: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['energy-barrier-lab'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const defaults = Object.freeze({toric_step: 1, cube_step: 1, toric_route: 'row', cube_route: 'compact'});
  const bit = i => 1n << BigInt(i);
  const mask = support => support.reduce((a, i) => a ^ bit(i), 0n);
  function parity(a) { let p = 0; while (a) { p ^= 1; a &= a - 1n; } return p; }
  function weight(a) { let n = 0; while (a) { n++; a &= a - 1n; } return n; }
  const invalid = message => ({valid: false, message, warnings: [message]});
  function prefixError(route, step, routes, limit, name) {
    if (typeof route !== 'string' || !Object.hasOwn(routes, route)) return invalid(`Choose a listed ${name} route.`);
    if (!Number.isInteger(step) || step < 0 || step > limit) return invalid(`${name} step must be an integer from 0 to ${limit}.`);
    return null;
  }
  function makeTorus() {
    const mod = x => (x + 4) % 4, h = (x, y) => 4 * mod(y) + mod(x), v = (x, y) => 16 + h(x, y);
    const edges = [], stars = [], faces = [];
    for (const axis of ['h', 'v']) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      edges.push({index: edges.length, id: `${axis}(${x},${y})`, axis, x, y,
        ends: [[x, y], [mod(x + Number(axis === 'h')), mod(y + Number(axis === 'v'))]]});
    }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      stars.push({index: stars.length, id: `A(${x},${y})`, type: 'X', x, y,
        support: [h(x, y), h(x - 1, y), v(x, y), v(x, y - 1)]});
      faces.push({index: faces.length, id: `B(${x},${y})`, type: 'Z', x, y,
        support: [h(x, y), v(x + 1, y), h(x, y + 1), v(x, y)]});
    }
    return {L: 4, n: 32, groundEnergy: -32, edges, stars, faces,
      routes: {row: [h(0, 1), h(1, 1), h(2, 1), h(3, 1)], face: [h(1, 1), v(2, 1), h(1, 2), v(1, 1)]}};
  }
  const torus = makeTorus();
  const starMasks = torus.stars.map(c => mask(c.support)), faceMasks = torus.faces.map(c => mask(c.support));
  // BigInt elimination retains the plaquettes that witness span membership.
  const faceBasis = new Map();
  faceMasks.forEach((row, i) => {
    let a = row, witness = bit(i);
    while (a) {
      const pivot = a.toString(2).length - 1, old = faceBasis.get(pivot);
      if (!old) { faceBasis.set(pivot, {row: a, witness}); break; }
      a ^= old.row; witness ^= old.witness;
    }
  });
  function faceWitness(target) {
    let a = target, witness = 0n;
    while (a) {
      const old = faceBasis.get(a.toString(2).length - 1);
      if (!old) return null;
      a ^= old.row; witness ^= old.witness;
    }
    return torus.faces.flatMap((_, i) => witness & bit(i) ? [i] : []);
  }
  function torus4() { return copy(torus); }
  function toricPrefix(route, step) {
    const error = prefixError(route, step, torus.routes, 4, 'Toric');
    if (error) return error;
    const support = torus.routes[route].slice(0, step), z = mask(support);
    const starSyndrome = starMasks.map(a => parity(a & z)), faceSyndrome = faceMasks.map(() => 0);
    const failed = starSyndrome.reduce((a, b) => a + b, 0), stabilizerWitness = failed ? null : faceWitness(z);
    const classification = z === 0n ? 'identity' : failed ? 'detectable' : stabilizerWitness === null ? 'logical' : 'stabilizer';
    return {valid: true, route, step, support, starSyndrome, faceSyndrome, failed,
      rawWeight: support.length, energyRise: 2 * failed, absoluteEnergy: -32 + 2 * failed,
      class: classification, stabilizerWitness};
  }
  function makeCube() {
    const vertices = Array.from({length: 8}, (_, i) => ({index: i, x: i % 2, y: Math.floor(i / 2) % 2, z: Math.floor(i / 4)}));
    const edges = [];
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if (weight(BigInt(a ^ b)) === 1) edges.push([a, b]);
    return {vertices, edges, groundEnergy: -12,
      routes: {compact: [0, 1, 3, 2, 6, 7, 5, 4], dispersed: [0, 3, 5, 6, 1, 2, 4, 7]}};
  }
  const cube = makeCube();
  const cubeMasks = cube.edges.map(mask);
  const cut = subset => cubeMasks.flatMap((edge, i) => parity(edge & subset) ? [i] : []);
  function cubeGraph() { return copy(cube); }
  function cubePrefix(route, step) {
    const error = prefixError(route, step, cube.routes, 8, 'Cube');
    if (error) return error;
    const flipped = cube.routes[route].slice(0, step), failed = cut(mask(flipped));
    return {valid: true, route, step, flipped, failed, rawWeight: flipped.length,
      classicalDistance: Math.min(flipped.length, 8 - flipped.length),
      energyRise: 2 * failed.length, absoluteEnergy: -12 + 2 * failed.length};
  }
  function enumerateLandscape() {
    const syndromeWeights = [], lowerByRawWeight = Array(9).fill(Infinity), lowerByClassicalDistance = Array(5).fill(Infinity);
    for (let s = 0; s < 256; s++) {
      const w = weight(BigInt(s)), d = Math.min(w, 8 - w), failed = cut(BigInt(s)).length;
      syndromeWeights.push(failed);
      lowerByRawWeight[w] = Math.min(lowerByRawWeight[w], failed);
      lowerByClassicalDistance[d] = Math.min(lowerByClassicalDistance[d], failed);
    }
    // Dijkstra's relaxation uses the largest energy visited, rather than a sum.
    // Ascending configuration and vertex order fixes otherwise irrelevant ties.
    const costs = Array(256).fill(Infinity), parents = Array(256).fill(-1), visited = Array(256).fill(false);
    costs[0] = 0;
    for (let count = 0; count < 256; count++) {
      let current = -1;
      for (let s = 0; s < 256; s++) if (!visited[s] && (current < 0 || costs[s] < costs[current])) current = s;
      visited[current] = true;
      for (let v = 0; v < 8; v++) {
        const next = Number(BigInt(current) ^ bit(v)), candidate = Math.max(costs[current], 2 * syndromeWeights[next]);
        if (candidate < costs[next]) { costs[next] = candidate; parents[next] = current; }
      }
    }
    const masks = [];
    for (let s = 255; s !== -1; s = parents[s]) masks.push(s);
    masks.reverse();
    const flips = masks.slice(1).map((s, i) => Math.log2(s ^ masks[i]));
    return {syndromeWeights, lowerByRawWeight, lowerByClassicalDistance,
      minimaxBarrier: costs[255], minimaxCosts: costs,
      witness: {masks, flips, energies: masks.map(s => 2 * syndromeWeights[s])}};
  }
  // Enumerated once. Every public access returns a defensive JSON-safe copy.
  const landscape = enumerateLandscape();
  function cubeLandscape() { return copy(landscape); }
  function curves(toricRoute = 'row', cubeRoute = 'compact') {
    const error = prefixError(toricRoute, 0, torus.routes, 4, 'Toric') || prefixError(cubeRoute, 0, cube.routes, 8, 'Cube');
    if (error) return error;
    const toric = Array.from({length: 5}, (_, i) => toricPrefix(toricRoute, i));
    const cubeSeries = Array.from({length: 9}, (_, i) => cubePrefix(cubeRoute, i));
    const alternateRoute = cubeRoute === 'compact' ? 'dispersed' : 'compact';
    const alternateCube = Array.from({length: 9}, (_, i) => cubePrefix(alternateRoute, i));
    return {valid: true, toric, cube: cubeSeries, alternateCube,
      toricPoints: toric.map(s => [s.rawWeight, s.energyRise]),
      cubePoints: cubeSeries.map(s => [s.rawWeight, s.energyRise]),
      alternateCubePoints: alternateCube.map(s => [s.rawWeight, s.energyRise]),
      routePeaks: {toric: Math.max(...toric.map(s => s.energyRise)), cube: Math.max(...cubeSeries.map(s => s.energyRise))},
      barriers: {toric: 4, cube: landscape.minimaxBarrier}};
  }
  function compute(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return invalid('Parameters must be an object.');
    const p = {...defaults};
    for (const key of Object.keys(params)) {
      if (!Object.hasOwn(defaults, key)) return invalid('Use the four listed route and step parameters.');
      p[key] = params[key];
    }
    const error = prefixError(p.toric_route, p.toric_step, torus.routes, 4, 'Toric') || prefixError(p.cube_route, p.cube_step, cube.routes, 8, 'Cube');
    if (error) return error;
    const toric = toricPrefix(p.toric_route, p.toric_step), selectedCube = cubePrefix(p.cube_route, p.cube_step);
    const series = curves(p.toric_route, p.cube_route);
    const readouts = [
      ['toric-weight', 'Error weight', toric.rawWeight], ['toric-failed', 'Failed checks', toric.failed],
      ['toric-energy', 'Energy above ground', toric.energyRise], ['toric-class', 'Operator class', toric.class],
      ['toric-route-peak', 'Route peak', series.routePeaks.toric], ['toric-barrier', 'Smallest logical-route peak', series.barriers.toric],
      ['cube-weight', 'Error weight', selectedCube.rawWeight], ['cube-distance', 'Classical distance', selectedCube.classicalDistance],
      ['cube-failed', 'Failed checks', selectedCube.failed.length], ['cube-energy', 'Energy above ground', selectedCube.energyRise],
      ['cube-route-peak', 'Route peak', series.routePeaks.cube], ['cube-barrier', 'Smallest logical-route peak', series.barriers.cube]
    ].map(([id, label, value]) => ({id, label, value}));
    return {valid: true, params: p, toric, cube: selectedCube, curves: series, barriers: {...series.barriers}, readouts, warnings: []};
  }
  return {torus4, toricPrefix, cubeGraph, cubePrefix, cubeLandscape, curves, compute};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const note = 'Energy counts failed checks. The cube compares classical bit flips; phase errors have no protection in this model. Step counts select supports and do not represent elapsed time.';
  function node(parent, tag, attrs = {}, text) {
    const n = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = String(text);
    parent.appendChild(n); return n;
  }
  function label(svg, x, y, text, attrs = {}) {
    return node(svg, 'text', {x, y, fill: 'var(--text)', 'font-size': 18, ...attrs}, text);
  }
  function toricBoard(svg, geometry, state) {
    svg.replaceChildren();
    node(svg, 'title', {}, 'Toric Z support and failed star checks. Opposite sides are identified.');
    const pos = (x, y) => [40 + 64 * x, 45 + 64 * y];
    const line = (a, b, attrs = {}) => node(svg, 'line', {x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'var(--line)', 'stroke-width': 1.5, ...attrs});
    function edge(e, dx = 0, dy = 0, duplicate = false) {
      const a = pos(e.x + dx, e.y + dy), b = pos(e.x + dx + Number(e.axis === 'h'), e.y + dy + Number(e.axis === 'v'));
      const attrs = duplicate ? {'data-copy': true, opacity: 0.35} : {};
      line(a, b, attrs);
      if (state.support.includes(e.index)) {
        line(a, b, {...attrs, 'data-role': 'operator-z', 'data-edge': e.index, stroke: 'var(--plot-primary)', 'stroke-width': 5, 'stroke-dasharray': '7 4'});
        label(svg, (a[0] + b[0]) / 2 + (e.axis === 'v' ? 10 : 0), (a[1] + b[1]) / 2 + (e.axis === 'h' ? -10 : 5), 'Z', {...attrs, 'text-anchor': e.axis === 'h' ? 'middle' : 'start'});
      }
      const ring = node(svg, 'circle', {...attrs, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: 4.5,
        fill: 'var(--bg)', stroke: 'var(--text)', 'data-qubit': e.index});
      node(ring, 'title', {}, e.id);
    }
    geometry.edges.forEach(e => {
      edge(e);
      if (e.axis === 'v' && e.x === 0) edge(e, 4, 0, true);
      if (e.axis === 'h' && e.y === 0) edge(e, 0, 4, true);
    });
    function star(c, dx = 0, dy = 0, duplicate = false) {
      const [x, y] = pos(c.x + dx, c.y + dy), attrs = duplicate ? {'data-copy': true, opacity: 0.35} : {};
      const square = node(svg, 'rect', {...attrs, x: x - 3, y: y - 3, width: 6, height: 6, fill: 'var(--text)', 'data-check': c.id});
      node(square, 'title', {}, `${c.id}: X check`);
      if (state.starSyndrome[c.index]) {
        node(svg, 'circle', {...attrs, cx: x, cy: y, r: 8, fill: 'var(--plot-accent)', 'data-role': 'flag-e', 'data-check': c.id});
        label(svg, x + 10, y - 10, 'e', attrs);
      }
    }
    geometry.stars.forEach(c => {
      star(c);
      if (c.x === 0) star(c, 4, 0, true);
      if (c.y === 0) star(c, 0, 4, true);
      if (c.x === 0 && c.y === 0) star(c, 4, 4, true);
    });
    geometry.faces.forEach(c => {
      const [x, y] = pos(c.x + 0.5, c.y + 0.5);
      const square = node(svg, 'rect', {x: x - 3, y: y - 3, width: 6, height: 6, fill: 'none', stroke: 'var(--muted)', 'data-check': c.id});
      node(square, 'title', {}, `${c.id}: Z check`);
    });
    for (let i = 0; i <= 4; i++) {
      label(svg, pos(i, 0)[0], 24, i % 4, {'text-anchor': 'middle'});
      label(svg, 15, pos(0, i)[1] + 6, i % 4, {'text-anchor': 'middle'});
    }
    label(svg, 328, 24, 'x'); label(svg, 12, 326, 'y');
    label(svg, 15, 210, '↔'); label(svg, 314, 210, '↔');
    label(svg, 136, 24, '↕'); label(svg, 136, 326, '↕');
    label(svg, 16, 350, '○ Data qubit   Z dashed');
    label(svg, 16, 375, '■ X check   □ Z check   ● e');
  }
  function cubeBoard(svg, geometry, state) {
    svg.replaceChildren();
    node(svg, 'title', {}, 'Classical cube flips. Filled vertices are flipped; halos mark failed ZZ bonds.');
    const pos = i => { const v = geometry.vertices[i]; return [70 + 105 * v.x + 42 * v.z, 190 - 105 * v.y - 42 * v.z]; };
    geometry.edges.forEach(([a, b], i) => {
      const [x1, y1] = pos(a), [x2, y2] = pos(b);
      if (state.failed.includes(i)) node(svg, 'line', {x1, y1, x2, y2, stroke: 'var(--plot-accent)', 'stroke-width': 9, opacity: 0.45, 'data-role': 'failed-bond', 'data-edge': i});
      const bond = node(svg, 'line', {x1, y1, x2, y2, stroke: 'var(--text)', 'stroke-width': 1.5, 'data-edge': i});
      node(bond, 'title', {}, `ZZ bond ${i}: ${a}, ${b}`);
    });
    geometry.vertices.forEach(v => {
      const [x, y] = pos(v.index), flipped = state.flipped.includes(v.index);
      node(svg, 'circle', {cx: x, cy: y, r: 7, fill: flipped ? 'var(--text)' : 'var(--bg)', stroke: 'var(--text)', 'stroke-width': 2,
        'data-role': flipped ? 'classical-flip' : 'classical-bit', 'data-qubit': v.index});
      label(svg, x + 10, y - 10, v.index);
    });
    label(svg, 12, 229, '○ Bit   ● Flipped bit');
    label(svg, 12, 255, 'Halo: failed ZZ bond');
  }
  StudyLab.register('energy-barrier-lab', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    function html(parent, tag) { const n = doc.createElement(tag); parent.appendChild(n); return n; }
    function panel(title, suffix, xMax, yMax, viewBox) {
      const section = html(layout.plots, 'section'); section.setAttribute('aria-label', title);
      section.style.minWidth = '0';
      const chartHost = html(section, 'div'); chartHost.style.minWidth = '0';
      const chart = ctx.plot(chartHost, {title, x: {label: 'Error weight in the selected route', domain: [0, xMax]}, y: {label: 'Energy above ground', domain: [0, yMax]}, legend: true});
      const row = html(section, 'div');
      row.style.display = 'grid'; row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))'; row.style.gap = '12px'; row.style.alignItems = 'center';
      const holder = html(row, 'div'); holder.style.overflowX = 'auto'; holder.style.minWidth = '0';
      holder.setAttribute('tabindex', '0'); holder.setAttribute('aria-label', `${title} support board`);
      const svg = node(holder, 'svg', {id: `${ctx.id}-${suffix}-board`, viewBox, width: '100%', role: 'img', 'aria-label': `${title} support and failed checks`});
      svg.style.minWidth = '300px'; svg.style.maxWidth = '420px'; svg.style.display = 'block';
      const readings = html(row, 'div'); readings.setAttribute('aria-label', `${title} readouts`); readings.setAttribute('aria-live', 'polite');
      return {section, chart, svg, readings};
    }
    const toric = panel('Toric route', 'toric', 4, 4, '0 0 352 390');
    const cube = panel('Cube routes', 'cube', 8, 24, '0 0 288 270');
    const geometry = {toric: ctx.model.torus4(), cube: ctx.model.cubeGraph()};
    function plotRoutes(r, selected) {
      toric.chart.update([{id: 'toric-route', label: 'Toric route', role: 'primary', kind: 'line', points: r.curves.toricPoints}],
        selected ? [{type: 'point', x: r.toric.rawWeight, y: r.toric.energyRise, role: 'accent'}] : []);
      cube.chart.update([
        {id: 'cube-alternate', label: 'Alternate route', role: 'reference', width: 1, dash: '4 4', kind: 'line', points: r.curves.alternateCubePoints},
        {id: 'cube-route', label: 'Selected route', role: 'primary', kind: 'line', points: r.curves.cubePoints}
      ], selected ? [{type: 'point', x: r.cube.rawWeight, y: r.cube.energyRise, role: 'accent'}] : []);
    }
    function readings(panel, items) {
      ctx.readouts(panel.readings, items);
      // The SDK renders labels and values; retain the fixed IDs for readback too.
      const nodes = panel.readings.querySelectorAll?.('.readout');
      if (nodes) nodes.forEach((n, i) => n.setAttribute('data-readout', items[i].id));
    }
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.valid ? null : r.message);
      if (!r.valid) {
        const baseline = ctx.model.compute();
        plotRoutes(baseline, false);
        for (const p of [toric, cube]) { p.svg.replaceChildren(); label(p.svg, 20, 60, 'Invalid parameters'); }
        readings(toric, baseline.readouts.slice(0, 6).map(item => ({...item, value: 'Unavailable'})));
        readings(cube, baseline.readouts.slice(6).map(item => ({...item, value: 'Unavailable'})));
        ctx.notes(layout.notes, `${note} Default routes shown; no selected support.`);
        return;
      }
      plotRoutes(r, true);
      toricBoard(toric.svg, geometry.toric, r.toric); cubeBoard(cube.svg, geometry.cube, r.cube);
      readings(toric, r.readouts.slice(0, 6)); readings(cube, r.readouts.slice(6));
      ctx.notes(layout.notes, note + (r.params.toric_route === 'face' ? ' The selected toric path ends in a stabilizer. The model’s smallest logical-route peak remains 4.' : ''));
    }
    const unsubscribe = ctx.state.onChange(draw);
    draw();
    return {destroy() { unsubscribe(); toric.chart.destroy?.(); cube.chart.destroy?.(); toric.section.remove(); cube.section.remove(); }};
  });
})();

}).call(window);
