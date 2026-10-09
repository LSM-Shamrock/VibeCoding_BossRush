import * as THREE from 'three';
import { CFG } from './config';

/**
 * 3층 · 하늘 신전 — 구름 바다 위에 떠 있는 대리석 제단과 에워싼 열주, 멀리 보이는 거대한 신전. 머리 위는 맑은 낮 하늘.
 *
 *   · 색: 맑게 갠 파란 하늘과 환한 햇빛, 흰 대리석 바닥에 금빛 상감. 붉은 위험 표시가 밝은 바닥 위에서 또렷하다.
 *   · 지형: 둥근 대리석 제단(계단 3단) → 에워싼 열주와 들보 → 끝없는 구름 바다, 구름 속 부서진 기둥, 떠다니는 대리석 조각, 멀리 큰 신전.
 *   · 용이 하늘을 날아다니므로 하늘(돔)에 공을 들였다: 맑은 하늘과 뭉게구름, 해. 용이 포효하면 하늘이 번쩍 밝아진다.
 */
const TAU = Math.PI * 2;
const R = CFG.peak.radius;
const LAVA_Y = -3.2; // 구름 바다의 높이

export const VOLC = {
  fog: 0xb4d4ee,
  fogDensity: 0.002,
  hemiSky: 0xcfe6ff,
  hemiGround: 0xb8c4d6,
  hemiIntensity: 0.95,
  sun: 0xfff0d2,
  sunIntensity: 2.0,
  sunPos: [-26, 48, 18] as [number, number, number],
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

function canvas(w: number, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, g: cv.getContext('2d', { willReadFrequently: true })! };
}

function tex(cv: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 하늘 돔 텍스처 (등장방형): 맑게 갠 낮 하늘 — 위는 짙은 파랑, 지평선은 하얗게 흐려지고, 뭉게구름이 떠 있다 */
function makeSky(rand: () => number) {
  const W = 1024;
  const H = 512;
  const { cv, g } = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#1d5fc4');
  gr.addColorStop(0.2, '#2f7fd8');
  gr.addColorStop(0.38, '#6fb0ea');
  gr.addColorStop(0.49, '#aed3f0');
  gr.addColorStop(0.53, '#bcdaf1');
  gr.addColorStop(1, '#bcdaf1');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  const puff = (x: number, y: number, r: number, squash: number, rgb: string, a: number) => {
    const gg = g.createRadialGradient(x, y, 0, x, y, r);
    gg.addColorStop(0, `rgba(${rgb},${a})`);
    gg.addColorStop(0.6, `rgba(${rgb},${a * 0.55})`);
    gg.addColorStop(1, `rgba(${rgb},0)`);
    for (const ox of [-W, 0, W]) {
      g.save();
      g.translate(x + ox, y);
      g.scale(1, squash);
      g.translate(-x, -y);
      g.fillStyle = gg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.restore();
    }
  };
  // 뭉게구름: 아래가 살짝 회청색으로 그늘진 하얀 덩어리 무리. 지평선 쪽일수록 납작하고 촘촘하다
  for (let c = 0; c < 17; c++) {
    const cx = rand() * W;
    const cy = H * (0.2 + rand() * 0.27);
    const size = 0.7 + rand() * 0.9;
    const n = 7 + Math.floor(rand() * 7);
    const pts: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const k = (i / (n - 1)) * 2 - 1;
      pts.push([cx + k * 70 * size + (rand() - 0.5) * 24, cy + (rand() - 0.5) * 9 * size - (1 - Math.abs(k)) * 9 * size, (20 + rand() * 24) * size * (1 - Math.abs(k) * 0.35)]);
    }
    for (const [x, y, r] of pts) puff(x, y + r * 0.35, r * 1.05, 0.62, '150,176,208', 0.34);
    for (const [x, y, r] of pts) puff(x, y, r, 0.72, '255,255,255', 0.92);
    for (const [x, y, r] of pts) puff(x - r * 0.12, y - r * 0.22, r * 0.55, 0.7, '255,255,255', 0.5);
  }
  // 높은 곳의 가는 구름결
  for (let i = 0; i < 22; i++) {
    const x = rand() * W;
    const y = H * (0.06 + rand() * 0.16);
    puff(x, y, 70 + rand() * 90, 0.09, '255,255,255', 0.2 + rand() * 0.15);
  }
  return tex(cv);
}

