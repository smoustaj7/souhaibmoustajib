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
  var jumping = false; // an in-page link is scrolling the page (see below)

  function updateActive() {
    // During a link jump the destination is already marked; don't flicker through sections passed on the way.
    if (jumping) return;
    if (footerVisible) return setActive('contact');
    // The lowest section in the band wins: a link lands its section just below
    // the bar, which leaves the previous section's last few pixels in the band too.
    for (var i = sections.length - 1; i >= 0; i--) {
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
  // Close first, then travel: this runs before the in-page link handler below,
  // so the page is unlocked before it starts scrolling.
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
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

  /* ---------------------------------------------------- In-page links */
  /* Native smooth scrolling takes a different, often long, time per browser
     and distance, and a focus change can cut it short. A critically damped
     spring arrives in the same short time from anywhere, retargets mid-flight
     without losing velocity, and hands control back the moment the reader
     scrolls on their own. */
  var scrollSpring = new Spring({
    dampingRatio: 1, response: 0.4, precision: 0.5,
    onUpdate: function (v) { window.scrollTo(0, v); },
    onRest: endJump
  });

  function endJump() {
    if (!jumping) return;
    jumping = false;
    updateActive();
  }

  function cancelJump() {
    if (!jumping) return;
    scrollSpring.stop();
    endJump();
  }

  function jumpTo(target) {
    var pad = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    var max = root.scrollHeight - window.innerHeight;
    var top = Math.max(0, Math.min(max, target.getBoundingClientRect().top + window.scrollY - pad));

    // Answer the press at once: mark the destination and show its content now.
    setActive(target.dataset.spy || null);
    revealWithin(target);

    if (Spring.reducedMotion()) {
      window.scrollTo(0, top);
      return;
    }
    if (!jumping) {
      // Start from where the page actually is, at rest. Mid-flight, the spring keeps its velocity.
      scrollSpring.value = scrollSpring.target = window.scrollY;
      scrollSpring.velocity = 0;
    }
    jumping = true;
    scrollSpring.to(top);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target.closest('a[href^="#"]');
    if (!link || link.classList.contains('skip-link')) return; // the skip link stays an instant jump
    var hash = link.getAttribute('href');
    var target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
    if (!target) return;

    e.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    jumpTo(target);
    // Move the reading position the way a native fragment jump would.
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  // Scrolling of the reader's own takes over immediately.
  ['wheel', 'touchstart', 'keydown'].forEach(function (type) {
    window.addEventListener(type, cancelJump, { passive: true });
  });
  // A press on the page scrollbar arrives with the root element as its target.
  window.addEventListener('mousedown', function (e) {
    if (e.target === root) cancelJump();
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

  // A link jump shows its destination straight away, without the cascade.
  function revealWithin(scope) {
    scope.querySelectorAll('[data-reveal]:not(.is-visible)').forEach(function (el) {
      el.style.setProperty('--reveal-delay', '0ms');
      el.classList.add('is-visible');
      revealer.unobserve(el);
    });
  }

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
