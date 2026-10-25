/* bb-code-builder: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['bb-code-builder'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const defaults = {ell: 3, m: 2, a_menu: 'tiny', b_menu: 'tiny', focus_i: 0, focus_j: 0};
  const menus = {
    A: {standard: [[3, 0], [0, 1], [0, 2]], tiny: [[0, 0], [1, 0], [2, 0]], kunlun: [[1, 0], [0, 0], [0, 2]]},
    B: {standard: [[0, 3], [1, 0], [2, 0]], tiny: [[1, 0], [2, 0], [0, 1]], kunlun: [[0, 1], [0, 0], [2, 0]]}
  };
  const mod = (x, n) => ((x % n) + n) % n;
  const bit = q => 1n << BigInt(q);
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function normalizeParams(raw = {}) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const integer = (key, low, high) => Math.max(low, Math.min(high,
      Math.round(typeof input[key] === 'number' && Number.isFinite(input[key]) ? input[key] : defaults[key])));
    const ell = integer('ell', 3, 18), m = integer('m', 2, 12);
    const menu = key => ['standard', 'tiny', 'kunlun'].includes(input[key]) ? input[key] : defaults[key];
    return {ell, m, a_menu: menu('a_menu'), b_menu: menu('b_menu'),
      focus_i: mod(integer('focus_i', 0, 17), ell), focus_j: mod(integer('focus_j', 0, 11), m)};
  }
  function monomials(menu, which) {
    if (!Object.hasOwn(menus, which)) throw new RangeError('Choose polynomial A or B.');
    return (Object.hasOwn(menus[which], menu) ? menus[which][menu] : menus[which].tiny).map(pair => pair.slice());
  }
  function dimensions(ell, m) {
    if (!Number.isInteger(ell) || ell < 3 || ell > 18 || !Number.isInteger(m) || m < 2 || m > 12)
      throw new RangeError('Torus dimensions must be integers within the control ranges.');
  }
  function reducedTerms(ell, m, terms) {
    const support = new Map();
    for (const [a, b] of terms) {
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new RangeError('Hop exponents must be integers.');
      const i = mod(a, ell), j = mod(b, m), key = i * m + j;
      if (support.has(key)) support.delete(key); else support.set(key, [i, j]);
    }
    return [...support.entries()].sort(([a], [b]) => a - b).map(([, pair]) => pair);
  }
  function shiftRows(ell, m, terms) {
    dimensions(ell, m);
    const normalized = reducedTerms(ell, m, terms);
    return Array.from({length: ell * m}, (_, q) => normalized.reduce((row, [a, b]) =>
      row ^ bit(mod(Math.floor(q / m) + a, ell) * m + mod(q % m + b, m)), 0n));
  }
  function binaryRows(rows) {
    if (!Array.isArray(rows) || rows.some(row => typeof row !== 'bigint' || row < 0n))
      throw new TypeError('Binary rows must be nonnegative BigInt masks.');
  }
  function transpose(rows, ncols) {
    binaryRows(rows);
    if (!Number.isSafeInteger(ncols) || ncols < 0 || ncols > 432 || rows.some(row => row >> BigInt(ncols)))
      throw new RangeError('The column count must include every occupied bit.');
    const result = Array(ncols).fill(0n);
    rows.forEach((row, i) => { for (let j = 0; row; j++, row >>= 1n) if (row & 1n) result[j] ^= bit(i); });
    return result;
  }
  function rankProfile(rows) {
    binaryRows(rows);
    const pivots = new Map(), points = [[0, 0]];
    rows.forEach((row, i) => {
      while (row) {
        const pivot = row.toString(2).length - 1;
        if (!pivots.has(pivot)) { pivots.set(pivot, row); break; }
        row ^= pivots.get(pivot);
      }
      points.push([i + 1, pivots.size]);
    });
    return points;
  }
  const gf2Rank = rows => rankProfile(rows).at(-1)[1];
  function support(row) {
    const result = [];
    for (let q = 0; row; q++, row >>= 1n) if (row & 1n) result.push(q);
    return result;
  }
  function parity(row) { let result = 0; while (row) { result ^= 1; row &= row - 1n; } return result; }
  function buildCode(raw = {}) {
    const params = normalizeParams(raw), {ell, m} = params, s = ell * m;
    const termOrder = {A: monomials(params.a_menu, 'A'), B: monomials(params.b_menu, 'B')};
    const terms = {A: reducedTerms(ell, m, termOrder.A), B: reducedTerms(ell, m, termOrder.B)};
    const A = shiftRows(ell, m, termOrder.A), B = shiftRows(ell, m, termOrder.B);
    const AT = transpose(A, s), BT = transpose(B, s);
    const hx = A.map((row, q) => row | (B[q] << BigInt(s)));
    const hz = BT.map((row, q) => row | (AT[q] << BigInt(s)));
    const profile = rankProfile(hx), ranks = {A: gf2Rank(A), B: gf2Rank(B),
      stacked: gf2Rank([...A, ...B]), X: profile.at(-1)[1], Z: gf2Rank(hz)};
    const n = 2 * s, k = n - ranks.X - ranks.Z, commonKernelDimension = s - ranks.stacked;
    const commutes = hx.every(x => hz.every(z => parity(x & z) === 0));
    if (!commutes || k !== 2 * commonKernelDimension) throw new Error('The binary code invariants failed.');
    const HX = hx.map(support), HZ = hz.map(support);
    const degrees = rows => { const result = Array(n).fill(0); rows.forEach(row => row.forEach(q => result[q]++)); return result; };
    const data = Array.from({length: n}, (_, q) => {
      const index = q % s, register = q < s ? 'L' : 'R', i = Math.floor(index / m), j = index % m;
      return {q, register, i, j, label: `${register}(${i},${j})`};
    });
    return freeze({params, ell, m, s, n, k, terms, termOrder, data, dataLabels: data.map(site => site.label),
      A: A.map(support), B: B.map(support), HX, HZ, ranks, commonKernelDimension,
      checkWeights: {X: HX.map(row => row.length), Z: HZ.map(row => row.length)},
      dataDegrees: {X: degrees(HX), Z: degrees(HZ)}, commutes, rankProfile: profile,
      cancelled: terms.A.length !== 3 || terms.B.length !== 3});
  }
  function exponentLabel([a, b]) {
    return [a ? (a === 1 ? 'x' : `x^${a}`) : '', b ? (b === 1 ? 'y' : `y^${b}`) : ''].filter(Boolean).join(' ') || '1';
  }
  function oneCheck(code, kind, i, j) {
    if (!['X', 'Z'].includes(kind) || !Number.isFinite(i) || !Number.isFinite(j))
      throw new RangeError('Choose an X or Z check with finite coordinates.');
    i = mod(Math.round(i), code.ell); j = mod(Math.round(j), code.m);
    const indices = code[kind === 'X' ? 'HX' : 'HZ'][i * code.m + j].slice();
    const sign = kind === 'X' ? 1 : -1;
    const incidences = indices.map(q => {
      const site = code.data[q], which = (kind === 'X') === (site.register === 'L') ? 'A' : 'B';
      const matching = code.termOrder[which].filter(([a, b]) =>
        mod(i + sign * a, code.ell) === site.i && mod(j + sign * b, code.m) === site.j);
      const exponent = matching[0].map(x => x === 0 ? 0 : sign * x);
      return {...site, polynomial: which, exponent, hopLabel: exponentLabel(exponent),
        seamX: i + exponent[0] < 0 || i + exponent[0] >= code.ell,
        seamY: j + exponent[1] < 0 || j + exponent[1] >= code.m};
    });
    return {kind, i, j, label: `${kind}(${i},${j})`, support: indices,
      sites: indices.map(q => code.dataLabels[q]), incidences};
  }
  // For a supplied X origin the companion is (+1,+1); for Z it is (-1,-1).
  function checkSupport(code, kind, i, j) {
    const selected = oneCheck(code, kind, i, j), offset = kind === 'X' ? 1 : -1;
    const paired = oneCheck(code, kind === 'X' ? 'Z' : 'X', selected.i + offset, selected.j + offset);
    const intersectionIndices = selected.support.filter(q => paired.support.includes(q));
    return freeze({...selected, paired, intersectionIndices,
      intersection: intersectionIndices.map(q => code.dataLabels[q]), parity: intersectionIndices.length % 2});
  }
  function fingerprint(ell, m, A, B) {
    return JSON.stringify([ell, m, reducedTerms(ell, m, A), reducedTerms(ell, m, B)]);
  }
  function reportedDistance(raw = {}) {
    const p = normalizeParams(raw);
    const actual = fingerprint(p.ell, p.m, monomials(p.a_menu, 'A'), monomials(p.b_menu, 'B'));
    const sources = [[6, 6, 'standard', 6], [9, 6, 'standard', 10], [12, 6, 'standard', 12], [3, 3, 'kunlun', 4]];
    for (const [ell, m, menu, value] of sources) {
      if (actual === fingerprint(ell, m, monomials(menu, 'A'), monomials(menu, 'B')))
        return freeze({value, ref: menu === 'kunlun' ? 'wang_kunlun_bb_2026' : 'bravyi_gross_code_2024',
          loc: menu === 'kunlun' ? 'PDF p. 13' : 'PDF p. 8, Table 3', status: 'source-reported'});
    }
    return freeze({value: null, status: 'not supplied'});
  }
  function evaluate(raw = {}) {
    try {
      const code = buildCode(raw), params = code.params;
      const xCheck = checkSupport(code, 'X', params.focus_i, params.focus_j), zCheck = xCheck.paired;
      const distance = reportedDistance(params);
      const weight = values => Math.min(...values) === Math.max(...values) ? values[0] : `${Math.min(...values)} to ${Math.max(...values)}`;
      const shared = `${xCheck.intersection.length} (${xCheck.intersection.join(', ') || 'none'})`;
      const readouts = [
        {label: 'Data qubits n', value: code.n}, {label: 'Rank of H_X', value: code.ranks.X},
        {label: 'Rank of H_Z', value: code.ranks.Z}, {label: 'Encoded qubits k', value: code.k},
        {label: 'X-check weight', value: weight(code.checkWeights.X)}, {label: 'Z-check weight', value: weight(code.checkWeights.Z)},
        {label: 'Shared sites of the pictured checks', value: shared},
        {label: 'Distance', value: distance.value === null ? 'Not supplied' : `Source-reported: ${distance.value}`}];
      return freeze({valid: true, error: null, params, code, xCheck, zCheck, intersection: xCheck.intersection,
        parity: xCheck.parity, distance, readouts, sharedReadout: `Shared sites of the pictured checks: ${shared}`,
        rankProfile: code.rankProfile, warnings: code.cancelled ? ['Some hops coincide and cancel. This choice no longer has six-qubit checks.'] : [],
        encodedMessage: code.k === 0 ? 'No encoded qubits' : ''});
    } catch (error) {
      const message = `Model error: ${error instanceof Error ? error.message : 'The code could not be formed.'}`;
      return freeze({valid: false, error: message, warnings: [message], readouts: [{label: 'Model error', value: message}], rankProfile: []});
    }
  }
  return {normalizeParams, monomials, shiftRows, transpose, gf2Rank, rankProfile, buildCode, checkSupport, reportedDistance, evaluate};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  // The named hues keep the two check types recognizable in every course theme.
  const colors = {X: 'var(--plot-secondary)', Z: 'var(--plot-primary)'};
  function topology(svg, result) {
    const doc = svg.ownerDocument, c = result.code, pitch = 36;
    const width = Math.max(540, 180 + (c.ell - 1) * pitch), sheetHeight = 210 + (c.m - 1) * pitch;
    const left = (width - (c.ell - 1) * pitch) / 2, right = width - left;
    svg.setAttribute('viewBox', `0 0 ${width} ${2 * sheetHeight}`);
    svg.style.minWidth = `${width}px`;
    svg.replaceChildren();
    function el(tag, attrs = {}, text, parent = svg) {
      const node = doc.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text !== undefined) node.textContent = text;
      parent.appendChild(node); return node;
    }
    function label(x, y, text, attrs = {}) {
      return el('text', {x, y, fill: 'var(--text)', 'font-size': 13, 'text-anchor': 'middle', ...attrs}, text);
    }
    el('title', {}, `${result.xCheck.label} and ${result.zCheck.label} on two raw torus sheets`);
    el('desc', {}, `${result.sharedReadout}. X support is solid amber. Z support is dashed teal. ` +
      'Arrows in matched boundary pairs mark periodic hops. Halos mark shared sites. The text lists give every support coordinate and hop.');
    const shared = new Set(result.intersection);
    for (const [sheetNumber, register] of ['L', 'R'].entries()) {
      const offset = sheetNumber * sheetHeight, top = offset + 150, bottom = top + (c.m - 1) * pitch;
      const position = site => [left + site.i * pitch, top + site.j * pitch];
      const group = el('g', {'data-sheet': register, role: 'group', 'aria-label': `${register} sheet, ${c.ell} columns and ${c.m} rows`});
      label(width / 2, offset + 25, `${register} sheet`, {'font-size': 17, 'font-weight': 'bold'});
      label(width / 2, offset + 49, 'i increases right; j increases down');
      el('rect', {x: left - 18, y: top - 18, width: right - left + 36, height: bottom - top + 36,
        fill: 'none', stroke: 'var(--line)', 'stroke-dasharray': '3 4'}, undefined, group);
      for (let i = 0; i < c.ell; i++) label(left + i * pitch, bottom + 40, String(i));
      for (let j = 0; j < c.m; j++) label(left - 38, top + j * pitch + 4, String(j));
      label(width / 2, bottom + 59, 'i');
      label(left - 58, (top + bottom) / 2, 'j');
      for (const check of [result.xCheck, result.zCheck]) {
        const kind = check.kind, color = colors[kind], mx = kind === 'X' ? 65 : width - 65, my = offset + 88;
        const lineStyle = {stroke: color, 'stroke-width': 2, 'stroke-dasharray': kind === 'Z' ? '6 4' : 'none', fill: 'none'};
        for (const incidence of check.incidences.filter(site => site.register === register)) {
          const [x, y] = position(incidence), attrs = {'data-incidence': `${check.label}:${incidence.label}`};
          el('line', {x1: mx, y1: my, x2: x, y2: y, ...lineStyle, ...attrs}, undefined, group);
          label(x + 10, y + (kind === 'X' ? -11 : 22), incidence.hopLabel,
            {fill: color, 'text-anchor': 'start', 'data-hop': `${check.label}:${incidence.label}`});
          // Both members carry the same label and point in the algebraic hop direction.
          function seam(axis, side, cx, cy, direction) {
            const d = axis === 'x'
              ? `M${cx - direction * 5} ${cy - 5} L${cx + direction * 3} ${cy} L${cx - direction * 5} ${cy + 5}`
              : `M${cx - 5} ${cy - direction * 5} L${cx} ${cy + direction * 3} L${cx + 5} ${cy - direction * 5}`;
            const arrow = el('path', {d, ...lineStyle, 'data-seam': `${check.label}:${incidence.label}:${axis}`, 'data-side': side}, undefined, group);
            el('title', {}, `${check.label} to ${incidence.label}, ${incidence.hopLabel}, paired ${axis} boundary arrow`, arrow);
          }
          if (incidence.seamX) for (const [side, bx] of [['left', left - 18], ['right', right + 18]])
            seam('x', side, bx, y + (kind === 'X' ? -6 : 6), Math.sign(incidence.exponent[0]));
          if (incidence.seamY) for (const [side, by] of [['top', top - 18], ['bottom', bottom + 18]])
            seam('y', side, x + (kind === 'X' ? -6 : 6), by, Math.sign(incidence.exponent[1]));
        }
        el('rect', {x: mx - 7, y: my - 7, width: 14, height: 14, fill: 'var(--bg)', ...lineStyle,
          'data-check': check.label}, undefined, group);
        label(mx, my - 18, check.label, {fill: color, 'font-weight': 'bold'});
      }
      for (const site of c.data.filter(site => site.register === register)) {
        const [cx, cy] = position(site);
        if (shared.has(site.label)) el('circle', {cx, cy, r: 16, fill: 'none', stroke: 'var(--text)',
          'stroke-width': 1.5, 'data-intersection-halo': site.label}, undefined, group);
        el('circle', {cx, cy, r: 4, fill: 'var(--bg)', stroke: 'var(--muted)', 'data-site': site.label}, undefined, group);
        for (const [check, r] of [[result.xCheck, 8], [result.zCheck, 11]]) if (check.support.includes(site.q)) {
          const ring = el('circle', {cx, cy, r, fill: 'none', stroke: colors[check.kind], 'stroke-width': 2,
            'stroke-dasharray': check.kind === 'Z' ? '4 3' : 'none', 'data-support': `${check.label}:${site.label}`}, undefined, group);
          el('title', {}, `${site.label} in ${check.label}`, ring);
        }
      }
    }
  }
  StudyLab.register('bb-code-builder', function mount(root, ctx) {
    const layout = ctx.layout(root), doc = root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const caption = doc.createElement('p');
    caption.textContent = 'X support is solid amber; Z support is dashed teal. The paired Z check is at (i+1 mod ell, j+1 mod m). Halos mark shared sites, not data-to-data couplings.';
    layout.plots.appendChild(caption);
    const holder = doc.createElement('div'); holder.style.overflowX = 'auto';
    holder.setAttribute('tabindex', '0'); holder.setAttribute('aria-label', 'Two torus sheets; scroll horizontally on narrow screens');
    layout.plots.appendChild(holder);
    const svg = doc.createElementNS(NS, 'svg'); svg.id = `${ctx.id}-torus`;
    svg.setAttribute('width', '100%'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'L and R data sheets with selected X and Z check supports'); holder.appendChild(svg);
    const lists = doc.createElement('div'); lists.setAttribute('aria-live', 'polite'); lists.setAttribute('data-support-lists', '');
    layout.plots.appendChild(lists);
    const distanceNote = doc.createElement('p'); distanceNote.textContent = 'This lab does not calculate distance.';
    layout.readouts.appendChild(distanceNote);
    let chart = null, chartSize = null, syncing = false;
    function text(parent, tag, value) { const node = doc.createElement(tag); node.textContent = value; parent.appendChild(node); return node; }
    function draw() {
      if (syncing) return;
      const raw = ctx.state.all(), result = ctx.model.evaluate(raw);
      ctx.warn(layout.notes, result.warnings.join(' ') || null);
      if (!result.valid) {
        svg.replaceChildren(); svg.setAttribute('viewBox', '0 0 540 90');
        const message = doc.createElementNS(NS, 'text');
        message.setAttribute('x', '16'); message.setAttribute('y', '40'); message.setAttribute('fill', 'var(--text)');
        message.textContent = result.error; svg.appendChild(message);
        lists.replaceChildren(); text(lists, 'p', result.error); chart?.update([]);
        ctx.readouts(layout.readouts, result.readouts); ctx.notes(layout.notes, 'Change a control or choose Defaults to form the code again.');
        return;
      }
      // Keep the SDK's visible controls and persisted state in the same normalized coordinates.
      syncing = true;
      try { for (const [key, value] of Object.entries(result.params)) if (raw[key] !== value) ctx.state.set(key, value); }
      finally { syncing = false; }
      topology(svg, result);
      lists.replaceChildren();
      text(lists, 'p', `${result.xCheck.label} and ${result.zCheck.label}. ${result.sharedReadout}. Shared-site parity: ${result.parity}.`);
      for (const check of [result.xCheck, result.zCheck]) {
        text(lists, 'p', `${check.label} support: ${check.sites.join(', ') || 'none'}.`);
        const list = doc.createElement('ul'); lists.appendChild(list);
        for (const site of check.incidences) text(list, 'li', `${site.label}: ${site.polynomial} hop ${site.hopLabel}` +
          (site.seamX || site.seamY ? `; wraps ${[site.seamX ? 'i' : '', site.seamY ? 'j' : ''].filter(Boolean).join(' and ')}` : '') + '.');
      }
      if (chartSize !== result.code.s) {
        chart?.destroy?.(); chart?.svg?.parentNode?.remove();
        // The SDK domains are fixed per controller; replace only when the torus size changes.
        chart = ctx.plot(layout.plots, {title: 'Rank of successive X-check row prefixes',
          x: {label: 'X-check rows included, t', domain: [0, result.code.s]},
          y: {label: 'Binary rank r(t)', domain: [0, result.code.s]}, legend: true});
        chartSize = result.code.s;
      }
      chart.update([{id: 'rank-profile', label: 'Binary rank r(t)', role: 'primary', kind: 'line', points: result.rankProfile}]);
      ctx.readouts(layout.readouts, result.readouts);
      const source = result.distance.value === null ? 'Not supplied for these reduced polynomials and torus dimensions.' :
        `Source-reported: ${result.distance.value}. ${result.distance.ref === 'bravyi_gross_code_2024' ? 'Bravyi et al.' : 'Wang et al.'}, ${result.distance.loc}.`;
      ctx.notes(layout.notes, (result.encodedMessage ? `${result.encodedMessage}. ` : '') +
        'A flat step in the line means the next X-check row follows from earlier rows. Focus selects the pictured checks and leaves both ranks unchanged. ' + source);
    }
    const unsubscribe = ctx.state.onChange(draw);
    draw();
    return {destroy() { unsubscribe(); chart?.destroy?.(); holder.remove(); lists.remove(); caption.remove(); distanceNote.remove(); }};
  });
})();

}).call(window);
