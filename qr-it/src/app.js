(function () {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  var $ = function (id) { return document.getElementById(id); };
  var mode = 'text';
  var logo = null; // { img, src }
  var current = null; // { canvas, svg, data, card }
  var scanTimer = null;
  var batch = { results: null, running: false };
  var STORE = 'qrit.look.v1';
  var DEFAULTS = { fg: '#000000', bg: '#ffffff', ec: 'M', margin: 4, size: 1024 };
  var BUTTONS = ['dl-png', 'dl-svg', 'copy-png', 'copy-svg'];
  var BATCH_MAX = 1000;
  var inFrame = window.self !== window.top;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  if (inFrame) { $('frame-note').hidden = false; $('card-print').hidden = true; }

  // ---------- remembered look (this browser only, never content) ----------
  function applyLook(l) {
    $('fg').value = l.fg; $('bg').value = l.bg; $('ec').value = l.ec;
    $('margin').value = l.margin; $('size').value = l.size;
  }
  function loadLook() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var l = JSON.parse(raw), out = {};
      out.fg = /^#[0-9a-f]{6}$/i.test(l.fg) ? l.fg : DEFAULTS.fg;
      out.bg = /^#[0-9a-f]{6}$/i.test(l.bg) ? l.bg : DEFAULTS.bg;
      out.ec = /^[LMQH]$/.test(l.ec) ? l.ec : DEFAULTS.ec;
      out.margin = Math.min(8, Math.max(0, parseInt(l.margin, 10) || 0));
      out.size = Math.min(4096, Math.max(256, parseInt(l.size, 10) || DEFAULTS.size));
      applyLook(out);
    } catch (e) { /* storage unavailable: use defaults */ }
  }
  function saveLook() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ fg: $('fg').value, bg: $('bg').value, ec: $('ec').value, margin: +$('margin').value, size: +$('size').value }));
    } catch (e) { /* ignore */ }
  }

  // ---------- payload builders ----------
  function escWifi(s) { return s.replace(/([\\;,:"])/g, '\\$1'); }
  function escVcard(s) { return s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n'); }

  function payload() {
    if (mode === 'text') return $('t-text').value;
    if (mode === 'wifi') {
      var ssid = $('w-ssid').value;
      if (!ssid) return '';
      var sec = $('w-sec').value;
      var s = 'WIFI:T:' + sec + ';S:' + escWifi(ssid) + ';';
      if (sec !== 'nopass') s += 'P:' + escWifi($('w-pass').value) + ';';
      if ($('w-hidden').checked) s += 'H:true;';
      return s + ';';
    }
    if (mode === 'contact') {
      var f = $('c-first').value.trim(), l = $('c-last').value.trim();
      var tel = $('c-tel').value.trim(), em = $('c-email').value.trim();
      var org = $('c-org').value.trim(), url = $('c-url').value.trim();
      if (!f && !l && !tel && !em) return '';
      var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + escVcard(l) + ';' + escVcard(f) + ';;;', 'FN:' + escVcard((f + ' ' + l).trim())];
      if (org) lines.push('ORG:' + escVcard(org));
      if (tel) lines.push('TEL;TYPE=CELL:' + tel);
      if (em) lines.push('EMAIL:' + em);
      if (url) lines.push('URL:' + url);
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }
    if (mode === 'email') {
      var to = $('e-to').value.trim();
      if (!to) return '';
      var q = [];
      if ($('e-subject').value) q.push('subject=' + encodeURIComponent($('e-subject').value));
      if ($('e-body').value) q.push('body=' + encodeURIComponent($('e-body').value));
      return 'mailto:' + to + (q.length ? '?' + q.join('&') : '');
    }
    return '';
  }

  // ---------- colour checks ----------
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) {
      var v = parseInt(hex.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function checkContrast(fg, bg) {
    var a = lum(fg), b = lum(bg);
    var ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    var note = $('contrast');
    if (ratio < 3) {
      note.textContent = 'These colours are too close together. Scanners may not read the code; use a darker foreground or a lighter background.';
      note.hidden = false;
    } else if (a > b) {
      note.textContent = 'Light code on a dark background is inverted. Some older phones and scanners won’t read it.';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  // ---------- rendering ----------
  function makeQr(data, ec) {
    var qr = qrcode(0, ec); qr.addData(data, 'Byte'); qr.make(); return qr;
  }

  // Caption band sizing, in modules, shared by PNG and SVG so both match.
  function captionLayout(total) {
    var fontMod = Math.max(2.4, total * 0.075);
    return { font: fontMod, band: fontMod * 1.9 };
  }

  function renderCanvas(qr, o, size) {
    var n = qr.getModuleCount(), m = o.margin, total = n + m * 2;
    var cap = o.caption ? captionLayout(total) : null;
    var scale = Math.max(1, Math.floor(size / total));
    var w = scale * total;
    var h = w + (cap ? Math.round(cap.band * scale) : 0);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = o.bg; g.fillRect(0, 0, w, h);
    g.fillStyle = o.fg;
    for (var r = 0; r < n; r++) for (var col = 0; col < n; col++) {
      if (qr.isDark(r, col)) g.fillRect((col + m) * scale, (r + m) * scale, scale, scale);
    }
    if (logo) {
      var box = Math.round(n * scale * 0.22), pad = scale;
      var x = Math.round(w / 2 - box / 2);
      g.fillStyle = o.bg;
      g.fillRect(x - pad, x - pad, box + pad * 2, box + pad * 2);
      var iw = logo.img.naturalWidth || box, ih = logo.img.naturalHeight || box;
      var k = Math.min(box / iw, box / ih);
      g.drawImage(logo.img, x + (box - iw * k) / 2, x + (box - ih * k) / 2, iw * k, ih * k);
    }
    if (cap) {
      var fpx = cap.font * scale;
      g.font = '600 ' + fpx + 'px ' + FONT;
      var maxW = w - 2 * Math.max(m, 2) * scale;
      var tw = g.measureText(o.caption).width;
      if (tw > maxW) { fpx = fpx * maxW / tw; g.font = '600 ' + fpx + 'px ' + FONT; }
      g.fillStyle = o.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.caption, w / 2, w + (cap.band * scale) / 2 - Math.min(m, 2) * scale * 0.5);
    }
    return c;
  }

  function xmlEsc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function renderSvg(qr, o) {
    var n = qr.getModuleCount(), m = o.margin, total = n + m * 2, d = '';
    var cap = o.caption ? captionLayout(total) : null;
    var H = total + (cap ? cap.band : 0);
    for (var r = 0; r < n; r++) {
      var col = 0;
      while (col < n) {
        if (!qr.isDark(r, col)) { col++; continue; }
        var start = col;
        while (col < n && qr.isDark(r, col)) col++;
        d += 'M' + (start + m) + ' ' + (r + m) + 'h' + (col - start) + 'v1h-' + (col - start) + 'z';
      }
    }
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + +H.toFixed(2) + '" width="' + total * 8 + '" height="' + Math.round(H * 8) + '">' +
      '<rect width="100%" height="100%" fill="' + o.bg + '"/><path fill="' + o.fg + '" shape-rendering="crispEdges" d="' + d + '"/>';
    if (logo) {
      var box = n * 0.22, pad = 1, x = total / 2 - box / 2;
      out += '<rect x="' + (x - pad) + '" y="' + (x - pad) + '" width="' + (box + pad * 2) + '" height="' + (box + pad * 2) + '" fill="' + o.bg + '"/>' +
        '<image href="' + logo.src + '" x="' + x + '" y="' + x + '" width="' + box + '" height="' + box + '" preserveAspectRatio="xMidYMid meet"/>';
    }
    if (cap) {
      var y = total + cap.band / 2 - Math.min(m, 2) * 0.5;
      var fs = cap.font, est = o.caption.length * 0.6 * fs, maxW = total - 2 * Math.max(m, 2);
      if (est > maxW) fs = fs * maxW / est;
      out += '<text x="' + total / 2 + '" y="' + y.toFixed(2) + '" font-family="' + xmlEsc(FONT) + '" font-weight="600" font-size="' + fs.toFixed(2) +
        '" fill="' + o.fg + '" text-anchor="middle" dominant-baseline="central">' + xmlEsc(o.caption) + '</text>';
    }
    return out + '</svg>';
  }

  // Wi-Fi card: A6 portrait at 300 dpi.
  function fitText(g, text, weight, px, family, maxW) {
    g.font = weight + ' ' + px + 'px ' + family;
    var w = g.measureText(text).width;
    if (w > maxW) { px = Math.floor(px * maxW / w); g.font = weight + ' ' + px + 'px ' + family; }
    return px;
  }
  function renderCard(qr, o) {
    var W = 1240, H = 1748, pad = 90;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = o.bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = o.fg; g.globalAlpha = 0.18; g.lineWidth = 4;
    g.strokeRect(40, 40, W - 80, H - 80);
    g.globalAlpha = 1;
    g.fillStyle = o.fg; g.textAlign = 'center'; g.textBaseline = 'alphabetic';

    var heading = $('w-heading').value.trim() || 'Wi‑Fi';
    fitText(g, heading, '700', 120, FONT, W - pad * 2);
    g.fillText(heading, W / 2, 230);

    var code = renderCanvas(qr, { fg: o.fg, bg: o.bg, margin: 4, caption: '' }, 760);
    var cs = Math.min(760, code.width);
    g.drawImage(code, (W - cs) / 2, 290, cs, cs);

    var y = 290 + cs + 70;
    function field(label, value, family, big) {
      g.globalAlpha = 0.6;
      g.font = '600 38px ' + FONT;
      g.fillText(label.toUpperCase(), W / 2, y);
      g.globalAlpha = 1;
      y += big * 1.15;
      fitText(g, value, '700', big, family, W - pad * 2);
      g.fillText(value, W / 2, y);
      y += 80;
    }
    field('Network', $('w-ssid').value, FONT, 72);
    var sec = $('w-sec').value;
    if (sec === 'nopass') field('Password', 'None needed', FONT, 60);
    else if ($('w-cardpass').checked && $('w-pass').value) field('Password', $('w-pass').value, MONO, 72);

    g.globalAlpha = 0.7;
    fitText(g, 'Point your phone’s camera at the code to join.', '400', 40, FONT, W - pad * 2);
    g.fillText('Point your phone’s camera at the code to join.', W / 2, H - 100);
    g.globalAlpha = 1;
    return c;
  }

  // ---------- scan check ----------
  function scanResult(qr, o, data) {
    if (typeof jsQR !== 'function') return null;
    var c = renderCanvas(qr, o, 480);
    var img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    var res = null, inverted = false;
    try {
      res = jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (!res) { res = jsQR(img.data, c.width, c.height, { inversionAttempts: 'onlyInvert' }); inverted = !!res; }
    } catch (e) { res = null; }
    if (res && res.data === data) {
      if (inverted) return { state: 'warn', text: 'Scans only on readers that handle inverted codes' };
      if (o.margin < 2) return { state: 'warn', text: 'Scans here, but a quiet zone under 2 can fail in print' };
      return { state: 'ok', text: 'Scans correctly' };
    }
    if (res) return { state: 'bad', text: 'Reads back different data. Don’t use this one' };
    return { state: 'bad', text: logo ? 'Won’t scan. Try a smaller or simpler logo, or higher contrast' : 'Won’t scan. Check the colours and quiet zone' };
  }
  function setPill(el, r) { el.dataset.state = r.state; el.textContent = r.text; }

  // ---------- single build ----------
  function setEmpty(msg) {
    current = null;
    $('out').hidden = true; $('empty').hidden = false; $('empty').textContent = msg;
    $('meta').innerHTML = '&nbsp;';
    $('scan').hidden = true;
    $('card-view').hidden = true;
    BUTTONS.forEach(function (id) { $(id).disabled = true; });
  }

  function look() {
    return { fg: $('fg').value, bg: $('bg').value, margin: +$('margin').value, caption: $('caption').value.trim() };
  }

  function build() {
    var o = look();
    var size = +$('size').value;
    $('fg-hex').textContent = o.fg.toUpperCase(); $('bg-hex').textContent = o.bg.toUpperCase();
    $('margin-out').textContent = o.margin + (o.margin === 1 ? ' module' : ' modules');
    $('size-out').textContent = size + ' px';
    $('ec').disabled = !!logo;
    checkContrast(o.fg, o.bg);
    saveLook();

    if (mode === 'batch') { batchDirty(); return; }

    $('svg-fallback').hidden = true;
    var data = payload();
    if (!data) { setEmpty('Fill in the form and your code appears here.'); return; }
    var ec = logo ? 'H' : $('ec').value;
    var qr;
    try { qr = makeQr(data, ec); }
    catch (e) {
      setEmpty('That’s more data than one QR code can hold at error correction ' + ec + '. Shorten it' + (logo ? ' or remove the logo.' : (ec !== 'L' ? ' or pick a lower error correction.' : '.')));
      return;
    }
    var canvas = renderCanvas(qr, o, size);
    current = { canvas: canvas, svg: renderSvg(qr, o), data: data, card: null };
    var out = $('out');
    out.src = canvas.toDataURL('image/png');
    out.classList.toggle('crisp', !o.caption);
    out.hidden = false; $('empty').hidden = true;
    var n = qr.getModuleCount();
    var bytes = qrcode.stringToBytes(data).length;
    $('meta').textContent = 'Version ' + ((n - 17) / 4) + ' · ' + n + '×' + n + ' modules · EC ' + ec + ' · ' + bytes + ' bytes · PNG ' + canvas.width + '×' + canvas.height;
    BUTTONS.forEach(function (id) { $(id).disabled = false; });

    if (mode === 'wifi') {
      current.card = renderCard(qr, o);
      $('card-img').src = current.card.toDataURL('image/png');
      $('card-view').hidden = false;
    } else {
      $('card-view').hidden = true;
    }

    $('scan').hidden = false;
    setPill($('scan'), { state: 'pending', text: 'Checking it scans…' });
    clearTimeout(scanTimer);
    scanTimer = setTimeout(function () {
      var r = scanResult(qr, o, data);
      if (!current || current.data !== data) return;
      if (r) setPill($('scan'), r); else $('scan').hidden = true;
    }, 60);
  }

  var t = null;
  function schedule() { clearTimeout(t); t = setTimeout(build, 90); }

  // ---------- batch ----------
  function parseCSV(text) {
    var rows = [], row = [], field = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"' && field.trim() === '') { q = true; field = ''; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function batchRows() {
    var rows = parseCSV($('b-list').value)
      .map(function (r) { return r.map(function (c) { return c.trim(); }); })
      .filter(function (r) { return r.length && r[0] !== ''; });
    if ($('b-header').checked) rows.shift();
    return rows.map(function (r, i) { return { row: i + 1, data: r[0], label: r[1] || '' }; });
  }
  function batchDirty() {
    var n = batchRows().length;
    $('b-count').textContent = n === 0 ? 'No codes yet' : n > BATCH_MAX ? n.toLocaleString() + ' rows: the limit is ' + BATCH_MAX.toLocaleString() : n.toLocaleString() + (n === 1 ? ' code ready' : ' codes ready');
    $('b-run').disabled = batch.running || n === 0 || n > BATCH_MAX;
    if (batch.results && !batch.running) {
      batch.results = null;
      $('b-zip').disabled = true;
      $('b-status').textContent = 'Settings changed. Generate again to update the ZIP.';
    }
  }
  function safeName(s) {
    return s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function canvasBytes(c) {
    return new Promise(function (res) { c.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }); }, 'image/png'); });
  }

  function runBatch() {
    var rows = batchRows();
    if (!rows.length || rows.length > BATCH_MAX || batch.running) return;
    batch.running = true; batch.results = null;
    $('b-run').disabled = true; $('b-zip').disabled = true;
    $('b-thumbs').innerHTML = ''; $('b-more').hidden = true; $('b-scan').hidden = true;
    $('b-progress').hidden = false; $('b-bar').style.width = '0%';
    $('b-status').textContent = '';
    var base = look(), size = +$('size').value, ec = logo ? 'H' : $('ec').value;
    var fmt = $('b-format').value, useLabel = $('b-labelcap').checked;
    var width = String(rows.length).length < 3 ? 3 : String(rows.length).length;
    var used = {}, results = [], counts = { ok: 0, warn: 0, bad: 0 }, problems = [];
    var THUMB_MAX = 120, i = 0;

    function addThumb(r, src) {
      if ($('b-thumbs').children.length >= THUMB_MAX && r.state === 'ok') return;
      var fig = document.createElement('figure'); fig.dataset.state = r.state;
      var img;
      if (src) { img = document.createElement('img'); img.alt = 'Code for ' + (r.label || 'row ' + r.row); img.src = src; }
      else { img = document.createElement('div'); img.className = 'ph'; img.textContent = 'Too much data for one code'; }
      var cap = document.createElement('figcaption'); cap.textContent = r.state === 'bad' ? 'Row ' + r.row + ': ' + r.problem : (r.label || 'Row ' + r.row);
      cap.title = r.data;
      fig.appendChild(img); fig.appendChild(cap); $('b-thumbs').appendChild(fig);
    }

    function step() {
      if (i >= rows.length) return finish();
      var row = rows[i++];
      var name = safeName(row.label) || 'qr-' + pad(row.row, width);
      var key = name.toLowerCase(), k = 2;
      while (used[key]) { name = (safeName(row.label) || 'qr-' + pad(row.row, width)) + '-' + k++; key = name.toLowerCase(); }
      used[key] = true;
      var res = { row: row.row, data: row.data, label: row.label, name: name };
      var qr;
      try { qr = makeQr(row.data, ec); }
      catch (e) {
        res.state = 'bad'; res.problem = 'too much data'; counts.bad++; problems.push(row.row);
        results.push(res);
        addThumb(res, null);
        return progress();
      }
      var o = { fg: base.fg, bg: base.bg, margin: base.margin, caption: useLabel && row.label ? row.label : base.caption };
      var sr = scanResult(qr, o, row.data) || { state: 'ok', text: 'Not checked' };
      res.state = sr.state; res.problem = sr.state === 'bad' ? 'won’t scan' : sr.state === 'warn' ? 'check' : '';
      counts[sr.state]++; if (sr.state === 'bad') problems.push(row.row);
      var jobs = [];
      if (fmt !== 'svg') jobs.push(canvasBytes(renderCanvas(qr, o, size)).then(function (b) { res.png = b; }));
      if (fmt !== 'png') res.svg = renderSvg(qr, o);
      addThumb(res, renderCanvas(qr, o, 168).toDataURL('image/png'));
      results.push(res);
      return Promise.all(jobs).then(progress);
    }
    function progress() {
      $('b-bar').style.width = Math.round(i / rows.length * 100) + '%';
      $('b-count').textContent = 'Generating ' + i.toLocaleString() + ' of ' + rows.length.toLocaleString() + '…';
      return (i % 8 === 0 ? tick() : Promise.resolve()).then(step);
    }
    function finish() {
      batch.running = false; batch.results = results;
      $('b-progress').hidden = true;
      $('b-count').textContent = results.length.toLocaleString() + (results.length === 1 ? ' code generated' : ' codes generated');
      var pill = $('b-scan'); pill.hidden = false;
      if (counts.bad) setPill(pill, { state: 'bad', text: counts.bad + ' won’t scan: row' + (problems.length > 1 ? 's ' : ' ') + problems.slice(0, 8).join(', ') + (problems.length > 8 ? '…' : '') });
      else if (counts.warn) setPill(pill, { state: 'warn', text: 'All scan, ' + counts.warn + ' with warnings (inverted or thin quiet zone)' });
      else setPill(pill, { state: 'ok', text: 'All ' + results.length.toLocaleString() + ' scan correctly' });
      var shown = $('b-thumbs').children.length;
      if (shown < results.length) { $('b-more').hidden = false; $('b-more').textContent = 'Showing ' + shown + ' previews. All ' + results.length.toLocaleString() + ' are in the ZIP.'; }
      $('b-zip').disabled = false; $('b-run').disabled = false;
      $('b-status').textContent = counts.bad ? 'Codes that won’t scan are left out of the ZIP and marked in index.csv.' : '';
    }
    step();
  }

  // Minimal store-only ZIP writer (PNG and SVG are already compact; no library needed).
  var CRC_T = (function () {
    var tb = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return tb;
  })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(c.buffer, nm);
      offset += 30 + nm.length + sz;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.byteLength; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  }
  function csvCell(s) { s = String(s == null ? '' : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  function downloadZip() {
    if (!batch.results) return;
    var enc = new TextEncoder(), files = [];
    var index = [['row', 'file', 'label', 'content', 'scan'].join(',')];
    batch.results.forEach(function (r) {
      var names = [];
      if (r.state !== 'bad') {
        if (r.png) { files.push({ name: r.name + '.png', data: r.png }); names.push(r.name + '.png'); }
        if (r.svg) { files.push({ name: r.name + '.svg', data: enc.encode(r.svg) }); names.push(r.name + '.svg'); }
      }
      var scan = r.state === 'ok' ? 'ok' : r.state === 'warn' ? 'ok with warning' : 'FAILED: ' + r.problem + ' (not included)';
      index.push([r.row, names.join(' '), r.label, r.data, scan].map(csvCell).join(','));
    });
    files.push({ name: 'index.csv', data: enc.encode('﻿' + index.join('\r\n') + '\r\n') });
    var stamp = new Date().toISOString().slice(0, 10);
    save(makeZip(files), 'qr-it-batch-' + stamp + '.zip');
    $('b-status').textContent = 'ZIP saved with ' + (files.length - 1) + ' files and index.csv.';
  }

  // ---------- events ----------
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      mode = tab.dataset.mode;
      document.querySelectorAll('.tab').forEach(function (x) { x.setAttribute('aria-selected', x === tab ? 'true' : 'false'); });
      document.querySelectorAll('.mode-panel').forEach(function (p) { p.hidden = p.id !== 'p-' + mode; });
      $('single-view').hidden = mode === 'batch';
      $('batch-view').hidden = mode !== 'batch';
      $('status').textContent = '';
      build();
    });
  });
  document.querySelectorAll('input, textarea, select').forEach(function (el) {
    if (el.type === 'file') return;
    el.addEventListener('input', schedule);
    el.addEventListener('change', schedule);
  });
  $('w-show').addEventListener('change', function () { $('w-pass').type = this.checked ? 'text' : 'password'; });
  $('w-sec').addEventListener('change', function () { $('w-pass-wrap').hidden = this.value === 'nopass'; });

  $('reset').addEventListener('click', function () {
    applyLook(DEFAULTS);
    try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
    build();
    $('status').textContent = 'Look reset to defaults.';
  });

  $('logo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        logo = { img: img, src: reader.result };
        $('logo-thumb').src = reader.result; $('logo-thumb').hidden = false; $('logo-clear').hidden = false;
        build();
      };
      img.onerror = function () { $('status').textContent = 'That file couldn’t be read as an image. Try a PNG, JPG or SVG.'; };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  $('logo-clear').addEventListener('click', function () {
    logo = null; $('logo').value = '';
    $('logo-thumb').hidden = true; $('logo-clear').hidden = true;
    build();
  });

  $('b-file').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      $('b-list').value = String(reader.result).replace(/^﻿/, '');
      $('b-file-name').textContent = file.name;
      build();
    };
    reader.onerror = function () { $('b-status').textContent = 'That file couldn’t be read. Save it as CSV or plain text and try again.'; };
    reader.readAsText(file);
    this.value = '';
  });
  $('b-run').addEventListener('click', runBatch);
  $('b-zip').addEventListener('click', downloadZip);

  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function blobOf(canvas) {
    return new Promise(function (res, rej) { canvas.toBlob(function (b) { b ? res(b) : rej(new Error('no blob')); }, 'image/png'); });
  }
  $('dl-png').addEventListener('click', function () {
    if (!current) return;
    blobOf(current.canvas).then(function (b) { save(b, 'qr-code.png'); $('status').textContent = 'PNG saved.'; });
  });
  $('dl-svg').addEventListener('click', function () {
    if (!current) return;
    save(new Blob([current.svg], { type: 'image/svg+xml' }), 'qr-code.svg');
    $('status').textContent = 'SVG saved.';
  });
  $('copy-png').addEventListener('click', function () {
    if (!current) return;
    var blocked = 'Your browser blocked copying images here. Right‑click the code and choose Copy image instead.';
    try {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
      // Pass the promise straight in so Safari keeps the click's permission.
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blobOf(current.canvas) })]).then(
        function () { $('status').textContent = 'Image copied. Paste it into a document or chat.'; },
        function () { $('status').textContent = blocked; });
    } catch (e) { $('status').textContent = blocked; }
  });
  $('copy-svg').addEventListener('click', function () {
    if (!current) return;
    var svg = current.svg;
    function fallback() {
      var ta = $('svg-fallback'); ta.value = svg; ta.hidden = false; ta.focus(); ta.select();
      $('status').textContent = 'Clipboard access is blocked here. The SVG is selected below; copy it with Ctrl+C or ⌘C.';
    }
    try {
      navigator.clipboard.writeText(svg).then(function () { $('status').textContent = 'SVG copied to clipboard.'; }, fallback);
    } catch (e) { fallback(); }
  });
  $('card-dl').addEventListener('click', function () {
    if (!current || !current.card) return;
    var ssid = safeName($('w-ssid').value) || 'network';
    blobOf(current.card).then(function (b) { save(b, 'wifi-card-' + ssid + '.png'); $('status').textContent = 'Wi‑Fi card saved.'; });
  });
  $('card-print').addEventListener('click', function () {
    if (!current || !current.card) return;
    var area = $('print-area');
    area.innerHTML = '';
    var img = new Image(); img.alt = ''; img.src = current.card.toDataURL('image/png');
    area.appendChild(img);
    img.onload = function () { window.print(); };
  });

  loadLook();
  build();

  // Offline support once hosted: cache the page so it works with no connection.
  if (!inFrame && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline mode unavailable */ });
    });
  }
})();
