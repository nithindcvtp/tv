/* S1 IPTV - web edition, phone remote side.
   Replaces the old "talk to the PC's Python host" requests with messages to the TV page, over a
   direct peer link paired by the TV's private code (from the QR code). */
(function () {
  'use strict';
  var realFetch = window.fetch.bind(window);
  var PEER_PREFIX = 's1iptv-';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }

  var code = (location.hash || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (code) store('s1_remote_code', code); else code = store('s1_remote_code') || '';
  if (code && location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }  /* keep the code out of the address bar */

  var peer = null, conn = null, connected = false, waiters = [], pending = {}, seq = 0, attempt = 0, timer = 0;

  /* ---------- UI: same-network notice + status ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#s1bar{position:fixed;left:0;right:0;top:0;z-index:60;display:flex;gap:8px;align-items:center;justify-content:center;padding:max(6px,env(safe-area-inset-top)) 12px 6px;background:#1b2740;color:#cfe0ff;font:600 12px system-ui,Arial;text-align:center}' +
    '#s1bar button{background:none;border:0;color:#9fb4e8;font-size:16px;padding:0 4px}' +
    '#s1ov{position:fixed;inset:0;z-index:70;background:#0a0d14ee;display:none;align-items:center;justify-content:center;padding:22px;text-align:center}' +
    '#s1ov .card{max-width:330px;background:#1e2331;border:1px solid #2c3448;border-radius:22px;padding:24px 20px;box-shadow:0 18px 50px #000a}' +
    '#s1ov h2{margin:6px 0 10px;font:800 19px system-ui,Arial}#s1ov p{margin:8px 0;color:#b8c2dd;font:14px/1.5 system-ui,Arial}' +
    '#s1ov .ico{font-size:40px}#s1ov .wifi{background:#0c1a14;border:1px solid #22382c;color:#9fe8c0;border-radius:12px;padding:10px;font-weight:700}' +
    '#s1ov button,#s1ov input{font:700 15px system-ui,Arial;border-radius:12px;border:1px solid #3a4360;padding:12px 16px;margin-top:10px;width:100%}' +
    '#s1ov button{background:#1769ff;color:#fff;border:0;cursor:pointer}#s1ov button.alt{background:#272d3f;border:1px solid #3a4360;color:#e8edf8}' +
    '#s1ov input{background:#0f131d;color:#fff;text-align:center;letter-spacing:.2em;text-transform:uppercase;-webkit-user-select:text;user-select:text}' +
    'body{padding-top:44px!important}';
  document.head.appendChild(css);

  var bar, ov, barTxt;
  function ui() {
    bar = document.createElement('div'); bar.id = 's1bar';
    bar.innerHTML = '<span>\uD83D\uDCF6 Your phone must be on the <u>same Wi\u2011Fi</u> as the TV</span><span id="s1bt"></span><button id="s1bx" aria-label="Hide">\u00D7</button>';
    document.body.appendChild(bar); barTxt = bar.querySelector('#s1bt');
    bar.querySelector('#s1bx').onclick = function () { bar.style.display = 'none'; };
    ov = document.createElement('div'); ov.id = 's1ov'; document.body.appendChild(ov);
  }
  function overlay(html) { ov.innerHTML = '<div class="card">' + html + '</div>'; ov.style.display = 'flex'; }
  function hideOverlay() { ov.style.display = 'none'; }
  var SAME = '<div class="wifi">\uD83D\uDCF6 To control the TV you must be on the same Wi\u2011Fi network as the TV (not mobile data, not a guest network).</div>';

  function showAsk(err) {
    overlay('<div class="ico">\uD83D\uDCFA</div><h2>Enter the TV code</h2>' + SAME +
      '<p>Scan the QR code on the TV screen, or type the code shown under it.</p>' + (err ? '<p style="color:#ff9a9a">' + err + '</p>' : '') +
      '<input id="s1code" maxlength="9" placeholder="XXXX-XXXX" autocomplete="off"><button id="s1go">CONNECT</button>');
    ov.querySelector('#s1go').onclick = function () {
      var c = ov.querySelector('#s1code').value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (c.length !== 8) { showAsk('The code has 8 characters.'); return; }
      code = c; store('s1_remote_code', code); attempt = 0; connect();
    };
  }
  function showConnecting() {
    overlay('<div class="ico">\uD83D\uDCF6</div><h2>Connecting to the TV\u2026</h2>' + SAME + '<p>Make sure the TV page is open and showing the QR code.</p>');
  }
  function showWrongNet() {
    overlay('<div class="ico">\u26A0\uFE0F</div><h2>Not on the same network</h2>' + SAME +
      '<p>This phone and the TV are on different networks. Connect your phone to the TV\u2019s Wi\u2011Fi, turn off mobile data / VPN, then try again.</p>' +
      '<button id="s1re">TRY AGAIN</button><button class="alt" id="s1nc">USE A DIFFERENT CODE</button>');
    ov.querySelector('#s1re').onclick = function () { attempt = 0; connect(); };
    ov.querySelector('#s1nc').onclick = function () { showAsk(); };
  }
  function showNoTv() {
    overlay('<div class="ico">\uD83D\uDCFA</div><h2>Can\u2019t find the TV</h2>' + SAME +
      '<p>Check that the TV page is open (code <b>' + code.slice(0, 4) + '-' + code.slice(4) + '</b>) and that this phone is on the same Wi\u2011Fi.</p>' +
      '<button id="s1re">TRY AGAIN</button><button class="alt" id="s1nc">ENTER A NEW CODE</button>');
    ov.querySelector('#s1re').onclick = function () { attempt = 0; connect(); };
    ov.querySelector('#s1nc').onclick = function () { showAsk(); };
  }
  function setBar(t) { if (barTxt) barTxt.textContent = t; }

  /* ---------- same network check ---------- */
  function publicIp() {
    return Promise.race([
      realFetch('https://api.ipify.org?format=json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return String(d.ip || ''); }),
      new Promise(function (res) { setTimeout(function () { res(''); }, 4000); })
    ]).catch(function () { return ''; });
  }

  /* ---------- link ---------- */
  function setConnected(on) {
    connected = on;
    var led = document.getElementById('led'); if (led) led.classList.toggle('on', on);
    setBar(on ? '\u25CF connected' : '');
    if (on) { var w = waiters; waiters = []; w.forEach(function (f) { f(); }); }
  }
  function fail(reason) {
    setConnected(false); clearTimeout(timer);
    try { if (peer) peer.destroy(); } catch (e) {}
    if (reason === 'network') showWrongNet(); else showNoTv();
  }
  function connect() {
    if (!code) { showAsk(); return; }
    clearTimeout(timer); showConnecting(); setConnected(false);
    try { if (peer) peer.destroy(); } catch (e) {}
    if (!window.Peer) { overlay('<div class="ico">\u26A0\uFE0F</div><h2>Needs internet</h2><p>The link library could not be loaded.</p><button onclick="location.reload()">RELOAD</button>'); return; }
    var myAttempt = ++attempt, ipP = publicIp();
    peer = new Peer({ debug: 0 });
    timer = setTimeout(function () { if (!connected) fail('notv'); }, 15000);
    peer.on('open', function () {
      conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      conn.on('open', function () { ipP.then(function (ip) { conn.send({ t: 'hello', ip: ip }); }); });
      conn.on('data', onData);
      conn.on('close', function () { if (connected) { setConnected(false); showConnecting(); setTimeout(function () { if (!connected && myAttempt === attempt) connect(); }, 1500); } });
      conn.on('error', function () {});
    });
    peer.on('error', function (err) {
      if (err && err.type === 'peer-unavailable') return fail('notv');
      if (!connected) fail('notv');
    });
    peer.on('disconnected', function () { try { peer.reconnect(); } catch (e) {} });
  }
  function onData(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'reject') return fail(m.reason === 'network' ? 'network' : 'notv');
    if (m.t === 'welcome') {
      clearTimeout(timer); hideOverlay(); setConnected(true);
      if (typeof window.loadChannels === 'function') window.loadChannels();
      if (typeof window.poll === 'function') window.poll();
      return;
    }
    if (m.t === 'res' && pending[m.id]) { var p = pending[m.id]; delete pending[m.id]; clearTimeout(p.t); p.ok(m); }
  }

  /* ---------- the page's own fetch('/api/...') calls now go to the TV ---------- */
  function rpc(method, path, body) {
    return new Promise(function (resolve, reject) {
      var send = function () {
        var id = ++seq, t = setTimeout(function () { delete pending[id]; reject(new Error('timeout')); }, 6000);
        pending[id] = { t: t, ok: resolve };
        try { conn.send({ t: 'rpc', id: id, method: method, path: path, body: body }); } catch (e) { clearTimeout(t); delete pending[id]; reject(e); }
      };
      if (connected) return send();
      waiters.push(send); setTimeout(function () { var i = waiters.indexOf(send); if (i >= 0) { waiters.splice(i, 1); reject(new Error('offline')); } }, 8000);
    });
  }
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u.indexOf('/api/') !== 0) return realFetch(input, init);
    var method = ((init && init.method) || 'GET').toUpperCase(), body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch (e) {}
    return rpc(method, u, body).then(function (m) { return new Response(JSON.stringify(m.data), { status: m.status, headers: { 'Content-Type': 'application/json' } }); });
  };

  function ready() { ui(); connect(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
