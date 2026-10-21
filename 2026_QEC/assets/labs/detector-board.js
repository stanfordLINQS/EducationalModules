/* detector-board: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['detector-board'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ d: 3, T: 6, pattern: 'data', site: 2, time: 3, leak_length: 2, seed: 7, fraction_set: 'all' });
  function integer(value, low, high, label) {
    if (!Number.isInteger(value) || value < low || value > high) throw new RangeError(`${label} must be an integer from ${low} to ${high}.`);
  }
  function dimensions(d, T) {
    integer(d, 3, 7, 'Distance d');
    if (d % 2 !== 1) throw new RangeError('Choose an odd distance: 3, 5, or 7.');
    integer(T, 2, 10, 'Rounds T');
  }
  function bitstring(bits, length) {
    if (!Array.isArray(bits) || bits.length !== length || bits.some(b => b !== 0 && b !== 1)) throw new RangeError(`Prepared data must contain ${length} bits, each 0 or 1.`);
  }
  function parity(bits) {
    if (!Array.isArray(bits) || bits.length < 2 || bits.some(b => b !== 0 && b !== 1)) throw new RangeError('Parity requires an array of at least two bits.');
    return bits.slice(1).map((b, i) => bits[i] ^ b);
  }
  // The lab-specific contract fixes xorshift32, including high-bit extraction.
  function randomBits(seed, count) {
    integer(seed, 1, 0xFFFFFFFF, 'Seed'); integer(count, 0, 100, 'Draw count');
    let state = seed >>> 0;
    return Array.from({ length: count }, () => {
      state = (state ^ (state << 13)) >>> 0;
      state = (state ^ (state >>> 17)) >>> 0;
      state = (state ^ (state << 5)) >>> 0;
      return state >>> 31;
    });
  }
  function fraction(numerator, denominator, first, last) {
    let a = numerator, b = denominator;
    while (b) { const r = a % b; a = b; b = r; }
    const reduced = `${numerator / a}/${denominator / a}`;
    const count = `${numerator}/${denominator}`;
    return { numerator, denominator, value: numerator / denominator, reduced, text: count === reduced ? count : `${count} = ${reduced}`, first, last };
  }
  // API extension for tests and known nonzero product preparations.
  // Fault times precede measured extraction, never the ideal final readout.
  function simulate({ d = 3, T = 6, prepared, dataFaults = [], measurementFaults = [], overwrites = [] } = {}) {
    dimensions(d, T);
    if (prepared === undefined) prepared = Array(d).fill(0);
    bitstring(prepared, d);
    for (const [faults, maxSite] of [[dataFaults, d], [measurementFaults, d - 1], [overwrites, d - 1]]) {
      if (!Array.isArray(faults)) throw new RangeError('Faults must be arrays of site/time records.');
      for (const f of faults) {
        if (!f || typeof f !== 'object') throw new RangeError('Each fault needs a site and time.');
        integer(f.site, 1, maxSite, 'Fault site'); integer(f.time, 1, T, 'Fault time');
      }
    }
    if (overwrites.some(f => f.bit !== 0 && f.bit !== 1)) throw new RangeError('Overwritten reports must be bits.');
    const keys = overwrites.map(f => `${f.site},${f.time}`);
    if (new Set(keys).size !== keys.length) throw new RangeError('Overwrite each report at most once.');
    const error = Array(d).fill(0), records = [parity(prepared)], dataHistory = [prepared.slice()], errorHistory = [error.slice()];
    const reportFaults = [], overwritten = [];
    for (let t = 1; t <= T; t++) {
      for (const f of dataFaults) if (f.time === t) error[f.site - 1] ^= 1;
      const data = prepared.map((b, q) => b ^ error[q]), truth = parity(data), row = truth.slice();
      for (const f of measurementFaults) if (f.time === t) row[f.site - 1] ^= 1;
      for (const f of overwrites) if (f.time === t) {
        row[f.site - 1] = f.bit;
        overwritten.push({ site: f.site, time: t, bit: f.bit, truth: truth[f.site - 1], changed: f.bit !== truth[f.site - 1] });
      }
      for (let i = 0; i < d - 1; i++) if (row[i] !== truth[i]) reportFaults.push({ site: i + 1, time: t });
      records.push(row); dataHistory.push(data); errorHistory.push(error.slice());
    }
    const finalData = dataHistory[T].slice();
    records.push(parity(finalData));
    const detectors = records.slice(1).map((row, t) => row.map((b, i) => b ^ records[t][i]));
    const events = [], perRound = [];
    detectors.forEach((row, t) => {
      row.forEach((b, i) => { if (b) events.push([i + 1, t + 1]); });
      perRound.push([t + 1, row.reduce((s, b) => s + b, 0) / (d - 1)]);
    });
    const bulkCount = events.filter(([, t]) => t >= 2 && t <= T).length;
    return { records, detectors, events, finalData, finalError: error.slice(), dataHistory, errorHistory, overwritten, reportFaults, perRound,
      fractions: { all: fraction(events.length, (d - 1) * (T + 1), 1, T + 1), bulk: fraction(bulkCount, (d - 1) * (T - 1), 2, T) } };
  }
  function graph(d, T) {
    dimensions(d, T);
    const endpoint = (check, time) => ({ check, time, boundary: check === 0 ? 'left' : check === d ? 'right' : null });
    const edges = [];
    for (let t = 1; t <= T; t++) {
      for (let q = 1; q <= d; q++) edges.push({ id: `data-${q}-${t}`, kind: 'data', site: q, time: t, endpoints: [endpoint(q - 1, t), endpoint(q, t)] });
      for (let i = 1; i < d; i++) edges.push({ id: `measurement-${i}-${t}`, kind: 'measurement', site: i, time: t, endpoints: [endpoint(i, t), endpoint(i, t + 1)] });
    }
    return edges;
  }
  function compute(params = {}, options = {}) {
    const p = { ...DEFAULTS, ...params }, warnings = [];
    try { dimensions(p.d, p.T); } catch (e) { warnings.push(e.message); }
    for (const [key, lo, hi, label] of [['site', 1, 7, 'Site'], ['time', 1, 10, 'First round'], ['leak_length', 1, 5, 'Leak length'], ['seed', 1, 99, 'Seed']]) {
      try { integer(p[key], lo, hi, label); } catch (e) { warnings.push(e.message); }
    }
    if (!['none', 'data', 'measurement', 'leak'].includes(p.pattern)) warnings.push('Choose one of the listed fault patterns.');
    if (!['all', 'bulk'].includes(p.fraction_set)) warnings.push('Choose all comparisons or bulk comparisons.');
    if (p.site > p.d) warnings.push('Change site or distance: the data site cannot exceed d.');
    if (p.pattern === 'measurement' && p.site >= p.d) warnings.push('Change site or distance: a report fault needs a check index from 1 to d-1.');
    if (p.time > p.T) warnings.push('Change the first affected round or T: the fault must occur in a measured round.');
    if (p.pattern === 'leak' && p.time + p.leak_length - 1 > p.T) warnings.push('Shorten the leak interval, move its start, or increase T so every affected round is measured.');
    const prepared = options.prepared === undefined ? Array(Number.isInteger(p.d) && p.d >= 3 && p.d <= 7 ? p.d : 3).fill(0) : options.prepared;
    try { bitstring(prepared, p.d); } catch (e) { warnings.push(e.message); }
    if (warnings.length) return { valid: false, params: p, warnings, series: {}, readouts: {} };
    const dataFaults = p.pattern === 'data' ? [{ site: p.site, time: p.time }] : [];
    const measurementFaults = p.pattern === 'measurement' ? [{ site: p.site, time: p.time }] : [];
    const touchedChecks = [p.site - 1, p.site].filter(i => i >= 1 && i < p.d), overwrites = [];
    const draws = p.pattern === 'leak' ? randomBits(p.seed, p.leak_length * touchedChecks.length) : [];
    let index = 0;
    if (p.pattern === 'leak') for (let t = p.time; t < p.time + p.leak_length; t++) for (const i of touchedChecks) overwrites.push({ site: i, time: t, bit: draws[index++] });
    const r = simulate({ d: p.d, T: p.T, prepared, dataFaults, measurementFaults, overwrites });
    const highlighted = [...dataFaults.map(f => `data-${f.site}-${f.time}`), ...r.reportFaults.map(f => `measurement-${f.site}-${f.time}`)];
    const selected = r.fractions[p.fraction_set];
    return { valid: true, params: p, warnings, ...r, prepared: prepared.slice(), randomBits: draws, touchedChecks,
      graph: graph(p.d, p.T), highlightedEdges: highlighted, series: { trace: r.perRound },
      readouts: {
        events: r.events.map(([i, t]) => `(S${i},${t})`).join(', ') || 'None',
        finalData: r.finalData.join(''), finalError: r.finalError.join(''),
        all: r.fractions.all.text, bulk: r.fractions.bulk.text,
        selected: selected.text, selectedFraction: selected.value,
        eligible: `${p.fraction_set === 'all' ? 'First, bulk and final' : 'Bulk only'}: t=${selected.first} through ${selected.last}`,
        overwritten: p.pattern === 'leak' ? Array.from({ length: p.leak_length }, (_, j) => `t=${p.time + j}: ${draws.slice(j * touchedChecks.length, (j + 1) * touchedChecks.length).join('')}`).join('; ') : 'None'
      } };
  }
  return { compute, simulate, parity, graph, randomBits };
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  function element(doc, parent, tag, attrs = {}, text) {
    const node = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = String(text);
    parent.appendChild(node);
    return node;
  }
  function board(svg, result, mode, selected) {
    const doc = svg.ownerDocument, { d, T, pattern, site } = result.params;
    const el = (tag, attrs, text, parent = svg) => element(doc, parent, tag, attrs, text);
    const text = (x, y, value, attrs = {}, parent = svg) => el('text', { x, y, fill: 'var(--text)', 'font-size': 13, 'text-anchor': 'middle', ...attrs }, value, parent);
    const x = i => 40 + i * 264 / d, y = t => 148 + 34 * t, bottom = y(T + 1);
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 320 ${bottom + 104}`);
    svg.setAttribute('aria-label', mode === 'reports' ? 'Recorded parity bits, known initial parities and final data readout. Time increases downward.' : 'Detector bits and possible single-fault edges. Select a detector to inspect its comparison. Time increases downward.');
    el('title', {}, mode === 'reports' ? 'Recorded parities s' : 'Detector events D and possible faults');
    text(160, 20, mode === 'reports' ? 'Recorded parities s' : 'Detector events D', { 'font-size': 16, 'font-weight': 'bold' });
    text(160, 39, 'Time ↓ · check index i →', { fill: 'var(--muted)' });
    for (let q = 1; q <= d; q++) {
      const cx = x(q - 0.5);
      text(cx, 62, `q${q}`, { 'font-size': 12 });
      el('circle', { cx, cy: 77, r: 7, fill: 'var(--bg)', stroke: 'var(--text)', 'stroke-width': 1.5 });
      if (pattern === 'data' && q === site) el('path', { d: `M${cx - 4} 73l8 8m0 -8l-8 8`, stroke: 'var(--plot-accent)', 'stroke-width': 2, fill: 'none' });
      if (pattern === 'leak' && q === site) el('circle', { cx, cy: 77, r: 11, fill: 'none', stroke: 'var(--plot-accent)', 'stroke-dasharray': '2 2' });
    }
    for (let i = 1; i < d; i++) {
      el('path', { d: `M${x(i - 0.5)} 86L${x(i)} 99L${x(i + 0.5)} 86`, stroke: 'var(--line)', fill: 'none' });
      el('rect', { x: x(i) - 4, y: 95, width: 8, height: 8, fill: 'var(--bg)', stroke: 'var(--plot-secondary)', 'stroke-width': 1.5 });
      text(x(i), 121, `S${i}`, { 'font-size': 12 });
    }
    el('rect', { x: 4, y: bottom - 16, width: 312, height: 32, fill: 'var(--plot-reference)', opacity: 0.12 });
    if (mode === 'detectors') {
      text(x(0), 137, 'L', { fill: 'var(--muted)', 'font-size': 12 });
      text(x(d), 137, 'R', { fill: 'var(--muted)', 'font-size': 12 });
      for (const i of [0, d]) el('line', { x1: x(i), x2: x(i), y1: y(1) - 12, y2: y(T) + 12, stroke: 'var(--muted)', 'stroke-dasharray': '4 4', opacity: 0.5 });
      function edge(e, highlighted) {
        const [a, b] = e.endpoints;
        el('line', { x1: x(a.check), y1: y(a.time), x2: x(b.check), y2: y(b.time),
          stroke: highlighted ? 'var(--plot-accent)' : 'var(--muted)', 'stroke-width': highlighted ? 3.5 : 1,
          'stroke-dasharray': e.kind === 'measurement' ? '2 4' : 'none', opacity: highlighted ? 1 : 0.28,
          'data-edge': e.id, 'data-highlighted': String(highlighted) });
        if (highlighted && e.kind === 'data') {
          const cx = (x(a.check) + x(b.check)) / 2, cy = y(a.time);
          el('path', { d: `M${cx - 4} ${cy - 4}l8 8m0 -8l-8 8`, stroke: 'var(--plot-accent)', 'stroke-width': 2, fill: 'none' });
        }
      }
      for (const e of result.graph) edge(e, false);
      for (const e of result.graph) if (result.highlightedEdges.includes(e.id)) edge(e, true);
    }
    for (let t = 0; t <= T + 1; t++) {
      text(17, y(t) + 4, t, { 'font-size': 12, fill: 'var(--muted)' });
      for (let i = 1; i < d; i++) {
        if (mode === 'detectors' && t === 0) { text(x(i), y(t) + 4, '·', { fill: 'var(--muted)' }); continue; }
        const value = mode === 'reports' ? result.records[t][i - 1] : result.detectors[t - 1][i - 1];
        const id = `${i}-${t}`, active = selected === id, overwritten = mode === 'reports' && result.overwritten.some(o => o.site === i && o.time === t);
        const group = el('g', mode === 'detectors' ? { 'data-cell': id, tabindex: 0, role: 'button', 'aria-pressed': String(active),
          'aria-label': `S${i}, comparison ${t}${t === T + 1 ? ', final data' : t === 1 ? ', known initial parity' : ''}, detector ${value}. Inspect comparison.` } : { 'data-report': id });
        el('rect', { x: x(i) - 13, y: y(t) - 14, width: 26, height: 28, rx: 3,
          fill: 'var(--bg)', stroke: active || overwritten ? 'var(--plot-accent)' : 'none', 'stroke-width': 2,
          'stroke-dasharray': overwritten ? '3 2' : 'none' }, undefined, group);
        if (value && mode === 'detectors') el('circle', { cx: x(i), cy: y(t), r: 11, fill: 'none', stroke: 'var(--plot-accent)', 'stroke-width': 2 }, undefined, group);
        text(x(i), y(t) + 4, value, { fill: value ? 'var(--plot-primary)' : 'var(--muted)', 'font-weight': value ? 'bold' : 'normal' }, group);
      }
    }
    if (mode === 'reports') {
      text(160, bottom + 39, 'Final data z · q1 to q' + d);
      for (let q = 1; q <= d; q++) {
        const cx = x(q - 0.5);
        el('circle', { cx, cy: bottom + 61, r: 12, fill: 'var(--bg)', stroke: 'var(--text)' });
        text(cx, bottom + 65, result.finalData[q - 1], { 'data-final-bit': String(q) });
      }
      text(160, bottom + 93, `Row ${T + 1}: parity from these data bits`, { 'font-size': 12, fill: 'var(--muted)' });
    } else {
      text(160, bottom + 39, 'L / R: spatial virtual boundaries', { 'font-size': 12, fill: 'var(--muted)' });
      text(160, bottom + 61, `Row ${T + 1}: final data comparison`, { 'font-size': 12 });
      text(160, bottom + 83, 'No data faults after measured round T', { 'font-size': 12, fill: 'var(--muted)' });
    }
  }
  StudyLab.register('detector-board', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const grids = doc.createElement('div');
    grids.style.display = 'grid'; grids.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))';
    grids.style.gap = '12px'; grids.style.minWidth = '0';
    layout.plots.appendChild(grids);
    const svgs = ['reports', 'detectors'].map(mode => {
      const holder = doc.createElement('div'); holder.style.minWidth = '0'; holder.style.overflowX = 'auto';
      holder.setAttribute('tabindex', '0'); holder.setAttribute('aria-label', `${mode} grid; scroll if needed`); grids.appendChild(holder);
      const svg = element(doc, holder, 'svg', { width: '100%', role: mode === 'reports' ? 'img' : 'group', 'data-grid': mode });
      svg.style.minWidth = '300px'; svg.style.maxWidth = '560px'; svg.style.display = 'block'; svg.style.margin = '0 auto';
      return svg;
    });
    const chart = ctx.plot(layout.plots, {
      title: 'Fraction of checks firing at each comparison',
      x: { label: 'Comparison t (rounds), time →', domain: 'auto' },
      y: { label: 'Firing checks / (d−1)', domain: [0, 1] }, legend: true
    });
    let selected = null;
    function draw() {
      const r = ctx.model.compute(ctx.state.all());
      ctx.warn(layout.notes, r.warnings.join(' ') || null);
      if (!r.valid) {
        for (const svg of svgs) { svg.replaceChildren(); svg.setAttribute('aria-label', 'Change controls to obtain a valid record.'); }
        chart.update([]); ctx.readouts(layout.readouts, []); ctx.notes(layout.notes, ''); return;
      }
      board(svgs[0], r, 'reports', selected); board(svgs[1], r, 'detectors', selected);
      chart.update([
        { id: 'trace-line', label: 'Straight connectors between comparisons', role: 'primary', kind: 'line', points: r.series.trace },
        { id: 'trace', label: 'Each comparison (including both endcaps)', role: 'primary', kind: 'scatter', points: r.series.trace }
      ],
        [{ type: 'vline', x: 1, label: 'First', role: 'reference' }, { type: 'vline', x: r.params.T + 1, label: 'Final data', role: 'reference' }]);
      const out = r.readouts;
      ctx.readouts(layout.readouts, [
        { label: 'Detection events (check, comparison)', value: out.events },
        { label: 'Final data bits (q1 first)', value: out.finalData },
        { label: 'True accumulated X-error bits (q1 first)', value: out.finalError },
        { label: 'All comparisons: fired / eligible', value: out.all },
        { label: 'Bulk comparisons: fired / eligible', value: out.bulk },
        { label: 'Selected eligible set', value: out.eligible },
        { label: 'Selected event fraction', value: out.selected },
        ...(r.params.pattern === 'leak' ? [{ label: `Overwritten reports (checks ${r.touchedChecks.map(i => 'S' + i).join(', ')})`, value: out.overwritten }] : [])
      ]);
      let inspection = 'Select a detector with a pointer or Tab then Enter/Space to inspect its comparison.';
      if (selected) {
        const [i, t] = selected.split('-').map(Number), previous = r.records[t - 1][i - 1], current = r.records[t][i - 1];
        const previousLabel = t === 1 ? 'known initial parity' : `report at t=${t - 1}`;
        const currentLabel = t === r.params.T + 1 ? 'final data parity' : `report at t=${t}`;
        inspection = `S${i}, comparison ${t}: ${currentLabel} ${current} XOR ${previousLabel} ${previous} gives D=${current ^ previous}. S${i} checks Z on q${i} and q${i + 1}.`;
      }
      let mechanism = '';
      if (r.params.pattern === 'data') mechanism = `The X on q${r.params.site} arrives before round ${r.params.time}. It remains in the data, so the adjacent reports stay changed. Their differences fire only on arrival.`;
      if (r.params.pattern === 'measurement') mechanism = `Only S${r.params.site}'s report at t=${r.params.time} is wrong. Its temporal edge joins comparisons ${r.params.time} and ${r.params.time + 1}${r.params.time === r.params.T ? ', where final data close the record' : ''}.`;
      if (r.params.pattern === 'leak') mechanism = 'Outlined report cells were overwritten, even when the sampled bit equals the true parity. Each wrong report has a separate dotted edge. Consecutive wrong reports cancel at a shared detector; the data themselves remain unchanged.';
      ctx.notes(layout.notes, `<p>${inspection}</p>` +
        '<p>Row 0 holds the known initial parity and has no detector. The shaded last row uses final data parities. Muted graph edges show possible single faults; highlighted edges show the history injected with the controls. No history has been inferred from the events.</p>' +
        (mechanism ? `<p>${mechanism}</p>` : '<p>Every report agrees with its reference, so no detector fires.</p>') +
        `<p>The selected fraction uses ${out.eligible.toLowerCase()}. The trace always shows every comparison. Compare the data-pair and measurement-pair presets: equal totals retain different spatial and temporal patterns.</p>`);
    }
    function select(event) {
      const target = event.target.closest('[data-cell]');
      if (!target || !svgs[1].contains(target)) return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault(); selected = target.getAttribute('data-cell'); draw();
      svgs[1].querySelector(`[data-cell="${selected}"]`)?.focus();
    }
    svgs[1].addEventListener('click', select); svgs[1].addEventListener('keydown', select);
    const unsubscribe = ctx.state.onChange(() => { selected = null; draw(); });
    draw();
    return { destroy() {
      unsubscribe(); svgs[1].removeEventListener('click', select); svgs[1].removeEventListener('keydown', select);
      chart.destroy?.(); grids.remove();
    } };
  });
})();

}).call(window);
