(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./store-merge.js'):root.StudyStoreMerge,typeof module==='object'&&module.exports?require('./scheduler.js'):root.StudyScheduler);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else {
    let page={};
    try{
      page=JSON.parse(document.getElementById('study-page-data').textContent);
    }catch(_){}
    let storage;
    try{
      storage=root.localStorage;
    }catch(_){}
    root.StudyStore=api.createStore({
      course:typeof page.course==='string'?page.course:page.course?.id,page,storage
    });
    root.StudyStore.createDraftBuffer=api.createDraftBuffer;
    root.addEventListener('storage',e=>{
      if(e.key===root.StudyStore.key&&e.newValue)try{
        root.StudyStore.merge(JSON.parse(e.newValue));
      }catch(_){}
    });
  }
})(typeof self!=='undefined'?self:this,function(Merge,Scheduler){
  'use strict';
  const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
  function createStore({
    course='course',page={},storage,now=()=>new Date().toISOString(),random=()=>Math.random().toString(16).slice(2,10)
  }={}) {
    const key=(page.release?'study-release:':'study:')+course;
    let state={
      schema_version:1,course,updated:now(),prefs:{
        theme:page.themeDefault||'black',t:''
      },progress:{
        last:null,visited:{}
      },items:{},comments:{}
    };
    let remote=null,queue=Promise.resolve(),syncError=null,persistenceError=null,lastTime='',listeners=new Set(),liveFeedback=null;
    const reconcile=()=>{if(liveFeedback)state=Merge.reconcileFeedback(state,liveFeedback);};
    try {
      const raw=storage?.getItem(key);
      if(raw){
        const loaded=JSON.parse(raw);
        if(loaded.course===course)state=Merge.merge({
          ...state,updated:'',prefs:{
            ...state.prefs,t:''
          }
        },loaded);
      }
    }catch(e){
      persistenceError=e.message;
    }
    const pathKeys=p=>Array.isArray(p)?p:String(p||'').split('.').filter(Boolean);
    function valid(p){
      const keys=pathKeys(p);
      if(keys.some(k=>['__proto__','constructor','prototype'].includes(k)))throw new Error('Unsafe store path');
      return keys;
    }
    const get=p=>{
      let x=state;
      for(const k of valid(p))x=x?.[k];
      return clone(x);
    };
    function notify(){
      for(const cb of listeners)cb(clone(state),{
        syncError,persistenceError
      });
    }
    function persist(){
      try{
        storage?.setItem(key,JSON.stringify(state));
        persistenceError=null;
      }catch(e){
        persistenceError=e.message;
      }
      notify();
    }
    function enqueue(fn){
      queue=queue.then(fn).then(()=>{
        syncError=null;
      },e=>{
        syncError=e.message;
        notify();
      });
      return queue;
    }
    function save(){
      state.updated=now();
      persist();
      if(remote)enqueue(()=>remote.save(clone(state)));
    }
    function set(p,value){
      const keys=valid(p);
      if(!keys.length)throw new Error('Set a named path');
      let x=state;
      for(const k of keys.slice(0,-1))x=x[k]??=( {} );
      x[keys.at(-1)]=clone(value);
      if(keys[0]==='items'&&keys.length>2&&state.items[keys[1]])state.items[keys[1]].updated=now();
      save();
      return clone(value);
    }
    function timestamp(after=''){
      if(after>lastTime)lastTime=after;
      const t=now();
      lastTime=t>lastTime?t:new Date(Date.parse(lastTime)+1).toISOString();
      return lastTime;
    }
    function commentStatus(id){
      if(state.answers?.[id])return {status:'answered',request:state.answers[id].request||state.commentLifecycle?.[id]?.request};
      const lifecycle=state.commentLifecycle?.[id];
      return lifecycle&&lifecycle.status!=='pending'?lifecycle:{status:state.comments[id]?.status||'pending'};
    }
    function applyFeedback({comments={},answers={},lifecycle={},receivedAt}={}, {authoritative=false}={}){
      if(authoritative){
        if(!receivedAt){
          const current=timestamp(),previous=state.feedbackSnapshot?.t||'';
          receivedAt=current>previous?current:new Date(Date.parse(previous)+1).toISOString();
        }
        if(!liveFeedback||receivedAt>=liveFeedback.receivedAt)liveFeedback={comments:clone(comments),answers:clone(answers),lifecycle:clone(lifecycle),receivedAt};
        reconcile();persist();return;
      }
      const before=JSON.stringify([state.comments,state.answers,state.commentLifecycle]);
      // Repository inbox/archive records are authoritative; local-only comments remain available.
      for(const [id,c] of Object.entries(comments))if(c?.course===course&&c.id===id&&!['__proto__','constructor','prototype'].includes(id)){
        // Do not overwrite an offline edit with an older inbox snapshot. Archived bytes are final.
        const final=lifecycle[id]&&!['pending','withdrawn'].includes(lifecycle[id].status);
        if(final||!state.comments[id]||c.updated>=state.comments[id].updated)state.comments[id]=clone(c);
      }
      state.answers={...(state.answers||{}),...clone(answers)};
      state.commentLifecycle={...(state.commentLifecycle||{}),...clone(lifecycle)};
      if(before!==JSON.stringify([state.comments,state.answers,state.commentLifecycle]))persist();
    }
    // A previously synchronized cache outranks an older build, even before reconnecting.
    applyFeedback({comments:page.comments,...(!state.feedbackSnapshot?{answers:page.answers,lifecycle:page.commentLifecycle}:{})});
    function recordAttempt(itemId,attempt){
      const info={...page.items?.[itemId],...page.itemIndex?.[itemId]},item=state.items[itemId]||{
        type:attempt.type||info.type,module:info.module,attempts:[],feedback:[]
      };
      const a={
        t:timestamp([item.reset?.t||'',...(item.attempts||[]).map(a=>a.t)].sort().at(-1)),response:attempt.response??'',correct:attempt.correct??null,selfRating:attempt.selfRating??null,revision:info.revision||page.revision||null
      };
      // Drafts, hints, or a rubric may create the item before its first attempt.
      item.type ||= attempt.type||info.type;
      item.module ||= info.module;
      item.attempts ||= [];
      item.feedback ||= [];
      item.attempts.push(a);
      item.review=Scheduler.schedule(item.review,{
        ...a,type:item.type
      });
      item.updated=a.t;
      state.items[itemId]=item;
      save();
      return clone(a);
    }
    function saveText(itemId,text,field){
      const info=page.itemIndex?.[itemId]||page.items?.[itemId]||{},item=state.items[itemId]||{};
      item.type ||= info.type;item.module ||= info.module;
      item[field]={text:String(text),t:timestamp(item[field]?.t)};item.updated=item[field].t;
      state.items[itemId]=item;save();return clone(item[field]);
    }
    function saveDraft(itemId,text){return saveText(itemId,text,'draft');}
    function saveNotes(itemId,text){return saveText(itemId,text,'notes');}
    function saveLabNotes(labId,text){
      valid(['labs',labId]);
      const lab=state.labs?.[labId]||{};
      lab.notes={text:String(text),t:timestamp(lab.notes?.t)};
      // The lab's own timestamp belongs to its controls, not to scratch work.
      state.labs||={};state.labs[labId]=lab;save();return clone(lab.notes);
    }
    function resetPrediction(itemId){
      const item=state.items[itemId];
      if(item?.type!=='predict'||!item.attempts?.length)return null;
      item.reset={t:timestamp([item.reset?.t||'',...item.attempts.map(a=>a.t)].sort().at(-1))};
      item.review=null;item.updated=item.reset.t;save();return clone(item.reset);
    }
    function saveAnswer(itemId,text){
      const last=state.items[itemId]?.attempts?.at(-1);
      saveDraft(itemId,text);
      if(last&&last.response===String(text))return {recorded:false,attempt:clone(last)};
      return {recorded:true,attempt:recordAttempt(itemId,{response:String(text),correct:null})};
    }
    function addComment(input){
      if(!['change','question'].includes(input.kind)||!String(input.text||'').trim())throw new Error('Comment requires kind and text');
      const t=timestamp(),target=page.targets?.[input.targetId]||page.itemIndex?.[input.targetId]||page.items?.[input.targetId]||{};
      const c={
        schema_version:1,id:'c-'+t.replace(/[-:.]/g,'')+'-'+random(),kind:input.kind,course,module:input.module||target.module||page.module||null,targetId:input.targetId,targetKind:input.targetKind||target.type||'module',targetTitle:input.targetTitle||target.title||input.targetId,context:input.context||[page.courseTitle,target.title||input.targetId].filter(Boolean).join(' → '),revision:input.revision||target.revision||page.revision||null,created:t,updated:t,text:String(input.text).trim(),status:'pending',videoTime:input.videoTime??null
      };
      state.comments[c.id]=c;
      persist();
      if(remote?.postComment)enqueue(()=>remote.postComment(clone(c)));
      save();
      return clone(c);
    }
    function updateComment(id,patch){
      const c=state.comments[id];
      if(!c||commentStatus(id).status!=='pending')throw new Error('Only pending comments can be edited');
      if(patch.text!==undefined){
        if(!String(patch.text).trim())throw new Error('Comment text cannot be empty');
        c.text=String(patch.text);
      }
      c.updated=timestamp();
      if(remote?.updateComment)enqueue(()=>remote.updateComment(id,{
        text:c.text
      }));
      save();
      return clone(c);
    }
    function withdrawComment(id){
      const c=state.comments[id];
      if(!c||commentStatus(id).status!=='pending')throw new Error('Only pending comments can be withdrawn');
      c.status='withdrawn';
      c.updated=timestamp();
      if(remote?.withdrawComment)enqueue(()=>remote.withdrawComment(id));
      save();
      return clone(c);
    }
    async function registerRemote(adapter){
      if(!adapter||typeof adapter.load!=='function'||typeof adapter.save!=='function')throw new TypeError('Remote adapter requires load() and save(state)');
      return enqueue(async()=>{
        const loaded=await adapter.load();
        state=Merge.merge(state,loaded||{});
        reconcile();persist();
        remote=adapter;
        await remote.save(clone(state));
        if(remote.postComment)for(const c of Object.values(state.comments))if(c.status==='pending')await remote.postComment(clone(c));
      });
    }
    function importComments(data){
      const list=Array.isArray(data)?data:Array.isArray(data?.comments)?data.comments:Object.values(data?.comments||{});
      for(const c of list)if(!/^[A-Za-z0-9_-]{1,200}$/.test(c.id||'')||['__proto__','constructor','prototype'].includes(c.id)||c.course!==course||!['change','question'].includes(c.kind)||!['pending','withdrawn'].includes(c.status)||typeof c.text!=='string'||!Number.isFinite(Date.parse(c.updated)))throw new Error('Import contains an invalid comment or a different course');
      const feedbackRequests=data?.feedbackRequests||{};
      for(const [id,r] of Object.entries(feedbackRequests))if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||r?.id!==id||r.course!==course||typeof r.itemId!=='string'||!r.itemId)throw new Error('Import contains an invalid feedback request or a different course');
      state=Merge.merge(state,{
        course,comments:list
      });
      state.feedbackRequests={...(state.feedbackRequests||{}),...clone(feedbackRequests)};
      reconcile();save();
      if(remote?.postComment)for(const c of list)if(c.status==='pending')enqueue(()=>remote.postComment(clone(c)));
      return list.length;
    }
    function exportState(){return {schema_version:1,course,exported:now(),state:clone(state)};}
    function restoreState(backup){
      const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
      const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
      const invalid=()=>{throw new Error('Invalid progress backup schema');};
      if(!object(backup)||backup.schema_version!==1||!object(backup.state)||backup.state.schema_version!==1)invalid();
      if(backup.course!==course||backup.state.course!==course)throw new Error('Progress backup belongs to a different course');
      if(!date(backup.exported))invalid();
      const incoming=backup.state;
      function inspect(value){
        if(!value||typeof value!=='object')return;
        for(const [key,child] of Object.entries(value)){
          if(['__proto__','prototype','constructor'].includes(key))invalid();
          inspect(child);
        }
      }
      inspect(incoming);
      for(const key of ['prefs','progress','items','comments'])if(!object(incoming[key]))invalid();
      if(!object(incoming.progress.visited))invalid();
      for(const key of ['labs','feedbackRequests','answers','commentLifecycle'])if(incoming[key]!==undefined&&!object(incoming[key]))invalid();
      for(const item of Object.values(incoming.items)){
        if(!object(item))invalid();
        for(const key of ['attempts','feedback'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].some(v=>!object(v)||!date(v.t))))invalid();
        for(const key of ['draft','notes'])if(item[key]!==undefined&&(!object(item[key])||typeof item[key].text!=='string'||!date(item[key].t)))invalid();
        if(item.reset!==undefined&&(!object(item.reset)||!date(item.reset.t)))invalid();
      }
      for(const lab of Object.values(incoming.labs||{}))if(!object(lab)||lab.notes&&(!object(lab.notes)||typeof lab.notes.text!=='string'||!date(lab.notes.t)))invalid();
      for(const [id,c] of Object.entries(incoming.comments)){
        if(!object(c)||c.id!==id||c.course!==course)invalid();
        // Repository conversation records are immutable snapshots dated by created, not edits.
        // Keep them in complete backups; learner-authored comments still require updated.
        // Their text is one string or a list of paragraphs (optical communications records use lists).
        if(c.kind==='conversation'){
          const text=typeof c.text==='string'||Array.isArray(c.text)&&c.text.every(p=>typeof p==='string');
          if(c.schema_version!==1||!text||!date(c.created)||(c.updated!==undefined&&!date(c.updated)))invalid();
        }else if(!date(c.updated))invalid();
      }
      const before=state,next=Merge.merge(state,incoming);
      const changed=key=>Object.keys(next[key]||{}).filter(id=>Merge.stable(before[key]?.[id])!==Merge.stable(next[key][id])).length;
      const counts={items:changed('items'),labs:changed('labs'),comments:changed('comments'),
        attempts:Object.entries(next.items).reduce((n,[id,item])=>n+(item.attempts?.length||0)-(before.items[id]?.attempts?.length||0),0)};
      state=next;reconcile();save();return counts;
    }
    const api={
      key,get,set,exportState,restoreState,commentStatus,applyFeedback,update:(p,fn)=>set(p,fn(get(p))),subscribe:fn=>{
        listeners.add(fn);
        return()=>listeners.delete(fn);
      },recordAttempt,saveDraft,saveNotes,saveLabNotes,resetPrediction,saveAnswer,dueItems:t=>Scheduler.dueItems(state,t),addComment,updateComment,withdrawComment,comments:()=>Object.values(clone(state.comments)).sort((a,b)=>a.created.localeCompare(b.created)),registerRemote,importComments,merge:other=>{
        state=Merge.merge(state,other);
        reconcile();persist();
        return clone(state);
      },flush:()=>queue,status:()=>({
        syncError,persistenceError
      }),async gradeFeedback(itemId,record){
        if(!remote?.capabilities?.grader||typeof remote.grade!=='function')return {path:'queued',request:api.requestFeedback(itemId)};
        try{
          // Grading must follow the saves already queued by the exercise's Save step.
          let reply,failure;
          await enqueue(async()=>{try{reply=await remote.grade({itemId,...record});}catch(error){failure=error;throw error;}});
          if(failure)throw failure;
          const entry={text:reply.feedback,from:reply.from||'grader',t:reply.t};
          const feedback=get(['items',itemId,'feedback'])||[];
          if(!feedback.some(f=>f.t===entry.t&&f.from===entry.from&&f.text===entry.text))set(['items',itemId,'feedback'],[...feedback,entry]);
          return {path:'grader',reply};
        }catch(error){return {path:'queued',request:api.requestFeedback(itemId),error:error.message};}
      },requestFeedback:itemId=>{
        const item=get(['items',itemId]);
        // Scratch work stays in learner state, outside both grading and queued feedback.
        if(item)delete item.notes;
        const t=timestamp(),request={
          id:'f-'+t.replace(/[-:.]/g,'')+'-'+random(),course,itemId,t,item
        };
        set(['feedbackRequests',request.id],request);
        addComment({
          kind:'question',targetId:itemId,text:'Please give feedback on my answer:\n\n'+(item?.draft?.text||item?.attempts?.at(-1)?.response||'')
        });
        if(remote?.postFeedbackRequest)enqueue(()=>remote.postFeedbackRequest(clone(request)));
        return request;
      }
    };
    return api;
  }
  // The buffer only persists drafts. Flushing must never manufacture an attempt.
  function createDraftBuffer(write,{delay=800,setTimer=setTimeout,clearTimer=clearTimeout}={}){
    const pending=new Map();
    function flush(id){
      for(const [key,entry] of [...pending])if(id===undefined||id===key){clearTimer(entry.timer);pending.delete(key);write(key,entry.text);}
    }
    function cancel(id){const entry=pending.get(id);if(entry){clearTimer(entry.timer);pending.delete(id);}}
    function queue(id,text){cancel(id);pending.set(id,{text,timer:setTimer(()=>flush(id),delay)});}
    return {queue,flush,cancel,has:id=>pending.has(id)};
  }
  return {createStore,createDraftBuffer};
});