/** 해: 둥근 원반과 부드러운 빛번짐 */
function makeSunTex(core: boolean) {
  const S = 256;
  const { cv, g } = canvas(S);
  const gg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (core) {
    gg.addColorStop(0, 'rgba(255,255,250,1)');
    gg.addColorStop(0.5, 'rgba(255,252,235,0.98)');
    gg.addColorStop(0.62, 'rgba(255,244,205,0.5)');
    gg.addColorStop(1, 'rgba(255,240,200,0)');
  } else {
    gg.addColorStop(0, 'rgba(255,248,220,0.55)');
    gg.addColorStop(0.25, 'rgba(255,240,200,0.28)');
    gg.addColorStop(0.6, 'rgba(255,232,190,0.08)');
    gg.addColorStop(1, 'rgba(255,230,180,0)');
  }
  g.fillStyle = gg;
  g.fillRect(0, 0, S, S);
  return tex(cv);
}

/** 구름 바다: 신전 아래로 끝없이 펼쳐진 하얀 구름층 */
function makeLava(rand: () => number) {
  const S = 512;
  const { cv, g } = canvas(S);
  g.fillStyle = '#dbe9f6';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 380; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 14 + rand() * 46;
    const gg = g.createRadialGradient(x, y, 0, x, y, r);
    const b = rand();
    gg.addColorStop(0, b < 0.55 ? 'rgba(255,255,255,0.85)' : 'rgba(168,196,226,0.55)');
    gg.addColorStop(1, 'rgba(219,233,246,0)');
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.fillStyle = gg;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  const t = tex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 제단 바닥: 흰 대리석 판석(방사형) + 금빛 상감선(발광 층) + 한가운데 태양 문양 */
function makeAltar(rand: () => number) {
  const S = 3072;
  const c = S / 2;
  const base = canvas(S);
  const glow = canvas(S);
  const g = base.g;
  const e = glow.g;
  g.fillStyle = '#a49c8a';
  g.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const px = S / (R * 2);
  const bands = [0, 4.5, 9, 14, 19, 30, 44, 60, 78, R];
  for (let b = 0; b < bands.length - 1; b++) {
    const r0 = bands[b] * px;
    const r1 = bands[b + 1] * px;
    const n = 6 + b * 6;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + b * 0.2;
      const a1 = ((i + 1) / n) * TAU + b * 0.2;
      const sh = 168 + Math.floor(rand() * 34);
      g.fillStyle = `rgb(${sh},${sh - 4},${sh - 14})`;
      g.beginPath();
      g.arc(c, c, r1, a0 + 0.012, a1 - 0.012);
      g.arc(c, c, r0 + 3, a1 - 0.012, a0 + 0.012, true);
      g.closePath();
      g.fill();
      // 대리석 결 (옅은 회색 잔금)
      for (let k = 0; k < 4; k++) {
        const am = a0 + (a1 - a0) * rand();
        const rm = r0 + (r1 - r0) * rand();
        g.strokeStyle = 'rgba(110,104,96,0.35)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(c + Math.cos(am) * rm, c + Math.sin(am) * rm);
        g.lineTo(c + Math.cos(am + (rand() - 0.5) * 0.14) * (rm + 20 + rand() * 60), c + Math.sin(am + (rand() - 0.5) * 0.14) * (rm + 20 + rand() * 60));
        g.stroke();
      }
      // 판석 이음매: 어두운 선 + 금빛 상감(발광 층)
      g.strokeStyle = 'rgba(70,64,56,0.75)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(c, c, r1 - 1, a0 + 0.012, a1 - 0.012);
      g.stroke();
      g.beginPath();
      g.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
      g.lineTo(c + Math.cos(a0) * r1, c + Math.sin(a0) * r1);
      g.stroke();
      if (b % 2 === 1 || b === 4) {
        e.strokeStyle = 'rgba(255,200,90,0.55)';
        e.lineWidth = 2;
        e.beginPath();
        e.arc(c, c, r1 - 1, a0 + 0.012, a1 - 0.012);
        e.stroke();
      }
    }
  }
  // 갈라진 자국
  for (let i = 0; i < 16; i++) {
    let x = c + (rand() - 0.5) * S * 0.9;
    let y = c + (rand() - 0.5) * S * 0.9;
    if (Math.hypot(x - c, y - c) > R * px - 20) continue;
    let a = rand() * TAU;
    g.strokeStyle = 'rgba(60,54,48,0.7)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * 20;
      y += Math.sin(a) * 20;
      if (Math.hypot(x - c, y - c) > R * px - 12) break;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // 중앙 문양: 겹친 금빛 고리와 여덟 갈래 햇살
  const ring = (r: number, w: number, col: string) => {
    e.strokeStyle = col;
    e.lineWidth = w;
    e.beginPath();
    e.arc(c, c, r * px, 0, TAU);
    e.stroke();
  };
  ring(3.2, 7, 'rgba(255,190,70,0.95)');
  ring(3.9, 2.5, 'rgba(255,236,170,0.95)');
  ring(8.2, 5, 'rgba(255,190,70,0.8)');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    e.fillStyle = 'rgba(255,200,90,0.9)';
    e.beginPath();
    e.moveTo(c + Math.cos(a - 0.12) * 4.3 * px, c + Math.sin(a - 0.12) * 4.3 * px);
    e.lineTo(c + Math.cos(a) * 8.0 * px, c + Math.sin(a) * 8.0 * px);
    e.lineTo(c + Math.cos(a + 0.12) * 4.3 * px, c + Math.sin(a + 0.12) * 4.3 * px);
    e.closePath();
    e.fill();
  }
  // 가장자리 룬 띠
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    e.strokeStyle = 'rgba(255,200,90,0.8)';
    e.lineWidth = 4;
    e.beginPath();
    e.moveTo(c + Math.cos(a) * (R - 2.4) * px, c + Math.sin(a) * (R - 2.4) * px);
    e.lineTo(c + Math.cos(a) * (R - 1.4) * px, c + Math.sin(a) * (R - 1.4) * px);
    e.stroke();
  }
  return { map: tex(base.cv), glow: tex(glow.cv) };
}

