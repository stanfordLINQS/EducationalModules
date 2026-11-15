/* Local patch: Bloch sphere panel for the error-discretization lab.
   Shows the unencoded input |psi> and the same qubit after the lab's X rotation R_X(theta).
   error-discretization.js calls LocalBloch.update(layout.plots, result) on every redraw. */
(function(){
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const W=320,H=300,CX=160,CY=150,R=112;
  // Orthographic view: azimuth A about z, elevation E above the equator.
  const A=35*Math.PI/180,E=20*Math.PI/180;
  const e1=[-Math.sin(A),Math.cos(A),0];
  const e2=[-Math.sin(E)*Math.cos(A),-Math.sin(E)*Math.sin(A),Math.cos(E)];
  const view=[Math.cos(E)*Math.cos(A),Math.cos(E)*Math.sin(A),Math.sin(E)];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const proj=r=>[CX+R*dot(r,e1),CY-R*dot(r,e2)];
  const front=r=>dot(r,view)>=-1e-9;
  const bloch=(polar,azimuth)=>[Math.sin(polar)*Math.cos(azimuth),Math.sin(polar)*Math.sin(azimuth),Math.cos(polar)];
  // exp(-i theta X/2) rotates the Bloch vector about +x by theta.
  const rotX=([x,y,z],t)=>[x,y*Math.cos(t)-z*Math.sin(t),y*Math.sin(t)+z*Math.cos(t)];
  const f=n=>n.toFixed(2);

  function path(points,attrs){
    if(points.length<2)return '';
    return `<polyline points="${points.map(p=>p.map(f).join(',')).join(' ')}" fill="none" ${attrs}/>`;
  }
  // Split a 3D curve into front and back runs so the back half can be dashed.
  function curve(points3,frontAttrs,backAttrs){
    let out='',run=[],isFront=null;
    const flush=()=>{if(run.length>1)out+=path(run.map(proj),isFront?frontAttrs:backAttrs);};
    for(const p of points3){
      const fr=front(p);
      if(isFront!==null&&fr!==isFront){run.push(p);flush();run=[p];}
      else run.push(p);
      isFront=fr;
    }
    flush();
    return out;
  }
  function circle(fn){return Array.from({length:121},(_,i)=>fn(2*Math.PI*i/120));}

  function arrow(r,color,dash){
    const [x0,y0]=[CX,CY],[x1,y1]=proj(r),dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy);
    const opacity=front(r)?1:0.55;
    let s=`<line x1="${x0}" y1="${y0}" x2="${f(x1)}" y2="${f(y1)}" stroke="${color}" stroke-width="2.6" stroke-linecap="round"${dash?` stroke-dasharray="${dash}"`:''} opacity="${opacity}"/>`;
    if(len>6){
      const ux=dx/len,uy=dy/len,h=10,w=5;
      const bx=x1-ux*h,by=y1-uy*h;
      s+=`<polygon points="${f(x1)},${f(y1)} ${f(bx-uy*w)},${f(by+ux*w)} ${f(bx+uy*w)},${f(by-ux*w)}" fill="${color}" opacity="${opacity}"/>`;
    }
    s+=`<circle cx="${f(x1)}" cy="${f(y1)}" r="3" fill="${color}" opacity="${opacity}"/>`;
    return s;
  }

  function label(r,text,dx=0,dy=0){
    const [x,y]=proj(r);
    return `<text x="${f(x+dx)}" y="${f(y+dy)}" font-size="12" fill="var(--muted)" text-anchor="middle" dominant-baseline="middle">${text}</text>`;
  }

  function svgFor(p){
    const original=bloch(p.polar,p.azimuth),rotated=rotX(original,p.theta);
    const arcPts=Array.from({length:61},(_,i)=>rotX(original,p.theta*i/60));
    const line='stroke="var(--line)" stroke-width="1"',back='stroke="var(--line)" stroke-width="1" stroke-dasharray="3 4"';
    let s=`<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--muted)" stroke-width="1.2"/>`;
    s+=curve(circle(t=>[Math.cos(t),Math.sin(t),0]),line,back);
    s+=curve(circle(t=>[Math.sin(t),0,Math.cos(t)]),line,back);
    // Axes, dashed where they pass behind the centre; the rotation axis (x) is in the accent colour.
    for(const [axis,color] of [[[1,0,0],'var(--plot-accent)'],[[0,1,0],'var(--muted)'],[[0,0,1],'var(--muted)']])
      s+=curve([-1,0,1].map(t=>axis.map(c=>c*t)),`stroke="${color}" stroke-width="1"`,`stroke="${color}" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"`);
    s+=label([0,0,1.13],'|0⟩')+label([0,0,-1.13],'|1⟩')+label([1.22,0,0],'+x')+label([0,1.17,0],'+y');
    s+=curve(arcPts,'stroke="var(--plot-tertiary)" stroke-width="2" stroke-dasharray="1.5 3.5"','stroke="var(--plot-tertiary)" stroke-width="1.5" stroke-dasharray="1.5 3.5" opacity="0.55"');
    // Drop lines to the equatorial plane give each arrow a visible depth.
    for(const [r,color] of [[original,'var(--plot-primary)'],[rotated,'var(--plot-secondary)']]){
      const foot=[r[0],r[1],0];
      s+=path([proj(r),proj(foot)],`stroke="${color}" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"`);
      s+=path([[CX,CY],proj(foot)],`stroke="${color}" stroke-width="1" stroke-dasharray="2 3" opacity="0.7"`);
    }
    s+=arrow(original,'var(--plot-primary)','');
    s+=arrow(rotated,'var(--plot-secondary)','7 4');
    s+=`<circle cx="${CX}" cy="${CY}" r="2.5" fill="var(--text)"/>`;
    return {s,original,rotated};
  }

  const vec=r=>`(${r.map(v=>(Math.abs(v)<5e-4?0:v).toFixed(3)).join(', ')})`;

  function update(container,result){
    if(!container)return;
    let fig=container.querySelector(':scope>.local-bloch');
    if(!fig){
      fig=document.createElement('figure');fig.className='study-plot local-bloch';
      fig.innerHTML='<figcaption class="plot-title">Bloch sphere: input qubit and the same qubit after R<sub>X</sub>(θ)</figcaption>'+
        `<svg viewBox="0 0 ${W} ${H}" role="img" style="width:100%;max-width:420px;height:auto;display:block;margin:0 auto"></svg>`+
        '<div class="plot-legend" style="font-size:12px;flex-wrap:wrap"></div><p class="local-bloch-note" style="font-size:12px;color:var(--muted);padding:0 15px;margin:6px 0 0"></p>';
      container.prepend(fig);
    }
    const svg=fig.querySelector('svg'),legend=fig.querySelector('.plot-legend'),note=fig.querySelector('.local-bloch-note');
    if(!result||!result.valid){svg.innerHTML='';legend.replaceChildren();note.textContent='';return;}
    const p=result.params,{s,original,rotated}=svgFor(p);
    svg.innerHTML=s;
    svg.setAttribute('aria-label',`Bloch sphere. Original vector ${vec(original)}, rotated vector ${vec(rotated)}.`);
    legend.innerHTML=[
      ['var(--plot-primary)',`Original |ψ⟩ ${vec(original)}`],
      ['var(--plot-secondary)',`After R<sub>X</sub>(θ) ${vec(rotated)}`],
      ['var(--plot-tertiary)','Rotation path about +x'],
    ].map(([c,t])=>`<span class="legend-item" style="min-width:0"><i style="background:${c};flex-shrink:0"></i><span>${t}</span></span>`).join('');
    note.textContent=`Vectors are (⟨X⟩, ⟨Y⟩, ⟨Z⟩). The dashed arrow is what an unencoded qubit would become (fidelity ${result.readouts.unprotectedFidelity.toFixed(4)}). In the code the same rotation hits one physical qubit; `+
      (p.correct?'measuring the syndrome and correcting returns the logical state to the solid arrow.':'with correction off, the flagged branch is left in an error state outside the code space.');
  }
  window.LocalBloch={update};
})();
