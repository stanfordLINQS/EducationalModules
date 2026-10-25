/* threshold-transition: pure model, then SDK view; separate scopes for file://. */
(function(){
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.StudyLabModels = root.StudyLabModels || {})['threshold-transition'] = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({mode:'shapes',shape:'seam-tree',L:24,p_e:0.5,samples:512,seed:17,w:4,p:0.01});
  // Module 8 architecture: labs.json, N-saw, compute_examples.py (2026-10-17).
  const SAW_COUNTS = Object.freeze([1,4,12,36,100,284,780,2172,5916,16268,44100]);
  const GRID = Object.freeze([0,0.25,0.4,0.45,0.475,0.5,0.525,0.55,0.6,0.75,1]);
  const SHAPES = Object.freeze(Object.fromEntries(Object.entries({
    'seam-tree':[['h',3,0]],
    'plaquette-cycle':[['h',1,1],['h',1,2],['v',1,1],['v',2,1]],
    'winding-z':[['h',0,0],['h',1,0],['h',2,0],['h',3,0]],
    'winding-x':[['h',0,0],['h',0,1],['h',0,2],['h',0,3]]
  }).map(([id,edges])=>[id,Object.freeze(edges.map(Object.freeze))])));
  function integer(x,lo,hi,name) {
    if (!Number.isInteger(x)||x<lo||x>hi) throw new RangeError(`${name} must be an integer from ${lo} to ${hi}.`);
  }
  function probability(p) {
    if (!Number.isFinite(p)||p<0||p>1) throw new RangeError('Probability must be finite and in [0, 1].');
  }
  function torus(L) {
    integer(L,2,24,'L');
    const mod=x=>(x%L+L)%L, vertex=(x,y)=>mod(y)*L+mod(x);
    const index=(axis,x,y)=>(axis==='v'?L*L:0)+vertex(x,y), edges=[];
    for (const axis of ['h','v']) for(let y=0;y<L;y++) for(let x=0;x<L;x++) {
      const primal=axis==='h'?[vertex(x,y),vertex(x+1,y),Number(x===L-1)]:[vertex(x,y),vertex(x,y+1),2*Number(y===L-1)];
      const dual=axis==='h'?[vertex(x,y-1),vertex(x,y),2*Number(y===0)]:[vertex(x-1,y),vertex(x,y),Number(x===0)];
      edges.push({id:`${axis}(${x},${y})`,axis,x,y,primal,dual});
    }
    return {L,n:edges.length,edges,index};
  }
  // A potential records two seam parities, from a vertex to its parent.
  class Forest {
    constructor(n) {this.parent=Int32Array.from({length:n},(_,i)=>i);this.size=new Int32Array(n).fill(1);this.pot=new Uint8Array(n);}
    find(v) {
      let root=v,voltage=0;
      while(this.parent[root]!==root){voltage^=this.pot[root];root=this.parent[root];}
      let remaining=voltage;
      while(this.parent[v]!==v){const next=this.parent[v],old=this.pot[v];this.parent[v]=root;this.pot[v]=remaining;remaining^=old;v=next;}
      return [root,voltage];
    }
    add(u,v,a) {
      let [ru,pu]=this.find(u),[rv,pv]=this.find(v);const t=pu^pv^a;
      if(ru===rv)return t;
      if(this.size[ru]<this.size[rv])[ru,rv]=[rv,ru];
      this.parent[rv]=ru;this.pot[rv]=t;this.size[ru]+=this.size[rv];return -1;
    }
  }
  function pathInTree(adj,start,end) {
    const queue=[start],previous=new Map([[start,null]]);
    for(let j=0;j<queue.length&&!previous.has(end);j++)for(const [v,q] of adj[queue[j]])if(!previous.has(v)){previous.set(v,[queue[j],q]);queue.push(v);}
    const path=[];
    for(let v=end;v!==start;){const [u,q]=previous.get(v);path.push(q);v=u;}
    return path.reverse();
  }
  function classify(L,erased) {
    const code=torus(L),support=[...new Set(erased)].sort((a,b)=>a-b);
    support.forEach(q=>integer(q,0,code.n-1,'Edge index'));
    const sectors=['primal','dual'].map(sector=>{
      const uf=new Forest(L*L),adj=Array.from({length:L*L},()=>[]),winding=new Set([0]);let witness=null;
      for(const q of support){const [u,v,a]=code.edges[q][sector],t=uf.add(u,v,a);
        if(t===-1){adj[u].push([v,q]);adj[v].push([u,q]);}
        else if(t){for(const old of [...winding])winding.add(old^t);if(!witness)witness={edges:[...pathInTree(adj,u,v),q],winding:[t&1,(t>>1)&1]};}
      }
      return {present:!!witness,witness,windings:[...winding].sort()};
    });
    return {L,erased_edges:support.length,uncorrectable:sectors.some(s=>s.present),primal_Z:sectors[0].present,dual_X:sectors[1].present,
      support,code,sectors:{Z:sectors[0],X:sectors[1]}};
  }
  function shape(name) {
    if(!Object.hasOwn(SHAPES,name))throw new RangeError('Select a named erased shape.');
    const c=torus(4);return classify(4,SHAPES[name].map(e=>c.index(...e)));
  }
  // The lab-specific contract requires xorshift32, overriding the common RNG default.
  function nextUint32(x) {x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
  function xorshift32(seed) {let x=seed>>>0;return ()=>{x=nextUint32(x);return x/4294967296;};}
  function startTrials(L,seed=17) {integer(L,2,24,'L');integer(seed,1,99,'Seed');return {L,seed,rngState:(seed+65537*L)>>>0,critical:[]};}
  // Pure incremental computation: input state and its prefix never change.
  function advanceTrials(state,count) {
    integer(count,0,1024-state.critical.length,'Additional trials');
    const code=torus(state.L),critical=state.critical.slice();let rngState=state.rngState;
    for(let trial=0;trial<count;trial++) {
      const arrival=new Float64Array(code.n),order=Array.from({length:code.n},(_,i)=>i);
      for(let q=0;q<code.n;q++){rngState=nextUint32(rngState);arrival[q]=rngState/4294967296;}
      order.sort((a,b)=>arrival[a]-arrival[b]||a-b);
      const primal=new Forest(state.L**2),dual=new Forest(state.L**2);
      for(const q of order)if(primal.add(...code.edges[q].primal)>0||dual.add(...code.edges[q].dual)>0){critical.push(arrival[q]);break;}
    }
    return {...state,rngState,critical};
  }
  function sample(L,samples=512,seed=17) {integer(samples,1,1024,'Samples');return advanceTrials(startTrials(L,seed),samples);}
  function wilson(k,n) {
    integer(n,1,1024,'Samples');integer(k,0,n,'Uncorrectable count');
    const z=1.96,u=k/n,den=1+z*z/n,c=(u+z*z/(2*n))/den,h=z*Math.sqrt(u*(1-u)/n+z*z/(4*n*n))/den;
    return [Math.max(0,c-h),Math.min(1,c+h)];
  }
  function estimate(critical,p,n=critical.length) {
    probability(p);integer(n,1,critical.length,'Samples');
    let failures=0;for(let i=0;i<n;i++)if(critical[i]<p)failures++;
    return {p,failures,samples:n,estimate:failures/n,wilson95:wilson(failures,n)};
  }
  const sizes=L=>[...new Set([4,8,12,L])].sort((a,b)=>a-b);
  function crossing(params,trials) {
    return sizes(params.L).map(L=>{
      const state=trials?.[L]||sample(L,params.samples,params.seed);
      if(state.L!==L||state.seed!==params.seed||state.critical.length<params.samples)throw new RangeError('Trial cache does not match the requested experiment.');
      return {L,selected:estimate(state.critical,params.p_e,params.samples),curve:GRID.map(p=>estimate(state.critical,p,params.samples))};
    });
  }
  function counting(w,p) {
    integer(w,1,10,'Walk length');probability(p);const c_w=SAW_COUNTS[w];
    return {c_w,nonbacktracking:4*3**(w-1),all_faulty_weight:c_w*p**w,dangerous_loop_weight:c_w*(2*Math.sqrt(p*(1-p)))**w};
  }
  function validate(params={}) {
    const p={...DEFAULTS,...params},warnings=[];
    if(!['shapes','crossing','counting'].includes(p.mode))warnings.push('Select Shapes, Crossing, or Counting.');
    if(!Object.hasOwn(SHAPES,p.shape))warnings.push('Select a named erased shape.');
    if(!Number.isInteger(p.L)||p.L<4||p.L>24||p.L%4)warnings.push('L must be 4, 8, 12, 16, 20, or 24.');
    if(!Number.isFinite(p.p_e)||p.p_e<0||p.p_e>1)warnings.push('Erasure probability must be finite and in [0, 1].');
    if(![256,512,1024].includes(p.samples))warnings.push('Select 256, 512, or 1024 samples.');
    if(!Number.isInteger(p.seed)||p.seed<1||p.seed>99)warnings.push('Seed must be an integer from 1 to 99.');
    if(!Number.isInteger(p.w)||p.w<1||p.w>10)warnings.push('Walk length must be an integer from 1 to 10.');
    if(!Number.isFinite(p.p)||p.p<0.001||p.p>0.2)warnings.push('Counting p must be finite and between 0.001 and 0.2.');
    return {valid:!warnings.length,params:p,warnings};
  }
  function compute(params={},trials) {
    const r=validate(params);if(!r.valid)return r;const p=r.params;
    if(p.mode==='shapes')return {...r,shape:shape(p.shape)};
    if(p.mode==='counting')return {...r,readouts:counting(p.w,p.p),curve:Array.from({length:10},(_,i)=>({w:i+1,...counting(i+1,p.p)}))};
    return {...r,crossing:crossing(p,trials)};
  }
  return {DEFAULTS,SAW_COUNTS,GRID,SHAPES,torus,classify,shape,nextUint32,xorshift32,startTrials,advanceTrials,sample,wilson,estimate,sizes,crossing,counting,validate,compute};
});

}).call(window);
(function(){
(function () {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const roles=['primary','secondary','tertiary','accent'],dashes=['','7 4','2 4','10 3 2 3'],markers=['○','□','◇','△'];
  function element(doc,parent,tag,text) {const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;parent.appendChild(e);return e;}
  function svgElement(svg,tag,attrs={},text,parent=svg) {
    const e=svg.ownerDocument.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));
    if(text!==undefined)e.textContent=text;parent.appendChild(e);return e;
  }
  function lattice(svg,r,selected) {
    svg.replaceChildren();svgElement(svg,'title',{},'Erased support on a periodic L = 4 torus. Select a data ring to inspect its edge.');
    const origin=43,step=65,xy=(x,y)=>[origin+step*x,origin+step*y];
    const text=(x,y,t,attrs={})=>svgElement(svg,'text',{x,y,fill:'var(--text)','font-size':14,'text-anchor':'middle',...attrs},t);
    const line=(a,b,attrs={})=>{const [x1,y1]=xy(...a),[x2,y2]=xy(...b);svgElement(svg,'line',{x1,y1,x2,y2,stroke:'var(--line)','stroke-width':1,...attrs});};
    for(let j=0;j<=4;j++){line([0,j],[4,j]);line([j,0],[j,4]);text(xy(j,0)[0],32,j%4);text(29,xy(0,j)[1]+5,j%4);}
    text(173,16,'x →');text(13,174,'y ↓');text(173,329,'⇔ opposite edges identified ⇕');
    const support=new Set(r.support);
    for(const [sector,style] of [['Z',{'stroke-dasharray':'7 4',stroke:'var(--plot-secondary)'}],['X',{stroke:'var(--plot-primary)'}]]) {
      const witness=r.sectors[sector].witness;if(!witness)continue;
      for(const q of witness.edges){const e=r.code.edges[q],{x,y,axis}=e;
        if(sector==='Z'){
          line([x,y],[x+(axis==='h'?1:0),y+(axis==='v'?1:0)],{'stroke-width':4,...style});
          if(axis==='h'&&y===0)line([x,4],[x+1,4],{'stroke-width':4,opacity:0.45,...style});
          if(axis==='v'&&x===0)line([4,y],[4,y+1],{'stroke-width':4,opacity:0.45,...style});
        }else if(axis==='h'){
          if(y===0){line([x+0.5,0],[x+0.5,0.5],{'stroke-width':4,...style});line([x+0.5,3.5],[x+0.5,4],{'stroke-width':4,...style});}
          else line([x+0.5,y-0.5],[x+0.5,y+0.5],{'stroke-width':4,...style});
        }else{
          if(x===0){line([0,y+0.5],[0.5,y+0.5],{'stroke-width':4,...style});line([3.5,y+0.5],[4,y+0.5],{'stroke-width':4,...style});}
          else line([x-0.5,y+0.5],[x+0.5,y+0.5],{'stroke-width':4,...style});
        }
      }
    }
    for(let y=0;y<=4;y++)for(let x=0;x<=4;x++){
      const [cx,cy]=xy(x,y);svgElement(svg,'rect',{x:cx-3,y:cy-3,width:6,height:6,fill:'var(--plot-primary)',stroke:'var(--plot-primary)',opacity:x===4||y===4?0.45:1});
      if(x<4&&y<4){const [fx,fy]=xy(x+0.5,y+0.5);svgElement(svg,'rect',{x:fx-3,y:fy-3,width:6,height:6,fill:'var(--bg)',stroke:'var(--plot-secondary)','stroke-width':1.5});}
    }
    function ring(e,q,dx=0,dy=0,duplicate=false){
      const [cx,cy]=xy(e.x+(e.axis==='h'?0.5:0)+dx,e.y+(e.axis==='v'?0.5:0)+dy),erased=support.has(q),active=selected===q;
      const g=svgElement(svg,'g',duplicate?{opacity:0.45}:{'data-edge':q,tabindex:0,role:'button','aria-pressed':String(active),'aria-label':`${e.id}: ${erased?'erased':'not erased'}. Inspect edge.`});
      svgElement(svg,'circle',{cx,cy,r:12,fill:'var(--bg)','fill-opacity':0,stroke:active?'var(--plot-accent)':'none','stroke-width':2},undefined,g);
      svgElement(svg,'circle',{cx,cy,r:erased?6:3.5,fill:'var(--bg)',stroke:'var(--text)','stroke-width':erased?3:1.2},undefined,g);
    }
    r.code.edges.forEach((e,q)=>{ring(e,q);if(e.axis==='h'&&e.y===0)ring(e,q,0,4,true);if(e.axis==='v'&&e.x===0)ring(e,q,4,0,true);});
    text(173,351,'○ data   ■ X check   □ Z check');text(173,372,'Thick ring: erased   Z dashed / X solid');
  }
  function markerPoints(rows,i) {
    const outlines=[null,[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]],[[0,-1],[1,0],[0,1],[-1,0],[0,-1]],[[0,1],[-1,-1],[1,-1],[0,1]]];
    return rows.flatMap(r=>[...outlines[i].map(([x,y])=>[r.p+0.007*x,r.estimate+0.017*y]),[NaN,NaN]]);
  }
  StudyLab.register('threshold-transition',function mount(root,ctx){
    const doc=root.ownerDocument,layout=ctx.layout(root),model=ctx.model;
    ctx.controls.fromCard(layout.controls);
    const status=element(doc,layout.plots,'p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const shapes=element(doc,layout.plots,'div');
    const svg=doc.createElementNS(NS,'svg');shapes.appendChild(svg);svg.setAttribute('viewBox','0 0 350 385');svg.setAttribute('width','100%');svg.style.maxWidth='520px';svg.style.minWidth='300px';svg.setAttribute('role','group');svg.setAttribute('aria-label','Erased lattice with inspectable data rings');shapes.style.overflowX='auto';
    const crossing=element(doc,layout.plots,'div'),completed=element(doc,crossing,'p'),legend=element(doc,crossing,'p');
    const curves=ctx.plot(crossing,{title:'Uncorrectable erasure event probability',x:{label:'Erasure probability p_e',domain:[0,1]},y:{label:'Uncorrectable erasure event probability',domain:[0,1]},legend:false});
    const samplesTable=element(doc,crossing,'details');element(doc,samplesTable,'summary','All curve samples and intervals');const tables=element(doc,samplesTable,'div');
    const counting=element(doc,layout.plots,'div'),walks=ctx.plot(counting,{title:'How counts compete with weights',x:{label:'Walk length w',domain:[1,10]},y:{label:'log10 count or weighted count',domain:'auto'},legend:true});
    const counts=element(doc,layout.plots,'div'),countPlot=ctx.plot(counts,{title:'Rooted walk counts',x:{label:'Walk length w',domain:'auto'},y:{label:'Number of walks',domain:'auto'},legend:true});
    element(doc,counts,'p','The solid line counts walks that never revisit a vertex. The dashed bound allows four first steps and three later choices. Select Counting to change the final walk length.');
    let selected=null,lastShape=null,token=0,pending=null,disposed=false,batchSize=8,lastCompleted=null;
    const prefixes=new Map(),cache=new Map();
    const now=()=>performance.now();
    function cancel(){token++;if(pending!==null)cancelAnimationFrame(pending);pending=null;}
    const key=(L,p)=>`${L}:${p.seed}:${p.samples}`,prefixKey=(L,p)=>`${L}:${p.seed}`;
    function remember(p){
      for(const L of model.sizes(p.L)){
        const s=prefixes.get(prefixKey(L,p));
        if(s?.critical.length>=p.samples)cache.set(key(L,p),{...s,critical:s.critical.slice(0,p.samples)});
      }
      // Bounded per-mount caches retain recent runs and resumable prefixes.
      while(cache.size>24)cache.delete(cache.keys().next().value);
      while(prefixes.size>12)prefixes.delete(prefixes.keys().next().value);
    }
    function shapeNotes(){
      const r=lastShape,e=selected===null?null:r.code.edges[selected];
      const explanation=r.uncorrectable?'The erased support contains a logical operator, so recovery cannot be guaranteed for every stored state.':r.erased_edges===1?'A seam crossing is an edge, not a closed winding cycle. This erased set is correctable.':'The closed primal loop bounds one plaquette. It is a stabilizer, so this erased set is correctable.';
      ctx.notes(layout.notes,`<p>${explanation}</p><p>${e?`${e.id}: ${r.support.includes(selected)?'erased':'not erased'}. Primal endpoints (${e.x},${e.y}) and (${(e.x+(e.axis==='h'?1:0))%4},${(e.y+(e.axis==='v'?1:0))%4}).`:'Select a data ring with a pointer or Tab then Enter/Space to inspect its edge.'}</p><p>Faint border copies identify the same periodic qubits. An erasure marks a location without selecting a Pauli error.</p>`);
    }
    function renderShapes(r){
      lastShape=r.shape;lattice(svg,lastShape,selected);status.textContent='Ready: named L = 4 erased set.';
      const s=r.shape,items=[['L',s.L],['Erased edges',s.erased_edges],['Recovery of an arbitrary stored state',s.uncorrectable?'Uncorrectable':'Correctable'],['Primal Z winding present',s.primal_Z?'yes':'no'],['Dual X winding present',s.dual_X?'yes':'no'],['Erased support',s.support.map(q=>s.code.edges[q].id).join(', ')]];
      for(const sector of ['Z','X']){const witness=s.sectors[sector].witness;if(witness)items.push([`${sector} logical witness`,witness.edges.map(q=>s.code.edges[q].id).join(', ')],[`${sector} winding (horizontal, vertical)`,witness.winding.join(', ')]);}
      ctx.readouts(layout.readouts,items.map(([label,value])=>({label,value})));shapeNotes();
    }
    function renderCrossing(p,previousResult){
      const trials=Object.fromEntries(model.sizes(p.L).map(L=>[L,cache.get(key(L,p))])),r=previousResult||model.compute(p,trials);
      lastCompleted={params:{...p},result:r};completed.textContent=`Completed: sizes ${model.sizes(p.L).join(', ')}; seed ${p.seed}; N = ${p.samples}; selected p_e = ${p.p_e}.`;
      legend.textContent=r.crossing.map((row,i)=>`${markers[i]} L = ${row.L} (${['solid','dashed','dotted','dash-dot'][i]})`).join('; ')+'. Bars: pointwise 95% Wilson intervals.';
      const series=[];
      for(const [i,row] of r.crossing.entries()){
        series.push({id:`curve-${row.L}`,label:`L = ${row.L}`,role:roles[i],kind:'line',dash:dashes[i],points:row.curve.map(v=>[v.p,v.estimate])});
        series.push({id:`interval-${row.L}`,label:`L = ${row.L} Wilson intervals`,role:roles[i],kind:'line',width:1,points:row.curve.flatMap(v=>[[v.p,v.wilson95[0]],[v.p,v.wilson95[1]],[NaN,NaN]])});
        series.push({id:`marker-${row.L}`,label:`L = ${row.L} ${markers[i]}`,role:roles[i],kind:i?'line':'scatter',width:1.5,points:i?markerPoints(row.curve,i):row.curve.map(v=>[v.p,v.estimate])});
      }
      curves.update(series,[{type:'vline',x:0.5,label:'Reference 1/2',role:'reference'},{type:'vline',x:p.p_e,role:'accent'}]);
      ctx.readouts(layout.readouts,r.crossing.flatMap(({L,selected:s})=>[
        {label:`L = ${L}: uncorrectable sets / samples`,value:`${s.failures}/${s.samples}`},
        {label:`L = ${L}: event probability`,value:s.estimate,format:'fixed',digits:4},
        {label:`L = ${L}: Wilson 95% interval`,value:`[${s.wilson95.map(x=>x.toFixed(4)).join(', ')}]`}
      ]));
      tables.replaceChildren();
      for(const row of r.crossing){const table=element(doc,tables,'table');table.style.width='100%';table.style.fontSize='12px';element(doc,table,'caption',`L = ${row.L}, seed ${p.seed}, N = ${p.samples}`);
        const head=element(doc,table,'thead'),tr=element(doc,head,'tr');for(const h of ['p_e','Count / N','Estimate','Wilson 95%']){const th=element(doc,tr,'th',h);th.setAttribute('scope','col');}
        const body=element(doc,table,'tbody');for(const v of row.curve){const tr=element(doc,body,'tr');for(const value of [v.p,`${v.failures}/${v.samples}`,v.estimate.toFixed(4),v.wilson95.map(x=>x.toFixed(4)).join(' to ')])element(doc,tr,'td',value);}
      }
      ctx.notes(layout.notes,'<p>The event is an erased set that hides a logical operator in either sector. A decoder can still guess correctly on some such sets.</p><p>The reference at one half is the infinite-size erasure threshold for this model. Finite curves are rounded; their values there need not be one half or coincide. Wilson intervals are pointwise, not a simultaneous confidence band.</p><p>Changing p_e reuses the same trials. Values between plotted probabilities are counted directly from those trials. Zero and all-uncorrectable counts retain nonzero Wilson interval widths; the probabilities at p_e = 0 and 1 are also known analytically.</p>');
      status.textContent='Ready: completed erasure samples.';
    }
    function requestCrossing(p){
      remember(p);const required=model.sizes(p.L);
      if(required.every(L=>cache.has(key(L,p)))){renderCrossing(p);return;}
      const mine=token;
      if(lastCompleted)renderCrossing(lastCompleted.params,lastCompleted.result);
      status.textContent=`Waiting: seed ${p.seed}, N = ${p.samples}, sizes ${required.join(', ')}.${lastCompleted?' Previous completed results remain labeled below.':''}`;
      if(!lastCompleted){completed.textContent='No completed crossing run yet.';ctx.readouts(layout.readouts,[]);ctx.notes(layout.notes,'Each trial tests the same erased set for both primal Z and dual X logical support.');}
      function frame(){
        pending=null;if(disposed||mine!==token)return;
        const start=now();let count=0;
        while(count<batchSize){
          const L=required.find(L=>!cache.has(key(L,p))&&(prefixes.get(prefixKey(L,p))?.critical.length||0)<p.samples);if(L===undefined)break;
          const pk=prefixKey(L,p),state=prefixes.get(pk)||model.startTrials(L,p.seed);
          prefixes.set(pk,model.advanceTrials(state,1));count++;
          if(now()-start>=12)break;
        }
        const elapsed=now()-start;if(elapsed>16)batchSize=Math.max(1,Math.floor(batchSize/2));
        const done=required.reduce((sum,L)=>sum+(cache.has(key(L,p))?p.samples:Math.min(p.samples,prefixes.get(prefixKey(L,p))?.critical.length||0)),0);
        status.textContent=`Computing: ${done}/${required.length*p.samples} trials; seed ${p.seed}, N = ${p.samples}.${lastCompleted?' Previous completed results remain labeled below.':''}`;
        remember(p);
        if(required.every(L=>cache.has(key(L,p))))renderCrossing(p);else pending=requestAnimationFrame(frame);
      }
      pending=requestAnimationFrame(frame);
    }
    function renderWalkCounts(p){
      // Exact finite counts are ready before any Monte Carlo frame runs.
      const r=model.compute({...p,mode:'counting'}),rows=r.curve.filter(row=>row.w<=p.w);
      countPlot.update([
        {id:'rooted-counts',label:'Rooted walks c_w',role:'primary',kind:'line',points:rows.map(row=>[row.w,row.c_w])},
        {id:'walk-count-bound',label:'Nonbacktracking bound',role:'reference',kind:'line',dash:'3 4',points:rows.map(row=>[row.w,row.nonbacktracking])}
      ],p.w===1?[{type:'point',x:1,y:r.readouts.c_w,label:'Both counts: 4',role:'primary'}]:[]);
      return r;
    }
    function renderCounting(r){
      const {p,w}=r.params;status.textContent=`Ready: walk length ${w}, counting p = ${p}.`;
      walks.update([
        ['c_w','Rooted walks','primary',''],['nonbacktracking','Nonbacktracking bound','reference','3 4'],
        ['all_faulty_weight','All-faulty weighted count','secondary','7 4'],['dangerous_loop_weight','Dangerous-loop weighted count','tertiary','10 3 2 3']
      ].map(([id,label,role,dash])=>({id,label,role,dash,kind:'line',points:r.curve.map(row=>[row.w,Math.log10(row[id])])})),[{type:'vline',x:w,label:'Selected length',role:'accent'}]);
      const a=r.readouts;ctx.readouts(layout.readouts,[{label:'Rooted walks c_w',value:a.c_w},{label:'Nonbacktracking bound',value:a.nonbacktracking},{label:'All-faulty weighted count',value:a.all_faulty_weight,format:'sig',digits:12},{label:'Dangerous-loop weighted count',value:a.dangerous_loop_weight,format:'sig',digits:12}]);
      ctx.notes(layout.notes,'<p>A self-avoiding walk never revisits a vertex. The nonbacktracking bound allows four first steps and three later choices, so it also counts walks that revisit older vertices.</p><p>The all-faulty weight requires every edge to fail. The dangerous-loop weight instead comes from the bound requiring at least half a loop to be faulty. These are auxiliary weighted counts, not measured failure probabilities. This p is separate from the erasure control p_e.</p>');
    }
    function draw(){
      cancel();selected=null;const r=model.validate(ctx.state.all());ctx.warn(layout.notes,r.warnings.join(' ')||null);
      shapes.hidden=!r.valid||r.params.mode!=='shapes';crossing.hidden=!r.valid||r.params.mode!=='crossing';counting.hidden=!r.valid||r.params.mode!=='counting';counts.hidden=!r.valid;
      if(!r.valid){status.textContent='Check the parameter values.';ctx.readouts(layout.readouts,[]);ctx.notes(layout.notes,'');return;}
      const walkResult=renderWalkCounts(r.params);
      if(r.params.mode==='crossing')requestCrossing(r.params);
      else if(r.params.mode==='shapes')renderShapes(model.compute(r.params));else renderCounting(walkResult);
    }
    function select(event){const target=event.target.closest('[data-edge]');if(!target||!svg.contains(target))return;if(event.type==='keydown'&&!['Enter',' '].includes(event.key))return;event.preventDefault();selected=Number(target.getAttribute('data-edge'));lattice(svg,lastShape,selected);shapeNotes();svg.querySelector(`[data-edge="${selected}"]`)?.focus();}
    svg.addEventListener('click',select);svg.addEventListener('keydown',select);
    const unsubscribe=ctx.state.onChange(draw);draw();
    return {destroy(){disposed=true;cancel();unsubscribe();svg.removeEventListener('click',select);svg.removeEventListener('keydown',select);curves.destroy?.();walks.destroy?.();countPlot.destroy?.();counts.remove();shapes.remove();crossing.remove();counting.remove();status.remove();cache.clear();prefixes.clear();}};
  });
})();

}).call(window);
