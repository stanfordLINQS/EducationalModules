/* overhead-calculator: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['overhead-calculator'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const defaults = Object.freeze({ p: 0.001, p_th: 0.00214, A: 0.03, alpha: 1, target: 1e-6, floor: 0 });
  const MAX_COUNT = BigInt(Number.MAX_SAFE_INTEGER);

  function validate(params = {}) {
    const p = { ...defaults, ...params }, errors = {};
    for (const id of ['p', 'p_th', 'A']) if (!Number.isFinite(p[id]) || p[id] <= 0) errors[id] = `${id} must be positive and finite.`;
    if (![0, 1].includes(p.alpha)) errors.alpha = 'Choose exponent convention 0 or 1.';
    if (!Number.isFinite(p.target) || p.target <= 0 || p.target >= 1) errors.target = 'The target must be finite and strictly between 0 and 1.';
    if (!Number.isFinite(p.floor) || p.floor < 0 || p.floor >= 1) errors.floor = 'The floor must be finite, at least 0, and less than 1.';
    return { params: p, errors, valid: !Object.keys(errors).length };
  }
  function checked(params) {
    const r = validate(params);
    if (!r.valid) throw new RangeError(Object.values(r.errors).join(' '));
    return r.params;
  }
  function suppression(p) {
    const Lambda = p.p_th / p.p;
    // Use the same rounded ratio as the displayed power law, including near one.
    // Forming (p_th-p)/p instead would give a slightly different curve and could
    // shift an equality boundary by one distance step. Fall back only if the
    // division itself overflows or underflows.
    const logLambda = Number.isFinite(Lambda) && Lambda > 0
      ? Math.log(Lambda) : Math.log(p.p_th) - Math.log(p.p);
    return { Lambda, logLambda, improving: p.p_th > p.p };
  }
  function logAdd(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const hi = Math.max(a, b);
    return hi + Math.log1p(Math.exp(Math.min(a, b) - hi));
  }
  function rateAt(p, d, s) {
    const logModel = Math.log(p.A) - ((d + p.alpha) / 2) * s.logLambda;
    const logTotal = p.floor === 0 ? logModel : logAdd(Math.log(p.floor), Math.log1p(-p.floor) + logModel);
    // Direct powers reproduce the reference calculation at ordinary magnitudes.
    // Fall back to logs when a separately rounded power overflows or underflows.
    let model = p.A * Math.pow(s.Lambda, -(d + p.alpha) / 2);
    if (!Number.isFinite(model) || model === 0 || !(s.Lambda > 0)) model = Math.exp(logModel);
    const total = p.floor + (1 - p.floor) * model;
    return { d, model, total, logModel, logTotal, probability: logModel <= 0, underflow: total === 0 };
  }
  function rate(params, d) {
    const p = checked(params);
    if (!Number.isSafeInteger(d) || d < 3 || d % 2 !== 1) throw new RangeError('Distance must be an odd safe integer of at least 3.');
    return rateAt(p, d, suppression(p));
  }
  function patchCounts(d) {
    if (!Number.isSafeInteger(d) || d < 3 || d % 2 !== 1) throw new RangeError('Distance must be an odd safe integer of at least 3.');
    const data = BigInt(d) ** 2n, measure = data - 1n, qubits = data + measure;
    if (qubits > MAX_COUNT) return { safe: false, data: null, measure: null, qubits: null };
    return { safe: true, data: Number(data), measure: Number(measure), qubits: Number(qubits) };
  }
  function solve(params = {}) {
    const validation = validate(params), p = validation.params;
    if (!validation.valid) return { ...validation, status: 'invalid', d: null, distance: null, qubits: null, rate: null };
    const s = suppression(p), base = { ...validation, ...s, d: null, distance: null, data: null, measure: null, qubits: null, rate: null, previous: null };
    const noSolution = reason => ({ ...base, status: 'no-solution', reason });
    if (p.floor > 0 && p.target <= p.floor) return noSolution(p.target < p.floor
      ? 'target below floor; no finite distance' : 'target equals positive floor; no finite distance');
    const logTarget = Math.log(p.target - p.floor) - Math.log1p(-p.floor);
    function passes(d) {
      const logModel = Math.log(p.A) - ((d + p.alpha) / 2) * s.logLambda;
      // A few arithmetic ulps allow equality at a computed boundary. Never use
      // a coarse absolute probability tolerance or span an entire distance step.
      const roundoff = 4 * Number.EPSILON * Math.max(1, Math.abs(logTarget), Math.abs(logModel));
      const tolerance = s.improving ? Math.min(roundoff, s.logLambda / 8) : roundoff;
      return logModel - logTarget <= tolerance;
    }
    function solved(d) {
      const counts = patchCounts(d), r = rateAt(p, d, s);
      return { ...base, status: 'solved', d, distance: d, data: counts.data, measure: counts.measure, qubits: counts.qubits,
        rate: r.total, logRate: r.logTotal, modelRate: r.model, previous: d === 3 ? null : rateAt(p, d - 2, s),
        reason: s.improving ? 'smallest odd distance meeting the target' : 'd=3 meets the target; outside improving regime' };
    }
    if (passes(3)) return solved(3);
    if (!s.improving) return noSolution('outside improving regime; d=3 fails and increasing distance cannot reach the target');
    const numerator = 2 * (Math.log(p.A) - logTarget);
    const bound = numerator / s.logLambda - p.alpha;
    function sizeLimit() {
      const log10Distance = Number.isFinite(bound) ? Math.log10(bound) : (Math.log(numerator) - Math.log(s.logLambda)) / Math.LN10;
      return { ...base, status: 'size-limit', reason: 'finite solution; exact integer outside the supported readout range',
        estimate: { log10Distance, log10Qubits: Math.LOG10E * Math.LN2 + 2 * log10Distance } };
    }
    let d = 2 * Math.ceil((Math.max(3, bound) - 1) / 2) + 1;
    if (!Number.isSafeInteger(d) || !patchCounts(d).safe) return sizeLimit();
    // The analytic bound is already within rounding error of the answer. These
    // neighboring tests correct an odd-integer boundary in either direction.
    if (!passes(d)) d += 2;
    if (d > 3 && passes(d - 2)) d -= 2;
    if (!Number.isSafeInteger(d) || !patchCounts(d).safe) return sizeLimit();
    if (!passes(d) || (d > 3 && passes(d - 2))) return sizeLimit();
    return solved(d);
  }
  function convertExponent(params, alpha) {
    const p = checked(params);
    if (![0, 1].includes(alpha)) throw new RangeError('Choose exponent convention 0 or 1.');
    const s = suppression(p);
    // The two allowed conventions differ by a square root. Division reproduces
    // the reference A_0=A_1/sqrt(Lambda) without rounding a reciprocal first.
    const factor = Math.sqrt(s.Lambda);
    const A = alpha === p.alpha ? p.A : Number.isFinite(factor) && factor > 0
      ? (alpha === 0 ? p.A / factor : p.A * factor)
      : p.A * Math.exp(((alpha - p.alpha) / 2) * s.logLambda);
    if (!Number.isFinite(A) || A <= 0) throw new RangeError('Converted prefactor is outside the finite numeric range.');
    return { ...p, alpha, A };
  }
  function compute(params = {}) {
    const baseline = solve(params), p = baseline.params;
    if (!baseline.valid) return { ...baseline, warnings: Object.values(baseline.errors), series: [], readouts: {} };
    // Halving an extremely small representable input need not itself be representable.
    const halfParams = { ...p, p: p.p / 2 }, half = solve(halfParams);
    const maxD = baseline.d === null ? 101 : Math.max(31, Math.min(101, baseline.d + 6));
    const warnings = [];
    if (!baseline.improving) warnings.push('Outside improving regime: increasing distance does not reduce the baseline curve.');
    if (baseline.status !== 'solved') warnings.push(baseline.reason);
    if (!half.valid) warnings.push('The halved physical probability is outside the finite numeric range.');
    const curves = [{ id: 'baseline', label: 'Baseline (solid)', params: p, result: baseline },
      { id: 'half-noise', label: 'Half p (dashed)', params: halfParams, result: half }];
    const series = curves.filter(c => c.result.valid).map(c => {
      const rows = Array.from({ length: (maxD - 3) / 2 + 1 }, (_, i) => rateAt(c.params, 3 + 2 * i, suppression(c.params)));
      const omittedAboveOne = rows.filter(r => !r.probability).length, omittedUnderflow = rows.filter(r => r.underflow).length;
      if (omittedAboveOne) warnings.push(`${c.label}: ${omittedAboveOne} plotted distances have model rates above 1, outside the probability interpretation; those segments are omitted.`);
      if (omittedUnderflow) warnings.push(`${c.label}: ${omittedUnderflow} rates are too small to represent as positive numbers; those points are omitted, not a zero error floor.`);
      return { id: c.id, label: c.label, rows, omittedAboveOne, omittedUnderflow,
        points: rows.filter(r => r.probability && r.total > 0 && Number.isFinite(r.total)).map(r => [r.d, r.logTotal / Math.LN10]) };
    });
    return { valid: true, params: p, errors: {}, warnings, baseline, half, maxD, series,
      readouts: { ...baseline, A: p.A, converted_A: p.A, epsilon_d7: rateAt(p, 7, suppression(p)).total,
        half_noise_also_blocked: half.status === 'no-solution' } };
  }
  return { defaults, validate, suppression, rate, patchCounts, solve, convertExponent, compute };
});

}).call(window);
(function(){
(function () {
  'use strict';
  StudyLab.register('overhead-calculator', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    // Keep the plot full-width and put controls and answers before it, also at 390 px.
    const wrap = layout.plots.parentElement;
    wrap.style.display = 'flex'; wrap.style.flexDirection = 'column';
    wrap.appendChild(layout.controls); wrap.appendChild(layout.readouts); wrap.appendChild(layout.plots);
    layout.controls.style.display = 'grid';
    layout.controls.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))';
    layout.controls.style.gap = '14px'; layout.controls.style.borderLeft = '0';
    const inputs = {}, errors = {}, cleanup = [];
    let ownChange = false, batch = false;
    function element(tag, parent, text) {
      const el = doc.createElement(tag);
      if (text !== undefined) el.textContent = text;
      parent.appendChild(el); return el;
    }
    function fieldError(id, message) {
      if (message) errors[id] = message; else delete errors[id];
      if (inputs[id]) {
        inputs[id].error.textContent = message || '';
        inputs[id].input.setAttribute('aria-invalid', String(!!message));
      }
    }
    function clearErrors() { for (const id of Object.keys(errors)) fieldError(id, null); }
    function rangeError(spec, value) {
      if (!Number.isFinite(value) || value < spec.range[0] || value > spec.range[1])
        return `Enter ${spec.id} from ${spec.range[0]} to ${spec.range[1]}.`;
      return ctx.model.validate({ ...ctx.state.all(), [spec.id]: value }).errors[spec.id] || null;
    }
    function syncInputs() {
      for (const [id, field] of Object.entries(inputs)) field.input.value = String(ctx.state.get(id));
    }
    let conversion, conversionHint;
    for (const spec of ctx.card.parameters) {
      const holder = element('div', layout.controls);
      holder.style.minWidth = '0';
      if (spec.type === 'choice') {
        ctx.controls.select(holder, spec);
        conversionHint = element('small', holder);
        conversion = ctx.controls.button(holder, { label: 'Convert A to preserve curve', onClick() {
          if (Object.keys(errors).length) return;
          const next = ctx.model.convertExponent(ctx.state.all(), 1 - ctx.state.get('alpha'));
          const message = rangeError(ctx.card.parameters.find(p => p.id === 'A'), next.A);
          if (message) { fieldError('A', 'Conversion would leave the prefactor control range; both inputs are unchanged.'); draw(); return; }
          batch = true; ownChange = true;
          ctx.state.set('A', next.A); ctx.state.set('alpha', next.alpha);
          ownChange = false; batch = false; syncInputs(); draw();
        } });
        conversion.style.whiteSpace = 'normal'; conversion.style.width = '100%';
      } else {
        const label = element('label', holder);
        const heading = element('span', label); heading.className = 'control-label';
        heading.innerHTML = ctx.tex(spec.symbol) + ' ';
        element('span', heading, spec.meaning);
        const input = element('input', label);
        input.type = 'text'; input.id = `${ctx.id}-${spec.id}`;
        input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');
        input.setAttribute('aria-describedby', `${input.id}-hint ${input.id}-error`);
        input.value = String(ctx.state.get(spec.id));
        input.style.minWidth = '0'; input.style.marginBottom = '4px';
        const hint = element('small', holder, `${spec.range[0]} to ${spec.range[1]}; scientific notation accepted.`);
        hint.id = `${input.id}-hint`;
        const error = element('small', holder); error.id = `${input.id}-error`; error.setAttribute('role', 'status');
        inputs[spec.id] = { input, error };
        const edit = () => {
          const text = input.value.trim();
          const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
          const value = numeric ? Number(text) : NaN;
          const message = numeric ? rangeError(spec, value) : 'Enter a finite number, for example 1e-9.';
          fieldError(spec.id, message);
          if (!message) {
            ownChange = true; ctx.state.set(spec.id, value); ownChange = false;
          }
          draw();
        };
        input.addEventListener('input', edit);
        cleanup.push(() => input.removeEventListener('input', edit));
      }
    }
    const presets = element('div', layout.controls); presets.className = 'presets'; presets.style.gridColumn = '1 / -1';
    for (const preset of ctx.card.presets) {
      const b = ctx.controls.button(presets, { label: preset.label, onClick: () => ctx.state.applyPreset(preset.id) });
      b.title = preset.shows;
    }
    ctx.controls.button(presets, { label: 'Defaults', onClick: () => ctx.state.reset() });
    const chart = ctx.plot(layout.plots, { title: 'Logical error per QEC cycle',
      x: { label: 'Odd distance d', domain: 'auto' },
      y: { label: 'log10(logical error per cycle)', domain: 'auto' }, legend: true });
    const sig = x => Number.isFinite(x) ? Number(x.toPrecision(6)).toString() : 'Outside numeric range';
    function resultReadouts(result, prefix) {
      const items = [{ label: `${prefix} suppression factor`, value: sig(result.Lambda) }];
      if (result.status === 'solved') {
        items.push({ label: `${prefix} minimum distance`, value: String(result.d) },
          { label: `${prefix} rate at minimum distance`, value: result.rate || `10^(${(result.logRate / Math.LN10).toFixed(6)})`, format: 'exp', digits: 9, units: 'per QEC cycle' },
          { label: `${prefix} data / measurement qubits`, value: `${result.data} / ${result.measure}` },
          { label: `${prefix} total qubits`, value: String(result.qubits) });
        if (result.previous) items.push({ label: `${prefix} preceding odd distance`, value: String(result.previous.d) },
          { label: `${prefix} rate at preceding distance`, value: result.previous.total, format: 'exp', digits: 9, units: result.previous.probability ? 'per QEC cycle' : 'outside probability interpretation' });
      } else if (result.status === 'size-limit') {
        items.push({ label: `${prefix} distance estimate`, value: `log10(d) ≈ ${result.estimate.log10Distance.toFixed(6)}` },
          { label: `${prefix} qubit estimate`, value: `log10(Q) ≈ ${result.estimate.log10Qubits.toFixed(6)}` },
          { label: `${prefix} integer readout`, value: result.reason });
      } else items.push({ label: `${prefix} distance`, value: result.reason || 'Halved input is outside numeric range.' });
      return items;
    }
    function draw() {
      if (batch) return;
      const r = ctx.model.compute(ctx.state.all());
      conversionHint.textContent = `Switch to alpha = ${1 - ctx.state.get('alpha')} while preserving the curve.`;
      conversion.disabled = !!Object.keys(errors).length || !r.valid;
      if (Object.keys(errors).length || !r.valid) {
        chart.update([]); ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, '');
        ctx.warn(layout.notes, Object.values(errors).concat(r.valid ? [] : r.warnings).join(' ')); return;
      }
      const series = r.series.map((c, i) => ({ id: c.id, label: c.label, points: c.points,
        kind: 'line', role: i ? 'secondary' : 'primary', dash: i ? '7 4' : undefined }));
      series.push({ id: 'target', label: 'Target (dotted)', role: 'reference', kind: 'line', dash: '2 4',
        points: [[3, Math.log10(r.params.target)], [r.maxD, Math.log10(r.params.target)]] });
      if (r.params.floor > 0) series.push({ id: 'floor', label: 'Independent floor (dash-dot)', role: 'accent', kind: 'line', dash: '7 3 2 3',
        points: [[3, Math.log10(r.params.floor)], [r.maxD, Math.log10(r.params.floor)]] });
      const annotations = [];
      for (const [result, label, role] of [[r.baseline, 'Baseline minimum', 'primary'], [r.half, 'Half-p minimum', 'secondary']])
        if (result.status === 'solved' && result.d <= r.maxD && result.rate > 0)
          annotations.push({ type: 'point', x: result.d, y: result.logRate / Math.LN10, label, role });
      chart.update(series, annotations);
      ctx.readouts(layout.readouts, [
        { label: 'Physical / threshold inputs', value: `${sig(r.params.p)} / ${sig(r.params.p_th)}` },
        { label: 'Prefactor A', value: r.params.A, format: 'sig', digits: 6 },
        { label: 'Exponent convention', value: r.params.alpha === 1 ? '(d+1)/2' : 'd/2' },
        { label: 'Target', value: r.params.target, format: 'exp', digits: 6, units: 'per QEC cycle' },
        { label: 'Independent floor', value: r.params.floor, format: 'exp', digits: 6, units: 'per QEC cycle' },
        ...resultReadouts(r.baseline, 'Baseline'), ...resultReadouts(r.half, 'Half-p'),
        { label: 'Baseline rate at distance 7', value: r.readouts.epsilon_d7, format: 'exp', digits: 9,
          units: ctx.model.rate(r.params, 7).probability ? 'per QEC cycle' : 'outside probability interpretation' }
      ]);
      const neighboring = r.baseline.status === 'solved'
        ? r.baseline.previous ? `Distance ${r.baseline.d} meets the target; the preceding odd distance ${r.baseline.previous.d} misses it.`
          : 'Distance 3 already meets the target; no smaller distance is permitted.' : r.baseline.reason + '.';
      ctx.notes(layout.notes, `<p>${neighboring}</p><p>The plot stops at distance ${r.maxD}. A minimum distance beyond that limit is still reported above. The vertical coordinate is log10 of the probability per QEC cycle; -6 means 1e-6.</p>` +
        '<p>Half p holds A, the threshold parameter, the exponent, the target, and the floor fixed. Changing alpha alone changes the curve. The conversion button changes alpha and A together.</p>' +
        '<p>The baseline physical input only sets the model ratio. It is not a measured gate error of any processor. Qubit totals include data and one measurement qubit per check.</p>');
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
    }
    const unsubscribe = ctx.state.onChange(() => {
      if (!ownChange) { clearErrors(); syncInputs(); }
      draw();
    });
    draw();
    return { destroy() { unsubscribe(); cleanup.forEach(fn => fn()); chart.destroy?.(); } };
  });
})();

}).call(window);
