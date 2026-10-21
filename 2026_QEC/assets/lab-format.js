(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyLabFormat=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function textHTML(text,tex){
    return String(text??'').split(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$|\\\([\s\S]*?\\\))/g).map(part=>{
      const display=part.startsWith('$$')||part.startsWith('\\[');
      if(display||part.startsWith('\\('))return tex(part.slice(2,-2),{display});
      if(part.startsWith('$')&&part.endsWith('$'))return tex(part.slice(1,-1));
      return esc(part);
    }).join('');
  }
  function formatNumber(value,{format='auto',digits}={}){
    if(typeof value!=='number')return String(value??'');
    if(!Number.isFinite(value))return '—';
    const precision=Number.isFinite(Number(digits))?Math.max(0,Math.min(20,Math.trunc(Number(digits)))):undefined;
    const magnitude=Math.abs(value);
    if(format==='exp'||format==='auto'&&magnitude>0&&(magnitude<1e-3||magnitude>=1e5))return value.toExponential(precision??3);
    if(format==='sig')return value.toPrecision(Math.max(1,precision??5));
    if(format==='fixed'||precision!==undefined)return value.toFixed(precision??3);
    return value.toLocaleString('en-US',{maximumSignificantDigits:5});
  }
  const longText=item=>typeof item.value==='string'&&(item.value.length>60||item.value.split(/\s+/).length>10||item.value.includes('\n'));
  function warningText(text,validity=[]){
    let value=String(text||'').trim();const removed=[];
    // Remove exact card limits, even when a view concatenates them with a real warning.
    for(const limit of [...validity].sort((a,b)=>b.length-a.length))if(limit&&value.includes(limit)){
      value=value.split(limit).join(' ');removed.push(limit);
    }
    return {text:value.replace(/\s+/g,' ').trim(),removed};
  }
  const needsDefaults=presets=>!(presets||[]).some(p=>['reset','defaults'].includes(p.id));
  // Card/control precision is presentation only; the state retains the full numeric value.
  function parameterNumber(value){
    if(typeof value!=='number')return String(value??'');
    if(!Number.isFinite(value))return '—';
    if(value===0)return '0';
    const rounded=Number(value.toPrecision(4)),magnitude=Math.abs(rounded);
    return magnitude<1e-3||magnitude>=1e5?rounded.toExponential().replace('e+','e'):String(rounded);
  }
  return {textHTML,formatNumber,parameterNumber,longText,warningText,needsDefaults};
});
