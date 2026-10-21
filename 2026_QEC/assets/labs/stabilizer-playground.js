/* stabilizer-playground: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['stabilizer-playground'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const popcount = v => { let n = 0; for (; v; v &= v - 1) n++; return n; };
  function fromWord(word) {
    if (!/^[IXYZ]{1,9}$/.test(word)) throw new RangeError('Use one to nine Pauli letters.');
    let x = 0, z = 0;
    [...word].forEach((p, q) => { if ('XY'.includes(p)) x |= 1 << q; if ('ZY'.includes(p)) z |= 1 << q; });
    return x | (z << word.length);
  }
  const wordOf = (v, n) => Array.from({ length: n }, (_, q) => ['I', 'X', 'Z', 'Y'][((v >> q) & 1) + 2 * ((v >> (n + q)) & 1)]).join('');
  const weight = (v, n) => popcount((v | (v >> n)) & ((1 << n) - 1));
  const symplectic = (a, b, n) => popcount(((a & (b >> n)) ^ (b & (a >> n))) & ((1 << n) - 1)) % 2;
  function rank(rows) {
    const pivots = [];
    for (let v of rows) for (let bit = 30; bit >= 0; bit--) if (v & (1 << bit)) {
      if (pivots[bit]) v ^= pivots[bit]; else { pivots[bit] = v; break; }
    }
    return pivots.filter(Boolean).length;
  }
  const codeIds = ['bit-flip', 'phase-flip', 'four-two-two', 'five-qubit', 'steane', 'shor', 'toric-l2'];
  function code(id) {
    let generators, logicals, restricted = null, geometry = '';
    switch (id) {
      case 'bit-flip': generators = ['ZZI', 'IZZ']; logicals = [['XXX', 'ZII']]; restricted = 'X'; break;
      case 'phase-flip': generators = ['XXI', 'IXX']; logicals = [['ZZZ', 'XII']]; restricted = 'Z'; break;
      case 'four-two-two': generators = ['XXXX', 'ZZZZ']; logicals = [['XXII', 'ZIZI'], ['XIXI', 'ZZII']]; break;
      case 'five-qubit': generators = ['XZZXI', 'IXZZX', 'XIXZZ', 'ZXIXZ']; logicals = [['XXXXX', 'ZZZZZ']]; break;
      case 'steane': generators = ['XIXIXIX', 'IXXIIXX', 'IIIXXXX', 'ZIZIZIZ', 'IZZIIZZ', 'IIIZZZZ']; logicals = [['XXXXXXX', 'ZZZZZZZ']]; break;
      case 'shor': generators = ['ZZIIIIIII', 'IZZIIIIII', 'IIIZZIIII', 'IIIIZZIII', 'IIIIIIZZI', 'IIIIIIIZZ', 'XXXXXXIII', 'IIIXXXXXX']; logicals = [['ZIIZIIZII', 'XXXIIIIII']]; break;
      case 'toric-l2': {
        // Distinct parallel edges are retained on the L=2 periodic lattice.
        const h = (x, y) => 2 * ((y + 2) % 2) + ((x + 2) % 2);
        const v = (x, y) => 4 + h(x, y);
        const check = (letter, edges) => Array.from({ length: 8 }, (_, q) => edges.includes(q) ? letter : 'I').join('');
        generators = [];
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) generators.push(check('X', [h(x, y), h(x - 1, y), v(x, y), v(x, y - 1)]));
        for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) generators.push(check('Z', [h(x, y), v(x + 1, y), h(x, y + 1), v(x, y)]));
        logicals = [['XIXIIIII', 'ZZIIIIII'], ['IIIIXXII', 'IIIIZIZI']];
        geometry = 'Periodic 2 by 2 lattice. Qubits 1..4 are horizontal edges h(x,y), row-major in (y,x); 5..8 are vertical edges v(x,y). Checks g1..g4 are X stars, g5..g8 Z plaquettes in the same row-major order. Qubits 1 and 3 form a non-contractible dual X loop.';
        break;
      }
      default: throw new RangeError('Select a listed code.');
    }
    const n = generators[0].length;
    return { id, n, generators, rows: generators.map(fromWord), logicals, restricted, geometry };
  }
  function syndrome(v, c) { return c.rows.map(g => symplectic(v, g, c.n)); }
  const syndromeKey = (v, c) => c.rows.reduce((s, g, i) => s | (symplectic(v, g, c.n) << i), 0);
  function span(rows) {
    const result = new Set([0]);
    for (const row of rows) for (const v of [...result]) result.add(v ^ row);
    return result;
  }
  const cache = new Map();
  function analyzeInternal(id) {
    if (cache.has(id)) return cache.get(id);
    const c = code(id), stabilizers = span(c.rows), r = rank(c.rows), k = c.n - r;
    const decoder = new Map(), decoderWeight = new Map(), total = 4 ** c.n;
    let distance = c.n + 1, restrictedDistance = c.n + 1, witness = 0, normalizerCount = 0;
    // Complete finite search. Increasing packed (x | z) integer fixes every minimum-weight tie.
    for (let v = 0; v < total; v++) {
      const w = weight(v, c.n), s = syndromeKey(v, c);
      if (!decoder.has(s) || w < decoderWeight.get(s)) { decoder.set(s, v); decoderWeight.set(s, w); }
      if (s === 0) {
        normalizerCount++;
        if (!stabilizers.has(v)) {
          if (w < distance) { distance = w; witness = v; }
          const mask = (1 << c.n) - 1;
          if ((c.restricted === 'X' && (v >> c.n) === 0) || (c.restricted === 'Z' && (v & mask) === 0)) restrictedDistance = Math.min(restrictedDistance, w);
        }
      }
    }
    const fractions = [1, 2, 3].map(w => ({ weight: w, corrected: 0, total: 0 }));
    for (let v = 1; v < total; v++) {
      const w = weight(v, c.n);
      if (w > 3) continue;
      const row = fractions[w - 1]; row.total++;
      if (stabilizers.has(v ^ decoder.get(syndromeKey(v, c)))) row.corrected++;
    }
    for (const row of fractions) row.fraction = row.corrected / row.total;
    const result = { ...c, rank: r, k, distance, restrictedDistance: c.restricted ? restrictedDistance : null,
      distanceWitness: wordOf(witness, c.n), enumerationSize: total, normalizerCount, stabilizerSize: stabilizers.size,
      decoder, stabilizers, fractions };
    cache.set(id, result); return result;
  }
  function analyze(id) {
    const a = analyzeInternal(id);
    return { id, n: a.n, k: a.k, rank: a.rank, distance: a.distance, restrictedDistance: a.restrictedDistance,
      restricted: a.restricted, generators: a.generators.slice(), logicals: a.logicals.map(p => p.slice()), geometry: a.geometry,
      distanceWitness: a.distanceWitness, enumerationSize: a.enumerationSize, normalizerCount: a.normalizerCount,
      stabilizerSize: a.stabilizerSize, fractions: a.fractions.map(row => ({ ...row })) };
  }
  function classify(v, c) {
    if (syndromeKey(v, c) !== 0) return { kind: 'detectable', logical: null };
    if (c.stabilizers.has(v)) return { kind: 'stabilizer', logical: 'I' };
    const logical = c.logicals.map(([x, z], i) => {
      const a = symplectic(v, fromWord(z), c.n), b = symplectic(v, fromWord(x), c.n);
      return a || b ? `${['I', 'X', 'Z', 'Y'][a + 2 * b]}bar${i + 1}` : '';
    }).filter(Boolean).join(' ');
    return { kind: 'logical', logical };
  }
  function decode(id, word) {
    const c = analyzeInternal(id);
    if (word.length !== c.n) throw new RangeError('Error width must match the code.');
    const v = fromWord(word), key = syndromeKey(v, c), correction = c.decoder.get(key), residual = v ^ correction;
    return { error: word, syndrome: syndrome(v, c), correction: wordOf(correction, c.n), residual: wordOf(residual, c.n),
      errorClass: classify(v, c), netClass: classify(residual, c), success: c.stabilizers.has(residual) };
  }
  function randomError(n, p, seed) {
    let state = seed >>> 0;
    const random = () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return Array.from({ length: n }, () => { const u = random(); return u < 1 - p ? 'I' : ['X', 'Y', 'Z'][Math.min(2, Math.floor((u - (1 - p)) * 3 / p))]; }).join('');
  }
  function compute(params = {}) {
    const p = { code: 'steane', error_mode: 'single', qubit: 1, pauli: 'X', qubit2: 2, pauli2: 'Z', p: 0.05, seed: 7, ...params }, warnings = [];
    if (!codeIds.includes(p.code)) warnings.push('Select a listed code.');
    if (!['single', 'pair', 'random'].includes(p.error_mode)) warnings.push('Select single, pair, or random error mode.');
    for (const key of ['qubit', 'qubit2']) if (!Number.isInteger(p[key]) || p[key] < 1 || p[key] > 9) warnings.push(`${key} must be an integer from 1 to 9.`);
    for (const key of ['pauli', 'pauli2']) if (!['X', 'Y', 'Z'].includes(p[key])) warnings.push(`${key} must be X, Y, or Z.`);
    if (!Number.isFinite(p.p) || p.p < 0.001 || p.p > 0.5) warnings.push('p must be finite, from 0.001 to 0.5.');
    if (!Number.isInteger(p.seed) || p.seed < 1 || p.seed > 99) warnings.push('Seed must be an integer from 1 to 99.');
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };
    const a = analyze(p.code), qubit = Math.min(p.qubit, a.n), qubit2 = Math.min(p.qubit2, a.n);
    const single = (q, letter) => 'I'.repeat(q - 1) + letter + 'I'.repeat(a.n - q);
    const first = single(qubit, p.pauli), second = single(qubit2, p.pauli2);
    // Errors compose up to overall phase; that phase cannot change syndrome or recovery success.
    const error = p.error_mode === 'random' ? randomError(a.n, p.p, p.seed)
      : p.error_mode === 'single' ? first : wordOf(fromWord(first) ^ fromWord(second), a.n);
    const decoded = decode(p.code, error);
    return { valid: true, params: p, warnings, analysis: a, qubit, qubit2, ...decoded,
      pairComparison: p.error_mode === 'pair' ? [decode(p.code, first), decode(p.code, second)] : [],
      series: { syndrome: decoded.syndrome.map((s, i) => [i + 1, 0, i + 1, s]), correctable: a.fractions.map(row => [row.weight, row.fraction]) } };
  }
  return { compute, code, codeIds, analyze, decode, fromWord, wordOf, weight, symplectic, syndrome, rank, randomError };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('stabilizer-playground', function mount(root, ctx) {
    const layout = ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const syndrome = ctx.plot(layout.plots, {
      title: 'Computed syndrome by generator',
      x: { label: 'Generator index (g1, g2, ...; table below)', domain: [0.5, 8.5] },
      y: { label: 'Syndrome bit: 0 is +1; 1 is -1', domain: [-0.08, 1.15] }, legend: true
    });
    const correctable = ctx.plot(layout.plots, {
      title: 'Computed recovery success at fixed Pauli weight',
      x: { label: 'Pauli weight w (all X, Y, Z patterns)', domain: [0.8, 3.2] },
      y: { label: 'Corrected fraction conditional on w', domain: [0, 1.05] }, legend: true
    });
    const classText = c => c.kind === 'stabilizer' ? 'Stabilizer: success' : c.kind === 'logical' ? `Logical ${c.logical}: failure` : 'Detectable';
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
      if (!r.valid) { syndrome.update([]); correctable.update([]); ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return; }
      const a = r.analysis;
      syndrome.update([
        { id: 'syndrome-stems', label: 'Computed anticommutation bits', role: 'primary', kind: 'arrows', head: 0, width: 3, points: r.series.syndrome },
        { id: 'syndrome-bits', label: 'Generator samples (including zeros)', role: 'accent', kind: 'scatter', points: r.syndrome.map((s, i) => [i + 1, s]) }
      ], r.syndrome.map((s, i) => ({ type: 'label', x: i + 1, y: s + 0.08, text: `g${i + 1}`, role: 'primary' })));
      correctable.update([
        { id: 'success-line', label: 'Exact enumerated fraction', role: 'secondary', kind: 'line', dash: '6 3', points: r.series.correctable },
        { id: 'success-weights', label: 'Integer weights', role: 'accent', kind: 'scatter', points: r.series.correctable }
      ]);
      const items = [
        { label: 'Computed data qubits n', value: a.n },
        { label: 'Computed independent checks (GF(2) rank)', value: a.rank },
        { label: 'Computed logical qubits k', value: a.k },
        { label: 'Computed distance d (all Pauli errors)', value: a.distance },
        { label: 'Computed minimum-weight logical witness', value: a.distanceWitness },
        { label: 'Computed distance search (binary vectors examined)', value: a.enumerationSize, format: 'fixed', digits: 0 },
        { label: 'Computed commuting vectors', value: a.normalizerCount, format: 'fixed', digits: 0 },
        { label: 'Computed current error (up to phase)', value: r.error },
        { label: 'Computed syndrome in generator order', value: r.syndrome.join('') },
        { label: 'Computed input class', value: r.errorClass.kind === 'detectable' ? 'Detectable' : r.errorClass.kind === 'stabilizer' ? 'Stabilizer' : `Logical ${r.errorClass.logical}` },
        { label: 'Computed lookup correction', value: r.correction },
        { label: 'Computed residual operator', value: r.residual },
        { label: 'Computed net operator class', value: classText(r.netClass) },
        { label: 'Computed weight-2 correction fraction (exact count)', value: `${a.fractions[1].corrected}/${a.fractions[1].total}` }
      ];
      if (a.restricted) items.splice(4, 0, { label: `Computed distance against ${a.restricted} errors only`, value: a.restrictedDistance });
      if (r.params.error_mode !== 'random') items.push({ label: 'Computed effective error locations', value: r.params.error_mode === 'pair' ? `${r.qubit}, ${r.qubit2}` : String(r.qubit) });
      ctx.readouts(layout.readouts, items);
      let notes = '<p><strong>Inspect, then change:</strong> Compare a Steane single error with the Shor degenerate pair. In pair mode, compare the two individual syndromes with the product syndrome. Try to create zero syndrome with a logical residual, then explain why a zero record is not proof of no error.</p>';
      if (a.restricted) notes += `<p>This repetition code has distance ${a.restrictedDistance} against ${a.restricted} errors only and distance ${a.distance} against general errors. The fraction panel includes all three Pauli types.</p>`;
      if (a.id === 'four-two-two') notes += '<p>Every weight-one error is detected. The code cannot correct the complete single-error set: the fixed decoder succeeds on 3 of 12 single Paulis, and the others leave a logical operator. Detection is a statement about the input syndrome, not guaranteed recovery.</p>';
      if (a.geometry) notes += `<p>${a.geometry}</p>`;
      notes += '<table><caption>Computed syndromes for the declared positive generators</caption><thead><tr><th>Generator</th><th>Pauli word</th><th>Bit</th><th>Eigenvalue after error</th></tr></thead><tbody>' + a.generators.map((g, i) => `<tr><td>g${i + 1}</td><td>${g}</td><td>${r.syndrome[i]}</td><td>${r.syndrome[i] ? '-1' : '+1'}</td></tr>`).join('') + '</tbody></table>';
      notes += '<table><caption>Logical basis used for residual labels (up to phase and stabilizers)</caption><thead><tr><th>Logical qubit</th><th>Xbar</th><th>Zbar</th></tr></thead><tbody>' + a.logicals.map(([x, z], i) => `<tr><td>${i + 1}</td><td>${x}</td><td>${z}</td></tr>`).join('') + '</tbody></table>';
      if (r.pairComparison.length) notes += '<table><caption>Computed individual errors before composing the pair</caption><thead><tr><th>Error</th><th>Syndrome</th><th>Correction</th><th>Net class</th></tr></thead><tbody>' + r.pairComparison.map(row => `<tr><td>${row.error}</td><td>${row.syndrome.join('')}</td><td>${row.correction}</td><td>${classText(row.netClass)}</td></tr>`).join('') + '</tbody></table>';
      notes += '<table><caption>Computed exact correction counts; all Pauli patterns at each weight</caption><thead><tr><th>Weight</th><th>Corrected</th><th>Total</th></tr></thead><tbody>' + a.fractions.map(row => `<tr><td>${row.weight}</td><td>${row.corrected}</td><td>${row.total}</td></tr>`).join('') + '</tbody></table>';
      notes += `<p>The distance search examines all ${a.enumerationSize} binary vectors; ${a.normalizerCount} commute with every check and ${a.stabilizerSize} are stabilizers up to phase. Recovery uses the same fixed minimum-weight table for every current error. Its residual always has zero syndrome; the displayed logical basis distinguishes harmless from harmful zero-syndrome operators.</p>`;
      ctx.notes(layout.notes, notes);
    }
    const unsubscribe = ctx.state.onChange(draw), unsubscribeTheme = ctx.onThemeChange(draw);
    draw();
    return { destroy() { unsubscribe(); unsubscribeTheme(); } };
  });
})();

}).call(window);
