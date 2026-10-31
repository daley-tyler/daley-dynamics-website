import './page-transition.js';

const root = document.documentElement;
const header = document.querySelector('[data-site-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const navLinks = document.querySelector('[data-nav-links]');
const revealItems = document.querySelectorAll('[data-reveal]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const qaParams = new URLSearchParams(location.search);
const motionReduced = () => reducedMotion.matches || qaParams.get('motion') === 'reduce';

if (qaParams.get('motion') === 'reduce') root.dataset.motion = 'reduced';

let frameRequested = false;

function updateScrollState() {
  header.dataset.scrolled = window.scrollY > 28 ? 'true' : 'false';
  frameRequested = false;
}

function requestScrollUpdate() {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(updateScrollState);
}

function closeMenu({ restoreFocus = false } = {}) {
  menuToggle.setAttribute('aria-expanded', 'false');
  navLinks.removeAttribute('data-open');
  if (restoreFocus) menuToggle.focus();
}

menuToggle.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  navLinks.toggleAttribute('data-open', !isOpen);
});

navLinks.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    closeMenu({ restoreFocus: true });
  }
});

window.addEventListener('scroll', requestScrollUpdate, { passive: true });
window.addEventListener('resize', requestScrollUpdate, { passive: true });
updateScrollState();

if ('IntersectionObserver' in window && !motionReduced()) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add('is-visible'));
}

root.dataset.enhanced = 'true';

let stopScene;
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    import('./live-scene.js')
      .then(({ startLiveScene }) => startLiveScene())
      .then((dispose) => {
        stopScene = dispose;
      })
      .catch(() => {
        root.dataset.scene = 'fallback';
      });
  });
});
if (import.meta.hot) import.meta.hot.dispose(() => stopScene?.());

if (qaParams.has('inspect')) {
  let count = 0;
  let start = 0;
  function measureCadence(time) {
    if (!start) start = time;
    count++;
    if (time - start > 2000) {
      root.dataset.rafFps = (((count - 1) * 1000) / (time - start)).toFixed(1);
      count = 0;
      start = 0;
    }
    requestAnimationFrame(measureCadence);
  }
  requestAnimationFrame(measureCadence);
}
