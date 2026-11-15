// Local patch: hover (or focus) an internal reference link to preview its target inline.
// Same-page targets are cloned from the live page; other pages come from window.REF_PREVIEWS
// (built by local-patches/apply.py), since file:// pages cannot fetch each other.
(function(){
  'use strict';
  const BLOCK='figure,.equation,article.source,li,p,blockquote,table,dd,dt,pre,details';
  const CONTAINERS='section,div,aside,article,header,main';
  const MAX_PREVIEW=120000;
  const SHOW_DELAY=250,HIDE_DELAY=200;
  let pop=null,timer=null,current=null;

  function style(){
    const css=`
.ref-preview{position:fixed;z-index:9999;max-width:min(560px,calc(100vw - 24px));max-height:min(60vh,520px);overflow:auto;
  padding:12px 14px;background:var(--panel,#fff);color:var(--text,#000);border:1px solid var(--line,#ccc);border-radius:8px;
  box-shadow:0 8px 28px rgba(0,0,0,.35);font-size:.92rem;line-height:1.45}
.ref-preview[hidden]{display:none}
.ref-preview .ref-preview-from{margin:0 0 6px;font-size:.75rem;color:var(--muted,#666);text-transform:uppercase;letter-spacing:.04em}
.ref-preview figure,.ref-preview .equation,.ref-preview article{margin:0}
.ref-preview svg,.ref-preview img{max-width:100%;height:auto}
.ref-preview p{margin:.4em 0}
.ref-preview .section-tools,.ref-preview .copy-ref,.ref-preview .eq-number{display:none}
.ref-preview h2,.ref-preview h3,.ref-preview h4{margin:0 0 .4em;font-size:1rem}`;
    const el=document.createElement('style');el.textContent=css;document.head.appendChild(el);
  }

  // Mirrors preview_root() in local-patches/apply.py.
  function summary(container){
    let heading=container.querySelector('h1,h2,h3,h4,h5,h6');
    if(!heading&&container.dataset.title){heading=document.createElement('h3');heading.textContent=container.dataset.title;}
    return [heading,...container.querySelectorAll('p')].filter(Boolean).slice(0,3);
  }
  function previewNodes(target){
    if(target.matches('h1,h2,h3,h4,h5,h6'))return summary(target.closest('section')||target.parentElement);
    if(target.matches(CONTAINERS)&&!target.matches(BLOCK))return summary(target);
    const root=target.matches(BLOCK)?target:target.closest(BLOCK)||target;
    return root.outerHTML.length>MAX_PREVIEW?summary(root):[root];
  }

  function clean(node){
    node.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
    if(node.removeAttribute)node.removeAttribute('id');
    node.querySelectorAll('input,button,select,textarea,a').forEach(n=>n.setAttribute('tabindex','-1'));
    if(node.matches&&node.matches('article.source'))node.querySelectorAll(':scope>ul').forEach(n=>n.remove());
    return node;
  }

  function resolve(link){
    const url=new URL(link.getAttribute('href'),location.href);
    if(!url.hash||url.protocol!==location.protocol)return null;
    const id=decodeURIComponent(url.hash.slice(1));
    const page=url.pathname.split('/').pop()||'index.html';
    const here=location.pathname.split('/').pop()||'index.html';
    if(page===here){
      const target=document.getElementById(id);
      if(!target||target.contains(link))return null;
      const frag=document.createDocumentFragment();
      previewNodes(target).forEach(n=>frag.appendChild(clean(n.cloneNode(true))));
      return {frag,from:null};
    }
    const html=(window.REF_PREVIEWS||{})[page+'#'+id];
    if(!html)return null;
    const tpl=document.createElement('template');tpl.innerHTML=html;
    [...tpl.content.children].forEach(clean);
    return {frag:tpl.content,from:page};
  }

  function eligible(link){
    if(!link||!link.matches('main a[href*="#"]'))return false;
    if(link.closest('nav,.section-tools,.ref-preview')||link.matches('.eq-number,.skip'))return false;
    return true;
  }

  function place(link){
    const r=link.getBoundingClientRect(),gap=8,vw=innerWidth,vh=innerHeight;
    pop.style.left='0px';pop.style.top='0px';
    const w=pop.offsetWidth,h=pop.offsetHeight;
    const left=Math.max(12,Math.min(r.left,vw-w-12));
    const top=r.bottom+gap+h<=vh-12||r.top-gap-h<12?Math.min(r.bottom+gap,vh-h-12):r.top-gap-h;
    pop.style.left=left+'px';pop.style.top=Math.max(12,top)+'px';
  }

  function show(link){
    const res=resolve(link);
    if(!res)return;
    pop.replaceChildren();
    if(res.from){const p=document.createElement('p');p.className='ref-preview-from';p.textContent=res.from.replace(/\.html$/,'');pop.appendChild(p);}
    pop.appendChild(res.frag);
    pop.hidden=false;pop.scrollTop=0;current=link;place(link);
  }
  function hide(){pop.hidden=true;current=null;}

  function schedule(fn,ms){clearTimeout(timer);timer=setTimeout(fn,ms);}

  function init(){
    style();
    pop=document.createElement('div');pop.className='ref-preview';pop.hidden=true;pop.setAttribute('role','tooltip');
    document.body.appendChild(pop);
    document.addEventListener('pointerover',e=>{
      if(pop.contains(e.target)){clearTimeout(timer);return;}
      const link=e.target.closest&&e.target.closest('a');
      if(eligible(link)){if(link!==current)schedule(()=>show(link),SHOW_DELAY);else clearTimeout(timer);}
      else if(!pop.hidden)schedule(hide,HIDE_DELAY);
      else clearTimeout(timer);
    });
    document.addEventListener('focusin',e=>{const link=e.target.closest&&e.target.closest('a');if(eligible(link))show(link);});
    document.addEventListener('focusout',()=>schedule(hide,HIDE_DELAY));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
    addEventListener('scroll',()=>{if(current&&!pop.matches(':hover'))hide();},{passive:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
