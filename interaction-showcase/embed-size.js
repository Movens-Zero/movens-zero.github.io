(() => {
  let last = 0;
  function report() {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height > 0 && height !== last) {
      last = height;
      parent.postMessage({type:'movens-interaction-height',height}, location.origin);
    }
  }
  new ResizeObserver(report).observe(document.body);
  window.addEventListener('load', report);
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'movens-interaction-theme') {
      document.documentElement.dataset.theme = event.data.theme === 'dark' ? 'dark' : 'light';
      report();
    }
  });
})();
