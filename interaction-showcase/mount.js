(() => {
  const base = new URL('.', document.currentScript.src);
  let section = null, frame = null, queued = false;
  // <modify> Warm the iframe ahead of the viewport; playback remains visibility-gated.
  let proximityObserver = null, near = false, viewportQueued = false;
  const style = document.createElement('link');
  style.rel = 'stylesheet'; style.href = new URL('mount.css?v=2', base).href;
  document.head.append(style);
  function sendTheme() {
    if (!frame) return;
    const theme = document.querySelector('.site-shell')?.dataset.theme || document.documentElement.dataset.theme || 'dark';
    frame.contentWindow?.postMessage({type:'movens-interaction-theme', theme}, location.origin);
  }
  function mount() {
    queued = false;
    // <modify> React owns the heading and section order; the gallery uses a stable media slot.
    // const anchor = [...document.querySelectorAll('.dataset-release')].find(el => el.querySelector('h3')?.textContent.trim() === 'Explore Movens-5M.');
    const anchor = document.getElementById('dataset-interaction-gallery-slot');
    if (!anchor) { proximityObserver?.disconnect(); if (section?.isConnected) section.remove(); return; }
    if (anchor.dataset.interactionReady !== 'true') return;
    // if (section?.isConnected && section.previousElementSibling === anchor) return;
    if (section?.isConnected && section.parentElement === anchor) return;
    if (!section) {
      /* <modify> The host uses the shared dataset heading styles instead of creating a second section.
      section = document.createElement('section');
      section.id = 'human-object-interactions';
      section.className = 'section movens-interaction-section';
      */
      section = document.createElement('div');
      section.className = 'movens-interaction-gallery';
      // Previous: assign src immediately, then rely on frame.loading = 'lazy'.
      frame = document.createElement('iframe'); frame.loading = 'eager';
      frame.title = 'Twelve human and humanoid object-interaction examples';
      frame.allow = 'autoplay; fullscreen';
      frame.addEventListener('load', () => { sendTheme(); sendProximity(); });
      section.append(frame);
    }
    // anchor.insertAdjacentElement('afterend',section); sendTheme();
    // <modify> Reserve the grid footprint instead of shifting lower sections when it loads.
    const width = anchor.clientWidth, columns = width <= 620 ? 2 : width <= 1000 ? 3 : 6;
    const gap = width <= 620 ? 10 : 12, rows = 12 / columns;
    frame.style.height = Math.ceil((width - (columns - 1) * gap) / columns * rows + (rows - 1) * gap) + 'px';
    anchor.append(section); sendTheme();
    proximityObserver?.disconnect();
    proximityObserver = new IntersectionObserver(([entry]) => {
      near = entry.isIntersecting;
      // <modify> Load the revised hover controller instead of a cached previous iframe document.
      if (near && !frame.getAttribute('src')) frame.src = new URL('index.html?v=7',base).href;
      sendProximity();
    }, {rootMargin:'1200px 0px', threshold:0});
    proximityObserver.observe(anchor);
  }
  function sendProximity() {
    if (!frame?.isConnected) return;
    const rect = frame.getBoundingClientRect();
    frame.contentWindow?.postMessage({type:'movens-interaction-proximity', near, top:rect.top, viewportHeight:window.innerHeight}, location.origin);
  }
  // <modify> An iframe-local observer cannot reliably tell which cards are visible in the host page.
  function scheduleViewport() {
    if (viewportQueued || !frame?.getAttribute('src')) return;
    viewportQueued = true;
    requestAnimationFrame(() => { viewportQueued = false; sendProximity(); });
  }
  window.addEventListener('scroll', scheduleViewport, {passive:true});
  window.addEventListener('resize', scheduleViewport);
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.type !== 'movens-interaction-height') return;
    const height = Number(event.data.height);
    if (Number.isFinite(height) && height >= 100 && height <= 10000) {
      frame.style.height = Math.ceil(height) + 'px';
      sendTheme(); sendProximity();
    }
  });
  function start() {
    // <modify> DOM readiness installs observers; the React marker guards actual insertion.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      mount();
      new MutationObserver(() => {
        // <modify> Remount after host navigation without depending on retired release copy.
        // if (!queued && (!section?.isConnected || !document.querySelector('.dataset-release'))) {
        if (!queued && !section?.isConnected && document.getElementById('dataset-interaction-gallery-slot')) {
          queued = true; requestAnimationFrame(mount);
        }
      }).observe(document.body,{childList:true,subtree:true});
      new MutationObserver(sendTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme'],subtree:true});
      // <modify> Expanding a record above the gallery can move it without a scroll event.
      new ResizeObserver(scheduleViewport).observe(document.body);
    }));
  }
  /* Previous load gate:
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, {once:true});
  */
  window.addEventListener('movens-interaction-ready', mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
