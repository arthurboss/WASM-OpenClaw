// Environment marker: makes non-production deployments unmistakable.
// Production (served at the gh-pages root) shows nothing; any sub-path
// deployment (staging, previews) logs its env and paints a small,
// click-through corner badge so it can never be confused with prod.
(function () {
  var m = location.pathname.match(/\/staging\//);
  var env = m ? 'staging' : 'production';
  console.info('[env] Claw Web environment: ' + env + ' (' + location.pathname + ')');
  if (env === 'production') return;
  window.addEventListener('load', function () {
    var b = document.createElement('div');
    b.textContent = 'STAGING';
    b.setAttribute('aria-hidden', 'true');
    b.style.cssText =
      'position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;' +
      'font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;color:#fff;' +
      'background:#b8860b;padding:3px 7px;border-bottom-left-radius:5px;' +
      'opacity:.85;text-shadow:0 1px 1px rgba(0,0,0,.5);' +
      'padding-top:calc(3px + env(safe-area-inset-top));' +
      'padding-right:calc(7px + env(safe-area-inset-right));';
    document.body.appendChild(b);
  });
})();
