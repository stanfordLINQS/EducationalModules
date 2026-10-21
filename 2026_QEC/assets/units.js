(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyUnits=api;
})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function tex(spec){
    if(spec.units_tex)return String(spec.units_tex);
    const value=String(spec.units||'').trim();
    if(value.startsWith('$')&&value.endsWith('$'))return value.slice(1,-1);
    if(value.startsWith('\\(')&&value.endsWith('\\)'))return value.slice(2,-2);
    return /\\|[_{}]/.test(value)?value:null;
  }
  function render(spec,renderTex){
    const math=tex(spec);
    if(math!==null)return renderTex(math);
    // Keep prose upright; the entire signed exponent belongs in the superscript.
    const superscript=Object.fromEntries([..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻"].map((c,i)=>[c,'0123456789+-'[i]]));
    return esc(spec.units||'').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g,s=>'<sup>'+[...s].map(c=>superscript[c]).join('')+'</sup>')
      .replace(/\^([+-]?\d+)/g,'<sup>$1</sup>');
  }
  return {tex,render};
});
