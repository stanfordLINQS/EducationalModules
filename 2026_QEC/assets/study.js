(function(){
  'use strict';
  const data=JSON.parse(document.getElementById('study-page-data').textContent),store=window.StudyStore,$=(selector,scope=document)=>scope.querySelector(selector),all=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
  const itemIndex=StudyPractice.itemIndex(data),printState=StudyNavigation.installPrint(document,window);
  const text=(el,value)=>{if(el&&el.textContent!==String(value))el.textContent=String(value);};
  const attr=(el,name,value)=>{if(el&&el.getAttribute(name)!==String(value))el.setAttribute(name,String(value));};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }
  [c]));
  let statusTimer,refreshReview=()=>{};
  const practiceRefreshers=new Map(),notesRefreshers=new Map();
  const draftBuffer=store.createDraftBuffer((id,value)=>{
    store.saveDraft(id,value);
    const el=document.getElementById(id),line=el?.querySelector('.save-status');
    if(line&&el.querySelector('.exercise-answer')?.value===value)savedLocally(line);
  });
  const notesBuffer=store.createDraftBuffer((key,value)=>{
    const [collection,id]=key.split(':'),note=collection==='labs'?store.saveLabNotes(id,value):store.saveNotes(id,value);
    for(const [el] of notesRefreshers)if(el.isConnected&&el.dataset.notesKey===key&&$('.reasoning-notes',el)?.value===value){
      savedLocally($('.reasoning-status',el),` · Saved ${new Date(note.t).toLocaleString()}`);
    }
  });
  function flushDrafts(){draftBuffer.flush();notesBuffer.flush();}
  window.addEventListener('pagehide',flushDrafts);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushDrafts();});
  const syncLine=$('#sync-state')||document.createElement('p');
  syncLine.id='sync-state';syncLine.setAttribute('role','status');
  if(!syncLine.isConnected)$('.rail-bottom').append(syncLine);
  let syncSequence=0,lastSync=window.StudyServerSync?.state;
  const pendingSaves=new Map();
  function syncMessage(detail){
    return detail?.message||({connecting:'Connecting…',saving:'Saving…',saved:detail?.where==='browser'?'Saved in this browser':'Saved to repository',offline:'Offline: saved in this browser'}[detail?.status])||'Saved in this browser';
  }
  function feedbackLabel(){
    const label=window.StudyServerSync?.adapter?.capabilities?.graderLabel;
    all('.ask-feedback').forEach(b=>text(b,typeof label==='string'&&label.trim()?`Ask ${label.trim()} for feedback`:'Ask for feedback'));
  }
  text(syncLine,syncMessage(window.StudyServerSync?.state));
  function status(message){
    $('#status').textContent=message;
    clearTimeout(statusTimer);
    statusTimer=setTimeout(()=>$('#status').textContent='',6000);
  }
  document.addEventListener('study:sync',e=>{
    syncSequence++;lastSync=e.detail;text(syncLine,syncMessage(e.detail));status(syncMessage(e.detail));feedbackLabel();setTimeout(feedbackLabel,0);
    for(const [el,pending] of pendingSaves){
      if(!el.isConnected){pendingSaves.delete(el);continue;}
      if(e.detail.status==='saved'&&e.detail.where!=='browser'&&syncSequence>pending.sequence){
        // An older in-flight save may finish after this edit. Wait for this store's
        // queued saves too, and leave the browser label if any of them failed.
        store.flush().then(()=>{
          if(pendingSaves.get(el)!==pending||store.status().syncError||lastSync?.status!=='saved'||lastSync?.where==='browser')return;
          if(el.textContent===pending.local)text(el,pending.repository);pendingSaves.delete(el);
        });
      }
    }
  });
  function savedLocally(el,suffix=''){
    const local=(store.status().persistenceError?'Browser storage could not save this change':'Saved in this browser')+suffix;
    text(el,local);pendingSaves.set(el,{sequence:syncSequence,local,repository:'Saved to repository'+suffix});
  }
  function safe(handler){
    return function(...args){
      try{
        const result=handler.apply(this,args);
        if(result?.catch)result.catch(e=>status(e.message));
      }catch(e){
        status(e.message);
      }
    };
  }
  function preview(text){
    return String(text||'').split(/(\$[^$\n]+\$|\\\([\s\S]*?\\\))/g).map(part=>{
      if(part.startsWith('$')&&part.endsWith('$')||part.startsWith('\\(')&&part.endsWith('\\)')){
        try{
          return katex.renderToString(part[0]==='$'?part.slice(1,-1):part.slice(2,-2),{
            strict:'error',throwOnError:true,trust:false,macros:data.math?.macros||{}
          });
        }catch(e){
          return `<span class="math-preview-error" title="${esc(e.message)}">${esc(part)}</span>`;
        }
      }
      return esc(part);
    }).join('');
  }
  function setTheme(theme,save=true){
    if(!['black','midnight','ivory','sage','plum'].includes(theme))theme='black';
    document.body.dataset.theme=theme;document.documentElement.dataset.theme=theme;
    $('#theme').value=theme;
    if(save)store.set('prefs',{
      ...(store.get('prefs')||{}),theme,t:new Date().toISOString()
    });
    window.dispatchEvent(new CustomEvent('study:theme',{
      detail:theme
    }));
  }
  setTheme(store.get('prefs.theme')||data.themeDefault||'black',false);
  $('#theme').addEventListener('change',e=>setTheme(e.target.value));
  function updateProgress(){
    const items=store.get('items')||{},visited=store.get('progress.visited')||{};
    for(const mod of data.modules||[]){
      const ids=Object.entries(itemIndex).filter(([,v])=>v.module===mod.id).map(([id])=>id);
      const {done,total,state:progress,label:statusLabel}=StudyCapabilityMap.moduleProgress(ids,items,!!visited[mod.id]),label=`${done}/${total} practised`;
      for(const el of all(`[data-progress-module="${mod.id}"]`)){
        attr(el,'data-progress',progress);
        const p=$('.progress-label',el);
        text(p,label);
        const stateLabel=$('.progress-status',el),meter=$('.map-progress',el);
        text(stateLabel,statusLabel);
        if(meter){if(meter.max!==Math.max(total,1))meter.max=Math.max(total,1);if(meter.value!==done)meter.value=done;}
      }
    }
    const count=Object.keys(itemIndex).filter(id=>items[id]?.attempts?.length).length;
    text($('#progress'),`${count} practice items explored`);
    const bar=$('.progress-meter i');
    const width=100*count/Math.max(1,Object.keys(itemIndex).length)+'%';
    if(bar&&bar.style.width!==width)bar.style.width=width;
    const due=StudyScheduler.courseDue(store.dueItems(),itemIndex).length;
    for(const el of all('[data-due-count]'))text(el,due);
    const last=store.get('progress.last'),cont=$('#continue');
    const resume=StudyNavigation.resumeHref(last,data.modules);
    if(cont&&resume){attr(cont,'href',resume);text(cont,'Continue where you left off →');}
    for(const link of all('.rail nav a[data-progress-module]')){
      const mod=link.dataset.progressModule;attr(link,'href',last?.split('#')[0]===mod&&resume?resume:mod+'.html');
    }
    const outline=StudyPractice.outlineProgress(itemIndex,items);
    for(const span of all('[data-outline-status]')){
      const value=outline[span.dataset.outlineStatus]||{state:'none',label:'0/0 practised'};
      text(span,value.label);attr(span.closest('li'),'data-state',value.state);
    }
  }
  let currentSubsection=location.hash.slice(1);
  function markSubsection(id){
    currentSubsection=id;
    for(const li of all('[data-outline-target]')){
      if(li.dataset.outlineTarget===id)attr(li,'aria-current','location');
      else if(li.hasAttribute('aria-current'))li.removeAttribute('aria-current');
    }
  }
  if(data.module&&data.page==='module'){
    store.set(['progress','visited',data.module],new Date().toISOString());
    const position=StudyNavigation.createPositionWriter(value=>store.set('progress.last',value),{initial:store.get('progress.last')});
    position.queue(data.module+(location.hash||''));
    window.addEventListener('hashchange',()=>{position.queue(data.module+location.hash);markSubsection(location.hash.slice(1));});
    window.addEventListener('pagehide',position.flush);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)position.flush();});
    if('IntersectionObserver' in window){
      const observer=new IntersectionObserver(entries=>{
        const first=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];
        if(first){
          markSubsection(first.target.id);position.queue(data.module+'#'+first.target.id);
        }
      },{
        rootMargin:'-10% 0px -70% 0px'
      });
      all('[data-kind="subsection"]').forEach(el=>observer.observe(el));
    }
  }
  document.addEventListener('click',safe(async e=>{
    const reference=e.target.closest('[data-copy-ref]');
    if(reference&&data.release){await copyReference(reference.dataset.copyRef+' · Release: '+data.release.label);status('Copied');}
    const preset=e.target.closest('[data-preset]');
    if(preset){
      const lab=StudyLab.get(preset.dataset.for);
      if(!lab)throw new Error('This lab is not mounted.');
      lab.ctx.state.applyPreset(preset.dataset.preset);
      const target=document.getElementById(preset.dataset.for);
      (target?.querySelector('.lab-plots')||target?.querySelector('.lab-interactive'))?.scrollIntoView({
        block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'
      });
    }
  }));
  function reasoningHTML(item={}){
    return item.notes?`<aside class="saved-reasoning"><p class="eyebrow">Your reasoning · <time datetime="${esc(item.notes.t)}">${esc(new Date(item.notes.t).toLocaleString())}</time></p><div class="notebook-answer">${preview(item.notes.text)}</div></aside>`:'';
  }
  function initReasoning(el,review=false,view){
    if(notesRefreshers.has(el))return;
    const key=el.dataset.notesKey,[collection,id]=key.split(':'),notes=$('.reasoning-notes',el),line=$('.reasoning-status',el);
    if(!notes||!id||!['items','labs'].includes(collection))return;
    let signature=null;
    if(review){view=document.createElement('div');view.className='review-reasoning';el.append(view);}
    function restore(){
      const record=store.get([collection,id])||{},next=JSON.stringify(record.notes);
      if(!notesBuffer.has(key)&&next!==signature){
        signature=next;notes.value=record.notes?.text||'';
        pendingSaves.delete(line);text(line,record.notes?`Saved ${new Date(record.notes.t).toLocaleString()}`:'');
        if(view)view.innerHTML=reasoningHTML(record);
      }
    }
    notes.addEventListener('input',()=>{
      pendingSaves.delete(line);text(line,'Saving reasoning…');notesBuffer.queue(key,notes.value);
    });
    notes.addEventListener('blur',()=>{
      if(data.page==='notebook')setTimeout(()=>{notesBuffer.flush(key);notebook();},0);
    });
    notesRefreshers.set(el,restore);restore();
  }
  function appendReasoningEditor(parent,key,label){
    const el=document.createElement('div'),caption=document.createElement('label'),area=document.createElement('textarea'),line=document.createElement('p'),view=document.createElement('div');
    el.className='reasoning-scratchpad';el.dataset.notesKey=key;caption.className='reasoning-label';caption.textContent=label;
    area.className='reasoning-notes';area.rows=2;line.className='reasoning-status';line.setAttribute('role','status');
    view.className='notebook-reasoning';caption.append(area);el.append(view,caption,line);parent.append(el);initReasoning(el,false,view);
  }
  function initPractice(scope=document,review=false){
    function lessonStatus(el){
      if(review)return ()=>{};
      const line=document.createElement('p');line.className='practice-status';el.querySelector('h3')?.after(line);
      return ()=>text(line,StudyPractice.statusText(store.get(['items',el.id])));
    }
    all('[data-kind="quiz"],[data-kind="predict"]',scope).forEach(el=>{
      if(el.dataset.initialized)return;
      el.dataset.initialized='true';
      const item=data.items[el.id];
      if(!item||el.classList.contains('practice-invalid'))return;
      const kind=el.dataset.kind,type=item.responseType||'choice',submit=$('.submit-answer',el),feedback=$('.answer-feedback',el),retry=$('.retry',el),explanation=$('.explanation',el),reveal=$('.reveal',el),refreshStatus=lessonStatus(el);
      if(explanation)explanation.hidden=true;
      if(reveal)reveal.hidden=true;
      let committed=false,misses=0,restoredAttempt=null,resetStamp=store.get(['items',el.id,'reset','t']);
      const inputs=()=>all('fieldset input,.response',el);
      const keyButton=document.createElement('button');keyButton.type='button';keyButton.className='show-answer';keyButton.textContent='Show the answer';keyButton.hidden=true;feedback.after(keyButton);
      let resetButton;
      if(kind==='predict'){
        resetButton=document.createElement('button');resetButton.type='button';resetButton.className='reset-prediction';resetButton.textContent='Reset this prediction';resetButton.hidden=true;feedback.after(resetButton);
        resetButton.addEventListener('click',safe(()=>{
          if(!committed||!window.confirm('Reset? Your earlier forecast stays in the record.'))return;
          store.resetPrediction(el.id);
        }));
      }
      let currentValue,currentResult;
      let forecastButton,history;
      if(kind==='predict'&&type==='text'){
        forecastButton=document.createElement('button');forecastButton.type='button';forecastButton.className='new-forecast';forecastButton.textContent='Record a new forecast';forecastButton.hidden=true;
        history=document.createElement('details');history.className='forecast-history';history.hidden=true;
        (reveal||feedback).after(forecastButton,history);
        forecastButton.addEventListener('click',()=>{reset();$('.response',el)?.focus();});
      }
      function refreshHistory(){
        if(!history)return;
        const item=store.get(['items',el.id])||{},attempts=item.attempts||[];
        history.innerHTML='<summary>Forecast history</summary>'+attempts.map((a,i)=>`<p class="request-meta">${item.reset&&Date.parse(a.t)<Date.parse(item.reset.t)?'Earlier forecast (reset)':i===0?'Original forecast':'Later forecast'} · ${esc(a.t)}</p><div class="notebook-answer">${preview(a.response)}</div>`).join('');
      }
      function response(){return type==='choice'||type==='multi'?all('fieldset input:checked',el).map(x=>Number(x.value)):$('.response',el).value;}
      function show(value,result,restore=false,force=false){
        currentValue=value;currentResult=result;
        const full=kind==='predict'||StudyPractice.answerVisibility({correct:result.correct,misses,reveal:force});
        feedback.innerHTML=`<p>${result.correct===null?'Prediction saved. Compare your reasoning with the outcome.':result.correct?'Correct.':type==='numeric'?'Not within tolerance.':'Revisit your choice and try again.'}</p>`;
        if(item.choices?.length){
          const selected=(Array.isArray(value)?value:[value]).map(Number);
          const choices=item.choices.filter((c,i)=>full||selected.includes(i));
          feedback.innerHTML+=`<ul>${choices.map(c=>`<li${full&&c.correct?' class="correct"':''}><strong>${c.html||esc(c.text)}</strong>${full&&c.correct?' (correct)':''}${c.whyHTML||c.why?': '+(c.whyHTML||esc(c.why)):''}</li>`).join('')}</ul>`;
        }else if(full&&item.answer!==undefined)feedback.innerHTML+=`<p>Expected: ${esc(item.answer)} ${esc(item.units||'')}${item.tol?` (absolute tolerance ±${esc(item.tol)})`:''}${item.reltol?` (relative tolerance ${esc(item.reltol)})`:''}.</p>`;
        keyButton.hidden=full;
        if(explanation){explanation.hidden=!full;explanation.open=full;}
        if(reveal)reveal.hidden=false;
        if(resetButton)resetButton.hidden=false;
        inputs().forEach(input=>input.disabled=true);submit.disabled=true;
        if(retry)retry.hidden=false;
        committed=true;
        if(restore){
          if(type==='choice'||type==='multi')inputs().forEach(i=>i.checked=(Array.isArray(value)?value:[value]).map(Number).includes(Number(i.value)));
          else $('.response',el).value=value;
        }
        if(forecastButton){forecastButton.hidden=false;history.hidden=false;refreshHistory();}
        refreshStatus();
      }
      keyButton.addEventListener('click',()=>show(currentValue,currentResult,false,true));
      submit.addEventListener('click',safe(()=>{
        if(committed)return;
        const value=response(),result=StudyPractice.grade({...item,type:item.responseType||'text'},value);
        if(!result.valid){text(feedback,result.reason||'Write a prediction first.');return;}
        notesBuffer.flush('items:'+el.id);
        if(result.correct===false)misses++;
        // Set this before notifying subscribers so restoring cannot race this submission.
        committed=true;
        const attempt=store.recordAttempt(el.id,{type:kind,response:value,correct:result.correct});restoredAttempt=attempt.t;
        show(value,result);
        el.dispatchEvent(new CustomEvent('study:attempt',{bubbles:true}));
      }));
      function reset(){
        committed=false;inputs().forEach(i=>{i.disabled=false;if(i.type==='radio'||i.type==='checkbox')i.checked=false;else i.value='';});
        submit.disabled=false;if(retry)retry.hidden=true;
        keyButton.hidden=true;feedback.replaceChildren();
        if(explanation){explanation.hidden=true;explanation.open=false;}
        if(reveal)reveal.hidden=true;
        if(resetButton)resetButton.hidden=true;
        if(forecastButton){forecastButton.hidden=true;history.hidden=true;}
      }
      retry?.addEventListener('click',reset);
      // Restoring a lesson outcome never fills a review prompt or an in-progress retry.
      const restore=()=>{
        refreshStatus();
        const state=store.get(['items',el.id])||{},attempts=StudyPractice.activeAttempts(state),last=attempts.at(-1);
        if(state.reset?.t!==resetStamp){resetStamp=state.reset?.t;restoredAttempt=null;misses=0;reset();}
        if(last&&!review&&last.t!==restoredAttempt&&!inputs().some(i=>i.type==='radio'||i.type==='checkbox'?i.checked:!!i.value)){
          misses=attempts.filter(a=>a.correct===false).length;restoredAttempt=last.t;show(last.response,{correct:last.correct},true);
        }
      };
      practiceRefreshers.set(el,restore);restore();
    });
    all('[data-kind="exercise"],[data-kind="challenge"]',scope).forEach(el=>{
      if(el.dataset.initialized)return;
      el.dataset.initialized='true';
      const textarea=$('.exercise-answer',el),p=$('.math-preview',el),saveStatus=$('.save-status',el),hints=all('.exercise-hints > .hint',el);
      if(!textarea)return;
      const support=$('.exercise-support',el),stuck=$('.show-anyway',el),rating=$('.self-rating',el),refreshStatus=lessonStatus(el);
      const itemState=()=>store.get(['items',el.id])||{};
      let dirty=false,sessionSaved=false,sessionViewed=false,sessionEarly=false,sessionRating=null;
      const previous=itemState().attempts?.at(-1)?.response;
      if(review&&previous!=null){
        const old=document.createElement('details');old.className='previous-answer';old.innerHTML='<summary>Your previous answer</summary><div class="notebook-answer">'+preview(previous)+'</div>';
        textarea.closest('label').before(old);
      }
      textarea.value=review?'':itemState().draft?.text||'';
      if(!review&&itemState().draft)text(saveStatus,'Draft restored');
      p.innerHTML=preview(textarea.value);
      function flow(){return StudyPractice.exerciseSession(itemState(),{review,saved:sessionSaved,viewed:sessionViewed,early:sessionEarly,unsupportedChallenge:el.dataset.kind==='challenge'&&!support});}
      function refreshSupport(){
        const state=flow();if(support)support.hidden=!state.supportAvailable;if(stuck)stuck.hidden=state.supportAvailable;rating.hidden=!state.ratingAvailable;
        const selected=review?sessionRating:StudyPractice.lastRating(itemState());
        all('[data-rating]',el).forEach(b=>attr(b,'aria-pressed',Number(b.dataset.rating)===selected));refreshStatus();
      }
      textarea.addEventListener('input',()=>{
        dirty=true;p.innerHTML=preview(textarea.value);text(saveStatus,'Saving draft…');pendingSaves.delete(saveStatus);draftBuffer.queue(el.id,textarea.value);
      });
      function viewed(kind){
        if(printState.active)return;
        sessionViewed=true;
        const state=review?{attempts:sessionSaved?[{response:textarea.value}]:[]}:itemState();
        const patch=StudyPractice.viewSupport(state,kind,new Date().toISOString(),{savedOnly:true});
        for(const [key,value] of Object.entries(patch))store.set(['items',el.id,key],value);
        refreshSupport();
      }
      for(const kind of ['rubric','solution']){
        const details=$('.'+kind,el);if(review&&details)details.open=false;
        details?.addEventListener('toggle',()=>{if(details.open)viewed(kind);});
      }
      stuck?.addEventListener('click',()=>{
        sessionEarly=true;viewed('solution');all('.exercise-support > details',el).forEach(d=>d.open=true);
      });
      function save(record=true){
        if(!textarea.value.trim()){text(saveStatus,'Write a first thought, or use the stuck link below.');return false;}
        draftBuffer.cancel(el.id);sessionSaved=true;
        // Keep the typed text through synchronous store notifications.
        dirty=true;
        const result=record?store.saveAnswer(el.id,textarea.value):(store.saveDraft(el.id,textarea.value),null);
        dirty=false;savedLocally(saveStatus);refreshSupport();
        if(result?.recorded)el.dispatchEvent(new CustomEvent('study:attempt',{bubbles:true}));
        return true;
      }
      $('.save-answer',el).addEventListener('click',safe(()=>save()));
      let count=review?0:Number(itemState().hintsShown)||0;
      hints.forEach((hint,i)=>{hint.hidden=i>=count;if(review)hint.open=false;});
      const hintButton=$('.next-hint',el);hintButton.hidden=!hints.length;hintButton.disabled=count>=hints.length;
      hintButton.addEventListener('click',()=>{
        const h=hints[count++];if(h){h.hidden=false;h.open=true;store.set(['items',el.id,'hintsShown'],count);}hintButton.disabled=count>=hints.length;
      });
      all('.rubric input[data-rubric-index]',el).forEach(check=>{
        const i=check.dataset.rubricIndex;check.checked=!review&&!!store.get(['items',el.id,'rubric',i]);
        check.addEventListener('change',()=>store.set(['items',el.id,'rubric',i],check.checked));
      });
      all('[data-rating]',el).forEach(button=>button.addEventListener('click',()=>{
        if(!save(false))return;
        sessionRating=Number(button.dataset.rating);
        store.recordAttempt(el.id,{type:el.dataset.kind,response:textarea.value,correct:null,selfRating:sessionRating});
        savedLocally(saveStatus);refreshSupport();
        el.dispatchEvent(new CustomEvent('study:attempt',{bubbles:true}));
      }));
      const feedback=document.createElement('div');feedback.className='exercise-feedback';el.append(feedback);
      let feedbackSignature='';
      const refreshFeedback=()=>{
        // Earlier feedback can contain the solution; keep it behind the review attempt.
        feedback.hidden=review&&!sessionSaved;
        const entries=itemState().feedback||[],signature=JSON.stringify(entries);
        if(signature!==feedbackSignature){feedbackSignature=signature;feedback.innerHTML=entries.map(f=>`<div class="callout"><strong>Feedback from ${esc(f.from)}</strong><p>${preview(f.text)}</p></div>`).join('');}
      };
      practiceRefreshers.set(el,()=>{
        if(!review&&!dirty&&!draftBuffer.has(el.id)){
          const value=itemState().draft?.text||'';if(textarea.value!==value){textarea.value=value;p.innerHTML=preview(value);text(saveStatus,'Draft restored');}
        }
        if(!review){
          count=Number(itemState().hintsShown)||0;hints.forEach((h,i)=>h.hidden=i>=count);hintButton.disabled=count>=hints.length;
          all('.rubric input[data-rubric-index]',el).forEach(input=>input.checked=!!store.get(['items',el.id,'rubric',input.dataset.rubricIndex]));
        }
        refreshSupport();refreshFeedback();
      });
      refreshSupport();refreshFeedback();
      $('.ask-feedback',el)?.addEventListener('click',safe(async()=>{
        if(!save(false))return;
        const button=$('.ask-feedback',el);button.disabled=true;text(saveStatus,'Requesting feedback…');
        try{
          const result=await store.gradeFeedback(el.id,{prompt:data.items[el.id]?.prompt||el.querySelector('h3').textContent,rubric:data.items[el.id]?.rubric||'',solution:data.items[el.id]?.solution||'',answer:textarea.value});
          text(saveStatus,result.path==='grader'?'Feedback received from the configured grader.':result.error?'Grader unavailable; feedback request queued with your answer.':'Feedback request queued for a later agent session.');
          status(saveStatus.textContent);refreshFeedback();
        }finally{button.disabled=false;}
      }));
    });
    all('.reasoning-scratchpad',scope).forEach(el=>initReasoning(el,review));
    feedbackLabel();
  }
  async function copyReference(value){
    try{await navigator.clipboard.writeText(value);return;}catch(_){}
    const active=document.activeElement,box=document.createElement('textarea');
    box.value=value;box.setAttribute('aria-label','Reference to copy');
    box.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';document.body.append(box);
    try{box.focus();box.select();if(!document.execCommand('copy'))throw new Error('Could not copy the reference.');}
    finally{box.remove();active?.focus?.({preventScroll:true});}
  }
  if(data.page==='notebook'){
    $('#backup-progress').addEventListener('click',safe(()=>{
      flushDrafts();
      const backup=store.exportState();
      download(data.course+'-progress-'+backup.exported.slice(0,10)+'.json',JSON.stringify(backup,null,2));
      text($('#backup-status'),'Progress backup downloaded.');
    }));
    $('#restore-progress').addEventListener('change',safe(async e=>{
      const file=e.target.files[0];if(!file)return;
      try{
        const backup=JSON.parse(await file.text());flushDrafts();
        const result=store.restoreState(backup);
        const message=`Restored ${result.attempts} attempts; updated ${result.items} items, ${result.labs} labs and ${result.comments} comments. Newer local work is kept.`;
        text($('#backup-status'),message);status(message);notebook();
      }catch(error){text($('#backup-status'),'Restore failed: '+error.message);throw error;}
      finally{e.target.value='';}
    }));
  }
  function download(name,value,type='application/json'){
    const blob=new Blob([value],{
      type
    }),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;
    a.download=name;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function lifecycleText(c){const life=store.commentStatus(c.id);return life.status+(life.request?' in '+life.request:'')+(life.reason?': '+life.reason:'');}
  function answerHTML(id){const a=store.get(['answers',id]);return a?`<div class="question-answer" data-question-id="${esc(id)}"><p class="eyebrow">Your question · Answer</p><p class="request-meta">${esc(a.by)} · ${esc(a.answered)}</p>${a.html||preview(a.body)}</div>`:'';}
  function inlineAnswers(){
    for(const old of all('.inline-question-answer'))old.remove();
    for(const c of store.comments().filter(c=>c.kind==='question'&&store.get(['answers',c.id]))){
      const target=c.targetKind==='course'?(data.page==='index'?document.querySelector('main .reading'):null):document.getElementById(c.targetId);
      if(!target||!target.matches('[data-kind],.equation,main .reading'))continue;
      const note=document.createElement('aside');note.className='inline-question-answer';note.dataset.questionId=c.id;note.innerHTML=`<p>${preview(c.text)}</p>`+answerHTML(c.id);target.append(note);
    }
  }
  function requests(){
    const list=$('#request-list');
    if(!list)return;
    const comments=store.comments();
    list.innerHTML=comments.length?'':'<p>No requests yet. Use Comment beside any passage.</p>';
    for(const c of comments){
      const card=document.createElement('article');
      card.className='request-card';
      card.dataset.status=store.commentStatus(c.id).status;
      card.innerHTML=`<p class="eyebrow">${c.kind==='change'?'Request a course change':'Question'} · ${esc(lifecycleText(c))}</p><h3>${esc(c.targetTitle)}</h3><p class="request-meta">${esc(c.context)}<br>${esc(c.created)} · ${esc(c.revision)}</p><p class="request-text">${esc(c.text)}</p>${c.module?`<a href="${esc(c.module)}.html#${esc(c.targetId)}">Back to context →</a>`:''}${answerHTML(c.id)}${store.commentStatus(c.id).status==='pending'?'<div class="request-actions"><button class="edit-request">Edit</button><button class="withdraw-request">Withdraw</button></div>':''}`;
      list.append(card);
      $('.withdraw-request',card)?.addEventListener('click',safe(()=>{
        store.withdrawComment(c.id);
        requests();
        status('Request withdrawn; its record is retained.');
      }));
      $('.edit-request',card)?.addEventListener('click',()=>{
        const p=$('.request-text',card),textarea=document.createElement('textarea');
        textarea.value=c.text;
        textarea.setAttribute('aria-label','Edit request');
        p.replaceWith(textarea);
        const actions=$('.request-actions',card);
        actions.innerHTML='<button class="save-request">Save edit</button><button class="cancel-edit">Cancel</button>';
        $('.save-request',actions).addEventListener('click',safe(()=>{
          store.updateComment(c.id,{
            text:textarea.value
          });
          requests();
        }));
        $('.cancel-edit',actions).addEventListener('click',requests);
        textarea.focus();
      });
    }
    $('#request-count').textContent=`${comments.filter(c=>store.commentStatus(c.id).status==='pending').length} pending · ${comments.length} total`;
  }
  if(data.page==='requests'){
    requests();
    $('#export-requests').addEventListener('click',()=>download(data.course+'-requests.json',JSON.stringify({
      schema_version:1,course:data.course,exported:new Date().toISOString(),comments:store.comments(),feedbackRequests:store.get('feedbackRequests')||{}
    },null,2)));
    $('#copy-requests').addEventListener('click',safe(async()=>{
      const text=store.comments().map(c=>`[${c.id}] ${c.kind} · ${lifecycleText(c)}\n${c.context}\nRevision: ${c.revision}\n${c.text}`).join('\n\n');
      try{
        await navigator.clipboard.writeText(text);
        status('Requests copied.');
      }catch(_){
        const box=$('#request-copy');
        box.hidden=false;
        box.value=text;
        box.focus();
        box.select();
        status('Select and copy the text shown below.');
      }
    }));
    $('#import-requests').addEventListener('change',safe(async e=>{
      const file=e.target.files[0];
      if(!file)return;
      const count=store.importComments(JSON.parse(await file.text()));
      requests();
      status(`Imported ${count} requests.`);
      e.target.value='';
    }));
  }
  function notebook(){
    const list=$('#notebook-list');
    if(!list||$('.reasoning-notes:focus',list))return;
    const items=store.get('items')||{};
    const labs=Object.entries(store.get('labs')||{}).filter(([id,lab])=>lab.notes&&(!data.release||data.targets?.[id]));
    // Note content refreshes in place, preserving focus, selections and context links.
    // Only changes to the surrounding record require rebuilding the notebook.
    const visibleItems=Object.entries(items).filter(([,item])=>item.draft||item.notes||item.attempts?.length||item.feedback?.length);
    const signature=JSON.stringify([visibleItems.map(([id,{notes,updated,...item}])=>[id,item]),labs.map(([id])=>id),store.get('comments'),store.get('answers'),store.get('commentLifecycle')]);
    if(signature===notebook.signature)return;
    notebook.signature=signature;
    list.replaceChildren();
    const weak=StudyPractice.weakSpots(items,itemIndex),weakSection=document.createElement('section');
    weakSection.className='weak-spots';weakSection.innerHTML='<h2>Weak spots</h2>'+(weak.length?'<ul>'+weak.map(item=>`<li><a href="${esc(item.module)}.html#${esc(item.id)}">${esc(item.title||item.id)}</a><p>${esc(item.reason)} · ${esc(item.due)}</p></li>`).join('')+'</ul>':'<p>No weak spots recorded yet.</p>');
    list.append(weakSection);
    for(const mod of data.modules){
      const section=document.createElement('section');
      section.innerHTML=`<h2>${esc(mod.title)}</h2>`;
      let n=0;
      for(const [id,item] of Object.entries(items).filter(([id,x])=>(itemIndex[id]?.module||x.module)===mod.id&&(!data.release||itemIndex[id]))){
        if(!item.draft&&!item.notes&&!item.attempts?.length&&!item.feedback?.length)continue;
        n++;
        const node=document.createElement('article');
        node.className='notebook-entry';
        const info=itemIndex[id]||{};
        const renderAttempts=attempts=>attempts.map(a=>`<details><summary>${esc(new Date(a.t).toLocaleString())} · ${a.selfRating!=null?['Again','Hard','Good','Easy'][a.selfRating]:a.correct===true?'Correct':a.correct===false?'Revisit':'Saved'}</summary><div class="notebook-answer">${preview(Array.isArray(a.response)?a.response.map(i=>'Option '+(Number(i)+1)).join('; '):a.response)}</div><small>${esc(a.revision)}</small></details>`).join('');
        const archived=StudyPractice.notebookAttempts(item,{archived:true});
        node.innerHTML=`<h3><a href="${esc(mod.id)}.html#${esc(id)}">${esc(info.title||id)}</a></h3>${item.draft?`<p class="eyebrow">Saved answer</p><div class="notebook-answer">${preview(item.draft.text)}</div>`:''}${renderAttempts(StudyPractice.notebookAttempts(item))}${archived.length?`<details class="archived-forecasts"><summary>Earlier forecasts (reset)</summary>${renderAttempts(archived)}</details>`:''}${(item.feedback||[]).map(f=>`<div class="callout"><strong>Feedback from ${esc(f.from)}</strong><p>${preview(f.text)}</p><time>${esc(f.t)}</time></div>`).join('')}`;
        appendReasoningEditor(node,'items:'+id,['exercise','challenge'].includes(info.type||item.type)?'Scratch work (kept apart from your answer; never sent for feedback)':'Your reasoning');
        section.append(node);
      }
      for(const q of store.comments().filter(q=>q.kind==='question'&&q.module===mod.id)){
        n++;
        const node=document.createElement('article');
        node.className='notebook-entry';
        node.innerHTML=`<p class="eyebrow">Question · ${esc(lifecycleText(q))}</p><h3>${esc(q.targetTitle)}</h3><p class="notebook-answer">${preview(q.text)}</p>${answerHTML(q.id)}`;
        section.append(node);
      }
      if(n)list.append(section);
    }
    if(labs.length){
      const section=document.createElement('section');section.className='lab-notes-list';section.innerHTML='<h2>Lab notes</h2>';
      for(const [id,lab] of labs){
        const info=data.targets?.[id]||{},node=document.createElement('article');node.className='notebook-entry lab-note';
        node.innerHTML=`<h3>${info.module?`<a href="${esc(info.module)}.html#${esc(id)}">${esc(info.title||id)}</a>`:esc(info.title||id)}</h3>`;
        appendReasoningEditor(node,'labs:'+id,'Your notes on this experiment');section.append(node);
      }
      list.append(section);
    }
    for(const q of store.comments().filter(q=>q.kind==='question'&&!q.module)){const node=document.createElement('article');node.className='notebook-entry';node.innerHTML=`<h2>Course question</h2><p>${preview(q.text)}</p>${answerHTML(q.id)}`;list.append(node);}
    if(list.children.length===1)list.insertAdjacentHTML('beforeend','<p>Your saved answers, ratings, questions, and received feedback will appear here.</p>');
  }
  if(data.page==='notebook')notebook();
  if(data.page==='review'){
    const shown=Object.create(null),stage=$('#review-stage');
    let queue=[],current=null,done=0,completedCurrent=false,transitioning=false;
    const recompute=()=>queue=StudyScheduler.reviewQueue(store.dueItems(),itemIndex,shown);
    function finish(){
      const upcoming=StudyScheduler.nextDue(store.get('items')||{},itemIndex),resume=StudyNavigation.resumeHref(store.get('progress.last'),data.modules);
      const skipped=StudyScheduler.courseDue(store.dueItems(),itemIndex).length;
      const message=`<p>${done} ${done===1?'item':'items'} done this session.${skipped?' Some items remain due for a later session.':' You are up to date for this session.'}</p><p>${upcoming?'Next review '+esc(StudyPractice.dueText(upcoming.due)):'No future reviews scheduled.'}</p><p>${resume?`<a href="${esc(resume)}">Continue where you left off →</a> · `:''}<a href="index.html">Course map →</a></p>`;
      if(stage.innerHTML!==message)stage.innerHTML=message;
      text($('#review-position'),`${done} done`);$('#review-next').hidden=true;
    }
    function next(){
      transitioning=true;
      try{
        flushDrafts();recompute();current=queue.shift()||null;completedCurrent=false;
        if(!current){finish();return;}
        const id=current.itemId,item=data.items[id],again=!!shown[id];shown[id]={due:current.due};
        const last=StudyPractice.activeAttempts(store.get(['items',id])).at(-1);
        const reason=again?`<p class="review-again">Due again: ${last?.correct===false?'answered wrong':last?.selfRating===0?'rated Again':'last answered'} ${esc(StudyPractice.dateText(last?.t).replace('10 min ago','10 minutes ago'))}</p>`:'';
        stage.innerHTML=`<p class="review-context"><a href="${esc(item.module)}.html#${esc(id)}">${esc(data.modules.find(m=>m.id===item.module)?.title)} → ${esc(item.title)}</a></p>`+reason+item.html;
        initPractice(stage,true);text($('#review-position'),`${done} done · ${queue.length+1} due`);
        $('#review-next').hidden=false;text($('#review-next'),'Skip for now');
      }finally{transitioning=false;}
    }
    refreshReview=()=>{
      if(transitioning)return;
      recompute();
      // Do not replace the current prompt while the learner is writing or reading feedback.
      if(!current){if(queue.length)next();else finish();}
      else text($('#review-position'),`${done} done · ${queue.filter(x=>x.itemId!==current.itemId).length} remaining`);
    };
    stage.addEventListener('study:attempt',()=>{
      if(!completedCurrent){done++;completedCurrent=true;}
      recompute();text($('#review-next'),'Next item →');refreshReview();
    });
    $('#review-next').addEventListener('click',()=>{current=null;next();});
    next();
  }
  initPractice();
  all('.model-card-toggle').forEach(button=>{
    const lab=button.closest('[data-kind="lab"]'),body=document.getElementById(button.getAttribute('aria-controls'));
    const apply=collapsed=>{if(body.hidden!==collapsed)body.hidden=collapsed;text(button,collapsed?'Expand model card':'Collapse model card');attr(button,'aria-expanded',!collapsed);};
    const restore=()=>apply(!!store.get(['labs',lab.id,'cardCollapsed']));
    restore();
    practiceRefreshers.set(lab,restore);
    button.addEventListener('click',()=>{
      const collapsed=!body.hidden;
      store.set(['labs',lab.id],{...(store.get(['labs',lab.id])||{}),cardCollapsed:collapsed,t:new Date().toISOString()});
      apply(collapsed);
      document.dispatchEvent(new Event('study:layout'));
    });
  });
  all('[data-kind="media"]').forEach(el=>{
    const player=$('video,audio',el),speed=$('.media-speed',el);
    speed?.addEventListener('change',()=>player.playbackRate=Number(speed.value));
    all('track[data-vtt]',el).forEach(track=>{const url=URL.createObjectURL(new Blob([track.dataset.vtt],{type:'text/vtt'}));track.src=url;track.addEventListener('load',()=>track.track.mode='showing',{once:true});window.addEventListener('pagehide',()=>URL.revokeObjectURL(url),{once:true});});
  });
  StudyLab.mountAll();
  all('[data-kind="lab"][data-predict-id]').filter(lab=>lab.dataset.predictId).forEach(lab=>{
    const interactive=$('.lab-interactive',lab),mount=$('.lab-mount',lab),overlay=$('.lab-gate',lab);
    const refresh=()=>{
      const open=StudyPractice.labUnlocked(lab.dataset.predictId,store.get('items'),store.get(['labs',lab.id])||{});
      lab.dataset.gated=String(!open);interactive.classList.toggle('is-gated',!open);overlay.hidden=open;
      mount.inert=!open;mount.setAttribute('aria-hidden',String(!open));
      all('.lab-controls',lab).forEach(controls=>controls.disabled=!open);
      all('[data-preset]').filter(b=>b.dataset.for===lab.id).forEach(b=>b.disabled=!open);
    };
    // Keep card restoration and gate restoration together for remote merges.
    const restoreCard=practiceRefreshers.get(lab);
    practiceRefreshers.set(lab,()=>{restoreCard?.();refresh();});
    $('.skip-prediction',lab).addEventListener('click',()=>{
      const t=new Date().toISOString();
      store.set(['labs',lab.id],{...(store.get(['labs',lab.id])||{}),predictionSkip:{predictId:lab.dataset.predictId,t},t});
      refresh();document.dispatchEvent(new Event('study:layout'));
    });
    refresh();
  });
  window.StudyEquationLayout=StudyEquations.install(document);
  // Inline SVG figures scroll inside their wrapper on narrow screens; make that region focusable and announced.
  (function installFigureScrollers(){
    const wraps=[...document.querySelectorAll('.figure-scroll')];if(!wraps.length)return;
    const edge=w=>{w.dataset.scrollEnd=String(w.scrollLeft+w.clientWidth>=w.scrollWidth-2);};
    const fit=w=>{
      if(!w.getClientRects().length)return;
      const overflow=w.scrollWidth>w.clientWidth+2,cue=w.nextElementSibling;
      if(cue&&cue.classList.contains('figure-scroll-cue'))cue.hidden=!overflow;
      if(overflow){w.tabIndex=0;w.setAttribute('role','region');w.setAttribute('aria-label',`Figure: ${w.dataset.label||''}. Use left and right arrow keys to scroll.`);}
      else{w.removeAttribute('tabindex');w.removeAttribute('role');w.removeAttribute('aria-label');}
      edge(w);
    };
    for(const w of wraps){
      w.addEventListener('scroll',()=>edge(w),{passive:true});
      w.addEventListener('keydown',e=>{const moves={ArrowLeft:-80,ArrowRight:80,Home:-w.scrollWidth,End:w.scrollWidth};if(w.tabIndex===0&&e.key in moves){e.preventDefault();w.scrollLeft+=moves[e.key];}});
    }
    const all=()=>wraps.forEach(fit);
    if(window.ResizeObserver){const ro=new ResizeObserver(all);wraps.forEach(w=>ro.observe(w));}
    window.addEventListener('resize',all);document.addEventListener('toggle',all,true);document.addEventListener('study:layout',all);
    all();
  })();
  async function followHash(){
    let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
    const target=document.getElementById(id);if(!target)return;
    StudyNavigation.openAncestors(target,{onModel(body){
      const lab=body.closest('[data-kind="lab"]');if(!lab)return;
      const button=lab.querySelector('.model-card-toggle');button.setAttribute('aria-expanded','true');button.textContent='Collapse model card';
      store.set(['labs',lab.id],{...(store.get(['labs',lab.id])||{}),cardCollapsed:false,t:new Date().toISOString()});
    },onHint(hint){const exercise=hint.closest('[data-kind="exercise"],[data-kind="challenge"]');if(exercise){const count=all('.exercise-hints > .hint',exercise).indexOf(hint)+1;store.set(['items',exercise.id,'hintsShown'],Math.max(count,store.get(['items',exercise.id,'hintsShown'])||0));}}});
    document.dispatchEvent(new Event('study:layout'));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(r));target.scrollIntoView({block:'start',behavior:'instant'});
  }
  window.addEventListener('hashchange',safe(followHash));
  document.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a){const url=new URL(a.href,location.href);if(url.pathname===location.pathname&&url.hash===location.hash)followHash();}});
  followHash();inlineAnswers();
  markSubsection(currentSubsection);
  const symbolFilter=$('#symbol-filter');
  symbolFilter?.addEventListener('input',()=>{
    const query=symbolFilter.value.toLowerCase().replace(/\s+/g,' ').trim();
    for(const row of all('[data-symbol-row]'))row.hidden=!(row.dataset.symbolText||'').replace(/\s+/g,' ').includes(query);
  });
  (function installShortcuts(){
    const jump=document.createElement('button');jump.type='button';jump.id='jump-to';jump.textContent='Jump to…';$('.rail-secondary').append(jump);
    const palette=document.createElement('dialog');palette.id='jump-dialog';palette.setAttribute('aria-labelledby','jump-title');
    palette.innerHTML='<h2 id="jump-title">Jump to…</h2><label>Find a passage, equation, or practice item<input id="jump-search" type="search" autocomplete="off"></label><div id="jump-results"></div><form method="dialog"><button>Close</button></form>';
    const help=document.createElement('dialog');help.id='shortcuts-dialog';help.setAttribute('aria-labelledby','shortcuts-title');
    help.innerHTML='<h2 id="shortcuts-title">Keyboard shortcuts</h2><dl><dt>/</dt><dd>Search and jump to course content. Enter opens the first result; Tab moves through links.</dd><dt>j / k</dt><dd>Next / previous subsection in this lesson.</dd><dt>n</dt><dd>Next review item (or skip the current one).</dd><dt>?</dt><dd>Show these shortcuts.</dd><dt>Escape</dt><dd>Close a dialog.</dd></dl><p>Shortcuts pause while you type in an input, text area, or editable content.</p><form method="dialog"><button>Close</button></form>';
    document.body.append(palette,help);
    const input=$('#jump-search',palette),results=$('#jump-results',palette);
    function search(){
      const groups=StudyNavigation.jumpResults(data.targets,itemIndex,data.modules,input.value);
      results.innerHTML=groups.length?groups.map(group=>`<section><h3>${esc(group.title)}</h3><ul>${group.results.map(r=>`<li><a href="${esc(r.href)}">${esc(r.title)} <small>${esc(r.id)}</small></a></li>`).join('')}</ul></section>`).join(''):'<p>No matching targets.</p>';
    }
    function open(){search();palette.showModal();input.focus();input.select();}
    jump.addEventListener('click',open);input.addEventListener('input',search);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('a',results)?.click();}else if(e.key==='Escape'){e.preventDefault();palette.close();}});
    results.addEventListener('click',e=>{
      const link=e.target.closest('a');if(!link)return;
      palette.close();const url=new URL(link.href,location.href);
      if(url.pathname===location.pathname){e.preventDefault();if(location.hash===url.hash)followHash();else location.hash=url.hash;}
    });
    document.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||StudyNavigation.isTyping(e.target)||$('dialog[open]'))return;
      if(e.key==='/'){e.preventDefault();open();}
      else if(e.key==='?'){e.preventDefault();help.showModal();}
      else if(e.key==='n'&&data.page==='review'&&!$('#review-next').hidden){e.preventDefault();$('#review-next').click();}
      else if((e.key==='j'||e.key==='k')&&data.page==='module'){
        const sections=all('[data-kind="subsection"]'),index=sections.findIndex(s=>s.id===currentSubsection);
        const next=sections[index<0?0:Math.max(0,Math.min(sections.length-1,index+(e.key==='j'?1:-1)))];
        if(next){e.preventDefault();location.hash=next.id;}
      }
    });
  })();
  StudyCapabilityMap.install(document);
  updateProgress();
  const signatures=new Map();
  function changed(key,value){const signature=JSON.stringify(value);if(signatures.get(key)===signature)return false;signatures.set(key,signature);return true;}
  changed('inline',[store.get('comments'),store.get('answers'),store.get('commentLifecycle')]);
  store.subscribe((state,meta)=>{
    updateProgress();
    if(state.prefs?.theme&&state.prefs.theme!==document.body.dataset.theme)setTheme(state.prefs.theme,false);
    const feedback=[state.comments,state.answers,state.commentLifecycle];
    if(changed('inline',feedback))inlineAnswers();
    if(data.page==='notebook'&&changed('notebook',[state.items,state.labs,feedback]))notebook();
    if(data.page==='requests'&&!$('#request-list textarea')&&changed('requests',feedback))requests();
    refreshReview();
    for(const [element,refresh] of practiceRefreshers){
      if(element.isConnected){
        const value=element.dataset.kind==='lab'?[state.labs?.[element.id],state.items?.[element.dataset.predictId]?.attempts]:state.items?.[element.id];
        if(changed(element,value))refresh();
      }else{practiceRefreshers.delete(element);signatures.delete(element);}
    }
    for(const [el,refresh] of notesRefreshers){
      if(el.isConnected)refresh();else notesRefreshers.delete(el);
    }
    if(meta.persistenceError)status('Browser storage could not save this change: '+meta.persistenceError);
    if(meta.syncError)status('Saved locally; remote sync needs attention: '+meta.syncError);
  });
  // Clock-driven due counts and same-session relearning also update without a store write.
  setInterval(()=>{
    if(document.hidden)return;
    updateProgress();refreshReview();feedbackLabel();
    for(const line of all('.practice-status'))text(line,StudyPractice.statusText(store.get(['items',line.closest('[data-kind]').id])));
  },30000);
})();
