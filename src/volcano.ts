import * as THREE from 'three';
import { CFG } from './config';

/**
 * 3층 · 용의 화산 — 용암 호수 한가운데 떠 있는 현무암 제단.
 *
 *   · 색: 검붉은 재구름 하늘, 시커먼 현무암 바닥, 갈라진 틈마다 새어 나오는 주황 용암빛.
 *         (1층 모래빛 유적 / 2층 푸른 못과 확실히 구분된다. 위험 표시의 붉은색이 읽히도록 바닥은 어둡게 둔다)
 *   · 지형: 둥근 제단 → 가장자리에서 용암이 비친다 → 바깥은 끝없는 용암 호수, 솟은 흑요석 첨탑, 둥둥 뜬 바윗덩이, 멀리 불을 뿜는 화산.
 *   · 용이 하늘을 날아다니므로 하늘(돔)에 공을 들였다: 불타는 구름, 화산이 뿜을 때 번쩍이는 하늘.
 */
const TAU = Math.PI * 2;
const R = CFG.peak.radius;
const LAVA_Y = -3.2;

export const VOLC = {
  fog: 0x2a0d08,
  fogDensity: 0.0072,
  hemiSky: 0xc87a50,
  hemiGround: 0x2a0d06,
  hemiIntensity: 1.0,
  sun: 0xff9a60,
  sunIntensity: 1.3,
  sunPos: [-14, 26, 10] as [number, number, number],
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

/** 하늘 돔 텍스처 (등장방형): 위는 검붉은 어둠, 지평선은 이글거리는 주황, 구름 덩어리가 붉게 타오른다 */
function makeSky(rand: () => number) {
  const W = 1024;
  const H = 512;
  const { cv, g } = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#07020a');
  gr.addColorStop(0.28, '#26070c');
  gr.addColorStop(0.46, '#6a1a0c');
  gr.addColorStop(0.5, '#e0661c');
  gr.addColorStop(0.53, '#7a2008');
  gr.addColorStop(0.6, '#1a0805');
  gr.addColorStop(1, '#0c0403');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // 구름: 어두운 덩어리 + 아래쪽이 불빛에 물든 가장자리
  for (let i = 0; i < 170; i++) {
    const x = rand() * W;
    const y = H * (0.12 + rand() * 0.38);
    const w = 60 + rand() * 190;
    const h = 14 + rand() * 40;
    const near = 1 - Math.abs(y / H - 0.46) * 2.4;
    const gg = g.createRadialGradient(x, y, 0, x, y, w);
    gg.addColorStop(0, `rgba(14,5,6,${0.45 + rand() * 0.3})`);
    gg.addColorStop(1, 'rgba(14,5,6,0)');
    for (const ox of [-W, 0, W]) {
      g.save();
      g.translate(x + ox, y);
      g.scale(1, h / w);
      g.translate(-x, -y);
      g.fillStyle = gg;
      g.fillRect(x - w, y - w, w * 2, w * 2);
      g.restore();
    }
    if (near > 0) {
      const lit = g.createRadialGradient(x, y + h * 0.5, 0, x, y + h * 0.5, w * 0.8);
      lit.addColorStop(0, `rgba(255,${100 + Math.floor(rand() * 60)},30,${0.2 * near})`);
      lit.addColorStop(1, 'rgba(255,90,20,0)');
      g.save();
      g.translate(x, y + h * 0.5);
      g.scale(1, 0.22);
      g.translate(-x, -(y + h * 0.5));
      g.fillStyle = lit;
      g.fillRect(x - w, y - w, w * 2, w * 2);
      g.restore();
    }
  }
  // 흩날리는 불씨 별
  for (let i = 0; i < 260; i++) {
    const x = rand() * W;
    const y = rand() * H * 0.42;
    g.fillStyle = `rgba(255,${150 + Math.floor(rand() * 80)},80,${0.15 + rand() * 0.4})`;
    g.fillRect(x, y, 1.5, 1.5);
  }
  return tex(cv);
}

/** 용암 호수: 시커먼 굳은 껍질 사이로 주황빛 용암이 흐른다 */
function makeLava(rand: () => number) {
  const S = 512;
  const { cv, g } = canvas(S);
  g.fillStyle = '#c23c08';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 420; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 6 + rand() * 30;
    const gg = g.createRadialGradient(x, y, 0, x, y, r);
    const b = rand();
    gg.addColorStop(0, b < 0.5 ? 'rgba(255,200,70,0.8)' : 'rgba(255,120,24,0.7)');
    gg.addColorStop(1, 'rgba(194,60,8,0)');
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.fillStyle = gg;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  // 껍질 판
  for (let i = 0; i < 90; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const w = 18 + rand() * 60;
    const h = 12 + rand() * 40;
    const a = rand() * Math.PI;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      g.fillStyle = `rgba(28,10,6,${0.78 + rand() * 0.2})`;
      g.beginPath();
      g.ellipse(0, 0, w, h, 0, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,150,40,0.7)';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }
  const t = tex(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 제단 바닥: 방사형 현무암 판 + 틈새 용암빛(발광 층) + 한가운데 불꽃 문양 */
function makeAltar(rand: () => number) {
  const S = 2048;
  const c = S / 2;
  const base = canvas(S);
  const glow = canvas(S);
  const g = base.g;
  const e = glow.g;
  g.fillStyle = '#231815';
  g.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  const px = S / (R * 2);
  // 동심원 띠 안을 방사형으로 쪼갠 판석
  const bands = [0, 4.5, 9, 14, 19, R];
  for (let b = 0; b < bands.length - 1; b++) {
    const r0 = bands[b] * px;
    const r1 = bands[b + 1] * px;
    const n = 6 + b * 6;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + b * 0.2;
      const a1 = ((i + 1) / n) * TAU + b * 0.2;
      const sh = 18 + Math.floor(rand() * 16);
      g.fillStyle = `rgb(${sh + 8},${sh},${sh - 3})`;
      g.beginPath();
      g.arc(c, c, r1, a0 + 0.012, a1 - 0.012);
      g.arc(c, c, r0 + 3, a1 - 0.012, a0 + 0.012, true);
      g.closePath();
      g.fill();
      // 판석 위 잔금
      for (let k = 0; k < 3; k++) {
        const am = a0 + (a1 - a0) * rand();
        const rm = r0 + (r1 - r0) * rand();
        g.strokeStyle = 'rgba(8,4,3,0.7)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(c + Math.cos(am) * rm, c + Math.sin(am) * rm);
        g.lineTo(c + Math.cos(am + (rand() - 0.5) * 0.12) * (rm + 20 + rand() * 40), c + Math.sin(am + (rand() - 0.5) * 0.12) * (rm + 20 + rand() * 40));
        g.stroke();
      }
      // 틈새: 용암빛(발광 층)
      for (const [ctx, col, w] of [[e, 'rgba(255,110,24,0.85)', 4], [e, 'rgba(255,200,90,0.9)', 1.6]] as [CanvasRenderingContext2D, string, number][]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(c, c, r1 - 1, a0 + 0.012, a1 - 0.012);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
        ctx.lineTo(c + Math.cos(a0) * r1, c + Math.sin(a0) * r1);
        ctx.stroke();
      }
    }
  }
  // 불규칙한 큰 균열 (발광)
  for (let i = 0; i < 26; i++) {
    let x = c + (rand() - 0.5) * S * 0.9;
    let y = c + (rand() - 0.5) * S * 0.9;
    if (Math.hypot(x - c, y - c) > R * px - 20) continue;
    let a = rand() * TAU;
    e.strokeStyle = 'rgba(255,100,20,0.8)';
    e.lineWidth = 3;
    e.beginPath();
    e.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * 20;
      y += Math.sin(a) * 20;
      if (Math.hypot(x - c, y - c) > R * px - 12) break;
      e.lineTo(x, y);
    }
    e.stroke();
    g.strokeStyle = 'rgba(5,2,1,0.9)';
    g.lineWidth = 5;
    g.stroke();
  }
  // 중앙 문양: 겹친 고리와 여덟 개의 불꽃
  const ring = (r: number, w: number, col: string) => {
    e.strokeStyle = col;
    e.lineWidth = w;
    e.beginPath();
    e.arc(c, c, r * px, 0, TAU);
    e.stroke();
  };
  ring(3.2, 7, 'rgba(255,130,30,0.95)');
  ring(3.9, 2.5, 'rgba(255,210,110,0.95)');
  ring(8.2, 5, 'rgba(255,120,26,0.8)');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    e.fillStyle = 'rgba(255,150,40,0.9)';
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
    e.strokeStyle = 'rgba(255,140,40,0.8)';
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
  private embers: THREE.Points;
  private emberSpeed: Float32Array;
  private lights: { l: THREE.PointLight; base: number; ph: number }[] = [];
  private rocks: { m: THREE.Mesh; y0: number; ph: number; spin: number }[] = [];
  private plume: THREE.MeshBasicMaterial;
  private flare = 0;
  private flareT = 5;

  constructor(scene: THREE.Scene) {
    const rand = mulberry32(31337);
    const root = this.group;
    scene.add(root);

    /* 하늘 */
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(470, 32, 20),
      new THREE.MeshBasicMaterial({ map: makeSky(rand), side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    root.add(this.sky);

    /* 용암 호수 */
    this.lavaTex = makeLava(rand);
    this.lavaTex.repeat.set(30, 30);
    this.lavaMat = new THREE.MeshBasicMaterial({ map: this.lavaTex, color: new THREE.Color(1.1, 0.8, 0.65), toneMapped: false, fog: true });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(520, 48).rotateX(-Math.PI / 2), this.lavaMat);
    lava.position.y = LAVA_Y;
    root.add(lava);

    /* 제단 */
    const alt = makeAltar(rand);
    this.altarMat = new THREE.MeshStandardMaterial({ map: alt.map, emissiveMap: alt.glow, emissive: 0xff7a22, emissiveIntensity: 0.9, roughness: 0.82, metalness: 0.12 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), this.altarMat);
    floor.receiveShadow = true;
    root.add(floor);
    // 제단 옆면: 아래로 갈수록 좁아지는 현무암 기둥. 바닥은 용암빛을 받는다
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x1c1210, emissive: 0x6a1c06, emissiveIntensity: 0.6, roughness: 1, flatShading: true });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.55, 9, 48, 3, true), sideMat);
    side.position.y = -4.5;
    root.add(side);
    // 가장자리 용암 테두리
    this.rimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.42, 0.1), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.45, R + 0.05, 96).rotateX(-Math.PI / 2), this.rimMat);
    rim.position.y = 0.03;
    root.add(rim);

    /* 흑요석 첨탑: 호수에서 솟아오른 뾰족한 바위들 */
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x241714, emissive: 0x3a1004, emissiveIntensity: 0.8, roughness: 0.9, flatShading: true });
    const spires = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0), spireMat, 70);
    const o = new THREE.Object3D();
    for (let i = 0; i < 70; i++) {
      const a = rand() * TAU;
      const d = R + 8 + Math.pow(rand(), 0.8) * 90;
      const h = 8 + rand() * 38 * (0.4 + d / 110);
      o.position.set(Math.cos(a) * d, LAVA_Y - 1, Math.sin(a) * d);
      o.scale.set(2.4 + rand() * 5.5, h, 2.4 + rand() * 5.5);
      o.rotation.set((rand() - 0.5) * 0.25, rand() * TAU, (rand() - 0.5) * 0.25);
      o.updateMatrix();
      spires.setMatrixAt(i, o.matrix);
    }
    spires.castShadow = false;
    root.add(spires);

    /* 둥둥 뜬 바위 */
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(rockGeo, spireMat);
      const a = rand() * TAU;
      const d = R + 14 + rand() * 50;
      const s = 1.5 + rand() * 4.5;
      m.scale.set(s, s * (0.6 + rand() * 0.5), s);
      m.position.set(Math.cos(a) * d, 4 + rand() * 24, Math.sin(a) * d);
      root.add(m);
      this.rocks.push({ m, y0: m.position.y, ph: rand() * TAU, spin: (rand() - 0.5) * 0.3 });
    }

    /* 멀리 불을 뿜는 화산 */
    const vol = new THREE.Mesh(new THREE.ConeGeometry(120, 150, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0x1a0a06, fog: false, toneMapped: false }));
    vol.position.set(-220, 70, -320);
    root.add(vol);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(24, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.7, 0.2), fog: false, toneMapped: false }));
    crater.position.set(-220, 146, -320);
    root.add(crater);
    this.plume = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.45, 0.12), transparent: true, opacity: 0.3, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const plume = new THREE.Mesh(new THREE.CylinderGeometry(20, 55, 190, 16, 1, true).translate(0, 95, 0), this.plume);
    plume.position.set(-220, 146, -320);
    root.add(plume);

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
      new THREE.PointsMaterial({ color: new THREE.Color(1.8, 0.8, 0.28), size: 0.28, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.embers.frustumCulled = false;
    root.add(this.embers);

    /* 가장자리 용암빛 점광원 (플레이어·용을 붉게 물들인다) */
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3;
      const l = new THREE.PointLight(0xff6a22, 70, 34, 1.5);
      l.position.set(Math.cos(a) * (R - 1.5), 1.2, Math.sin(a) * (R - 1.5));
      root.add(l);
      this.lights.push({ l, base: 70, ph: rand() * TAU });
    }
  }

  /** 용이 포효하거나 큰 기술을 쓸 때 하늘이 번쩍 (0~1) */
  pulse(k: number) {
    this.flare = Math.max(this.flare, k);
  }

  update(dt: number, t: number, fx = 0, fz = 0) {
    this.lavaTex.offset.x += dt * 0.004;
    this.lavaTex.offset.y -= dt * 0.0025;
    this.flareT -= dt;
    if (this.flareT < 0) {
      this.flare = Math.max(this.flare, 0.8);
      this.flareT = 6 + Math.random() * 8;
    }
    this.flare = Math.max(0, this.flare - dt * 0.9);
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);
    this.altarMat.emissiveIntensity = 0.8 + 0.35 * pulse + this.flare * 0.5;
    this.rimMat.color.setRGB(1, 0.42, 0.1).multiplyScalar(1.4 + 0.5 * pulse);
    this.lavaMat.color.setRGB(1.1 + this.flare * 0.4, 0.8 + this.flare * 0.2, 0.65);
    this.plume.opacity = 0.24 + 0.08 * Math.sin(t * 0.8) + this.flare * 0.3;
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
