/* decoder-sets-threshold: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['decoder-sets-threshold'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Module 5 architect handoff, 2026-10-17, labs.json fixed.browne.
  // Gray-code enumeration of 2^24 independent plaquette products; verified
  // separately by a 32-state face-spin transfer matrix (also in our tests).
  // Class order: R, R xor vertical, R xor horizontal, R xor both.
  const BROWNE_HISTOGRAMS = [[0,0,0,3,0,11,0,106,0,535,0,3223,0,16632,0,76624,0,291120,0,864054,0,1953302,0,3248900,0,3866150,0,3254502,0,1951808,0,859360,0,291656,0,78887,0,17063,0,2914,0,331,0,35,0,0,0,0,0,0,0],
    [0,0,0,0,4,0,26,0,203,0,1325,0,7361,0,36622,0,153526,0,519162,0,1346550,0,2619130,0,3703324,0,3706612,0,2621360,0,1343386,0,517722,0,154966,0,37382,0,7236,0,1161,0,143,0,15,0,0,0,0,0,0],
    [0,0,0,0,0,0,15,0,143,0,1161,0,7236,0,37382,0,154966,0,517722,0,1343386,0,2621360,0,3706612,0,3703324,0,2619130,0,1346550,0,519162,0,153526,0,36622,0,7361,0,1325,0,203,0,26,0,4,0,0,0,0],
    [0,0,0,0,0,0,0,35,0,331,0,2914,0,17063,0,78887,0,291656,0,859360,0,1951808,0,3254502,0,3866150,0,3248900,0,1953302,0,864054,0,291120,0,76624,0,16632,0,3223,0,535,0,106,0,11,0,3,0,0,0]];
  const DEFAULTS = {board: 'small-patch', p: 0.1, show_counts: false};
  const bit = q => 1n << BigInt(q);
  const mask = support => support.reduce((m, q) => m ^ bit(q), 0n);
  function weight(m) { let w = 0; for (let a = BigInt(m); a; a &= a - 1n) w++; return w; }
  function popcount(m) { let w = 0; for (; m; m &= m - 1) w++; return w; }
  const support = (m, n) => Array.from({length: n}, (_, q) => q).filter(q => (BigInt(m) & bit(q)) !== 0n);
  function deepFreeze(x) {
    if (x && typeof x === 'object') { Object.values(x).forEach(deepFreeze); Object.freeze(x); }
    return x;
  }
  function edge(axis, x, y) {
    return {id: `${axis}(${x},${y})`, axis, col: x, row: y,
      x: x + (axis === 'h' ? 0.5 : 0), y: y + (axis === 'v' ? 0.5 : 0),
      ends: [[x, y], [x + (axis === 'h' ? 1 : 0), y + (axis === 'v' ? 1 : 0)]]};
  }
  function smallPatch() {
    const edges = [], checks = [];
    for (let y = 1; y <= 2; y++) for (let x = 0; x < 2; x++) edges.push(edge('h', x, y));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) edges.push(edge('v', x, y));
    const index = new Map(edges.map((e, q) => [e.id, q]));
    const ids = coords => coords.map(([a, x, y]) => index.get(`${a}(${x},${y})`)).filter(q => q !== undefined).sort((a,b) => a-b);
    for (let y = 1; y <= 2; y++) for (let x = 0; x < 3; x++) checks.push({id: `X(${x},${y})`, type: 'X', x, y,
      support: ids([['h',x-1,y], ['h',x,y], ['v',x,y-1], ['v',x,y]])});
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) checks.push({id: `Z(${x},${y})`, type: 'Z', x: x+0.5, y: y+0.5,
      support: ids([['h',x,y], ['h',x,y+1], ['v',x,y], ['v',x+1,y]])});
    return {id: 'small-patch', n: 13, width: 2, height: 3, periodic: false, edges, checks,
      logicalX: [4,5,6], logicalZ: [4,7,10], reference: 272n, candidateB: 2049n};
  }
  function browneBoard() {
    const L = 5, edges = [], checks = [], mod = a => (a % L + L) % L;
    const h = (x,y) => mod(y)*L+mod(x), v = (x,y) => L*L+mod(y)*L+mod(x);
    for (const a of ['h','v']) for (let y=0;y<L;y++) for (let x=0;x<L;x++) edges.push(edge(a,x,y));
    for (const type of ['X','Z']) for (let y=0;y<L;y++) for (let x=0;x<L;x++) checks.push({
      id: `${type}(${x},${y})`, type, x: x+(type==='Z'?0.5:0), y: y+(type==='Z'?0.5:0),
      support: (type==='X'?[h(x-1,y),h(x,y),v(x,y-1),v(x,y)]:[h(x,y),h(x,y+1),v(x,y),v(x+1,y)]).sort((a,b)=>a-b)
    });
    const actual = mask([h(2,1),h(3,1),v(4,1),v(4,2),h(3,3),v(3,3),h(2,2),h(2,3),v(2,2),v(3,2)]);
    const reference = mask([h(2,1),v(3,0),v(3,4)]);
    return {id: 'browne', L, n: 50, width: L, height: L, periodic: true, edges, checks, actual, reference,
      residual: actual ^ reference, horizontal: mask(Array.from({length:L},(_,x)=>h(x,0))),
      vertical: mask(Array.from({length:L},(_,y)=>v(0,y)))};
  }
  function syndrome(code, error) {
    return code.checks.map(ch => ch.type === 'X' ? weight(mask(ch.support) & BigInt(error)) % 2 : 0);
  }
  function winding(code, cycle) {
    if (!code.periodic || syndrome(code, cycle).some(Boolean)) return null;
    let horizontal = 0, vertical = 0;
    code.edges.forEach((e,q) => {
      if ((BigInt(cycle) & bit(q)) !== 0n) {
        if (e.axis === 'h' && e.col === code.L-1) horizontal ^= 1;
        if (e.axis === 'v' && e.row === code.L-1) vertical ^= 1;
      }
    });
    return [horizontal, vertical];
  }
  function enumerateSmall(code) {
    const rows = code.checks.filter(ch=>ch.type==='X').map(ch=>Number(mask(ch.support)));
    const logical = Number(mask(code.logicalX)), reference = Number(code.reference);
    const histograms = [Array(14).fill(0), Array(14).fill(0)];
    let minimumMask = null, minimumWeight = Infinity;
    for (let e=0; e<8192; e++) {
      const s = rows.reduce((a,r,i) => a | ((popcount(e&r)%2)<<i), 0);
      if (s !== 19) continue;
      const w = popcount(e), cls = popcount((e^reference)&logical)%2;
      histograms[cls][w]++;
      if (w<minimumWeight || (w===minimumWeight && e<minimumMask)) { minimumWeight=w; minimumMask=e; }
    }
    return {histograms, minimumMask, minimumWeight};
  }
  const SMALL = deepFreeze(smallPatch()), BROWNE = deepFreeze(browneBoard());
  const SMALL_COUNTS = deepFreeze(enumerateSmall(SMALL));
  deepFreeze(BROWNE_HISTOGRAMS); deepFreeze(DEFAULTS);
  function geometry(board) {
    if (board === 'small-patch') return SMALL;
    if (board === 'browne') return BROWNE;
    throw new RangeError('Choose Small patch or Browne.');
  }
  function enumerators(board) {
    geometry(board);
    return board === 'small-patch' ? SMALL_COUNTS.histograms : BROWNE_HISTOGRAMS;
  }
  function classProbabilities(histograms, p) {
    if (!Number.isFinite(p) || p <= 0 || p > 0.5) throw new RangeError('p must be positive and at most 0.5.');
    const t = p/(1-p);
    // Cancel the common Bernoulli factor (1-p)^n before normalization.
    const polynomials = histograms.map(row => {
      let a = 0; for (let w=row.length-1; w>=0; w--) a = a*t + row[w]; return a;
    });
    const total = polynomials.reduce((a,b)=>a+b,0);
    return polynomials.map(a=>a/total);
  }
  function selectML(posterior) {
    const largest = Math.max(...posterior);
    const tied = posterior.map((p,i)=>largest-p<=1e-12?i:-1).filter(i=>i>=0);
    return {index: tied[0], tie: tied.length>1, tied};
  }
  function probabilitySweep(board, selectedP) {
    const histograms = enumerators(board);
    const ps = [...new Set([...Array.from({length:201},(_,i)=>0.001+0.499*i/200), selectedP])].sort((a,b)=>a-b);
    return ps.map(p=>({p, posterior: classProbabilities(histograms,p)}));
  }
  function compute(params = {}) {
    const p = {...DEFAULTS,...params}, warnings = [];
    if (!['small-patch','browne'].includes(p.board)) warnings.push('Choose Small patch or Browne.');
    if (!Number.isFinite(p.p) || p.p<0.001 || p.p>0.5) warnings.push('p must be a finite probability from 0.001 to 0.5 per data edge.');
    if (typeof p.show_counts !== 'boolean') warnings.push('Show counts must be on or off.');
    if (warnings.length) return {valid:false,params:p,warnings};
    const code = geometry(p.board), histograms = enumerators(p.board), small = p.board==='small-patch';
    const classes = small?['A','B']:['00','01','10','11'];
    const posterior = classProbabilities(histograms,p.p), ml = selectML(posterior);
    const weights = histograms.map(row=>row.findIndex(a=>a>0));
    const minimumIndex = small ? popcount((SMALL_COUNTS.minimumMask^272)&112)%2 : weights.indexOf(Math.min(...weights));
    const readouts = {weights, posterior, minimum_weight:classes[minimumIndex], MW:classes[minimumIndex], ML:classes[ml.index],
      ML_tie:ml.tie, tied_classes:ml.tied.map(i=>classes[i]),
      conditional_risk_MW:1-posterior[minimumIndex], conditional_risk_ML:1-posterior[ml.index]};
    if (!small) Object.assign(readouts, {actual:winding(code,code.residual).join(''),
      actual_shot_success:classes[ml.index]===winding(code,code.residual).join(''),
      actual_weight:weight(code.actual), recovery_weight:weight(code.reference), residual_weight:weight(code.residual)});
    const panels = small ? [
      {id:'A',title:'A: minimum-weight choice',error:code.reference,dash:'8 4'},
      {id:'B',title:'B: the competing class',error:code.candidateB,dash:'3 3'}
    ] : [
      {id:'E',title:'Actual E: class 01',error:code.actual,dash:'8 4'},
      {id:'R',title:'Recovery R: class 00',error:code.reference,dash:'3 3'},
      {id:'residual',title:'Residual E ⊕ R: vertical logical',error:code.residual,dash:'8 3 2 3'}
    ];
    return {valid:true,params:p,warnings,code,classes,histograms,readouts,
      classSizes:histograms.map(row=>row.reduce((a,b)=>a+b,0)),
      minimumMultiplicities:histograms.map((row,i)=>row[weights[i]]),
      countRows:Array.from({length:p.show_counts?code.n+1:(small?3:5)},(_,i)=>i+(p.show_counts?0:(small?2:3))),
      panels:panels.map(panel=>({...panel,bits:syndrome(code,panel.error),support:support(panel.error,code.n)})),
      sweep:probabilitySweep(p.board,p.p)};
  }
  return {DEFAULTS,mask,weight,support,geometry,syndrome,winding,enumerateSmall,enumerators,classProbabilities,selectML,probabilitySweep,compute};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const roles = ['primary','secondary','tertiary','reference'];
  const dashes = ['', '7 4', '2 3', '9 3 2 3'];
  const ns = 'http://www.w3.org/2000/svg';

  function drawBoard(svg, result, panel, selected, model) {
    const doc=svg.ownerDocument, code=result.code, side=code.periodic?225:210;
    const step=side/code.height, ox=(320-code.width*step)/2, oy=48;
    const xy=(x,y)=>[ox+x*step,oy+y*step];
    const active=selected?.panel===panel.id?code.checks.find(c=>c.id===selected.check):null;
    const highlighted=new Set(active?active.support:[]), errors=new Set(panel.support);
    function el(tag,attrs={},text,parent=svg) {
      const n=doc.createElementNS(ns,tag);
      for(const [key,value] of Object.entries(attrs)) n.setAttribute(key,String(value));
      if(text!==undefined)n.textContent=String(text);
      parent.appendChild(n);return n;
    }
    function text(x,y,label,attrs={}) {return el('text',{x,y,fill:'var(--text)','font-size':12,'text-anchor':'middle',...attrs},label);}
    function line(a,b,attrs={}) {
      const [x1,y1]=xy(...a),[x2,y2]=xy(...b);
      el('line',{x1,y1,x2,y2,stroke:'var(--line)','stroke-width':1.3,...attrs});
    }
    svg.replaceChildren();
    el('title',{},`${panel.title}. Data rings, filled X-check squares, hollow Z-check squares. Tab to a check and press Enter or Space to inspect its support.`);
    el('desc',{},`Z support: ${panel.support.map(q=>code.edges[q].id).join(', ')}. Flagged checks: ${code.checks.filter((c,i)=>panel.bits[i]).map(c=>c.id).join(', ')||'none'}.`);
    function drawEdge(e,q,dx=0,dy=0,copy=false) {
      const ends=e.ends.map(([x,y])=>[x+dx,y+dy]);
      line(...ends,copy?{opacity:0.45}:{});
      if(highlighted.has(q))line(...ends,{stroke:'var(--plot-accent)','stroke-width':9,opacity:0.3});
      if(errors.has(q))line(...ends,{stroke:'var(--plot-secondary)','stroke-width':4,'stroke-dasharray':panel.dash,opacity:copy?0.5:1});
      const [cx,cy]=xy(e.x+dx,e.y+dy);
      el('circle',{cx,cy,r:3.3,fill:'var(--bg)',stroke:highlighted.has(q)?'var(--plot-accent)':'var(--text)','stroke-width':highlighted.has(q)?2.5:1.2,opacity:copy?0.5:1});
    }
    code.edges.forEach((e,q)=>{
      drawEdge(e,q);
      if(code.periodic&&e.axis==='v'&&e.col===0)drawEdge(e,q,code.L,0,true);
      if(code.periodic&&e.axis==='h'&&e.row===0)drawEdge(e,q,0,code.L,true);
    });
    function drawCheck(c,i,dx=0,dy=0,copy=false) {
      const [x,y]=xy(c.x+dx,c.y+dy),flag=panel.bits[i],chosen=active===c;
      const g=el('g',copy?{opacity:0.45}:{'data-check':`${panel.id}/${c.id}`,tabindex:0,role:'button','aria-pressed':String(chosen),
        'aria-label':`${panel.id}: ${c.id}, ${c.type} check, weight ${c.support.length}, syndrome ${flag}${flag?', e defect':''}. Inspect support.`});
      el('rect',{x:x-12,y:y-12,width:24,height:24,fill:'var(--bg)','fill-opacity':0,stroke:chosen?'var(--plot-accent)':'none','stroke-width':2},undefined,g);
      el('rect',{x:x-3.5,y:y-3.5,width:7,height:7,fill:c.type==='X'?'var(--plot-primary)':'var(--bg)',stroke:c.type==='X'?'var(--plot-primary)':'var(--plot-secondary)','stroke-width':1.8},undefined,g);
      if(flag) {
        el('circle',{cx:x,cy:y,r:8,fill:'none',stroke:'var(--plot-accent)','stroke-width':2},undefined,g);
        el('text',{x:x+10,y:y-8,fill:'var(--text)','font-size':12,'data-defect':'e'},'e',g);
      }
    }
    code.checks.forEach((c,i)=>{
      drawCheck(c,i);
      if(code.periodic&&c.type==='X') {
        if(c.x===0)drawCheck(c,i,code.L,0,true);
        if(c.y===0)drawCheck(c,i,0,code.L,true);
        if(c.x===0&&c.y===0)drawCheck(c,i,code.L,code.L,true);
      }
    });
    for(let x=0;x<=code.width;x++)text(xy(x,0)[0],35,code.periodic&&x===code.L?'0':x);
    for(let y=0;y<=code.height;y++)text(ox-18,xy(0,y)[1]+4,code.periodic&&y===code.L?'0':y);
    if(code.periodic) {
      text(160,16,'Opposite sides identified ↔ ↕');
      text(160,302,'Seam copies are the same checks and data.');
    } else {
      text(160,16,'Top Z-boundary');text(160,282,'Bottom Z-boundary');
      text(28,160,'X-boundary',{transform:'rotate(-90 28 160)'});
      text(292,160,'X-boundary',{transform:'rotate(90 292 160)'});
    }
    text(160,323,'○ data   ■ X check   □ Z check   e flag');
  }

  StudyLab.register('decoder-sets-threshold',function mount(root,ctx) {
    const doc=root.ownerDocument,layout=ctx.layout(root);
    ctx.controls.fromCard(layout.controls);
    const boards=doc.createElement('div');
    boards.style.display='grid';boards.style.gap='1rem';boards.style.minWidth='0';
    layout.plots.appendChild(boards);
    const probabilities=ctx.plot(layout.plots,{
      title:'Probability of each compatible class',
      x:{label:'Class index (named in legend)',domain:'auto'},
      y:{label:'Conditional probability',domain:[0,1]},legend:true
    });
    const sweep=ctx.plot(layout.plots,{
      title:'Class probabilities as p changes',
      x:{label:'Z-error probability p per data edge',domain:[0.001,0.5]},
      y:{label:'Conditional class probability',domain:[0,1]},legend:true
    });
    const counts=doc.createElement('div');counts.style.overflowX='auto';layout.plots.appendChild(counts);
    let selected=null;
    function html(tag,parent,text) {
      const el=doc.createElement(tag);if(text!==undefined)el.textContent=String(text);parent.appendChild(el);return el;
    }
    function table(result) {
      counts.replaceChildren();
      const tab=html('table',counts);tab.style.width='100%';tab.style.fontVariantNumeric='tabular-nums';
      tab.style.fontSize='0.85rem';
      html('caption',tab,`Errors at each weight${result.params.show_counts?' (all weights)':' (lowest weights)'}`);
      const head=html('tr',html('thead',tab));
      ['Weight',...result.classes].forEach(label=>html('th',head,label).setAttribute('scope','col'));
      const body=html('tbody',tab);
      for(const w of result.countRows) {
        const row=html('tr',body);html('th',row,w).setAttribute('scope','row');
        result.histograms.forEach(hist=>html('td',row,hist[w]));
      }
      const total=html('tr',html('tfoot',tab));html('th',total,'All weights').setAttribute('scope','row');
      result.classSizes.forEach(n=>html('td',total,n));
    }
    function draw() {
      const r=ctx.model.compute(ctx.state.all());ctx.warn(layout.notes,r.warnings.join(' ')||null);
      if(!r.valid) {boards.replaceChildren();counts.replaceChildren();probabilities.update([]);sweep.update([]);ctx.readouts(layout.readouts,[]);ctx.notes(layout.notes,'');return;}
      const small=r.params.board==='small-patch',out=r.readouts;
      boards.replaceChildren();
      for(const panel of r.panels) {
        const section=html('section',boards);section.style.minWidth='0';
        html('h4',section,panel.title);
        const svg=doc.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 320 335');svg.setAttribute('width','100%');
        svg.setAttribute('role','group');svg.setAttribute('aria-label',panel.title);
        svg.style.maxWidth='420px';svg.style.display='block';svg.style.margin='0 auto';section.appendChild(svg);
        drawBoard(svg,r,panel,selected,ctx.model);
        const caption=html('p',section,`Weight ${panel.support.length}. Z support: ${panel.support.map(q=>r.code.edges[q].id).join(', ')}. Flags: ${r.code.checks.filter((c,i)=>panel.bits[i]).map(c=>c.id).join(', ')||'none'}.`);
        caption.style.fontSize='0.85rem';caption.style.overflowWrap='anywhere';
      }
      probabilities.update(r.classes.flatMap((label,i)=>[
        {id:`bar-${label}`,label:`${i}: ${label}`,role:roles[i],kind:'line',dash:dashes[i],width:4,points:[[i,0],[i,out.posterior[i]]]},
        {id:`point-${label}`,role:roles[i],kind:'scatter',points:[[i,out.posterior[i]]]}
      ]));
      sweep.update(r.classes.map((label,i)=>({id:`class-${label}`,label,role:roles[i],kind:'line',dash:dashes[i],
        points:r.sweep.map(row=>[row.p,row.posterior[i]])})),[{type:'vline',x:r.params.p,label:`p = ${r.params.p}`,role:'accent'}]);
      table(r);
      const items=r.classes.map((label,i)=>({label:`P(${label} | syndrome)`,value:r.params.p===0.5?(small?'1/2':'1/4'):out.posterior[i],format:'sig',digits:8}));
      items.push(
        {label:'Minimum weights by class',value:out.weights.join(' / ')},
        {label:'Minimum-weight choice',value:out.minimum_weight},
        {label:'ML class choice',value:out.ML},
        {label:'ML tie',value:out.ML_tie?`yes: ${out.tied_classes.join(', ')}`:'no'},
        {label:'Conditional risk: minimum weight',value:out.conditional_risk_MW,format:'sig',digits:6},
        {label:'Conditional risk: ML class',value:out.conditional_risk_ML,format:'sig',digits:6}
      );
      if(!small) items.push(
        {label:'Actual class relative to R',value:out.actual},
        {label:'Minimum-weight success on displayed error',value:out.MW===out.actual?'yes':'no'},
        {label:'ML success on displayed error',value:out.actual_shot_success?'yes':'no'},
        {label:'Weights E / R / residual',value:`${out.actual_weight} / ${out.recovery_weight} / ${out.residual_weight}`}
      );
      ctx.readouts(layout.readouts,items);
      let inspection='Select a check with a pointer or Tab then Enter/Space to inspect its data-edge support.';
      if(selected) {
        const ch=r.code.checks.find(c=>c.id===selected.check),panel=r.panels.find(p=>p.id===selected.panel);
        if(ch&&panel) inspection=`${selected.panel}: ${ch.id} acts with ${ch.type} on ${ch.support.map(q=>r.code.edges[q].id).join(', ')}. Weight ${ch.support.length}; syndrome ${panel.bits[r.code.checks.indexOf(ch)]}.`;
      }
      const interpretation=small
        ? `The two candidates have the same syndrome and weight. The stated minimum-weight tie rule chooses the smaller mask, A. ${out.ML_tie?'The class sums tie within 1e-12; ML selects the first class, A.':`The full probability sum favors class ${out.ML}.`} ${r.params.p===0.5?'At p = 1/2, every individual error is equiprobable; minimum weight remains only the named geometric rule.':''}`
        : `Both presets choose recovery class 00, while the displayed error belongs to class 01. ${out.MW===out.actual?'Minimum weight succeeds.':'Minimum weight fails on this error.'} ${out.actual_shot_success?'ML succeeds.':'ML also fails on this error.'} A likely class is not a guarantee for a particular hidden error.`;
      ctx.notes(layout.notes,`<p>${inspection}</p><p>${interpretation}</p><p>Conditional risk is one minus the probability of the chosen class. The curve keeps this syndrome fixed as p changes.</p>`);
    }
    function select(event) {
      const target=event.target.closest('[data-check]');if(!target||!boards.contains(target))return;
      if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
      event.preventDefault();const key=target.getAttribute('data-check'),[panel,check]=key.split('/');
      selected={panel,check};draw();boards.querySelector(`[data-check="${key}"]`)?.focus();
    }
    boards.addEventListener('click',select);boards.addEventListener('keydown',select);
    const unsubscribe=ctx.state.onChange(()=>{selected=null;draw();});draw();
    return {destroy() {
      unsubscribe();boards.removeEventListener('click',select);boards.removeEventListener('keydown',select);
      probabilities.destroy?.();sweep.destroy?.();boards.remove();counts.remove();
    }};
  });
})();

}).call(window);
