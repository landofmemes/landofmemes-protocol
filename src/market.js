/* Live market source. Reads only the market record of the register. */
(function () {
  var reg = JSON.parse(document.getElementById('register').textContent);
  var src = reg.records.market;
  var POLL = 60000, CAP = 60000, TIMEOUT = 12000, TOP = 10, CHUNK = 30;
  var listeners = [], timer = null, inflight = false, fails = 0;
  var state = { status: 'loading', items: [], hasData: false };

  function emit() { listeners.forEach(function (f) { f(state); }); }
  function setState(p) { for (var k in p) state[k] = p[k]; emit(); }

  function getJSON(url) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .finally(function () { clearTimeout(t); });
  }

  function num(v) { v = Number(v); return isFinite(v) ? v : null; }

  function pull() {
    return getJSON(src.boosts).then(function (list) {
      if (!Array.isArray(list)) throw new Error('shape');
      var seen = {}, addrs = [];
      list.forEach(function (e) {
        if (e && e.chainId === 'solana' && e.tokenAddress && !seen[e.tokenAddress]) { seen[e.tokenAddress] = 1; addrs.push(e.tokenAddress); }
      });
      if (!addrs.length) throw new Error('empty');
      var chunks = [];
      for (var i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
      return Promise.all(chunks.map(function (c) { return getJSON(src.pairs.replace('{addresses}', c.join(','))); }));
    }).then(function (parts) {
      var best = {};
      parts.forEach(function (arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (p) {
          if (!p || !p.baseToken || p.chainId !== 'solana') return;
          var a = p.baseToken.address, v = num(p.volume && p.volume.h24) || 0;
          if (!best[a] || v > best[a]._v) { p._v = v; best[a] = p; }
        });
      });
      var out = Object.keys(best).map(function (a) {
        var p = best[a];
        return {
          address: a,
          symbol: String(p.baseToken.symbol || '?'),
          name: String(p.baseToken.name || ''),
          image: p.info && typeof p.info.imageUrl === 'string' && /^https:\/\//.test(p.info.imageUrl) ? p.info.imageUrl : '',
          price: num(p.priceUsd),
          change: num(p.priceChange && p.priceChange.h24),
          volume: num(p.volume && p.volume.h24),
          liquidity: num(p.liquidity && p.liquidity.usd)
        };
      }).filter(function (x) { return x.volume !== null; });
      out.sort(function (a, b) { return b.volume - a.volume; });
      out = out.slice(0, TOP);
      if (!out.length) throw new Error('empty');
      return out;
    });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = null;
    if (document.hidden) return;
    timer = setTimeout(load, ms);
  }

  function load() {
    if (inflight) return;
    clearTimeout(timer); timer = null;
    inflight = true;
    pull().then(function (items) {
      fails = 0; inflight = false;
      setState({ status: 'live', items: items, hasData: true });
      schedule(POLL);
    }).catch(function () {
      fails++; inflight = false;
      setState({ status: 'error' });
      var wait = Math.min(CAP, 2000 * Math.pow(2, fails - 1));
      schedule(wait * (0.85 + Math.random() * 0.3));
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(timer); timer = null; }
    else load();
  });

  window.LOMMarket = {
    state: state,
    subscribe: function (f) { listeners.push(f); f(state); },
    start: load
  };
})();
