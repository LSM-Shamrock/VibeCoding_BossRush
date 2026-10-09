import * as THREE from 'three';
import { CFG } from './config';
import { envHolder } from './envmap';
import { aimed, merge, placed } from './geo';

/**
 * 2층 · 이무기의 못 — 1층(붉은 모래빛 유적)과 전혀 다른 곳.
 *
 *   · 색: 한밤의 군청·청록. 돌은 푸르스름한 점판암, 불빛은 차가운 청백색 도깨비불. (플레이어의 금빛, 위험의 붉은빛이 더 또렷이 읽힌다)
 *   · 지형: 둥근 석단(dais)이 검은 못 한가운데 떠 있다. 바닥은 방사형 돌판 + 한가운데 똬리 튼 뱀 문양.
 *           바깥은 끝없는 물, 현무암 기둥 군락, 부서진 돌다리, 연잎, 갈대, 그리고 달빛.
 *   · 그림자/반사: 물과 젖은 돌바닥, 이무기 비늘이 같은 환경맵(하늘+달)을 비춘다.
 */
const TAU = Math.PI * 2;
const R = CFG.pond.radius;
/** 원래 설계(반경 18) 대비 배율. 소품 개수/간격/크기를 여기에 맞춰 늘린다 */
const K = R / 18;
const WATER_Y = -1.0;

export const POND = {
  fog: 0x15191f,
  fogDensity: 0.0085,
  hemiSky: 0x8793a4,
  hemiGround: 0x0c1016,
  hemiIntensity: 0.95,
  moon: 0xb7c0cc,
  moonIntensity: 1.1,
  moonPos: [-10, 21, 8] as [number, number, number],
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  // CPU 래스터 캔버스: 도형이 수천 개 얹히는 텍스처 굽기는 GPU 캔버스보다 CPU가 훨씬 빠르고 메모리도 적게 든다
  return { cv, g: cv.getContext('2d', { willReadFrequently: true })! };
}

/* ───────────────────────── 바닥 문양: 똬리 튼 뱀 ───────────────────────── */
function drawSerpentGlyph(g: CanvasRenderingContext2D, S: number, lw: number, withHead = true) {
  const c = S / 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // 나선(뱀의 몸): 바깥에서 한가운데로 감겨 들어간다
  const turns = 4;
  const rMax = 0.6 * c;
  const rMin = 0.05 * c;
  const total = turns * TAU;
  g.beginPath();
  let ex = 0;
  let ey = 0;
  let ea = 0;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const th = u * total;
    const r = rMin + (rMax - rMin) * u;
    const x = c + Math.cos(th) * r;
    const y = c + Math.sin(th) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
    if (i === 400) {
      ex = x;
      ey = y;
      ea = th + Math.PI / 2 - 0.05;
    }
  }
  g.lineWidth = 15 * lw;
  g.stroke();
  // 머리: 나선 바깥 끝에서 바깥쪽을 노려보는 삼각형 머리
  if (withHead) {
    g.save();
    g.translate(ex, ey);
    g.rotate(ea);
    g.beginPath();
    g.moveTo(70, 0);
    g.lineTo(-28, -42);
    g.lineTo(-10, 0);
    g.lineTo(-28, 42);
    g.closePath();
    g.lineWidth = 7 * lw;
    g.stroke();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(14, s * 17, 6, 0, TAU);
      g.stroke();
    }
    g.restore();
  }
  // 가운데 눈 같은 고리
  g.beginPath();
  g.arc(c, c, 0.035 * c, 0, TAU);
  g.lineWidth = 6 * lw;
  g.stroke();
  // 비늘 눈금 고리(V자가 이어진 띠)
  const chev = (r: number, n: number, size: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = c + Math.cos(a) * r * c;
      const y = c + Math.sin(a) * r * c;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-size, -size * 0.9);
      g.lineTo(size * 0.6, 0);
      g.lineTo(-size, size * 0.9);
      g.lineWidth = 3.4 * lw;
      g.stroke();
      g.restore();
    }
  };
  chev(0.72, 56, 14);
  g.beginPath();
  g.arc(c, c, 0.672 * c, 0, TAU);
  g.lineWidth = 3 * lw;
  g.stroke();
  g.beginPath();
  g.arc(c, c, 0.77 * c, 0, TAU);
  g.lineWidth = 3 * lw;
  g.stroke();
  // 가장자리: 물결 띠
  g.beginPath();
  for (let i = 0; i <= 720; i++) {
    const a = (i / 720) * TAU;
    const r = (0.925 + 0.012 * Math.sin(a * 36)) * c;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.lineWidth = 4 * lw;
  g.stroke();
  g.beginPath();
  g.arc(c, c, 0.965 * c, 0, TAU);
  g.lineWidth = 5 * lw;
  g.stroke();
}

interface PondFloor {
  map: THREE.CanvasTexture;
  bumpRough: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
}

