import * as THREE from 'three';
import { CFG } from './config';
import { PAL } from './palette';

const TAU = Math.PI * 2;

/** 시드 고정 난수 — 새로 고침해도 같은 유적 모양이 나오도록 */
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
  return { cv, g: cv.getContext('2d')! };
}

/** 중앙 문양 + 가장자리 상감. 색 캔버스(홈), 높이 캔버스(음각), 발광 캔버스에 같은 도형을 그린다. */
function drawGlyph(g: CanvasRenderingContext2D, S: number, lineW: number) {
  const c = S / 2;
  const ring = (r: number, w: number) => {
    g.beginPath();
    g.arc(c, c, r * c, 0, TAU);
    g.lineWidth = w * lineW;
    g.stroke();
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // 가장자리: 이중 고리 + 눈금
  ring(0.972, 5);
  ring(0.935, 2.5);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * TAU;
    const r0 = 0.89;
    const r1 = i % 4 === 0 ? 0.925 : 0.905;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0 * c, c + Math.sin(a) * r0 * c);
    g.lineTo(c + Math.cos(a) * r1 * c, c + Math.sin(a) * r1 * c);
    g.lineWidth = 2.5 * lineW;
    g.stroke();
  }

  // 태양 문양: 겹쳐진 고리 + 8방향 빛살
  ring(0.62, 5);
  ring(0.595, 2.5);
  ring(0.34, 5);
  ring(0.12, 4);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + Math.PI / 16;
    const long = i % 2 === 0;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * 0.36 * c, c + Math.sin(a) * 0.36 * c);
    g.lineTo(c + Math.cos(a) * (long ? 0.585 : 0.5) * c, c + Math.sin(a) * (long ? 0.585 : 0.5) * c);
    g.lineWidth = (long ? 4 : 2.5) * lineW;
    g.stroke();
  }
  // 8각 별 (두 사각형)
  for (const rot of [0, Math.PI / 4]) {
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * TAU + rot + Math.PI / 8;
      const x = c + Math.cos(a) * 0.32 * c;
      const y = c + Math.sin(a) * 0.32 * c;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineWidth = 3 * lineW;
    g.stroke();
  }
  // 바깥으로 휘어 뻗은 8개의 갈고리 (거미 다리를 닮은 장식)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const a2 = a + 0.22;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * 0.63 * c, c + Math.sin(a) * 0.63 * c);
    g.quadraticCurveTo(c + Math.cos(a + 0.18) * 0.78 * c, c + Math.sin(a + 0.18) * 0.78 * c, c + Math.cos(a2) * 0.86 * c, c + Math.sin(a2) * 0.86 * c);
    g.lineWidth = 4 * lineW;
    g.stroke();
  }
}

interface FloorTex {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  glow: THREE.CanvasTexture;
}

