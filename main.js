/* =========================================================================
   Forno Ember — main.js
   Vanilla ES2018+. No dependencies. Leaflet is optional (graceful fallback).
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* =======================================================================
     Header: stuck state + scrollspy
     ======================================================================= */
  function initHeader() {
    var header = $('[data-header]');
    if (!header) return;

    var lastY = -1;
    function onScroll() {
      var y = window.scrollY || window.pageYOffset;
      if (y === lastY) return;
      lastY = y;
      header.classList.toggle('is-stuck', y > 40);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // scrollspy
    var links = $$('[data-navlink][href^="#"]');
    var map = {};
    var sections = [];
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      var sec = document.getElementById(id);
      if (!sec) return;
      if (!map[id]) map[id] = [];
      map[id].push(a);
      if (sections.indexOf(sec) === -1) sections.push(sec);
    });

    if (!sections.length || !('IntersectionObserver' in window)) return;

    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        visible[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0;
      });
      var bestId = null, best = 0;
      sections.forEach(function (sec) {
        var v = visible[sec.id] || 0;
        if (v > best) { best = v; bestId = sec.id; }
      });
      links.forEach(function (a) { a.classList.remove('is-active'); });
      if (bestId && map[bestId]) {
        map[bestId].forEach(function (a) { a.classList.add('is-active'); });
      }
    }, { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });

    sections.forEach(function (s) { io.observe(s); });
  }

  /* =======================================================================
     Mobile drawer (focus trap + escape + scroll lock)
     ======================================================================= */
  function initDrawer() {
    var toggle = $('[data-nav-toggle]');
    var drawer = $('[data-drawer]');
    if (!toggle || !drawer) return;

    var panel   = $('.drawer-panel', drawer);
    var scrim   = $('[data-drawer-scrim]', drawer);
    var closeBt = $('[data-drawer-close]', drawer);
    var lastFocus = null;

    function focusables() {
      return $$('a[href], button:not([disabled])', panel)
        .filter(function (el) { return el.offsetParent !== null; });
    }

    function open() {
      lastFocus = document.activeElement;
      drawer.hidden = false;
      document.body.classList.add('is-locked');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      requestAnimationFrame(function () { drawer.classList.add('is-open'); });
      var f = focusables();
      if (f.length) f[0].focus();
    }

    function close() {
      drawer.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      document.body.classList.remove('is-locked');
      window.setTimeout(function () {
        drawer.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }, reduceMotion ? 0 : 420);
    }

    function onKey(e) {
      if (drawer.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    toggle.addEventListener('click', function () {
      drawer.hidden ? open() : close();
    });
    if (scrim) scrim.addEventListener('click', close);
    if (closeBt) closeBt.addEventListener('click', close);
    document.addEventListener('keydown', onKey);

    $$('a', panel).forEach(function (a) {
      a.addEventListener('click', function () { if (!drawer.hidden) close(); });
    });

    // close when resizing up to desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 1024 && !drawer.hidden) close();
    });
  }

  /* =======================================================================
     Menu tabs (ARIA tablist with arrow-key roving focus)
     ======================================================================= */
  function initTabs() {
    var root = $('[data-tabs]');
    if (!root) return;

    var tabs = $$('[role="tab"]', root);

    function select(tab, setFocus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (setFocus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = tabs[(i + 1) % tabs.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') next = tabs[0];
        else if (e.key === 'End') next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
  }

  /* =======================================================================
     Reservation
     Client-side only — no network request is made. To wire up a real
     backend, replace the body of submitBooking() with a fetch() call.
     ======================================================================= */
  function initReservation() {
    var form = $('[data-res-form]');
    if (!form) return;

    var confirmPanel = $('[data-confirm]');
    var summary      = $('[data-error-summary]');
    var errorList    = $('[data-error-list]');
    var submitBtn    = $('[data-submit]');
    var resetBtn     = $('[data-reset-form]');
    var notes        = $('#r-notes');
    var charCount    = $('[data-char-count]');

    var CLOSED_DAY = 1;            // Monday
    var MAX_BOOK_AHEAD = 90;       // days
    var MAX_PARTY = 12;
    var MAX_NOTES = 400;
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
    var PHONE_RE = /^[+()\d][\d\s().-]{6,}$/;

    /* ---- date/time options ---- */
    var dateInput = $('#r-date');
    var timeInput = $('#r-time');
    var partyInput = $('#r-party');

    function toISO(d) {
      return d.getFullYear() + '-' +
             ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
             ('0' + d.getDate()).slice(-2);
    }
    function fromISO(s) {
      var p = s.split('-');
      return new Date(+p[0], +p[1] - 1, +p[2]);
    }

    function windowFor(day) {
      // [startMinutes, endMinutes, lastSeating]
      if (day === 0) return [16 * 60, 21 * 60, 19 * 60];        // Sunday
      if (day === 5 || day === 6) return [17 * 60, 23 * 60, 21 * 60]; // Fri/Sat
      return [17 * 60, 22 * 60, 20 * 60];                       // Tue-Thu
    }

    function buildTimeSlots(day) {
      var w = windowFor(day);
      var slots = [];
      for (var m = w[0]; m <= w[2]; m += 30) {
        var h = Math.floor(m / 60), mm = m % 60;
        var suffix = h >= 12 ? 'pm' : 'am';
        var h12 = h % 12 === 0 ? 12 : h % 12;
        slots.push({ value: ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2),
                     label: h12 + ':' + ('0' + mm).slice(-2) + suffix });
      }
      return slots;
    }

    function refreshTimes() {
      var val = dateInput.value;
      timeInput.innerHTML = '<option value="">Choose a seating</option>';
      if (!val) { timeInput.disabled = true; return; }
      var day = fromISO(val).getDay();
      if (day === CLOSED_DAY) { timeInput.disabled = true; return; }
      timeInput.disabled = false;
      buildTimeSlots(day).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s.value; o.textContent = s.label;
        timeInput.appendChild(o);
      });
    }

    var today = new Date();
    dateInput.min = toISO(today);
    var maxDate = new Date(today.getTime() + MAX_BOOK_AHEAD * 86400000);
    dateInput.max = toISO(maxDate);
    timeInput.disabled = true;
    refreshTimes();

    /* ---- field error plumbing ---- */
    function fieldOf(input) { return input.closest('.field'); }

    function setError(input, message) {
      var wrap = fieldOf(input);
      if (!wrap) return;
      var slot = document.getElementById('e-' + input.id.replace(/^r-/, ''));
      wrap.classList.add('has-error');
      input.setAttribute('aria-invalid', 'true');
      if (slot) slot.textContent = message;
    }

    function clearError(input) {
      var wrap = fieldOf(input);
      if (!wrap) return;
      var slot = document.getElementById('e-' + input.id.replace(/^r-/, ''));
      wrap.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
      if (slot) slot.textContent = '';
    }

    var validators = {
      date: function (v) {
        if (!v) return 'Choose a date.';
        var d = fromISO(v);
        var t = new Date(); t.setHours(0, 0, 0, 0);
        if (d < t) return 'That date has already passed.';
        if (d.getDay() === CLOSED_DAY) return "We're closed on Mondays — please pick another day.";
        return null;
      },
      time: function (v) {
        if (dateInput.value && fromISO(dateInput.value).getDay() === CLOSED_DAY) {
          return 'The kitchen is closed on Mondays.';
        }
        if (!v) return 'Choose a seating time.';
        return null;
      },
      party: function (v) {
        if (!v) return 'Tell us how many guests.';
        if (+v > MAX_PARTY) return 'For ' + v + ' guests or more, please call us on (555) 014-2266.';
        return null;
      },
      name: function (v) {
        if (!v.trim()) return 'Enter the name the table will be under.';
        if (v.trim().length < 2) return 'That name looks a little short.';
        return null;
      },
      email: function (v) {
        if (!v.trim()) return 'We need an email for the confirmation.';
        if (!EMAIL_RE.test(v.trim())) return 'That email address does not look right.';
        return null;
      },
      phone: function (v) {
        if (!v.trim()) return 'A phone number lets us reach you about the booking.';
        if (!PHONE_RE.test(v.trim())) return 'Use digits, spaces, brackets or + only.';
        return null;
      },
      notes: function (v) {
        if (v.length > MAX_NOTES) return 'Please keep this under ' + MAX_NOTES + ' characters.';
        return null;
      }
    };

    function validateOne(input) {
      var fn = validators[input.name];
      if (!fn) return true;
      var msg = fn(input.value);
      if (msg) { setError(input, msg); return false; }
      clearError(input);
      return true;
    }

    var fields = ['date', 'time', 'party', 'name', 'email', 'phone', 'notes']
      .map(function (n) { return form.elements[n]; })
      .filter(Boolean);

    fields.forEach(function (input) {
      // validate on blur, per UX guidance
      input.addEventListener('blur', function () { validateOne(input); });
      input.addEventListener('input', function () {
        if (fieldOf(input) && fieldOf(input).classList.contains('has-error')) validateOne(input);
      });
    });

    dateInput.addEventListener('change', function () {
      refreshTimes();
      // Re-validate immediately: picking a Monday silently disables the time
      // dropdown, so the guest needs to be told why without waiting for a blur.
      validateOne(dateInput);
      if (dateInput.value && fromISO(dateInput.value).getDay() !== CLOSED_DAY) {
        clearError(timeInput);
      }
    });

    // notes character counter
    if (notes && charCount) {
      var updateCount = function () {
        charCount.textContent = notes.value.length + ' / ' + MAX_NOTES;
      };
      notes.addEventListener('input', updateCount);
      updateCount();
    }

    /* ---- error summary ---- */
    function showSummary(errors) {
      if (!errors.length) { summary.hidden = true; return; }
      errorList.innerHTML = '';
      errors.forEach(function (e) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#' + e.input.id;
        a.textContent = e.message;
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          e.input.focus();
        });
        li.appendChild(a);
        errorList.appendChild(li);
      });
      summary.hidden = false;
      summary.focus();
    }

    /* ---- confirmation ---- */
    function bookingRef() {
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
      return 'FE-' + out;
    }

    function formatWhen(isoDate, hhmm) {
      var d = fromISO(isoDate);
      var h = +hhmm.slice(0, 2), m = hhmm.slice(3);
      var suffix = h >= 12 ? 'pm' : 'am';
      var h12 = h % 12 === 0 ? 12 : h % 12;
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) +
             ' at ' + h12 + ':' + m + ' ' + suffix;
    }

    function showConfirmation(data) {
      $('[data-confirm-name]').textContent  = data.name.split(' ')[0];
      $('[data-confirm-email]').textContent = data.email;
      $('[data-confirm-ref]').textContent   = data.ref;
      $('[data-confirm-when]').textContent  = formatWhen(data.date, data.time);
      $('[data-confirm-party]').textContent =
        data.party === '1' ? '1 guest' : data.party + ' guests';

      form.hidden = true;
      confirmPanel.hidden = false;
      confirmPanel.setAttribute('tabindex', '-1');
      confirmPanel.focus({ preventScroll: true });
      confirmPanel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }

    // Replace with a real fetch() when a backend exists.
    function submitBooking(payload) {
      return new Promise(function (resolve) {
        window.setTimeout(function () { resolve(payload); }, 700);
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitBtn.classList.contains('is-loading')) return;

      var errors = [];
      fields.forEach(function (input) {
        if (!validateOne(input)) {
          var slot = document.getElementById('e-' + input.id.replace(/^r-/, ''));
          errors.push({ input: input, message: slot ? slot.textContent : 'Check this field' });
        }
      });

      if (errors.length) { showSummary(errors); return; }
      summary.hidden = true;

      var payload = {
        ref: bookingRef(),
        date: dateInput.value,
        time: timeInput.value,
        party: partyInput.value,
        name:    form.elements['name'].value.trim(),
        email:   form.elements['email'].value.trim(),
        phone:   form.elements['phone'].value.trim(),
        occasion: form.elements['occasion'].value,
        notes: notes ? notes.value.trim() : ''
      };

      submitBtn.classList.add('is-loading');
      submitBtn.setAttribute('aria-busy', 'true');
      $('.btn-label', submitBtn).textContent = 'Confirming…';

      submitBooking(payload)
        .then(function (data) {
          submitBtn.classList.remove('is-loading');
          submitBtn.removeAttribute('aria-busy');
          $('.btn-label', submitBtn).textContent = 'Confirm reservation';
          showConfirmation(data);
        })
        .catch(function () {
          submitBtn.classList.remove('is-loading');
          submitBtn.removeAttribute('aria-busy');
          $('.btn-label', submitBtn).textContent = 'Confirm reservation';
          showSummary([{ input: form.elements['name'], message: 'Something went wrong on our end. Please try again, or call (555) 014-2266.' }]);
        });
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        form.reset();
        fields.forEach(clearError);
        summary.hidden = true;
        timeInput.disabled = true;
        refreshTimes();
        confirmPanel.hidden = true;
        form.hidden = false;
        form.elements['name'].focus();
        form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      });
    }
  }

  /* =======================================================================
     Scroll reveal
     ======================================================================= */
  function initReveal() {
    var items = $$('.reveal');
    if (!items.length) return;

    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* =======================================================================
     Leaflet map (optional — degrades to a styled fallback)
     ======================================================================= */
  function initMap() {
    var canvas   = $('[data-map]');
    var fallback = $('[data-map-fallback]');
    if (!canvas || !fallback) return;

    function showFallback() {
      // Hide visually but keep the canvas in flow, so .map-wrap retains its
      // height and the fallback panel + info card still have a box to fill.
      canvas.style.visibility = 'hidden';
      canvas.setAttribute('aria-hidden', 'true');
      fallback.hidden = false;
    }

    if (typeof window.L === 'undefined') { showFallback(); return; }

    // 14 Ember Lane, Old Quarter (fictional) — Riverton town centre
    var LAT = 44.0588, LNG = -123.0925;

    try {
      var map = window.L.map(canvas, {
        scrollWheelZoom: false,
        attributionControl: true
      }).setView([LAT, LNG], 16);

      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      var icon = window.L.divIcon({
        className: 'map-pin',
        html: '<span class="map-pin-dot"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -12]
      });

      window.L.marker([LAT, LNG], { icon: icon, title: 'Forno Ember', alt: 'Forno Ember restaurant location' })
        .addTo(map)
        .bindPopup('<strong>Forno Ember</strong><br>14 Ember Lane, Old Quarter');

      // enable wheel zoom only after the user clicks the map (avoid trapping page scroll)
      map.on('click', function () { map.scrollWheelZoom.enable(); });
      map.on('mouseout', function () { map.scrollWheelZoom.disable(); });

      // graceful degradation if tiles are blocked
      var tiles = $$('.leaflet-tile', canvas);
      var failed = 0;
      if (tiles.length) {
        tiles.forEach(function (t) {
          t.addEventListener('error', function () {
            failed++;
            if (failed >= 3) showFallback();
          });
        });
      }
    } catch (err) {
      showFallback();
    }
  }

  /* =======================================================================
     Boot
     ======================================================================= */
  function boot() {
    initHeader();
    initDrawer();
    initTabs();
    initReservation();
    initReveal();
    initMap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
