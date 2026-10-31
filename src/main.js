import { initEnquiryForm } from './enquiry-form.js';
import './page-transition.js';

const root = document.documentElement;
const header = document.querySelector('[data-site-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const navLinks = document.querySelector('[data-nav-links]');
const glassStage = document.querySelector('[data-glass-stage]');
const revealItems = document.querySelectorAll('[data-reveal]');
const enquiryForm = document.querySelector('[data-enquiry-form]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = window.matchMedia('(pointer: fine)');
const qaParams = new URLSearchParams(location.search);
const motionReduced = () => reducedMotion.matches || qaParams.get('motion') === 'reduce';
if (qaParams.get('motion') === 'reduce') root.dataset.motion = 'reduced';
initEnquiryForm(enquiryForm);

let frameRequested = false;

function updateScrollState() {
  const scrollY = window.scrollY;
  header.dataset.scrolled = scrollY > 28 ? 'true' : 'false';

  if (!motionReduced()) {
    const viewport = Math.max(window.innerHeight, 1);
    const progress = Math.min(scrollY / viewport, 1);
    root.style.setProperty('--scroll-progress', progress.toFixed(3));
  }

  frameRequested = false;
}

function requestScrollUpdate() {
  if (frameRequested) return;
  frameRequested = true;
  window.requestAnimationFrame(updateScrollState);
}

function closeMenu() {
  menuToggle.setAttribute('aria-expanded', 'false');
  navLinks.removeAttribute('data-open');
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
    closeMenu();
    menuToggle.focus();
  }
});

if (glassStage && finePointer.matches && !motionReduced()) {
  glassStage.addEventListener('pointermove', (event) => {
    if (motionReduced()) return;
    const bounds = glassStage.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;

    glassStage.style.setProperty('--pointer-x', `${(x * 100).toFixed(1)}%`);
    glassStage.style.setProperty('--pointer-y', `${(y * 100).toFixed(1)}%`);
    glassStage.style.setProperty('--shift-x', `${((x - 0.5) * 10).toFixed(1)}px`);
    glassStage.style.setProperty('--shift-y', `${((y - 0.5) * 8).toFixed(1)}px`);
  });

  glassStage.addEventListener('pointerleave', () => {
    glassStage.removeAttribute('style');
  });
}

reducedMotion.addEventListener('change', (event) => {
  if (event.matches) {
    root.style.removeProperty('--scroll-progress');
    glassStage?.removeAttribute('style');
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

const sectionLinks = [...navLinks.querySelectorAll('a[href^="#"]')];
const trackedSections = sectionLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!current) return;
      sectionLinks.forEach((link) => {
        if (link.getAttribute('href') === `#${current.target.id}`)
          link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    },
    { rootMargin: '-28% 0px -58% 0px', threshold: [0, 0.15, 0.4] },
  );
  trackedSections.forEach((section) => sectionObserver.observe(section));
}

root.dataset.enhanced = 'true';

// Render enhancement starts after the semantic page's first paint.
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

// Opt-in local QA only. Measures the browser's rAF cadence even with effects disabled.
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
