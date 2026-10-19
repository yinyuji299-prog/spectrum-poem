/* ============================================================
   《频谱之诗》— 共享脚本 v6（学术出版物 · 墨与纸）
   零依赖 · 离线可跑 · 含互动任务系统（13 任务）
   ============================================================ */
(function (global) {
  'use strict';

  var CHAPTERS = [
    { n: 1, file: 'chapter1.html', title: '时域与频域' },
    { n: 2, file: 'chapter2.html', title: '从 DFT 到 FFT' },
    { n: 3, file: 'chapter3.html', title: '蝶形舞台' },
    { n: 4, file: 'chapter4.html', title: '频谱之用' },
    { n: 5, file: 'chapter5.html', title: '自测与说明' },
    { n: 6, file: 'note-lab.html', title: '音高实验室', extra: true }
  ];

  var LOGO =
    '<svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M2 18 C5 18 5 6 8 6 C11 6 11 18 14 18 C17 18 17 6 20 6" ' +
    'stroke="#16161A" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '<circle cx="20" cy="6" r="2.6" fill="#9A6212"/></svg>';

  /* ---------- 印刷色板（供 Canvas 使用） ---------- */
  var C = {
    bg:      '#FFFFFF',
    paper:   '#FBFAF7',
    panel:   '#FFFFFF',
    grid:    'rgba(22,22,26,0.055)',
    grid2:   'rgba(22,22,26,0.10)',
    axis:    'rgba(22,22,26,0.22)',
    fg:      '#16161A',
    fg2:     '#4A4A52',
    fg3:     '#7C7C86',
    fg4:     '#A8A8B0',
    blue:    '#1B3F8F',
    blueSoft:'#EEF1F9',
    cyan:    '#1F6B75',
    violet:  '#5A4A93',
    pink:    '#97372F',
    amber:   '#9A6212',
    green:   '#2C6B4C',
    red:     '#97372F',
    rose:    '#97372F'   // 与 CSS --rose 同值，语义别名（答错 / 警示）
  };

  /* ---------------- 顶栏 / 页脚 ---------------- */
  function nextFile(active) {
    for (var i = 0; i < CHAPTERS.length; i++) {
      if (CHAPTERS[i].n === active && CHAPTERS[i + 1]) return CHAPTERS[i + 1].file;
    }
    return 'chapter1.html';
  }

  function mount() {
    var bar = document.querySelector('.topbar');
    // data-static：页面自带顶栏（如整合总览页），不做覆盖
    if (bar && !bar.hasAttribute('data-static')) {
      var active = Number(bar.getAttribute('data-nav') || 0);
      var links = '';
      for (var i = 0; i < CHAPTERS.length; i++) {
        var c = CHAPTERS[i];
        links += '<a href="' + c.file + '"' +
          (c.n === active ? ' class="active"' : '') + '>' +
          (c.extra ? '' : c.n + ' · ') + c.title + '</a>';
      }
      bar.innerHTML = '<div class="topbar-inner">' +
        '<a class="brand" href="index.html">' + LOGO + '<span>频谱之诗</span></a>' +
        '<a class="top-next" href="' + nextFile(active) + '">继续 ↓</a></div>';
      var side = document.createElement('nav');
      side.className = 'side-nav';
      side.setAttribute('aria-label', '章节');
      side.innerHTML = links;
      document.body.appendChild(side);
    }
    var foot = document.querySelector('.site-footer');
    if (foot) {
      foot.innerHTML = '<div class="wrap"><p class="small" style="margin:0">' +
        '《频谱之诗》— FFT 算法的视觉化与交互式科普　·　' +
        '第十四届全国大学生数字媒体科技作品及创意竞赛　·　' +
        '自主选题 · 智慧教育与科普</p></div>';
    }
  }

  /* ---------------- 尺寸系统（大屏可读性） ----------------
     作品最初按~1100px 容器调的画布高度与图内字号，在 1440p/ 4K 屏上
     会显得又挤又小。这里提供一个统一的缩放系数 U：
       · 视口越宽 → 系数越大（大屏看得更清楚）
       · 小屏/手机 → 回到 1，保持原有紧凑手感
     画布高度、图内字号、内边距统一乘以 U，避免逐页硬编码魔数。       */
  function uiScale() {
    var w = global.innerWidth || 1200;
    if (w >= 2200) return 1.34;
    if (w >= 1800) return 1.26;
    if (w >= 1500) return 1.18;
    if (w >= 1280) return 1.10;
    if (w >= 1024) return 1.04;
    return 1;                     // 手机 / 窄屏：保持 1
  }
  function U() { return uiScale(); }

  /* 画布内统一字号（随屏幕缩放，避免图内文字过小） */
  function fs(base) { return Math.round(base * uiScale() * 10) / 10; }

  /* ---------------- 画布（支持 devicePixelRatio） ---------------- */
  /* 注意：只在像素尺寸真正变化时才重设 cv.width/height。
     每次赋值都会重新分配后备存储并清空画布——若在动画循环里逐帧调用，
     会造成明显的性能损耗与卡顿。这里做一次尺寸比对后再决定是否重设。 */
  function fitCanvas(cv, cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
      cv.style.width = cssW + 'px';
      cv.style.height = cssH + 'px';
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* ---------------- DFT（教学用） ---------------- */
  function dft(re) {
    var N = re.length, out = [], k, n, a, sr, si;
    for (k = 0; k < N; k++) {
      sr = 0; si = 0;
      for (n = 0; n < N; n++) {
        a = -2 * Math.PI * k * n / N;
        sr += re[n] * Math.cos(a);
        si += re[n] * Math.sin(a);
      }
      out.push(Math.sqrt(sr * sr + si * si) / N);
    }
    return out;
  }

  /* ---------------- 基-2 时域抽取 FFT（含各级快照） ---------------- */
  function fftComplex(reIn, imIn) {
    var N = reIn.length;
    var bits = Math.round(Math.log2(N));
    var rev = new Array(N), i, b, j;
    for (i = 0; i < N; i++) {
      j = 0;
      for (b = 0; b < bits; b++) if (i & (1 << b)) j |= 1 << (bits - 1 - b);
      rev[i] = j;
    }
    var re = new Array(N), im = new Array(N);
    for (i = 0; i < N; i++) { re[i] = reIn[rev[i]]; im[i] = imIn[rev[i]]; }

    var stages = [], len, half, ang, start, wr, wi, ar, ai, br, bi, tr, ti;
    for (len = 2; len <= N; len <<= 1) {
      half = len >> 1;
      ang = -2 * Math.PI / len;
      for (start = 0; start < N; start += len) {
        for (j = 0; j < half; j++) {
          wr = Math.cos(ang * j);
          wi = Math.sin(ang * j);
          br = start + j + half;
          tr = re[br] * wr - im[br] * wi;
          ti = re[br] * wi + im[br] * wr;
          ar = re[start + j];
          ai = im[start + j];
          re[start + j] = ar + tr;        im[start + j] = ai + ti;
          re[start + j + half] = ar - tr; im[start + j + half] = ai - ti;
        }
      }
      stages.push({ len: len, re: re.slice(), im: im.slice() });
    }
    return { rev: rev, stages: stages, result: { re: re, im: im } };
  }

  /* ---------------- 复数格式化 ---------------- */
  function fmt(zr, zi, digits) {
    var d = (digits == null) ? 1 : digits;
    var r = Math.abs(zr) < 5e-10 ? 0 : zr;
    var m = Math.abs(zi) < 5e-10 ? 0 : zi;
    if (m === 0) return r.toFixed(d);
    if (r === 0) return (m > 0 ? '' : '−') + Math.abs(m).toFixed(d) + 'i';
    return r.toFixed(d) + (m > 0 ? '+' : '−') + Math.abs(m).toFixed(d) + 'i';
  }
  function fmtCompact(zr, zi, digits) {
    return fmt(zr, zi, digits == null ? 1 : digits).replace(/\.0(?=[+\-−i]|$)/g, '');
  }

  /* ---------------- 下标 ---------------- */
  var SUB = '₀₁₂₃₄₅₆₇₈₉', SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  function sub(n) { return String(n).split('').map(function (c) { return SUB[+c]; }).join(''); }
  function sup(n) { return String(n).split('').map(function (c) { return SUP[+c]; }).join(''); }
  function twiddleLabel(len, j) { return 'W' + sub(len) + sup(j); }

  /* ================= 明亮科普绘图工具 ================= */

  /* 清屏 + 纯白底，和页面视觉令牌保持一致 */
  function clearDark(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, w, h);
  }

  /* 网格 */
  function drawGrid(ctx, box, cols, rows) {
    var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    var i, xx, yy;
    for (i = 0; i <= cols; i++) {
      xx = x0 + w * i / cols;
      ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y0 + h); ctx.stroke();
    }
    for (i = 0; i <= rows; i++) {
      yy = y0 + h * i / rows;
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w, yy); ctx.stroke();
    }
  }

  /* 零轴 */
  function drawAxis(ctx, box, mid) {
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(box.x, mid); ctx.lineTo(box.x + box.w, mid);
    ctx.stroke();
  }

  /* 折线（浅底用：无辉光，靠线宽和颜色区分） */
  function glowLine(ctx, pts, color, width, glow) {
    if (!pts.length) return;
    ctx.save();
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.strokeStyle = color;
    ctx.lineWidth = (width || 2.4) * uiScale();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  /* 茎叶图（时域波形） */
  function drawStems(ctx, vals, box, opt) {
    opt = opt || {};
    var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
    var n = vals.length;
    var k = uiScale();                    // 随屏幕缩放
    var max = (opt.max || Math.max.apply(null, vals.map(Math.abs))) || 1;
    max = max * 1.2;
    var mid = y0 + h / 2;
    var step = w / n;
    var i, x, y;

    drawGrid(ctx, box, n, 4);
    drawAxis(ctx, box, mid);

    var col = opt.color || C.blue;
    ctx.strokeStyle = col; ctx.lineWidth = 2.4 * k;
    ctx.lineCap = 'round';
    for (i = 0; i < n; i++) {
      x = x0 + (i + 0.5) * step;
      y = mid - (vals[i] / max) * (h / 2 - 12);
      ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x, y); ctx.stroke();
    }
    var r = 4.4 * k;                      // 圆点半径随屏幕放大
    for (i = 0; i < n; i++) {
      x = x0 + (i + 0.5) * step;
      y = mid - (vals[i] / max) * (h / 2 - 12);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.2 * k;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    }
    return { mid: mid, step: step, max: max, x0: x0, y0: y0, w: w, h: h };
  }

  /* 柱状频谱 */
  function drawBars(ctx, vals, box, opt) {
    opt = opt || {};
    var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
    var n = vals.length;
    var max = Math.max.apply(null, vals) * 1.25 || 1;
    var step = w / n;
    var i, x, bh;

    drawGrid(ctx, box, n, 4);

    for (i = 0; i < n; i++) {
      bh = (vals[i] / max) * h;
      x = x0 + i * step + step * 0.16;
      var hot = (opt.highlight && opt.highlight.indexOf(i) >= 0);
      if (hot) {
        var g = ctx.createLinearGradient(0, y0 + h - bh, 0, y0 + h);
        g.addColorStop(0, C.blue);
        g.addColorStop(1, '#5E7BB8');
        ctx.fillStyle = g;
        ctx.fillRect(x, y0 + h - bh, step * 0.68, bh);
      } else {
        ctx.fillStyle = opt.dim || '#D3DCEC';
        ctx.fillRect(x, y0 + h - bh, step * 0.68, bh);
      }
    }
    ctx.strokeStyle = C.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();
    return { step: step, x0: x0, y0: y0, w: w, h: h, max: max };
  }

  /* ================= 互动任务系统 ================= */

  // 任务总清单：所有可完成的任务 id 都在这里（进度条据此统计）
  var TASKS = ['ch1', 'ch1b', 'ch2', 'ch2b', 'ch3', 'ch3b', 'ch4', 'ch4b', 'ch4c', 'ch5', 'live_mic', 'live_harm', 'note_lab', 'note_upload'];
  var QUEST_KEY = 'spectrum_poem_quests_v3';

  function loadQuests() {
    var o;
    try { o = JSON.parse(global.localStorage.getItem(QUEST_KEY) || '{}'); }
    catch (e) { o = {}; }
    // 兼容 v2 旧数据：把旧的 ch1~ch5 迁移过来
    if (!o.__migrated) {
      var old;
      try { old = JSON.parse(global.localStorage.getItem('spectrum_poem_quests_v2') || '{}'); }
      catch (e) { old = {}; }
      TASKS.forEach(function (id) { if (old[id]) o[id] = true; });
      o.__migrated = true;
      saveQuests(o);
    }
    return o;
  }
  function saveQuests(o) {
    try { global.localStorage.setItem(QUEST_KEY, JSON.stringify(o)); } catch (e) { /* 忽略 */ }
  }

  /**
   * 完成任务
   * @param {string} id  任务 id，如 'ch1'
   * @param {string} msg 成功提示
   */
  function completeQuest(id, msg) {
    var o = loadQuests();
    var isNew = !o[id];
    o[id] = true;
    saveQuests(o);

    // 更新页面上的任务条
    var bar = document.querySelector('.quest[data-quest="' + id + '"]');
    if (bar) {
      bar.classList.add('done');
      var st = bar.querySelector('.q-state');
      if (st) st.textContent = '✓ 已完成';
    }
    // 弹提示
    if (isNew) {
      toast(msg || '任务完成！', 'ok');
    }
    updateProgress();
    return isNew;
  }

  function questDone(id) {
    return !!loadQuests()[id];
  }

  /* 顶部轻提示 */
  function toast(text, kind) {
    var t = document.createElement('div');
    t.className = 'sp-toast ' + (kind || '');
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    setTimeout(function () {
      t.classList.remove('in');
      setTimeout(function () { t.remove(); }, 400);
    }, 2600);
  }

  /* 进度条 */
  function updateProgress() {
    var o = loadQuests();
    var done = 0;
    TASKS.forEach(function (id) { if (o[id]) done++; });
    var total = TASKS.length;
    var el = document.querySelector('.quest-progress');
    if (el) {
      el.textContent = done + ' / ' + total;
      var bar = el.parentNode.querySelector('.qp-fill');
      if (bar) bar.style.width = (done / total * 100) + '%';
    }
    // 通用进度文案（首页/整合页用 .qp-num）
    document.querySelectorAll('.qp-num').forEach(function (n) {
      n.textContent = done + ' / ' + total;
    });
  }

  /* ================= 数值滚动动画 ================= */
  function animateNumber(el, to, opt) {
    opt = opt || {};
    var dur = opt.dur || 600;
    var from = Number(el.getAttribute('data-num') || 0);
    var t0 = null;
    el.setAttribute('data-num', to);
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      var v = from + (to - from) * e;
      el.textContent = opt.fmt ? opt.fmt(v) : Math.round(v).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ================= 初始化 ================= */
  function initExtras() {
    // 注入 toast 样式
    if (!document.getElementById('__sp_extra')) {
      var st = document.createElement('style');
      st.id = '__sp_extra';
      st.textContent =
        '.sp-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);' +
        'z-index:9999;padding:12px 22px;border-radius:2px;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;' +
        'font-size:14px;font-weight:600;line-height:1.6;' +
        'background:#16161A;color:#FFFFFF;border:1px solid #16161A;' +
        'opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        '.sp-toast.in{opacity:1;}' +
        '.sp-toast.ok{background:#2C6B4C;border-color:#2C6B4C;}' +
        '.quest-progress{font-family:"JetBrains Mono",monospace;font-weight:700;color:#1B3F8F;}';
      document.head.appendChild(st);
    }

    // 恢复已完成任务
    var o = loadQuests();
    document.querySelectorAll('.quest[data-quest]').forEach(function (bar) {
      var id = bar.getAttribute('data-quest');
      if (o[id]) {
        bar.classList.add('done');
        var st2 = bar.querySelector('.q-state');
        if (st2) st2.textContent = '✓ 已完成';
      }
    });
    updateProgress();
  }

global.Site = {
mount: mount,
    U: U,
    fs: fs,
    fitCanvas: fitCanvas,
    dft: dft,
    fftComplex: fftComplex,
    fmt: fmt,
    fmtCompact: fmtCompact,
    sub: sub, sup: sup, twiddleLabel: twiddleLabel,
    clearDark: clearDark,
    drawGrid: drawGrid,
    drawAxis: drawAxis,
    glowLine: glowLine,
    drawStems: drawStems,
    drawBars: drawBars,
    completeQuest: completeQuest,
    questDone: questDone,
    toast: toast,
    animateNumber: animateNumber,
    updateProgress: updateProgress,
    TASKS: TASKS,
    C: C,
    CHAPTERS: CHAPTERS
  };

  function boot() { mount(); initExtras(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window);