function makeFloor(rand: () => number): FloorTex {
  const S = 2048;
  const c = S / 2;
  const col = canvas(S);
  const bmp = canvas(S);
  const glw = canvas(S);
  const g = col.g;
  const b = bmp.g;

  g.fillStyle = '#150b07'; // 줄눈(틈)
  g.fillRect(0, 0, S, S);
  b.fillStyle = '#101010';
  b.fillRect(0, 0, S, S);

  const STONES: [number, number, number][] = [
    [106, 92, 78], // 사암
    [112, 94, 68], // 황토
    [80, 68, 60], // 암갈
    [100, 72, 60], // 붉은 돌
    [90, 84, 78], // 재색
  ];
  const WEIGHT = [0.3, 0.2, 0.2, 0.15, 0.15];
  const pick = () => {
    let r = rand();
    for (let i = 0; i < STONES.length; i++) {
      r -= WEIGHT[i];
      if (r <= 0) return STONES[i];
    }
    return STONES[0];
  };

  // 불규칙하게 쪼개진 판석 (벽돌 줄눈처럼 보이지 않도록 재귀 분할)
  const cracksAt: [number, number][] = [];
  const slab = (x: number, y: number, w: number, h: number) => {
    const cx = x + w / 2 - c;
    const cy = y + h / 2 - c;
    if (Math.hypot(cx, cy) > c * 1.15) return;
    const base = pick();
    const k = 0.78 + rand() * 0.3;
    const r = base[0] * k;
    const gr = base[1] * k;
    const bl = base[2] * k;
    const ins = 2.5;
    const grad = g.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, `rgb(${r * 1.1},${gr * 1.1},${bl * 1.1})`);
    grad.addColorStop(1, `rgb(${r * 0.84},${gr * 0.84},${bl * 0.84})`);
    g.fillStyle = grad;
    g.fillRect(x + ins, y + ins, w - ins * 2, h - ins * 2);
    // 윗면/왼쪽 모서리 빛, 아래/오른쪽 그늘
    g.fillStyle = 'rgba(255,225,170,0.12)';
    g.fillRect(x + ins, y + ins, w - ins * 2, 2.5);
    g.fillRect(x + ins, y + ins, 2.5, h - ins * 2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(x + ins, y + h - ins - 3, w - ins * 2, 3);
    g.fillRect(x + w - ins - 3, y + ins, 3, h - ins * 2);
    // 알갱이
    const grains = Math.floor((w * h) / 400);
    for (let i = 0; i < grains; i++) {
      g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,230,180,0.06)';
      const sz = 1.5 + rand() * 5;
      g.fillRect(x + ins + rand() * (w - 2 * ins), y + ins + rand() * (h - 2 * ins), sz, sz);
    }
    // 높이 맵: 석판마다 조금씩 다른 높이
    const hv = 150 + Math.floor(rand() * 60);
    b.fillStyle = `rgb(${hv},${hv},${hv})`;
    b.fillRect(x + ins, y + ins, w - ins * 2, h - ins * 2);
    // 모서리 깨짐
    if (rand() < 0.45) {
      const cxn = rand() < 0.5 ? x + ins : x + w - ins;
      const cyn = rand() < 0.5 ? y + ins : y + h - ins;
      const sx = cxn === x + ins ? 1 : -1;
      const sy = cyn === y + ins ? 1 : -1;
      const sz = 14 + rand() * 34;
      for (const ctx of [g, b]) {
        ctx.fillStyle = ctx === g ? '#150b07' : '#101010';
        ctx.beginPath();
        ctx.moveTo(cxn, cyn);
        ctx.lineTo(cxn + sx * sz, cyn);
        ctx.lineTo(cxn + sx * sz * 0.3, cyn + sy * sz * 0.7);
        ctx.lineTo(cxn, cyn + sy * sz);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (rand() < 0.16) cracksAt.push([x + rand() * w, y + rand() * h]);
  };
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    if (depth >= 3 || (depth > 0 && rand() < 0.22) || (w < 150 && h < 150)) {
      slab(x, y, w, h);
      return;
    }
    const vertical = w > h * (0.8 + rand() * 0.5);
    const t = 0.34 + rand() * 0.32;
    if (vertical) {
      split(x, y, w * t, h, depth + 1);
      split(x + w * t, y, w * (1 - t), h, depth + 1);
    } else {
      split(x, y, w, h * t, depth + 1);
      split(x, y + h * t, w, h * (1 - t), depth + 1);
    }
  };
  {
    let yy = -rand() * 200;
    while (yy < S) {
      const rowH = 300 + rand() * 120;
      let xx = -rand() * 300;
      while (xx < S) {
        const cw = 300 + rand() * 140;
        split(xx, yy, cw, rowH, 0);
        xx += cw;
      }
      yy += rowH;
    }
  }

  // 때·그을음 얼룩
  for (let i = 0; i < 70; i++) {
    const a = rand() * TAU;
    const d = Math.sqrt(rand()) * c * 0.98;
    const x = c + Math.cos(a) * d;
    const yy = c + Math.sin(a) * d;
    const r = 50 + rand() * 150;
    const gr = g.createRadialGradient(x, yy, 0, x, yy, r);
    gr.addColorStop(0, 'rgba(12,6,3,0.30)');
    gr.addColorStop(1, 'rgba(12,6,3,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, yy - r, r * 2, r * 2);
  }
  // 가장자리에 쌓인 모래
  for (let i = 0; i < 46; i++) {
    const a = rand() * TAU;
    const d = c * (0.78 + rand() * 0.2);
    const x = c + Math.cos(a) * d;
    const yy = c + Math.sin(a) * d;
    const r = 40 + rand() * 110;
    const gr = g.createRadialGradient(x, yy, 0, x, yy, r);
    gr.addColorStop(0, 'rgba(196,150,86,0.20)');
    gr.addColorStop(1, 'rgba(196,150,86,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, yy - r, r * 2, r * 2);
  }

  // 균열
  const crack = (sx: number, sy: number, ang: number, len: number, w: number, depth: number) => {
    let x = sx;
    let yy = sy;
    let a = ang;
    g.lineCap = b.lineCap = 'round';
    for (let i = 0; i < len; i++) {
      const nx = x + Math.cos(a) * (14 + rand() * 24);
      const ny = yy + Math.sin(a) * (14 + rand() * 24);
      const ww = Math.max(1, w * (1 - i / len));
      g.strokeStyle = 'rgba(14,7,3,0.9)';
      g.lineWidth = ww;
      g.beginPath();
      g.moveTo(x, yy);
      g.lineTo(nx, ny);
      g.stroke();
      b.strokeStyle = '#080808';
      b.lineWidth = ww + 1;
      b.beginPath();
      b.moveTo(x, yy);
      b.lineTo(nx, ny);
      b.stroke();
      if (depth > 0 && rand() < 0.2) crack(nx, ny, a + (rand() < 0.5 ? 1 : -1) * (0.6 + rand() * 0.6), Math.floor(len * 0.5), w * 0.6, depth - 1);
      x = nx;
      yy = ny;
      a += (rand() - 0.5) * 0.9;
    }
  };
  for (const [x, yy] of cracksAt) crack(x, yy, rand() * TAU, 5 + Math.floor(rand() * 8), 4, 1);
  for (let i = 0; i < 7; i++) {
    const a = rand() * TAU;
    const d = c * (0.15 + rand() * 0.75);
    crack(c + Math.cos(a) * d, c + Math.sin(a) * d, rand() * TAU, 12 + Math.floor(rand() * 10), 6, 2);
  }

  // 문양: 음각 홈 → 바랜 금 상감
  g.strokeStyle = '#120905';
  drawGlyph(g, S, 1.15);
  g.strokeStyle = 'rgba(170,124,50,0.45)';
  drawGlyph(g, S, 0.5);
  b.strokeStyle = '#0c0c0c';
  drawGlyph(b, S, 1.15);

  // 가장자리 어둡게 (벽에 가까울수록 그림자)
  const vg = g.createRadialGradient(c, c, c * 0.72, c, c, c * 1.0);
  vg.addColorStop(0, 'rgba(10,5,2,0)');
  vg.addColorStop(1, 'rgba(10,5,2,0.72)');
  g.fillStyle = vg;
  g.fillRect(0, 0, S, S);

  // 발광(룬이 은은히 달아오르는 층)
  const w = glw.g;
  w.clearRect(0, 0, S, S);
  w.shadowColor = '#ff9a2a';
  w.shadowBlur = 10;
  w.strokeStyle = '#ffb040';
  drawGlyph(w, S, 0.45);

  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: mk(col.cv, true), bump: mk(bmp.cv, false), glow: mk(glw.cv, true) };
}

/** 돌덩이 표면의 얼룩 (인스턴스 색에 곱해짐) */
function makeStoneTex(rand: () => number) {
  const S = 256;
  const { cv, g } = canvas(S);
  g.fillStyle = '#b8a48e';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 8 + rand() * 40;
    const v = rand() < 0.5 ? 0 : 255;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},${0.05 + rand() * 0.08})`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,240,210,0.09)';
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 2.5, 1 + rand() * 2.5);
  }
  // 가로로 켜켜이 쌓인 결
  for (let i = 0; i < 9; i++) {
    g.fillStyle = 'rgba(0,0,0,0.07)';
    g.fillRect(0, rand() * S, S, 1 + rand() * 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 바깥 땅: 반복되는 거친 흙/자갈 */
function makeGroundTex(rand: () => number) {
  const S = 256;
  const { cv, g } = canvas(S);
  g.fillStyle = '#4a3a2e';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 6 + rand() * 26;
    const v = rand() < 0.5 ? '0,0,0' : '210,170,110';
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${0.08 + rand() * 0.1})`);
    gr.addColorStop(1, `rgba(${v},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,220,160,0.16)';
    g.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1 + rand() * 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function makePoolTex() {
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

interface Brazier {
  flames: { mesh: THREE.Mesh; sy: number; ph: number }[];
  light: THREE.PointLight | null;
  pool: THREE.Mesh;
  ph: number;
  base: number;
}

interface Drift {
  pts: THREE.Points;
  speed: Float32Array;
  top: number;
  sway: number;
}

export class Arena {
  private braziers: Brazier[] = [];
  private glyphMats: THREE.MeshBasicMaterial[] = [];
  private floorGlow: THREE.MeshBasicMaterial;
  private drifts: Drift[] = [];

  constructor(scene: THREE.Scene) {
    const R = CFG.arena.radius;
    const rand = mulberry32(20241);
    scene.background = new THREE.Color(PAL.fog);
    scene.fog = new THREE.FogExp2(PAL.fog, 0.012);

    /* 조명: 따뜻한 최소 환경광 + 천장 틈으로 새어 드는 빛(그림자). 등불이 약해져도 바닥 윤곽은 읽히게. */
    scene.add(new THREE.HemisphereLight(0xc08a62, 0x24120a, 0.78));
    const sun = new THREE.DirectionalLight(0xffc690, 1.1);
    sun.position.set(-9, 20, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);

    /* 바닥: 어긋나게 깔린 석판 + 균열 + 중앙의 태양 문양 */
    const tex = makeFloor(rand);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex.map, bumpMap: tex.bump, bumpScale: 2.2, roughness: 0.92, metalness: 0 }),
    );
    floor.receiveShadow = true;
    scene.add(floor);

    // 문양이 달아오르는 층 (가산 합성)
    this.floorGlow = new THREE.MeshBasicMaterial({ map: tex.glow, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), this.floorGlow);
    glow.position.y = 0.012;
    scene.add(glow);

    /* 바깥 땅 */
    const gtex = makeGroundTex(rand);
    gtex.repeat.set(16, 16);
    const ground = new THREE.Mesh(new THREE.RingGeometry(R, 70, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gtex, roughness: 1, color: 0x6e5a48 }));
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const outer = new THREE.Mesh(new THREE.CircleGeometry(160, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.void }));
    outer.position.y = -0.3;
    scene.add(outer);

    /* 돌 재질 */
    const stoneTex = makeStoneTex(rand);
    const stone = new THREE.MeshStandardMaterial({ color: 0xb4a08c, map: stoneTex, roughness: 0.95, flatShading: true });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x7a6858, map: stoneTex, roughness: 0.95, flatShading: true });
    const STONE_COLS = [0x7e6851, 0x6e5848, 0x8b705a, 0x5f4b3f, 0x84573f, 0x786a5e].map((h) => new THREE.Color(h));

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, max: number, place: (i: number, d: THREE.Object3D, c: THREE.Color) => boolean | void) => {
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
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };
    const stoneTint = (c: THREE.Color, lo = 0.8, hi = 1.15) => {
      c.copy(STONE_COLS[Math.floor(rand() * STONE_COLS.length)]).multiplyScalar(lo + rand() * (hi - lo));
    };
    const box = new THREE.BoxGeometry(1, 1, 1);

    /* 연석: 바닥 가장자리를 두른 낮은 돌 */
    const CURB_N = 60;
    const curbR = R + 0.55;
    instanced(box, stone, CURB_N, (i, d, c) => {
      if (rand() < 0.05) return false;
      const a = (i / CURB_N) * TAU;
      const len = ((TAU * curbR) / CURB_N) * (0.9 + rand() * 0.1);
      const h = 0.42 + rand() * 0.2;
      d.position.set(Math.cos(a) * (curbR + (rand() - 0.5) * 0.18), h / 2 - 0.02, Math.sin(a) * (curbR + (rand() - 0.5) * 0.18));
      d.rotation.y = -a + (rand() - 0.5) * 0.05;
      d.scale.set(1.05 + rand() * 0.15, h, len);
      stoneTint(c, 0.95, 1.3);
    });

    /* 뒤쪽 무너진 외벽 */
    const WALL_N = 44;
    const wallR = R + 4.4;
    const wallH: number[] = [];
    instanced(box, stone, WALL_N * 2, (k, d, c) => {
      const i = k >> 1;
      const top = k & 1;
      const a = ((i + 0.5) / WALL_N) * TAU;
      if (!top) {
        const gap = rand() < 0.14;
        const h = gap ? 0.5 + rand() * 0.8 : 1.8 + rand() * 3.4;
        wallH[i] = h;
        const len = ((TAU * wallR) / WALL_N) * 1.03;
        d.position.set(Math.cos(a) * wallR, h / 2, Math.sin(a) * wallR);
        d.rotation.y = -a;
        d.scale.set(1.5 + rand() * 0.3, h, len);
        stoneTint(c, 0.7, 1.0);
      } else {
        // 부서진 윗부분: 한쪽으로 치우친 작은 돌덩이
        if (wallH[i] < 1.6 || rand() < 0.4) return false;
        const h = 0.5 + rand() * 1.0;
        const len = ((TAU * wallR) / WALL_N) * (0.4 + rand() * 0.4);
        const off = (rand() - 0.5) * 1.2;
        d.position.set(Math.cos(a) * wallR - Math.sin(a) * off, wallH[i] + h / 2, Math.sin(a) * wallR + Math.cos(a) * off);
        d.rotation.set((rand() - 0.5) * 0.15, -a + (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.15);
        d.scale.set(1.3, h, len);
        stoneTint(c, 0.75, 1.05);
      }
    });

    /* 기둥 — 멀쩡한 것 / 부러진 것 / 밑동만 남은 것 */
    const PR = CFG.arena.pillarR; // 외벽 바깥 — 플레이어/카메라가 가까이 가지 못한다
    const pillarN = CFG.arena.pillars;
    const kinds: ('tall' | 'broken' | 'stump')[] = [];
    for (let i = 0; i < pillarN; i++) {
      const r = rand();
      kinds.push(r < 0.58 ? 'tall' : r < 0.85 ? 'broken' : 'stump');
    }
    kinds[Math.floor(pillarN * 0.75)] = 'tall'; // 위쪽(카메라 안쪽)에 서 있는 기둥이 적어도 하나
    const shaftGeo = new THREE.CylinderGeometry(0.78, 0.92, 1, 10);
    const bandGeo = new THREE.CylinderGeometry(0.98, 0.98, 0.2, 10);
    const baseGeo = new THREE.CylinderGeometry(1.12, 1.24, 0.38, 10);
    const capGeo = new THREE.CylinderGeometry(1.3, 0.9, 0.5, 10);
    const slabGeo = new THREE.BoxGeometry(2.5, 0.5, 2.5);
    const abacusGeo = new THREE.BoxGeometry(2.3, 0.4, 2.3);
    const glyphGeo = new THREE.BoxGeometry(0.06, 0.5, 0.18);
    const mkMesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };
    for (let i = 0; i < pillarN; i++) {
      const a = (i / pillarN) * TAU;
      const grp = new THREE.Group();
      grp.position.set(Math.cos(a) * PR, 0, Math.sin(a) * PR);
      grp.rotation.y = -a;
      grp.scale.setScalar(1.3); // 멀어진 만큼 크게, 먼 배경으로서의 존재감 유지
      scene.add(grp);
      const kind = kinds[i];
      const shaftH = kind === 'tall' ? 4.5 : kind === 'broken' ? 1.7 + rand() * 1.6 : 0.5 + rand() * 0.5;
      mkMesh(grp, slabGeo, stoneDark, 0, 0.25, 0);
      mkMesh(grp, baseGeo, stone, 0, 0.69, 0);
      const y0 = 0.88;
      const shaft = mkMesh(grp, shaftGeo, stone, 0, y0 + shaftH / 2, 0, 1, shaftH, 1);
      shaft.rotation.y = rand();
      if (kind !== 'stump') {
        mkMesh(grp, bandGeo, stoneDark, 0, y0 + shaftH * 0.2, 0);
        if (kind === 'tall') mkMesh(grp, bandGeo, stoneDark, 0, y0 + shaftH * 0.82, 0);
      }
      if (kind === 'tall') {
        mkMesh(grp, capGeo, stone, 0, y0 + shaftH + 0.25, 0);
        mkMesh(grp, abacusGeo, stoneDark, 0, y0 + shaftH + 0.7, 0);
        // 안쪽 면에 새겨진 문양 (희미하게 달아오름)
        const gm = new THREE.MeshBasicMaterial({ color: PAL.flame, toneMapped: false });
        this.glyphMats.push(gm);
        for (let k = 0; k < 3; k++) {
          const gl = new THREE.Mesh(glyphGeo, gm);
          gl.position.set(-0.78, y0 + shaftH * (0.45 + k * 0.17), (k - 1) * 0.28);
          gl.scale.y = 0.6 + k * 0.35;
          grp.add(gl);
        }
      } else {
        if (kind === 'broken') {
          // 부러진 단면: 삐죽한 파편
          const shard = mkMesh(grp, new THREE.CylinderGeometry(0.45, 0.78, 0.9, 5), stoneDark, 0.08, y0 + shaftH + 0.3, 0.05);
          shard.rotation.set((rand() - 0.5) * 0.4, rand() * 3, (rand() - 0.5) * 0.4);
        }
        // 쓰러진 기둥 토막과 돌무더기
        const drums = kind === 'broken' ? 2 : 1;
        for (let k = 0; k < drums; k++) {
          const drum = mkMesh(grp, new THREE.CylinderGeometry(0.82, 0.88, 1.3, 10), stone, 2.2 + k * 1.7 + rand() * 0.6, 0.85, (rand() - 0.5) * 2.6);
          drum.rotation.set(Math.PI / 2 + (rand() - 0.5) * 0.2, 0, (rand() - 0.5) * 1.2);
        }
      }
    }
    /* 흩어진 돌무더기 */
    const rock = new THREE.IcosahedronGeometry(1, 0);
    instanced(rock, stone, 90, (i, d, c) => {
      const a = rand() * TAU;
      const r = i < 14 ? R + 0.15 + rand() * 0.6 : R + 0.8 + Math.pow(rand(), 1.4) * 9;
      const s = (i < 14 ? 0.18 : 0.3) + rand() * (i < 14 ? 0.3 : 0.9);
      d.position.set(Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
      d.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      d.scale.set(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s * (0.8 + rand() * 0.6));
      stoneTint(c, 0.7, 1.1);
    });

    /* 화로: 가장자리를 따라 8개. 일부만 실제 조명을 가진다. */
    const poolTex = makePoolTex();
    const bowlGeo = new THREE.CylinderGeometry(0.82, 0.5, 0.5, 10);
    const standGeo = new THREE.CylinderGeometry(0.42, 0.58, 1.35, 8);
    const coalMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, toneMapped: false });
    coalMat.color.multiplyScalar(1.2);
    const flameDefs: [number, number, number, number, number][] = [
      // 반경, 높이, 색, 밝기, 불투명도
      [0.5, 1.5, 0xff6a14, 1.15, 0.75],
      [0.36, 1.15, 0xffa62a, 1.2, 0.75],
      [0.19, 0.75, 0xffe08a, 1.3, 0.8],
    ];
    const LIT = new Set([0, 4, 5, 7]); // 위쪽/좌우 화로에만 실제 조명 (비용 절약)
    const BRAZ_N = 8;
    for (let k = 0; k < BRAZ_N; k++) {
      const a = (k / BRAZ_N) * TAU + TAU / (pillarN * 2);
      const bx = Math.cos(a) * (R + 0.75);
      const bz = Math.sin(a) * (R + 0.75);
      const grp = new THREE.Group();
      grp.position.set(bx, 0.4, bz);
      scene.add(grp);
      mkMesh(grp, standGeo, stoneDark, 0, 0.67, 0);
      mkMesh(grp, bowlGeo, stone, 0, 1.55, 0);
      const coal = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), coalMat);
      coal.position.y = 1.8;
      grp.add(coal);
      const flames: Brazier['flames'] = [];
      for (const [fr, fh, fc, hdr, op] of flameDefs) {
        const fm = new THREE.MeshBasicMaterial({ color: fc, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
        fm.color.multiplyScalar(hdr);
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(fr, fh, 7).translate(0, fh / 2, 0), fm);
        mesh.position.y = 1.8;
        grp.add(mesh);
        flames.push({ mesh, sy: 1, ph: rand() * 10 });
      }
      let light: THREE.PointLight | null = null;
      if (LIT.has(k)) {
        light = new THREE.PointLight(0xff9a48, 28, 26, 1.4);
        light.position.set(bx - Math.cos(a) * 1.0, 3.2, bz - Math.sin(a) * 1.0);
        scene.add(light);
      }
      // 바닥에 번지는 불빛 (조명이 없는 화로도 주변이 밝아 보이도록)
      const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, color: 0xff8a3a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2), poolMat);
      pool.position.set(bx - Math.cos(a) * 3.2, 0.02, bz - Math.sin(a) * 3.2);
      scene.add(pool);
      this.braziers.push({ flames, light, pool, ph: rand() * 20, base: light ? light.intensity : 0 });
    }

    /* 떠다니는 먼지와 불씨 */
    const drift = (n: number, color: number, size: number, opacity: number, top: number, spd: [number, number], sway: number, spread: number) => {
      const arr = new Float32Array(n * 3);
      const speed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(rand()) * spread;
        const t = rand() * TAU;
        arr[i * 3] = Math.cos(t) * r;
        arr[i * 3 + 1] = rand() * top;
        arr[i * 3 + 2] = Math.sin(t) * r;
        speed[i] = spd[0] + rand() * (spd[1] - spd[0]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      pts.frustumCulled = false;
      scene.add(pts);
      this.drifts.push({ pts, speed, top, sway });
    };
    drift(220, 0xe9c898, 0.075, 0.38, 9, [0.1, 0.25], 0.08, R + 3);
    drift(130, 0xff8a30, 0.13, 0.85, 11, [0.5, 1.4], 0.35, R + 2);
  }

  update(dt: number, t: number) {
    for (const d of this.drifts) {
      const a = d.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        let y = a.getY(i) + dt * d.speed[i];
        if (y > d.top) y = 0;
        a.setY(i, y);
        a.setX(i, a.getX(i) + Math.sin(t * 0.7 + i) * dt * d.sway);
        a.setZ(i, a.getZ(i) + Math.cos(t * 0.6 + i * 1.7) * dt * d.sway * 0.6);
      }
      a.needsUpdate = true;
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
    this.floorGlow.opacity = 0.1 + 0.14 * pulse;

    let fl = 0;
    for (const b of this.braziers) {
      const f = 0.86 + 0.14 * Math.sin(t * 11 + b.ph) + 0.07 * Math.sin(t * 27 + b.ph * 2.3) + 0.05 * Math.sin(t * 5.3 + b.ph * 0.7);
      fl += f;
      for (const fm of b.flames) {
        const s = 1 + 0.2 * Math.sin(t * 13 + fm.ph) + 0.12 * Math.sin(t * 23 + fm.ph * 2);
        fm.mesh.scale.set(1 + 0.09 * Math.sin(t * 17 + fm.ph), s, 1 + 0.09 * Math.cos(t * 15 + fm.ph));
        fm.mesh.rotation.z = 0.09 * Math.sin(t * 7 + fm.ph);
        fm.mesh.rotation.x = 0.09 * Math.cos(t * 6 + fm.ph);
      }
      if (b.light) b.light.intensity = b.base * f;
      (b.pool.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.08 * f;
    }
    fl /= this.braziers.length || 1;
    for (const m of this.glyphMats) m.color.set(PAL.flame).multiplyScalar(0.7 + 0.8 * fl * (0.8 + 0.4 * pulse));
  }
}
