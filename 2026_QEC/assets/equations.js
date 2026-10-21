(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyEquations=api;
})(typeof self!=='undefined'?self:this,function(host){
  'use strict';
  function scaleFor(available,natural,min=.8){
    return available>0&&natural>0?Math.max(min,Math.min(1,(available-2)/natural)):1;
  }
  function relevantMutation(mutation){
    const el=mutation.target?.nodeType===3?mutation.target.parentElement:mutation.target;
    return !el?.closest?.('.rail,#status,.save-status,.outline-status,#sync-state,.practice-status');
  }
  function install(doc){
    const bodies=new Set();let frame=null;
    const queue=()=>{if(frame===null)frame=host.requestAnimationFrame(()=>{frame=null;fitAll();});};
    const resize=host.ResizeObserver?new host.ResizeObserver(queue):null;
    function fit(body){
      if(!body.getClientRects().length||body.clientWidth===0)return;
      body.style.fontSize='';
      const base=parseFloat(host.getComputedStyle(body).fontSize),natural=body.scrollWidth,available=body.clientWidth;
      const scale=natural>available+1?scaleFor(available,natural):1;
      body.style.fontSize=base*scale+'px';body.dataset.equationScale=String(scale);
      const overflow=body.scrollWidth>body.clientWidth+2;
      body.closest('.equation').classList.toggle('equation-overflow',overflow);
      const cue=body.parentNode.querySelector('.equation-scroll-cue');cue.hidden=!overflow;
      if(overflow){body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-label','Equation; use left and right arrow keys to scroll');}
      else{body.removeAttribute('tabindex');body.removeAttribute('role');body.removeAttribute('aria-label');}
      edge(body);
    }
    function edge(body){
      body.dataset.scrollEnd=String(body.scrollLeft+body.clientWidth>=body.scrollWidth-2);
      body.dataset.scrollStart=String(body.scrollLeft<=2);
    }
    function fitAll(){
      for(const body of doc.querySelectorAll('.equation-body'))if(!bodies.has(body)){
        bodies.add(body);resize?.observe(body);
        const cue=doc.createElement('small');cue.className='equation-scroll-cue';cue.textContent='Scroll → (or use arrow keys)';cue.hidden=true;body.parentNode.append(cue);
        body.addEventListener('scroll',()=>edge(body),{passive:true});
        body.addEventListener('keydown',e=>{
          const moves={ArrowLeft:-80,ArrowRight:80,Home:-body.scrollWidth,End:body.scrollWidth};
          if(body.tabIndex===0&&e.key in moves){e.preventDefault();body.scrollLeft+=moves[e.key];}
        });
      }
      for(const body of bodies){if(body.isConnected)fit(body);else{resize?.unobserve(body);bodies.delete(body);}}
    }
    function report({all=false}={}){
      const restore=[];
      // Synchronous audit only: restore before painting or queued details toggle events.
      if(all)for(const el of doc.querySelectorAll('details:not([open]),[hidden]')){
        if(el.tagName==='DETAILS'){restore.push(()=>el.open=false);el.open=true;}
        if(el.hidden){restore.push(()=>el.hidden=true);el.hidden=false;}
      }
      fitAll();
      const result=[...bodies].filter(b=>b.clientWidth>0).map((b,i)=>{
        const eq=b.closest('.equation');
        return {id:eq.id||eq.dataset.equationRef||`unlabelled-${i+1}`,line:Number(eq.dataset.sourceLine)||null,
          modelCard:!!eq.closest('.model-card'),width:b.clientWidth,scrollWidth:b.scrollWidth,scale:Number(b.dataset.equationScale),overflow:b.scrollWidth>b.clientWidth+2,
          scrollAccessible:b.scrollWidth<=b.clientWidth+2||(b.tabIndex===0&&!b.parentNode.querySelector('.equation-scroll-cue').hidden)};
      });
      restore.reverse().forEach(fn=>fn());fitAll();return result;
    }
    host.addEventListener('resize',queue);host.addEventListener('study:theme',queue);
    doc.addEventListener('toggle',queue,true);doc.addEventListener('study:layout',queue);
    const main=doc.querySelector?.('main');
    if(main)new host.MutationObserver(mutations=>{if(mutations.some(relevantMutation))queue();}).observe(main,{childList:true,characterData:true,subtree:true});
    doc.fonts?.ready.then(queue);fitAll();
    return {fitAll,report};
  }
  return {scaleFor,relevantMutation,install};
});
