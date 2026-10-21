/* repetition-memory: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['repetition-memory'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function check(d, p) {
    if (!Number.isInteger(d) || d < 1 || d > 10001 || d % 2 !== 1) throw new RangeError('Distance must be odd, from 1 to 10001.');
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('Probability must be finite and in [0,1].');
  }
  function logChoose(n, k) {
    let result = 0;
    for (let j = 1; j <= Math.min(k, n - k); j++) result += Math.log(n - j + 1) - Math.log(j);
    return result;
  }
  // Sum positive tail terms with log-sum-exp. Never subtract a near-one CDF.
  function logLogicalError(d, p) {
    check(d, p);
    if (p === 0) return -Infinity;
    if (p === 1) return 0;
    if (p === 0.5) return -Math.LN2;
    if (d === 1) return Math.log(p);
    const k = (d + 1) / 2, lp = Math.log(p), lq = Math.log1p(-p);
    let term = logChoose(d, k) + k * lp + (d - k) * lq;
    const terms = [term];
    for (let j = k; j < d; j++) {
      term += Math.log(d - j) - Math.log(j + 1) + lp - lq;
      terms.push(term);
    }
    const peak = Math.max(...terms);
    return Math.min(0, peak + Math.log(terms.reduce((sum, x) => sum + Math.exp(x - peak), 0)));
  }
  function logicalError(d, p) {
    check(d, p);
    if (d === 1 || p === 0 || p === 1 || p === 0.5) return p;
    return Math.exp(logLogicalError(d, p));
  }
  function leadingTerm(d, p) {
    check(d, p);
    return p === 0 ? 0 : Math.exp(logChoose(d, (d + 1) / 2) + (d + 1) / 2 * Math.log(p));
  }
  function lambda(d, p) {
    check(d, p);
    if (d > 9999 || p === 0) throw new RangeError('Lambda requires d <= 9999 and p > 0.');
    return Math.exp(logLogicalError(d, p) - logLogicalError(d + 2, p));
  }
  function withFloor(probability, floor) {
    for (const x of [probability, floor]) if (!Number.isFinite(x) || x < 0 || x > 1) throw new RangeError('Floor and probability must be in [0,1].');
    // Algebraically 1-(1-p)(1-f), without catastrophic cancellation for tiny p,f.
    return probability + (1 - probability) * floor;
  }
  function mulberry32(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function simulate({ d, p, n_trials, seed }) {
    check(d, p);
    if (!Number.isInteger(n_trials) || n_trials < 1 || n_trials > 1000000) throw new RangeError('Trials must be an integer from 1 to 1000000.');
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new RangeError('Seed must be an unsigned 32-bit integer.');
    const random = mulberry32(seed);
    let failures = 0;
    for (let trial = 0; trial < n_trials; trial++) {
      let flips = 0;
      for (let bit = 0; bit < d; bit++) flips += random() < p ? 1 : 0;
      if (flips > d / 2) failures++;
    }
    const estimate = failures / n_trials;
    return { d, failures, trials: n_trials, seed, estimate, standardError: Math.sqrt(estimate * (1 - estimate) / n_trials) };
  }
  const displayLog = value => Math.max(-16, Math.log10(value));
  function compute(params = {}) {
    const p = { d: 3, p: 0.01, floor_on: false, floor: 1e-6, n_trials: 10000, seed: 7, ...params };
    const warnings = [];
    if (!Number.isInteger(p.d) || p.d < 1 || p.d > 15 || p.d % 2 !== 1) warnings.push('Distance d must be odd, from 1 to 15.');
    if (!Number.isFinite(p.p) || p.p < 1e-4 || p.p > 0.9) warnings.push('p must be a finite number from 0.0001 to 0.9.');
    if (typeof p.floor_on !== 'boolean') warnings.push('floor_on must be boolean.');
    if (!Number.isFinite(p.floor) || p.floor < 1e-12 || p.floor > 1e-2) warnings.push('The floor must be a finite probability from 1e-12 to 0.01.');
    if (![1000, 10000, 100000].includes(p.n_trials)) warnings.push('Select 1000, 10000, or 100000 trials.');
    if (!Number.isInteger(p.seed) || p.seed < 1 || p.seed > 99) warnings.push('Seed must be an integer from 1 to 99.');
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };

    const exact = logicalError(p.d, p.p), leading = leadingTerm(p.d, p.p);
    const distances = Array.from({ length: 8 }, (_, i) => 2 * i + 1);
    const ladder = distances.map(d => ({ d, exact: logicalError(d, p.p), total: withFloor(logicalError(d, p.p), p.floor_on ? p.floor : 0) }));
    const monteCarlo = distances.filter(d => Math.abs(d - p.d) <= 2).map(d => simulate({ d, p: p.p, n_trials: p.n_trials, seed: (p.seed + Math.imul(d, 0x9E3779B9)) >>> 0 }));
    const current = monteCarlo.find(mc => mc.d === p.d);
    for (const mc of monteCarlo) if (mc.failures < 10) warnings.push(`d=${mc.d}: only ${mc.failures}/${mc.trials} Monte Carlo failures. Fewer than 10 failures cannot resolve a rare-event rate; zero failures and zero plug-in standard error do not establish zero error probability.`);
    if (exact < 1e-16) warnings.push('The operating point is below the display limit; its marker is clipped to log10 probability = -16. The exact readout is not clipped.');
    const xs = [...Array.from({ length: 201 }, (_, i) => -4 + i / 50), Math.log10(0.5)].sort((a, b) => a - b);
    return {
      valid: true, params: p, warnings, ladder, monteCarlo,
      operatingPoint: { x: Math.log10(p.p), y: displayLog(exact), clipped: exact < 1e-16 },
      series: {
        curves: [1, 3, 5, 7, 9, 11].map(d => ({ d, points: xs.map(x => [x, displayLog(logicalError(d, 10 ** x))]) })),
        identity: [[-4, -4], [0, 0]],
        ladder: ladder.map(row => [row.d, displayLog(row.exact)]),
        total: ladder.map(row => [row.d, displayLog(row.total)]),
        monteCarlo: monteCarlo.map(mc => [mc.d, displayLog(mc.estimate)])
      },
      readouts: { exact, leading, lambda: lambda(p.d, p.p), smallPLargeD: 1 / (4 * p.p),
        total: withFloor(exact, p.floor_on ? p.floor : 0),
        lambdaWithFloor: withFloor(exact, p.floor_on ? p.floor : 0) / withFloor(logicalError(p.d + 2, p.p), p.floor_on ? p.floor : 0),
        monteCarlo: current },
      display: { log10Floor: -16 }
    };
  }
  return { logLogicalError, logicalError, leadingTerm, lambda, withFloor, simulate, compute };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('repetition-memory', function mount(root, ctx) {
    const layout = ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const curves = ctx.plot(layout.plots, {
      title: 'Exact majority-vote error per round',
      x: { label: 'log10 p per qubit per round (linear axis)', domain: [-4, 0] },
      y: { label: 'log10 logical error per round (linear axis)', domain: [-16, 0] }, legend: true
    });
    const ladder = ctx.plot(layout.plots, {
      title: 'Distance ladder at the selected physical error probability',
      x: { label: 'Distance d against bit flips (odd physical-bit count)', domain: [1, 15] },
      y: { label: 'log10 logical error per round (linear axis)', domain: [-16, 0] }, legend: true
    });
    const roles = ['reference', 'primary', 'secondary', 'tertiary', 'input', 'bound'];
    const dashes = ['2 3', '', '6 3', '9 3 2 3', '3 3', '12 4'];
    function draw() {
      const result = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, result.warnings.join(' ') || null);
      if (!result.valid) {
        curves.update([]); ladder.update([]);
        ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return;
      }
      const { params: p, readouts: r, series: s, operatingPoint: op } = result;
      curves.update([
        ...s.curves.map((c, i) => ({ id: `distance-${c.d}`, label: `Exact d=${c.d}`, role: roles[i], dash: dashes[i], kind: 'line', points: c.points, width: c.d === p.d ? 2.8 : 1.5 })),
        { id: 'identity', label: 'pL = p (coincides with d=1)', role: 'reference', kind: 'line', dash: '1 5', points: s.identity }
      ], [
        { type: 'vline', x: Math.log10(0.5), role: 'reference', label: 'p = 1/2' },
        { type: 'point', x: op.x, y: op.y, role: 'accent' },
        { type: 'label', x: Math.min(op.x, -1.4), y: Math.max(-14.5, op.y + 0.8), role: 'accent', text: `Selected d=${p.d}${op.clipped ? ' (clipped)' : ''}` }
      ]);
      const ladderSeries = [
        { id: 'ladder-exact', label: 'Exact majority vote', role: 'primary', kind: 'line', points: s.ladder, dash: '' },
        { id: 'ladder-mc', label: 'Monte Carlo (zero counts at -16)', role: 'accent', kind: 'scatter', points: s.monteCarlo }
      ];
      if (p.floor_on) ladderSeries.push(
        { id: 'floor', label: 'Independent floor', role: 'bound', kind: 'line', dash: '2 4', points: [[1, Math.log10(p.floor)], [15, Math.log10(p.floor)]] },
        { id: 'total', label: 'Total with floor', role: 'secondary', kind: 'line', dash: '7 3', points: s.total }
      );
      ladder.update(ladderSeries, [{ type: 'point', x: p.d, y: op.y, role: 'primary', label: 'Exact operating point' }]);
      const items = [
        { label: `Computed exact pL(${p.d}) per round`, tex: 'p_L(d,p)', value: r.exact, format: 'exp', digits: 5 },
        { label: 'Small-p leading term', value: r.leading, format: 'exp', digits: 5 },
        { label: `Exact Λ (${p.d} → ${p.d + 2}), no floor`, value: r.lambda, format: 'sig', digits: 6 },
        { label: 'Small-p, large-d reference 1/(4p)', value: r.smallPLargeD, format: 'sig', digits: 6 }
      ];
      for (const mc of result.monteCarlo) items.push(
        { label: `Monte Carlo d=${mc.d} (${mc.failures}/${mc.trials} failures)`, value: mc.estimate, format: 'exp', digits: 4 },
        { label: `Binomial standard error, d=${mc.d}`, value: mc.standardError, format: 'exp', digits: 3 }
      );
      if (p.floor_on) items.push(
        { label: 'Computed total per round', value: r.total, format: 'exp', digits: 5 },
        { label: `Λ with floor (${p.d} → ${p.d + 2})`, value: r.lambdaWithFloor, format: 'sig', digits: 6 }
      );
      ctx.readouts(layout.readouts, items);
      const trend = p.p < 0.5 ? 'Below threshold, exact Λ is greater than 1: increasing distance suppresses majority-vote failure.'
        : p.p > 0.5 ? 'Above threshold, exact Λ is less than 1: increasing distance makes this fixed majority decoder worse.'
          : 'At p = 1/2, every distance has error 1/2 and exact Λ = 1.';
      ctx.notes(layout.notes,
        '<p><strong>Predict, then compare:</strong> Use One percent, compare the exact Λ with 1/(4p), then try Above threshold and With floor. Explain why the ladder changes slope.</p>' +
        `<p>${trend} The leading term and 1/(4p) are small-p approximations, not threshold estimators.</p>` +
        '<p>All plotted values and readouts are computed. The second panel samples only odd distances. Monte Carlo tests majority vote without the floor, using a separate deterministic stream for each distance. Standard errors are plug-in binomial estimates, not confidence bounds.</p>' +
        '<p>Both vertical axes show log10 probabilities on linear scales. Values below 10⁻¹⁶, including zero Monte Carlo counts, sit at -16 for display only; a flat segment there is not a physical error floor. At d=15 the Λ readout uses an additional exact d=17 calculation.</p>');
    }
    const unsubscribe = ctx.state.onChange(draw), unsubscribeTheme = ctx.onThemeChange(draw);
    draw();
    return { destroy() { unsubscribe(); unsubscribeTheme(); } };
  });
})();

}).call(window);
