/* connectivity-mapper: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['connectivity-mapper'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const mod = (x, n) => ((x % n) + n) % n;
  const key = (u, v) => u < v ? `${u}:${v}` : `${v}:${u}`;
  const finite = (x, fallback) => typeof x === 'number' && Number.isFinite(x) ? x : fallback;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function normalizeParams(raw = {}) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const graph = ['gross', 'tiny'].includes(raw.graph) ? raw.graph : 'gross';
    return {
      graph,
      layout: ['planar-grid', 'heavy-hex', 'thickness-2', 'reconfigurable'].includes(raw.layout) ? raw.layout : 'planar-grid',
      metric: ['long', 'crossings'].includes(raw.metric) ? raw.metric : 'long',
      threshold: clamp(finite(raw.threshold, 1), 1, 6),
      check_index: mod(clamp(Math.round(finite(raw.check_index, 0)), 0, 71), graph === 'gross' ? 72 : 6)
    };
  }
  function shiftRows(ell, m, terms) {
    return Array.from({length: ell * m}, (_, q) => terms.reduce((row, [a, b]) =>
      row ^ (1n << BigInt(mod(Math.floor(q / m) + a, ell) * m + mod(q % m + b, m))), 0n));
  }
  function transpose(rows, n) {
    const out = Array(n).fill(0n);
    rows.forEach((row, i) => { for (let j = 0; j < n; j++) if (row & (1n << BigInt(j))) out[j] |= 1n << BigInt(i); });
    return out;
  }
  function support(row, n) { return Array.from({length: n}, (_, i) => i).filter(i => (row & (1n << BigInt(i))) !== 0n); }
  function buildGraph(name = 'gross') {
    if (!['gross', 'tiny'].includes(name)) throw new RangeError('Choose gross or tiny for the code graph.');
    const ell = name === 'gross' ? 12 : 3, m = name === 'gross' ? 6 : 2, s = ell * m;
    const terms = name === 'gross' ? {A: [[3, 0], [0, 1], [0, 2]], B: [[0, 3], [1, 0], [2, 0]]} :
      {A: [[0, 0], [1, 0], [2, 0]], B: [[1, 0], [2, 0], [0, 1]]};
    const A = shiftRows(ell, m, terms.A), B = shiftRows(ell, m, terms.B);
    const AT = transpose(A, s), BT = transpose(B, s), offset = BigInt(s);
    const HX = A.map((row, q) => support(row | (B[q] << offset), 2 * s));
    const HZ = BT.map((row, q) => support(row | (AT[q] << offset), 2 * s));
    const vertices = ['X', 'L', 'R', 'Z'].flatMap((register, r) => Array.from({length: s}, (_, q) => ({
      id: r * s + q, register, index: q, i: Math.floor(q / m), j: q % m,
      label: `${register}(${Math.floor(q / m)},${q % m})`
    })));
    const edges = [];
    for (const type of ['X', 'Z']) for (let q = 0; q < s; q++) {
      const check = (type === 'X' ? 0 : 3 * s) + q, sign = type === 'X' ? 1 : -1;
      for (const family of ['A', 'B']) terms[family].forEach(([a, b], t) => {
        const register = type === 'X' ? (family === 'A' ? 'L' : 'R') : (family === 'A' ? 'R' : 'L');
        const index = mod(Math.floor(q / m) + sign * a, ell) * m + mod(q % m + sign * b, m);
        const data = (register === 'L' ? s : 2 * s) + index, term = `${family}${t + 1}`;
        if (!(type === 'X' ? HX[q] : HZ[q]).includes(data - s)) throw new Error('An incidence disagrees with its binary matrix.');
        edges.push({id: `${type}${q}-${term}`, u: check, v: data, check, data, type, term,
          layer: ['A2', 'A3', 'B3'].includes(term) ? 'a' : 'b'});
      });
    }
    const degrees = Array(4 * s).fill(0);
    edges.forEach(e => { degrees[e.u]++; degrees[e.v]++; });
    if (new Set(edges.map(e => key(e.u, e.v))).size !== edges.length || degrees.some(d => d !== 6))
      throw new Error('The selected code must have six distinct neighbors at every vertex.');
    return {name, ell, m, s, terms, vertices, edges, degrees, HX, HZ,
      checkOrder: [...Array.from({length: s}, (_, i) => i), ...Array.from({length: s}, (_, i) => 3 * s + i)]};
  }
  function planarPositions(graph) {
    const positions = {};
    if (graph.name === 'tiny') graph.vertices.forEach(v => { positions[v.id] = [v.id % 5, Math.floor(v.id / 5)]; });
    else {
      const put = (r, i, j, x, y) => { positions[r * graph.s + mod(i, 12) * 6 + mod(j, 6)] = [x, y]; };
      for (let a = 0; a < 6; a++) for (let b = 0; b < 12; b++) {
        put(1, -b, -a, 2 * a, 2 * b);
        put(2, 1 - b, -a - 2, 2 * a + 1, 2 * b + 1);
        put(0, -b, -a - 2, 2 * a + 1, 2 * b);
        put(3, 1 - b, -a, 2 * a, 2 * b + 1);
      }
    }
    return {positions, units: 'drawing pitch', physicalMeaning: 'drawing pitch'};
  }
  function heavyHexHost(vertexCount) {
    if (!Number.isInteger(vertexCount) || vertexCount < 1 || vertexCount > 10000) throw new RangeError('Host vertex count must be an integer from 1 to 10000.');
    const W = Math.ceil(Math.sqrt(vertexCount)) + 2, H = W, points = [], segments = [];
    const original = (i, j) => j * W + i;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) points.push([2 * i, 2 * j]);
    const split = (u, v) => { const w = points.length; points.push([(points[u][0] + points[v][0]) / 2, (points[u][1] + points[v][1]) / 2]); segments.push([u, w], [w, v]); };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (i + 1 < W) split(original(i, j), original(i + 1, j));
      if (j + 1 < H && (i + j) % 2 === 0) split(original(i, j), original(i, j + 1));
    }
    const order = points.map((p, id) => ({p, id})).sort((a, b) => a.p[1] - b.p[1] || a.p[0] - b.p[0]);
    const ids = Object.fromEntries(order.map((v, i) => [v.id, i]));
    const vertices = order.map((v, id) => ({id, x: v.p[0], y: v.p[1]}));
    const edges = segments.map(([u, v], id) => ({id: `host-${id}`, u: ids[u], v: ids[v]}));
    const adjacency = vertices.map(() => []);
    edges.forEach(e => { adjacency[e.u].push(e.v); adjacency[e.v].push(e.u); });
    adjacency.forEach(a => a.sort((a, b) => a - b));
    return {W, H, vertices, edges, adjacency, units: 'drawing pitch', kind: 'subdivided brick-wall host'};
  }
  function placeOnHost(graph, host = heavyHexHost(graph.vertices.length)) {
    if (host.vertices.length < graph.vertices.length) throw new Error('The host has too few sites.');
    return Object.fromEntries(graph.vertices.map((v, i) => [v.id, [host.vertices[i].x, host.vertices[i].y]]));
  }
  function partitionLayers(graph) {
    return ['a', 'b'].map(id => ({id, vertices: graph.vertices.map(v => ({...v})),
      edges: graph.edges.filter(e => e.layer === id).map(e => ({...e})), matchingTerm: id === 'a' ? 'B3' : 'A1'}));
  }
  function prismComponents(layer) {
    const adjacency = new Map(layer.vertices.map(v => [v.id, []]));
    layer.edges.forEach(e => { adjacency.get(e.u).push(e.v); adjacency.get(e.v).push(e.u); });
    if ([...adjacency.values()].some(a => a.length !== 3)) throw new Error('A layer must have degree three at every vertex.');
    const unseen = new Set(adjacency.keys()), components = [];
    while (unseen.size) {
      const start = Math.min(...unseen), queue = [start]; unseen.delete(start);
      for (let k = 0; k < queue.length; k++) for (const v of adjacency.get(queue[k])) if (unseen.delete(v)) queue.push(v);
      const ids = queue.sort((a, b) => a - b), members = new Set(ids), edges = layer.edges.filter(e => members.has(e.u));
      const matching = new Map(), cycleAdj = new Map(ids.map(v => [v, []]));
      for (const e of edges) {
        if (e.term === layer.matchingTerm) {
          if (matching.has(e.u) || matching.has(e.v)) throw new Error('The declared matching repeats a vertex.');
          matching.set(e.u, e.v); matching.set(e.v, e.u);
        } else { cycleAdj.get(e.u).push(e.v); cycleAdj.get(e.v).push(e.u); }
      }
      if (matching.size !== ids.length || [...cycleAdj.values()].some(a => a.length !== 2)) throw new Error('Deleting the matching must leave degree-two cycles.');
      cycleAdj.forEach(a => a.sort((a, b) => a - b));
      const first = [start]; let prev = start, next = cycleAdj.get(start)[0];
      while (next !== start) {
        if (first.includes(next)) throw new Error('A residual walk failed to close into a simple cycle.');
        first.push(next); const after = cycleAdj.get(next).find(v => v !== prev); prev = next; next = after;
      }
      const second = first.map(v => matching.get(v));
      if (first.length < 3 || new Set([...first, ...second]).size !== ids.length || 2 * first.length !== ids.length)
        throw new Error('The matching must pair two disjoint equal cycles.');
      for (let i = 0; i < first.length; i++) {
        const j = (i + 1) % first.length;
        if (!cycleAdj.get(first[i]).includes(first[j]) || !cycleAdj.get(second[i]).includes(second[j]) || matching.get(second[i]) !== first[i])
          throw new Error('The matching does not preserve cycle adjacency.');
      }
      components.push({layer: layer.id, tile: components.length, vertices: ids, edges: edges.map(e => ({...e})),
        cycles: [first, second], matching: first.map((v, i) => [v, second[i]]), certificate: true});
    }
    return components;
  }
  function planarLayerPositions(component) {
    if (!component.certificate) throw new Error('A prism certificate is required before drawing a layer.');
    const positions = {}, ox = (component.tile % 3) * 5, oy = Math.floor(component.tile / 3) * 5;
    component.cycles.forEach((cycle, c) => cycle.forEach((v, t) => {
      const angle = 2 * Math.PI * t / cycle.length, radius = c === 0 ? 2 : 1;
      positions[v] = [ox + radius * Math.cos(angle), oy + radius * Math.sin(angle)];
    }));
    return {positions, mode: 'certificate', physicalLength: null, units: null};
  }
  function activeNeighborhood(graph, checkIndex) {
    const check = mod(Math.round(finite(checkIndex, 0)), graph.s);
    const edges = graph.edges.filter(e => e.check === check).sort((a, b) => a.data - b.data).map(e => ({...e}));
    if (edges.length !== 6) throw new Error('The selected neighborhood must have six edges.');
    const neighbors = edges.map(e => e.data), positions = {[check]: [0, 0]};
    neighbors.forEach((v, i) => { positions[v] = [Math.cos(i * Math.PI / 3), Math.sin(i * Math.PI / 3)]; });
    const active = new Set([check, ...neighbors]), edgeIds = new Set(edges.map(e => e.id));
    return {check, neighbors, edges, positions, pendingVertices: graph.vertices.filter(v => !active.has(v.id)).map(v => v.id),
      pendingEdges: graph.edges.filter(e => !edgeIds.has(e.id)).map(e => e.id)};
  }
  function point(positions, id) {
    const p = positions[id];
    if (!p || p.length !== 2 || !p.every(Number.isFinite)) throw new Error(`Missing finite coordinates for vertex ${id}.`);
    return p;
  }
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const distinct = (e, f) => e.u !== f.u && e.u !== f.v && e.v !== f.u && e.v !== f.v;
  function strictCrossings(positions, edges) {
    const segments = edges.map(e => [point(positions, e.u), point(positions, e.v)]); let count = 0;
    for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) if (distinct(edges[i], edges[j])) {
      const [a, b] = segments[i], [c, d] = segments[j];
      if (orient(a, b, c) * orient(a, b, d) < -1e-12 && orient(c, d, a) * orient(c, d, b) < -1e-12) count++;
    }
    return count;
  }
  function geometryDiagnostics(positions, edges) {
    const segments = edges.map(e => [point(positions, e.u), point(positions, e.v)]); let collinearOverlaps = 0, vertexContacts = 0;
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = segments[i];
      for (let j = i + 1; j < edges.length; j++) {
        const [c, d] = segments[j];
        if ([orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)].every(x => Math.abs(x) <= 1e-9)) {
          const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
          if (Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) > 1e-9) collinearOverlaps++;
        }
      }
      for (const [id, p] of Object.entries(positions)) if (Number(id) !== edges[i].u && Number(id) !== edges[i].v &&
        Math.abs(orient(a, b, p)) <= 1e-9 && (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= 1e-9) vertexContacts++;
    }
    return {collinearOverlaps, vertexContacts};
  }
  function lengthSquared(positions, edge) { const a = point(positions, edge.u), b = point(positions, edge.v); return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
  function longEdges(positions, edges, threshold) {
    if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError('The length cutoff must be finite and nonnegative.');
    return edges.filter(e => lengthSquared(positions, e) > threshold ** 2 + 1e-12).map(e => e.id);
  }
  function nativeEdges(host, positions, edges) {
    const coordinateIds = new Map(host.vertices.map(v => [`${v.x},${v.y}`, v.id]));
    const native = new Set(host.edges.map(e => key(e.u, e.v)));
    return edges.filter(e => {
      const a = coordinateIds.get(point(positions, e.u).join(',')), b = coordinateIds.get(point(positions, e.v).join(','));
      return a !== undefined && b !== undefined && native.has(key(a, b));
    }).map(e => e.id);
  }
  function edgeProfile(edges, checkOrder) {
    const counts = new Map(checkOrder.map(v => [v, 0]));
    for (const e of edges) { if (!counts.has(e.check)) throw new Error('An edge has no check in the inventory order.'); counts.set(e.check, counts.get(e.check) + 1); }
    const points = [[0, 0]]; let n = 0;
    checkOrder.forEach((v, i) => { n += counts.get(v); points.push([i + 1, n]); });
    return points;
  }
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function evaluate(raw) {
    try {
      const params = normalizeParams(raw), graph = buildGraph(params.graph), neighborhood = activeNeighborhood(graph, params.check_index);
      let positions = {}, host = null, sheets = [], displayedEdges = graph.edges, physicalLength = 'drawing pitch', cutoff = params.threshold;
      if (params.layout === 'planar-grid') positions = planarPositions(graph).positions;
      if (params.layout === 'heavy-hex') { host = heavyHexHost(graph.vertices.length); positions = placeOnHost(graph, host); }
      if (params.layout === 'reconfigurable') { positions = neighborhood.positions; displayedEdges = neighborhood.edges; cutoff = 1; }
      if (params.layout === 'thickness-2') {
        physicalLength = null;
        sheets = partitionLayers(graph).map(layer => {
          const components = prismComponents(layer), positions = Object.assign({}, ...components.map(c => planarLayerPositions(c).positions));
          return {...layer, components, positions, mode: 'certificate', physicalLength: null,
            crossings: strictCrossings(positions, layer.edges), ...geometryDiagnostics(positions, layer.edges)};
        });
      }
      const crossings = sheets.length ? sheets.reduce((n, s) => n + s.crossings, 0) : strictCrossings(positions, displayedEdges);
      const diagnostics = sheets.length ? sheets.reduce((d, s) => ({collinearOverlaps: d.collinearOverlaps + s.collinearOverlaps,
        vertexContacts: d.vertexContacts + s.vertexContacts}), {collinearOverlaps: 0, vertexContacts: 0}) : geometryDiagnostics(positions, displayedEdges);
      const longEdgeIds = physicalLength === null ? null : longEdges(positions, displayedEdges, cutoff);
      const nativeEdgeIds = host ? nativeEdges(host, positions, displayedEdges) : null;
      const maxLengthSquared = physicalLength === null ? null : Math.max(0, ...displayedEdges.map(e => lengthSquared(positions, e)));
      const scope = params.layout === 'reconfigurable' ? 'Active neighborhood only' : 'All required edges';
      const readouts = [
        {label: 'Scope', value: scope}, {label: 'Required incidence edges', value: graph.edges.length},
        {label: 'Displayed incidence edges', value: displayedEdges.length}, {label: 'Total degree', value: 6},
        {label: 'Long edges', value: longEdgeIds === null ? 'Not defined' : longEdgeIds.length},
        {label: 'Strict crossing pairs', value: crossings},
        {label: 'Collinear overlaps', value: diagnostics.collinearOverlaps}, {label: 'Edge-through-unrelated-vertex contacts', value: diagnostics.vertexContacts},
        {label: 'Maximum length', value: maxLengthSquared === null ? 'Not defined' : Math.sqrt(maxLengthSquared), units: physicalLength === null ? '' : 'drawing pitch units'}
      ];
      if (host) readouts.push({label: 'Required edges not native to this host placement', value: graph.edges.length - nativeEdgeIds.length}, {label: 'Host maximum degree', value: Math.max(...host.adjacency.map(a => a.length))});
      if (sheets.length) readouts.push({label: 'Per-layer degree', value: 3});
      if (params.layout === 'reconfigurable') readouts.push({label: 'Other required connections pending', value: neighborhood.pendingEdges.length});
      const preferred = params.metric === 'long' ? 'Long edges' : 'Strict crossing pairs';
      readouts.unshift({...readouts.find(r => r.label === preferred), label: `Selected metric: ${preferred}`});
      const warnings = [];
      if (diagnostics.collinearOverlaps) warnings.push(`${diagnostics.collinearOverlaps} pairs of segments overlap along a line.`);
      if (diagnostics.vertexContacts) warnings.push(`${diagnostics.vertexContacts} edge contacts with unrelated vertices occur in this drawing.`);
      return freeze({valid: true, params, graph, neighborhood, positions, host, sheets, displayedEdges, physicalLength, cutoff,
        crossings, ...diagnostics, longEdgeIds, nativeEdgeIds, maxLengthSquared, scope, readouts, warnings,
        edgePoints: edgeProfile(displayedEdges, graph.checkOrder)});
    } catch (error) {
      const message = `Model error: ${error instanceof Error ? error.message : String(error)}`;
      return freeze({valid: false, error: message, warnings: [message], readouts: [{label: 'Model error', value: message}], edgePoints: [[0, 0], [1, 0]]});
    }
  }
  return {normalizeParams, buildGraph, planarPositions, heavyHexHost, placeOnHost, partitionLayers, prismComponents,
    planarLayerPositions, activeNeighborhood, strictCrossings, geometryDiagnostics, longEdges, nativeEdges, edgeProfile, evaluate};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function element(doc, parent, tag, attrs = {}, text) {
    const node = doc.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }
  function drawing(svg, result, positions, edges, title, host = null) {
    const doc = svg.ownerDocument, vertices = result.graph.vertices.filter(v => positions[v.id]);
    const points = Object.values(positions), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const certificate = result.params.layout === 'thickness-2', width = certificate ? 840 : 600;
    const pitch = certificate ? 52 : Math.min(68, 510 / Math.max(1, xmax - xmin), 640 / Math.max(1, ymax - ymin));
    const height = Math.max(330, (ymax - ymin) * pitch + 110), left = (width - (xmax - xmin) * pitch) / 2;
    const xy = p => [left + (p[0] - xmin) * pitch, 55 + (p[1] - ymin) * pitch];
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%'); svg.style.minWidth = `${width}px`; svg.style.maxWidth = `${width}px`;
    svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', title);
    svg.setAttribute('data-required-edge-count', result.graph.edges.length);
    svg.setAttribute('data-displayed-edge-count', edges.length);
    element(doc, svg, 'title', {}, title);
    element(doc, svg, 'desc', {}, 'Squares are checks and circles are data. X edges are solid and Z edges dashed. Vertex and edge titles give persistent IDs. Complete support lists follow the drawing.');
    element(doc, svg, 'text', {x: 20, y: 24, fill: 'var(--text)', 'font-size': 15}, title);
    const selected = new Set(result.neighborhood.neighbors), native = new Set(result.nativeEdgeIds || []);
    const line = (p, q, attrs, parent = svg) => {
      const [x1, y1] = xy(p), [x2, y2] = xy(q);
      return element(doc, parent, 'line', {x1, y1, x2, y2, ...attrs});
    };
    if (host) {
      const hostGroup = element(doc, svg, 'g', {'aria-label': 'Muted host edges', 'data-host': 'heavy-hex'});
      for (const e of host.edges) {
        const a = host.vertices[e.u], b = host.vertices[e.v];
        if ([a, b].every(v => v.x >= xmin - 0.5 && v.x <= xmax + 0.5 && v.y >= ymin - 0.5 && v.y <= ymax + 0.5))
          line([a.x, a.y], [b.x, b.y], {stroke: 'var(--muted)', opacity: 0.45, 'stroke-width': 2}, hostGroup);
      }
    }
    const incidence = element(doc, svg, 'g', {'data-incidence-edges': edges.length});
    // Background first, selected neighborhood last. Every required edge keeps its own SVG element.
    const ordered = [...edges].sort((a, b) => Number(a.check === result.params.check_index) - Number(b.check === result.params.check_index));
    for (const e of ordered) {
      const active = e.check === result.params.check_index, nonnative = host && !native.has(e.id);
      const color = active ? 'var(--plot-accent)' : nonnative ? 'var(--plot-warning)' : e.type === 'X' ? 'var(--plot-primary)' : 'var(--plot-secondary)';
      const n = line(positions[e.u], positions[e.v], {stroke: color, 'stroke-width': active ? 2.8 : certificate ? 1.4 : 1,
        opacity: active ? 1 : certificate ? 0.8 : nonnative ? 0.24 : 0.13,
        'stroke-dasharray': e.type === 'Z' ? '5 3' : 'none', 'data-edge-id': e.id,
        'data-u': e.u, 'data-v': e.v, 'data-term': e.term, 'data-layer': e.layer,
        'data-native': host ? String(native.has(e.id)) : 'not applicable'}, incidence);
      element(doc, n, 'title', {}, `${e.id}: ${result.graph.vertices[e.u].label} to ${result.graph.vertices[e.v].label}; layer ${e.layer}${host ? native.has(e.id) ? '; native host edge' : '; required nonnative edge' : ''}`);
    }
    for (const v of vertices) {
      const [x, y] = xy(positions[v.id]), isCheck = v.register === 'X' || v.register === 'Z';
      const active = v.id === result.params.check_index || selected.has(v.id), radius = active ? 6 : 3.4;
      const attrs = {'data-vertex-id': v.id};
      if (v.register === 'X') Object.assign(attrs, {'data-check': v.index, role: 'button', tabindex: 0,
        'aria-pressed': String(v.id === result.params.check_index), 'aria-label': `Select ${v.label}, vertex ${v.id}`});
      const g = element(doc, svg, 'g', attrs), stroke = active ? 'var(--plot-accent)' : 'var(--text)';
      if (isCheck) element(doc, g, 'rect', {x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius,
        fill: v.register === 'X' ? (active ? 'var(--plot-accent)' : 'var(--plot-primary)') : 'var(--bg)', stroke, 'stroke-width': 1.4});
      else element(doc, g, 'circle', {cx: x, cy: y, r: radius, fill: 'var(--bg)', stroke, 'stroke-width': active ? 2.3 : 1.2});
      element(doc, g, 'title', {}, `${v.id}: ${v.label}`);
      if (result.params.layout === 'reconfigurable') element(doc, g, 'text', {x: x + 9, y: y - 10, fill: 'var(--text)', 'font-size': 13}, `${v.id}: ${v.label}`);
    }
    element(doc, svg, 'text', {x: 20, y: height - 20, fill: 'var(--text)', 'font-size': 13}, 'X solid / Z dashed · squares: checks · circles: data');
  }
  StudyLab.register('connectivity-mapper', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const holder = doc.createElement('div');
    holder.style.overflowX = 'auto'; holder.setAttribute('tabindex', '0');
    holder.setAttribute('aria-label', 'Connection maps; scroll horizontally on narrow screens');
    layout.plots.appendChild(holder);
    const support = doc.createElement('div'); support.setAttribute('data-support-lists', ''); layout.notes.appendChild(support);
    const chart = ctx.plot(layout.plots, {title: 'Displayed incidence edges (all checks)',
      x: {label: 'Check vertices included, t', domain: 'auto'},
      y: {label: 'Displayed incidence edges c(t)', domain: 'auto'}, legend: true});
    let normalizing = false;
    function setChart(scope) {
      const title = `Displayed incidence edges (${scope})`;
      chart.svg.setAttribute('aria-label', title);
      const figure = chart.svg.parentNode;
      figure.setAttribute('aria-label', title);
      figure.querySelector('figcaption').textContent = title;
    }
    function paragraph(text, parent = support) { const p = doc.createElement('p'); p.textContent = text; parent.appendChild(p); return p; }
    function details(title, text) {
      const d = doc.createElement('details'), s = doc.createElement('summary'); s.textContent = title;
      d.appendChild(s); paragraph(text, d); support.appendChild(d);
    }
    function draw() {
      if (normalizing) return;
      const raw = ctx.state.all(), result = ctx.model.evaluate(raw);
      holder.replaceChildren(); support.replaceChildren();
      setChart(result.valid && result.params.layout === 'reconfigurable' ? 'active neighborhood' : 'all checks');
      chart.update([{id: 'edge-count', label: 'Displayed incidence edges', role: 'primary', kind: 'line', points: result.edgePoints}]);
      ctx.readouts(layout.readouts, result.readouts);
      ctx.warn(layout.readouts, result.warnings.join(' ') || null);
      if (!result.valid) {
        const svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 600 100'); svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', result.error); holder.appendChild(svg);
        element(doc, svg, 'text', {x: 15, y: 45, fill: 'var(--text)', 'font-size': 14}, result.error);
        paragraph(result.error); return;
      }
      // Persist normalized coupled indices through the SDK, without recursive redraws.
      normalizing = true;
      try { for (const [id, value] of Object.entries(result.params)) if (raw[id] !== value) ctx.state.set(id, value); }
      finally { normalizing = false; }
      const g = result.graph, label = id => `${id}: ${g.vertices[id].label}`;
      if (result.sheets.length) {
        for (const sheet of result.sheets) {
          const svg = doc.createElementNS(NS, 'svg'); svg.id = `${ctx.id}-layer-${sheet.id}`;
          svg.setAttribute('data-layer-sheet', sheet.id); holder.appendChild(svg);
          drawing(svg, result, sheet.positions, sheet.edges, `Layer ${sheet.id}: ${sheet.edges.length} edges, degree 3, independent coordinates`);
        }
        paragraph('Separate planar layer drawings. Total degree 6; per-layer degree 3. Physical lengths are not defined across these independent coordinates.');
        for (const sheet of result.sheets) for (const c of sheet.components) details(
          `Layer ${sheet.id}, component ${c.tile + 1}: ${c.vertices.length} vertex IDs`,
          `Outer cycle: ${c.cycles[0].map(label).join('; ')}. Inner cycle in matching order: ${c.cycles[1].map(label).join('; ')}.`);
      } else {
        const svg = doc.createElementNS(NS, 'svg'); svg.id = `${ctx.id}-placement`; holder.appendChild(svg);
        drawing(svg, result, result.positions, result.displayedEdges,
          result.params.layout === 'reconfigurable' ? 'Active neighborhood only: six required edges' : `${result.params.layout}: all ${g.edges.length} required edges`, result.host);
        if (result.params.layout === 'reconfigurable') {
          paragraph(`Other required connections pending: ${result.neighborhood.pendingEdges.length}. The six active edges have unit length; the cutoff is one.`);
          details('Pending vertex IDs', result.neighborhood.pendingVertices.map(label).join('; '));
          details('Pending required connection IDs', result.neighborhood.pendingEdges.join(', '));
        } else paragraph('Fixed placement, not optimized');
        if (result.host) paragraph('Required edges not native to this host placement are highlighted. Host edges are muted. Moving a label does not give a degree-three host the six neighbors required by a check.');
        details('All displayed vertex IDs and coordinates', Object.entries(result.positions).map(([id, p]) => `${label(Number(id))} at (${p.map(x => Number(x.toFixed(4))).join(', ')})`).join('; '));
      }
      paragraph(`Selected X check ${label(result.neighborhood.check)}. Six data neighbors: ${result.neighborhood.neighbors.map(label).join('; ')}.`);
      paragraph(`Selected incidence edges: ${result.neighborhood.edges.map(e => `${e.term} to ${label(e.data)}`).join('; ')}.`);
      paragraph(`${result.scope}. The line includes all X checks, then all Z checks. Its axes count checks and displayed incidence edges, not time.`);
      paragraph('Strict crossings exclude shared endpoints, tangencies and collinear overlap. Overlaps and unrelated-vertex contacts have separate readouts.');
    }
    function select(event) {
      const target = event.target.closest('[data-check]');
      if (!target || !holder.contains(target) || event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); const index = Number(target.getAttribute('data-check'));
      ctx.state.set('check_index', index);
      holder.querySelector(`[data-check="${index}"]`)?.focus();
    }
    holder.addEventListener('click', select); holder.addEventListener('keydown', select);
    draw();
    const unsubscribe = ctx.state.onChange(draw);
    return {destroy() {
      unsubscribe(); holder.removeEventListener('click', select); holder.removeEventListener('keydown', select);
      chart.destroy?.(); chart.svg.parentNode.remove(); holder.remove(); support.remove();
    }};
  });
})();

}).call(window);