export class Volcano {
  readonly group = new THREE.Group();
  private lavaTex: THREE.Texture;
  private lavaMat: THREE.MeshBasicMaterial;
  private altarMat: THREE.MeshStandardMaterial;
  private rimMat: THREE.MeshBasicMaterial;
  private sky: THREE.Mesh;
  private sunDisc: THREE.Sprite;
  private sunGlow: THREE.Sprite;
  private sunDir = new THREE.Vector3(...VOLC.sunPos).normalize();
  private embers: THREE.Points;
  private emberSpeed: Float32Array;
  private lights: { l: THREE.PointLight; base: number; ph: number }[] = [];
  private rocks: { m: THREE.Mesh; y0: number; ph: number; spin: number }[] = [];
  private farTemple: THREE.Group;
  private flare = 0;
  private flareT = 5;

  constructor(scene: THREE.Scene) {
    const rand = mulberry32(31337);
    const root = this.group;
    scene.add(root);

    /* 하늘 */
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1150, 32, 20),
      new THREE.MeshBasicMaterial({ map: makeSky(rand), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    root.add(this.sky);
    const mkSun = (core: boolean, size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSunTex(core), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
      sp.scale.set(size, size, 1);
      sp.renderOrder = -9;
      sp.frustumCulled = false;
      root.add(sp);
      return sp;
    };
    this.sunGlow = mkSun(false, 720);
    this.sunDisc = mkSun(true, 110);

    /* 구름 바다 */
    this.lavaTex = makeLava(rand);
    this.lavaTex.repeat.set(80, 80);
    this.lavaMat = new THREE.MeshBasicMaterial({ map: this.lavaTex, color: new THREE.Color(1, 1, 1), toneMapped: false, fog: true });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(1400, 64).rotateX(-Math.PI / 2), this.lavaMat);
    lava.position.y = LAVA_Y;
    root.add(lava);

    /* 제단: 계단 세 단 위의 대리석 바닥 */
    const marble = new THREE.MeshStandardMaterial({ color: 0xe8e1d2, roughness: 0.75, metalness: 0.02, flatShading: true });
    const alt = makeAltar(rand);
    this.altarMat = new THREE.MeshStandardMaterial({ map: alt.map, emissiveMap: alt.glow, emissive: 0xffc860, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.08 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), this.altarMat);
    floor.receiveShadow = true;
    root.add(floor);
    for (let k = 0; k < 3; k++) {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2 + (k + 1) * 1.6, R + 0.2 + (k + 1) * 1.6 + 0.6, 0.9, 72), marble);
      step.position.y = -0.46 - k * 0.9;
      step.receiveShadow = true;
      root.add(step);
    }
    // 아래로 좁아지는 기단
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R + 5, R * 0.45, 22, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }));
    side.position.y = -14;
    root.add(side);
    // 가장자리 금빛 테두리
    this.rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.35), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.45, R + 0.05, 96).rotateX(-Math.PI / 2), this.rimMat);
    rim.position.y = 0.03;
    root.add(rim);

    /* 신전 열주: 제단을 둥글게 에워싼 큰 기둥들 + 이어진 들보 (일부는 무너져 있다) */
    const colGeo = new THREE.CylinderGeometry(1, 1.12, 1, 14, 1).translate(0, 0.5, 0);
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    const NC = 14;
    const RC = 215; // 넓어진 아레나(96)와 용이 선회하는 범위 밖 — 몸통이 기둥을 뚫지 않게 멀리
    const cols = new THREE.InstancedMesh(colGeo, marble, NC * 3);
    const caps = new THREE.InstancedMesh(capGeo, marble, NC * 3);
    const o = new THREE.Object3D();
    let ci = 0;
    const heights: number[] = [];
    for (let i = 0; i < NC; i++) heights.push(i % 5 === 3 ? 20 + rand() * 20 : 60);
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * TAU;
      const h = heights[i];
      o.position.set(Math.cos(a) * RC, LAVA_Y - 6, Math.sin(a) * RC);
      o.rotation.set(0, 0, 0);
      o.scale.set(5.5, h + 6, 5.5);
      o.updateMatrix();
      cols.setMatrixAt(i, o.matrix);
      // 기둥머리
      o.position.y = h + LAVA_Y;
      o.scale.set(13, 3, 13);
      o.updateMatrix();
      caps.setMatrixAt(ci, o.matrix);
      ci++;
      // 들보: 이웃 기둥도 온전하면 이어준다
      const j = (i + 1) % NC;
      if (h >= 60 && heights[j] >= 60) {
        const a2 = (j / NC) * TAU;
        const mx = (Math.cos(a) + Math.cos(a2)) * 0.5 * RC;
        const mz = (Math.sin(a) + Math.sin(a2)) * 0.5 * RC;
        const len = Math.hypot(Math.cos(a2) - Math.cos(a), Math.sin(a2) - Math.sin(a)) * RC;
        o.position.set(mx, 60 + LAVA_Y + 3, mz);
        o.rotation.set(0, -Math.atan2(Math.sin(a2) - Math.sin(a), Math.cos(a2) - Math.cos(a)), 0);
        o.scale.set(len, 5, 9);
        o.updateMatrix();
        caps.setMatrixAt(ci, o.matrix);
        ci++;
      }
    }
    cols.count = NC;
    caps.count = ci;
    root.add(cols, caps);

    /* 멀리 구름 속에서 솟은 부서진 기둥 · 첨탑 */
    const stumps = new THREE.InstancedMesh(colGeo, marble, 60);
    for (let i = 0; i < 60; i++) {
      const a = rand() * TAU;
      const d = 250 + Math.pow(rand(), 0.8) * 280;
      const h = 20 + rand() * 70;
      o.position.set(Math.cos(a) * d, LAVA_Y - 4, Math.sin(a) * d);
      o.scale.set(4 + rand() * 4, h, 4 + rand() * 4);
      o.rotation.set((rand() - 0.5) * 0.12, rand() * TAU, (rand() - 0.5) * 0.12);
      o.updateMatrix();
      stumps.setMatrixAt(i, o.matrix);
    }
    root.add(stumps);

    /* 둥둥 뜬 대리석 조각 */
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(rockGeo, marble);
      const a = rand() * TAU;
      const d = 150 + rand() * 150;
      const sc = 3 + rand() * 8;
      m.scale.set(sc, sc * (0.6 + rand() * 0.5), sc);
      m.position.set(Math.cos(a) * d, 4 + rand() * 40, Math.sin(a) * d);
      root.add(m);
      this.rocks.push({ m, y0: m.position.y, ph: rand() * TAU, spin: (rand() - 0.5) * 0.3 });
    }

    /* 먼 하늘의 큰 신전: 계단 · 열주 · 삼각 지붕 */
    const far = new THREE.Group();
    const farMat = new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.9, flatShading: true });
    const fb = new THREE.Mesh(new THREE.BoxGeometry(190, 12, 80), farMat);
    fb.position.y = 6;
    far.add(fb);
    const fb2 = new THREE.Mesh(new THREE.BoxGeometry(170, 8, 66), farMat);
    fb2.position.y = 16;
    far.add(fb2);
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(colGeo, farMat);
      c.scale.set(4.2, 62, 4.2);
      c.position.set(-72 + i * 18, 20, 26);
      far.add(c);
    }
    const ent = new THREE.Mesh(new THREE.BoxGeometry(170, 8, 66), farMat);
    ent.position.y = 86;
    far.add(ent);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(36, 36, 170, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1, 0.8), farMat);
    roof.position.y = 106;
    roof.scale.set(1, 0.5, 1);
    far.add(roof);
    far.position.set(-420, -4, -600);
    far.scale.setScalar(1.8);
    far.rotation.y = 0.5;
    this.farTemple = far;
    root.add(far);

    /* 불씨: 플레이어 주변 상자 안에서 떠오른다 */
    const N = 320;
    const pos = new Float32Array(N * 3);
    this.emberSpeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rand() - 0.5) * 100;
      pos[i * 3 + 1] = LAVA_Y + rand() * 40;
      pos[i * 3 + 2] = (rand() - 0.5) * 100;
      this.emberSpeed[i] = 1.2 + rand() * 3;
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      eg,
      new THREE.PointsMaterial({ color: new THREE.Color(1.6, 1.3, 0.7), size: 0.26, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.embers.frustumCulled = false;
    root.add(this.embers);

    /* 가장자리 용암빛 점광원 (플레이어·용을 붉게 물들인다) */
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const l = new THREE.PointLight(0xffd9a0, 6, 30, 1.5);
      l.position.set(Math.cos(a) * (R - 1.5), 1.2, Math.sin(a) * (R - 1.5));
      root.add(l);
      this.lights.push({ l, base: 6, ph: rand() * TAU });
    }
  }

  /** 용이 포효하거나 큰 기술을 쓸 때 하늘이 번쩍 (0~1) */
  pulse(k: number) {
    this.flare = Math.max(this.flare, k);
  }

  update(dt: number, t: number, fx = 0, fz = 0) {
    this.farTemple.position.y = -4 + Math.sin(t * 0.2) * 1.2;
    this.lavaTex.offset.x += dt * 0.004;
    this.lavaTex.offset.y -= dt * 0.0025;
    this.flareT -= dt;
    if (this.flareT < 0) {
      this.flare = Math.max(this.flare, 0.8);
      this.flareT = 6 + Math.random() * 8;
    }
    this.flare = Math.max(0, this.flare - dt * 0.9);
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);
    this.altarMat.emissiveIntensity = 0.28 + 0.1 * pulse + this.flare * 0.5;
    this.rimMat.color.setRGB(1, 0.8, 0.35).multiplyScalar(1.1 + 0.4 * pulse);
    this.lavaMat.color.setRGB(1 + this.flare * 0.15, 1 + this.flare * 0.12, 1);
    for (const li of this.lights) {
      const f = 0.88 + 0.12 * Math.sin(t * 9 + li.ph) + 0.06 * Math.sin(t * 23 + li.ph * 2);
      li.l.intensity = li.base * f * (1 + this.flare * 0.5);
    }
    for (const r of this.rocks) {
      r.m.position.y = r.y0 + Math.sin(t * 0.4 + r.ph) * 1.2;
      r.m.rotation.y += dt * r.spin;
      r.m.rotation.x += dt * r.spin * 0.6;
    }
    this.sky.position.set(fx, 0, fz);
    this.sky.rotation.y += dt * 0.004;
    for (const sp of [this.sunDisc, this.sunGlow]) sp.position.set(fx + this.sunDir.x * 1000, this.sunDir.y * 1000, fz + this.sunDir.z * 1000);
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = 0.55 + this.flare * 0.15;

    const a = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + dt * this.emberSpeed[i];
      let x = a.getX(i) + Math.sin(t * 0.8 + i) * dt * 0.9 + dt * 0.6;
      let z = a.getZ(i) + Math.cos(t * 0.7 + i * 1.7) * dt * 0.7;
      if (y > 36) y = LAVA_Y + 0.2;
      if (x - fx > 50) x -= 100;
      else if (x - fx < -50) x += 100;
      if (z - fz > 50) z -= 100;
      else if (z - fz < -50) z += 100;
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true;
  }
}
