/* Luopan compass — procedural SVG builder
 * Renders into <svg id="luopan" viewBox="0 0 1000 1000">
 * Exposes: window.buildLuopan()
 */
(function () {
  'use strict';

  const NS  = 'http://www.w3.org/2000/svg';
  const CX  = 500, CY = 500;

  /* ── Palette (dark-blue landing page theme) ────────────────────────── */
  const INK       = 'rgba(200,222,255,0.60)';
  const INK_BRIGHT= 'rgba(225,238,255,0.80)';
  const INK_DIM   = 'rgba(150,185,255,0.35)';
  const LINE      = 'rgba(100,150,255,0.18)';
  const LINE_DIM  = 'rgba(100,150,255,0.10)';
  const ACCENT_S  = '#c8403c';   // needle south — red
  const ACCENT_N  = '#c8a044';   // needle north — gold

  /* ── Data ───────────────────────────────────────────────────────────── */
  const HEXAGRAMS   = Array.from({ length: 64 }, (_, i) => String.fromCodePoint(0x4DC0 + i));
  const MANSIONS    = '角亢氐房心尾箕斗牛女虛危室壁奎婁胃昴畢觜參井鬼柳星張翼軫'.split('');
  const MOUNTAINS   = '壬子癸丑艮寅甲卯乙辰巽巳丙午丁未坤申庚酉辛戌乾亥'.split('');
  const BRANCHES    = '子丑寅卯辰巳午未申酉戌亥'.split('');
  const BAGUA_LH    = '坎艮震巽離坤兌乾'.split('');  // Later Heaven, starts N
  const BAGUA_PH    = '☰☷☲☳☴☱☶☵'.split('');         // Pre-Heaven symbols

  /* ── SVG helpers ────────────────────────────────────────────────────── */
  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  function circle(r, attrs) {
    return el('circle', { cx: CX, cy: CY, r, fill: 'none', ...attrs });
  }

  function radPt(angleDeg, r) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  /* Ring group with CSS animation via --period var */
  function ringGroup(dir, period) {
    return el('g', {
      class: `ring ring-${dir}`,
      style: `--period:${period}s`,
    });
  }

  /* Ring border circles */
  function ringBorders(g, rOuter, rInner, strokeOuter, strokeInner) {
    g.appendChild(circle(rOuter, { stroke: strokeOuter || LINE, 'stroke-width': '0.8' }));
    g.appendChild(circle(rInner, { stroke: strokeInner || LINE_DIM, 'stroke-width': '0.5' }));
  }

  /* Radial divider lines for N equal sectors (inside ring) */
  function sectorDividers(g, n, rOuter, rInner, stroke) {
    for (let i = 0; i < n; i++) {
      const angle = i * (360 / n);
      const [x1, y1] = radPt(angle, rInner);
      const [x2, y2] = radPt(angle, rOuter);
      g.appendChild(el('line', { x1, y1, x2, y2, stroke: stroke || LINE_DIM, 'stroke-width': '0.5' }));
    }
  }

  /* Place characters evenly on a circle, each rotated along the ring */
  function textRing(g, chars, r, color, fontSize, fontFamily, startOffset) {
    const n     = chars.length;
    const step  = 360 / n;
    const font  = fontFamily || "'Noto Serif SC', 'Noto Serif', serif";
    chars.forEach((ch, i) => {
      const angle = (startOffset || 0) + i * step;
      const [x, y] = radPt(angle, r);
      g.appendChild(el('text', {
        x, y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: color,
        'font-size': fontSize,
        'font-family': font,
        transform: `rotate(${angle + 90},${x},${y})`,
      }, ch));
    });
  }

  /* ── Ring builders ──────────────────────────────────────────────────── */

  /* R0: Outer rim + degree ticks  (720s CW) */
  function buildR0() {
    const g = ringGroup('cw', 720);
    // outer glow ring
    g.appendChild(circle(480, { stroke: INK_DIM, 'stroke-width': '1.2' }));
    g.appendChild(circle(462, { stroke: LINE, 'stroke-width': '0.5' }));

    // degree ticks
    for (let d = 0; d < 360; d++) {
      const isMajor = d % 10 === 0;
      const isMed   = d % 5  === 0;
      const rOuter  = 480;
      const rInner  = isMajor ? 467 : isMed ? 472 : 477;
      const [x1, y1] = radPt(d, rOuter);
      const [x2, y2] = radPt(d, rInner);
      g.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: isMajor ? INK_DIM : LINE,
        'stroke-width': isMajor ? '1' : '0.5',
      }));
    }

    // labels every 30°
    for (let d = 0; d < 360; d += 30) {
      const [x, y] = radPt(d, 453);
      g.appendChild(el('text', {
        x, y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: INK_DIM,
        'font-size': '9',
        'font-family': "'Inter', sans-serif",
        transform: `rotate(${d + 90},${x},${y})`,
      }, d + '°'));
    }

    return g;
  }

  /* R1: 28 Lunar Mansions  (540s CCW) */
  function buildR1() {
    const g = ringGroup('ccw', 540);
    ringBorders(g, 462, 426);
    sectorDividers(g, 28, 462, 426);
    textRing(g, MANSIONS, 444, INK, '13', null, 360 / 56); // offset half-sector
    return g;
  }

  /* R2: 64 Hexagrams  (460s CW) */
  function buildR2() {
    const g = ringGroup('cw', 460);
    ringBorders(g, 426, 382);
    sectorDividers(g, 64, 426, 382, LINE_DIM);
    textRing(g, HEXAGRAMS, 404, INK_DIM, '11', "'Noto Serif SC', serif", 360 / 128);
    return g;
  }

  /* R3: 24 Mountains  (380s CCW) */
  function buildR3() {
    const g = ringGroup('ccw', 380);
    ringBorders(g, 382, 342);
    sectorDividers(g, 24, 382, 342);
    textRing(g, MOUNTAINS, 362, INK_BRIGHT, '15', null, 0);
    return g;
  }

  /* R4: 12 Earthly Branches  (320s CW) */
  function buildR4() {
    const g = ringGroup('cw', 320);
    ringBorders(g, 342, 296, LINE, LINE);
    sectorDividers(g, 12, 342, 296, LINE);

    // alternating fill bands
    const step = 360 / 12;
    for (let i = 0; i < 12; i++) {
      const a1 = (i * step - 90) * Math.PI / 180;
      const a2 = ((i + 1) * step - 90) * Math.PI / 180;
      const large = step > 180 ? 1 : 0;
      const x1o = CX + 342 * Math.cos(a1), y1o = CY + 342 * Math.sin(a1);
      const x2o = CX + 342 * Math.cos(a2), y2o = CY + 342 * Math.sin(a2);
      const x1i = CX + 296 * Math.cos(a1), y1i = CY + 296 * Math.sin(a1);
      const x2i = CX + 296 * Math.cos(a2), y2i = CY + 296 * Math.sin(a2);
      const d = `M${x1i},${y1i} L${x1o},${y1o} A342,342 0 ${large},1 ${x2o},${y2o} L${x2i},${y2i} A296,296 0 ${large},0 ${x1i},${y1i}Z`;
      g.appendChild(el('path', {
        d,
        fill: i % 2 === 0 ? 'rgba(100,150,255,0.04)' : 'rgba(100,150,255,0.02)',
      }));
    }

    textRing(g, BRANCHES, 319, INK_BRIGHT, '18', null, step / 2);
    return g;
  }

  /* R5: Later Heaven Bagua characters  (280s CCW) */
  function buildR5() {
    const g = ringGroup('ccw', 280);
    ringBorders(g, 296, 254, LINE, LINE);
    sectorDividers(g, 8, 296, 254, LINE);

    // color tint per gua
    const gua_colors = [
      'rgba(58,123,255,0.12)',  // 坎 water
      'rgba(100,150,255,0.08)',
      'rgba(34,197,94,0.10)',   // 震 wood
      'rgba(100,150,255,0.08)',
      'rgba(200,64,60,0.10)',   // 離 fire
      'rgba(100,150,255,0.08)',
      'rgba(245,197,107,0.10)',  // 兌 metal
      'rgba(100,150,255,0.08)',
    ];

    const step = 45;
    for (let i = 0; i < 8; i++) {
      const a1 = (i * step - 90) * Math.PI / 180;
      const a2 = ((i + 1) * step - 90) * Math.PI / 180;
      const x1o = CX + 296 * Math.cos(a1), y1o = CY + 296 * Math.sin(a1);
      const x2o = CX + 296 * Math.cos(a2), y2o = CY + 296 * Math.sin(a2);
      const x1i = CX + 254 * Math.cos(a1), y1i = CY + 254 * Math.sin(a1);
      const x2i = CX + 254 * Math.cos(a2), y2i = CY + 254 * Math.sin(a2);
      const d = `M${x1i},${y1i} L${x1o},${y1o} A296,296 0 0,1 ${x2o},${y2o} L${x2i},${y2i} A254,254 0 0,0 ${x1i},${y1i}Z`;
      g.appendChild(el('path', { d, fill: gua_colors[i] }));
    }

    textRing(g, BAGUA_LH, 275, INK_BRIGHT, '20', null, step / 2);
    return g;
  }

  /* R6: Pre-Heaven Bagua symbols  (220s CW) */
  function buildR6() {
    const g = ringGroup('cw', 220);
    ringBorders(g, 254, 214, LINE, LINE);
    sectorDividers(g, 8, 254, 214, LINE);
    textRing(g, BAGUA_PH, 234, INK, '18', "'Noto Serif SC', serif, sans-serif", 22.5);
    return g;
  }

  /* Heaven Pool: center circles + cardinal N/E/S/W  (static) */
  function buildHeavenPool() {
    const g = el('g');

    // concentric decorative rings
    [214, 190, 160, 120, 90].forEach((r, i) => {
      const opacity = 0.18 - i * 0.02;
      g.appendChild(circle(r, {
        stroke: `rgba(140,185,255,${opacity.toFixed(2)})`,
        'stroke-width': r === 120 ? '1.2' : '0.8',
      }));
    });

    // crosshair
    [0, 90, 180, 270].forEach(a => {
      const [x1, y1] = radPt(a, 82);
      const [x2, y2] = radPt(a, 110);
      g.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: 'rgba(140,185,255,0.25)',
        'stroke-width': '0.8',
      }));
    });

    // 8 diagonal dividers
    for (let i = 0; i < 8; i++) {
      const [x1, y1] = radPt(i * 45, 90);
      const [x2, y2] = radPt(i * 45, 120);
      g.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: LINE,
        'stroke-width': '0.5',
      }));
    }

    // Cardinal labels 北東南西
    const cardinals = [
      { ch: '北', a: 0 },
      { ch: '東', a: 90 },
      { ch: '南', a: 180 },
      { ch: '西', a: 270 },
    ];
    cardinals.forEach(({ ch, a }) => {
      const [x, y] = radPt(a, 140);
      g.appendChild(el('text', {
        x, y,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: INK_BRIGHT,
        'font-size': '16',
        'font-family': "'Noto Serif SC', serif",
        'font-weight': '700',
      }, ch));
    });

    // Inner pool fill
    g.appendChild(circle(82, {
      fill: 'rgba(8,10,16,0.6)',
      stroke: 'rgba(140,185,255,0.20)',
      'stroke-width': '1',
    }));

    return g;
  }

  /* Magnetic needle with wobble animation */
  function buildNeedle() {
    const g = el('g', { class: 'needle' });

    // Shadow beneath needle
    g.appendChild(el('ellipse', {
      cx: CX, cy: CY + 4,
      rx: '10', ry: '4',
      fill: 'rgba(0,0,0,0.35)',
    }));

    // South half — red (points geographically south)
    g.appendChild(el('path', {
      d: `M${CX},${CY} L${CX - 7},${CY + 14} L${CX},${CY + 72} L${CX + 7},${CY + 14} Z`,
      fill: ACCENT_S,
    }));

    // North half — gold
    g.appendChild(el('path', {
      d: `M${CX},${CY} L${CX - 7},${CY - 14} L${CX},${CY - 72} L${CX + 7},${CY - 14} Z`,
      fill: ACCENT_N,
    }));

    // Pivot
    g.appendChild(circle(9, {
      cx: CX, cy: CY,
      fill: '#e8d5a0',
      stroke: 'rgba(255,255,255,0.25)',
      'stroke-width': '1',
    }));
    g.appendChild(circle(3, {
      cx: CX, cy: CY,
      fill: '#fff',
    }));

    return g;
  }

  /* 8 sector dividers (radial lines from heaven pool to outer rim) */
  function buildSectorLines() {
    const g = el('g');
    for (let i = 0; i < 8; i++) {
      const [x1, y1] = radPt(i * 45, 214);
      const [x2, y2] = radPt(i * 45, 480);
      g.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: 'rgba(140,185,255,0.12)',
        'stroke-width': '0.8',
      }));
    }
    return g;
  }

  /* ── Main builder ───────────────────────────────────────────────────── */
  function buildCompass() {
    const svg = document.getElementById('luopan');
    if (!svg) return;

    // Outer glow filter
    const defs = el('defs');
    const filter = el('filter', { id: 'luopan-glow', x: '-20%', y: '-20%', width: '140%', height: '140%' });
    const blur = el('feGaussianBlur', { stdDeviation: '3', result: 'blur' });
    const merge = el('feMerge');
    merge.appendChild(el('feMergeNode', { in: 'blur' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);

    // Background pool
    const bg = el('circle', {
      cx: CX, cy: CY, r: '480',
      fill: 'rgba(6,8,14,0.0)',
    });
    svg.appendChild(bg);

    // Rings (outer to inner)
    svg.appendChild(buildR0());
    svg.appendChild(buildR1());
    svg.appendChild(buildR2());
    svg.appendChild(buildSectorLines());
    svg.appendChild(buildR3());
    svg.appendChild(buildR4());
    svg.appendChild(buildR5());
    svg.appendChild(buildR6());
    svg.appendChild(buildHeavenPool());
    svg.appendChild(buildNeedle());
  }

  window.buildLuopan = buildCompass;

  // Auto-run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildCompass);
  } else {
    buildCompass();
  }
}());
