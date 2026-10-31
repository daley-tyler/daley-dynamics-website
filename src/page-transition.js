const root = document.documentElement;
const EXIT_MS = 160;
let navigationTimer;

function reducedMotion() {
  return (
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    new URLSearchParams(location.search).get('motion') === 'reduce'
  );
}

document.addEventListener('click', (event) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    reducedMotion()
  )
    return;

  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (
    !link ||
    link.hasAttribute('download') ||
    link.hasAttribute('data-no-page-transition') ||
    link.relList?.contains('external') ||
    (link.target && link.target !== '_self')
  )
    return;

  let target;
  try {
    target = new URL(link.href, location.href);
  } catch {
    return;
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== location.origin) return;
  if (!target.pathname.endsWith('/') && !target.pathname.endsWith('.html')) return;
  if (target.pathname === location.pathname && target.search === location.search) return;

  event.preventDefault();
  if (navigationTimer) return;
  root.dataset.pageLeaving = 'true';
  navigationTimer = setTimeout(() => {
    navigationTimer = undefined;
    location.assign(target.href);
  }, EXIT_MS);
});

window.addEventListener('pagehide', () => {
  clearTimeout(navigationTimer);
  navigationTimer = undefined;
  delete root.dataset.pageLeaving;
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) root.dataset.pageRestored = 'true';
  delete root.dataset.pageLeaving;
});
