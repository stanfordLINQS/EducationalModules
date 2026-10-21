/* planar-and-rotated: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['planar-and-rotated'] = api;
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
  function finish(code, swap) {
    if (swap) code.checks = code.checks.map(c => ({...c,type:c.type==='X'?'Z':'X'}));
    code.rx=rank(code.checks.filter(c=>c.type==='X').map(c=>c.mask));
    code.rz=rank(code.checks.filter(c=>c.type==='Z').map(c=>c.mask));
    code.n=code.edges.length; code.k=code.n-code.rx-code.rz; code.total=code.n+code.checks.length;
    code.swap=swap;
    code.boundaries=(code.boundaries||[]).map(b=>({...b,type:swap?(b.type==='X'?'Z':'X'):b.type}));
    return code;
  }
  function unrotated(layout,d) {
    const planar=layout==='planar', cylinder=layout==='cylinder';
    const edges=[], checks=[], index=new Map(), rows=planar?d-1:d;
    const y0=planar?1:0;
    function addEdge(axis,x,y) {
      const q=edges.length; index.set(`${axis},${x},${y}`,q);
      edges.push({id:`${axis}(${x+1},${y+1})`,axis,col:x,row:y,x:x+(axis==='h'?0.5:0),y:y+(axis==='v'?0.5:0),
        ends:[[x,y],[x+(axis==='h'?1:0),y+(axis==='v'?1:0)]]});
    }
    for(let y=y0;y<y0+rows;y++) for(let x=0;x<d-1;x++) addEdge('h',x,y);
    for(let y=0;y<(planar||cylinder?d:d-1);y++) for(let x=0;x<d;x++) addEdge('v',x,y);
    const at=(axis,x,y)=>index.get(`${axis},${x},${cylinder?(y+d)%d:y}`);
    function addCheck(type,kind,x,y,support) {
      support=support.filter(q=>q!==undefined);
      checks.push({id:`${type==='X'?'A':'B'}(${x+1},${y+1})`,type,kind,x:x+(kind==='face'?0.5:0),y:y+(kind==='face'?0.5:0),support,mask:mask(support)});
    }
    for(let y=y0;y<y0+rows;y++) for(let x=0;x<d;x++) addCheck('X','vertex',x,y,[at('h',x-1,y),at('h',x,y),at('v',x,y-1),at('v',x,y)]);
    for(let y=0;y<(planar||cylinder?d:d-1);y++) for(let x=0;x<d-1;x++) addCheck('Z','face',x,y,[at('h',x,y),at('h',x,y+1),at('v',x,y),at('v',x+1,y)]);
    const boundaries=[{side:'left',geometry:'smooth',type:'X'},{side:'right',geometry:'smooth',type:'X'}];
    if(!cylinder) boundaries.push({side:'top',geometry:planar?'rough':'smooth',type:planar?'Z':'X'}, {side:'bottom',geometry:planar?'rough':'smooth',type:planar?'Z':'X'});
    return {layout,d,edges,checks,at,width:d-1,height:planar||cylinder?d:d-1,periodicX:false,periodicY:cylinder,boundaries};
  }
  function rotated(d) {
    const edges=[],checks=[],at=(x,y)=>y*d+x;
    for(let y=0;y<d;y++) for(let x=0;x<d;x++) edges.push({id:`q${at(x,y)+1}`,axis:'point',col:x,row:y,x,y,ends:[[x,y],[x,y]]});
    // Drawing shape and primal star/plaquette identity are distinct for this layout.
    // The latter survives a global Pauli swap and determines the anyon name.
    function check(type,x,y,support,side=null) { checks.push({type,kind:side?'half':'face',primalKind:type==='X'?'vertex':'face',side,x,y,support,mask:mask(support)}); }
    for(let y=0;y<d-1;y++) for(let x=0;x<d-1;x++) check((x+y)%2?'Z':'X',x+0.5,y+0.5,[at(x,y),at(x+1,y),at(x,y+1),at(x+1,y+1)]);
    // Transpose the former patch while retaining row-major data labels.
    for(let y=0;y<d-1;y++) {
      if(y%2===0) check('Z',-0.3,y+0.5,[at(0,y),at(0,y+1)],'left');
      else check('Z',d-0.7,y+0.5,[at(d-1,y),at(d-1,y+1)],'right');
    }
    for(let x=0;x<d-1;x++) {
      if(x%2===1) check('X',x+0.5,-0.3,[at(x,0),at(x+1,0)],'top');
      else check('X',x+0.5,d-0.7,[at(x,d-1),at(x+1,d-1)],'bottom');
    }
    // Match the anatomy figure: bulk in reading order, then top/bottom or left/right.
    // Names remain attached to their supports when the displayed Pauli types swap.
    const sideOrder={top:1,bottom:2,left:1,right:2};
    for(const type of ['X','Z'])checks.filter(ch=>ch.type===type)
      .sort((a,b)=>(sideOrder[a.side]||0)-(sideOrder[b.side]||0)||a.y-b.y||a.x-b.x)
      .forEach((ch,i)=>{ch.id=`${type}-${String.fromCharCode(97+i)}`;});
    return {layout:'rotated',d,edges,checks,at,width:d-1,height:d-1,periodicX:false,periodicY:false,
      boundaries:[{side:'top',geometry:null,type:'X'},{side:'bottom',geometry:null,type:'X'},{side:'left',geometry:null,type:'Z'},{side:'right',geometry:null,type:'Z'}]};
  }
  function makeCode(layout,d,swap=false) {
    if(!['torus','cylinder','planar','rotated','all-smooth'].includes(layout)||![3,5,7].includes(d)||typeof swap!=='boolean') throw new RangeError('Choose a listed layout, odd d=3,5,7, and a boolean Pauli swap.');
    return finish(layout==='torus'?torus(d):layout==='rotated'?rotated(d):unrotated(layout,d),swap);
  }
  function classify(code,error) {
    if(syndrome(code,error).some(Boolean)) return 'detectable';
    return ['X','Z'].every(type=>solve(code.checks.filter(c=>c.type===type).map(c=>c.mask),type==='X'?error.x:error.z)!==null)?'stabilizer':'logical';
  }
  // Enumerate supports by weight. For CSS codes, d=min(d_X,d_Z): any
  // mixed logical contains a nontrivial pure component of no greater weight.
  function logicalSearch(code,type,maxWeight) {
    if(!['X','Z'].includes(type)||!Number.isInteger(maxWeight)||maxWeight<0||maxWeight>5) throw new RangeError('Search supports through weight 0..5 for X or Z.');
    const opposite=code.checks.filter(c=>c.type!==type), own=basis(code.checks.filter(c=>c.type===type).map(c=>c.mask));
    const columns=code.edges.map((_,q)=>mask(opposite.map((c,i)=>(c.mask&bit(q))?i:-1).filter(i=>i>=0)));
    const inSpan=target=>{let a=target;while(a){const row=own.get(a.toString(2).length-1);if(!row)return false;a^=row.row;}return true;};
    let examined=0,found=null;
    function visit(start,left,support,s) {
      if(left===0){examined++;if(s===0n&&!inSpan(support)){found=support;return true;}return false;}
      for(let q=start;q<=code.n-left;q++) if(visit(q+1,left-1,support|bit(q),s^columns[q]))return true;
      return false;
    }
    for(let w=1;w<=maxWeight;w++) if(visit(0,w,0n,0n))return {distance:w,operator:found,examined,through:w-1};
    return {distance:null,operator:null,examined,through:maxWeight};
  }
  function distance(code) {
    if(!code.k)return {value:null,method:'undefined: k=0, no logical qubit'};
    if(code.d===3){const x=logicalSearch(code,'X',3),z=logicalSearch(code,'Z',3);return {value:Math.min(x.distance??Infinity,z.distance??Infinity),method:'computed by exhaustive supports through weight 3 (both CSS sectors)',x,z};}
    return {value:code.d,method:'formula d; straight logical and disjoint-representative bound'};
  }
  function logicalSupport(code,type) {
    const geometric=code.swap?(type==='X'?'Z':'X'):type,{d}=code;
    if(code.layout==='torus')return mask(Array.from({length:d},(_,j)=>geometric==='Z'?code.v(0,j):code.v(j,0)));
    if(code.layout==='rotated')return mask(Array.from({length:d},(_,j)=>geometric==='X'?code.at(0,j):code.at(j,0)));
    if(code.layout==='all-smooth') {
      if(geometric==='X') return mask(Array.from({length:d-1},(_,y)=>code.at('h',0,y)).concat([code.at('h',0,d-1)]));
      return code.checks.filter(c=>c.kind==='face').reduce((a,c)=>a^c.mask,0n);
    }
    return mask(Array.from({length:d},(_,j)=>geometric==='Z'?code.at('v',0,j):code.at('v',j,0)));
  }
  function twoErrorLookup(code) {
    if(code.layout!=='rotated'||code.d!==3)throw new RangeError('The two-error lookup requires the rotated d=3 patch.');
    const error={x:mask([0,3]),z:0n},checks=code.checks.filter(c=>c.type==='Z').sort((a,b)=>a.id.localeCompare(b.id));
    const target=checks.map(c=>parity(c.mask&error.x));
    let minimum=Infinity,candidates=[];
    // Enumerate all pure-X supports. Increasing masks break a minimum-weight
    // tie deterministically, so the canonical example selects X7 before X8.
    for(let a=0n;a<bit(code.n);a++) {
      const w=weight(a);
      if(w>minimum||checks.some((c,i)=>parity(c.mask&a)!==target[i]))continue;
      if(w<minimum){minimum=w;candidates=[];}
      candidates.push({x:a,z:0n});
    }
    const correction=candidates[0],residual={x:error.x^correction.x,z:0n};
    return {error,checks:checks.map(c=>c.id),syndrome:target,minimum,candidates,correction,residual,
      residualSyndrome:syndrome(code,residual),classification:classify(code,residual)};
  }
  function patternError(code,pattern,p=0.05,seed=7) {
    if(pattern==='random')return {error:randomError(code.n,p,seed),verdict:'Seeded depolarizing sample; no decoder is applied.'};
    if(pattern==='none')return {error:{x:0n,z:0n},verdict:'No error.'};
    if(pattern==='two-errors-fool-d3') {
      const recovery=twoErrorLookup(code);
      return {error:recovery.error,recovery,verdict:`Apply X1 X4, then a minimum-weight pure-X lookup with perfect syndrome. The displayed lattice shows the original error; error times the chosen correction is ${recovery.classification==='logical'?'a logical operator':'a stabilizer'}.`};
    }
    const type=pattern.startsWith('x')||pattern==='logical-x'?'X':'Z';
    if(pattern.startsWith('logical')) {
      const support=logicalSupport(code,type);return {error:{x:type==='X'?support:0n,z:type==='Z'?support:0n},verdict:code.k?'Candidate logical string; check syndrome and class.':'No logical qubit: this spanning operator is a stabilizer.'};
    }
    const rough=pattern.endsWith('rough'),side=rough?'top':'left';
    const boundary=code.boundaries?.find(b=>b.side===side);
    if(!boundary||(rough&&boundary.geometry==='smooth'))return {error:{x:0n,z:0n},verdict:`This layout has no ${rough?'rough':'smooth'} boundary for this pattern.`,unavailable:true};
    const {d}=code,mid=Math.floor(d/2),geometric=code.swap?(type==='X'?'Z':'X'):type;let support=[];
    if(code.layout==='rotated') {
      support=Array.from({length:mid},(_,j)=>rough?code.at(mid,j):code.at(j,mid));
    } else if(rough) {
      support=Array.from({length:mid},(_,j)=>geometric==='Z'?code.at('v',mid,j):code.at('h',mid-1,j+1));
    } else {
      support=Array.from({length:mid},(_,j)=>geometric==='X'?code.at('v',j,mid):code.at('h',j,mid));
    }
    const a=mask(support),absorbed=boundary.type===type;
    return {error:{x:type==='X'?a:0n,z:type==='Z'?a:0n},boundary,absorbed,
      verdict:absorbed?'Absorbed by the boundary: no syndrome at that end. The bulk end remains detected.':'Detected: the boundary end and the bulk end both have syndrome.'};
  }
  function countCurves() {
    return ['torus','planar','rotated'].map(layout=>({layout,points:Array.from({length:4},(_,i)=>{const d=3+2*i,n=layout==='torus'?2*d*d:layout==='planar'?d*d+(d-1)**2:d*d;return {d,data:n,total:layout==='torus'?2*n:2*n-1};})}));
  }
  function compute(params={}) {
    const p={layout:'planar',d:3,pattern:'z-to-rough',p:0.05,seed:7,swap_paulis:false,...params},warnings=[];
    if(!['torus','cylinder','planar','rotated','all-smooth'].includes(p.layout))warnings.push('Select a listed layout.');
    if(![3,5,7].includes(p.d))warnings.push('Choose d=3,5,7.');
    if(!['none','z-to-rough','z-to-smooth','x-to-smooth','x-to-rough','logical-z','logical-x','random','two-errors-fool-d3'].includes(p.pattern))warnings.push('Select a listed error pattern.');
    if(p.pattern==='two-errors-fool-d3'&&(p.layout!=='rotated'||p.d!==3))warnings.push('The two-error lookup requires the rotated d=3 patch. Restore that layout and size or choose another pattern.');
    if(!Number.isFinite(p.p)||p.p<0.001||p.p>0.5)warnings.push('p must be finite and between 0.001 and 0.5.');
    if(!Number.isInteger(p.seed)||p.seed<1||p.seed>99)warnings.push('Seed must be an integer from 1 to 99.');
    if(typeof p.swap_paulis!=='boolean')warnings.push('swap_paulis must be boolean.');
    if(warnings.length)return {valid:false,params:p,warnings};
    const code=makeCode(p.layout,p.d,p.swap_paulis),pattern=patternError(code,p.pattern,p.p,p.seed),bits=syndrome(code,pattern.error);
    if(pattern.unavailable)warnings.push(pattern.verdict);
    return {valid:true,params:p,warnings,code,...pattern,bits,flagged:bits.reduce((a,b)=>a+b,0),classification:classify(code,pattern.error),distance:distance(code),countCurves:countCurves()};
  }
  return {bit,mask,parity,weight,basis,solve,rank,mulberry32,randomError,torus,syndrome,makeCode,logicalSearch,distance,logicalSupport,classify,twoErrorLookup,patternError,countCurves,compute};
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
    for(let j=0;j<=Math.floor(c.width);j++)text(xy(j,0)[0],65,String(c.layout==='torus'?(j===c.width?0:j):(c.periodicX&&j===c.width?1:j+1)),{'font-size':12,fill:'var(--muted)'});
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
  StudyLab.register('planar-and-rotated', function mount(root,ctx){
    const layout=ctx.layout(root),doc=root.ownerDocument;ctx.controls.fromCard(layout.controls);
    const holder=doc.createElement('div');holder.style.overflowX='auto';holder.setAttribute('tabindex','0');holder.setAttribute('aria-label','Patch lattice, scroll horizontally on narrow screens');layout.plots.appendChild(holder);
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.id=`${ctx.id}-lattice`;svg.setAttribute('viewBox','0 0 520 525');svg.setAttribute('width','100%');svg.style.minWidth='520px';svg.style.maxWidth='760px';svg.setAttribute('role','group');svg.setAttribute('aria-label','Computed surface-code checks with inspectable supports');holder.appendChild(svg);
    const counts=ctx.plot(layout.plots,{title:'Computed data and total qubits',x:{label:'Odd distance d (disk marker: size only)',domain:[2.5,9.5]},y:{label:'Qubits (one measure per check)',domain:'auto'},legend:true});
    let selected=null;
    function draw(){const r=ctx.model.compute(ctx.state.all());ctx.warn(layout.notes,r.warnings.join(' ')||null);
      if(!r.valid){svg.replaceChildren();counts.update([]);ctx.readouts(layout.readouts,[]);ctx.notes(layout.notes,'');return;}
      const c=r.code,chosen=lattice(svg,r,selected,ctx.model),roles=['reference','primary','secondary'];
      counts.update(r.countCurves.flatMap((curve,i)=>[
        {id:`${curve.layout}-data`,label:`${curve.layout}: data`,role:roles[i],kind:'line',dash:'3 4',points:curve.points.map(p=>[p.d,p.data])},
        {id:`${curve.layout}-total`,label:`${curve.layout}: data + measure`,role:roles[i],kind:'line',points:curve.points.map(p=>[p.d,p.total])}
      ]).concat([{id:'selected',label:`${c.layout} operating points`,role:'accent',kind:'scatter',points:[[c.d,c.n],[c.d,c.total]]}]),[{type:'vline',x:c.d,label:c.layout==='all-smooth'?'Selected size':'Selected distance',role:'accent'}]);
      const items=[['Computed data qubits',c.n],['Computed X / Z checks',`${c.checks.filter(x=>x.type==='X').length} / ${c.checks.filter(x=>x.type==='Z').length}`],['Computed independent checks',c.rx+c.rz],['Computed logical qubits k',c.k],['Computed total data + measure',c.total],['Distance',r.distance.value===null?'Undefined (k=0)':r.distance.value],['Distance method',r.distance.method],['Computed flagged checks',r.flagged],['Computed operator class',r.classification]];
      if(c.layout==='rotated'&&r.params.pattern.startsWith('logical-')){
        const type=r.params.pattern==='logical-x'?'X':'Z',support=r.error[type==='X'?'x':'z'];
        const qubits=c.edges.filter((edge,q)=>(support&ctx.model.bit(q))!==0n);
        const direction=new Set(qubits.map(edge=>edge.col)).size===1?'column':'row';
        const sides=c.boundaries.filter(boundary=>boundary.type===type).map(boundary=>boundary.side).join(' to ');
        items.push(['Computed logical support',qubits.map(edge=>type+edge.id.slice(1)).join(' ')],['Computed logical direction',`${direction}; ${sides} ${type}-boundaries`]);
      }
      if(r.recovery){
        const recovery=r.recovery,support=e=>c.edges.flatMap((edge,q)=>(e.x&ctx.model.bit(q))?[`X${q+1}`]:[]).join(' ')||'I';
        items.push(['Computed error support',support(r.error)],['Computed lookup syndrome',`${recovery.checks.join(' ')}: ${recovery.syndrome.join('')}`],
          ['Computed minimum-weight corrections',recovery.candidates.map(support).join(' / ')],['Computed chosen correction',support(recovery.correction)],
          ['Computed residual support',support(recovery.residual)],['Computed residual class',recovery.classification],
          ['Computed residual syndrome weight',recovery.residualSyndrome.reduce((a,b)=>a+b,0)]);
      }
      ctx.readouts(layout.readouts,items.map(([label,value])=>({label,value})));
      ctx.notes(layout.notes,`<p>${r.verdict}</p><p>${chosen?`${chosen.id}: ${chosen.type} on ${chosen.support.map(q=>c.edges[q].id).join(', ')}. Weight ${chosen.support.length}; syndrome ${r.bits[c.checks.indexOf(chosen)]}.`:'Select a check with a pointer or Tab then Enter/Space to inspect its weight and data-qubit list.'}</p>`+
        (c.layout==='rotated'?'<p>Rotated data qubits are labeled row-major. Before a transversal Hadamard, X logicals run down a column between the top and bottom X-boundaries, and Z logicals run across a row between the left and right Z-boundaries. Only the check-type boundary names apply to this drawing.</p>':'<p>Geometric rough/smooth labels refer to this primal drawing. Apply a transversal Hadamard and inspect the boundary names again; geometry and ranks stay fixed.</p>')+
        `<p>The control means code after a transversal Hadamard (H on every data qubit). It exchanges X and Z on every check. The selected Pauli pattern is then applied to that code.${c.layout==='rotated'&&c.swap?' The picture is before spatial relabeling: X-boundaries are left/right and Z-boundaries top/bottom. A 90-degree rotation q(r,c) → q(c, d−1−r), with zero-based row and column, maps the transformed checks onto the original table.':''}</p>`+
        (r.recovery&&!c.swap?'<p>The lookup cannot distinguish X1 X4 from the lighter X7 or X8. It chooses X7 and leaves X1 X4 X7, the column X logical. Choosing X8 instead leaves X1 X4 X8, which differs by the bottom check X-d = X7 X8. Both residuals have zero syndrome and the same nontrivial logical class.</p>':'')+
        '<p>Dashed count curves show data only; solid curves include one measure qubit per check. Marker counts come from the selected incidence structure, including dependent checks. Try changing every boundary to smooth and explain why zero syndrome can no longer hide a logical qubit.</p>');
    }
    function select(event){const target=event.target.closest('[data-check]');if(!target||!svg.contains(target))return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();selected=target.getAttribute('data-check');draw();svg.querySelector(`[data-check="${selected}"]`)?.focus();}
    svg.addEventListener('click',select);svg.addEventListener('keydown',select);
    const unsubscribe=ctx.state.onChange(()=>{selected=null;draw();});draw();
    return {destroy(){unsubscribe();svg.removeEventListener('click',select);svg.removeEventListener('keydown',select);counts.destroy?.();holder.remove();}};
  });
})();

}).call(window);
