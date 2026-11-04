/* S1 IPTV - web edition, TV side.
   The TV page is its own "host": it keeps the channel state, answers the phone remote's commands
   and shows the pairing QR code. The phone talks to it over a direct peer link (PeerJS) that is
   paired by a private random code, so several users can use the site at the same time. */
(function () {
  'use strict';
  var realFetch = window.fetch.bind(window);
  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var PEER_PREFIX = 's1iptv-';

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return null; }
  function newCode() { var a = new Uint32Array(8), s = ''; crypto.getRandomValues(a); for (var i = 0; i < 8; i++) s += ALPHA[a[i] % ALPHA.length]; return s; }
  var code = store('s1_tv_code'); if (!code || !/^[A-Z0-9]{8}$/.test(code)) { code = newCode(); store('s1_tv_code', code); }

  /* ---------- channel state (what iptv_host.py kept on the PC) ---------- */
  var state = { id: 0, name: '', url: '', index: 0, volume: 70, muted: false };
  var CHANNELS = [];
  var notice = { msg: '', at: 0, n: 0 };
  function say(msg) { notice.msg = msg; notice.at = Date.now() / 1000; notice.n++; }
  function getDefault() { try { var d = JSON.parse(store('s1_default') || 'null'); if (d && /^https?:\/\//.test(d.url || '')) return d; } catch (e) {} return { name: '', url: '' }; }
  function tune(n) {
    if (!CHANNELS.length) return;
    n = ((n - 1) % CHANNELS.length + CHANNELS.length) % CHANNELS.length + 1;
    var c = CHANNELS[n - 1];
    state.id++; state.index = n; state.name = c.name; state.url = c.url;
  }
  function applyDefault() {
    var d = getDefault(); if (!d.url) return;
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].url === d.url) { tune(i + 1); return; }
    state.id++; state.name = d.name || ''; state.url = d.url; state.index = 0;
  }
  var channelsReady = realFetch('channels_ml.json?ts=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { CHANNELS = d.filter(function (c) { return /^https?:\/\//.test(String(c.url || '')); }); })
    .catch(function () { CHANNELS = []; })
    .then(applyDefault);

  function snapshot() {
    var now = Date.now() / 1000, d = {}, k;
    for (k in state) d[k] = state[k];
    d.tv = true; d.yt = false; d.browse = false; d.browse_sel = 0; d.browse_list = [];
    d.notice = (now - notice.at) < 5 ? notice.msg : ''; d.notice_id = notice.n;
    /* recording / recordings playback / power / YouTube need the PC host: not available on the web version */
    d.rec_on = false; d.rec_secs = 0; d.rec_name = ''; d.rec_file = ''; d.rec_saved = ''; d.rec_error = '';
    d.play_file = ''; d.play_id = 0; d.play_seek = 0; d.play_toggle = 0; d.play_msg = ''; d.play_error = '';
    d.power_state = 'idle'; d.power_count = 0;
    return d;
  }

  function runCmd(cmd, value) {
    var n;
    switch (cmd) {
      case 'ch': n = parseInt(value, 10); if (isNaN(n)) return null; if (n >= 1 && n <= CHANNELS.length) tune(n); break;
      case 'ch_up': tune((state.index || 0) + 1); break;
      case 'ch_down': tune((state.index || 1) - 1); break;
      case 'vol_up': state.volume = Math.min(100, state.volume + 5); state.muted = false; break;
      case 'vol_down': state.volume = Math.max(0, state.volume - 5); break;
      case 'vol': n = parseInt(value, 10); if (isNaN(n)) return null; state.volume = Math.max(0, Math.min(100, n)); break;
      case 'mute': state.muted = !state.muted; break;
      case 'set_default':
        n = parseInt(value, 10); if (isNaN(n) || n < 1 || n > CHANNELS.length) return null;
        var c = CHANNELS[n - 1];
        if (getDefault().url === c.url) store('s1_default', null);
        else store('s1_default', JSON.stringify({ name: c.name, url: c.url }));
        break;
      case 'rec': case 'rec_play': case 'rec_stop': case 'rec_toggle': case 'rec_seek': case 'rec_folder':
        say('Recording is not available in the web version'); break;
      default: break;   /* joy, power, tv, yt_*, browse_* : PC-only, ignored */
    }
    return snapshot();
  }

  function remoteUrl() { var u = new URL('remote.html', location.href); u.search = ''; u.hash = code; return u.href; }

  /* ---------- API router: same endpoints iptv_host.py had, answered locally ---------- */
  function route(method, url, body) {
    var p = String(url).split('?')[0];
    return channelsReady.then(function () {
      var ok = function (data) { return { status: 200, data: data }; };
      if (method === 'GET') {
        if (p === '/api/current') return ok(snapshot());
        if (p === '/api/default') return ok(getDefault());
        if (p === '/api/channels') { var df = getDefault().url; return ok(CHANNELS.map(function (c) { return { name: c.name, note: c.quality || '', 'default': c.url === df }; })); }
        if (p === '/api/info') return ok({ sender_url: remoteUrl(), all_urls: [remoteUrl()] });
        if (p === '/api/recordings') return ok([]);
        return { status: 404, data: {} };
      }
      body = body || {};
      if (p === '/api/cmd') { var s = runCmd(String(body.cmd || ''), body.value); return s ? ok(s) : { status: 400, data: {} }; }
      if (p === '/api/push' || p === '/api/default') {
        var name = String(body.name || '').slice(0, 300), u = String(body.url || '').slice(0, 5000);
        if (!/^https?:\/\//.test(u)) return { status: 400, data: {} };
        if (p === '/api/default') { store('s1_default', JSON.stringify({ name: name, url: u })); return ok({ ok: true, 'default': true }); }
        state.id++; state.name = name; state.url = u;
        state.index = 0; for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].url === u) { state.index = i + 1; break; }
        return ok({ ok: true, id: state.id });
      }
      if (p === '/api/click' || p === '/api/input') return ok({ ok: false });   /* needs the PC: not available */
      return { status: 404, data: {} };
    });
  }

  /* the TV page's own code keeps calling fetch('/api/...'): answer those locally */
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u.indexOf('/api/') === 0) {
      var m = ((init && init.method) || 'GET').toUpperCase(), b = null;
      try { b = init && init.body ? JSON.parse(init.body) : null; } catch (e) {}
      return route(m, u, b).then(function (r) { return new Response(JSON.stringify(r.data), { status: r.status, headers: { 'Content-Type': 'application/json' } }); });
    }
    return realFetch(input, init);
  };

  /* ---------- same-network check (public IP must match) ---------- */
  function publicIp() {
    return Promise.race([
      realFetch('https://api.ipify.org?format=json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return String(d.ip || ''); }),
      new Promise(function (res) { setTimeout(function () { res(''); }, 4000); })
    ]).catch(function () { return ''; });
  }
  var tvIp = '', ipReady = publicIp().then(function (ip) { tvIp = ip; });

  /* ---------- pairing link ---------- */
  var peer = null, conns = [], status = 'Connecting to relay...', tries = 0, box = null;
  function paintStatus() {
    var el = document.getElementById('s1st'); if (!el) return;
    el.textContent = conns.length ? '\u25CF ' + conns.length + ' phone' + (conns.length > 1 ? 's' : '') + ' connected' : status;
  }
  function onConn(conn) {
    var authed = false;
    conn.on('data', function (m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        Promise.race([ipReady, new Promise(function (r) { setTimeout(r, 3500); })]).then(function () {
          if (tvIp && m.ip && tvIp !== m.ip) { conn.send({ t: 'reject', reason: 'network' }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 600); return; }
          authed = true; if (conns.indexOf(conn) < 0) conns.push(conn);
          conn.send({ t: 'welcome' }); say('\uD83D\uDCF1 Remote connected'); paintStatus();
        });
      } else if (m.t === 'rpc' && authed) {
        route(m.method, m.path, m.body).then(function (r) { conn.send({ t: 'res', id: m.id, status: r.status, data: r.data }); });
      }
    });
    var gone = function () { var i = conns.indexOf(conn); if (i >= 0) conns.splice(i, 1); paintStatus(); };
    conn.on('close', gone); conn.on('error', gone);
  }
  function restart(delay) {
    try { if (peer) peer.destroy(); } catch (e) {}
    setTimeout(startPeer, delay || 0);
  }
  function startPeer() {
    if (!window.Peer) { status = 'Link library not loaded (check internet)'; paintStatus(); return; }
    peer = new Peer(PEER_PREFIX + code, { debug: 0 });
    peer.on('open', function () { tries = 0; status = 'Waiting for your phone...'; paintStatus(); });
    peer.on('connection', onConn);
    peer.on('disconnected', function () { status = 'Reconnecting...'; paintStatus(); setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (err) {
      if (err && err.type === 'unavailable-id') {
        /* the broker still holds our previous session (quick refresh) or another tab uses this code */
        if (++tries <= 4) return restart(3000);
        code = newCode(); store('s1_tv_code', code); tries = 0; renderQR(); return restart(500);
      }
      if (err && err.type === 'peer-unavailable') return;
      status = 'Offline - retrying...'; paintStatus(); restart(5000);
    });
  }

  /* ---------- QR corner + start screen ---------- */
  function renderQR() {
    if (!box) return;
    var q = qrcode(0, 'M'); q.addData(remoteUrl()); q.make();
    box.innerHTML = q.createSvgTag(4, 0) + 'Scan to control<br><b>Code ' + code.slice(0, 4) + '-' + code.slice(4) + '</b><br><small id="s1st"></small><br><small>Phone must be on the same Wi\u2011Fi</small>';
    paintStatus();
  }
  function ready() {
    box = document.createElement('div'); box.id = 'qrcorner'; box.title = 'Press Q to hide/show'; document.body.appendChild(box);
    document.addEventListener('keydown', function (e) { if (e.key === 'q' || e.key === 'Q') box.style.display = box.style.display === 'none' ? 'block' : 'none'; });
    renderQR();

    var ov = document.createElement('div'); ov.id = 's1start';
    ov.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(5,8,18,.6);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;cursor:pointer;color:#fff;font:700 28px Arial';
    ov.innerHTML = '\u25B6 Click anywhere (or press any key) to start the TV<div style="font:400 16px Arial;color:#b8c2dd">then scan the QR code in the corner with your phone</div>';
    document.body.appendChild(ov);
    var go = function () {
      if (!ov.parentNode) return; ov.remove();
      try { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); } catch (e) {}
      var v = document.getElementById('v');
      if (v && v.style.display !== 'none' && v.currentSrc) v.play().then(function () { document.getElementById('gate').style.display = 'none'; }).catch(function () {});
    };
    ov.addEventListener('click', go); document.addEventListener('keydown', go);
    startPeer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
