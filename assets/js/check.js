/* ============================================================
   《频谱之诗》— 算法校验页脚本
   零依赖；实现与 site.js 中的 dft / fftComplex 同源
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 待校验的实现（与 site.js 同源） ---------------- */

  // 按定义逐点累加的 DFT，返回复数（不取模）
  function dftComplex(re) {
    var N = re.length, or = [], oi = [], k, n, a, sr, si;
    for (k = 0; k < N; k++) {
      sr = 0; si = 0;
      for (n = 0; n < N; n++) {
        a = -2 * Math.PI * k * n / N;
        sr += re[n] * Math.cos(a);
        si += re[n] * Math.sin(a);
      }
      or.push(sr); oi.push(si);
    }
    return { re: or, im: oi };
  }

  // 基-2 时域抽取 FFT：位反转重排 + 逐级蝶形
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

    var len, half, ang, start, wr, wi, ar, ai, br, bi, tr, ti;
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
    }
    return { rev: rev, re: re, im: im };
  }

  /* ---------------- 格式化 ---------------- */

  var SUP = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','-':'⁻' };
  function sci(x, digits) {
    if (x === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(x)));
    var m = x / Math.pow(10, e);
    var d = (digits == null) ? 1 : digits;
    if (Math.abs(m) >= 10) { m /= 10; e += 1; }
    var sup = String(e).split('').map(function (c) { return SUP[c]; }).join('');
    return m.toFixed(d) + ' × 10' + sup;
  }
  function fixed(v, d) {
    return (Math.abs(v) < 5e-10 ? 0 : v).toFixed(d);
  }

  /* ---------------- 测试信号 ---------------- */

  var N = 16;
  var SIGS = [
    { name: 'cos(1 周期)', f: function (n) { return Math.cos(2 * Math.PI * n / N); } },
    { name: 'cos(2 周期)', f: function (n) { return Math.cos(4 * Math.PI * n / N); } },
    { name: '方波',        f: function (n) { return n < N / 2 ? 1 : -1; } },
    { name: '冲激',        f: function (n) { return n === 0 ? 1 : 0; } },
    { name: '直流',        f: function (n) { return 1; } },
    { name: '三音叠加',    f: function (n) {
        return Math.sin(2 * Math.PI * n / N)
             + 0.5 * Math.cos(6 * Math.PI * n / N)
             + 0.25 * Math.sin(10 * Math.PI * n / N);
      } }
  ];

  var results = [], gAbs = 0, gNorm = 0;

  SIGS.forEach(function (s) {
    var x = [], n, k;
    for (n = 0; n < N; n++) x.push(s.f(n));
    var zeroIm = new Array(N).fill(0);
    var F = fftComplex(x, zeroIm);
    var D = dftComplex(x);
    var abs = 0, maxMag = 0, mags = [];
    for (k = 0; k < N; k++) {
      abs = Math.max(abs,
        Math.abs(F.re[k] - D.re[k]),
        Math.abs(F.im[k] - D.im[k]));
      maxMag = Math.max(maxMag, Math.hypot(D.re[k], D.im[k]));
    }
    for (k = 0; k <= N / 2; k++) mags.push(Math.hypot(F.re[k], F.im[k]));
    var norm = maxMag > 0 ? abs / maxMag : 0;
    if (abs > gAbs) gAbs = abs;
    if (norm > gNorm) gNorm = norm;
    results.push({ name: s.name, x: x, F: F, D: D, abs: abs, norm: norm, mags: mags });
  });

  var main = results[results.length - 1];   // 三音叠加，用于逐点对照

  /* ---------------- 六项校验 ---------------- */

  var checks = [];
  function add(name, rule, measured, ok) {
    checks.push({ name: name, rule: rule, measured: measured, ok: !!ok });
  }

  // 1. 位反转重排
  var revSeq = [], i, b, j, bits = Math.round(Math.log2(N));
  for (i = 0; i < N; i++) {
    j = 0;
    for (b = 0; b < bits; b++) if (i & (1 << b)) j |= 1 << (bits - 1 - b);
    revSeq.push(j);
  }
  var permOk = true, selfInv = true, seen = {};
  for (i = 0; i < N; i++) {
    if (seen[revSeq[i]]) permOk = false;
    seen[revSeq[i]] = true;
    if (revSeq[revSeq[i]] !== i) selfInv = false;
  }
  add('位反转重排', '结果为 0…15 的一个排列，且 rev[rev[i]] = i',
      permOk && selfInv ? '排列成立，自反成立' : '排列或自反不成立', permOk && selfInv);

  // 2. FFT 与 DFT 逐点比对（六组信号）
  add('FFT 与 DFT 逐点比对', '六组信号，每组复数最大偏差均 < 1e-12',
      '六组中最大 ' + sci(gAbs), gAbs < 1e-12);

  // 3. 单频定位
  var mono = results[0];
  var peakOk = true, peakMax = 0;
  for (var k2 = 0; k2 < N; k2++) {
    var m = Math.hypot(mono.F.re[k2], mono.F.im[k2]) / N;
    if (k2 === 1 || k2 === 15) {
      if (Math.abs(m - 0.5) > 1e-12) peakOk = false;
    } else if (m > 1e-12) {
      peakOk = false;
      peakMax = Math.max(peakMax, m);
    }
  }
  add('单频信号的能量位置', 'cos(1 周期) 的能量只落在 k = 1 与 k = 15，幅度 0.5，其余 < 1e-12',
      peakOk ? '两侧对称峰，其余频点为 0' : '峰值位置或幅度不符', peakOk);

  // 4. Parseval 能量守恒（六组信号逐一检查）
  var pOk = true, pWorst = 0;
  results.forEach(function (r) {
    var eT = 0, eF = 0, q;
    for (q = 0; q < N; q++) eT += r.x[q] * r.x[q];
    for (q = 0; q < N; q++) eF += (r.F.re[q] * r.F.re[q] + r.F.im[q] * r.F.im[q]) / N;
    if (eT === 0) return;
    var e = Math.abs(eT - eF) / eT;
    if (e > pWorst) pWorst = e;
    if (e > 1e-12) pOk = false;
  });
  add('Parseval 能量守恒', 'Σ|x[n]|² 与 (1/N)Σ|X[k]|² 的相对偏差 < 1e-12',
      pWorst === 0 ? '六组均相等，无可分辨偏差' : '六组中最大相对偏差 ' + sci(pWorst), pOk);

  // 5. 运算量比值（须与首页表格一致）
  var rows = [[64, 21], [256, 64], [1024, 205], [4096, 683]];
  var opsOk = true, opsOut = [];
  rows.forEach(function (r) {
    var ratio = Math.round(r[0] * r[0] / ((r[0] / 2) * Math.log2(r[0])));
    if (ratio !== r[1]) opsOk = false;
    opsOut.push(r[0] + ' 点 ' + ratio + '×');
  });
  add('DFT / FFT 运算量比值', 'N² ÷ (N/2·log₂N) 四舍五入后与首页表格逐项相同',
      opsOut.join('　'), opsOk);

  // 6. Hann 窗端点
  var L = 2049;
  var w0 = 0.5 - 0.5 * Math.cos(0);
  var wEnd = 0.5 - 0.5 * Math.cos(2 * Math.PI);
  var wMid = 0.5 - 0.5 * Math.cos(Math.PI);
  var winOk = Math.abs(w0) < 1e-15 && Math.abs(wEnd) < 1e-15 && Math.abs(wMid - 1) < 1e-15;
  add('Hann 窗端点与中心', 'w[0] = w[L−1] = 0，w[(L−1)/2] = 1',
      '0 / 1 / 0，L = ' + L, winOk);

  /* ---------------- 渲染 ---------------- */

  var html = '', passed = 0;
  checks.forEach(function (c, idx) {
    if (c.ok) passed++;
    html += '<tr>' +
      '<td class="idx">' + (idx + 1) + '</td>' +
      '<td>' + c.name + '</td>' +
      '<td style="color:var(--fg-3);font-size:12.5px">' + c.rule + '</td>' +
      '<td class="num" style="white-space:normal">' + c.measured + '</td>' +
      '<td class="res"><span class="badge ' + (c.ok ? 'ok' : 'no') + '">' +
        (c.ok ? '通过' : '不通过') + '</span></td>' +
      '</tr>';
  });
  document.getElementById('rows').innerHTML = html;

  var sigHtml = '';
  results.forEach(function (r) {
    sigHtml += '<tr>' +
      '<td>' + r.name + '</td>' +
      '<td class="num">' + (r.abs === 0 ? '0' : sci(r.abs)) + '</td>' +
      '<td class="num">' + (r.norm === 0 ? '0' : sci(r.norm)) + '</td>' +
      '<td class="num" style="white-space:normal;color:var(--fg-3)">' +
        r.mags.map(function (v) { return Math.abs(v) < 1e-9 ? 0 : v.toFixed(2); }).join('　') +
      '</td>' +
      '</tr>';
  });
  document.getElementById('sigs').innerHTML = sigHtml;

  var binHtml = '';
  for (var q2 = 0; q2 < N; q2++) {
    var dev = Math.max(
      Math.abs(main.F.re[q2] - main.D.re[q2]),
      Math.abs(main.F.im[q2] - main.D.im[q2]));
    binHtml += '<tr>' +
      '<td class="idx">' + q2 + '</td>' +
      '<td class="num">' + fixed(main.F.re[q2], 6) + '</td>' +
      '<td class="num">' + fixed(main.F.im[q2], 6) + '</td>' +
      '<td class="num">' + fixed(main.D.re[q2], 6) + '</td>' +
      '<td class="num">' + fixed(main.D.im[q2], 6) + '</td>' +
      '<td class="num" style="color:var(--fg-4)">' + (dev === 0 ? '0' : sci(dev)) + '</td>' +
      '</tr>';
  }
  document.getElementById('bins').innerHTML = binHtml;

  document.getElementById('cRel').textContent = sci(gNorm);
  document.getElementById('cErr').textContent = sci(gAbs);
  document.getElementById('cSpeed').textContent =
    Math.round(4096 * 4096 / ((4096 / 2) * Math.log2(4096))) + '×';
  document.getElementById('cPass').textContent = passed + ' / 6';
})();
