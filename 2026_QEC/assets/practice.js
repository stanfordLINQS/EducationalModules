(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyPractice=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const functions={sqrt:Math.sqrt,exp:Math.exp,ln:Math.log,log:Math.log10,log2:Math.log2,sin:Math.sin,cos:Math.cos,tan:Math.tan,abs:Math.abs};
  function expression(source){
    const text=String(source).replace(/−/g,'-').replace(/[×·]/g,'*').replace(/π/g,'pi').replace(/[{}]/g,c=>c==='{'?'(':')');
    if(text.length>512)throw new Error('Expression is too long');
    const tokens=[];let pos=0;
    while(pos<text.length){
      if(/\s/.test(text[pos])){pos++;continue;}
      const m=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+\d*|[+*/^()-])/i.exec(text.slice(pos));
      if(!m)throw new Error('Unsupported expression or unit');
      if(/^[a-z]/i.test(m[0])&&!['pi','e',...Object.keys(functions)].includes(m[0].toLowerCase()))throw new Error('Unknown name');
      tokens.push(m[0].toLowerCase());pos+=m[0].length;
    }
    let i=0,depth=0;
    const finite=v=>{if(!Number.isFinite(v))throw new Error('The result must be finite');return v;};
    function primary(){
      if(++depth>40)throw new Error('Expression nesting is too deep');
      const t=tokens[i++];let value;
      if(t==='('){value=sum();if(tokens[i++]!==')')throw new Error('Missing closing parenthesis');}
      else if(t==='pi')value=Math.PI;
      else if(t==='e')value=Math.E;
      else if(Object.hasOwn(functions,t)){
        if(tokens[i++]!=='(')throw new Error('Functions require parentheses');
        value=functions[t](sum());if(tokens[i++]!==')')throw new Error('Missing closing parenthesis');
      }
      else if(t!==undefined&&/^\d|^\./.test(t))value=Number(t);
      else throw new Error('Expected a number, constant, function, or parenthesis');
      depth--;return finite(value);
    }
    function power(){const a=primary();return tokens[i]==='^'?(i++,finite(a**unary())):a;}
    function unary(){if(tokens[i]==='+'){i++;return unary();}if(tokens[i]==='-'){i++;return -unary();}return power();}
    function product(){
      let a=unary();
      while(['*','/','pi','e','(',...Object.keys(functions)].includes(tokens[i])){
        const op=tokens[i];if(op==='*'||op==='/')i++;
        const b=unary();a=finite(op==='/'?a/b:a*b);
      }
      return a;
    }
    function sum(){let a=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],b=product();a=finite(op==='+'?a+b:a-b);}return a;}
    const value=sum();if(i!==tokens.length)throw new Error('Unexpected expression suffix');return finite(value);
  }
  function numeric(response,units){
    const text=String(response).trim(),unit=String(units||'').trim();
    try{return {valid:true,value:expression(text)};}catch(_){}
    if(unit&&text.endsWith(unit))try{return {valid:true,value:expression(text.slice(0,-unit.length).trim())};}catch(_){}
    return {valid:false,reason:'Use finite arithmetic, pi or e, or functions sqrt, exp, ln, log (base 10), log2, sin, cos, tan, abs with parentheses (angles in radians)'+(unit?`, optionally followed by ${unit}. Unit conversion is not automatic.`:'.')};
  }
  function grade(item,response){
    const type=item.responseType||item.typeAttribute||item.answerType||item.type;
    // Component type and response type are stored separately.
    if(type==='text')return{
      valid:!!String(response).trim(),correct:null,reason:'Compare your argument with the outcome.'
    };
    if(type==='numeric'){
      const parsed=numeric(response,item.units);
      if(!parsed.valid)return parsed;
      const answer=Number(item.answer),error=Math.abs(parsed.value-answer);
      return{valid:true,correct:error<=Math.max(0,Number(item.tol)||0)||error<=Math.max(0,Number(item.reltol)||0)*Math.abs(answer),value:parsed.value};
    }
    const selected=Array.isArray(response)?response.map(Number):response===''?[]:[Number(response)],correct=(item.choices||[]).flatMap((c,i)=>c.correct?[i]:[]);
    if(!selected.length)return{
      valid:false,reason:'Choose an answer first.'
    };
    return{
      valid:true,correct:selected.length===correct.length&&selected.every(i=>correct.includes(i))
    };
  }
  function labUnlocked(predictId,items={},lab={}){
    return !predictId||!!items[predictId]?.attempts?.length||lab.predictionSkip?.predictId===predictId;
  }
  function exerciseState(item={}, {unsupportedChallenge=false,savedOnly=false}={}){
    const attempted=(!savedOnly&&!!String(item.draft?.text||'').trim()) || (item.attempts||[]).some(a=>String(a.response||'').trim());
    const viewed=!!(item.rubricViewedAt||item.solutionViewedAt);
    return {attempted,supportAvailable:attempted||viewed,ratingAvailable:viewed||(unsupportedChallenge&&attempted)};
  }
  function viewSupport(item,kind,t,options){
    const patch={[kind+'ViewedAt']:t};
    if(kind==='solution'&&!exerciseState(item,options).attempted)patch.solutionViewedBeforeAttempt=true;
    return patch;
  }
  const ratings=['Again','Hard','Good','Easy'];
  const itemIndex=page=>page.itemIndex||page.items||{};
  function outlineProgress(index,items={}){
    const result={};
    for(const [id,info] of Object.entries(index)){
      if(!info.subsection)continue;
      const row=result[info.subsection]||={done:0,total:0};row.total++;if(items[id]?.attempts?.length)row.done++;
    }
    for(const row of Object.values(result)){row.state=row.done===0?'none':row.done===row.total?'done':'partial';row.label=`${row.done}/${row.total} practised`;}
    return result;
  }
  function duration(ms,round=Math.ceil){
    if(ms<3600000)return `${Math.max(1,round(ms/60000))} min`;
    if(ms<86400000)return `${round(ms/3600000)} h`;
    return `${round(ms/86400000)} d`;
  }
  function dueText(due,now=Date.now()){
    if(!Number.isFinite(Date.parse(due)))return 'not scheduled';
    const ms=Date.parse(due)-Number(new Date(now));return ms<=0?'due now':`due in ${duration(ms)}`;
  }
  function dateText(t,now=Date.now()){
    const ms=Math.max(0,Number(new Date(now))-Date.parse(t));
    if(!Number.isFinite(ms))return '';
    return ms<60000?'just now':ms<7*86400000?`${duration(ms,Math.floor)} ago`:String(t).slice(0,10);
  }
  function activeAttempts(item={}){return (item.attempts||[]).filter(a=>!item.reset||Date.parse(a.t)>=Date.parse(item.reset.t));}
  function lastRating(item={}){return activeAttempts(item).findLast(a=>a.selfRating!=null)?.selfRating??null;}
  function statusText(item={},now=Date.now()){
    const attempts=activeAttempts(item),last=attempts.at(-1);
    if(!last)return item.reset?`Reset ${dateText(item.reset.t,now)}; earlier forecast kept`:item.draft?.text?'Draft saved; no attempt yet':'';
    let label;
    if(last.correct===false){const misses=attempts.filter(a=>a.correct===false).length;label=misses===1?`Answered incorrectly ${dateText(last.t,now)}`:misses===2?'Missed twice':`Missed ${misses} times`;}
    else label=`${last.correct===true?'Answered correctly':item.type==='predict'?'Forecast recorded':'Saved'} ${dateText(last.t,now)}`;
    if(last.selfRating!=null)label+=` · rated ${ratings[last.selfRating]}`;
    if(item.review?.due)label+=` · ${last.correct===true?'review ':''}${dueText(item.review.due,now)}`;
    return label;
  }
  function weakSpots(items,index,now=Date.now()){
    return Object.entries(items).flatMap(([id,item])=>{
      if(!index[id])return [];
      const attempts=activeAttempts(item),last=attempts.at(-1),rating=lastRating(item),reasons=[];
      if(item.reset&&!last)return [];
      if(last?.correct===false)reasons.push((item.type||index[id].type)==='predict'?'Last prediction was wrong':'Last answer was wrong');
      if(rating===0||rating===1)reasons.push(`Rated ${ratings[rating]}`);
      if(item.review?.lapses>0)reasons.push(`${item.review.lapses} ${item.review.lapses===1?'lapse':'lapses'}`);
      // A later ungraded forecast must not erase evidence of a wrong prediction.
      if((item.type||index[id].type)==='predict'&&last?.correct!==false&&attempts.some(a=>a.correct===false))reasons.push('Earlier prediction was wrong');
      return reasons.length?[{id,...index[id],reason:reasons.join(' · '),due:dueText(item.review?.due,now)}]:[];
    });
  }
  function notebookAttempts(item={}, {archived=false}={}){
    const attempts=archived?(item.attempts||[]).filter(a=>item.reset&&Date.parse(a.t)<Date.parse(item.reset.t)):activeAttempts(item);
    return attempts.filter((a,i,list)=>!(i>0&&['exercise','challenge'].includes(item.type)&&a.selfRating==null&&a.correct==null&&a.response===list[i-1].response));
  }
  function answerVisibility({correct,misses=0,reveal=false}){return correct!==false||misses>=2||reveal;}
  function exerciseSession(item={}, {review=false,saved=false,viewed=false,early=false,unsupportedChallenge=false}={}){
    if(!review)return exerciseState(item,{savedOnly:true,unsupportedChallenge});
    return {attempted:saved,supportAvailable:saved||early,ratingAvailable:saved&&(viewed||unsupportedChallenge)};
  }
  return{numeric,expression,grade,exerciseState,exerciseSession,viewSupport,labUnlocked,itemIndex,outlineProgress,duration,dueText,dateText,activeAttempts,lastRating,statusText,weakSpots,notebookAttempts,answerVisibility};
});
