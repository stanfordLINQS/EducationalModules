/* transmon-cz: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['transmon-cz'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const G_MHZ = 20, SAMPLE_COUNT = 201, PHASE_THRESHOLD = 1e-8;
  const ROUNDING = 1e-14;
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const norm2 = a => a[0] ** 2 + a[1] ** 2;
  function mhzToAngular(mhz) {
    if (!Number.isFinite(mhz)) throw new RangeError('Frequency must be a finite number in MHz.');
    return mhz * (2 * Math.PI / 1000);
  }
  function rates(delta_mhz, g_mhz) {
    if (!Number.isFinite(g_mhz) || g_mhz < 0) throw new RangeError('Coupling must be finite and nonnegative in MHz.');
    const delta = mhzToAngular(delta_mhz), g = mhzToAngular(g_mhz);
    const omega = Math.hypot(delta, 2 * g);
    if (!Number.isFinite(omega)) throw new RangeError('Angular rates exceed the numerical range.');
    return { delta, g, omega };
  }
  // Basis order is |00>, |11>, |02>. Every complex value is [real, imaginary].
  // Signed time is allowed here so tests can inspect U(-t) U(t).
  function propagator({ delta_mhz = 0, time_ns = 0, g_mhz = G_MHZ } = {}) {
    const { delta, g, omega } = rates(delta_mhz, g_mhz);
    if (!Number.isFinite(time_ns) || !Number.isFinite(omega * time_ns)) throw new RangeError('Time must give a finite pulse angle.');
    if (time_ns === 0 || omega === 0) return [[[1, 0], [0, 0], [0, 0]], [[0, 0], [1, 0], [0, 0]], [[0, 0], [0, 0], [1, 0]]];
    if (g === 0) return [[[1, 0], [0, 0], [0, 0]], [[0, 0], [1, 0], [0, 0]], [[0, 0], [0, 0], [Math.cos(delta * time_ns), -Math.sin(delta * time_ns)]]];
    const angle = omega * time_ns / 2, trace = delta * time_ns / 2;
    const c = Math.cos(angle), s = Math.sin(angle), common = [Math.cos(trace), -Math.sin(trace)];
    const u11 = mul(common, [c, delta / omega * s]);
    const u02 = mul(common, [c, -delta / omega * s]);
    const exchange = mul(common, [0, -2 * g / omega * s]);
    return [[[1, 0], [0, 0], [0, 0]], [[0, 0], u11, exchange.slice()], [[0, 0], exchange.slice(), u02]];
  }
  function principalPhase(a) {
    if (!Array.isArray(a) || a.length !== 2 || !a.every(Number.isFinite)) throw new RangeError('Amplitude must have finite real and imaginary parts.');
    if (Math.hypot(...a) < PHASE_THRESHOLD) return null;
    const phi = Math.atan2(a[1], a[0]);
    return phi === -Math.PI ? Math.PI : Object.is(phi, -0) ? 0 : phi;
  }
  function evolve({ delta_mhz = 0, time_ns = 0, g_mhz = G_MHZ, initial = [[0, 0], [1, 0], [0, 0]] } = {}) {
    if (!Array.isArray(initial) || initial.length !== 3 || initial.some(a => !Array.isArray(a) || a.length !== 2 || !a.every(Number.isFinite))) throw new RangeError('Initial state needs three complex amplitudes.');
    const u = propagator({ delta_mhz, time_ns, g_mhz });
    const [a00, a11, a02] = u.map(row => row.reduce((sum, entry, j) => add(sum, mul(entry, initial[j])), [0, 0]));
    const p00 = norm2(a00), p11 = norm2(a11), p02 = norm2(a02);
    return { time_ns, a00, a11, a02, p00, p11, p02, norm: p00 + p11 + p02, phase_rad: principalPhase(a11) };
  }
  // Energies divided by h, in MHz. This helper is independent of time sampling.
  function energies(delta_mhz, g_mhz = G_MHZ) {
    rates(delta_mhz, g_mhz);
    const gap = Math.hypot(delta_mhz, 2 * g_mhz);
    if (!Number.isFinite(gap)) throw new RangeError('Energy gap exceeds the numerical range.');
    return { spectator: 0, lower: (delta_mhz - gap) / 2, upper: (delta_mhz + gap) / 2, gap };
  }
  function component(x) {
    if (Math.abs(x) < ROUNDING) return 0;
    return Math.abs(Math.abs(x) - 1) < ROUNDING ? Math.sign(x) : x;
  }
  function probability(x) {
    return x < ROUNDING ** 2 ? 0 : Math.abs(x - 1) < ROUNDING ? 1 : x;
  }
  function complexText(a) {
    const re = component(a[0]), im = component(a[1]);
    const text = x => String(Number(x.toPrecision(6)));
    if (im === 0) return text(re);
    const imag = Math.abs(im) === 1 ? 'i' : `${text(Math.abs(im))}i`;
    return re === 0 ? `${im < 0 ? '-' : ''}${imag}` : `${text(re)} ${im < 0 ? '-' : '+'} ${imag}`;
  }
  function phaseText(phi) {
    if (phi === null) return 'undefined';
    if (Math.abs(Math.abs(phi) - Math.PI) < ROUNDING) return '\\(\\pi\\)';
    if (Math.abs(phi - Math.PI / 2) < ROUNDING) return '\\(\\pi/2\\)';
    if (Math.abs(phi + Math.PI / 2) < ROUNDING) return '\\(-\\pi/2\\)';
    return String(Number(component(phi).toPrecision(6)));
  }
  function endpointReadouts(p, state) {
    return {
      delta_mhz: p.delta_mhz, tau_ns: p.tau_ns,
      p11: probability(state.p11), p02: probability(state.p02), norm: probability(state.norm),
      a11: complexText(state.a11), a02: complexText(state.a02),
      phase_rad: state.phase_rad, phase: phaseText(state.phase_rad)
    };
  }
  function compute(params = {}) {
    const p = { delta_mhz: 0, tau_ns: 25, fraction: 1, ...params }, warnings = [];
    if (!Number.isFinite(p.delta_mhz) || p.delta_mhz < -100 || p.delta_mhz > 100) warnings.push('Choose a finite detuning from -100 to 100 MHz.');
    if (!Number.isFinite(p.tau_ns) || p.tau_ns < 0 || p.tau_ns > 100) warnings.push('Choose a finite pulse duration from 0 to 100 ns.');
    if (!Number.isFinite(p.fraction) || p.fraction < 0 || p.fraction > 1) warnings.push('Choose a marker fraction from 0 to 1.');
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };
    const { delta, omega } = rates(p.delta_mhz, G_MHZ);
    const at = time_ns => evolve({ delta_mhz: p.delta_mhz, time_ns });
    const samples = Array.from({ length: SAMPLE_COUNT }, (_, i) => at(p.tau_ns * i / (SAMPLE_COUNT - 1)));
    const end = at(p.tau_ns), marker = at(p.fraction * p.tau_ns), trajectory = [];
    samples.forEach((s, i) => {
      // The minimum survival amplitude is |Delta|/Omega. Detect an unresolved
      // minimum between samples as well as a sample whose phase is undefined.
      const turn = t => Math.floor((omega * t / 2 + Math.PI / 2) / Math.PI);
      const crossesZero = i > 0 && Math.abs(delta) / omega < PHASE_THRESHOLD && turn(samples[i - 1].time_ns) !== turn(s.time_ns);
      if (crossesZero) trajectory.push([NaN, NaN]);
      trajectory.push(s.phase_rad === null ? [NaN, NaN] : s.a11.slice());
    });
    if (end.phase_rad === null) warnings.push('Final phase is undefined because the surviving |11⟩ amplitude is below 1e-8.');
    if (marker.phase_rad === null && end.phase_rad !== null) warnings.push('Phase at the time marker is undefined because the surviving |11⟩ amplitude is below 1e-8. The final readouts still refer to the pulse end.');
    return {
      valid: true, params: p, warnings, samples, end, marker,
      readouts: endpointReadouts(p, end),
      markerReadouts: { time_ns: marker.time_ns, p11: probability(marker.p11), p02: probability(marker.p02), phase: phaseText(marker.phase_rad) },
      series: {
        p11: samples.map(s => [s.time_ns, s.p11]), p02: samples.map(s => [s.time_ns, s.p02]),
        norm: samples.map(s => [s.time_ns, s.norm]), trajectory,
        circle: Array.from({ length: 129 }, (_, i) => [Math.cos(2 * Math.PI * i / 128), Math.sin(2 * Math.PI * i / 128)]),
        phaseRay: end.phase_rad === null ? [] : [[0, 0], end.a11.slice()]
      }
    };
  }
  return { G_MHZ, SAMPLE_COUNT, PHASE_THRESHOLD, mhzToAngular, propagator, principalPhase, evolve, energies, compute };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('transmon-cz', function mount(root, ctx) {
    const layout = ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const populationOptions = {
      title: 'Population during the pulse',
      x: { label: 'Elapsed time (ns)', domain: [0, 25] },
      y: { label: 'Population (probability)', domain: [-0.04, 1.08] }, legend: true
    };
    const populations = ctx.plot(layout.plots, populationOptions);
    const phase = ctx.plot(layout.plots, {
      title: 'Surviving |11⟩ amplitude',
      x: { label: 'Re a11 (amplitude)', domain: [-1.2, 1.2] },
      y: { label: 'Im a11 (amplitude)', domain: [-1.2, 1.2] }, aspect: 'equal', legend: true
    });
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
      if (!r.valid) {
        populations.update([]); phase.update([]);
        ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return;
      }
      const s = r.series, e = r.end, m = r.marker, out = r.readouts;
      populationOptions.x.domain = [0, Math.max(r.params.tau_ns, 1)];
      populations.update([
        { id: 'sum', label: 'P11 + P02 = 1', kind: 'line', role: 'reference', dash: '2 5', points: s.norm, width: 1 },
        { id: 'p11', label: 'P11: computational', kind: 'line', role: 'primary', points: s.p11 },
        { id: 'p02', label: 'P02: leakage', kind: 'line', role: 'secondary', dash: '7 4', points: s.p02 },
        { id: 'marker-p11', label: 'P11 at marker', kind: 'scatter', role: 'primary', points: [[m.time_ns, m.p11]] },
        { id: 'marker-p02', label: 'P02 at marker', kind: 'scatter', role: 'secondary', points: [[m.time_ns, m.p02]] }
      ], [{ type: 'vline', x: m.time_ns, role: 'accent' }]);
      phase.update([
        { id: 'unit-circle', label: 'Unit magnitude', kind: 'line', role: 'reference', dash: '2 5', points: s.circle, width: 1 },
        { id: 'trajectory', label: 'a11 during pulse', kind: 'line', role: 'primary', points: s.trajectory },
        { id: 'phase-ray', label: 'Final phase direction', kind: 'line', role: 'secondary', dash: '7 4', points: s.phaseRay },
        { id: 'start', label: 'Start', kind: 'scatter', role: 'input', points: [[1, 0]], width: 2 },
        { id: 'endpoint', label: 'Pulse end', kind: 'scatter', role: 'secondary', points: [e.a11], width: 6 },
        { id: 'marker', label: 'Time marker', kind: 'scatter', role: 'accent', points: [m.a11], width: 2 }
      ]);
      // Keep these concise: the SDK stacks readouts and wraps legends on phones.
      ctx.readouts(layout.readouts, [
        { label: 'Detuning Δ/(2π)', value: out.delta_mhz, format: 'sig', digits: 12, units: 'MHz' },
        { label: 'Pulse duration τ', value: out.tau_ns, format: 'sig', digits: 12, units: 'ns' },
        { label: 'Final P11', value: out.p11, digits: 8 },
        { label: 'Final leakage P02', value: out.p02, digits: 8 },
        { label: 'Final P11 + P02', value: out.norm, digits: 8 },
        { label: 'Final a11', value: out.a11 },
        { label: 'Final a02', value: out.a02 },
        { label: 'Final phase', value: out.phase, units: out.phase_rad === null ? '' : 'rad' },
        { label: 'Marker time', value: r.markerReadouts.time_ns, format: 'sig', digits: 8, units: 'ns' },
        { label: 'P11 at marker', value: r.markerReadouts.p11, digits: 8 },
        { label: 'P02 at marker', value: r.markerReadouts.p02, digits: 8 },
        { label: 'Phase at marker', value: r.markerReadouts.phase, units: m.phase_rad === null ? '' : 'rad' }
      ]);
      let interpretation;
      if (e.phase_rad === null) interpretation = 'The pulse ends with no surviving computational amplitude. Its phase is undefined.';
      else if (out.p02 > 0) interpretation = 'Some population remains in |02⟩. The final angle is the phase of the surviving |11⟩ amplitude, not a unitary computational gate phase.';
      else interpretation = 'Population has returned to |11⟩. Compare the endpoint angle with π to decide whether this return supplies the desired conditional phase.';
      ctx.notes(layout.notes,
        '<p>Move the position slider with the pointer or arrow keys to follow both plots. The vertical line and small dot refer to the same time. The larger endpoint marker stays at the pulse end, and the final readouts stay fixed.</p>' +
        `<p>${interpretation}</p>` +
        (r.params.tau_ns === 0 ? '<p>A zero-duration pulse leaves the initial state unchanged; the empty time axis extends to 1 ns for legibility.</p>' : '') +
        '<p>Try the four presets in order. The first and third both end with zero leakage; their complex amplitudes distinguish a π phase from a zero phase.</p>');
    }
    const unsubscribe = ctx.state.onChange(draw);
    draw();
    return { destroy() { unsubscribe(); populations.destroy?.(); phase.destroy?.(); } };
  });
})();

}).call(window);
