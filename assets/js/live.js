/* ============================================================
   《频谱之诗》· 真实交互实验 v5
   ------------------------------------------------------------
   复用 site.js 的 Site API：
     fitCanvas / clearDark / drawBars / drawStems / glowLine / fftComplex / C
   两个实验：
     A. 麦克风实时频谱（Web Audio API，真实数据）
     B. 谐波叠加实验室（合成信号 → 波形 + 频谱）
   设计语言：纸面 + 发丝线，无阴影；沿用印刷色板。
   ============================================================ */
(function () {
  'use strict';
  var S = window.Site;
  if (!S) return;

  /* 画布宽度缓存：动画循环里每帧调用 getBoundingClientRect 会强制重排，
     在移动端表现为明显卡顿。这里只在首次与 resize 时测量。 */
  var _wCache = {};
  function _measure(id) {
    var cv = document.getElementById(id);
    if (!cv || !cv.parentNode) return 320;
    _wCache[id] = Math.max(260, Math.round(cv.parentNode.getBoundingClientRect().width) - 48);
    return _wCache[id];
  }
  function fit(cv, cssH) {
    var h = Math.round(cssH * S.U());     // 高度随屏幕放大（大屏看得更清楚）
    var id = cv.id;
    var cssW = _wCache[id] || _measure(id);
    var ctx = S.fitCanvas(cv, cssW, h);
    return { ctx: ctx, w: cssW, h: h };
  }
  function invalidateWidths() { _wCache = {}; }

  /* ============ A. 麦克风实时频谱 ============ */
  var micCanvas, micBtn, micHint, micFreqLabel;
  var audioCtx, analyser, srcNode, freqData, micRAF, micOn = false;

  function setupMic() {
    micCanvas = document.getElementById('micCanvas');
    micBtn = document.getElementById('micBtn');
    micHint = document.getElementById('micHint');
    micFreqLabel = document.getElementById('micFreq');
    if (!micCanvas || !micBtn) return;

    micBtn.addEventListener('click', function () {
      if (micOn) { stopMic(); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        micHint.textContent = '当前环境不支持麦克风（需用 https 或 localhost 打开）。你可以直接看下方的合成实验室。';
        return;
      }
      micBtn.disabled = true;
      micBtn.textContent = '正在请求麦克风…';
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(function (stream) {
          var AC = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AC();
          if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
          srcNode = audioCtx.createMediaStreamSource(stream);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.78;
          srcNode.connect(analyser);
          freqData = new Uint8Array(analyser.frequencyBinCount);
          micOn = true;
          if (!S.questDone('live_mic')) S.completeQuest('live_mic', '你刚刚用真实声音做了一次傅里叶变换！');
          micBtn.disabled = false;
          micBtn.textContent = '关闭麦克风';
          micBtn.classList.add('accent');
          micHint.textContent = '正在实时分析你的声音 —— 对它做真正的傅里叶变换。声音只在本机处理，不会上传。';
          loopMic();
        })
        .catch(function (err) {
          micBtn.disabled = false;
          micBtn.textContent = '开启麦克风做实时频谱';
          micHint.textContent = '无法使用麦克风：' +
            (err && err.name ? err.name : '已拒绝授权') + '。请检查浏览器权限后重试。';
        });
    });

    window.addEventListener('resize', function () {
      invalidateWidths();
      if (micOn) drawMic();
    });
  }

  function loopMic() {
    if (!micOn || document.hidden) { micRAF = 0; return; }
    drawMic();
    micRAF = requestAnimationFrame(loopMic);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && micOn && !micRAF) loopMic();
  });

  function drawMic() {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqData);
    var f = fit(micCanvas, 210), ctx = f.ctx, cssW = f.w;
    S.clearDark(ctx, cssW, f.h);

    // 取前 ~5.5kHz（语音主要能量），分组为 80 根柱
    var span = Math.min(freqData.length, 256);
    var groups = 80, bars = [];
    for (var g = 0; g < groups; g++) {
      var s = Math.floor(g * span / groups), e = Math.floor((g + 1) * span / groups);
      var mx = 0; for (var i = s; i < e; i++) if (freqData[i] > mx) mx = freqData[i];
      bars.push(mx / 255);
    }
    var U = S.U();
    S.drawBars(ctx, bars, { x: Math.round(22 * U), y: Math.round(18 * U), w: cssW - Math.round(44 * U), h: Math.round(174 * U) }, {});

    // 主频
    var peak = 0, peakI = 0;
    for (var k = 2; k < span; k++) { if (freqData[k] > peak) { peak = freqData[k]; peakI = k; } }
    if (micFreqLabel) {
      micFreqLabel.textContent = (peak > 12)
        ? Math.round(peakI * audioCtx.sampleRate / analyser.fftSize) + ' Hz'
        : '—';
    }
  }

  function stopMic() {
    micOn = false;
    if (micRAF) cancelAnimationFrame(micRAF);
    if (srcNode) try { srcNode.mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    if (audioCtx) try { audioCtx.close(); } catch (e) {}
    analyser = null; srcNode = null; audioCtx = null;
    micBtn.textContent = '开启麦克风做实时频谱';
    micBtn.classList.remove('accent');
    micHint.textContent = '点上方按钮，对它做一次真正的傅里叶变换。声音只在你的浏览器里处理，不会上传。';
    if (micFreqLabel) micFreqLabel.textContent = '—';
  }

  /* ============ B. 谐波叠加实验室 ============ */
  var synWave, synSpec;
  var synN = 256;
  var HARM = [1, 3, 5, 7]; // 谐波次数

  function setupSynth() {
    synWave = document.getElementById('synWave');
    synSpec = document.getElementById('synSpec');
    if (!synWave || !synSpec) return;

    HARM.forEach(function (k) {
      var el = document.getElementById('h' + k);
      if (el) el.addEventListener('input', function () {
        drawSynth();
        if (!S.questDone('live_harm')) S.completeQuest('live_harm', '你亲手拼出了一个信号 —— 这就是傅里叶合成！');
      });
    });
    var preset = document.getElementById('synSquare');
    if (preset) preset.addEventListener('click', function () {
      // 方波傅里叶级数：A_k = 4/(π·k)，k 取奇次
      HARM.forEach(function (k) {
        var el = document.getElementById('h' + k);
        if (el) el.value = (4 / (Math.PI * k)).toFixed(3);
      });
      drawSynth();
      if (!S.questDone('live_harm')) S.completeQuest('live_harm', '你亲手拼出了一个信号 —— 这就是傅里叶合成！');
    });

    window.addEventListener('resize', function () { invalidateWidths(); drawSynth(); });
    drawSynth();
  }

  function buildSignal() {
    var sig = new Array(synN);
    for (var n = 0; n < synN; n++) {
      var t = n / synN, v = 0;
      HARM.forEach(function (k) {
        var el = document.getElementById('h' + k);
        var a = el ? parseFloat(el.value) : 0;
        v += a * Math.cos(2 * Math.PI * k * t);
      });
      sig[n] = v;
    }
    return sig;
  }

  function drawSynth() {
    var U2 = S.U(), H2 = Math.round(200 * U2);
    var fw = fit(synWave, 200), wctx = fw.ctx, cssW = fw.w;
    S.clearDark(wctx, cssW, H2);
    var sig = buildSignal();

    var max = Math.max.apply(null, sig.map(Math.abs)) || 1;
    max *= 1.15;
    var padY = Math.round(18 * U2), mid = padY + (H2 - 2 * padY) / 2, pts = [];
    for (var n = 0; n < synN; n++) {
      var x = Math.round(22 * U2) + (n + 0.5) / synN * (cssW - Math.round(44 * U2));
      var y = mid - (sig[n] / max) * ((H2 - 2 * padY) / 2 - 10 * U2);
      pts.push({ x: x, y: y });
    }
    S.glowLine(wctx, pts, S.C.blue, 2.2);

    // 频谱（只显示前 32 根，覆盖到 7 次谐波）
    var f = S.fftComplex(sig, sig.map(function () { return 0; }));
    var mags = f.result.re.map(function (v, i) {
      return Math.sqrt(v * v + f.result.im[i] * f.result.im[i]);
    });
    var specVals = mags.slice(0, 32);
    var hl = []; HARM.forEach(function (k) { if (k < specVals.length) hl.push(k); });

    var fctx = S.fitCanvas(synSpec, cssW, H2);
    S.clearDark(fctx, cssW, H2);
    S.drawBars(fctx, specVals, { x: Math.round(22 * U2), y: Math.round(18 * U2), w: cssW - Math.round(44 * U2), h: Math.round(174 * U2) }, { highlight: hl });
  }

  /* ============ 初始化 ============ */
  function init() { setupMic(); setupSynth(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