/** 방사형 돌판 바닥. 색 / (R=높이, G=거칠기) / 발광 세 장. */
function makePondFloor(rand: () => number): PondFloor {
  const S = 4096;
  const S2 = 2048; // 높이·거칠기는 절반 해상도
  const Sg = 2048; // 발광층(문양만)
  const f = S / 2048; // 예전 2048 기준으로 짠 픽셀 값(선 굵기, 알갱이 크기 등)에 곱한다
  const c = S / 2;
  interface Slab {
    r0: number;
    r1: number;
    a0: number;
    a1: number;
    col: [number, number, number];
    hv: number;
    rv: number;
  }
  const slabs: Slab[] = [];
  // 돌판 겹: 안쪽은 얇고 촘촘, 바깥은 넓다. 한 판의 길이가 6.5 안팎이 되도록 겹마다 개수를 계산한다
  const RB = [0, 0.05, 0.11, 0.18, 0.25, 0.32, 0.39, 0.46, 0.53, 0.6, 0.67, 0.74, 0.81, 0.88, 0.95, 1.02];
  const CNT = RB.slice(0, -1).map((r0, k) => (k === 0 ? 1 : Math.max(5, Math.round((TAU * ((r0 + RB[k + 1]) / 2) * R) / 6.5))));
  const PALETTE: [number, number, number][] = [
    [60, 76, 104],
    [50, 66, 90],
    [42, 56, 78],
    [64, 82, 98],
    [36, 48, 70],
    [72, 88, 110],
    [44, 66, 74],
    [56, 72, 100],
    [48, 62, 84],
  ];
  for (let k = 0; k < CNT.length; k++) {
    const n = CNT[k];
    const off = rand() * TAU;
    const cuts: number[] = [];
    for (let j = 0; j < n; j++) cuts.push(off + ((j + (n > 1 ? (rand() - 0.5) * 0.4 : 0)) / n) * TAU);
    cuts.sort((a, b) => a - b);
    for (let j = 0; j < n; j++) {
      const a0 = cuts[j];
      const a1 = n === 1 ? a0 + TAU : j + 1 < n ? cuts[j + 1] : cuts[0] + TAU;
      // 한 겹을 반지름 방향으로 한 번 더 쪼개는 돌도 있다
      const split = k >= 4 && rand() < 0.3;
      const pieces = split ? 2 : 1;
      const mid = RB[k] + (RB[k + 1] - RB[k]) * (0.4 + rand() * 0.2);
      for (let p = 0; p < pieces; p++) {
        const k0 = rand() * 0.28 + 0.86;
        const base = PALETTE[Math.floor(rand() * PALETTE.length)];
        slabs.push({
          r0: p === 0 ? RB[k] : mid,
          r1: pieces === 1 || p === 1 ? RB[k + 1] : mid,
          a0,
          a1,
          col: [base[0] * k0, base[1] * k0, base[2] * k0],
          hv: 150 + Math.floor(rand() * 70),
          rv: 165 + Math.floor(rand() * 60),
        });
      }
    }
  }
  const slabPath = (g: CanvasRenderingContext2D, s: Slab, scale: number, gap: number) => {
    const r0 = s.r0 * c * scale + gap;
    const r1 = Math.min(s.r1, 1.0) * c * scale - gap;
    g.beginPath();
    if (s.a1 - s.a0 >= TAU - 1e-6) {
      g.arc(c * scale, c * scale, r1, 0, TAU);
      if (r0 > 2 + gap) {
        g.moveTo(c * scale + r0, c * scale);
        g.arc(c * scale, c * scale, r0, 0, TAU, true);
      }
    } else {
      const ga0 = gap / Math.max(r0, 24);
      const ga1 = gap / Math.max(r1, 24);
      g.arc(c * scale, c * scale, r1, s.a0 + ga1, s.a1 - ga1);
      if (s.r0 <= 0) g.lineTo(c * scale, c * scale);
      else g.arc(c * scale, c * scale, r0, s.a1 - ga0, s.a0 + ga0, true);
    }
    g.closePath();
  };

  const col = canvas(S);
  const hgt = canvas(S2);
  const rgh = canvas(S2);
  const glw = canvas(Sg);
  const g = col.g;
  const b = hgt.g;
  const q = rgh.g;
  g.fillStyle = '#03060d';
  g.fillRect(0, 0, S, S);
  b.fillStyle = '#242424';
  b.fillRect(0, 0, S2, S2);
  q.fillStyle = '#d8d8d8';
  q.fillRect(0, 0, S2, S2);

  for (const s of slabs) {
    // 색 + 돌 한 장 안의 명암 (안쪽 가장자리는 밝고 바깥쪽은 어둡다). 클립 없이 같은 경로를 두 번 채운다
    slabPath(g, s, 1, 2.6 * f);
    g.fillStyle = `rgb(${s.col[0]},${s.col[1]},${s.col[2]})`;
    g.fill();
    const mx = c + Math.cos((s.a0 + s.a1) / 2) * ((s.r0 + s.r1) / 2) * c;
    const my = c + Math.sin((s.a0 + s.a1) / 2) * ((s.r0 + s.r1) / 2) * c;
    const gr = g.createRadialGradient(mx, my, 0, mx, my, (160 + (s.r1 - s.r0) * 400) * f);
    gr.addColorStop(0, 'rgba(150,190,240,0.10)');
    gr.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(170,205,255,0.10)';
    g.lineWidth = 3 * f;
    g.stroke();
    // 높이/거칠기
    slabPath(b, s, 0.5, 1.3);
    b.fillStyle = `rgb(${s.hv},${s.hv},${s.hv})`;
    b.fill();
    slabPath(q, s, 0.5, 1.3);
    q.fillStyle = `rgb(${s.rv},${s.rv},${s.rv})`;
    q.fill();
  }

  // 돌 표면의 알갱이
  for (let i = 0; i < 90000; i++) {
    const a = rand() * TAU;
    const d = Math.sqrt(rand()) * c;
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,10,0.16)' : 'rgba(170,205,255,0.07)';
    const sz = (1.5 + rand() * 4) * f * 0.8;
    g.fillRect(x, y, sz, sz);
  }

  // 이끼: 가장자리와 틈에 깔린 청록 이끼
  const blob = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) => {
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 420; i++) {
    const a = rand() * TAU;
    const d = c * (0.2 + Math.pow(rand(), 0.5) * 0.8);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const r = (30 + rand() * 90) * f * 0.8;
    blob(g, x, y, r, '36,110,84', 0.28 + rand() * 0.16);
    blob(q, x * 0.5, y * 0.5, r * 0.5, '250,250,250', 0.5);
  }
  // 물웅덩이: 짙은 청색 + 거울처럼 매끈하게 (거칠기를 낮춘다)
  for (let i = 0; i < 70; i++) {
    const a = rand() * TAU;
    const d = c * (0.1 + Math.sqrt(rand()) * 0.85);
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const ox = (rand() - 0.5) * 120 * f;
      const oy = (rand() - 0.5) * 120 * f;
      const r = (28 + rand() * 60) * f;
      blob(g, x + ox, y + oy, r, '4,14,34', 0.7);
      blob(g, x + ox, y + oy, r * 0.8, '90,150,210', 0.1);
      blob(q, (x + ox) * 0.5, (y + oy) * 0.5, r * 0.55, '12,12,12', 0.95);
      blob(b, (x + ox) * 0.5, (y + oy) * 0.5, r * 0.55, '20,20,20', 0.7);
    }
  }
  // 균열: 갈라진 틈에 물이 스며 있다
  const crack = (sx: number, sy: number, ang: number, len: number, w: number, depth: number) => {
    let x = sx;
    let y = sy;
    let a = ang;
    for (let i = 0; i < len; i++) {
      const nx = x + Math.cos(a) * (14 + rand() * 22) * f;
      const ny = y + Math.sin(a) * (14 + rand() * 22) * f;
      const ww = Math.max(1, w * (1 - i / len));
      g.strokeStyle = 'rgba(2,5,12,0.92)';
      g.lineWidth = ww;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      g.strokeStyle = 'rgba(80,150,200,0.14)';
      g.lineWidth = Math.max(1, ww * 0.35);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      b.strokeStyle = '#050505';
      b.lineWidth = Math.max(1, ww * 0.5);
      b.beginPath();
      b.moveTo(x * 0.5, y * 0.5);
      b.lineTo(nx * 0.5, ny * 0.5);
      b.stroke();
      q.strokeStyle = '#101010';
      q.lineWidth = Math.max(1, ww * 0.5);
      q.beginPath();
      q.moveTo(x * 0.5, y * 0.5);
      q.lineTo(nx * 0.5, ny * 0.5);
      q.stroke();
      if (depth > 0 && rand() < 0.2) crack(nx, ny, a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.6), Math.floor(len * 0.5), w * 0.6, depth - 1);
      x = nx;
      y = ny;
      a += (rand() - 0.5) * 0.9;
    }
  };
  for (let i = 0; i < 110; i++) {
    const a = rand() * TAU;
    const d = c * (0.06 + rand() * 0.9);
    crack(c + Math.cos(a) * d, c + Math.sin(a) * d, rand() * TAU, 8 + Math.floor(rand() * 12), 5 * f, 1);
  }

  // 문양: 음각 홈 + 차가운 청록 상감
  g.strokeStyle = '#02050b';
  drawSerpentGlyph(g, S, 1.3 * f);
  g.strokeStyle = 'rgba(96,214,230,0.34)';
  drawSerpentGlyph(g, S, 0.5 * f);
  b.save();
  b.scale(0.5, 0.5);
  b.strokeStyle = '#080808';
  drawSerpentGlyph(b, S, 1.3 * f);
  b.restore();
  q.save();
  q.scale(0.5, 0.5);
  q.strokeStyle = '#303030';
  drawSerpentGlyph(q, S, 0.9 * f);
  q.restore();

  // 가장자리로 갈수록 어둡게
  const vg = g.createRadialGradient(c, c, c * 0.74, c, c, c);
  vg.addColorStop(0, 'rgba(2,5,14,0)');
  vg.addColorStop(1, 'rgba(2,5,14,0.68)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);

  // 발광층
  const w = glw.g;
  w.clearRect(0, 0, Sg, Sg);
  w.shadowColor = '#46d0ee';
  w.shadowBlur = 12;
  w.strokeStyle = '#7fe8f4';
  drawSerpentGlyph(w, Sg, 0.9);

  // 높이(R) + 거칠기(G) 를 한 장에 합친다
  const hd = b.getImageData(0, 0, S2, S2);
  const rd = q.getImageData(0, 0, S2, S2);
  for (let i = 0; i < hd.data.length; i += 4) {
    hd.data[i + 1] = rd.data[i];
    hd.data[i + 2] = 0;
    hd.data[i + 3] = 255;
  }
  b.putImageData(hd, 0, 0);

  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(col.cv, true), bumpRough: mk(hgt.cv, false), glow: mk(glw.cv, true) };
}

