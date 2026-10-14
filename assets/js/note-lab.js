/* ============================================================
   《频谱之诗》· 音高实验室（延伸实验）
   ------------------------------------------------------------
   受「落谱 luopu.net」启发：把"声音变成可读的音"这件工业级产品，
   用纯前端、离线、零依赖的方式在本页重现一个教学版——
   弹琴键 → 听音 + 看实时 FFT 频谱 + 辨认音高（听音辨频小游戏），
   再加一个「真实数据」实验：上传浏览器支持的音频，用本页自带的 FFT
   实现对它做一次真实的频谱分析，并读出主频对应的音名。
   复用 site.js 的 Site API：fitCanvas / clearDark / drawGrid / C /
   completeQuest / questDone / TASKS / fftComplex。
   ============================================================ */
(function () {
  'use strict';
  var S = window.Site;
  if (!S) return;
  var fs = S.fs;

  /* ---------- 十二平均律：音名 → 频率 ---------- */
  var NOTES = [
    { n: 'C4',  m: 60, b: false }, { n: 'C#4', m: 61, b: true  },
    { n: 'D4',  m: 62, b: false }, { n: 'D#4', m: 63, b: true  },
    { n: 'E4',  m: 64, b: false }, { n: 'F4',  m: 65, b: false },
    { n: 'F#4', m: 66, b: true  }, { n: 'G4',  m: 67, b: false },
    { n: 'G#4', m: 68, b: true  }, { n: 'A4',  m: 69, b: false },
    { n: 'A#4', m: 70, b: true  }, { n: 'B4',  m: 71, b: false },
    { n: 'C5',  m: 72, b: false }
  ];
  NOTES.forEach(function (k) {
    // 十二平均律：f = 440 × 2^((midi − 69) / 12)，A4(69) = 440 Hz
    k.f = 440 * Math.pow(2, (k.m - 69) / 12);
  });

  /* 频率 → 音名（用于上传音频的主频换算） */
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function hzToNote(hz) {
    if (!(hz > 0)) return null;
    var midi = 69 + 12 * Math.log(hz / 440) / Math.LN2;
    var m = Math.round(midi);
    var cents = Math.round((midi - m) * 100);
    return {
      name: NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1),
      cents: cents
    };
  }

  /* ---------- 画布尺寸缓存（避免每帧 getBoundingClientRect 引起重排） ---------- */
  var widths = {};
  function cssWidth(id, fallbackPad) {
    var cv = document.getElementById(id);
    var parent = cv && cv.parentNode;
    var pad = fallbackPad || 40;
    var current = parent
      ? Math.max(240, Math.round(parent.getBoundingClientRect().width) - pad)
      : 320;
    /* 视口在首次绘制后变窄时，不能继续沿用桌面端缓存宽度。 */
    if (widths[id]) return Math.min(widths[id], current);
    return measure(id, fallbackPad);
  }
  function measure(id, pad) {
    var cv = document.getElementById(id);
    if (!cv || !cv.parentNode) return 320;
    var w = Math.max(280, Math.round(cv.parentNode.getBoundingClientRect().width) - (pad || 40));
    widths[id] = w;
    return w;
  }
  function invalidateWidths() { widths = {}; }

  /* ---------- Web Audio ---------- */
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, master = null, analyser = null, freqData = null;
  var spectrumOn = false, cv = null, infoEl = null;
  var currentNote = null;
  var keyMap = {};
  var resizeRAF = null;
  var lastUpload = null;

  function ensureAudio() {
    if (actx) { if (actx.state === 'suspended') { try { actx.resume(); } catch (e) {} } return; }
    if (!AC) return;
    try {
      actx = new AC();
      master = actx.createGain(); master.gain.value = 1;
      analyser = actx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.55;
      master.connect(analyser);
      analyser.connect(actx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { actx = null; }
  }

  function noAudio() {
    var h = document.getElementById('audioHint');
    if (h) h.textContent = '当前环境无法播放声音（需 https / localhost / 直接打开文件）。频谱与音名对照仍可正常查看。';
    drawIdle();
  }

  /* ---------- 弹奏一个音（基频 + 2、3 次谐波，带包络） ---------- */
  function playNote(note, dur) {
    ensureAudio();
    if (!actx) { noAudio(); return; }
    dur = dur || 1.15;
    var t0 = actx.currentTime;

    var env = actx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.85, t0 + 0.012);
    env.gain.setValueAtTime(0.85, t0 + dur - 0.09);
    env.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    env.connect(master);

    // 基频 + 2 次 + 3 次谐波：让频谱上能看到"一个音 = 多个正弦成分"
    var parts = [[1, 1.0], [2, 0.40], [3, 0.20]];
    parts.forEach(function (p) {
      var o = actx.createOscillator();
      o.type = 'sine';
      o.frequency.value = note.f * p[0];
      var g = actx.createGain();
      g.gain.value = p[1];
      o.connect(g); g.connect(env);
      o.start(t0); o.stop(t0 + dur + 0.03);
    });

    currentNote = note;
    updateInfo(note);
    setActiveKey(note.n);
    if (!spectrumOn) { spectrumOn = true; loopSpectrum(); }
  }

  /* ---------- 实时频谱（analyser 真实 FFT） ---------- */
  var spectrumRAF = 0;
  function loopSpectrum() {
    if (!analyser || document.hidden) { spectrumRAF = 0; return; }
    drawSpectrum();
    spectrumRAF = requestAnimationFrame(loopSpectrum);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && analyser && spectrumOn && !spectrumRAF) loopSpectrum();
  });

  function drawSpectrum() {
    if (!analyser || !cv) return;
    analyser.getByteFrequencyData(freqData);
    var cssW = cssWidth('noteSpectrum', 40);
    var U = S.U(), fs = S.fs, H = Math.round(220 * U);
    var ctx = S.fitCanvas(cv, cssW, H);
    S.clearDark(ctx, cssW, H);
    var x0 = Math.round(22 * U), y0 = Math.round(22 * U), w = cssW - Math.round(44 * U), h = H - Math.round(48 * U);

    S.drawGrid(ctx, { x: x0, y: y0, w: w, h: h }, 8, 4);

    var nyq = actx.sampleRate / 2;
    var maxHz = 2600;                       // 覆盖 C5 的三次谐波（≈1569 Hz）并留余量
    var maxBin = Math.min(freqData.length,
      Math.max(2, Math.floor(maxHz / nyq * freqData.length)));
    var groups = 110, step = w / groups, i;
    var peak = 0, peakI = 0;
    for (i = 1; i < maxBin; i++) { if (freqData[i] > peak) { peak = freqData[i]; peakI = i; } }

    var maxV = 255;
    for (var g = 0; g < groups; g++) {
      var s = Math.floor(g * maxBin / groups), e = Math.floor((g + 1) * maxBin / groups);
      var mx = 0;
      for (var k = s; k < e; k++) if (freqData[k] > mx) mx = freqData[k];
      var bh = (mx / maxV) * h * 0.96;
      var fCenter = g * maxBin / groups / maxBin * maxHz;
      var isHarm = false;
      if (currentNote && peak > 20) {
        for (var hp = 1; hp <= 3; hp++) {
          if (Math.abs(fCenter - currentNote.f * hp) < (maxHz / groups) * 0.55) { isHarm = true; break; }
        }
      }
      ctx.fillStyle = isHarm ? S.C.blue : '#D3DCEC';
      ctx.fillRect(x0 + g * step + step * 0.18, y0 + h - bh, step * 0.64, bh);
    }

    // 零轴
    ctx.strokeStyle = S.C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();

    // 轴标注
    ctx.fillStyle = S.C.fg3; ctx.font = fs(11) + 'px "JetBrains Mono", monospace';
    ctx.fillText('0', x0, y0 + h + 18);
    ctx.fillText(Math.round(maxHz) + ' Hz', x0 + w - 46, y0 + h + 18);

    // 标题 + 主频
    var fHz = peakI * nyq / freqData.length;
    ctx.fillStyle = S.C.fg2; ctx.font = fs(12) + 'px sans-serif';
    ctx.fillText('实时频谱（FFT）　主频 ≈ ' + (peak > 20 ? Math.round(fHz) : '—') + ' Hz', x0, y0 - 7);
  }

  function drawIdle() {
    if (!cv) return;
    var cssW = cssWidth('noteSpectrum', 40);
    var U = S.U(), fs = S.fs, H = Math.round(220 * U);
    var ctx = S.fitCanvas(cv, cssW, H);
    S.clearDark(ctx, cssW, H);
    var x0 = Math.round(22 * U), y0 = Math.round(22 * U), w = cssW - Math.round(44 * U), h = H - Math.round(48 * U);
    S.drawGrid(ctx, { x: x0, y: y0, w: w, h: h }, 8, 4);
    ctx.strokeStyle = S.C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();
    ctx.fillStyle = S.C.fg4; ctx.font = fs(13) + 'px sans-serif';
    ctx.fillText('点击上方琴键，听音并观察它的实时频谱', x0 + 8, y0 + h / 2);
  }

  /* ---------- 信息读数与键盘高亮 ---------- */
  function updateInfo(note) {
    if (!infoEl) return;
    infoEl.innerHTML =
      '<strong style="font-size:18px">' + note.n + '</strong>' +
      '　频率 <span class="mono num-glow">' + note.f.toFixed(2) + ' Hz</span><br>' +
      '<span class="small muted">f = 440 × 2^(( ' + note.m + ' − 69 ) / 12) ≈ ' +
      note.f.toFixed(2) + ' Hz</span>';
  }

  function setActiveKey(name) {
    Object.keys(keyMap).forEach(function (k) {
      keyMap[k].classList.toggle('active', k === name);
      keyMap[k].setAttribute('aria-pressed', k === name ? 'true' : 'false');
    });
  }
  function clearActive() { setActiveKey('__none__'); }

  /* ---------- 听音辨频 小游戏 ---------- */
  var gameActive = false, gameTarget = null, gameCorrect = 0, gameNeeded = 3;

  function startGame() {
    gameActive = true;
    gameCorrect = 0;
    clearActive();
    updateGameUI();
    nextRound();
  }

  function nextRound() {
    gameTarget = NOTES[Math.floor(Math.random() * NOTES.length)];
    clearActive();
    var hint = document.getElementById('gameHint');
    var res = document.getElementById('gameResult');
    if (hint) hint.textContent = '点「播放题目」听一个音，再从琴键上找出它是哪一个。';
    if (res) { res.textContent = ''; res.style.color = ''; }
  }

  function gamePlay() {
    if (gameTarget) playNote(gameTarget, 1.25);
  }

  function guess(note) {
    if (!gameActive || !gameTarget) { playNote(note); return; }
    // 先奏响候选音，方便与题目 A/B 对比
    playNote(note, 0.9);
    var res = document.getElementById('gameResult');
    if (note.n === gameTarget.n) {
      gameCorrect++;
      setActiveKey(note.n);
      if (res) {
        res.style.color = S.C.green;
        res.textContent = '✓ 正确！主频 ≈ ' + gameTarget.f.toFixed(1) + ' Hz（' + gameTarget.n + '）';
      }
      updateGameUI();
      if (gameCorrect >= gameNeeded) {
        gameActive = false;
        if (res) {
          res.style.color = S.C.blue;
          res.innerHTML = '🎉 完成 ' + gameNeeded + ' / ' + gameNeeded +
            '！你刚用"耳朵 + 频谱"完成了「听音辨频」——这正是落谱在做的事。';
        }
        if (!S.questDone('note_lab')) {
          S.completeQuest('note_lab', '你用耳朵和频谱完成了「听音辨频」');
        }
      } else {
        setTimeout(nextRound, 950);
      }
    } else {
      clearActive();
      if (res) {
        res.style.color = S.C.rose;
        res.textContent = '✗ 不是 ' + note.n + '。再听一次题目，注意它的高低。';
      }
    }
  }

  function updateGameUI() {
    var p = document.getElementById('gameProgress');
    if (p) p.textContent = '已答对 ' + gameCorrect + ' / ' + gameNeeded;
  }

  /* ============================================================
     真实数据实验：上传浏览器支持的音频 → 用本页自带 FFT 做频谱分析
     ------------------------------------------------------------
     流程：File → decodeAudioData → 抽取能量最大的 2048 点窗口
     → Hann 窗 → fftComplex（站内实现，非浏览器黑盒）
     → 时域波形 + 频谱 + 主频 → 换算音名
     ============================================================ */
  var upCvWave = null, upCvSpec = null, upInfo = null, upStatus = null;

  function uploadMsg(txt, kind) {
    if (!upStatus) return;
    upStatus.textContent = txt;
    upStatus.style.color = kind === 'err' ? S.C.rose
      : kind === 'ok' ? S.C.green : S.C.fg3;
  }

  function drawUploadPlaceholder() {
    [['upWave', '选择一段音频，这里显示它的时域波形'],
     ['upSpec', '以及对它做 FFT 后的频谱']].forEach(function (pair) {
      var c = document.getElementById(pair[0]);
      if (!c) return;
      var w = cssWidth(pair[0], 40), h = 160;
      var ctx = S.fitCanvas(c, w, h);
      S.clearDark(ctx, w, h);
      ctx.strokeStyle = S.C.axis; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(22, h / 2 + 8); ctx.lineTo(w - 22, h / 2 + 8); ctx.stroke();
      ctx.fillStyle = S.C.fg4; ctx.font = fs(13) + 'px sans-serif';
      ctx.fillText(pair[1], 30, h / 2 - 4);
    });
  }

  /* 从整段音频里挑出能量最高的一个 2048 帧。
     短文件不足 2048 点时固定返回 2048 点，并在后续频谱计算中补零，
     保证交给基-2 FFT 的长度始终是 2 的幂。 */
  function bestFrame(data, N) {
    if (data.length < N) return { off: 0, len: N, actualLen: data.length };
    var bestOff = 0, bestE = -1;
    var step = Math.max(1, Math.floor(data.length / 400)); // 最多扫 400 帧，够用且快
    for (var off = 0; off + N <= data.length; off += step) {
      var e = 0;
      for (var i = 0; i < N; i += 4) e += data[off + i] * data[off + i];
      if (e > bestE) { bestE = e; bestOff = off; }
    }
    return { off: bestOff, len: N, actualLen: N };
  }

  function renderUpload(channel, sampleRate) {
    var N = 2048;
    lastUpload = { channel: channel, sampleRate: sampleRate };
    var fr = bestFrame(channel, N);
    var actualLen = Math.min(fr.actualLen, Math.max(0, channel.length - fr.off));
    if (!actualLen) throw new Error('音频没有可分析的采样数据。');

    /* 时域波形：抽 220 点画包络，只在实际数据范围内取样 */
    var pts = 220, wave = new Array(pts), stepI = actualLen / pts;
    for (var i = 0; i < pts; i++) {
      var s0 = fr.off + Math.floor(i * stepI);
      var s1 = Math.min(fr.off + actualLen, fr.off + Math.max(i + 1, Math.floor((i + 1) * stepI)));
      var peak = 0;
      for (var j = s0; j < s1; j++) {
        var v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      wave[i] = peak;
    }

    /* 频谱：实际样点乘 Hann 窗，不足 2048 点的部分补零，保持基-2 长度 */
    var seg = new Array(N), im = new Array(N);
    for (var k = 0; k < N; k++) {
      var win = k < actualLen && actualLen > 1
        ? 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (actualLen - 1))
        : 0;
      seg[k] = k < actualLen ? (channel[fr.off + k] || 0) * win : 0;
      im[k] = 0;
    }
    var f = S.fftComplex(seg, im);
    var half = Math.floor(N / 2);
    var mags = new Array(half);
    for (var m = 0; m < half; m++) {
      var re = f.result.re[m], imv = f.result.im[m];
      mags[m] = Math.sqrt(re * re + imv * imv) / N;
    }

    /* 主频（跳过直流）。
       直接取最高的那根 bin 会把主频"量化"到 21.5 Hz 的整数倍
       （A4 会被读成 −37 音分）。这里对峰值附近三根 bin 做抛物线插值，
       把频率估计细化到远小于一个 bin 的精度。 */
    var peakI = 1, peakV = 0;
    for (var m2 = 2; m2 < half; m2++) {
      if (mags[m2] > peakV) { peakV = mags[m2]; peakI = m2; }
    }
    var binHz = sampleRate / N;
    var peakHz = peakI * binHz;
    if (peakI > 0 && peakI < half - 1) {
      var y0 = mags[peakI - 1], y1 = mags[peakI], y2 = mags[peakI + 1];
      var denom = 2 * (2 * y1 - y0 - y2);
      if (denom !== 0) {
        var delta = (y2 - y0) / denom;          // 峰值在左右两根之间的偏移量
        if (delta > -1 && delta < 1) peakHz = (peakI + delta) * binHz;
      }
    }
    var note = hzToNote(peakHz);

    /* ---- 画波形 ---- */
    var wW = cssWidth('upWave', 40), hW = 160;
    var cw = S.fitCanvas(upCvWave, wW, hW);
    S.clearDark(cw, wW, hW);
    S.drawStems(cw, wave, { x: 22, y: 26, w: wW - 44, h: 104 }, { color: S.C.blue });
    cw.fillStyle = S.C.fg2; cw.font = fs(12) + 'px sans-serif';
    cw.fillText('时域 · 波形包络（实际样点：' + actualLen + '）', 22, 16);
    cw.fillStyle = S.C.fg3; cw.font = fs(11) + 'px "JetBrains Mono", monospace';
    cw.fillText('采样率 ' + Math.round(sampleRate) + ' Hz', 22, hW - 8);

    /* ---- 画频谱 ---- */
    var wS = cssWidth('upSpec', 40), hS = 160;
    var cs = S.fitCanvas(upCvSpec, wS, hS);
    S.clearDark(cs, wS, hS);
    var maxHz = Math.min(sampleRate / 2, 8000);
    var use = Math.max(2, Math.floor(maxHz / binHz));
    var view = mags.slice(0, use);
    var hl = peakI < view.length ? [peakI] : [];
    S.drawBars(cs, view, { x: 22, y: 26, w: wS - 44, h: 104 }, { highlight: hl });
    cs.fillStyle = S.C.fg2; cs.font = fs(12) + 'px sans-serif';
    cs.fillText('频域 · 本页自带的基-2 FFT（Hann 窗）', 22, 16);
    cs.fillStyle = S.C.fg3; cs.font = fs(11) + 'px "JetBrains Mono", monospace';
    cs.fillText('0', 22, hS - 8);
    cs.fillText(Math.round(maxHz) + ' Hz', wS - 70, hS - 8);

    /* ---- 读数 ---- */
    if (upInfo) {
      var tone = note
        ? '最接近的音：<strong>' + note.name + '</strong>' +
          (Math.abs(note.cents) >= 5 ? '（偏差 ' + (note.cents > 0 ? '+' : '') + note.cents + ' 音分）' : '（几乎完全吻合）')
        : '—';
      upInfo.innerHTML =
        '主频 <span class="mono num-glow">' + (peakHz > 0 ? peakHz.toFixed(1) : '—') + ' Hz</span>' +
        '　·　' + tone +
        '<br><span class="small muted">频率分辨率 ' + binHz.toFixed(1) +
        ' Hz（= 采样率 ÷ 帧长）。这正是第 1 章「换到频域就看得见」的意义：' +
        '时域里挤在一起的一团，在频域里是一根根能读出频率的柱子。</span>';
    }
  }

  function handleFile(file) {
    if (!file) return;
    if (!AC) { uploadMsg('当前环境不支持音频解码（需 https / localhost）。', 'err'); return; }
    uploadMsg('正在解码「' + file.name + '」…');
    ensureAudio();
    if (!actx) { uploadMsg('无法创建音频上下文。', 'err'); return; }

    var reader = new FileReader();
    reader.onload = function (e) {
      var ab = e.target.result;
      var handled = false;
      var done = function (buf) {
        if (handled) return;
        handled = true;
        if (!buf || !buf.length) { uploadMsg('这个文件里没有可解码的音频数据。', 'err'); return; }
        try {
          renderUpload(buf.getChannelData(0), buf.sampleRate);
          uploadMsg('✓ 已分析「' + file.name + '」', 'ok');
          if (!S.questDone('note_upload')) {
            S.completeQuest('note_upload', '你用自己的音频跑了一次真实的傅里叶变换！');
          }
        } catch (err) {
          uploadMsg('分析时出错：' + (err && err.message ? err.message : '未知错误'), 'err');
        }
      };
      var p;
      try { p = actx.decodeAudioData(ab, done, function () {
        uploadMsg('无法解码这个音频格式（建议 mp3 / wav / m4a / ogg）。', 'err');
      }); }
      catch (e) { uploadMsg('无法解码这个音频格式。', 'err'); return; }
      if (p && p.then) p.then(done)['catch'](function () {
        if (!handled) uploadMsg('无法解码这个音频格式。', 'err');
      });
    };
    reader.onerror = function () { uploadMsg('读取文件失败。', 'err'); };
    reader.readAsArrayBuffer(file);
  }

  function setupUpload() {
    upCvWave = document.getElementById('upWave');
    upCvSpec = document.getElementById('upSpec');
    upInfo = document.getElementById('upInfo');
    upStatus = document.getElementById('upStatus');
    if (!upCvWave || !upCvSpec) return;

    var input = document.getElementById('audioFile');
    var pick = document.getElementById('audioPick');
    if (pick && input) {
      pick.addEventListener('click', function () { input.click(); });
      pick.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
    }
    if (input) {
      input.addEventListener('change', function () {
        if (input.files && input.files[0]) handleFile(input.files[0]);
      });
    }
    drawUploadPlaceholder();
  }

  /* ---------- 构建键盘 ---------- */
  function buildPiano() {
    var piano = document.getElementById('piano');
    if (!piano) return;
    var whiteCount = 0;
    NOTES.forEach(function (note) {
      if (!note.b) whiteCount++;
    });
    var whiteIdx = 0;
    NOTES.forEach(function (note) {
      var el = document.createElement('div');
      el.className = 'key-' + (note.b ? 'black' : 'white');
      el.innerHTML = '<span>' + note.n + '</span>';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-pressed', 'false');
      el.setAttribute('aria-label', note.n + '，' + note.f.toFixed(1) + ' 赫兹');
      el.addEventListener('click', function () {
        if (gameActive) guess(note); else playNote(note);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (gameActive) guess(note); else playNote(note); }
      });
      keyMap[note.n] = el;

      if (note.b) {
        // 黑键挂在它前面的白键右侧
        var leftPct = (whiteIdx) * (100 / whiteCount) - 4;
        el.style.left = leftPct + '%';
        piano.appendChild(el);
      } else {
        piano.appendChild(el);
        whiteIdx++;
      }
    });
  }

  /* ---------- 初始化 ---------- */
  function init() {
    cv = document.getElementById('noteSpectrum');
    infoEl = document.getElementById('noteInfo');
    buildPiano();
    setupUpload();
    drawIdle();

    var playBtn = document.getElementById('gamePlay');
    if (playBtn) playBtn.addEventListener('click', gamePlay);
    var startBtn = document.getElementById('gameStart');
    if (startBtn) startBtn.addEventListener('click', function () {
      startGame();
      if (playBtn) playBtn.focus();
    });

    var onResize = function () {
      invalidateWidths();
      if (analyser && spectrumOn) drawSpectrum(); else drawIdle();
      if (lastUpload) renderUpload(lastUpload.channel, lastUpload.sampleRate);
      else drawUploadPlaceholder();
    };
    window.addEventListener('resize', function () {
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(onResize);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();