(function () {
  'use strict';
  var tooltip = document.createElement('div');
  tooltip.id = 'public-tag-description';
  tooltip.className = 'public-tag-description';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  var active = null;
  var originalDescription = null;

  function hide() {
    tooltip.hidden = true;
    if (active) {
      if (originalDescription === null) active.removeAttribute('aria-describedby');
      else active.setAttribute('aria-describedby', originalDescription);
    }
    active = null;
  }

  function show(event) {
    var target = event.target.closest('[data-tag-description]');
    if (!target || target === active) return;
    hide();
    active = target;
    originalDescription = target.getAttribute('aria-describedby');
    target.setAttribute('aria-describedby', [originalDescription, tooltip.id].filter(Boolean).join(' '));
    tooltip.textContent = target.dataset.tagDescription;
    tooltip.hidden = false;
    var rect = target.getBoundingClientRect();
    var width = tooltip.offsetWidth;
    var height = tooltip.offsetHeight;
    tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
    var top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    tooltip.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + 'px';
  }

  document.addEventListener('mouseover', show);
  document.addEventListener('focusin', show);
  ['mouseout', 'focusout'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (active && active.contains(event.target) && !active.contains(event.relatedTarget)) hide();
    });
  });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape') hide(); });
  document.addEventListener('click', hide);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
})();