/** 석단 옆면: 이끼 낀 쌓은 돌, 물가는 젖어 어둡다 */
function makeWallTex(rand: () => number) {
  const S = 512;
  const { cv, g } = canvas(S);
  g.fillStyle = '#0b1220';
  g.fillRect(0, 0, S, S);
  const rows = 4;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rand() * 90;
    while (x < S) {
      const w = 90 + rand() * 90;
      const k = 0.75 + rand() * 0.4;
      g.fillStyle = `rgb(${52 * k},${68 * k},${92 * k})`;
      g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
      g.fillStyle = 'rgba(160,200,255,0.08)';
      g.fillRect(x + 2, r * rh + 2, w - 4, 3);
      x += w;
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rr = 20 + rand() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(40,110,84,0.35)');
    gr.addColorStop(1, 'rgba(40,110,84,0)');
    g.fillStyle = gr;
    g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  // 물에 잠긴 아래쪽은 짙게
  const vg = g.createLinearGradient(0, 0, 0, S);
  vg.addColorStop(0, 'rgba(2,6,16,0)');
  vg.addColorStop(1, 'rgba(2,6,16,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 물결 법선맵 (이어 붙여도 이음새가 없다) */
function makeRippleNormal() {
  const S = 256;
  const h = new Float32Array(S * S);
  const waves: [number, number, number, number][] = [
    [3, 1, 1.0, 0.0],
    [2, 5, 0.7, 1.3],
    [7, 3, 0.45, 2.1],
    [5, 9, 0.3, 0.7],
    [11, 4, 0.22, 3.9],
    [13, 12, 0.15, 5.1],
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const [fx, fy, a, ph] of waves) v += a * Math.sin((x / S) * TAU * fx + (y / S) * TAU * fy + ph);
      h[y * S + x] = v;
    }
  }
  const { cv, g } = canvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      let nx = -dx * 0.5;
      let ny = -dy * 0.5;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 안개 띠용 구름 무늬 (이어 붙는다) */
function makeMistTex(rand: () => number) {
  const S = 256;
  const { cv, g } = canvas(S);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 18 + rand() * 46;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(255,255,255,${0.1 + rand() * 0.1})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeGlowTex() {
  const S = 128;
  const { cv, g } = canvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

/** 못 위에 번지는 거품 띠 (석단 둘레) */
function makeFoamTex() {
  const S = 512;
  const { cv, g } = canvas(S);
  const c = S / 2;
  const gr = g.createRadialGradient(c, c, c * 0.0, c, c, c);
  const r0 = (R + 0.4) / (R + 3.2);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(Math.max(0, r0 - 0.02), 'rgba(0,0,0,0)');
  gr.addColorStop(r0, 'rgba(160,215,255,0.9)');
  gr.addColorStop(Math.min(1, r0 + 0.04), 'rgba(110,170,235,0.35)');
  gr.addColorStop(1, 'rgba(90,150,230,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

/** 반사용 환경맵: 잿빛 먹구름 하늘 + 사방의 도깨비불 */
function makeEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const sc = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const pos = geo.getAttribute('position');
  const cols: number[] = [];
  const zen = new THREE.Color(0x14171c);
  const hor = new THREE.Color(0x58616d);
  const low = new THREE.Color(0x12161c);
  const nad = new THREE.Color(0x05070a);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y >= 0) c.copy(hor).lerp(zen, Math.pow(y, 0.55));
    else c.copy(low).lerp(nad, Math.pow(-y, 0.5));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe8ff).multiplyScalar(3.5), side: THREE.DoubleSide });
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * TAU;
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(1.1, 8), lampM);
    lamp.position.set(Math.cos(a) * 44, 3.5, Math.sin(a) * 44);
    lamp.lookAt(0, 0, 0);
    sc.add(lamp);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.025);
  pm.dispose();
  geo.dispose();
  return rt.texture;
}

