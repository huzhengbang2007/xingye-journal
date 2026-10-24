// A single shared selection surface moves between destinations instead of blinking.
const containers = [...document.querySelectorAll('.mobile-nav, .sidebar nav')];
function position(container) {
  const active = container.querySelector('[data-nav].active');
  const indicator = container.querySelector('.nav-selection');
  if (!indicator) return;
  indicator.hidden = !active;
  if (!active || !container.offsetWidth) return;
  indicator.style.width = active.offsetWidth + 'px';
  indicator.style.height = active.offsetHeight + 'px';
  indicator.style.transform = `translate3d(${active.offsetLeft}px,${active.offsetTop}px,0)`;
}
for (const container of containers) {
  const indicator = document.createElement('span');
  indicator.className = 'nav-selection';
  indicator.setAttribute('aria-hidden', 'true');
  container.prepend(indicator);
  new MutationObserver(() => position(container)).observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  new ResizeObserver(() => position(container)).observe(container);
}
window.addEventListener('resize', () => containers.forEach(position));
window.addEventListener('load', () => containers.forEach(position));
document.fonts.ready.then(() => containers.forEach(position));
