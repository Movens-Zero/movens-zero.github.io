import {PairClock} from './timing.js?v=1';
// <modify> Visible and hovered videos take priority over two-job background preparation.
import {PreloadQueue} from './preload.js?v=2';
const gallery=document.querySelector('#gallery'), pauseAll=document.querySelector('#pause-all');
const cards=[]; let globalPlay=true;
const preparations=new PreloadQueue(2);
let nearGallery=window.parent===window;
let hostViewport=null;
const canWarm=()=>nearGallery && !document.hidden;
const node=(tag, cls, text) => {const n=document.createElement(tag); if(cls)n.className=cls;if(text)n.textContent=text;return n;};
// <modify> Cancel stale switches without cancelling a useful background video download.
const cancelled=()=>Object.assign(new Error('Switch superseded'),{name:'AbortError'});
const waitFor=(promise,signal)=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(cancelled());return;}
  const abort=()=>{cleanup();reject(cancelled());};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  signal.addEventListener('abort',abort,{once:true});
  promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
});
const eventReady=(video,event,ready,signal) => new Promise((resolve,reject) => {
  if(signal?.aborted){reject(cancelled());return;}
  if(ready()){resolve();return;}
  // A previously decoded video can become ready again on canplay/seeked, without another loadeddata.
  // Previous: listen only to video.addEventListener(event,ok).
  const events=event==='loadeddata'?['loadeddata','canplay','canplaythrough','seeked','progress']:[event];
  const cleanup=()=>{clearTimeout(timer);events.forEach(name=>video.removeEventListener(name,ok));video.removeEventListener('error',bad);signal?.removeEventListener('abort',abort);};
  const ok=()=>{if(ready()){cleanup();resolve();}};
  const bad=()=>{cleanup();reject(new Error('视频加载失败'));};
  const abort=()=>{cleanup();reject(cancelled());};
  // Previous timeout referred to a hidden Play button.
  const timer=setTimeout(()=>{cleanup();reject(new Error('Loading timed out. Click this card to retry.'));},15000);
  events.forEach(name=>video.addEventListener(name,ok));video.addEventListener('error',bad);signal?.addEventListener('abort',abort,{once:true});
});
async function seek(video,time,signal){
  if(signal?.aborted)throw cancelled();
  if(Math.abs(video.currentTime-time)>.0005){
    // Subscribe before seek; retain the old visible frame until the destination is ready.
    let assigned=false;
    const done=eventReady(video,'seeked',()=>assigned && !video.seeking && Math.abs(video.currentTime-time)<.01,signal);
    assigned=true;video.currentTime=time;await done;
  }
  await eventReady(video,'loadeddata',()=>video.readyState>=2,signal);
}
class PairCard {
  constructor(sample,index){
    this.sample=sample;this.mode='g1';this.desired='g1';this.visible=false;this.ready=false;this.wantsPlay=true;this.busy=false;this.resetting=false;this.packed=sample.presentation?.kind==='packed_pair';this.loading=null;
    // <modify> Track explicit mouse choices and cancellable, time-aligned view changes.
    this.hovered=false;this.pointerOverride=null;this.switchAbort=null;this.statusTimer=null;
    this.el=node('article','card');this.el.dataset.sampleKey=sample.sample_key;this.el.dataset.sampleId=sample.sample_id;this.el.dataset.mode='g1';
    this.stage=node('button','switch');this.stage.type='button';this.stage.setAttribute('aria-label',sample.title+', switch human / G1');this.stage.setAttribute('aria-pressed','false');
    this.poster=node('img','poster');this.poster.alt='';this.poster.loading='lazy';if(sample.poster_path)this.poster.src=sample.poster_path;
    this.stage.append(this.poster);this.videos={};
    for(const side of this.packed?['g1']:['g1','human']){
      const v=node('video',this.packed?'packed':'');v.muted=true;v.defaultMuted=true;v.playsInline=true;v.preload='none';v.disablePictureInPicture=true;v.setAttribute('aria-hidden','true');v.dataset.side=this.packed?'pair':side;
      // <modify> An optional human prefetch failure must not hide a healthy G1 view.
      v.addEventListener('error',()=>{
        v.dataset.failed='true';
        if(this.visible && (this.packed || side===this.mode || side===this.desired))this.fail(new Error('Could not load. Click this card to retry.'));
      });
      v.addEventListener('ended',()=>this.restart().catch(e=>this.fail(e)));
      // <modify> Follow native buffered ranges instead of animating an invented loading percentage.
      for(const event of ['loadstart','progress','loadedmetadata','durationchange','loadeddata','canplay','seeked','emptied'])v.addEventListener(event,()=>this.updateProgress());
      this.videos[side]=v;this.stage.append(v);
    }
    this.blend=node('canvas','transition-frame');this.blend.setAttribute('aria-hidden','true');this.stage.append(this.blend);this.blendAnimation=null;
    this.badge=node('span','badge','HUMANOID · G1');this.stage.append(this.badge);
    this.message=node('span','media-message');this.message.hidden=true;this.stage.append(this.message);
    /* <modify> Previously the waiting panel contained only a text label:
    this.status=node('span','switch-status');this.status.hidden=true;this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.stage.append(this.status);this.stage.setAttribute('aria-busy','false');
    */
    this.status=node('span','switch-status');this.status.hidden=true;this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    const statusRow=node('span','switch-status-row');
    // <modify> Give the full loading label its own row; keep progress and its compact state together below.
    // Previous: statusRow.append(this.statusLabel,this.statusValue).
    this.statusLabel=node('span','switch-status-label');this.statusValue=node('span','switch-status-value');this.statusValue.setAttribute('aria-hidden','true');
    this.progress=node('span','switch-progress');this.progress.setAttribute('role','progressbar');this.progress.setAttribute('aria-valuemin','0');this.progress.setAttribute('aria-valuemax','100');this.progress.setAttribute('aria-live','off');
    this.progressFill=node('span','switch-progress-fill');this.progress.append(this.progressFill);statusRow.append(this.progress,this.statusValue);this.status.append(this.statusLabel,statusRow);this.stage.append(this.status);this.stage.setAttribute('aria-busy','false');
    const info=node('div','card-info'), title=node('div','card-title');title.append(node('h2','',sample.title),node('span','number',String(index+1).padStart(2,'0')));
    const controls=node('div','card-controls');this.toggle=node('button','toggle-side','View human');this.toggle.type='button';this.toggle.setAttribute('aria-pressed','false');
    this.play=node('button','play-card','Pause');this.play.type='button';this.play.setAttribute('aria-pressed','false');controls.append(this.toggle,this.play);
    const links=node('div','links');for(const [field,label] of [['source_url','Source'],['details_url','Details']])if(sample[field]){const a=node('a','',label);a.href=sample[field];a.target='_blank';a.rel='noopener';links.append(a);}
    info.append(title,controls,links);
    if(sample.quality_note)info.append(node('p','quality-note',sample.quality_note));
    if(sample.timing.mode==='mapped')info.append(node('p','quality-note','配对Play：共同有效时段'));
    this.el.append(this.stage,info);gallery.append(this.el);
    /* <modify> Previous: a single missed pointerenter had no mouse-move or click fallback.
    this.el.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')this.request('human');});
    this.el.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')this.request('g1');});
    */
    this.el.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){this.hovered=true;this.pointerOverride=null;this.request('human');}});
    this.el.addEventListener('pointermove',e=>{
      if(e.pointerType!=='mouse')return;
      const entered=!this.hovered;this.hovered=true;
      const side=this.pointerOverride??'human';
      if(entered || this.desired!==side)this.request(side);
    });
    this.el.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){this.hovered=false;this.pointerOverride=null;this.request('g1');}});
    this.toggle.addEventListener('click',()=>this.request(this.desired==='g1'?'human':'g1'));
    this.stage.addEventListener('click',e=>{
      // <modify> Retry through the existing card button on desktop, touch, and keyboard.
      if(this.error){this.retry();return;}
      // Previous: if(e.detail===0 || !matchMedia('(hover:hover)').matches) only touch/keyboard could toggle.
      const side=this.mode==='g1'?'human':'g1';
      if(e.detail>0 && matchMedia('(hover:hover)').matches)this.pointerOverride=side;
      this.request(side);
    });
    this.play.addEventListener('click',()=>{
      if(!globalPlay){globalPlay=true;updateGlobal();}
      if(this.error){this.error=null;this.wantsPlay=true;}else this.wantsPlay=!this.wantsPlay;
      this.ensure().then(()=>this.reconcile()).catch(e=>this.fail(e));this.syncPlay();
    });
  }
  active(){return this.videos[this.packed?'g1':this.mode];}
  // <modify> Translate the local card rectangle into the host viewport before allowing playback.
  inHostView(){
    if(!this.localVisible)return false;
    if(window.parent===window)return true;
    if(!hostViewport)return false;
    const rect=this.el.getBoundingClientRect();
    return rect.bottom+hostViewport.top>40 && rect.top+hostViewport.top<hostViewport.height;
  }
  shouldPlay(){return this.visible && !document.hidden && globalPlay && this.wantsPlay;}
  // <modify> Quiet delayed feedback; cache-hit transitions do not flash a loading label.
  updatePending(){
    const side=this.visible && this.mode!==this.desired && !this.error?this.desired:null;
    if((this.el.dataset.loading??null)===side)return;
    clearTimeout(this.statusTimer);this.status.hidden=true;
    this.stage.setAttribute('aria-busy',String(Boolean(side)));
    if(!side){delete this.el.dataset.loading;delete this.status.dataset.phase;this.progress.removeAttribute('aria-valuenow');this.progress.removeAttribute('aria-valuetext');this.progress.dataset.state='indeterminate';this.progressFill.style.width='0%';return;}
    // <modify> Preserve the short title above a real buffered-progress track.
    // Previous: this.status.textContent=side==='human'?'Loading human…':'Loading G1…';
    // <modify> Use one concise loading title for both comparison views.
    // Previous: this.statusLabel.textContent=side==='human'?'Loading human':'Loading G1'.
    this.el.dataset.loading=side;this.status.dataset.phase='buffering';this.statusLabel.textContent='Loading…';
    this.progress.setAttribute('aria-label',side==='human'?'Human video buffering':'G1 video buffering');this.updateProgress();
    this.statusTimer=setTimeout(()=>{if(this.el.dataset.loading===side && this.visible && !this.error)this.status.hidden=false;},150);
  }
  // <modify> The percentage describes buffered video time, not guessed bytes or seek completion.
  updateProgress(){
    const side=this.el.dataset.loading;if(!side)return;
    const video=this.videos[this.packed?'g1':side];
    const aligning=this.status.dataset.phase==='aligning';
    let percent=null;
    // A progress indicator must never turn a recoverable media-read issue into a failed switch.
    if(!aligning)try{
      const ranges=video.buffered,duration=video.duration;
      if(Number.isFinite(duration) && duration>0 && ranges?.length){
        let seconds=0;
        for(let i=0;i<ranges.length;i++)seconds+=Math.max(0,Math.min(duration,ranges.end(i))-Math.max(0,ranges.start(i)));
        if(Number.isFinite(seconds))percent=Math.max(0,Math.min(100,Math.floor(seconds/duration*100)));
      }
    }catch{/* Optional native buffer information can be unavailable while a source resets. */}
    if(percent!==null){
      this.progress.dataset.state='buffering';this.progressFill.style.width=percent+'%';this.statusValue.textContent=percent+'%';
      this.statusValue.setAttribute('title','Buffered video duration');
      this.progress.setAttribute('aria-valuenow',String(percent));this.progress.setAttribute('aria-valuetext',percent+'% buffered');
    }else{
      const state=aligning?'Aligning':video.getAttribute('src')?'Buffering':'Queued';
      this.progress.dataset.state='indeterminate';this.progressFill.style.width='';this.statusValue.textContent=state;
      this.statusValue.setAttribute('title',aligning?'Aligning the comparison frame':'Waiting for video buffer information');
      this.progress.removeAttribute('aria-valuenow');this.progress.setAttribute('aria-valuetext',aligning?'Aligning video frame':state+' video');
    }
  }
  showMode(mode){
    this.mode=mode;this.el.dataset.mode=mode;this.el.classList.toggle('is-human',mode==='human');
    this.stage.setAttribute('aria-pressed',String(mode==='human'));this.toggle.setAttribute('aria-pressed',String(mode==='human'));
    this.stage.setAttribute('aria-label',this.sample.title+', switch human / G1');
    this.toggle.textContent=mode==='human'?'View G1':'View human';this.badge.textContent=mode==='human'?'HUMAN · SMPL-X':'HUMANOID · G1';
    Object.entries(this.videos).forEach(([side,v])=>v.classList.toggle('active',this.packed || side===mode));
    this.poster.hidden=true;this.message.hidden=true;this.el.dataset.ready='true';
    this.updatePending();
  }
  swapMode(mode){
    // Hold the displayed frame until the aligned destination is ready, then
    // dissolve the old view over it. Crop packed pairs instead of sliding them.
    const v=this.active(), duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:220;
    if(!duration || v.readyState<2){this.blendAnimation?.cancel();this.blend.style.opacity='0';this.showMode(mode);return;}
    const width=this.packed?v.videoWidth/2:v.videoWidth, height=v.videoHeight;
    if(!width || !height){this.showMode(mode);return;}
    const frame=document.createElement('canvas');frame.width=width;frame.height=height;
    const ctx=frame.getContext('2d');
    ctx.drawImage(v,this.packed && this.mode==='g1'?width:0,0,width,height,0,0,width,height);
    if(this.blendAnimation?.playState==='running'){
      ctx.globalAlpha=Number(getComputedStyle(this.blend).opacity);ctx.drawImage(this.blend,0,0,width,height);
    }
    this.blendAnimation?.cancel();this.blend.width=width;this.blend.height=height;
    this.blend.getContext('2d').drawImage(frame,0,0);this.blend.style.opacity='1';
    this.showMode(mode);
    const animation=this.blend.animate([{opacity:1},{opacity:0}],{duration,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
    this.blendAnimation=animation;
    animation.finished.then(()=>{if(this.blendAnimation===animation){this.blend.style.opacity='0';animation.cancel();this.blendAnimation=null;}}).catch(()=>{});
  }
  fail(error){
    this.error=error.message;
    this.message.textContent=this.error.includes('retry')?this.error:this.error+' Click this card to retry.';
    this.message.hidden=false;this.play.textContent='Retry';this.el.dataset.error=this.error;
    this.stage.setAttribute('aria-label','Retry '+this.sample.title);
    this.updatePending();
  }
  retry(){
    if(this.busy)return;
    this.error=null;this.ready=false;this.wantsPlay=true;
    this.reconcile().catch(e=>this.fail(e));
  }
  loadSide(side,priority=100,background=false){
    const v=this.videos[this.packed?'g1':side];
    if(v.readyState>=2 && !v.error && !v.dataset.failed)return Promise.resolve(v);
    return preparations.run(this.sample.sample_key+':'+(this.packed?'pair':side),async()=>{
      // A queued warmup may have been promoted by a visible card before it starts.
      if(background && (document.hidden || (!nearGallery && !this.visible)))return null;
      try{
        if(!v.getAttribute('src') || v.error || v.dataset.failed){
          delete v.dataset.failed;
          v.src=this.packed?this.sample.presentation.path:this.sample[side].path;v.preload='auto';v.load();
        }
        await eventReady(v,'loadedmetadata',()=>v.readyState>=1);
        await eventReady(v,'loadeddata',()=>v.readyState>=2);
        return v;
      }catch(error){v.dataset.failed='true';throw error;}
    },priority);
  }
  warm(){
    if(this.warming || !canWarm())return;
    this.warming=true;this.poster.loading='eager';
    this.loadSide('g1',20,true).then(v=>{
      if(v)this.el.dataset.prepared='true';
      if(v && !this.packed && canWarm())return this.loadSide('human',0,true);
    }).catch(()=>{}).finally(()=>{this.warming=false;});
  }
  async ensure(){
    if(this.ready)return;
    if(this.loading)return this.loading;
    this.loading=(async()=>{
      let mapping=null;
      if(this.sample.timing.mode==='mapped'){const r=await fetch(this.sample.timing.mapping_path);if(!r.ok)throw new Error('时间映射无法读取');mapping=await r.json();}
      this.clock=new PairClock(this.sample,mapping);
      // <modify> Hovering a not-yet-ready card must also prioritize its initial G1 load.
      const v=await this.loadSide('g1',this.desired==='human'?200:100);
      if(!v)return;
      const full=this.clock.mode==='shared_output_clock' && this.clock.range[0]===0 && Math.abs(this.clock.range[1]-v.duration)<.0001;
      v.loop=full;
      await seek(v,this.clock.toMedia('g1',this.clock.range[0]));
      this.ready=true;this.showMode(this.packed?this.desired:'g1');this.watchClock();
    })();
    try{await this.loading;}finally{this.loading=null;}
  }
  // Previous: request(side) only changed desired and could not interrupt a stale wait.
  request(side){
    if(side!==this.desired)this.switchAbort?.abort();
    this.desired=side;this.updatePending();if(!this.visible)return;
    // <modify> Promote an initial G1 warmup even when ensure() was already waiting before hover.
    if(side==='human' && !this.ready && this.loading)this.loadSide('g1',200).catch(()=>{});
    this.reconcile().catch(e=>this.fail(e));
  }
  async reconcile(){
    if(this.busy)return;
    this.busy=true;
    try{
      await this.ensure();
      if(!this.ready)return;
      while(this.visible && this.mode!==this.desired){
        if(this.packed){this.swapMode(this.desired);break;}
        const targetSide=this.desired;
        /* <modify> Previous: await this.loadSide(targetSide), then await seek(target,time).
           Both waits held the card busy even after the pointer had left it. */
        const controller=new AbortController();this.switchAbort=controller;
        try{
          const target=await waitFor(this.loadSide(targetSide,200),controller.signal);
          if(targetSide!==this.desired || !this.visible)continue;
          // <modify> Seeking is not a byte download; use a separate indeterminate alignment state.
          this.status.dataset.phase='aligning';this.updateProgress();
          const source=this.active();source.pause();
          let t=this.clock.fromMedia(this.mode,source.currentTime);
          if(t===null || t>=this.clock.range[1])t=this.clock.range[0];
          target.loop=this.clock.mode==='shared_output_clock' && this.clock.range[0]===0 && Math.abs(this.clock.range[1]-target.duration)<.0001;
          await seek(target,this.clock.toMedia(targetSide,t),controller.signal);
          if(targetSide!==this.desired || !this.visible)continue;
          this.swapMode(targetSide);
        }catch(error){if(controller.signal.aborted || targetSide!==this.desired)continue;throw error;}
        finally{if(this.switchAbort===controller)this.switchAbort=null;}
      }
      delete this.el.dataset.error;this.error=null;this.message.hidden=true;
      this.stage.setAttribute('aria-label',this.sample.title+', switch human / G1');
    }finally{this.busy=false;this.updatePending();this.syncPlay();}
  }
  syncPlay(){
    for(const v of Object.values(this.videos))if(v!==this.active() || !this.shouldPlay())v.pause();
    this.play.textContent=globalPlay && this.wantsPlay?'Pause':'Play';this.play.setAttribute('aria-pressed',String(!globalPlay || !this.wantsPlay));
    if(!this.ready || !this.shouldPlay() || this.busy || this.resetting)return;
    const v=this.active(), side=this.packed?'g1':this.mode;
    v.playbackRate=this.clock.rate(side,this.clock.fromMedia(side,v.currentTime)??this.clock.range[0]);
    const p=v.play();if(p)p.then(()=>{if(!this.shouldPlay() || v!==this.active())v.pause();}).catch(e=>{if(e.name!=='AbortError'){this.wantsPlay=false;this.fail(new Error('点击Play以开始视频'));}});
  }
  async restart(){
    if(this.resetting || this.busy || !this.ready)return;
    this.resetting=true;
    try{const v=this.active();v.pause();await seek(v,this.clock.toMedia(this.packed?'g1':this.mode,this.clock.range[0]));}
    finally{this.resetting=false;this.syncPlay();}
  }
  watchClock(){
    // <modify> Retries reuse one clock watcher instead of accumulating animation loops.
    if(this.clockWatching)return;
    this.clockWatching=true;
    const tick=()=>{
      if(this.ready && this.visible && !this.busy && !this.resetting){
        const side=this.packed?'g1':this.mode,v=this.active();
        if(!v.paused){const t=this.clock.fromMedia(side,v.currentTime);if(t===null || t>=this.clock.range[1])this.restart().catch(e=>this.fail(e));else v.playbackRate=this.clock.rate(side,t);}
      }
      requestAnimationFrame(tick);
    };requestAnimationFrame(tick);
  }
  setVisible(on){if(this.visible===on)return;this.visible=on;if(!on)this.switchAbort?.abort();this.updatePending();if(on)this.reconcile().catch(e=>this.fail(e));else this.syncPlay();}
}
function updateGlobal(){pauseAll.textContent=globalPlay?'Pause all':'Play all';pauseAll.setAttribute('aria-pressed',String(!globalPlay));cards.forEach(c=>c.syncPlay());}
pauseAll.addEventListener('click',()=>{globalPlay=!globalPlay;updateGlobal();});
// <modify> Prewarm near the outer viewport; only the original visibility observer permits playback.
function warmNearby(){if(canWarm())cards.forEach(c=>c.warm());}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.origin!==location.origin || event.data?.type!=='movens-interaction-proximity')return;
  const wasNear=nearGallery;
  nearGallery=event.data.near===true;
  if(Number.isFinite(event.data.top) && Number.isFinite(event.data.viewportHeight))hostViewport={top:event.data.top,height:event.data.viewportHeight};
  cards.forEach(c=>c.setVisible(c.inHostView()));
  if(nearGallery && !wasNear)warmNearby();
});
document.addEventListener('visibilitychange',()=>{
  cards.forEach(c=>{if(!document.hidden && c.visible)c.reconcile().catch(e=>c.fail(e));else c.syncPlay();});
  warmNearby();
});
try{
  // Previous: fetch('data.json',{cache:'no-store'}). Reuse the revisioned HTML preload and browser cache.
  const response=await fetch('data.json?v=10');if(!response.ok)throw new Error('manifest unavailable');
  const data=await response.json();if(data.schema_version!==1 || !Array.isArray(data.samples))throw new Error('manifest schema');
  if(new Set(data.samples.map(s=>s.sample_key)).size!==data.samples.length)throw new Error('duplicate sample keys');
  document.body.dataset.revision=String(data.revision);document.querySelector('#sample-count').textContent=data.samples.length+' examples';document.querySelector('#empty').hidden=Boolean(data.samples.length);
  /* Previous local-only visibility observer:
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>cards.find(c=>c.el===e.target)?.setVisible(e.isIntersecting && e.intersectionRatio>.01)),{threshold:[0,.01,.08]});
  */
  const observer=new IntersectionObserver(entries=>entries.forEach(e=>{
    const card=cards.find(c=>c.el===e.target);if(!card)return;
    card.localVisible=e.isIntersecting && e.intersectionRatio>.01;
    card.setVisible(card.inHostView());
  }),{threshold:[0,.01,.08]});
  data.samples.forEach((sample,i)=>{const c=new PairCard(sample,i);cards.push(c);observer.observe(c.el);});
  warmNearby();
}catch(error){document.querySelector('#load-error').hidden=false;document.querySelector('#sample-count').textContent='加载失败';console.error(error);}
