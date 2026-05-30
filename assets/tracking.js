/* flowtongshu — unified tracking library
 *
 * Fetches public IDs from /api/config (Cloudflare env vars), then loads
 * Meta Pixel, Google Ads gtag, TikTok Pixel. Generates a single event_id
 * per event and dual-sends to /api/track for server-side CAPI
 * (Meta CAPI + Google Enhanced + TikTok Events API).
 *
 * Usage from page code:
 *   FTS.track('PageView');
 *   FTS.track('Lead', { content_name: 'trial' });
 *   FTS.track('InitiateCheckout', { plan: 'pro' });
 *
 * Events fired before config arrives are queued and flushed once config
 * is ready. Captures fbclid/gclid/ttclid from the URL on first load and
 * stores them in a 1st-party cookie scoped to .flowtongshu.com so the
 * app subdomain can read the same attribution.
 */
(function () {
  'use strict';

  var DEBUG = location.hostname === 'localhost' || /[?&]debug_track/i.test(location.search);
  var CFG = null;                  // loaded from /api/config
  var eventQueue = [];             // events fired before CFG ready

  // ── Click ID cookie (90-day, apex-scoped) ───────────────────────────────
  var CLICK_COOKIE = 'fts_clk';
  function cookieDomain() {
    var h = location.hostname;
    if (h === 'flowtongshu.com' || h.endsWith('.flowtongshu.com')) return '; domain=.flowtongshu.com';
    return '';
  }
  function setCookie(name, val, days) {
    var d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' + cookieDomain();
  }
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function captureClickIds() {
    var p = new URLSearchParams(location.search);
    var existing = {};
    try { existing = JSON.parse(getCookie(CLICK_COOKIE) || '{}'); } catch (_) {}
    var changed = false;
    ['fbclid', 'gclid', 'ttclid'].forEach(function (k) {
      var v = p.get(k);
      if (v && !existing[k]) { existing[k] = v; changed = true; }
    });
    if (!existing.first_seen) { existing.first_seen = Date.now(); changed = true; }
    if (changed) setCookie(CLICK_COOKIE, JSON.stringify(existing), 90);
    return existing;
  }
  var CLICK_IDS = captureClickIds();

  function buildFbc() {
    if (!CLICK_IDS.fbclid) return '';
    var ts = CLICK_IDS.first_seen || Date.now();
    return 'fb.1.' + ts + '.' + CLICK_IDS.fbclid;
  }

  // ── Event ID — UUIDv4 ───────────────────────────────────────────────────
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ── Pixel loaders ───────────────────────────────────────────────────────
  function loadMetaPixel(id) {
    if (!id || window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', id);
  }
  function loadGtag(adsId) {
    if (!adsId || window.gtag) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(adsId);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', adsId, { allow_enhanced_conversions: true });
  }
  function loadTikTokPixel(code) {
    if (!code || window.ttq) return;
    !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(e);ttq.page()}(window,document,'ttq');
    window.ttq.load(code);
  }

  function loadAllPixels(cfg) {
    if (cfg.meta && cfg.meta.pixelId) loadMetaPixel(cfg.meta.pixelId);
    if (cfg.google && cfg.google.adsId) loadGtag(cfg.google.adsId);
    if (cfg.tiktok && cfg.tiktok.pixelCode) loadTikTokPixel(cfg.tiktok.pixelCode);
  }

  // ── Config fetch + queue flush ─────────────────────────────────────────
  function applyConfig(cfg) {
    CFG = cfg || {};
    window.FTS_TRACKING = CFG;
    loadAllPixels(CFG);
    decorateCrossDomainLinks();
    // Flush queued events
    var q = eventQueue.splice(0);
    q.forEach(function (e) { doTrack(e.name, e.params, e.user, e.eid); });
  }

  function loadConfig() {
    fetch('/api/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(applyConfig)
      .catch(function (e) {
        if (DEBUG) console.warn('[FTS] /api/config failed', e);
        // Still try to flush — pixels won't load, but server-side /api/track still works
        applyConfig({});
      });
  }

  // ── track() — the public API ────────────────────────────────────────────
  function track(eventName, params, userData) {
    var eid = uuid();
    if (!CFG) {
      eventQueue.push({ name: eventName, params: params, user: userData, eid: eid });
      return eid;
    }
    doTrack(eventName, params || {}, userData || {}, eid);
    return eid;
  }

  function doTrack(eventName, params, userData, eid) {
    // Meta
    if (window.fbq && CFG.meta && CFG.meta.pixelId) {
      var opts = { eventID: eid };
      if (CFG.meta.testEventCode) opts.testEventCode = CFG.meta.testEventCode;
      window.fbq('track', eventName, params, opts);
    }

    // Google — only for conversion events
    if (window.gtag && CFG.google && CFG.google.adsId && CFG.google.conversionLabel) {
      var conversionEvents = { Lead: true, CompleteRegistration: true, Purchase: true, StartTrial: true };
      if (conversionEvents[eventName]) {
        window.gtag('event', 'conversion', {
          send_to: CFG.google.adsId + '/' + CFG.google.conversionLabel,
          transaction_id: eid
        });
      }
    }

    // TikTok — translate canonical names
    if (window.ttq && CFG.tiktok && CFG.tiktok.pixelCode) {
      var ttMap = { Lead: 'SubmitForm', CompleteRegistration: 'CompleteRegistration', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment', ViewContent: 'ViewContent', PageView: 'Pageview' };
      var ttEvent = ttMap[eventName] || eventName;
      window.ttq.track(ttEvent, params, { event_id: eid });
    }

    // Server-side dual-send
    var payload = {
      event_name: eventName,
      event_id: eid,
      event_time: Math.floor(Date.now() / 1000),
      url: location.href,
      referrer: document.referrer,
      params: params,
      user: userData,
      click_ids: CLICK_IDS,
      fbc: buildFbc(),
      fbp: getCookie('_fbp'),
      ttp: getCookie('_ttp')
    };
    var body = JSON.stringify(payload);
    var sent = false;
    if (navigator.sendBeacon) {
      try { sent = navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' })); } catch (_) {}
    }
    if (!sent) {
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
        .catch(function () { /* swallow */ });
    }

    if (DEBUG) console.log('[FTS.track]', eventName, eid, payload);
  }

  // ── Cross-domain CTA helper ─────────────────────────────────────────────
  function decorateCrossDomainLinks() {
    var app = (CFG && CFG.appDomain) || 'app.flowtongshu.com';
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.indexOf(app) === -1) return;
      a.addEventListener('click', function () {
        try {
          var u = new URL(a.href);
          ['fbclid', 'gclid', 'ttclid'].forEach(function (k) {
            if (CLICK_IDS[k] && !u.searchParams.has(k)) u.searchParams.set(k, CLICK_IDS[k]);
          });
          if (!u.searchParams.has('fts_eid')) u.searchParams.set('fts_eid', uuid());
          a.href = u.toString();
        } catch (_) {}
      });
    });
  }

  // Expose
  window.FTS = {
    track: track,
    clickIds: CLICK_IDS,
    get cfg() { return CFG; },
    reloadConfig: loadConfig
  };

  // Kick off
  loadConfig();
})();
