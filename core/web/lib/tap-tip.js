// Tap popover for elements whose only explanation is a `title` tooltip —
// qualified dates (.gdate) and the small row icons (.row-icon). Hover keeps the
// native title; a tap (or Enter) opens the same text in a small popover, since
// touch screens never show a title.

const TAP_TIP_SELECTOR = '.gdate, .row-icon';

let tipEl = null;
let tipFor = null;

function hideTip() {
  tipEl?.remove();
  tipEl = null;
  tipFor = null;
}

function showTip(el) {
  hideTip();
  tipEl = document.createElement('div');
  tipEl.className = 'tap-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.textContent = el.getAttribute('title') || '';
  document.body.appendChild(tipEl);
  // Centred under the element, clamped to the viewport.
  const r = el.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, document.documentElement.clientWidth - w - 8));
  tipEl.style.left = `${left + window.scrollX}px`;
  tipEl.style.top = `${r.bottom + window.scrollY + 6}px`;
  tipFor = el;
}

/** Wires the tap popover once for the whole document. Capture phase, so views
 *  that stop click propagation still close an open popover. */
export function initTapTips() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.(TAP_TIP_SELECTOR);
    if (!el || el === tipFor) hideTip();
    else showTip(el);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTip();
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.(TAP_TIP_SELECTOR)) {
      e.preventDefault();
      showTip(e.target);
    }
  });
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });
  window.addEventListener('resize', hideTip);
}
