/* Presentation layer: motion, copy buttons, market rendering. */
(function () {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var noMotion = function () { return reduced.matches; };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* ---------- toast + copy ---------- */
  var toastEl = $('#toast'), toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }
  function copyText(t) {
    var legacy = function () { return legacyCopy(t); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(legacy);
    return legacy();
  }
  function legacyCopy(t) {
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea');
      ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-copy]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    var v = b.getAttribute('data-copy');
    copyText(v).then(function () {
      toast('Copied to clipboard');
      var flag = b.classList.contains('ca') ? 'data-copied' : 'data-ok';
      b.setAttribute(flag, 'true');
      var act = $('.ca-act', b); if (act) act.textContent = 'Copied';
      setTimeout(function () { b.removeAttribute(flag); if (act) act.textContent = 'Tap to copy'; }, 1400);
    }).catch(function () { toast('Copy blocked by the browser'); });
  });

  /* ---------- spring reveal (damped solver) ---------- */
  var K = 300, C = 22;
  function spring(node, delay) {
    var x = 0, v = 0, last = 0, started = false;
    function apply(p) {
      var o = clamp(p, 0, 1);
      node.style.opacity = o;
      node.style.transform = 'translateY(' + ((1 - p) * 28).toFixed(2) + 'px) scale(' + (0.98 + 0.02 * p).toFixed(4) + ')';
    }
    function step(t) {
      if (!started) { started = true; last = t; }
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      var n = Math.ceil(dt / (1 / 240)) || 1, h = dt / n;
      for (var i = 0; i < n; i++) { var a = -K * (x - 1) - C * v; v += a * h; x += v * h; }
      apply(x);
      if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) { node.style.opacity = ''; node.style.transform = 'none'; node.removeAttribute('data-reveal'); node.classList.add('revealed'); return; }
      requestAnimationFrame(step);
    }
    setTimeout(function () { requestAnimationFrame(step); }, delay);
  }
  function settle(node) { node.style.opacity = ''; node.style.transform = 'none'; node.removeAttribute('data-reveal'); }
  var io = new IntersectionObserver(function (entries) {
    var vis = entries.filter(function (e) { return e.isIntersecting; });
    vis.forEach(function (e, i) {
      io.unobserve(e.target);
      if (noMotion() || document.hidden) settle(e.target); else spring(e.target, i * 90);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach(function (n) { io.observe(n); });

  /* ---------- scroll progress + parallax ---------- */
  var prog = $('#progress'), hero = $('#hero');
  var layers = $$('[data-depth]');
  var px = 0, py = 0, tx = 0, ty = 0, sy = 0, ticking = false;
  function onScroll() { sy = window.scrollY; if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  function frame() {
    ticking = false;
    var max = document.documentElement.scrollHeight - innerHeight;
    prog.style.transform = 'scaleX(' + (max > 0 ? clamp(sy / max, 0, 1) : 0).toFixed(4) + ')';
    if (noMotion()) { layers.forEach(function (l) { l.style.translate = ''; }); return; }
    px += (tx - px) * 0.12; py += (ty - py) * 0.12;
    var s = clamp(sy, 0, 900);
    layers.forEach(function (l) {
      var d = parseFloat(l.getAttribute('data-depth'));
      l.style.translate = (px * d * 26).toFixed(2) + 'px ' + (py * d * 18 + s * d * 0.18).toFixed(2) + 'px';
    });
    if (Math.abs(tx - px) > 0.002 || Math.abs(ty - py) > 0.002) { ticking = true; requestAnimationFrame(frame); }
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  hero.addEventListener('pointermove', function (e) {
    var r = hero.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    onScroll();
  });
  hero.addEventListener('pointerleave', function () { tx = 0; ty = 0; onScroll(); });
  onScroll();

  /* ---------- spotlight ---------- */
  document.addEventListener('pointermove', function (e) {
    var t = e.target.closest && e.target.closest('[data-spot],.row[data-row]');
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- formatting ---------- */
  var DASH = '—';
  function usdCompact(v) {
    if (v == null) return DASH;
    return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  }
  function price(v) {
    if (v == null) return DASH;
    return '$' + v.toLocaleString('en-US', { maximumSignificantDigits: v >= 1 ? 6 : 4, maximumFractionDigits: 12 });
  }
  function pct(v) {
    if (v == null) return DASH;
    return (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + Math.abs(v).toFixed(2) + '%';
  }
  var FORMAT = { price: price, change: pct, volume: usdCompact, liquidity: usdCompact };

  /* ---------- count-up with flash ---------- */
  function tween(node, from, to, fmt, ms) {
    if (node._raf) cancelAnimationFrame(node._raf);
    if (noMotion() || document.hidden || from === to) { node.textContent = fmt(to); return; }
    var t0 = 0;
    (function tick(t) {
      if (!t0) t0 = t;
      var p = clamp((t - t0) / ms, 0, 1), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      node.textContent = fmt(from + (to - from) * e);
      if (p < 1) node._raf = requestAnimationFrame(tick);
    })(performance.now());
  }
  function setNum(span, key, val, first) {
    var old = span._v;
    span._v = val;
    var fmt = FORMAT[key];
    if (val == null) { span.textContent = DASH; return; }
    if (first || old == null) { tween(span, 0, val, fmt, 800); return; }
    if (old !== val) {
      tween(span, old, val, fmt, 700);
      if (!noMotion()) {
        var c = val > old ? 'flash-up' : 'flash-dn';
        span.classList.remove('flash-up', 'flash-dn'); void span.offsetWidth; span.classList.add(c);
      }
    }
  }

  /* ---------- letter tile / logo ---------- */
  function logo(item) {
    function letter() { var d = el('span', 'letter', (item.symbol || '?').charAt(0).toUpperCase()); return d; }
    if (!item.image) return letter();
    var img = el('img', 'tile-img');
    img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () { if (img.parentNode) img.replaceWith(letter()); });
    img.src = item.image;
    return img;
  }

  /* ---------- market view ---------- */
  var sortKey = 'volume', current = [], rowsEl = $('#rows'), prevSig = '';
  var SORT = {
    volume: function (a, b) { return (b.volume || 0) - (a.volume || 0); },
    change: function (a, b) { return (b.change == null ? -1e9 : b.change) - (a.change == null ? -1e9 : a.change); },
    liquidity: function (a, b) { return (b.liquidity || 0) - (a.liquidity || 0); }
  };
  var COPY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';

  function skeletonRows() {
    rowsEl.textContent = '';
    for (var i = 0; i < 10; i++) {
      var r = el('div', 'row'); r.setAttribute('role', 'row');
      var a = el('div', 'tok'); a.appendChild(el('span', 'sk tile-img'));
      var tt = el('div', 'tok-t'); tt.style.flex = '1'; var l1 = el('span', 'sk sk-line'); l1.style.width = '60%'; var l2 = el('span', 'sk sk-line'); l2.style.cssText = 'width:40%;margin-top:6px'; tt.appendChild(l1); tt.appendChild(l2); a.appendChild(tt);
      r.appendChild(a);
      ['', '', 'hide-s', 'hide-s'].forEach(function (c, k) { var s = el('span', 'sk sk-line ' + c); s.style.cssText = 'width:' + (k < 2 ? 70 : 60) + '%;justify-self:end'; r.appendChild(s); });
      r.appendChild(el('span'));
      rowsEl.appendChild(r);
    }
  }

  function buildRow(item, n) {
    var r = el('div', 'row fade-in'); r.setAttribute('role', 'row'); r.setAttribute('data-row', item.address); r.style.setProperty('--n', n);
    var tok = el('div', 'tok'); tok.setAttribute('role', 'cell'); tok.appendChild(logo(item));
    var t = el('div', 'tok-t'); t.appendChild(el('span', 'tok-s', item.symbol)); t.appendChild(el('span', 'tok-n', item.name || item.symbol)); tok.appendChild(t);
    r.appendChild(tok);
    [['price', ''], ['change', ''], ['volume', 'hide-s'], ['liquidity', 'hide-s']].forEach(function (p) {
      var c = el('div', 'num cell ' + p[1]); c.setAttribute('role', 'cell');
      var s = el('span'); s.setAttribute('data-k', p[0]); c.appendChild(s); r.appendChild(c);
    });
    var cell = el('div', ''); cell.setAttribute('role', 'cell'); cell.style.justifySelf = 'end';
    var b = el('button', 'copy'); b.type = 'button'; b.setAttribute('data-copy', item.address); b.setAttribute('aria-label', 'Copy address of ' + item.symbol); b.innerHTML = COPY_ICON;
    cell.appendChild(b); r.appendChild(cell);
    return r;
  }

  function paintRow(r, item, first) {
    ['price', 'change', 'volume', 'liquidity'].forEach(function (k) {
      var s = $('[data-k="' + k + '"]', r);
      setNum(s, k, item[k], first);
      if (k === 'change') { s.parentNode.classList.toggle('chg', true); s.parentNode.classList.toggle('up', item.change > 0); s.parentNode.classList.toggle('dn', item.change < 0); }
    });
  }

  function renderRows(items) {
    var sorted = items.slice().sort(SORT[sortKey]);
    var sig = sortKey + '|' + sorted.map(function (x) { return x.address; }).join(',');
    if (sig !== prevSig) {
      prevSig = sig; rowsEl.textContent = '';
      sorted.forEach(function (it, i) { var r = buildRow(it, i); rowsEl.appendChild(r); paintRow(r, it, true); });
    } else {
      sorted.forEach(function (it) { var r = $('[data-row="' + it.address + '"]', rowsEl); if (r) paintRow(r, it, false); });
    }
  }

  function sum(items, k) { return items.reduce(function (a, x) { return a + (x[k] || 0); }, 0); }
  function tile(id, val, fmt) {
    var n = $(id); var old = n._v; n._v = val;
    tween(n, old == null ? 0 : old, val, fmt, 900);
  }

  /* ticker */
  var tickEl = $('#ticker'), tickSig = '';
  function renderTicker(items) {
    var sig = items.map(function (x) { return x.address; }).join(',');
    if (sig !== tickSig) {
      tickSig = sig; tickEl.textContent = '';
      for (var pass = 0; pass < 2; pass++) items.forEach(function (it) {
        var s = el('span', 'tick'); s.setAttribute('data-addr', it.address);
        s.appendChild(el('b', '', it.symbol)); s.appendChild(el('span', 'tp')); s.appendChild(el('span', 'tc'));
        tickEl.appendChild(s);
      });
      tickEl.style.setProperty('--dur', (items.length * 4.5) + 's');
    }
    $$('.tick', tickEl).forEach(function (s) {
      var it = items.filter(function (x) { return x.address === s.getAttribute('data-addr'); })[0]; if (!it) return;
      $('.tp', s).textContent = price(it.price);
      var c = $('.tc', s); c.textContent = pct(it.change); c.className = 'tc ' + (it.change > 0 ? 'up' : it.change < 0 ? 'dn' : '');
    });
  }

  /* hero ring */
  var ring = $('#ring');
  var RN = 12;
  function buildRing() {
    for (var i = 0; i < RN; i++) {
      var c = el('div', 'rc'); c.style.setProperty('--i', i);
      var inn = el('div', 'rc-in');
      var top = el('div', 'rc-top'); top.appendChild(el('span', '', 'No. ' + String(i + 1).padStart(2, '0'))); top.appendChild(el('span', '', 'LOM'));
      var art = el('div', 'rc-art sk');
      inn.appendChild(top); inn.appendChild(art); inn.appendChild(el('div', 'rc-name sk sk-line')); inn.appendChild(el('div', 'rc-px', ' '));
      c.appendChild(inn); ring.appendChild(c);
    }
  }
  function fillRing(items) {
    $$('.rc', ring).forEach(function (c, i) {
      var it = items[i % items.length];
      var art = $('.rc-art', c), name = $('.rc-name', c);
      if (art.getAttribute('data-for') !== it.address) {
        art.setAttribute('data-for', it.address); art.classList.remove('sk'); art.textContent = '';
        var l = logo(it); if (l.tagName === 'IMG') { l.className = ''; } else { l.className = 'letter'; l.style.cssText = 'width:56px;height:56px;font-size:24px'; }
        art.appendChild(l);
      }
      name.classList.remove('sk', 'sk-line'); name.textContent = it.symbol;
      $('.rc-px', c).textContent = price(it.price);
    });
  }
  buildRing();
  var rot = 0, vel = 0, dragging = false, lastX = 0, wrap = $('#ringWrap'), hidden = false;
  wrap.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; vel = 0; wrap.classList.add('drag'); wrap.setPointerCapture(e.pointerId); });
  wrap.addEventListener('pointermove', function (e) { if (!dragging) return; var d = e.clientX - lastX; lastX = e.clientX; rot += d * 0.35; vel = d * 0.35; });
  function endDrag() { dragging = false; wrap.classList.remove('drag'); }
  wrap.addEventListener('pointerup', endDrag); wrap.addEventListener('pointercancel', endDrag);
  new IntersectionObserver(function (es) { hidden = !es[0].isIntersecting; }).observe(wrap);
  (function spin() {
    if (!hidden && !document.hidden) {
      if (!dragging) {
        if (!noMotion()) { rot += vel + 0.12; vel *= 0.94; if (Math.abs(vel) < 0.01) vel = 0; }
        else { rot += vel; vel *= 0.8; }
      }
      ring.style.setProperty('--rot', rot.toFixed(2) + 'deg');
    }
    requestAnimationFrame(spin);
  })();
  wrap.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') rot -= 30; if (e.key === 'ArrowRight') rot += 30; });

  /* tabs */
  var tabs = $$('.tabs button'), ink = $('.tab-ink');
  function placeInk() {
    var s = tabs.filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0];
    if (!s) return;
    ink.style.width = s.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + (s.offsetLeft) + 'px)';
  }
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      tabs.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      sortKey = b.getAttribute('data-sort'); placeInk();
      if (current.length) renderRows(current);
    });
  });
  addEventListener('resize', placeInk);
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(placeInk);
  placeInk();

  /* status + data subscription */
  var pill = $('#statusPill'), pillText = $('#statusText'), errEl = $('#marketErr');
  skeletonRows();
  LOMMarket.subscribe(function (s) {
    pill.setAttribute('data-state', s.status);
    pillText.textContent = s.status === 'live' ? 'On air' : s.status === 'error' ? 'Source down' : 'Connecting';
    pill.setAttribute('aria-label', s.status === 'live' ? 'Market data is flowing' : s.status === 'error' ? 'Market source did not answer' : 'Connecting to market data');
    errEl.hidden = s.status !== 'error';
    if (s.status === 'error' && !s.hasData) {
      $$('#tiles .tile-v').forEach(function (n) { n.textContent = DASH; });
    }
    if (s.hasData && s.status !== 'loading') {
      current = s.items;
      renderRows(current); renderTicker(current); fillRing(current);
      if (s.status === 'live') {
        tile('#tileCount', current.length, function (v) { return String(Math.round(v)); });
        tile('#tileVol', sum(current, 'volume'), usdCompact);
        tile('#tileLiq', sum(current, 'liquidity'), usdCompact);
      }
    }
  });
  LOMMarket.start();
})();
