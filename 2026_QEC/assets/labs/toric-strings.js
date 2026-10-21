/* toric-strings: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['toric-strings'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const bit = i => 1n << BigInt(i);
  const mask = support => support.reduce((a, i) => a ^ bit(i), 0n);
  function parity(a) { let p = 0; while (a) { p ^= 1; a &= a - 1n; } return p; }
  function weight(a) { let n = 0; while (a) { n++; a &= a - 1n; } return n; }
  // Echelon elimination also retains a witness in the original row set.
  function basis(rows) {
    const pivots = new Map();
    rows.forEach((row, i) => {
      let a = row, witness = bit(i);
      while (a) {
        const pivot = a.toString(2).length - 1, old = pivots.get(pivot);
        if (!old) { pivots.set(pivot, { row: a, witness }); break; }
        a ^= old.row; witness ^= old.witness;
      }
    });
    return pivots;
  }
  function solve(rows, target) {
    const b = basis(rows); let a = target, witness = 0n;
    while (a) {
      const old = b.get(a.toString(2).length - 1);
      if (!old) return null;
      a ^= old.row; witness ^= old.witness;
    }
    return rows.map((_, i) => i).filter(i => (witness & bit(i)) !== 0n);
  }
  const rank = rows => basis(rows).size;
  function mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randomError(n, p, seed) {
    if (!Number.isInteger(n) || n < 1 || !Number.isFinite(p) || p < 0 || p > 1 || !Number.isInteger(seed)) throw new RangeError('Invalid random-error inputs.');
    const rng = mulberry32(seed); let x = 0n, z = 0n;
    for (let q = 0; q < n; q++) if (rng() < p) {
      const pauli = Math.floor(3 * rng());
      if (pauli !== 2) x ^= bit(q);
      if (pauli !== 0) z ^= bit(q);
    }
    return { x, z };
  }
  function torus(L) {
    if (!Number.isInteger(L) || L < 2 || L > 7) throw new RangeError('Torus side must be an integer from 2 to 7.');
    const mod = a => (a + L) % L;
    const h = (x, y) => mod(y) * L + mod(x), v = (x, y) => L * L + mod(y) * L + mod(x);
    const edges = [], checks = [];
    for (const axis of ['h', 'v']) for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      edges.push({ id: `${axis}(${x},${y})`, axis, col: x, row: y,
        x: x + (axis === 'h' ? 0.5 : 0), y: y + (axis === 'v' ? 0.5 : 0),
        ends: [[x, y], [x + (axis === 'h' ? 1 : 0), y + (axis === 'v' ? 1 : 0)]] });
    }
    for (const type of ['X', 'Z']) for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
      const support = type === 'X' ? [h(x,y), h(x-1,y), v(x,y), v(x,y-1)] : [h(x,y), h(x,y+1), v(x,y), v(x+1,y)];
      checks.push({ id: `${type === 'X' ? 'A' : 'B'}(${x},${y})`, type,
        kind: type === 'X' ? 'vertex' : 'face', x: x + (type === 'Z' ? 0.5 : 0), y: y + (type === 'Z' ? 0.5 : 0), support, mask: mask(support) });
    }
    const rx = rank(checks.filter(c => c.type === 'X').map(c => c.mask));
    const rz = rank(checks.filter(c => c.type === 'Z').map(c => c.mask));
    return { layout: 'torus', d: L, L, n: edges.length, edges, checks, rx, rz, k: edges.length-rx-rz, h, v, width: L, height: L, periodicX: true, periodicY: true };
  }
  function syndrome(code, error) { return code.checks.map(c => parity(c.mask & (c.type === 'X' ? error.z : error.x))); }
  function homology(code, error) {
    if (syndrome(code, error).some(Boolean)) return null;
    const { L, h, v } = code; let zh = 0, zv = 0, xh = 0, xv = 0;
    for (let i = 0; i < L; i++) {
      zh ^= parity(error.z & bit(h(L-1,i))); zv ^= parity(error.z & bit(v(i,L-1)));
      xh ^= parity(error.x & bit(v(0,i))); xv ^= parity(error.x & bit(h(i,0)));
    }
    return { z: [zh, zv], x: [xh, xv] };
  }
  function classify(code, error) {
    if (syndrome(code, error).some(Boolean)) return 'detectable';
    return solve(code.checks.filter(c => c.type === 'X').map(c => c.mask), error.x) !== null &&
      solve(code.checks.filter(c => c.type === 'Z').map(c => c.mask), error.z) !== null ? 'stabilizer' : 'logical';
  }
  function browneExample(code) {
    if (code.L !== 5) throw new RangeError('The PS2-Q1 preset requires L=5.');
    const {h,v} = code;
    // Browne PS2, PDF pp. 1-2. Coordinates in this API are zero-based.
    const chain = mask([h(2,1),h(3,1),v(4,1),v(4,2),h(3,3),v(3,3)]);
    const loop = mask([h(2,2),h(2,3),v(2,2),v(3,2)]);
    const correction = mask([h(2,1),v(3,0),v(3,4)]);
    return { error: { x:0n,z:chain^loop }, correction: {x:0n,z:correction}, product: {x:0n,z:chain^loop^correction}, chain, loop };
  }
  function straightComparison(code, pattern, length) {
    const {L,h,v}=code,len=Math.min(length,L),isX=pattern==='x-string';
    const path=Array.from({length:L},(_,i)=>isX?v(i+1,0):h(i,0));
    const original=mask(path.slice(0,len)),ring=mask(path);
    // The two straight arcs share endpoints. On an even half-ring tie, retain
    // the original arc; otherwise the shorter arc is the unique shortest path.
    const correction=2*len<=L?original:ring^original;
    const pauli=a=>({x:isX?a:0n,z:isX?0n:a});
    return {error:pauli(original),correction:pauli(correction),product:pauli(original^correction),shortestUnique:2*len!==L};
  }
  function patternError(code, pattern, length = 3, p = 0.05, seed = 7, pathView = 'error') {
    const { L, h, v } = code; let x = 0n, z = 0n;
    if (pattern === 'random') return randomError(code.n, p, seed);
    if (pattern === 'same-ends-different-path') return browneExample(code)[pathView];
    if (['z-string','x-string'].includes(pattern)) return straightComparison(code,pattern,length)[pathView];
    if (pattern === 'single-z') z = bit(h(0,0));
    if (pattern === 'single-x') x = bit(v(1,0));
    if (pattern === 'noncontractible-z') for (let i=0; i<L; i++) z ^= bit(h(i,0));
    if (pattern === 'noncontractible-x') for (let i=0; i<L; i++) x ^= bit(v(i+1,0));
    if (pattern === 'closed-loop') z = code.checks[L*L].mask ^ code.checks[L*L+1].mask;
    if (pattern === 'braid') { x = bit(v(1,0)); z = code.checks[L*L].mask; }
    return {x,z};
  }
  const patterns = ['none','single-z','single-x','z-string','x-string','closed-loop','noncontractible-z','noncontractible-x','braid','random','same-ends-different-path'];
  function compute(params = {}) {
    const p = { L:4, pattern:'z-string', length:3, p:0.05, seed:7, show_dual:true, path_view:'error', ...params }, warnings=[];
    if (!Number.isInteger(p.L) || p.L<2 || p.L>6) warnings.push('L must be an integer from 2 to 6.');
    if (!patterns.includes(p.pattern)) warnings.push('Select a listed pattern.');
    if (!Number.isInteger(p.length) || p.length<1 || p.length>6) warnings.push('Length must be an integer from 1 to 6.');
    if (!Number.isFinite(p.p) || p.p<0.001 || p.p>0.5) warnings.push('p must be finite and between 0.001 and 0.5.');
    if (!Number.isInteger(p.seed) || p.seed<1 || p.seed>99) warnings.push('Seed must be an integer from 1 to 99.');
    if (typeof p.show_dual !== 'boolean') warnings.push('show_dual must be boolean.');
    if (!['error','correction','product'].includes(p.path_view)) warnings.push('Select error, correction, or product.');
    if (p.pattern === 'same-ends-different-path' && p.L !== 5) warnings.push('Browne PS2-Q1 is defined on L=5. Restore L=5 or choose another pattern.');
    if (warnings.length) return {valid:false, params:p, warnings};
    const code=torus(p.L), error=patternError(code,p.pattern,p.length,p.p,p.seed,p.path_view), bits=syndrome(code,error);
    const e=bits.slice(0,p.L*p.L).reduce((a,b)=>a+b,0), m=bits.slice(p.L*p.L).reduce((a,b)=>a+b,0);
    const family=['single-x','x-string','noncontractible-x','braid'].includes(p.pattern)?'x-string':'z-string';
    const energy=Array.from({length:p.L+1},(_,j)=>[j,2*syndrome(code,patternError(code,family,j)).reduce((a,b)=>a+b,0)]);
    const comparison=p.pattern==='same-ends-different-path'?browneExample(code):['z-string','x-string'].includes(p.pattern)?straightComparison(code,p.pattern,p.length):null;
    return {valid:true,params:p,warnings,code,error,bits,homology:homology(code,error),classification:classify(code,error),
      e,m,energy:2*(e+m),distance:p.L,energySeries:energy,family,
      braidEigenvalue:p.pattern==='braid'?1-2*parity(error.x & code.checks[p.L*p.L].mask):null,
      comparison:comparison?{...comparison,homology:homology(code,comparison.product),classification:classify(code,comparison.product)}:null};
  }
  return {bit,mask,parity,weight,basis,solve,rank,mulberry32,randomError,torus,syndrome,homology,classify,browneExample,straightComparison,patternError,compute};
});

}).call(window);
(function(){
(function () {
  'use strict';
  function lattice(svg, result, selected, model) {
    const doc=svg.ownerDocument,c=result.code,err=result.error,step=350/(Math.max(c.width,c.height)+(c.layout==='rotated'?1:0)),ox=85+(c.layout==='rotated'?step/2:0),oy=ox;
    const xy=(x,y)=>[ox+x*step,oy+y*step];
    function el(tag,attrs={},text,parent=svg){const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;parent.appendChild(n);return n;}
    function line(a,b,attrs={}){const [x1,y1]=xy(...a),[x2,y2]=xy(...b);return el('line',{x1,y1,x2,y2,stroke:'var(--line)','stroke-width':1.5,...attrs});}
    function text(x,y,s,attrs={}){return el('text',{x,y,fill:'var(--text)','font-size':14,'text-anchor':'middle',...attrs},s);}
    svg.replaceChildren();
    el('title',{},'Computed lattice. Tab to a check and press Enter or Space to inspect its support.');
    const chosen=c.checks.find(ch=>ch.id===selected);
    const selectedSupport=new Set(chosen?chosen.support:[]);
    if(c.layout==='rotated') {
      const defs=el('defs');
      for(const type of ['X','Z']){const pat=el('pattern',{id:`${svg.id}-${type}`,patternUnits:'userSpaceOnUse',width:8,height:8},undefined,defs);el('path',{d:type==='X'?'M0 0 L8 8':'M0 4 L8 4',stroke:`var(--plot-${type==='X'?'primary':'secondary'})`,'stroke-width':1,opacity:0.45},undefined,pat);}
      for(const ch of c.checks) {
        const [cx,cy]=xy(ch.x,ch.y),a=c.edges[ch.support[0]],b=c.edges[ch.support.at(-1)];
        if(ch.kind==='half') {
          const [ax,ay]=xy(a.x,a.y),[bx,by]=xy(b.x,b.y),sweep=['top','right'].includes(ch.side)?1:0;
          el('path',{d:`M${ax} ${ay} A${step/2} ${step/2} 0 0 ${sweep} ${bx} ${by} Z`,fill:`url(#${svg.id}-${ch.type})`,stroke:`var(--plot-${ch.type==='X'?'primary':'secondary'})`,'stroke-dasharray':ch.type==='Z'?'5 3':'none'});
        } else el('rect',{x:cx-step/2,y:cy-step/2,width:step,height:step,fill:`url(#${svg.id}-${ch.type})`,stroke:'var(--line)'});
      }
    } else {
      for(const edge of c.edges)line(...edge.ends);
      // Opposite-border duplicates refer to existing qubits; never extend incidence.
      for(const edge of c.edges) {
        if(c.periodicX&&edge.axis==='v'&&edge.col===0)line([c.width,edge.row],[c.width,edge.row+1],{opacity:0.45});
        if(c.periodicY&&edge.axis==='h'&&edge.row===0)line([edge.col,c.height],[edge.col+1,c.height],{opacity:0.45});
      }
      if(result.params.show_dual)for(let i=0;i<c.L;i++){
        line([0,i+0.5],[c.width,i+0.5],{stroke:'var(--muted)','stroke-dasharray':'2 5',opacity:0.45});
        line([i+0.5,0],[i+0.5,c.height],{stroke:'var(--muted)','stroke-dasharray':'2 5',opacity:0.45});
      }
    }
    function edgeDraw(edge,q,dx=0,dy=0,duplicate=false){
      const [x,y]=xy(edge.x+dx,edge.y+dy),hasX=(err.x&model.bit(q))!==0n,hasZ=(err.z&model.bit(q))!==0n;
      const letter=hasX?(hasZ?'Y':'X'):(hasZ?'Z':'');
      if(edge.axis!=='point'&&(letter||selectedSupport.has(q))){
        const ends=edge.ends.map(([a,b])=>[a+dx,b+dy]);
        if(selectedSupport.has(q))line(...ends,{stroke:'var(--plot-accent)','stroke-width':9,opacity:0.4});
        if(hasX)line(...ends,{stroke:'var(--plot-primary)','stroke-width':5,opacity:duplicate?0.45:1});
        if(hasZ)line(...ends,{stroke:'var(--plot-secondary)','stroke-width':hasX?2.5:5,'stroke-dasharray':'7 4',opacity:duplicate?0.45:1});
      }
      el('circle',{cx:x,cy:y,r:selectedSupport.has(q)?7:4.5,fill:'var(--bg)',stroke:selectedSupport.has(q)?'var(--plot-accent)':'var(--text)','stroke-width':selectedSupport.has(q)?3:1.4,opacity:duplicate?0.45:1});
      if(letter)text(x+(edge.axis==='v'?12:0),y+(edge.axis==='v'?4:-9),letter,{'font-weight':'bold','font-size':14,fill:hasX?'var(--plot-primary)':'var(--plot-secondary)'});
      if(c.layout==='rotated')text(x+10,y+16,q+1,{'font-size':12,'text-anchor':'start'});
    }
    c.edges.forEach((edge,q)=>{
      edgeDraw(edge,q);
      if(c.periodicX&&edge.axis==='v'&&edge.col===0)edgeDraw(edge,q,c.width,0,true);
      if(c.periodicY&&edge.axis==='h'&&edge.row===0)edgeDraw(edge,q,0,c.height,true);
    });
    function drawCheck(ch,i,dx=0,dy=0,duplicate=false){
      const [x,y]=xy(ch.x+dx,ch.y+dy),flag=result.bits[i],active=selected===ch.id;
      const defect=(ch.primalKind||ch.kind)==='vertex'?'e':'m';
      const g=el('g',duplicate?{opacity:0.4}:{'data-check':ch.id,tabindex:0,role:'button','aria-pressed':String(active),'aria-label':`${ch.id}, ${ch.type} check, weight ${ch.support.length}, syndrome ${flag}${flag?`, ${defect} defect`:''}. Inspect support.`});
      el('rect',{x:x-12,y:y-12,width:24,height:24,fill:'var(--bg)','fill-opacity':0,stroke:active?'var(--plot-accent)':'none','stroke-width':2},undefined,g);
      el('rect',{x:x-4,y:y-4,width:8,height:8,fill:ch.type==='X'?'var(--plot-primary)':'var(--bg)',stroke:ch.type==='X'?'var(--plot-primary)':'var(--plot-secondary)','stroke-width':2},undefined,g);
      if(flag){el('circle',{cx:x,cy:y,r:9,fill:defect==='e'?'var(--plot-accent)':'var(--bg)',stroke:'var(--plot-accent)','stroke-width':2},undefined,g);
        el('text',{x:x+12,y:y+4,fill:'var(--text)','font-size':13,'data-defect':defect},defect,g);}
      if(c.layout!=='torus'&&!duplicate)el('text',{x:x+6,y:y-7,fill:'var(--muted)','font-size':11},`${ch.type}${ch.support.length}`,g);
    }
    c.checks.forEach((ch,i)=>{drawCheck(ch,i);if(ch.kind==='vertex'){if(c.periodicX&&ch.x===0)drawCheck(ch,i,c.width,0,true);if(c.periodicY&&ch.y===0)drawCheck(ch,i,0,c.height,true);}});
    for(let j=0;j<=Math.floor(c.width);j++)text(xy(j,0)[0],65,String(c.periodicX&&j===c.width?0:j),{'font-size':12,fill:'var(--muted)'});
    if(c.layout==='torus')for(let j=0;j<=c.height;j++)text(65,xy(0,j)[1]+4,String(j===c.height?0:j),{'font-size':12,fill:'var(--muted)'});
    if(c.periodicX){text(43,250,'⇔');text(xy(c.width,0)[0]+25,250,'⇔');}
    if(c.periodicY){text(260,46,'⇕ opposite sides identified');text(260,xy(0,c.height)[1]+27,'⇕');}
    for(const b of c.boundaries||[]){const label=`${b.geometry?b.geometry+' / ':''}${b.type}-boundary`;
      if(b.side==='top')text(260,33,label);
      if(b.side==='bottom')text(260,475,label);
      if(b.side==='left')text(23,260,label,{transform:'rotate(-90 23 260)'});
      if(b.side==='right')text(497,260,label,{transform:'rotate(90 497 260)'});
    }
    text(260,507,'○ data   ■ X check   □ Z check   Z dashed / X solid',{'font-size':13});
    return chosen;
  }
  StudyLab.register('toric-strings', function mount(root,ctx){
    const layout=ctx.layout(root),doc=root.ownerDocument;
    ctx.controls.fromCard(layout.controls);
    const holder=doc.createElement('div');holder.style.overflowX='auto';holder.setAttribute('tabindex','0');holder.setAttribute('aria-label','Torus lattice, scroll horizontally on narrow screens');layout.plots.appendChild(holder);
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.id=`${ctx.id}-lattice`;svg.setAttribute('viewBox','0 0 520 525');svg.setAttribute('width','100%');svg.style.minWidth='520px';svg.style.maxWidth='760px';svg.setAttribute('role','group');svg.setAttribute('aria-label','Computed torus with interactive check supports');holder.appendChild(svg);
    const energy=ctx.plot(layout.plots,{title:'Computed energy of a straight string',x:{label:'String length (edges)',domain:'auto'},y:{label:'Energy above ground (generator units)',domain:[0,5]},legend:true});
    let selected=null,last=null;
    const winding=h=>h?`Z (${h.z.join(',')}); X (${h.x.join(',')})`:'Undefined for an open chain';
    function draw(){
      const r=ctx.model.compute(ctx.state.all());last=r;ctx.warn(layout.notes,r.warnings.join(' ')||null);
      if(!r.valid){svg.replaceChildren();energy.update([]);ctx.readouts(layout.readouts,[]);ctx.notes(layout.notes,'');return;}
      const chosen=lattice(svg,r,selected,ctx.model),c=r.code;
      const active=['single-x','single-z'].includes(r.params.pattern)?1:['noncontractible-x','noncontractible-z'].includes(r.params.pattern)?c.L:['x-string','z-string'].includes(r.params.pattern)?ctx.model.weight(r.error.x|r.error.z):null;
      energy.update([{id:'energy',label:`${r.family==='x-string'?'X dual':'Z primal'} straight string`,role:'primary',kind:'line',points:r.energySeries},
        {id:'samples',label:'Integer lengths',role:'primary',kind:'scatter',points:r.energySeries},
        {id:'closed',label:'Stabilizer boundary: zero',role:'reference',kind:'line',dash:'3 4',points:[[0,0],[c.L,0]]}],active===null?[]:[{type:'point',x:active,y:r.energy,label:'Selected length',role:'accent'}]);
      const items=[['Computed data qubits',c.n],['Computed independent checks',c.rx+c.rz],['Computed logical qubits k',c.k],['Distance (formula preview)',`${c.L}`],['Computed e anyons',r.e],['Computed m anyons',r.m],['Computed excitation energy',r.energy],['Computed operator class',r.classification],['Computed winding (horizontal, vertical)',winding(r.homology)]];
      if(r.braidEigenvalue!==null)items.push(['Computed enclosed-loop eigenvalue',r.braidEigenvalue]);
      if(r.comparison)items.push(['Computed product class',r.comparison.classification],['Computed product winding',winding(r.comparison.homology)],['Computed error / correction / product weights',[r.comparison.error,r.comparison.correction,r.comparison.product].map(e=>ctx.model.weight(e.x|e.z)).join(' / ')]);
      if(r.comparison?.shortestUnique!==undefined){
        const e=r.comparison.correction,type=r.family==='x-string'?'X':'Z';
        items.push(['Computed shortest correction support',c.edges.flatMap((edge,q)=>((e.x|e.z)&ctx.model.bit(q))?[`${type} ${edge.id}`]:[]).join(', ')||'I'],['Computed shortest correction unique',r.comparison.shortestUnique?'yes':'no (half-ring tie)']);
      }
      ctx.readouts(layout.readouts,items.map(([label,value])=>({label,value})));
      ctx.notes(layout.notes,`<p>${chosen?`${chosen.id}: ${chosen.type} on ${chosen.support.map(q=>c.edges[q].id).join(', ')}. Weight ${chosen.support.length}; syndrome ${r.bits[c.checks.indexOf(chosen)]}.`:'Select a check with a pointer or Tab then Enter/Space to inspect the exact support.'}</p>`+
        '<p>The energy panel follows a straight string from zero length to a closed periodic loop. Its interior points all cost 4; closure removes both endpoints. Arbitrary patterns are classified in the readouts, not treated as straight strings.</p>'+
        (r.params.pattern==='same-ends-different-path'?'<p>Browne PS2-Q1, PDF pp. 1-2: change the path stage from original error to correction to product. In zero-based coordinates, error and correction flag A(2,1) and A(3,4). The correction acts on h(2,1), v(3,0), v(3,4); their product has no syndrome and vertical Z winding one. A shortest correction can leave a logical error.</p>':'')+
        (r.comparison?.shortestUnique!==undefined?'<p>Change the path stage to inspect the original straight string, its shortest correction, and their product. Past halfway around the torus, the shorter correction wraps the other way; their product is a horizontal logical loop with zero syndrome. For odd L and a straight string, the shortest correction is unique. At an even half-ring tie, this model chooses the original arc. The energy marker follows the displayed stage.</p>':'')+
        (r.params.pattern==='braid'?'<p>The X error creates two m anyons. The Z plaquette loop encloses one and has eigenvalue -1 on that excited state. The loop adds no excitation energy.</p>':'')+
        '<p>Try to construct a zero-syndrome operator that is still logical. Compare the two loop presets and identify the crossing parity that distinguishes them.</p>');
    }
    function select(event){const target=event.target.closest('[data-check]');if(!target||!svg.contains(target))return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();selected=target.getAttribute('data-check');draw();svg.querySelector(`[data-check="${selected}"]`)?.focus();}
    svg.addEventListener('click',select);svg.addEventListener('keydown',select);
    const unsubscribe=ctx.state.onChange(()=>{selected=null;draw();});draw();
    return {destroy(){unsubscribe();svg.removeEventListener('click',select);svg.removeEventListener('keydown',select);energy.destroy?.();holder.remove();last=null;}};
  });
})();

}).call(window);
