/* error-discretization: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['error-discretization'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const zeroState = () => Array.from({ length: 8 }, () => [0, 0]);
  const abs2 = z => z[0] * z[0] + z[1] * z[1];
  function checkState(state) {
    if (!Array.isArray(state) || state.length !== 8 || !state.every(z => Array.isArray(z) && z.length === 2 && z.every(Number.isFinite))) throw new RangeError('State must contain eight finite complex amplitude pairs.');
  }
  function checkQubit(qubit) {
    if (![1, 2, 3].includes(qubit)) throw new RangeError('Qubit must be 1, 2, or 3.');
  }
  function encodedState(polar, azimuth) {
    if (![polar, azimuth].every(Number.isFinite)) throw new RangeError('Angles must be finite.');
    const state = zeroState(), b = Math.sin(polar / 2);
    state[0] = [Math.cos(polar / 2), 0];
    state[7] = [b * Math.cos(azimuth), b * Math.sin(azimuth)];
    return state;
  }
  function rotationFactors(theta) {
    if (!Number.isFinite(theta)) throw new RangeError('Rotation angle must be finite.');
    // Exact mathematical endpoints, without rounding nearby angles to endpoints.
    return theta === Math.PI ? [0, 1] : theta === 0 ? [1, 0] : [Math.cos(theta / 2), Math.sin(theta / 2)];
  }
  function rotateX(state, qubit, theta) {
    checkState(state); checkQubit(qubit);
    const [c, s] = rotationFactors(theta), mask = 1 << (3 - qubit);
    return state.map((a, i) => {
      const b = state[i ^ mask];
      return [c * a[0] + s * b[1], c * a[1] - s * b[0]];
    });
  }
  function flipX(state, qubit) {
    checkState(state); checkQubit(qubit);
    return state.map((_, i) => state[i ^ (1 << (3 - qubit))].slice());
  }
  function syndrome(index) {
    return [((index >> 2) ^ (index >> 1)) & 1, ((index >> 1) ^ index) & 1];
  }
  function project(state, bits) {
    checkState(state);
    if (!Array.isArray(bits) || bits.length !== 2 || !bits.every(x => x === 0 || x === 1)) throw new RangeError('Syndrome is two binary bits.');
    const projected = state.map((z, i) => syndrome(i).every((s, j) => s === bits[j]) ? z.slice() : [0, 0]);
    const probability = projected.reduce((sum, z) => sum + abs2(z), 0);
    // An impossible outcome has no normalized conditional state.
    return { probability, state: probability === 0 ? null : projected.map(z => z.map(x => x / Math.sqrt(probability))) };
  }
  function fidelity(target, state) {
    checkState(target); checkState(state);
    let re = 0, im = 0;
    target.forEach((a, i) => { const b = state[i]; re += a[0] * b[0] + a[1] * b[1]; im += a[0] * b[1] - a[1] * b[0]; });
    return re * re + im * im;
  }
  function reducedQubit1(state) {
    checkState(state);
    const rho = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => [0, 0]));
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let rest = 0; rest < 4; rest++) {
      const x = state[4 * a + rest], y = state[4 * b + rest];
      rho[a][b][0] += x[0] * y[0] + x[1] * y[1];
      rho[a][b][1] += x[1] * y[0] - x[0] * y[1];
    }
    return rho;
  }
  function stabilizerExpectations(state) {
    checkState(state);
    return [0, 1].map(j => state.reduce((sum, z, i) => sum + (1 - 2 * syndrome(i)[j]) * abs2(z), 0));
  }
  function compute(params = {}) {
    const p = { theta: 0.2, qubit: 2, polar: 1.047, azimuth: 0, correct: true, ...params };
    const warnings = [];
    for (const [key, max] of [['theta', 3.142], ['polar', 3.142], ['azimuth', 6.283]]) {
      if (!Number.isFinite(p[key]) || p[key] < 0 || p[key] > max) warnings.push(`${key} must be a finite angle from 0 to ${max} rad.`);
    }
    if (![1, 2, 3].includes(p.qubit)) warnings.push('Select qubit 1, 2, or 3.');
    if (typeof p.correct !== 'boolean') warnings.push('correct must be boolean.');
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };
    const encoded = encodedState(p.polar, p.azimuth), rotated = rotateX(encoded, p.qubit, p.theta);
    const flaggedBits = syndrome(1 << (3 - p.qubit));
    const branches = [[0, 0], flaggedBits].map((bits, i) => {
      const branch = project(rotated, bits), before = branch.state;
      const corrected = before ? (i === 1 ? flipX(before, p.qubit) : before.map(z => z.slice())) : null;
      const selected = before ? (p.correct ? corrected : before).map(z => z.slice()) : null;
      return { syndrome: bits.slice(), probability: branch.probability, state: before, corrected, selected,
        probabilities: before ? before.map(abs2) : null,
        eigenvalues: bits.map(s => 1 - 2 * s),
        measuredEigenvalues: before ? stabilizerExpectations(before) : null,
        fidelityBefore: before ? fidelity(encoded, before) : null,
        fidelityCorrected: corrected ? fidelity(encoded, corrected) : null,
        fidelitySelected: selected ? fidelity(encoded, selected) : null };
    });
    const expectationX = Math.sin(p.polar) * Math.cos(p.azimuth);
    const bareFidelity = theta => {
      const [, s] = rotationFactors(theta);
      return 1 - s * s * (1 - expectationX * expectationX);
    };
    const angles = Array.from({ length: 201 }, (_, i) => Math.PI * i / 200);
    if (branches.some(b => b.state === null)) warnings.push('A zero-probability outcome has no conditional state. Its stems and conditional fidelity are omitted; the ensemble still has unit corrected fidelity.');
    if (p.theta > Math.PI) warnings.push('The rounded slider endpoint is slightly above π; the model evaluates that numeric angle literally.');
    return {
      valid: true, params: p, warnings, encoded, rotated, branches,
      reducedEncoded: reducedQubit1(encoded), reducedRotated: reducedQubit1(rotated),
      series: {
        rotated: rotated.map((z, i) => [i, abs2(z)]),
        branchProbabilities: branches.map(b => b.probabilities ? b.probabilities.map((v, i) => [i, v]) : []),
        clean: angles.map(theta => [theta, rotationFactors(theta)[0] ** 2]),
        flagged: angles.map(theta => [theta, rotationFactors(theta)[1] ** 2]),
        unprotected: angles.map(theta => [theta, bareFidelity(theta)])
      },
      readouts: { expectationX, unprotectedFidelity: bareFidelity(p.theta),
        correctedFidelity: branches.reduce((sum, b) => sum + b.probability * (b.fidelityCorrected ?? 0), 0),
        selectedFidelity: branches.reduce((sum, b) => sum + b.probability * (b.fidelitySelected ?? 0), 0) }
    };
  }
  return { encodedState, rotateX, flipX, project, fidelity, reducedQubit1, stabilizerExpectations, compute };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('error-discretization', function mount(root, ctx) {
    const layout = ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const amplitudes = ctx.plot(layout.plots, {
      title: 'Computed basis probabilities before correction',
      x: { label: 'basis index (000…111, qubit 1 most significant)', domain: [-0.5, 7.5] },
      y: { label: 'Probability (each available state sums to 1)', domain: [0, 1.05] }, legend: true
    });
    const branches = ctx.plot(layout.plots, {
      title: 'Syndrome probabilities and unprotected fidelity',
      x: { label: 'Rotation angle θ (rad)', domain: [0, 3.142] },
      y: { label: 'Probability or pure-state fidelity', domain: [0, 1.05] }, legend: true
    });
    function draw() {
      const result = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, result.warnings.join(' ') || null);
      if (!result.valid) {
        amplitudes.update([]); branches.update([]);
        ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return;
      }
      const { params: p, series: s, readouts: r } = result, [clean, flag] = result.branches;
      const bits = flag.syndrome.join('');
      // Small horizontal offsets separate overlapping stems; basis indices stay integer ticks.
      const stems = (points, offset) => points.map(([x, y]) => [x + offset, 0, x + offset, y]);
      amplitudes.update([
        { id: 'rotated', label: 'After rotation', role: 'primary', kind: 'arrows', head: 0, dash: '', width: 2.5, points: stems(s.rotated, -0.15) },
        { id: 'clean-state', label: `Conditional s=00${clean.state ? '' : ' (impossible)'}`, role: 'secondary', kind: 'arrows', head: 0, dash: '6 3', points: stems(s.branchProbabilities[0], 0) },
        { id: 'flag-state', label: `Conditional s=${bits}${flag.state ? '' : ' (impossible)'}`, role: 'tertiary', kind: 'arrows', head: 0, dash: '2 3', points: stems(s.branchProbabilities[1], 0.15) }
      ]);
      branches.update([
        { id: 'clean-probability', label: 'P(s=00) = cos²(θ/2)', role: 'secondary', kind: 'line', dash: '6 3', points: s.clean },
        { id: 'flag-probability', label: `P(s=${bits}) = sin²(θ/2)`, role: 'tertiary', kind: 'line', dash: '2 3', points: s.flagged },
        { id: 'bare-fidelity', label: 'Unprotected single-qubit fidelity', role: 'reference', kind: 'line', dash: '10 3 2 3', points: s.unprotected }
      ], [{ type: 'vline', x: p.theta, role: 'accent', label: 'Current θ' },
        { type: 'point', x: p.theta, y: clean.probability, role: 'secondary' },
        { type: 'point', x: p.theta, y: flag.probability, role: 'tertiary' },
        { type: 'point', x: p.theta, y: r.unprotectedFidelity, role: 'reference' }]);
      const conditional = x => x === null ? 'Undefined (zero probability)' : x;
      ctx.readouts(layout.readouts, [
        { label: 'Computed P(s=00)', value: clean.probability, format: 'sig', digits: 8 },
        { label: `Computed P(s=${bits})`, value: flag.probability, format: 'sig', digits: 8 },
        { label: 'Corrected ensemble fidelity', value: r.correctedFidelity, format: 'sig', digits: 12 },
        { label: `Selected ensemble fidelity (correction ${p.correct ? 'on' : 'off'})`, value: r.selectedFidelity, format: 'sig', digits: 12 },
        { label: 'Clean branch fidelity', value: conditional(clean.fidelitySelected), format: 'sig', digits: 12 },
        { label: 'Flagged branch fidelity, correction off', value: conditional(flag.fidelityBefore), format: 'sig', digits: 12 },
        { label: 'Flagged branch fidelity, selected correction', value: conditional(flag.fidelitySelected), format: 'sig', digits: 12 },
        { label: 'Unprotected single-qubit fidelity', value: r.unprotectedFidelity, format: 'sig', digits: 8 },
        { label: 'Unencoded input expectation of X', tex: '\\langle X\\rangle', value: r.expectationX, format: 'sig', digits: 8 },
        { label: 'Original encoded ρ₁: probability of 0', value: result.reducedEncoded[0][0][0], format: 'sig', digits: 8 },
        { label: 'Original encoded ρ₁: probability of 1', value: result.reducedEncoded[1][1][0], format: 'sig', digits: 8 },
        { label: 'Original encoded ρ₁: off-diagonal', value: '0' },
        { label: 'S₁, S₂ eigenvalues in s=00 sector', value: '+1, +1' },
        { label: `S₁, S₂ eigenvalues in s=${bits} sector`, value: flag.eigenvalues.map(x => x > 0 ? '+1' : '-1').join(', ') }
      ]);
      ctx.notes(layout.notes,
        '<p><strong>Predict, then inspect:</strong> At θ=0.2, predict the flagged probability before comparing with the computed readout. Try Quarter turn and Full flip, then turn correction off. Change the logical Bloch angles and explain which probabilities stay fixed.</p>' +
        `<p>Stems show the rotated state and the two normalized post-measurement states before correction. They are offset by -0.15, 0, and +0.15 basis-index units to separate overlaps. Conditional probabilities each sum to 1; multiply them by their branch weight to recover the rotated basis probabilities. The correction switch changes the fidelity readouts, not these pre-correction stems.</p>` +
        `<p>Syndrome order is (Z₁Z₂, Z₂Z₃), with bit 0 for eigenvalue +1. Rotation on qubit ${p.qubit} flags s=${bits}. Measurement learns parity, while preserving the encoded amplitudes inside each branch. The displayed reduced state belongs to the original encoded state; rotating qubit 1 can create off-diagonal elements before measurement.</p>` +
        '<p>The unprotected comparison acts on one unencoded qubit with the same Bloch angles. An X eigenstate changes only by a global phase, so its fidelity stays 1 even at θ=π. The preset angles are rounded numeric values; Full flip uses 3.1416 rad and can retain a tiny clean-branch probability.</p>');
    }
    const unsubscribe = ctx.state.onChange(draw), unsubscribeTheme = ctx.onThemeChange(draw);
    draw();
    return { destroy() { unsubscribe(); unsubscribeTheme(); } };
  });
})();

}).call(window);