interface Lantern {
  flame: THREE.Mesh;
  x: number;
  z: number;
  pool: THREE.Mesh;
  ph: number;
}

interface Wisp {
  pts: THREE.Points;
  base: Float32Array;
  ph: Float32Array;
}

/** 물결 고리 무늬: 바깥으로 갈수록 옅어지는 겹 고리 두 줄 */
function makeRippleRingTex(): THREE.CanvasTexture {
  const S = 128;
  const { cv, g } = canvas(S);
  const c = S / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0)');
  gr.addColorStop(0.62, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0)');
  gr.addColorStop(0.8, 'rgba(255,255,255,0)');
  gr.addColorStop(0.89, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.97, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 태풍 하늘: 가로로 길게 흐르는 잿빛 먹구름 (좌우로 이어 붙는 노이즈). 위쪽은 어둡고 지평선 쪽은 옅은 회색빛 */
function makeStormSkyTex(rand: () => number): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const img = g.createImageData(W, H);
  const GX = 16;
  const GY = 16;
  const lat = new Float32Array(GX * GY);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const sm = (x: number) => x * x * (3 - 2 * x);
  // 좌우로 이어지는 값 노이즈 (fx: 가로 격자 수 = 주기의 정수배)
  const noise = (u: number, v: number, fx: number, fy: number) => {
    const x = u * fx;
    const y = v * fy;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = sm(x - x0);
    const ty = sm(y - y0);
    const at = (ix: number, iy: number) => lat[(((iy % GY) + GY) % GY) * GX + (((ix % GX) + GX) % GX)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  const dark = [0.03, 0.035, 0.044];
  const light = [0.58, 0.62, 0.68];
  const edge = [0.3, 0.33, 0.37];
  for (let py = 0; py < H; py++) {
    const v = py / H; // 0 = 천정, 1 = 아래쪽
    const elev = 1 - v; // 1 천정 → 0 아래
    // 지평선 근처(elev 0.5 부근)는 구름이 얇고 밝다
    const horiz = 1 - Math.min(1, Math.abs(elev - 0.5) / 0.28);
    for (let px = 0; px < W; px++) {
      const u = px / W;
      // 가로로 길게 늘인 구름 + 큰 덩이
      let d = 0;
      let amp = 0.55;
      let fx = 4;
      let fy = 2;
      for (let o = 0; o < 5; o++) {
        d += noise(u + o * 0.13, v + o * 0.21, fx, fy) * amp;
        amp *= 0.52;
        fx = Math.min(GX, fx * 2);
        fy = Math.min(GY, fy * 2);
      }
      d /= 0.55 * (1 + 0.52 + 0.27 + 0.14 + 0.073);
      const cloud = Math.min(1, Math.max(0, (d - 0.36) / 0.22)); // 구름 두께 (경계를 또렷하게)
      const shade = sm(cloud);
      const base = 0.55 + 0.45 * horiz; // 지평선 쪽이 더 밝은 하늘빛
      const r = dark[0] + (light[0] - dark[0]) * (1 - shade) * base + edge[0] * 0.18 * horiz * shade;
      const gg = dark[1] + (light[1] - dark[1]) * (1 - shade) * base + edge[1] * 0.18 * horiz * shade;
      const bb = dark[2] + (light[2] - dark[2]) * (1 - shade) * base + edge[2] * 0.18 * horiz * shade;
      // 천정으로 갈수록 한층 어둡게
      const top = 0.6 + 0.4 * (1 - Math.max(0, elev - 0.6) / 0.4);
      const i = (py * W + px) * 4;
      img.data[i] = Math.min(255, r * top * 255);
      img.data[i + 1] = Math.min(255, gg * top * 255);
      img.data[i + 2] = Math.min(255, bb * top * 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 둥근 점 스프라이트(네모난 점 방지) */
function dotTexture(soft: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(Math.max(0.05, 1 - soft), 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}


export class Pond {
  readonly group = new THREE.Group();
  private lanterns: Lantern[] = [];
  /** 진짜 점광원은 4개뿐(조명 수가 바뀌면 셰이더를 다시 컴파일한다). 플레이어와 가까운 석등으로 부드럽게 옮겨 다닌다 */
  private lights: { l: THREE.PointLight; idx: number }[] = [];
  private floorGlow: THREE.MeshBasicMaterial;
  private water: THREE.MeshStandardMaterial;
  private rippleTex: THREE.Texture;
  private mist: { mat: THREE.MeshBasicMaterial; tex: THREE.Texture; sx: number; sz: number }[] = [];
  private wisps: Wisp[] = [];
  private skyTex!: THREE.CanvasTexture;
  private skyMat!: THREE.MeshBasicMaterial;
  private flashT = 8;
  private flash = 0;
  private lotus: THREE.MeshBasicMaterial;
  private foam: THREE.MeshBasicMaterial;
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; ph: number }[] = [];
  /** 석단 위에 고인 얕은 물 (살짝 비치고 물결이 일렁인다) */
  private shallowTex: THREE.Texture;
  /** 발걸음/이무기 몸이 만드는 물결 고리 */
  private ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; dur: number; r0: number; r1: number; a: number; on: boolean }[] = [];
  private rippleBudget = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer | null) {
    const rand = mulberry32(777);
    const root = this.group;
    scene.add(root);
    const env = renderer ? makeEnv(renderer) : null;
    envHolder.tex = env;

    /* ── 물: 끝없는 검은 못 ── */
    this.rippleTex = makeRippleNormal();
    this.rippleTex.repeat.set(46 * K * 1.2, 46 * K * 1.2);
    this.water = new THREE.MeshStandardMaterial({
      color: 0x0a1c3e,
      emissive: 0x040f26,
      roughness: 0.07,
      metalness: 0.15,
      normalMap: this.rippleTex,
      normalScale: new THREE.Vector2(0.55, 0.55),
      envMap: env,
      envMapIntensity: 1.5,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(430, 96).rotateX(-Math.PI / 2), this.water);
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    root.add(water);

    /* ── 석단 ── */
    const tex = makePondFloor(rand);
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex.map,
      bumpMap: tex.bumpRough,
      bumpScale: 1.8,
      roughnessMap: tex.bumpRough,
      roughness: 1,
      metalness: 0.05,
      envMap: env,
      envMapIntensity: 0.55,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), floorMat);
    floor.receiveShadow = true;
    root.add(floor);
    this.floorGlow = new THREE.MeshBasicMaterial({ map: tex.glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), this.floorGlow);
    glow.position.y = 0.012;
    root.add(glow);

    // 석단 위에도 물이 얕게 고여 있다: 돌바닥이 비쳐 보이는 반투명 수면 (텔레그래프/장판은 이보다 위에 그려진다)
    this.shallowTex = this.rippleTex.clone();
    this.shallowTex.needsUpdate = true;
    this.shallowTex.repeat.set(R / 6, R / 6);
    const shallowMat = new THREE.MeshStandardMaterial({
      color: 0x1d4f88,
      transparent: true,
      opacity: 0.36,
      roughness: 0.05,
      metalness: 0.2,
      normalMap: this.shallowTex,
      normalScale: new THREE.Vector2(0.4, 0.4),
      envMap: env,
      envMapIntensity: 1.5,
      depthWrite: false,
    });
    const shallow = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), shallowMat);
    shallow.position.y = 0.02;
    root.add(shallow);

    // 물결 고리 풀
    const rtex = makeRippleRingTex();
    const rgeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    for (let i = 0; i < 140; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: rtex, color: 0xa8cfff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(rgeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      root.add(mesh);
      this.ripples.push({ mesh, mat, t: 0, dur: 1, r0: 0.3, r1: 2, a: 0.5, on: false });
    }

    const wallTex = makeWallTex(rand);
    wallTex.repeat.set(Math.round(22 * K), 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0xffffff, roughness: 0.85, envMap: env, envMapIntensity: 0.3 });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.7, 2.6, 96, 1, true), wallMat);
    wall.position.y = -1.3;
    wall.receiveShadow = true;
    root.add(wall);

    // 거품 띠 + 천천히 퍼지는 물결 고리
    this.foam = new THREE.MeshBasicMaterial({ map: makeFoamTex(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0x8fbaff });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry((R + 3.2) * 2, (R + 3.2) * 2).rotateX(-Math.PI / 2), this.foam);
    foam.position.y = WATER_Y + 0.02;
    root.add(foam);
    const ringGeo = new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x7ab4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(ringGeo, mat);
      m.position.y = WATER_Y + 0.03;
      root.add(m);
      this.rings.push({ mesh: m, mat, ph: i / 3 });
    }

    /* ── 석재 재질 ── */
    const slate = new THREE.MeshStandardMaterial({ color: 0x3c4c6c, roughness: 0.85, flatShading: true, envMap: env, envMapIntensity: 0.4 });
    const slateDark = new THREE.MeshStandardMaterial({ color: 0x232d46, roughness: 0.9, flatShading: true, envMap: env, envMapIntensity: 0.3 });
    const mossy = new THREE.MeshStandardMaterial({ color: 0x35604f, roughness: 0.95, flatShading: true });
    const basalt = new THREE.MeshStandardMaterial({ color: 0x252f4a, roughness: 0.7, metalness: 0.1, flatShading: true, emissive: 0x04081a, envMap: env, envMapIntensity: 0.8 });

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, max: number, place: (i: number, d: THREE.Object3D, c: THREE.Color) => boolean | void, shadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      let n = 0;
      for (let i = 0; i < max; i++) {
        dummy.position.set(0, 0, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        tint.set(0xffffff);
        if (place(i, dummy, tint) === false) continue;
        dummy.updateMatrix();
        mesh.setMatrixAt(n, dummy.matrix);
        mesh.setColorAt(n, tint);
        n++;
      }
      mesh.count = n;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      root.add(mesh);
      return mesh;
    };

    /* 석단 가장자리: 이끼 낀 돌 둘레 */
    const box = new THREE.BoxGeometry(1, 1, 1);
    const CURB = Math.round(64 * K);
    const curbR = R + 0.4;
    instanced(box, slate, CURB, (i, d, c) => {
      if (rand() < 0.06) return false;
      const a = (i / CURB) * TAU;
      const len = ((TAU * curbR) / CURB) * (0.88 + rand() * 0.1);
      const h = 0.34 + rand() * 0.22;
      d.position.set(Math.cos(a) * (curbR + (rand() - 0.5) * 0.14), h / 2 - 0.02, Math.sin(a) * (curbR + (rand() - 0.5) * 0.14));
      d.rotation.y = -a + (rand() - 0.5) * 0.04;
      d.scale.set(0.95 + rand() * 0.2, h, len);
      c.setHex(rand() < 0.4 ? 0x35604f : 0x4c5f84).multiplyScalar(0.8 + rand() * 0.35);
    });

    /* ── 석등(石燈): 석단 가장자리를 빙 둘러 선다. 불은 전부 켜져 있고, 실제 빛은 가까운 4개가 맡는다 ── */
    const lanternStone = merge([
      placed(new THREE.CylinderGeometry(0.62, 0.78, 0.36, 8), [0, 0.18, 0]),
      placed(new THREE.CylinderGeometry(0.2, 0.26, 1.55, 8), [0, 1.13, 0]),
      placed(new THREE.CylinderGeometry(0.78, 0.46, 0.3, 8), [0, 2.05, 0]),
      // 화사석 기둥 네 개
      ...[0, 1, 2, 3].map((k) => placed(new THREE.BoxGeometry(0.14, 0.82, 0.14), [Math.cos((k / 4) * TAU + 0.785) * 0.46, 2.6, Math.sin((k / 4) * TAU + 0.785) * 0.46])),
      placed(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 8), [0, 3.05, 0]),
      placed(new THREE.ConeGeometry(1.12, 0.72, 8), [0, 3.47, 0]),
      placed(new THREE.SphereGeometry(0.2, 6, 5), [0, 3.95, 0]),
      placed(new THREE.ConeGeometry(0.1, 0.4, 6), [0, 4.22, 0]),
    ]);
    const lanternCore = new THREE.SphereGeometry(0.34, 8, 6);
    const flameGeo = new THREE.ConeGeometry(0.26, 1.1, 7).translate(0, 0.55, 0);
    const poolTex = makeGlowTex();
    const NL = Math.round(8 * K);
    const LS = 1.7; // 넓어진 석단에서도 멀리서 읽히도록 석등을 키운다
    for (let k = 0; k < NL; k++) {
      const a = ((k + 0.5) / NL) * TAU;
      const lx = Math.cos(a) * (R + 0.95);
      const lz = Math.sin(a) * (R + 0.95);
      const grp = new THREE.Group();
      grp.position.set(lx, 0, lz);
      grp.rotation.y = rand() * TAU;
      grp.scale.setScalar(LS);
      root.add(grp);
      const stone = new THREE.Mesh(lanternStone, slate);
      stone.castShadow = true;
      stone.receiveShadow = true;
      grp.add(stone);
      const coreM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ff0ff).multiplyScalar(2.2), toneMapped: false });
      const core = new THREE.Mesh(lanternCore, coreM);
      core.position.y = 2.6;
      grp.add(core);
      const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe0ff).multiplyScalar(1.5), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const flame = new THREE.Mesh(flameGeo, fm);
      flame.position.y = 2.45;
      grp.add(flame);
      const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0x4aa8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI / 2), poolMat);
      pool.position.set(lx - Math.cos(a) * 5.4, 0.03, lz - Math.sin(a) * 5.4);
      root.add(pool);
      this.lanterns.push({ flame, x: lx, z: lz, pool, ph: rand() * 20 });
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0x78d8ff, 46, 46, 1.3);
      l.position.set(this.lanterns[i * Math.floor(NL / 4)].x, 4.6, this.lanterns[i * Math.floor(NL / 4)].z);
      root.add(l);
      this.lights.push({ l, idx: i * Math.floor(NL / 4) });
    }

    /* ── 현무암 기둥 군락: 못 한가운데 솟은 검은 육각 기둥들 ── */
    const prism = new THREE.CylinderGeometry(0.88, 1.04, 1, 6, 1).translate(0, 0.5, 0);
    const clusters: { x: number; z: number; n: number; tall: number }[] = [];
    const NCL = Math.round(20 * K * 0.85);
    for (let i = 0; i < NCL; i++) {
      const a = (i / NCL) * TAU + (rand() - 0.5) * 0.12;
      // 보스 뒤쪽(-z) 방향은 시야가 트이도록 비워 둔다
      const d = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
      if (d < 0.32) continue;
      const rr = R + 10 + rand() * 46;
      clusters.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, n: 7 + Math.floor(rand() * 6), tall: (5 + rand() * 9) * 1.7 });
    }
    const prisms: { x: number; z: number; h: number; w: number; tx: number; tz: number; k: number }[] = [];
    for (const cl of clusters) {
      for (let j = 0; j < cl.n; j++) {
        const a = rand() * TAU;
        const dd = Math.sqrt(rand()) * 4.8;
        const fall = 1 - dd / 5.8;
        prisms.push({ x: cl.x + Math.cos(a) * dd, z: cl.z + Math.sin(a) * dd, h: Math.max(1.5, cl.tall * (0.35 + fall * 0.9) * (0.7 + rand() * 0.5)), w: (0.8 + rand() * 0.7) * 1.7, tx: (rand() - 0.5) * 0.1, tz: (rand() - 0.5) * 0.1, k: rand() });
      }
    }
    instanced(
      prism,
      basalt,
      prisms.length,
      (i, d, c) => {
        const p = prisms[i];
        d.position.set(p.x, WATER_Y - 1.2, p.z);
        d.rotation.set(p.tx, rand() * TAU, p.tz);
        d.scale.set(p.w, p.h + 1.2, p.w);
        c.setHex(0x2a3858).multiplyScalar(0.7 + p.k * 0.6);
      },
      false,
    );

    /* ── 부서진 돌다리: 석단 왼쪽 뒤에서 못으로 뻗다가 무너진다 ── */
    {
      const ang = -2.45; // 왼쪽 뒤
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const bridge = new THREE.Group();
      root.add(bridge);
      for (let i = 0; i < 11; i++) {
        const d = R + 1.7 + i * 4.8 + rand() * 0.4;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.7, 4.2), slate);
        const sink = i > 5 ? (i - 5) * 0.28 : 0;
        slab.position.set(dx * d, -0.18 - sink, dz * d);
        slab.rotation.set((rand() - 0.5) * 0.06 * i * 0.3, -ang + Math.PI / 2 + (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08 * (1 + i * 0.2));
        slab.castShadow = true;
        slab.receiveShadow = true;
        if (i === 8 || i === 10) slab.visible = false; // 끊어진 자리
        bridge.add(slab);
        if (i < 8) {
          for (const s of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.4 - (i > 4 ? (i - 4) * 0.18 : 0), 6), slateDark);
            post.position.set(dx * d - dz * s * 2.9, 0.5, dz * d + dx * s * 2.9);
            post.castShadow = true;
            bridge.add(post);
          }
        }
      }
      // 다리 끝에 서 있던 문의 잔해
      const gx = dx * (R + 1.7 + 11 * 4.8);
      const gz = dz * (R + 1.7 + 11 * 4.8);
      for (const s of [-1, 1]) {
        const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, s > 0 ? 6.5 : 3.2, 7), slate);
        pil.position.set(gx - dz * s * 2.6, s > 0 ? 2.2 : 0.6, gz + dx * s * 2.6);
        pil.rotation.z = s > 0 ? 0 : 0.2;
        pil.castShadow = true;
        bridge.add(pil);
      }
    }

    /* ── 징검돌과 갈대, 연잎 ── */
    const stepGeo = new THREE.CylinderGeometry(1, 1.15, 0.6, 7);
    instanced(
      stepGeo,
      slate,
      Math.round(46 * K * 1.4),
      (i, d, c) => {
        const a = rand() * TAU;
        const r = R + 4 + Math.pow(rand(), 0.8) * 62;
        const s = (0.6 + rand() * 1.3) * 1.5;
        d.position.set(Math.cos(a) * r, WATER_Y + 0.05 + rand() * 0.15, Math.sin(a) * r);
        d.rotation.y = rand() * TAU;
        d.scale.set(s, 0.6 + rand() * 0.8, s);
        c.setHex(0x44587c).multiplyScalar(0.7 + rand() * 0.5);
      },
      false,
    );
    const reedGeo = new THREE.ConeGeometry(0.07, 1, 4).translate(0, 0.5, 0);
    const clumps: [number, number][] = [];
    for (let i = 0; i < Math.round(34 * K * 1.2); i++) {
      const a = rand() * TAU;
      const r = R + 1.8 + Math.pow(rand(), 1.3) * 34;
      clumps.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    instanced(
      reedGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      clumps.length * 9,
      (i, d, c) => {
        const cl = clumps[Math.floor(i / 9)];
        d.position.set(cl[0] + (rand() - 0.5) * 1.6, WATER_Y - 0.2, cl[1] + (rand() - 0.5) * 1.6);
        d.rotation.set((rand() - 0.5) * 0.35, rand() * TAU, (rand() - 0.5) * 0.35);
        d.scale.set(1, 2 + rand() * 2.6, 1);
        c.setHex(0x2e5a44).multiplyScalar(0.6 + rand() * 0.6);
      },
      false,
    );
    const padGeo = new THREE.CircleGeometry(1, 9).rotateX(-Math.PI / 2);
    const pads: [number, number, number][] = [];
    instanced(
      padGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
      Math.round(70 * K * 1.2),
      (i, d, c) => {
        const a = rand() * TAU;
        const r = R + 1.6 + Math.sqrt(rand()) * 62;
        const s = (0.7 + rand() * 1.3) * 1.4;
        d.position.set(Math.cos(a) * r, WATER_Y + 0.04, Math.sin(a) * r);
        d.rotation.y = rand() * TAU;
        d.scale.set(s, 1, s);
        c.setHex(0x1f5a44).multiplyScalar(0.6 + rand() * 0.6);
        if (i < 40) pads.push([d.position.x, d.position.z, s]);
      },
      false,
    );
    // 빛나는 연꽃 (일부 연잎 위)
    this.lotus = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc8b0ff).multiplyScalar(1.6), toneMapped: false });
    const petal = new THREE.ConeGeometry(0.2, 0.55, 5).translate(0, 0.28, 0);
    const lotusGeos: THREE.BufferGeometry[] = [];
    for (const [px, pz, s] of pads) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        lotusGeos.push(aimed(petal, [px + Math.cos(a) * 0.12 * s, WATER_Y + 0.05, pz + Math.sin(a) * 0.12 * s], [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], [s * 0.8, s * 0.8, s * 0.8]));
      }
    }
    if (lotusGeos.length) root.add(new THREE.Mesh(merge(lotusGeos), this.lotus));

    /* ── 안개 띠: 수면 위를 느리게 흐른다 ── */
    const mistTex = makeMistTex(rand);
    for (let i = 0; i < 2; i++) {
      const t = mistTex.clone();
      t.needsUpdate = true;
      t.repeat.set((9 + i * 4) * 2.4, (9 + i * 4) * 2.4);
      const mat = new THREE.MeshBasicMaterial({ map: t, color: i === 0 ? 0x68727f : 0x838e9c, transparent: true, opacity: i === 0 ? 0.3 : 0.22, depthWrite: false, toneMapped: false });
      const m = new THREE.Mesh(new THREE.RingGeometry(R + 0.8, 330, 96, 1).rotateX(-Math.PI / 2), mat);
      m.position.y = WATER_Y + 0.35 + i * 0.7;
      root.add(m);
      this.mist.push({ mat, tex: t, sx: 0.004 + i * 0.003, sz: 0.002 - i * 0.004 });
    }

    /* ── 하늘 돔: 태풍 속 잿빛 먹구름. 구름이 천천히 흘러가고, 가끔 먼 번개가 구름 속에서 번쩍인다 ── */
    {
      const geo = new THREE.SphereGeometry(300, 32, 20);
      this.skyTex = makeStormSkyTex(rand);
      this.skyMat = new THREE.MeshBasicMaterial({ map: this.skyTex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false });
      const dome = new THREE.Mesh(geo, this.skyMat);
      dome.renderOrder = -10;
      dome.frustumCulled = false;
      root.add(dome);
    }

    /* ── 도깨비불 + 푸른 먼지 ── */
    const wisp = (n: number, color: number, size: number, opacity: number, spread: number, top: number) => {
      const base = new Float32Array(n * 3);
      const ph = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const r = R * 0.2 + Math.sqrt(rand()) * spread;
        const t = rand() * TAU;
        base[i * 3] = Math.cos(t) * r;
        base[i * 3 + 1] = WATER_Y + 0.3 + rand() * top;
        base[i * 3 + 2] = Math.sin(t) * r;
        ph[i] = rand() * 100;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTexture(0.8), color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      pts.frustumCulled = false;
      root.add(pts);
      this.wisps.push({ pts, base, ph });
    };
    wisp(Math.round(110 * K * 1.4), 0x9ff2ff, 0.2, 0.9, R + 14, 7);
    wisp(Math.round(220 * K * 1.6), 0x9db8ff, 0.07, 0.32, R + 6, 11);
  }

  /**
   * (x,z) 에서 번져 나가는 물결 하나. size = 최종 반지름 기준 크기, strength 0~1.
   * 석단 안쪽이면 석단 위 얕은 물에, 바깥이면 못 수면에 그린다. 한꺼번에 너무 많이 쏟아지면 일부는 버린다.
   */
  ripple(x: number, z: number, size = 1, strength = 0.5) {
    if (this.rippleBudget < 1) return;
    const r = this.ripples.find((q) => !q.on);
    if (!r) return;
    this.rippleBudget -= 1;
    r.on = true;
    r.t = 0;
    r.dur = 1.1 + size * 0.45;
    r.r0 = 0.25 + size * 0.15;
    r.r1 = 1.1 + size * 1.9;
    r.a = Math.min(0.85, strength);
    r.mesh.position.set(x, Math.hypot(x, z) < R + 0.3 ? 0.03 : WATER_Y + 0.05, z);
    r.mesh.visible = true;
  }

  update(dt: number, t: number, fx = 0, fz = 0) {
    this.rippleBudget = Math.min(8, this.rippleBudget + dt * 70);
    this.shallowTex.offset.x -= dt * 0.012;
    this.shallowTex.offset.y += dt * 0.007;
    for (const r of this.ripples) {
      if (!r.on) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.on = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mat.opacity = r.a * Math.pow(1 - k, 1.4) * Math.min(1, k * 10);
    }
    this.skyTex.offset.x += dt * 0.0035;
    // 먼 번개: 구름 속이 두 번 깜빡인다
    this.flashT -= dt;
    if (this.flashT < 0) {
      this.flash = 1;
      this.flashT = 7 + Math.random() * 9;
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const fl = this.flash > 0 ? Math.max(0, Math.sin(this.flash * 14)) * this.flash : 0;
    this.skyMat.color.setScalar(1 + fl * 1.7);
    this.rippleTex.offset.x += dt * 0.006;
    this.rippleTex.offset.y += dt * 0.0035;
    for (const m of this.mist) {
      m.tex.offset.x += dt * m.sx;
      m.tex.offset.y += dt * m.sz;
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.9);
    this.floorGlow.opacity = 0.11 + 0.08 * pulse;
    this.foam.opacity = 0.42 + 0.14 * Math.sin(t * 0.7);
    this.lotus.color.setRGB(1.0, 0.8, 1.0).multiplyScalar(1.3 + 0.5 * Math.sin(t * 1.3));
    for (const r of this.rings) {
      const k = (t * 0.12 + r.ph) % 1;
      r.mesh.scale.setScalar(R + 0.6 + k * 11 * K);
      r.mat.opacity = 0.26 * (1 - k) * Math.min(1, k * 6);
    }
    const flick = (l: Lantern) => 0.88 + 0.1 * Math.sin(t * 9 + l.ph) + 0.05 * Math.sin(t * 23 + l.ph * 2.1) + 0.04 * Math.sin(t * 4.1 + l.ph * 0.7);
    for (const l of this.lanterns) {
      const f = flick(l);
      l.flame.scale.set(1 + 0.12 * Math.sin(t * 15 + l.ph), 0.9 + 0.3 * f, 1 + 0.12 * Math.cos(t * 13 + l.ph));
      (l.pool.material as THREE.MeshBasicMaterial).opacity = 0.14 + 0.08 * f;
    }
    // 플레이어 가까운 석등 4개에 진짜 빛을 붙인다 (이미 맡은 석등이 4위 안이면 그대로)
    const order = this.lanterns.map((l, i) => ({ i, d: (l.x - fx) * (l.x - fx) + (l.z - fz) * (l.z - fz) })).sort((a, b) => a.d - b.d);
    const want = new Set(order.slice(0, this.lights.length).map((o) => o.i));
    const free = order.slice(0, this.lights.length).map((o) => o.i).filter((i) => !this.lights.some((s) => s.idx === i));
    for (const s of this.lights) if (!want.has(s.idx)) s.idx = free.shift() ?? s.idx;
    const kk = 1 - Math.exp(-5 * dt);
    for (const s of this.lights) {
      const lt = this.lanterns[s.idx];
      const ld = Math.hypot(lt.x, lt.z) || 1;
      s.l.position.x += (lt.x - (lt.x / ld) * 3.2 - s.l.position.x) * kk;
      s.l.position.z += (lt.z - (lt.z / ld) * 3.2 - s.l.position.z) * kk;
      s.l.intensity = 46 * flick(lt);
    }
    for (const w of this.wisps) {
      const a = w.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        const p = w.ph[i];
        a.setXYZ(i, w.base[i * 3] + Math.sin(t * 0.35 + p) * 1.6, w.base[i * 3 + 1] + Math.sin(t * 0.8 + p * 1.7) * 0.5 + (Math.sin(t * 0.13 + p) * 0.5 + 0.5) * 1.2, w.base[i * 3 + 2] + Math.cos(t * 0.3 + p * 1.3) * 1.6);
      }
      a.needsUpdate = true;
    }
  }
}
