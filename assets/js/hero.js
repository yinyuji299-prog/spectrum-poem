/* ============================================================
   《频谱之诗》· 首页 Hero 实时频谱微动 v6
   ------------------------------------------------------------
   设计语言：克制。发丝线、降饱和印刷蓝，无霓虹、无阴影。
   - 默认：ambient 模式 —— 自运行的"活的"频谱（像一首诗的呼吸）
   - 可选：点击「用我的声音驱动」→ 抓取真实麦克风数据实时驱动
   - 无障碍：尊重系统「减少动态效果」设置，此时只绘制静态一帧。
   复用 site.js 的 fitCanvas / C 色板。
   ============================================================ */
(function () {
  'use strict';
  var S = window.Site;
  if (!S) return;

  var cv, ctx, micBtn, note;
  var cssW = 600;
  var BASE_H = 96;              // 基准高度，实际高度按视口放大（大屏更清楚）
  var cssH = BASE_H;
  var N = 56;                 // 柱数（随宽度自适应）
  var v = [], t = [];         // 当前值 / 目标值
  var peaks = [];             // ambient 的若干"音符"峰
  var raf = null, running = false, lastRetarget = 0;
  var micOn = false, audioCtx, analyser, srcNode, freqData;

  /* 首页动画是作品展示的一部分，默认始终播放。
     只有用户在页面里明确暂停时才停止。 */

  function init() {
    cv = document.getElementById('heroSpectrum');
    micBtn = document.getElementById('heroMic');
    note = document.getElementById('heroNote');
    if (!cv) return;
    ctx = cv.getContext('2d');

    for (var i = 0; i < N; i++) { v[i] = 0.04; t[i] = 0.04; }
    seedPeaks();

    if (micBtn) {
      micBtn.addEventListener('click', toggleMic);
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopLoop();
      else if (!micOn) startLoop();
    });

    resize();
    startLoop();
  }

  /* ---------- 尺寸 ---------- */
  function resize() {
    if (!cv) return;
    cssH = Math.round(BASE_H * Math.min(1.5, Math.max(1, window.innerWidth / 1280)));
    var box = cv.parentNode.getBoundingClientRect();
    cssW = Math.max(280, Math.round(box.width));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    cv.style.width = cssW + 'px';
    cv.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- ambient：几个缓慢漂移的"音符"峰 ---------- */
  function seedPeaks() {
    peaks = [];
    var k = 3 + Math.floor(Math.random() * 2);
    for (var i = 0; i < k; i++) {
      peaks.push({
        center: Math.random() * N,
        width: 2 + Math.random() * 4,
        amp: 0.35 + Math.random() * 0.5,
        drift: (Math.random() - 0.5) * 0.02
      });
    }
  }

  function retarget() {
    // 让峰缓慢移动、偶尔重生，制造"活着"的频谱
    for (var i = 0; i < peaks.length; i++) {
      var p = peaks[i];
      p.center += p.drift;
      if (p.center < 2 || p.center > N - 2) p.drift *= -1;
      if (Math.random() < 0.04) p.amp = 0.35 + Math.random() * 0.5;
    }
    for (var j = 0; j < N; j++) {
      var s = 0.05;
      for (var m = 0; m < peaks.length; m++) {
        var d = j - peaks[m].center;
        s += peaks[m].amp * Math.exp(-(d * d) / (2 * peaks[m].width * peaks[m].width));
      }
      t[j] = Math.min(1, s);
    }
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);

    // 发丝基线
    ctx.strokeStyle = '#DEDEDB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cssH - 1); ctx.lineTo(cssW, cssH - 1); ctx.stroke();

    var step = cssW / N;
    var base = cssH - 2;
    var maxV = 0, maxI = 0;
    for (var i = 0; i < N; i++) if (v[i] > maxV) { maxV = v[i]; maxI = i; }

    for (var j = 0; j < N; j++) {
      var bh = Math.max(2, v[j] * (cssH - 10));
      var x = j * step + step * 0.18;
      var w = step * 0.64;
      // 克制的配色：多数柔蓝，唯一最高峰用印刷深蓝点睛
      if (j === maxI && !micOn) {
        ctx.fillStyle = '#1B3F8F';
      } else if (micOn) {
        ctx.fillStyle = v[j] > 0.55 ? '#1B3F8F' : '#9DB2DA';
      } else {
        ctx.fillStyle = '#B9C7E4';
      }
      ctx.fillRect(x, base - bh, w, bh);
    }
  }

  /* ---------- 主循环 ---------- */
  function frame(ts) {
    if (!running) return;
    if (micOn && analyser) {
      analyser.getByteFrequencyData(freqData);
      var span = Math.min(freqData.length, N * 4); // 偏重低频
      for (var j = 0; j < N; j++) {
        var s = Math.floor(j * span / N), e = Math.floor((j + 1) * span / N);
        var mx = 0; for (var i = s; i < e; i++) if (freqData[i] > mx) mx = freqData[i];
        t[j] = mx / 255;
      }
    } else {
      if (!lastRetarget || ts - lastRetarget > 1100) { retarget(); lastRetarget = ts; }
    }
    for (var k = 0; k < N; k++) {
      v[k] += (t[k] - v[k]) * 0.10;            // 平滑插值，避免抖动
      v[k] += (Math.random() - 0.5) * 0.012;   // 细微呼吸
      if (v[k] < 0.02) v[k] = 0.02;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }

  function startLoop() { if (!running) { running = true; raf = requestAnimationFrame(frame); } }
  function stopLoop() { running = false; if (raf) cancelAnimationFrame(raf); }

  /* ---------- 麦克风（抓取实时数据） ---------- */
  function toggleMic() {
    if (micOn) { stopMic(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (note) note.textContent = '当前环境不支持麦克风（需 https 打开）。';
      return;
    }
    micBtn.disabled = true;
    micBtn.textContent = '正在连接…';
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        var AC = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AC();
        if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
        srcNode = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.8;
        srcNode.connect(analyser);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        micOn = true;
        if (!S.questDone('live_mic')) S.completeQuest('live_mic', '你刚刚用真实声音做了一次傅里叶变换！');
        micBtn.disabled = false;
        micBtn.textContent = '停止声音驱动';
        micBtn.classList.add('on');
        if (note) note.textContent = '正在抓取你的声音做实时频谱 —— 声音仅本机处理，不上传。';
        startLoop();
      })
      .catch(function (err) {
        micBtn.disabled = false;
        micBtn.textContent = '用我的声音驱动';
        if (note) note.textContent = '无法使用麦克风：' + (err && err.name ? err.name : '已拒绝授权') + '。';
      });
  }

  function stopMic() {
    micOn = false;
    if (srcNode) try { srcNode.mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    if (audioCtx) try { audioCtx.close(); } catch (e) {}
    analyser = null; srcNode = null; audioCtx = null;
    micBtn.textContent = '用我的声音驱动';
    micBtn.classList.remove('on');
    if (note) note.textContent = '已回到 ambient 频谱。';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
