(function(root,factory){
  const api=factory(root,typeof module==='object'&&module.exports?require('./units.js'):root.StudyUnits,typeof module==='object'&&module.exports?require('./lab-format.js'):root.StudyLabFormat);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.StudyLab=api;
})(typeof self!=='undefined'?self:this,function(host,units,format){
  'use strict';
  const factories=new Map(),instances=new Map(),roles=['primary','secondary','tertiary','reference','input','bound','accent','warning'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }
  [c]));
  const clone=x=>JSON.parse(JSON.stringify(x));
  function points(series){
    const p=series?.points||[];
    return Array.isArray(p)?p:Array.from(p.x||[],(x,i)=>[x,p.y[i]]);
  }
  function ticks(min,max,count=5){
    if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return[];
    const raw=(max-min)/Math.max(2,count),pow=10**Math.floor(Math.log10(raw)),f=raw/pow,step=(f<=1?1:f<=2?2:f<=5?5:10)*pow;
    const result=[];
    for(let i=Math.ceil(min/step);
    i<=Math.floor(max/step)&&result.length<100;
    i++)result.push(Number((i*step).toPrecision(12)));
    return result;
  }
  function extent(values){
    let lo=Infinity,hi=-Infinity;
    for(const v of values)if(Number.isFinite(v)){
      lo=Math.min(lo,v);
      hi=Math.max(hi,v);
    }
    if(lo===Infinity)return[-1,1];
    if(lo===hi){
      const d=Math.abs(lo)*0.1||1;
      return[lo-d,hi+d];
    }
    const pad=(hi-lo)*0.05;
    return[lo-pad,hi+pad];
  }
  function domains(series,opts={},ratio=480/250){
    const pts=series.flatMap(s=>points(s).flatMap(p=>s.kind==='arrows'?[[p[0],p[1]],[p[2],p[3]]]:[p])).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    const bounds=axis=>pts.reduce(([lo,hi],p)=>[Math.min(lo,p[axis]),Math.max(hi,p[axis])],[Infinity,-Infinity]);
    const bx=bounds(0),by=bounds(1);
    const fit=(b,otherSpan)=>{
      if(!Number.isFinite(b[0]))return[-1,1];
      const span=b[1]-b[0];
      // A horizontal/vertical chain must not acquire a unit-sized empty axis.
      const pad=(span||otherSpan||Math.abs(b[0])||1)*0.05;
      return[b[0]-pad,b[1]+pad];
    };
    let x=Array.isArray(opts.x?.domain)?opts.x.domain.slice():fit(bx,(by[1]-by[0])*ratio),
        y=Array.isArray(opts.y?.domain)?opts.y.domain.slice():fit(by,(bx[1]-bx[0])/ratio);
    if(opts.aspect==='equal'){
      const dx=x[1]-x[0],dy=y[1]-y[0];
      if(dx/dy>ratio){
        const mid=(y[0]+y[1])/2;
        y=[mid-dx/ratio/2,mid+dx/ratio/2];
      }else{
        const mid=(x[0]+x[1])/2;
        x=[mid-dy*ratio/2,mid+dy*ratio/2];
      }
    }
    return{
      x,y
    };
  }
  function controlVisible(spec,values){
    return Object.entries(spec.show_if||{}).every(([id,wanted])=>
      (Array.isArray(wanted)?wanted:[wanted]).includes(values[id]));
  }
  function createState(card,initial={}){
    const defaults=Object.fromEntries((card.parameters||[]).map(p=>[p.id,p.default]));
    let values={
      ...defaults
    },listeners=new Set();
    function normalize(id,value){
      const p=card.parameters?.find(p=>p.id===id);
      if(!p)return value;
      if(p.type==='number'){
        const n=Number(value);
        if(!Number.isFinite(n))throw new RangeError(`${id} must be finite`);
        return p.range?Math.max(p.range[0],Math.min(p.range[1],n)):n;
      }
      if(p.type==='boolean')return Boolean(value);
      if(p.type==='choice'&&!p.choices.some(c=>c.value===value))throw new RangeError(`Unknown ${id} choice`);
      return value;
    }
    for(const [id,value] of Object.entries(initial))if(id in defaults)values[id]=normalize(id,value);
    const notify=()=>{
      for(const cb of listeners)cb(clone(values));
    };
    const api={
      get:id=>values[id],all:()=>clone(values),set:(id,value)=>{
        const v=normalize(id,value);
        if(Object.is(values[id],v))return;
        values[id]=v;
        notify();
      },reset:()=>{
        values={
          ...defaults
        };
        notify();
      },applyPreset:id=>{
        const preset=(card.presets||[]).find(p=>p.id===id);
        if(!preset)throw new Error(`Unknown preset ${id}`);
        const next={
          ...values
        };
        for(const [k,v] of Object.entries(preset.values||{}))next[k]=normalize(k,v);
        values=next;
        notify();
      },onChange:cb=>{
        listeners.add(cb);
        return()=>listeners.delete(cb);
      }
    };
    return api;
  }
  function animate({
    duration=4000,loop=false,onFrame
  },environment={}){
    const raf=environment.raf||host.requestAnimationFrame?.bind(host),caf=environment.caf||host.cancelAnimationFrame?.bind(host),clock=environment.now||(()=>host.performance.now());
    let playing=false,position=0,start=0,frame=null,listeners=new Set();
    const emit=()=>{
      onFrame(position);
      for(const cb of listeners)cb(position,playing);
    };
    function tick(t){
      if(!playing)return;
      position=(t-start)/duration;
      if(position>=1){
        if(loop){
          position%=1;
          start=t-position*duration;
        }else{
          position=1;
          playing=false;
        }
      }
      emit();
      if(playing)frame=raf(tick);
    }
    const api={
      play(){
        if(playing)return;
        if(position>=1)position=0;
        playing=true;
        start=clock()-position*duration;
        frame=raf(tick);
        for(const cb of listeners)cb(position,playing);
      },pause(){
        playing=false;
        if(frame!==null)caf(frame);
        for(const cb of listeners)cb(position,playing);
      },seek(t){
        position=Math.max(0,Math.min(1,Number(t)||0));
        start=clock()-position*duration;
        emit();
      },get playing(){
        return playing;
      },get position(){
        return position;
      },subscribe(cb){
        listeners.add(cb);
        return()=>listeners.delete(cb);
      }
    };
    return api;
  }
  function element(tag,className,parent,text){
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=text;
    parent?.append(el);
    return el;
  }
  function arrowHead(length,head='auto'){
    return head==='auto'?Math.min(7,Math.max(0,length)*0.3):Math.max(0,Number(head)||0);
  }
  function wrapPlotLabel(value,maxWidth,fontSize=12){
    const limit=Math.max(1,Math.floor(maxWidth/(fontSize*0.65))),lines=[];
    let line='';
    for(const word of String(value||'').split(/\s+/).filter(Boolean)){
      let rest=word;
      if(line&&line.length+1+rest.length>limit){lines.push(line);line='';}
      while(rest.length>limit){lines.push(rest.slice(0,limit));rest=rest.slice(limit);}
      line+=(line?' ':'')+rest;
    }
    if(line)lines.push(line);
    return lines;
  }
  // Coordinates are CSS pixels: an SVG is never scaled down below this width.
  function plotLayout(containerWidth=600,opts={}){
    const width=Math.max(300,Math.round(Number(containerWidth)||600)),narrow=width<420;
    let left=narrow?72:75;
    const right=narrow?22:45,top=24,fontSize=12;
    const plotHeight=Math.max(180,Math.min(280,(width-left-right)*250/480));
    const yLabels=wrapPlotLabel(opts.y?.label,plotHeight,fontSize);
    left+=Math.max(0,yLabels.length-1)*14;
    const plotWidth=Math.max(100,width-left-right);
    const xLabels=wrapPlotLabel(opts.x?.label,plotWidth,fontSize);
    const bottom=top+plotHeight,height=bottom+Math.max(58,50+14*(xLabels.length-1));
    return {width,height,left,right,top,bottom,plotWidth,plotHeight,fontSize,xLabels,yLabels,
      xTicks:narrow?3:5,yTicks:4,narrow,minWidth:300};
  }
  function plotSVG(series=[],opts={},annotations=[],uid='plot',size=plotLayout(600,opts)){
    const {left,top,bottom,plotWidth,plotHeight,fontSize}=size,end=left+plotWidth;
    const d=domains(series,opts,plotWidth/plotHeight),X=x=>left+plotWidth*(x-d.x[0])/(d.x[1]-d.x[0]),Y=y=>bottom-plotHeight*(y-d.y[0])/(d.y[1]-d.y[0]),num=v=>Math.abs(v)>=1e4||Math.abs(v)>0&&Math.abs(v)<0.001?v.toExponential(1):String(Number(v.toPrecision(4)));
    const text=(x,y,value,extra='')=>`<text x="${x}" y="${y}" style="font-size:${fontSize}px" ${extra}>${esc(value)}</text>`;
    const label=(x,y,lines,extra='')=>`<text x="${x}" y="${y}" text-anchor="middle" style="font-size:${fontSize}px" ${extra}>${lines.map((line,i)=>`<tspan x="${x}" dy="${i?14:0}">${esc(line)}</tspan>`).join('')}</text>`;
    let html=`<defs><clipPath id="${uid}-clip"><rect x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></clipPath></defs><g class="plot-axis">`;
    for(const t of ticks(...d.x,size.xTicks)){
      const x=X(t);
      html+=`<path d="M${x} ${top}V${bottom}" class="plot-grid" fill="none"/>`+text(x,bottom+20,num(t),'text-anchor="middle"');
    }
    for(const t of ticks(...d.y,size.yTicks)){
      const y=Y(t);
      html+=`<path d="M${left} ${y}H${end}" class="plot-grid" fill="none"/>`+text(left-10,y+4,num(t),'text-anchor="end"');
    }
    html+=`<path d="M${left} ${top}V${bottom}H${end}" fill="none"/>${label(left+plotWidth/2,bottom+40,size.xLabels)}${label(0,0,size.yLabels,`transform="translate(16 ${top+plotHeight/2}) rotate(-90)"`)}</g><g clip-path="url(#${uid}-clip)">`;
    series.forEach((s,si)=>{
      const pts=points(s),role=roles.includes(s.role)?s.role:'primary',color=`var(--plot-${role})`,width=Number(s.width)||2,dash=s.dash?` stroke-dasharray="${esc(Array.isArray(s.dash)?s.dash.join(' '):s.dash)}"`:'';
      let body='';
      if(s.kind==='scatter')body=pts.filter(p=>p.every(Number.isFinite)).map(p=>`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${width+1}" fill="${color}"/>`).join('');
      else if(s.kind==='arrows')body=pts.filter(p=>p.length>=4&&p.every(Number.isFinite)).map(p=>{
        const x=X(p[0]),y=Y(p[1]),a=X(p[2]),b=Y(p[3]),angle=Math.atan2(b-y,a-x),r=arrowHead(Math.hypot(a-x,b-y),s.head??'auto');
        return `<path d="M${x} ${y}L${a} ${b}M${a-r*Math.cos(angle-.45)} ${b-r*Math.sin(angle-.45)}L${a} ${b}L${a-r*Math.cos(angle+.45)} ${b-r*Math.sin(angle+.45)}" fill="none"/>`;
      }).join('');
      else {
        let segments=[],segment=[];
        for(const p of pts){
          if(Number.isFinite(p[0])&&Number.isFinite(p[1]))segment.push(p);
          else if(segment.length){
            segments.push(segment);
            segment=[];
          }
        }
        if(segment.length)segments.push(segment);
        body=segments.map(ps=>{
          let line=ps.map((p,i)=>`${i?'L':'M'}${X(p[0])} ${Y(p[1])}`).join(' ');
          if(s.kind==='area')line+=`L${X(ps.at(-1)[0])} ${Y(Math.max(d.y[0],Math.min(d.y[1],0)))}L${X(ps[0][0])} ${Y(Math.max(d.y[0],Math.min(d.y[1],0)))}Z`;
          return `<path d="${line}" fill="${s.kind==='area'?color:'none'}"${s.kind==='area'?' fill-opacity="0.18"':''}/>`;
        }).join('');
      }
      html+=`<g class="plot-series" data-series-kind="${esc(s.kind||'line')}" data-series="${esc(s.id||si)}" stroke="${color}" stroke-width="${width}"${dash}>${body}</g>`;
    });
    for(const a of annotations||[]){
      const color=`var(--plot-${roles.includes(a.role)?a.role:'reference'})`;
      html+=`<g class="plot-annotation" stroke="${color}" fill="${color}">`;
      if(a.type==='vline')html+=`<path d="M${X(a.x??a.value)} ${top}V${bottom}" stroke-dasharray="4 4" fill="none"/>`;
      if(a.type==='hline')html+=`<path d="M${left} ${Y(a.y??a.value)}H${end}" stroke-dasharray="4 4" fill="none"/>`;
      if(a.type==='point')html+=`<circle cx="${X(a.x)}" cy="${Y(a.y)}" r="4"/>`;
      if(a.label||a.text)html+=text(X(a.x??d.x[0])+5,Y(a.y??d.y[1])+15,a.label||a.text,'stroke="none"');
      html+='</g>';
    }
    html+='</g>';
    return html;
  }
  let serial=0;
  function plot(el,opts={}){
    const figure=element('figure','study-plot',el);
    element('figcaption','plot-title',figure,opts.title||'');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    figure.append(svg);
    svg.style.width='100%';svg.style.minWidth='300px';svg.style.height='auto';
    svg.setAttribute('role','img');
    svg.setAttribute('aria-label',opts.title||'Plot');
    const legend=element('div','plot-legend',figure),uid='plot-'+(++serial);
    legend.style.fontSize='12px';legend.style.flexWrap='wrap';
    let series=[],annotations=[],size;
    function draw(){
      svg.setAttribute('viewBox',`0 0 ${size.width} ${size.height}`);
      svg.innerHTML=plotSVG(series,opts,annotations,uid,size);
      legend.style.flexDirection=size.narrow?'column':'row';
    }
    function resize(){
      const measured=figure.getBoundingClientRect().width||el.getBoundingClientRect().width||600;
      const next=plotLayout(measured,opts);
      figure.tabIndex=measured<next.minWidth?0:-1;
      figure.setAttribute('aria-label',measured<next.minWidth?'Plot; scroll horizontally to see all labels':opts.title||'Plot');
      if(size&&size.width===next.width)return;
      size=next;draw();
    }
    function update(nextSeries=[],nextAnnotations=[]){
      series=nextSeries;annotations=nextAnnotations;
      draw();
      legend.replaceChildren();
      if(opts.legend)for(const s of series){
        const item=element('span','legend-item',legend),swatch=element('i','',item);
        item.style.minWidth='0';item.style.overflowWrap='anywhere';swatch.style.flexShrink='0';
        swatch.style.background=`var(--plot-${roles.includes(s.role)?s.role:'primary'})`;
        element('span','',item,s.label||s.id||'Series');
      }
    }
    resize();
    const observer=host.ResizeObserver?new host.ResizeObserver(resize):null;
    if(observer)observer.observe(figure);
    else host.addEventListener?.('resize',resize);
    return {update,svg,destroy(){observer?.disconnect();host.removeEventListener?.('resize',resize);}};
  }
  // A fixed trailing window coalesces slider input and animation without delaying redraws.
  function createValueWriter(write,environment={}){
    const schedule=environment.setTimeout||setTimeout,cancel=environment.clearTimeout||clearTimeout;
    let timer=null,pending=null;
    function flush(){
      if(timer!==null)cancel(timer);
      timer=null;
      if(pending===null)return;
      const values=pending;pending=null;write(values);
    }
    return {update(values){pending=values;if(timer===null)timer=schedule(flush,400);},flush,
      destroy(){flush();}};
  }
  function mount(id,root,card){
    const store=host.StudyStore,state=createState(card,store?.get(['labs',root.id,'values'])||{}),cleanups=[],plots=new Set();
    cleanups.push(()=>{for(const chart of plots)chart.destroy();plots.clear();});
    const ctx={
      id:root.id,card,data:card.dataFiles||{},model:host.StudyLabModels?.[id],state,layout(parent){
        const wrap=element('div','lab-layout',parent),plots=element('div','lab-plots',wrap),controls=element('fieldset','lab-controls',wrap),readouts=element('div','lab-readouts',parent),notes=element('div','lab-notes',parent);
        controls.disabled=root.dataset.gated==='true';
        controls.setAttribute('aria-label','Lab controls');
        return {
          plots,controls,readouts,notes
        };
      },tex(str,{
        display=false
      }={}){
        return host.katex.renderToString(String(str),{
          displayMode:display,strict:'error',throwOnError:true,trust:false,macros:pageData().math?.macros||{}
        });
      },plot(el,opts){
        // Legacy views can replace a plot stack; release observers from discarded figures.
        for(const chart of plots)if(chart.svg.isConnected===false){chart.destroy();plots.delete(chart);}
        const chart=plot(el,opts);plots.add(chart);return chart;
      },readouts(el,items){
        let group=el.querySelector(':scope > .readout-items');
        if(!group)group=element('div','readout-items',el);
        group.replaceChildren();
        for(const item of items){
          const node=element('div','readout',group),label=element('span','',node);
          if(item.tex)label.innerHTML=ctx.tex(item.tex);
          else label.innerHTML=format.textHTML(item.label||'',ctx.tex);
          const v=format.formatNumber(item.value,item);
          if(format.longText(item))node.classList.add('readout-prose');
          const value=element('strong','',node);
          value.innerHTML=format.textHTML(v,ctx.tex);
          if(item.units||item.units_tex){
            const unit=element('span','unit',value);
            unit.innerHTML=' '+units.render(item,ctx.tex);
          }
        }
      },notes(el,htmlOrText){
        let block=el.querySelector(':scope > .lab-explanation');
        if(!block)block=element('div','lab-explanation',el);
        // HTML is an author-provided SDK argument, like ctx.tex output; plain text is escaped.
        const value=String(htmlOrText??'');
        block.innerHTML=/^\s*</.test(value)?value:format.textHTML(value,ctx.tex);
        if(/^\s*</.test(value)){
          const walker=document.createTreeWalker(block,4),nodes=[];
          while(walker.nextNode())if(!walker.currentNode.parentElement.closest('.katex,code,pre'))nodes.push(walker.currentNode);
          for(const node of nodes){const span=document.createElement('span');span.innerHTML=format.textHTML(node.textContent,ctx.tex);node.replaceWith(span);}
        }
        block.hidden=!value.trim();return block;
      },warn(el,text){
        let box=el.querySelector(':scope > .lab-warning');
        if(!box)box=element('p','lab-warning',el);
        const filtered=format.warningText(text,card.validity);
        if(filtered.removed.length&&pageData().dev&&!root.dataset.warnedDuplicateLimit){
          console.warn(`Lab ${id}: ctx.warn received card validity; use warnings only for state-dependent invalid or singular regions.`);
          root.dataset.warnedDuplicateLimit='true';
        }
        box.setAttribute('role','status');box.innerHTML=format.textHTML(filtered.text,ctx.tex);box.hidden=!filtered.text;
      },animate(spec){
        const a=animate(spec);
        cleanups.push(()=>a.pause());
        return a;
      },onThemeChange(cb){
        const fn=e=>cb(e.detail);
        host.addEventListener('study:theme',fn);
        const off=()=>host.removeEventListener('study:theme',fn);
        cleanups.push(off);
        return off;
      }
    };
    const control=(el,spec,type)=>{
      const holder=element('label','lab-control',el),label=element('span','control-label',holder);
      const compiled=card.rendered?.parameters?.[spec.id];
      const text=(key,fallback='')=>compiled?.[key]??format.textHTML(spec[key]||fallback,ctx.tex);
      label.innerHTML=(spec.symbol?(compiled?.symbol||ctx.tex(spec.symbol))+' ':'')+text(spec.meaning?'meaning':'label',spec.id||'');
      const notes=[spec.units||spec.units_tex?(compiled?.units??units.render(spec,ctx.tex)):'',...['scale','notes','coupled_note'].filter(k=>spec[k]).map(k=>text(k))].filter(Boolean);
      if(notes.length)element('small','',holder).innerHTML=notes.join(' · ');
      const input=element(type==='select'?'select':'input','',holder);
      input.id=ctx.id+'-'+(spec.id||++serial);
      let output;
      if(type==='slider'){
        input.type='range';
        input.min=spec.log?0:(spec.range?.[0]??spec.min??0);
        input.max=spec.log?1:(spec.range?.[1]??spec.max??1);
        input.step=spec.log?0.001:(spec.step??'any');
        output=element('output','',holder);
        output.htmlFor=input.id;
      }
      else if(type==='toggle')input.type='checkbox';
      else for(const c of spec.choices||spec.options||[]){
        const option=element('option','',input,c.label??c.value??c);
        option.value=String(c.value??c);
      }
      const refresh=()=>{
        holder.hidden=!controlVisible(spec,state.all());
        const v=state.get(spec.id)??spec.default??0;
        if(type==='toggle')input.checked=!!v;
        else if(type==='slider'&&spec.log)input.value=Math.log(v/spec.range[0])/Math.log(spec.range[1]/spec.range[0]);
        else input.value=String(v);
        if(output)output.textContent=format.parameterNumber(Number(v));
      };
      input.addEventListener(type==='select'?'change':'input',()=>{
        let v=type==='toggle'?input.checked:type==='slider'?Number(input.value):input.value;
        if(type==='slider'&&spec.log)v=spec.range[0]*(spec.range[1]/spec.range[0])**v;
        if(type==='select')v=(spec.choices||spec.options||[]).find(c=>String(c.value??c)===v)?.value??v;
        state.set(spec.id,v);
        spec.onChange?.(v);
      });
      cleanups.push(state.onChange(refresh));
      refresh();
      return input;
    };
    ctx.controls={
      slider:(el,s)=>control(el,s,'slider'),toggle:(el,s)=>control(el,s,'toggle'),select:(el,s)=>control(el,s,'select'),button(el,s){
        const button=element('button','',el,s.label||'Apply');
        button.type='button';
        button.addEventListener('click',s.onClick||s.action||(()=>{}));
        return button;
      },fromCard(el){
        for(const p of card.parameters||[])ctx.controls[p.type==='boolean'?'toggle':p.type==='choice'?'select':'slider'](el,p);
        const bar=element('div','presets',el);
        for(const p of card.presets||[]){
          const b=ctx.controls.button(bar,{
            label:p.label,onClick:()=>state.applyPreset(p.id)
          });
          b.title=p.shows||'';
        }
        if(format.needsDefaults(card.presets))ctx.controls.button(bar,{
          label:'Defaults',onClick:()=>state.reset()
        });
      },player(el,anim){
        const wrap=element('div','lab-player',el),button=ctx.controls.button(wrap,{
          label:'Play',onClick:()=>anim.playing?anim.pause():anim.play()
        }),label=element('label','',wrap,'Animation position'),scrub=element('input','',label);
        scrub.type='range';
        scrub.min=0;
        scrub.max=1;
        scrub.step=0.001;
        scrub.value=anim.position||0;
        scrub.addEventListener('input',()=>{
          anim.pause();
          anim.seek(Number(scrub.value));
        });
        cleanups.push(anim.subscribe((t,playing)=>{
          scrub.value=t;
          button.textContent=playing?'Pause':'Play';
          button.setAttribute('aria-pressed',String(playing));
        }));
        if(host.matchMedia?.('(prefers-reduced-motion: reduce)').matches)element('p','muted',wrap,'Reduced motion is enabled. Scrub to inspect individual frames.');
        return wrap;
      }
    };
    const writer=createValueWriter(values=>store?.set(['labs',root.id],{
      ...(store.get(['labs',root.id])||{}),values,t:new Date().toISOString()
    }));
    cleanups.push(state.onChange(writer.update));
    for(const event of ['change','pointerup','keyup']){
      root.addEventListener?.(event,writer.flush);
      cleanups.push(()=>root.removeEventListener?.(event,writer.flush));
    }
    host.addEventListener?.('pagehide',writer.flush);
    cleanups.push(()=>host.removeEventListener?.('pagehide',writer.flush));
    cleanups.push(()=>writer.destroy());
    const result=factories.get(id)(root.querySelector('.lab-mount')||root,ctx)||{};
    root.dataset.mounted='true';
    const instance={
      ctx,destroy(){
        result.destroy?.();
        for(const off of cleanups)off();
        instances.delete(root.id);
      }
    };
    instances.set(root.id,instance);
    return instance;
  }
  let cachedPageData;
  function pageData(){
    if(cachedPageData!==undefined)return cachedPageData;
    try{
      return cachedPageData=JSON.parse(document.getElementById('study-page-data').textContent);
    }catch(_){
      return cachedPageData={};
    }
  }
  function mountAll(scope=document){
    const data=pageData();
    for(const root of scope.querySelectorAll('[data-kind="lab"][data-lab-src]')){
      if(instances.has(root.id))continue;
      const id=root.dataset.labSrc;
      try{
        if(!factories.has(id))throw new Error(`Lab ${id} did not register`);
        mount(id,root,data.labs?.[id]||{});
      }catch(error){
        element('p','lab-warning',root.querySelector('.lab-mount')||root,'Lab could not start: '+error.message);
        console.error(error);
      }
    }
  }
  return {
    register(id,fn){
      if(factories.has(id))throw new Error(`Duplicate lab registration ${id}`);
      factories.set(id,fn);
    },mountAll,get:id=>instances.get(id),ticks,extent,domains,points,createState,animate,plotSVG,plotLayout,wrapPlotLabel,createValueWriter,arrowHead,controlVisible
  };
});
