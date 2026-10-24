(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyStoreMerge=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const stamp=x=>x?.updated||x?.t||x?.answered||'';
  function stable(x){
    if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
    if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
    return JSON.stringify(x);
  }
  function newer(a,b,time=stamp){
    if(!a)return b;
    if(!b)return a;
    const x=time(a),y=time(b);
    return x>y?a:y>x?b:stable(a)>=stable(b)?a:b;
  }
  function union(a,b,key){
    const map=new Map();
    for(const x of [...(a||[]),...(b||[])]){
      const k=key(x);
      map.set(k,newer(map.get(k),x));
    }
    return [...map.values()].sort((a,b)=>key(a).localeCompare(key(b)));
  }
  const entries=x=>Array.isArray(x)?x:Object.values(x||{});
  // A comment record needs a string id and a string created; anything else (a request record that reached a
  // browser's comments on 2026-10-18, a null, an array) is dropped so it can neither break sorting nor be synced.
  const comment=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&typeof x.id==='string'&&typeof x.created==='string';
  const labControls=lab=>{if(!lab)return lab;const {notes,...controls}=lab;return controls;};
  function merge(a={},b={}) {
    if(a.course&&b.course&&a.course!==b.course)throw new Error('Cannot merge different courses');
    const latest=newer(a,b)||{},out={
      ...a,...b,...latest,schema_version:1,course:a.course||b.course,updated:[a.updated||'',b.updated||''].sort().at(-1),prefs:newer(a.prefs,b.prefs)||{},progress:{
        ...(a.progress||{}),...(b.progress||{}),...(latest.progress||{}),visited:Object.create(null)
      },items:Object.create(null),comments:Object.create(null)
    };
    for(const key of new Set([...Object.keys(a.progress?.visited||{}),...Object.keys(b.progress?.visited||{})]))out.progress.visited[key]=[a.progress?.visited?.[key]||'',b.progress?.visited?.[key]||''].sort().at(-1);
    for(const id of new Set([...Object.keys(a.items||{}),...Object.keys(b.items||{})])) {
      const x=a.items?.[id]||{},y=b.items?.[id]||{};
      const recent=item=>[item.updated||'',...(item.attempts||[]).map(a=>a.t)].sort().at(-1)||'';
      out.items[id]={
        ...x,...y,...newer(x,y,recent),attempts:union(x.attempts,y.attempts,x=>x.t),feedback:union(x.feedback,y.feedback,x=>`${x.t}|${x.from}|${x.text}`)
      };
      for(const field of ['draft','notes','reset'])if(x[field]||y[field])out.items[id][field]=newer(x[field],y[field]);
      // Notes/drafts cannot replace a schedule. A reset clears older schedules,
      // while a subsequent attempt can schedule the item again.
      const reviewTime=item=>[item.reset?.t||'',...(item.attempts||[]).map(a=>a.t)].sort().at(-1)||'';
      const reviewed=newer(x,y,reviewTime);
      if('review' in reviewed)out.items[id].review=reviewed.review;
      const item=out.items[id];
      if(item.reset&&!item.attempts.some(a=>Date.parse(a.t)>=Date.parse(item.reset.t)))item.review=null;
    }
    for(const field of ['labs','feedbackRequests','answers','commentLifecycle'])if(a[field]||b[field]){
      out[field]=Object.create(null);
      for(const id of new Set([...Object.keys(a[field]||{}),...Object.keys(b[field]||{})])){
        const x=a[field]?.[id],y=b[field]?.[id];
        out[field][id]=field==='labs'?newer(labControls(x),labControls(y)):newer(x,y);
        if(field==='labs'&&(x?.notes||y?.notes))out[field][id]={...out[field][id],notes:newer(x?.notes,y?.notes)};
      }
    }
    for(const c of union(entries(a.comments).filter(comment),entries(b.comments).filter(comment),x=>x.id))out.comments[c.id]=c;
    // A complete server snapshot carries deletions; unioning it would revive removed answers.
    if(a.feedbackSnapshot||b.feedbackSnapshot){
      const chosen=!a.feedbackSnapshot?b:!b.feedbackSnapshot?a:newer(a,b,x=>x.feedbackSnapshot.t);
      out.feedbackSnapshot=chosen.feedbackSnapshot;
      out.answers=chosen.answers||{};out.commentLifecycle=chosen.commentLifecycle||{};
    }
    return clone(out);
  }
  function reconcileFeedback(state,feedback){
    const out=clone(state),{comments={},answers={},lifecycle={}}=feedback;
    // Another tab may already have received a later complete snapshot.
    if(state.feedbackSnapshot&&feedback.receivedAt&&feedback.receivedAt<state.feedbackSnapshot.t)return out;
    out.comments||={};
    for(const [id,c] of Object.entries(comments))if(comment(c)&&c.course===out.course&&c.id===id&&!['__proto__','constructor','prototype'].includes(id)){
      const final=lifecycle[id]&&!['pending','withdrawn'].includes(lifecycle[id].status);
      if(final||!out.comments[id]||c.updated>=out.comments[id].updated)out.comments[id]=clone(c);
    }
    if(state.feedbackSnapshot&&feedback.receivedAt===state.feedbackSnapshot.t)return out;
    out.answers=clone(answers);out.commentLifecycle=clone(lifecycle);
    out.feedbackSnapshot={t:feedback.receivedAt||state.feedbackSnapshot?.t||''};
    return out;
  }
  return {
    merge,union,stable,reconcileFeedback
  };
});
