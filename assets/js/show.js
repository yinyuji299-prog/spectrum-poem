/* ============================================================
   《频谱之诗》— 频谱剧场
   一部约 75 秒、可暂停、可拖进度、可开关配乐的成片式展示。
   画面全部由本站 FFT 实时计算，不使用视频文件。
   ============================================================ */
(function () {
  'use strict';
  var S = window.Site;
  if (!S) return;
  var cv = document.getElementById('showStage');
  if (!cv) return;

  var C = S.C;
  var N = 256;
  var DURATION = 75;
  var reduce = false;

  /* ---------- 六幕 ---------- */
  var ACTS = [
    { t: 0,  no: '01', title: '一条看不懂的曲线',
      line: '一段录音落到屏幕上，只剩上下起伏。几个音已经混成一根线。' },
    { t: 12, no: '02', title: '先把它拆开',
      line: '三个纯音各自清楚。叠在一起，曲线立刻变乱——可成分一个都没丢。' },
    { t: 26, no: '03', title: '换一个角度看',
      line: '时域里搅在一起的东西，到频域变成三根柱子。这就是傅里叶变换在做的事。' },
    { t: 40, no: '04', title: '笨办法太慢',
      line: '按定义逐个频率去试。点的数量翻一倍，计算量大约翻四倍。声音一长，就来不及了。' },
    { t: 52, no: '05', title: '分治，再分治',
      line: 'FFT 把同一道题对半拆开，重复的乘法不用再做。点数越多，省下的次数越多。' },
    { t: 64, no: '06', title: '它一直在你身边',
      line: '播放器的频谱条、降噪耳机、设备体检，用的都是这一步。' }
  ];

  var el = {
    play: document.getElementById('showPlay'),
    time: document.getElementById('showTime'),
    dur: document.getElementById('showDur'),
    seek: document.getElementById('showSeek'),
    act: document.getElementById('showAct'),
    line: document.getElementById('showLine'),
    sound: document.getElementById('showSound'),
    status: document.getElementById('showStatus')
  };

  var playing = false;
  var t = 0;
  var last = 0;
  var raf = 0;
  var audioOn = false;
  var ac = null;
  var master = null;
  var oscs = [];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function smooth(p) { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); }
  function seg(now, a, b) { return smooth((now - a) / (b - a)); }

  function actAt(now) {
    var i = 0;
    for (var k = 0; k < ACTS.length; k++) if (now >= ACTS[k].t) i = k;
    return i;
  }

  /* ---------- 合成配乐：三个乐音，随幕升降 ---------- */
  function freqsAt(now) {
    var a = actAt(now);
    var base = [
      [196, 0, 0],
      [262, 392, 523],
      [262, 392, 523],
      [220, 330, 0],
      [262, 330, 392],
      [196, 294, 392]
    ][a];
    var gain = [0.0, 0.045, 0.07, 0.03, 0.055, 0.04][a];
    return { f: base, g: gain };
  }

  function ensureAudio() {
    if (ac) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
    for (var i = 0; i < 3; i++) {
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = 220;
      g.gain.value = 0;
      o.connect(g);
      g.connect(master);
      o.start();
      oscs.push({ o: o, g: g });
    }
  }

  function setSound(on) {
    audioOn = on;
    if (el.sound) {
      el.sound.classList.toggle('on', on);
      el.sound.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.sound.textContent = on ? '配乐开' : '配乐关';
    }
    if (!on) {
      if (master && ac) master.gain.setTargetAtTime(0, ac.currentTime, 0.05);
      return;
    }
    ensureAudio();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  function driveAudio(now) {
    if (!ac || !audioOn || !master) return;
    var spec = freqsAt(now);
    var audible = playing && audioOn ? spec.g : 0;
    master.gain.setTargetAtTime(audible, ac.currentTime, 0.08);
    for (var i = 0; i < 3; i++) {
      var f = spec.f[i] || 0;
      oscs[i].o.frequency.setTargetAtTime(f || 220, ac.currentTime, 0.06);
      oscs[i].g.gain.setTargetAtTime(f ? 1 : 0, ac.currentTime, 0.08);
    }
  }

  /* ---------- 信号 ---------- */
  function sample(now, i) {
    var x = i / N;
    var mix = seg(now, 10, 16);
    var a = Math.sin(2 * Math.PI * 3 * x);
    var b = 0.62 * Math.sin(2 * Math.PI * 7 * x + 0.4);
    var c = 0.38 * Math.sin(2 * Math.PI * 13 * x);
    var noise = 0.55 * Math.sin(2 * Math.PI * 2.2 * x)
      + 0.28 * Math.sin(2 * Math.PI * 5.5 * x + 1.2)
      + 0.16 * Math.sin(2 * Math.PI * 11 * x);
    return lerp(noise, a + b + c, mix);
  }

  function frame(now) {
    var re = new Array(N);
    for (var i = 0; i < N; i++) re[i] = sample(now, i);
    return re;
  }

  /* ---------- 绘图 ---------- */
  function boxOf(w, h) {
    var pad = Math.round(28 * Math.min(S.U(), 1.2));
    return { x: pad, y: Math.round(36 * S.U()), w: w - pad * 2, h: h - Math.round(78 * S.U()) };
  }

  function drawWave(ctx, re, box, color, alpha) {
    var pts = [];
    var mid = box.y + box.h / 2;
    var amp = box.h * 0.38;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.beginPath();
    for (var i = 0; i < re.length; i++) {
      var x = box.x + box.w * i / (re.length - 1);
      var y = mid - re[i] * amp;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      pts.push({ x: x, y: y });
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4 * S.U();
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    return pts;
  }

  function component(i, f, amp, phase) {
    return amp * Math.sin(2 * Math.PI * f * i / N + (phase || 0));
  }

  function drawSpectrum(ctx, re, box, reveal) {
    var spec = S.dft(re).slice(0, 40);
    var shown = spec.map(function (v, i) {
      var p = clamp((reveal * 40 - i) / 6, 0, 1);
      return v * smooth(p);
    });
    S.drawBars(ctx, shown, box, { highlight: [3, 7, 13] });
  }

  function drawSplit(ctx, w, h, now) {
    var gap = 18;
    var bw = (w - 56 - gap) / 2;
    var box = { x: 28, y: Math.round(42 * S.U()), w: bw, h: h - Math.round(86 * S.U()) };
    var box2 = { x: 28 + bw + gap, y: box.y, w: bw, h: box.h };
    var re = frame(now);
    ctx.save();
    ctx.fillStyle = C.fg3;
    ctx.font = S.fs(12) + 'px sans-serif';
    ctx.fillText('时域 · 混在一起', box.x, box.y - 12);
    ctx.fillText('频域 · 拆开之后', box2.x, box2.y - 12);
    ctx.restore();
    S.drawGrid(ctx, box, 8, 4);
    S.drawAxis(ctx, box, box.y + box.h / 2);
    drawWave(ctx, re, box, C.fg, 1);
    drawSpectrum(ctx, re, box2, seg(now, 26, 36));
  }

  function cost(n) { return { dft: n * n, fft: Math.round(n * Math.log2(n)) }; }

  function drawRace(ctx, w, h, now) {
    var p = seg(now, 40, 51);
    var n = Math.round(lerp(16, 1024, p));
    var c = cost(n);
    var box = { x: 36, y: Math.round(48 * S.U()), w: w - 72, h: h - Math.round(110 * S.U()) };
    var max = cost(1024).dft;
    function bar(label, value, color, row) {
      var y = box.y + row * (box.h / 2) + 18;
      var bw = (value / max) * (box.w - 150);
      ctx.fillStyle = C.fg3;
      ctx.font = S.fs(13) + 'px sans-serif';
      ctx.fillText(label, box.x, y + 16);
      ctx.fillStyle = color;
      ctx.fillRect(box.x + 78, y, Math.max(2, bw), 22);
      ctx.fillStyle = C.fg;
      ctx.font = S.fs(13) + 'px monospace';
      ctx.fillText(String(value), box.x + 86 + bw, y + 16);
    }
    ctx.fillStyle = C.fg;
    ctx.font = S.fs(18) + 'px serif';
    ctx.fillText('N = ' + n, box.x, box.y);
    bar('DFT', c.dft, '#C7CEDD', 0.55);
    bar('FFT', c.fft, C.blue, 1.15);
    var ratio = Math.max(1, Math.round(c.dft / c.fft));
    ctx.fillStyle = C.amber;
    ctx.font = S.fs(16) + 'px sans-serif';
    ctx.fillText('同一件事，FFT 少做了约 ' + ratio + ' 倍的乘法', box.x, box.y + box.h - 8);
  }

  function drawUses(ctx, w, h, now) {
    var items = [
      ['播放器', '频谱条跟着音乐跳'],
      ['耳机', '反相声波抵消噪声'],
      ['设备', '异常频率暴露故障']
    ];
    var p = seg(now, 64, 73);
    var gap = 16;
    var bw = (w - 64 - gap * 2) / 3;
    var bh = h - Math.round(70 * S.U());
    for (var i = 0; i < 3; i++) {
      var x = 28 + i * (bw + gap);
      var y = Math.round(28 * S.U());
      var show = clamp(p * 3 - i, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.75 * show;
      ctx.strokeStyle = C.axis;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = C.fg;
      ctx.font = S.fs(18) + 'px serif';
      ctx.fillText(items[i][0], x + 16, y + 36);
      ctx.fillStyle = C.fg2;
      ctx.font = S.fs(13) + 'px sans-serif';
      ctx.fillText(items[i][1], x + 16, y + 62);
      var mini = { x: x + 16, y: y + 86, w: bw - 32, h: bh - 110 };
      var re = [];
      for (var k = 0; k < 96; k++) {
        var base = i === 0 ? 4 : i === 1 ? 6 : 9;
        re.push(Math.sin(2 * Math.PI * base * k / 96 + now * 0.8)
          + (i === 2 ? 0.45 * Math.sin(2 * Math.PI * 17 * k / 96) : 0));
      }
      S.drawGrid(ctx, mini, 6, 3);
      drawWave(ctx, re, mini, i === 2 ? C.amber : C.blue, show);
      ctx.restore();
    }
  }

  function paint(now) {
    var rect = cv.getBoundingClientRect();
    var w = Math.max(320, rect.width || 960);
    var h = Math.max(240, rect.height || 460);
    var ctx = S.fitCanvas(cv, w, h);
    S.clearDark(ctx, w, h);
    var a = actAt(now);

    if (a <= 1) {
      var box = boxOf(w, h);
      S.drawGrid(ctx, box, 8, 4);
      S.drawAxis(ctx, box, box.y + box.h / 2);
      if (a === 0) drawWave(ctx, frame(now), box, C.fg, 1);
      else {
        var spread = seg(now, 12, 20);
        drawWave(ctx, frame(now), box, C.fg, 1 - spread * 0.65);
        var cols = [C.violet, C.blue, C.cyan];
        var parts = [
          function (i) { return component(i, 3, 1, 0); },
          function (i) { return component(i, 7, 0.62, 0.4); },
          function (i) { return component(i, 13, 0.38, 0); }
        ];
        for (var p = 0; p < 3; p++) {
          var wave = [];
          for (var i = 0; i < N; i++) wave.push(parts[p](i));
          var b2 = {
            x: box.x,
            y: box.y + box.h * (0.08 + p * 0.28 * spread),
            w: box.w,
            h: box.h * (1 - 0.62 * spread)
          };
          drawWave(ctx, wave, b2, cols[p], spread);
        }
      }
    } else if (a === 2) {
      drawSplit(ctx, w, h, now);
    } else if (a === 3) {
      drawRace(ctx, w, h, now);
    } else if (a === 4) {
      drawRace(ctx, w, h, 51);
      var p2 = seg(now, 52, 63);
      ctx.fillStyle = C.blue;
      ctx.font = S.fs(22) + 'px serif';
      ctx.fillText('8  →  4  →  2  →  1', 36, Math.round(40 * S.U()));
      ctx.globalAlpha = p2;
      ctx.fillStyle = C.fg2;
      ctx.font = S.fs(15) + 'px sans-serif';
      ctx.fillText('每一级只处理成对的点。答案不变，步数变少。', 36, Math.round(68 * S.U()));
      ctx.globalAlpha = 1;
    } else {
      drawUses(ctx, w, h, now);
    }
  }

  /* ---------- 播放 ---------- */
  function renderChrome() {
    var a = ACTS[actAt(t)];
    if (el.time) el.time.textContent = clock(t);
    if (el.dur) el.dur.textContent = clock(DURATION);
    if (el.seek) el.seek.value = String(Math.round(t / DURATION * 1000));
    if (el.act) el.act.textContent = a.no + '  ' + a.title;
    if (el.line) el.line.textContent = a.line;
    if (el.status) {
      el.status.textContent = (playing ? '正在播放' : '已暂停') +
        '，第 ' + a.no + ' 幕，' + a.title;
    }
    document.querySelectorAll('.show-chapter').forEach(function (node, i) {
      node.classList.toggle('on', i === actAt(t));
    });
  }

  function frameStep(ts) {
    if (document.hidden) { raf = 0; return; }
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    if (playing && !reduce) t += dt;
    if (t >= DURATION) {
      t = DURATION;
      playing = false;
      if (el.play) el.play.textContent = '重播';
    }
    paint(t);
    renderChrome();
    driveAudio(t);
    raf = window.requestAnimationFrame(frameStep);
  }

  function play() {
    if (t >= DURATION) t = 0;
    playing = true;
    last = 0;
    if (el.play) el.play.textContent = '暂停';
    if (audioOn) setSound(true);
  }
  function pause() {
    playing = false;
    if (el.play) el.play.textContent = '播放';
    driveAudio(t);
  }

  if (el.play) {
    el.play.addEventListener('click', function () {
      if (playing) pause();
      else play();
    });
  }
  if (el.seek) {
    el.seek.addEventListener('input', function () {
      t = Number(el.seek.value) / 1000 * DURATION;
      last = 0;
      paint(t);
      renderChrome();
    });
  }
  if (el.sound) {
    el.sound.addEventListener('click', function () { setSound(!audioOn); });
  }
  document.querySelectorAll('.show-chapter').forEach(function (node) {
    node.addEventListener('click', function () {
      t = Number(node.getAttribute('data-t') || 0);
      if (!playing) play();
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pause();
    } else if (playing && !raf) {
      last = 0;
      raf = window.requestAnimationFrame(frameStep);
    }
  });

  if (el.dur) el.dur.textContent = clock(DURATION);
  paint(0);
  renderChrome();
  play();
  raf = window.requestAnimationFrame(frameStep);
})();
