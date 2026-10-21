(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyCapabilityMap=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function dependencyGraph(modules){
    const byId=new Map(modules.map(m=>[m.id,m])),ancestors=new Map(),depths=new Map(),visiting=new Set();
    function visit(id){
      if(ancestors.has(id))return ancestors.get(id);
      if(visiting.has(id))throw new Error('Dependency cycle at '+id);
      if(!byId.has(id))throw new Error('Unknown prerequisite '+id);
      visiting.add(id);
      const all=new Set(),required=byId.get(id).requires||[];
      let depth=0;
      for(const parent of required){all.add(parent);for(const a of visit(parent))all.add(a);depth=Math.max(depth,depths.get(parent)+1);}
      visiting.delete(id);ancestors.set(id,all);depths.set(id,depth);return all;
    }
    modules.forEach(m=>visit(m.id));
    const nodes=modules.map(m=>{
      const requires=[...new Set(m.requires||[])];
      // Drop u → v only when another prerequisite of v already depends on u.
      const immediate=requires.filter(u=>!requires.some(w=>w!==u&&ancestors.get(w).has(u)));
      return {...m,requires,immediate,depth:depths.get(m.id),unlocks:modules.filter(n=>(n.requires||[]).includes(m.id)).map(n=>n.id)};
    });
    let row=1;
    for(const depth of [...new Set(nodes.map(n=>n.depth))].sort((a,b)=>a-b)){
      const layer=nodes.filter(n=>n.depth===depth);
      // At most three boxes per row; additional branches wrap without shrinking their text.
      for(let i=0;i<layer.length;i+=3){
        const chunk=layer.slice(i,i+3),span=6/chunk.length;
        chunk.forEach((n,j)=>Object.assign(n,{row,column:j*span+1,span}));row++;
      }
    }
    return {nodes,edges:nodes.flatMap(n=>n.immediate.map(from=>({from,to:n.id})))};
  }
  function moduleProgress(ids,items={},visited=false){
    const total=ids.length,done=ids.filter(id=>items[id]?.attempts?.length).length;
    const state=total>0&&done===total?'practiced':done||visited?'visited':'unvisited';
    return {total,done,state,label:{unvisited:'Not started',visited:'In progress',practiced:'Practised'}[state]};
  }
  function install(document){
    const host=document.defaultView,maps=[...document.querySelectorAll('.dependency-map')];
    if(!maps.length)return;
    let frame;
    function draw(){
      for(const map of maps){
        const svg=map.querySelector('.dependency-edges'),bounds=map.getBoundingClientRect();
        svg.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
        const boxes=new Map([...map.querySelectorAll('[data-map-node]')].map(el=>[el.dataset.mapNode,{...el.getBoundingClientRect().toJSON(),row:Number(el.parentElement.style.gridRowStart)}]));
        let bypass=0;
        for(const edge of svg.querySelectorAll('[data-from]')){
          const a=boxes.get(edge.dataset.from),b=boxes.get(edge.dataset.to);if(!a||!b)continue;
          const x1=a.left+a.width/2-bounds.left,y1=a.bottom-bounds.top,x2=b.left+b.width/2-bounds.left,y2=b.top-bounds.top;
          const mid=(y1+y2)/2;
          // Skip-level edges travel in the side gutter, never through an intervening box.
          const lane=bounds.width-4-6*(bypass%3);
          edge.setAttribute('d',b.row>a.row+1
            ?`M${x1} ${y1}V${y1+16}H${lane}V${y2-18}H${x2}V${y2-6}`
            :`M${x1} ${y1}C${x1} ${mid},${x2} ${mid},${x2} ${y2-6}`);
          if(b.row>a.row+1)bypass++;
        }
      }
    }
    const schedule=()=>{host.cancelAnimationFrame(frame);frame=host.requestAnimationFrame(draw);};
    const observer=host.ResizeObserver?new host.ResizeObserver(schedule):null;
    maps.forEach(map=>{observer?.observe(map);map.querySelectorAll('[data-map-node]').forEach(el=>observer?.observe(el));});
    host.addEventListener('resize',schedule);document.fonts?.ready.then(schedule);schedule();
  }
  return {dependencyGraph,moduleProgress,install};
});
