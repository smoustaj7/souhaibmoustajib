/* --------------------------------------------------------------------------
   Page behaviour. Everything here is progressive enhancement: the page is
   complete without it, and every effect respects reduced-motion settings.
   -------------------------------------------------------------------------- */
(function () {
  'use strict';

  var root = document.documentElement;

  /* ------------------------------------------------ Shared spring timing */
  // CSS transitions run on the same physics as the JS springs.
  if (window.Spring) {
    Spring.installCssEasings(root, {
      'spring': { dampingRatio: 1, response: 0.4 },
      'spring-quick': { dampingRatio: 1, response: 0.28 }
    });
  }

  // iOS Safari only applies :active (our press feedback) with a touch listener.
  document.addEventListener('touchstart', function () {}, { passive: true });

  /* --------------------------------------------------------- Navigation */
  var nav = document.querySelector('[data-nav]');
  var bar = nav.querySelector('.nav-bar');

  // Scroll-edge hairline appears only once content passes under the bar.
  var sentinel = document.querySelector('[data-top-sentinel]');
  new IntersectionObserver(function (entries) {
    nav.classList.toggle('is-scrolled', !entries[0].isIntersecting);
  }).observe(sentinel);

  /* Active-section indicator: a pill whose position and width are two
     independent critically damped springs. Retargeting mid-flight keeps
     velocity, so fast scrolling across sections never stutters. */
  var linksWrap = nav.querySelector('[data-nav-links]');
  var links = Array.prototype.slice.call(nav.querySelectorAll('[data-nav-link]'));
  var indicator = nav.querySelector('[data-nav-indicator]');
  var current = null;

  var xSpring = new Spring({
    dampingRatio: 1, response: 0.36, precision: 0.1,
    onUpdate: function (v) { indicator.style.transform = 'translateX(' + v.toFixed(2) + 'px)'; }
  });
  var wSpring = new Spring({
    dampingRatio: 1, response: 0.36, precision: 0.1,
    onUpdate: function (v) { indicator.style.width = v.toFixed(2) + 'px'; }
  });

  function linkFor(id) {
    for (var i = 0; i < links.length; i++) if (links[i].hash === '#' + id) return links[i];
    return null;
  }

  function placeIndicator(link, animate) {
    if (!link || !link.offsetWidth) {
      indicator.classList.remove('is-visible');
      return;
    }
    var appearing = !indicator.classList.contains('is-visible');
    if (animate && !appearing) {
      xSpring.to(link.offsetLeft);
      wSpring.to(link.offsetWidth);
    } else {
      // Appear in place rather than sliding in from a stale position.
      xSpring.jump(link.offsetLeft);
      wSpring.jump(link.offsetWidth);
    }
    indicator.classList.add('is-visible');
  }

  function setActive(id) {
    if (id === current) return;
    current = id;
    var link = id ? linkFor(id) : null;
    links.forEach(function (l) {
      if (l === link) l.setAttribute('aria-current', 'location');
      else l.removeAttribute('aria-current');
    });
    placeIndicator(link, true);
  }

  var sections = Array.prototype.slice.call(document.querySelectorAll('[data-spy]'));
  var inBand = new Set();
  var footerVisible = false;

  function updateActive() {
    if (footerVisible) return setActive('contact');
    for (var i = 0; i < sections.length; i++) {
      if (inBand.has(sections[i])) return setActive(sections[i].dataset.spy);
    }
    setActive(null);
  }

  // The "band" runs from just under the bar to 45% down the viewport.
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) inBand.add(e.target);
      else inBand.delete(e.target);
    });
    updateActive();
  }, { rootMargin: '-' + Math.round(bar.offsetHeight) + 'px 0px -55% 0px' });
  sections.forEach(function (s) { spy.observe(s); });

  new IntersectionObserver(function (entries) {
    footerVisible = entries[0].isIntersecting;
    updateActive();
  }).observe(document.querySelector('.footer'));

  new ResizeObserver(function () {
    placeIndicator(current ? linkFor(current) : null, false);
  }).observe(linksWrap);

  /* ------------------------------------------------------- Mobile menu */
  var menuButton = nav.querySelector('[data-menu-button]');
  var sheet = nav.querySelector('[data-menu-sheet]');
  var main = document.querySelector('main');
  var footer = document.querySelector('.footer');

  function setMenu(open) {
    if (nav.classList.contains('is-open') === open) return;
    nav.classList.toggle('is-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    sheet.inert = !open;
    main.inert = open;      // the sheet covers the page; keep focus inside it
    footer.inert = open;
    root.classList.toggle('is-locked', open);
  }

  menuButton.addEventListener('click', function () {
    setMenu(!nav.classList.contains('is-open'));
  });
  // Close first, then travel: scrolling only after the page is unlocked keeps
  // the jump reliable instead of racing the scroll lock.
  sheet.addEventListener('click', function (e) {
    var link = e.target.closest('a');
    if (!link) return;
    setMenu(false);

    var hash = link.getAttribute('href');
    var target = hash.charAt(0) === '#' ? document.querySelector(hash) : null;
    if (!target) return; // e.g. the résumé download keeps its default behaviour

    e.preventDefault();
    history.pushState(null, '', hash);
    target.scrollIntoView({ behavior: Spring.reducedMotion() ? 'auto' : 'smooth' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      menuButton.focus();
    }
  });
  window.matchMedia('(min-width: 48rem)').addEventListener('change', function (e) {
    if (e.matches) setMenu(false);
  });

  /* ------------------------------------------------------------ Reveal */
  // Siblings in a group arrive in a short cascade, capped so nothing waits long.
  document.querySelectorAll('[data-reveal-group]').forEach(function (group) {
    var items = group.querySelectorAll(':scope > [data-reveal]');
    items.forEach(function (el, i) {
      el.style.setProperty('--reveal-delay', Math.min(i * 70, 350) + 'ms');
    });
  });

  var revealer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-visible');
      revealer.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -6% 0px' });
  document.querySelectorAll('[data-reveal]').forEach(function (el) { revealer.observe(el); });

  /* --------------------------------------------------------- Copy email */
  var announcer = document.querySelector('[data-announcer]');

  function legacyCopy(text) {
    var field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
    field.remove();
    return ok;
  }

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    var label = button.querySelector('[data-copy-label]');
    var original = label.textContent;
    var timer = 0;

    // Lock the width so the label swap doesn't make the row jump.
    button.style.minWidth = button.offsetWidth + 'px';

    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy');
      var write = navigator.clipboard && window.isSecureContext
        ? navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); })
        : Promise.resolve(legacyCopy(text));

      write.then(function (ok) {
        if (!ok) { window.location.href = 'mailto:' + text; return; }
        button.classList.add('is-copied');
        label.textContent = 'Copied';
        announcer.textContent = '';
        announcer.textContent = 'Email address copied to clipboard';
        clearTimeout(timer);
        timer = setTimeout(function () {
          button.classList.remove('is-copied');
          label.textContent = original;
        }, 2000);
      });
    });
  });

  /* ------------------------------------------------------------- Maze */
  if (window.MazeDemo) {
    document.querySelectorAll('[data-maze]').forEach(function (el) { new MazeDemo(el); });
  }

  /* ----------------------------------------------------------- Footer */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
