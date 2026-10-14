/* ============================================================
   章节 3 · 8 点 FFT 蝶形舞台  v3（明亮科普 × 浅色高级）
   ============================================================ */
(function () {
  'use strict';
  var S = window.Site, C = S.C;

  var N = 8;
  var SVGNS = 'http://www.w3.org/2000/svg';

  // 布局
  var W = 1080, H = 430;
  var PAD_L = 80, PAD_R = 80, PAD_T = 62, PAD_B = 52;
  var COL_GAP = (W - PAD_L - PAD_R) / 3;
  var ROW_GAP = (H - PAD_T - PAD_B) / (N - 1);

  var svg, state;

  function colX(c) { return PAD_L + c * COL_GAP; }
  function rowY(r) { return PAD_T + r * ROW_GAP; }

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag), k;
    for (k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ---------- 输入信号 ---------- */
  function buildSignal(freq, kind) {
    var re = [], im = [], n;
    for (n = 0; n < N; n++) {
      var t = n / N, v;
      if (kind === 'impulse') v = (n === 0) ? 1 : 0;
      else if (kind === 'square') v = (n < N / 2) ? 1 : -1;
      else if (kind === 'dc') v = 1;
      else v = Math.cos(2 * Math.PI * freq * t);
      re.push(v); im.push(0);
    }
    return { re: re, im: im };
  }

  /* ---------- 静态框架 ---------- */
  function buildFrame() {
    var g = el('g', {});
    var titles = ['输入 x[n]', '第 1 级', '第 2 级', '第 3 级 · X[k]'];
    for (var c = 0; c < 4; c++) {
      g.appendChild(el('text', {
        x: colX(c), y: 30, 'text-anchor': 'middle',
        'font-size': 12.5, 'font-weight': 700, fill: C.fg2,
        'letter-spacing': '0.08em'
      })).textContent = titles[c];
    }
    for (var c2 = 1; c2 <= 3; c2++) {
      g.appendChild(el('line', {
        x1: colX(c2) - COL_GAP / 2, y1: PAD_T - 22,
        x2: colX(c2) - COL_GAP / 2, y2: H - PAD_B + 22,
        stroke: '#DEDEDB', 'stroke-width': 1, 'stroke-dasharray': '3 5'
      }));
    }
    return g;
  }

  /* ---------- 半径 ---------- */
  var RAD_S = 15, RAD_L = 24;
  function radiusFor(text) { return text.length > 4 ? RAD_L : RAD_S; }

  /* ---------- 节点 ---------- */
  function nodeLabel(c, r, text, cls) {
    var g = el('g', {});
    var rad = radiusFor(text);
    var fill, stroke, tcol, sw = 1.6;

    if (cls === 'hl') {                    // 当前活动级
      fill = '#EEF1F9';
      stroke = C.blue; tcol = C.blue; sw = 2.4;
    } else if (cls === 'out') {            // 最终输出
      fill = '#EDF5F0';
      stroke = C.green; tcol = '#2C6B4C'; sw = 2.4;
    } else if (cls === 'done') {           // 已完成的中间级
      fill = '#F8FAFC';
      stroke = '#CBD5E1'; tcol = C.fg2;
    } else {                               // 输入列
      fill = '#F2F0F8';
      stroke = '#C4B5FD'; tcol = '#4E3F86';
    }

    g.appendChild(el('circle', {
      cx: colX(c), cy: rowY(r), r: rad,
      fill: fill, stroke: stroke, 'stroke-width': sw
    }));
    var t = el('text', {
      x: colX(c), y: rowY(r) + 3.6, 'text-anchor': 'middle',
      'font-size': rad > RAD_S ? 9.5 : 11,
      'font-family': "'JetBrains Mono', monospace",
      fill: tcol
    });
    t.textContent = text;
    g.appendChild(t);
    return g;
  }

  /* ---------- 蝶形连线（2 条交叉对角线） ---------- */
  function butterflyLinks(cFrom, pairs, mode, radFrom, radTo) {
    // mode: 'pending' | 'active' | 'done'
    var g = el('g', {});
    var stroke, w, op, dashA, dashB;
    if (mode === 'pending') {
      stroke = '#E2E8F0'; w = 1.6; op = 1; dashA = '4 4'; dashB = '4 4';
    } else if (mode === 'active') {
      stroke = C.blue; w = 2.6; op = 1; dashA = '7 5'; dashB = 'none';
    } else {
      stroke = '#B9C7E4'; w = 1.8; op = 1; dashA = '4 4'; dashB = 'none';
    }

    pairs.forEach(function (p) {
      var a = p[0], b = p[1];
      var yTop = rowY(a), yBot = rowY(b);
      var xa = colX(cFrom) + radFrom[a],  xb = colX(cFrom) + radFrom[b];
      var Xa = colX(cFrom + 1) - radTo[a], Xb = colX(cFrom + 1) - radTo[b];
      var cxa = xa + (Xb - xa) * 0.45, cXa = Xb - (Xb - xa) * 0.45;
      var cxb = xb + (Xa - xb) * 0.45, cXb = Xa - (Xa - xb) * 0.45;

      function path(d, dash) {
        var at = {
          d: d, fill: 'none', stroke: stroke, 'stroke-width': w,
          'stroke-linecap': 'round', opacity: op
        };
        if (dash !== 'none') at['stroke-dasharray'] = dash;
        g.appendChild(el('path', at));
      }

      path('M' + xa + ' ' + yTop + ' C' + cxa + ' ' + yTop + ' ' + cXa + ' ' + yBot + ' ' + Xb + ' ' + yBot, dashA);
      path('M' + xb + ' ' + yBot + ' C' + cxb + ' ' + yBot + ' ' + cXb + ' ' + yTop + ' ' + Xa + ' ' + yTop, dashB);
    });
    return g;
  }

  /* ---------- 旋转因子 ---------- */
  function twiddleMarks(cFrom, pairs) {
    var g = el('g', {});
    var half = pairs.length, len = 2 * half;
    var xm = colX(cFrom) + COL_GAP * 0.30;
    pairs.forEach(function (p, j) {
      var t = el('text', {
        x: xm, y: rowY(p[0]) - 8, 'text-anchor': 'start',
        'font-size': 11, 'font-family': "'JetBrains Mono', monospace",
        fill: '#8A5710', 'font-weight': 700,
        stroke: '#FFFFFF', 'stroke-width': 3.6, 'paint-order': 'stroke'
      });
      t.textContent = S.twiddleLabel(len, j);
      g.appendChild(t);
    });
    return g;
  }

  /* ---------- 配对 / 标签 ---------- */
  function pairsOf(lv) {
    var pairs = [], half = 1 << (lv - 1);
    for (var start = 0; start < N; start += 2 * half) {
      for (var j = 0; j < half; j++) pairs.push([start + j, start + j + half]);
    }
    return pairs;
  }
  function labelsOf(col) {
    var out = [], rr;
    if (col === 0) {
      for (rr = 0; rr < N; rr++) out.push(S.fmtCompact(state.signal.re[rr], 0, 1));
    } else {
      var snap = state.fft.stages[col - 1];
      for (rr = 0; rr < N; rr++) out.push(S.fmtCompact(snap.re[rr], snap.im[rr], 1));
    }
    return out;
  }

  /* ---------- 渲染 ---------- */
  function renderStage(level) {
    var layer = svg.querySelector('#layer');
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    var labels = [labelsOf(0), labelsOf(1), labelsOf(2), labelsOf(3)];
    var radii = labels.map(function (col) { return col.map(radiusFor); });

    for (var r = 0; r < N; r++) {
      layer.appendChild(nodeLabel(0, r, labels[0][r], 'in'));
    }

    for (var lv = 1; lv <= 3; lv++) {
      var mode = (lv < level) ? 'done' : (lv === level ? 'active' : 'pending');
      layer.appendChild(
        butterflyLinks(lv - 1, pairsOf(lv), mode, radii[lv - 1], radii[lv])
      );
      if (lv === level) layer.appendChild(twiddleMarks(lv - 1, pairsOf(lv)));
    }

    for (var col = 1; col <= 3; col++) {
      var done = (col <= level);
      for (var rr = 0; rr < N; rr++) {
        if (done) {
          var cls = (col === level) ? (col === 3 ? 'out' : 'hl') : 'done';
          layer.appendChild(nodeLabel(col, rr, labels[col][rr], cls));
        } else {
          layer.appendChild(el('circle', {
            cx: colX(col), cy: rowY(rr), r: RAD_S,
            fill: 'none', stroke: '#E2E8F0',
            'stroke-width': 1.5, 'stroke-dasharray': '3 3'
          }));
        }
      }
    }
  }

  /* ---------- 重建 ---------- */
  function rebuild() {
    var freq = Number(document.getElementById('freq').value);
    var kind = document.getElementById('kind').value;
    document.getElementById('freqOut').textContent = kind === 'sine'
      ? (freq + ' 个周期 / 8 点') : '—';

    state.signal = buildSignal(freq, kind);
    state.fft = S.fftComplex(state.signal.re, state.signal.im);
    state.level = 0;

    document.getElementById('btnStep').disabled = false;
    document.getElementById('btnAll').disabled = false;
    document.getElementById('stageInfo').textContent =
      '等待开始 —— 点击「下一级」逐级展开，或「一次跑完」';
    renderStage(0);
    drawInputWave();
    drawSpectrum();
  }

  /* ---------- 左：时域 ---------- */
  function drawInputWave() {
    var cv = document.getElementById('waveCanvas');
    if (!cv) return;
    var box = cv.parentNode.getBoundingClientRect();
    var w = Math.max(280, box.width - 44);
    var U = S.U(), H = Math.round(158 * U);
    var ctx = S.fitCanvas(cv, w, H);
    S.clearDark(ctx, w, H);
    S.drawStems(ctx, state.signal.re,
      { x: Math.round(24 * U), y: Math.round(18 * U), w: w - Math.round(48 * U), h: Math.round(122 * U) },
      { color: C.violet });
  }

  /* ---------- 右：频谱 ---------- */
  function drawSpectrum() {
    var cv = document.getElementById('specCanvas');
    if (!cv) return;
    var box = cv.parentNode.getBoundingClientRect();
    var w = Math.max(280, box.width - 44);
    var U = S.U(), H = Math.round(158 * U);
    var ctx = S.fitCanvas(cv, w, H);
    S.clearDark(ctx, w, H);

    var mags = state.fft.result.re.map(function (v, i) {
      return Math.sqrt(v * v + state.fft.result.im[i] * state.fft.result.im[i]);
    });
    var hl = [];
    mags.forEach(function (m, i) { if (m > 0.35) hl.push(i); });
    S.drawBars(ctx, mags,
      { x: Math.round(24 * U), y: Math.round(18 * U), w: w - Math.round(48 * U), h: Math.round(122 * U) },
      { highlight: hl });
    return mags;
  }

  /* ---------- 任务判定 ---------- */
  var QUEST = { kind: 'square', tried: {}, done: false };
  var HINT = {
    sine: '正弦波只有单一频率 —— 频谱应该只有两根对称的峰（k 与 N−k）。',
    square: '方波由无穷多个奇次谐波叠加而成 —— 频谱应出现 k = 1, 3, 5, 7 多个峰。',
    impulse: '冲激在时域最集中，在频域最分散 —— 所有频率等量出现，频谱平坦。',
    dc: '直流信号没有任何变化 —— 能量全部集中在 k = 0。'
  };

  function checkQuest() {
    var kind = document.getElementById('kind').value;
    QUEST.tried[kind] = true;
    var triedCount = Object.keys(QUEST.tried).length;

    var band = document.getElementById('questBand');
    var st = band.querySelector('.q-state');

    if (kind === QUEST.kind) {
      if (!QUEST.done) {
        QUEST.done = true;
        if (!S.questDone('ch3')) {
          S.completeQuest('ch3', '找到了！方波的频谱确实有多个峰 —— 奇次谐波');
        } else {
          band.classList.add('done');
          if (st) st.textContent = '✓ 已完成';
        }
      }
    } else if (triedCount >= 3) {
      var txt = band.querySelector('.q-txt');
      if (txt && !QUEST.done) {
        txt.innerHTML = '提示：试试 <b>方波</b> —— 它的波形是台阶状的，频谱会同时出现多个频率峰。';
      }
    }
    // 更新进度文案
    if (st && !QUEST.done) {
      st.textContent = '已试 ' + triedCount + ' / 4';
    }
  }

  /* ---------- 交互 ---------- */
  function step() {
    if (state.level < 3) {
      state.level++;
      renderStage(state.level);
      var names = ['', '第 1 级：相邻 2 点成对（间距 1）', '第 2 级：间距 2 成对',
        '第 3 级：间距 4 成对 —— 输出完整频谱 X[k]'];
      document.getElementById('stageInfo').textContent = names[state.level];
      if (state.level === 3) document.getElementById('btnStep').disabled = true;
      checkQuest();
    }
  }
  function runAll() {
    state.level = 3;
    renderStage(3);
    document.getElementById('stageInfo').textContent =
      '第 3 级：间距 4 成对 —— 输出完整频谱 X[k]';
    document.getElementById('btnStep').disabled = true;
    checkQuest();
  }
  function reset() { rebuild(); }

  function init() {
    svg = document.getElementById('butterfly');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, fill: '#FFFFFF' }));
    svg.appendChild(buildFrame());
    svg.appendChild(el('g', { id: 'layer' }));

    state = { level: 0 };

    document.getElementById('freq').addEventListener('input', rebuild);
    document.getElementById('kind').addEventListener('change', function () {
      rebuild();
      checkQuest();
    });
    document.getElementById('btnStep').addEventListener('click', step);
    document.getElementById('btnAll').addEventListener('click', runAll);
    document.getElementById('btnReset').addEventListener('click', reset);
    window.addEventListener('resize', function () { drawInputWave(); drawSpectrum(); });

    rebuild();

    // URL 参数（截图/演示用）
    var q = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      q[p[0]] = decodeURIComponent(p[1] || '');
    });
    if (q.kind) document.getElementById('kind').value = q.kind;
    if (q.freq) document.getElementById('freq').value = q.freq;
    if (q.kind || q.freq) rebuild();
    if (q.auto) {
      var target = Math.max(0, Math.min(3, Number(q.auto)));
      for (var s = 0; s < target; s++) step();
    }
    if (q.kind) checkQuest();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
