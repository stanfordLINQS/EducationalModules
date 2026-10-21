(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudyNavigation=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function openAncestors(target,{onModel=()=>{},onHint=()=>{}}={}){
    for(let el=target;el;el=el.parentElement){
      if(el.tagName==='DETAILS'){el.hidden=false;el.open=true;if(el.classList.contains('hint'))onHint(el);}
      if(el.classList?.contains('model-card-body')){el.hidden=false;onModel(el);}
      if(el.classList?.contains('exercise-support'))el.hidden=false;
    }
    return target;
  }
  function resumeHref(last,modules=[]){
    if(!last)return null;
    const [module,subsection]=last.split('#');
    return modules.some(m=>m.id===module)?`${module}.html${subsection?'#'+encodeURIComponent(subsection):''}`:null;
  }
  function jumpResults(targets={},index={},modules=[],query=''){
    const needle=query.trim().toLowerCase(),entries={...index,...targets};
    const extra=[...new Set(Object.values(entries).map(t=>t.module).filter(id=>id&&!modules.some(m=>m.id===id)))].map(id=>({id,title:id}));
    return modules.concat(extra,[{id:null,title:'Course'}]).map(mod=>({module:mod.id,title:mod.id?`${mod.number??mod.id} · ${mod.title}`:'Course',results:Object.entries(entries).filter(([id,t])=>
      (t.module||null)===mod.id&&`${t.title||''} ${id} ${mod.number??''} ${mod.id||''}`.toLowerCase().includes(needle)
    ).map(([id,t])=>({id,title:t.title||id,href:t.module?`${t.module}.html#${encodeURIComponent(id)}`:'index.html'+(t.type==='course'?'':'#'+encodeURIComponent(id))}))})).filter(g=>g.results.length);
  }
  function isTyping(target){return !!target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');}
  function createPositionWriter(write,{initial=null,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,delay=2000}={}){
    let current=initial,pending=initial,last=-Infinity,timer=null;
    function flush(){if(timer!==null)clearTimer(timer);timer=null;if(pending!==current){current=pending;last=now();write(current);}}
    function queue(value){pending=value;if(timer!==null){clearTimer(timer);timer=null;}if(value===current)return;const wait=delay-(now()-last);if(wait<=0)flush();else timer=setTimer(flush,wait);}
    return {queue,flush};
  }
  function installPrint(doc,host){
    let restore=[],active=false,release;
    const api={get active(){return active;}};
    host.addEventListener('beforeprint',()=>{
      if(active)return;active=true;host.clearTimeout(release);
      for(const el of doc.querySelectorAll('details,.exercise-support,.rubric,.solution,.hint,.exercise-hints')){
        const open=el.open,hidden=el.hidden;restore.push(()=>{el.hidden=hidden;if(el.tagName==='DETAILS')el.open=open;});
        el.hidden=false;if(el.tagName==='DETAILS')el.open=true;
      }
      doc.dispatchEvent(new host.Event('study:layout'));
    });
    host.addEventListener('afterprint',()=>{
      restore.reverse().forEach(fn=>fn());restore=[];
      release=host.setTimeout(()=>{active=false;},0);doc.dispatchEvent(new host.Event('study:layout'));
    });
    return api;
  }
  return {openAncestors,resumeHref,jumpResults,isTyping,createPositionWriter,installPrint};
});
