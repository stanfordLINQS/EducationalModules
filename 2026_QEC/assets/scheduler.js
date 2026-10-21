(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyScheduler=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const DAY=86400000;
  function schedule(previous,attempt,now=attempt.t||new Date().toISOString()) {
    if(attempt.type==='predict'&&attempt.correct!==false)return null;
    if(attempt.correct==null&&attempt.selfRating==null)return previous||null;
    const rating=attempt.selfRating==null?(attempt.correct?2:0):Number(attempt.selfRating);
    if(!Number.isInteger(rating)||rating<0||rating>3)throw new RangeError('Rating must be 0..3');
    const old=previous||{
      intervalDays:0,ease:2.5,reps:0,lapses:0
    };
    let ease=old.ease||2.5,reps=old.reps||0,lapses=old.lapses||0,intervalDays;
    if(rating===0||attempt.correct===false){
      intervalDays=10/1440;
      reps=0;
      lapses++;
      ease=Math.max(1.3,ease-0.2);
    }
    else {
      if(rating===1){
        intervalDays=Math.max(1,(old.intervalDays||1)*1.2);
        ease=Math.max(1.3,ease-0.15);
      }
      else if(rating===3){
        intervalDays=Math.max(1,old.intervalDays||1)*ease*1.3;
        ease+=0.15;
      }
      else intervalDays=reps===0?1:reps===1?3:Math.max(1,old.intervalDays)*ease;
      reps++;
    }
    return {
      due:new Date(Date.parse(now)+intervalDays*DAY).toISOString(),intervalDays,ease,reps,lapses
    };
  }
  const reviewActive=item=>!item.reset||(item.attempts||[]).some(a=>Date.parse(a.t)>=Date.parse(item.reset.t));
  function dueItems(state,now=new Date().toISOString()) {
    return Object.entries(state.items||{}).filter(([,x])=>reviewActive(x)&&x.review?.due&&Date.parse(x.review.due)<=Date.parse(now)).map(([itemId,x])=>({
      itemId,due:x.review.due
    })).sort((a,b)=>a.due.localeCompare(b.due)||a.itemId.localeCompare(b.itemId));
  }
  function courseDue(due,index){return due.filter(x=>Object.hasOwn(index,x.itemId));}
  function reviewQueue(due,index,shown={}){
    return courseDue(due,index).filter(x=>!shown[x.itemId]||Date.parse(x.due)>Date.parse(shown[x.itemId].due));
  }
  function nextDue(items,index,now=Date.now()){
    return Object.entries(items).filter(([id,item])=>Object.hasOwn(index,id)&&reviewActive(item)&&Date.parse(item.review?.due)>Number(new Date(now)))
      .map(([itemId,item])=>({itemId,due:item.review.due})).sort((a,b)=>a.due.localeCompare(b.due)||a.itemId.localeCompare(b.itemId))[0]||null;
  }
  return {
    schedule,dueItems,courseDue,reviewQueue,nextDue
  };
});
