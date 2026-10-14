(function () {
  'use strict';
  var S = window.Site;
  if (!S) return;
  var split = document.getElementById('runSplit');
  var cost = document.getElementById('runCost');
  var fly = document.getElementById('runButterfly');
  if (!split || !cost || !fly) return;

  var mix = document.getElementById('runMix');
  var mixLabel = document.getElementById('runMixLabel');
  var nSlider = document.getElementById('runN');
  var ratio = document.getElementById('runRatio');
  var stepBtn = document.getElementById('runStep');
  var stepText = document.getElementById('runStepText');
  var step = 0;
  var notes = ['第 1 级：相邻两点合并。', '第 2 级：跨两个点合并。', '第 3 级：得到 8 点频谱。'];

  function size(cv) {
    /* 以父容器为准，避免上一次桌面绘制留下的内联宽度撑破移动端。 */
    var host = cv.parentNode;
    var r = host ? host.getBoundingClientRect() : cv.getBoundingClientRect();
    var w = Math.max(320, Math.round(r.width));
    var h = Math.max(280, Math.round(r.height));
    var ctx = S.fitCanvas(cv, w, h);
    return { ctx: ctx, w: w, h: h };
  }
  function dark(ctx, w, h) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
  }
  function wave(ctx, values, box, color) {
    ctx.beginPath();
    values.forEach(function (v, i) {
      var x = box.x + box.w * i / (values.length - 1);
      var y = box.y + box.h / 2 - v * box.h * 0.36;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  function drawSplit() {
    var view = size(split), ctx = view.ctx, w = view.w, h = view.h;
    dark(ctx, w, h);
    var amount = Number(mix.value) / 100;
    var left = [];
    for (var i = 0; i < 180; i++) {
      var a = Math.sin(i / 9);
      var b = amount * 0.65 * Math.sin(i / 4.2);
      var c = amount * 0.35 * Math.sin(i / 2.4);
      left.push(a + b + c);
    }
    var right = [1, amount * 0.65, amount * 0.35, 0.08];
    wave(ctx, left, { x: 28, y: 30, w: w * 0.48, h: h - 60 }, '#fff');
    right.forEach(function (v, i) {
      var bh = v * (h - 100);
      ctx.fillStyle = i === 3 ? '#444' : '#fff';
      ctx.fillRect(w * 0.62 + i * 58, h - 40 - bh, 28, bh);
    });
    if (mixLabel) mixLabel.textContent = mix.value + '%';
  }

  function drawCost() {
    var view = size(cost), ctx = view.ctx, w = view.w, h = view.h;
    dark(ctx, w, h);
    var n = Math.pow(2, Number(nSlider.value));
    var dft = n * n, fft = Math.round(n * Math.log2(n));
    var max = Math.log10(Math.pow(2, 12) * Math.pow(2, 12));
    [[dft, '#4C6FFF', '旧办法'], [fft, '#fff', 'FFT']].forEach(function (item, i) {
      var y = 90 + i * 120;
      ctx.fillStyle = '#aaa';
      ctx.font = '16px sans-serif';
      ctx.fillText(item[2] + '   ' + item[0].toLocaleString(), 36, y - 12);
      ctx.fillStyle = item[1];
      ctx.fillRect(36, y, Math.max(18, Math.log10(item[0]) / max * (w - 90)), 48);
    });
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText(n + ' 个采样点', 36, 48);
    if (ratio) ratio.textContent = Math.round(dft / fft) + '×';
  }

  function drawFly() {
    var view = size(fly), ctx = view.ctx, w = view.w, h = view.h;
    dark(ctx, w, h);
    var cols = 4;
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < 8; r++) {
        var x = 70 + c * ((w - 150) / 3);
        var y = 40 + r * ((h - 70) / 7);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 6.28);
        ctx.fill();
        if (c <= step) {
          var pair = r ^ (1 << c);
          if (pair > r) {
            var y2 = 40 + pair * ((h - 70) / 7);
            ctx.strokeStyle = 'rgba(255,255,255,.55)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (w - 150) / 3, y2);
            ctx.stroke();
          }
        }
      }
    }
    if (stepText) stepText.textContent = notes[step];
  }

  function paint() { drawSplit(); drawCost(); drawFly(); }
  mix.addEventListener('input', drawSplit);
  nSlider.addEventListener('input', drawCost);
  stepBtn.addEventListener('click', function () {
    step = (step + 1) % 3;
    drawFly();
  });
  window.addEventListener('resize', paint);
  paint();
})();
