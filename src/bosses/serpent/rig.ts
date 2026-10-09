import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import { envHolder } from '../../envmap';
import type { Circle, Sphere } from '../../types';
import { aimed, hull, merge, mirror, spike, taperedTube, type P3 } from '../../geo';

const V3 = THREE.Vector3;
const C = CFG.serpent;
const TAU = Math.PI * 2;

/** 머리 중심에서 꼬리 끝까지 몸 전체 길이 */
const BODY_LEN = C.bodyLen;
/** 몸을 이루는 고리(링) 사이 간격 */
const DSEG = 0.5;
const NR = Math.floor(BODY_LEN / DSEG) + 1;
/** 한 고리의 둘레 분할 수 (+1 은 이음매 정점) */
const M = 12;
const VW = M + 1;
/** 머리가 지나간 길(궤적)을 점으로 기록하는 간격 */
const TS = 0.4;
const CAP = Math.ceil((BODY_LEN + 40) / TS);
const HS = C.headScale;
/** 머리가 바닥에 얹혀 있을 때 머리 중심 높이 */
const HEAD_REST = 0.95;
/** 땅속으로 잠기는/솟는 물결이 몸(머리 → 꼬리)을 따라 퍼지는 속도, 마디 하나가 잠기는 데 걸리는 시간 */
const WAVE_SPEED = 70;
const WAVE_RISE = 0.34;
/** 몸이 서로 겹치는 곳을 쌓아 올리기 위한 공간 격자 */
const GCELL = 3.6;
const GN = 40;
const GCAP = 14;
const STACK_GAP = 16;

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const approach = (cur: number, goal: number, rate: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

/** 머리 중심에서 sigma 만큼 떨어진 마디의 반지름: 머리에 물리는 가는 목 → 굵은 몸통 → 길게 가늘어지는 꼬리 */
function radiusAt(sigma: number) {
  let r = 0.95 + (C.bodyR - 0.95) * smooth((sigma - 4) / 38);
  if (sigma < 3.5) r *= 0.5 + 0.5 * smooth(sigma / 3.5);
  const tailStart = BODY_LEN - 66;
  if (sigma > tailStart) r *= Math.pow(Math.max(0, 1 - (sigma - tailStart) / 66), 0.85);
  return Math.max(0.05, r);
}
const RAD = new Float32Array(NR);
for (let k = 0; k < NR; k++) RAD[k] = radiusAt(k * DSEG);

/* ───────────────────────── 텍스처 ───────────────────────── */
function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

function makeTex(c: HTMLCanvasElement, repeatV = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeatV) t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 몸 무늬: 가로(u) 0 = 등 한가운데 → 1 = 배 한가운데 (좌우 대칭으로 감김), 세로(v) = 몸을 따라 반복 */
function bodyTexture() {
  const W = 128;
  const H = 512;
  const { c, g } = canvas2d(W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#ecece6');
  grad.addColorStop(0.34, '#f4f4ee');
  grad.addColorStop(0.56, '#fafaf6');
  grad.addColorStop(0.68, '#fcfcf8');
  grad.addColorStop(0.78, '#fdfdfa');
  grad.addColorStop(1, '#fefefb');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 비늘 격자
  g.strokeStyle = 'rgba(40,50,48,0.2)';
  g.lineWidth = 1.2;
  for (let k = -H; k < W + H; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + H, H);
    g.stroke();
    g.beginPath();
    g.moveTo(k, H);
    g.lineTo(k + H, 0);
    g.stroke();
  }
  // 등의 큰 얼룩 (아나콘다·구렁이처럼 마디마디 짙은 타원, 가운데는 옅게 비어 있다)
  for (const cy of [128, 384]) {
    g.save();
    g.translate(0, cy);
    g.scale(1, 2.1);
    g.beginPath();
    g.arc(0, 0, 33, 0, TAU);
    g.restore();
    g.fillStyle = '#4a5a58';
    g.fill();
    g.strokeStyle = '#a8b4a4';
    g.lineWidth = 3;
    g.stroke();
    g.save();
    g.translate(0, cy);
    g.scale(1, 2.0);
    g.beginPath();
    g.arc(0, 0, 19, 0, TAU);
    g.restore();
    g.fillStyle = 'rgba(150,164,156,0.85)';
    g.fill();
    g.strokeStyle = 'rgba(235,235,210,0.6)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  // 옆구리의 눈 모양 점
  for (const cy of [0, 256, 512]) {
    g.beginPath();
    g.ellipse(70, cy, 15, 24, 0, 0, TAU);
    g.fillStyle = '#3a4644';
    g.fill();
    g.beginPath();
    g.ellipse(70, cy, 8, 13, 0, 0, TAU);
    g.fillStyle = '#d9c872';
    g.fill();
  }
  // 배 비늘판
  g.strokeStyle = 'rgba(70,60,30,0.34)';
  g.lineWidth = 1.5;
  for (let y = 0; y < H; y += 8) {
    g.beginPath();
    g.moveTo(W * 0.74, y);
    g.lineTo(W, y);
    g.stroke();
  }
  return makeTex(c, true);
}

/** 목 지느러미 막: 뿌리 → 가장자리로 갈수록 투명한 청백색, 가는 줄기 무늬 */
function finTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 64;
  const { c, g } = canvas2d(W, H);
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, '#f4f0e0');
  gr.addColorStop(0.55, '#a9d4cf');
  gr.addColorStop(1, '#4f9aa2');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(30,70,80,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.moveTo(0, 8 + i * 22);
    g.lineTo(W, 8 + i * 22);
    g.stroke();
  }
  return makeTex(c);
}

/** 목 옆에 세워 펼치는 지느러미 한 장 (지느러미 좌표: 뿌리가 원점, +x 가 바깥). 정면에서 넓게 보이도록 세로 평면(x-y)으로 부채꼴 */
function finGeometry() {
  const N = 3;
  const roots: P3[] = [];
  const tips: P3[] = [];
  for (let k = 0; k < N; k++) {
    const t = k / (N - 1);
    const a = (t - 0.5) * 1.7; // 가운데 가닥은 수평, 양옆 가닥은 위·아래로 벌어진다
    const len = 3.4 + 0.6 * Math.sin(Math.PI * t);
    const r: P3 = [0, 0.15 + 0.25 * Math.sin(a), -0.1 * t];
    const d: P3 = [Math.cos(a), Math.sin(a), -0.12 - 0.1 * t];
    roots.push(r);
    tips.push([r[0] + d[0] * len, r[1] + d[1] * len, r[2] + d[2] * len]);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = (p: P3, u: number, w: number) => {
    pos.push(p[0], p[1], p[2]);
    uv.push(u, w);
    return pos.length / 3 - 1;
  };
  for (let k = 0; k < N - 1; k++) {
    const r0 = v(roots[k], 0, 0);
    const r1 = v(roots[k + 1], 0, 1);
    const t0 = v(tips[k], 1, 0);
    const t1 = v(tips[k + 1], 1, 1);
    const m: P3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) m[i] = (roots[k][i] + roots[k + 1][i]) / 2 + ((tips[k][i] + tips[k + 1][i]) / 2 - (roots[k][i] + roots[k + 1][i]) / 2) * 0.62;
    const mm = v(m, 0.62, 0.5);
    idx.push(r0, t0, mm, r0, mm, r1, r1, mm, t1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, roots, tips };
}

/* ───────────────────────── 타입 ───────────────────────── */
/** 판정용 마디 (몸의 3 고리마다 하나) */
export interface Seg extends Sphere {
  ring: number;
  up: boolean;
  sub: number;
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  r: number;
  rest: boolean;
}

export type Wave = 'none' | 'dive' | 'emerge';

function mat(color: number, emissive = 0x000000, rough = 0.55, metal = 0.18) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, roughness: rough, metalness: metal, flatShading: true });
  m.userData.baseEmissive = new THREE.Color(emissive);
  if (envHolder.tex) {
    m.envMap = envHolder.tex;
    m.envMapIntensity = 0.8;
  }
  return m;
}

/**
 * 이무기 리그 — 머리가 지나간 길을 그대로 따라오는 긴 몸.
 *
 *  · 궤적      머리가 움직일 때마다 지나간 길(점 목록)이 쌓인다. 몸의 고리들은 이 길 위에 일정 간격으로 놓인다.
 *              그래서 머리가 S자로 꿈틀대면 몸 전체가 같은 S자를 그리며 따라오고, 원을 그리면 똬리가 되고,
 *              똬리의 한가운데서 곧장 튀어 나가면 똬리가 안쪽부터 풀린다.
 *  · 들어올림  lift 만큼 머리를 들면 목이 완만한 S 곡선으로 솟는다 (코브라 자세). 높이는 목 길이에서 제한된다.
 *  · 겹침      몸이 자기 몸 위를 지나면 아래 몸 위로 곡선을 그리며 올라탄다.
 *  · 잠행      dive() 하면 머리부터 차례로 땅속으로 가라앉고, emerge() 하면 머리부터 차례로 솟아오른다.
 */
export class SerpentRig {
  /** 머리가 있는 바닥 위치 (y 는 0) */
  readonly pos = new V3();
  /** 머리 방향 (atan2(dx,dz)) */
  headYaw = 0;
  /** + = 아래를 봄 */
  headPitch = 0;
  /** 머리 중심 높이 목표 */
  lift = HEAD_REST;
  liftRate = 5;
  /** 0 = 다문 입, 1 = 크게 벌림 */
  jaw = 0;
  /** 0 = 목에 접힌 후드, 1 = 활짝 편 후드 */
  hood = 0;
  /** 몸의 잔물결 세기 (0 = 가만히) */
  undulate = 0.25;
  /** 혀 낼름 빈도 배율 */
  tongueRate = 1;
  /** 혀가 나올 때마다 */
  onFlick: () => void = () => {};
  exploded = false;

  readonly segs: Seg[] = [];
  readonly headSphere: Sphere = { x: 0, y: 1, z: 0, r: C.headR };
  /** 머리가 땅 위에 올라와 있는가 */
  headUp = true;
  /** 머리의 실제 이동 속도 (매끄럽게 필터링) */
  speed = 0;
  /** 몸이 멈춰 있어 플레이어가 지나갈 수 없는가 */
  solid = false;

  private liftCur = HEAD_REST;
  private jawCur = 0;
  private hoodCur = 0;
  private pitchCur = 0;
  private undCur = 0.25;
  private t = 0;
  private wave: Wave = 'none';
  private waveT = 0;
  private baseSub = 0;
  private lastX = 0;
  private lastZ = 0;
  private stillT = 0;

  // 궤적: 원형 버퍼 (가장 새로운 점이 trHead)
  private trx = new Float32Array(CAP);
  private trz = new Float32Array(CAP);
  private trHead = 0;
  private trCount = 0;
  private pxA = new Float32Array(CAP + 2);
  private pzA = new Float32Array(CAP + 2);
  private cumA = new Float32Array(CAP + 2);

  // 고리 상태
  private cx = new Float32Array(NR);
  private cy = new Float32Array(NR);
  private cz = new Float32Array(NR);
  private py = new Float32Array(NR);
  private sub = new Float32Array(NR);
  private fn = new Float32Array(NR * 3);
  private fb = new Float32Array(NR * 3);
  private ft = new Float32Array(NR * 3);
  private gridCnt = new Uint8Array(GN * GN);
  private gridIdx = new Int16Array(GN * GN * GCAP);

  // 모델
  private head = new THREE.Group();
  private jawPivot = new THREE.Group();
  private fangs: THREE.Group[] = [];
  private tongue = new THREE.Group();
  private tineL = new THREE.Group();
  private tineR = new THREE.Group();
  private hoodGroup = new THREE.Group();
  private aura!: THREE.Mesh;
  private auraMat!: THREE.MeshBasicMaterial;
  private auraPuff = { value: 0.4 };
  private finGroups: THREE.Group[] = [];
  private hoodRx = 3;
  private tubeGeo: THREE.BufferGeometry;
  private tube: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private bodyTex: THREE.CanvasTexture;
  private finTex!: THREE.CanvasTexture;
  private headMats: THREE.MeshStandardMaterial[] = [];
  private eyeMat = new THREE.MeshBasicMaterial({ color: 0xffc83a, toneMapped: false });
  private gemMat = new THREE.MeshBasicMaterial({ color: 0x205a4a, toneMapped: false });
  private hoodFront: THREE.MeshStandardMaterial;
  private allMeshes: THREE.Mesh[] = [];
  private extraGeos: THREE.BufferGeometry[] = [];
  private chunkGeo: THREE.BufferGeometry;
  private debris: Debris[] = [];
  private debrisMat: THREE.MeshStandardMaterial;
  private bodyFlash = 0;
  private headFlash = 0;
  private rage = 0;
  private exposed = false;
  private circles: Circle[] = [];
  private out: Circle[] = [];

  // 혀
  private flickT = 9;
  private flicking = false;
  private nextFlick = 1.2;

  private tmpA = new V3();
  private tmpB = new V3();

  constructor(private scene: THREE.Scene) {
    // 몸통 관
    this.tubeGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(NR * VW * 3);
    const uv = new Float32Array(NR * VW * 2);
    for (let k = 0; k < NR; k++) {
      for (let j = 0; j < VW; j++) {
        const o = k * VW + j;
        const half = j <= M / 2 ? j : M - j;
        uv[o * 2] = half / (M / 2);
        uv[o * 2 + 1] = (k * DSEG) / 12;
      }
    }
    const idx: number[] = [];
    for (let k = 0; k < NR - 1; k++) {
      for (let j = 0; j < M; j++) {
        const a = k * VW + j;
        const b = a + 1;
        const c = a + VW;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.tubeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tubeGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.tubeGeo.setIndex(idx);
    this.tubeGeo.boundingSphere = new THREE.Sphere(new V3(0, 0, 0), 400);
    this.bodyTex = bodyTexture();
    this.bodyMat = new THREE.MeshStandardMaterial({ map: this.bodyTex, roughness: 0.62, metalness: 0.08, flatShading: true, side: THREE.DoubleSide });
    this.bodyMat.userData.baseEmissive = new THREE.Color(0x3e3e38);
    if (envHolder.tex) {
      this.bodyMat.envMap = envHolder.tex;
      this.bodyMat.envMapIntensity = 0.3;
    }
    this.tube = new THREE.Mesh(this.tubeGeo, this.bodyMat);
    this.tube.frustumCulled = false;
    this.tube.castShadow = true;
    this.tube.receiveShadow = true;
    scene.add(this.tube);
    // 붉은 오라: 몸을 감싸는 얇은 가산 혼합 껍질 (페이즈가 오를수록 짙고 두꺼워진다)
    this.auraMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, toneMapped: false });
    this.auraMat.onBeforeCompile = (sh) => {
      sh.uniforms.uPuff = this.auraPuff;
      sh.vertexShader = 'uniform float uPuff;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * uPuff;');
    };
    this.aura = new THREE.Mesh(this.tubeGeo, this.auraMat);
    this.aura.frustumCulled = false;
    this.aura.visible = false;
    scene.add(this.aura);

    for (let k = 0; k < NR; k += 3) this.segs.push({ x: 0, y: 0, z: 0, r: RAD[k], ring: k, up: true, sub: 0 });
    for (let k = 0; k < Math.ceil(NR / 4) + 3; k++) this.circles.push({ x: 0, z: 0, r: 1 });

    this.finTex = finTexture();
    this.hoodFront = mat(0xffffff, 0x0a2024, 0.55, 0.02);
    this.hoodFront.map = this.finTex;
    this.hoodFront.side = THREE.DoubleSide;
    this.hoodFront.transparent = true;
    this.hoodFront.opacity = 0.86;
    this.hoodFront.depthWrite = false;
    this.hoodFront.envMapIntensity = 0.3;

    this.chunkGeo = new THREE.SphereGeometry(1, 8, 6);
    this.debrisMat = mat(0x3c5a2c, 0x050a04, 0.65, 0.08);
    this.buildHead();
    this.head.rotation.order = 'YXZ';
    this.head.scale.setScalar(HS);
    scene.add(this.head);

    this.layoutLine(C.start.x, C.start.z, 0);
    this.update(0);
  }

  /* ───────────────────────── 모델: 머리 ───────────────────────── */
  private addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.allMeshes.push(mesh);
    this.extraGeos.push(geo);
    return mesh;
  }

  private buildHead() {
    const hm = (color: number, emissive = 0x000000, rough = 0.55, metal = 0.12) => {
      const m = mat(color, emissive, rough, metal);
      this.headMats.push(m);
      return m;
    };
    const skullM = hm(0xf2f2ea, 0x34342f, 0.6, 0.1);
    const plateM = hm(0xdcdcd2, 0x2e2e2a, 0.55, 0.1);
    const darkM = hm(0x0b160a, 0x020502);
    const boneM = hm(0xe8dcb0, 0x1c1608, 0.6, 0.05);
    const throatM = hm(0x4a0812, 0x7a0c18, 0.8, 0);
    const chinM = hm(0xfcfaf0, 0x1c1a12, 0.6, 0.04);
    const tongueM = hm(0x8c0f2c, 0x3a0614, 0.6, 0);
    const g = this.head;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = g, shadow = true) => this.addMesh(parent, geo, m, shadow);

    // 두개골 + 주둥이: [z, 반폭, 윗면, 아랫면] — 넓적하고 끝이 둥근 삼각형 머리
    const U: [number, number, number, number][] = [
      [-1.9, 0.6, 0.36, -0.4],
      [-1.1, 1.0, 0.56, -0.52],
      [-0.2, 0.98, 0.58, -0.52],
      [0.8, 0.8, 0.44, -0.48],
      [1.8, 0.66, 0.3, -0.44],
      [2.6, 0.54, 0.2, -0.38],
      [3.1, 0.38, 0.1, -0.3],
    ];
    const upPts: P3[] = [];
    for (const [z, hw0, top, bot] of U) { const hw = hw0 * 1.3; upPts.push([hw, top, z], [hw, bot, z], [hw * 0.6, top + 0.08, z], [0, top + (z > -1.4 && z < 1.2 ? 0.16 : 0.07), z]); }
    add(hull(mirror(upPts)), skullM);
    const lerpU = (z: number, col: 1 | 2 | 3) => {
      for (let i = 0; i < U.length - 1; i++) if (z <= U[i + 1][0]) return (U[i][col] + ((U[i + 1][col] - U[i][col]) * (z - U[i][0])) / (U[i + 1][0] - U[i][0])) * (col === 1 ? 1.3 : 1);
      return U[U.length - 1][col] * (col === 1 ? 1.3 : 1);
    };
    // 머리 위 판갑: 이마에서 코끝으로 이어지는 큰 비늘판들
    const plates: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const z0 = -0.9 + i * 0.95;
      const z1 = z0 + 0.82;
      const w0 = lerpU(z0, 1) * 0.55;
      const w1 = lerpU(z1, 1) * 0.55;
      const t0 = lerpU(z0, 2) + 0.19;
      const t1 = lerpU(z1, 2) + 0.18;
      plates.push(hull(mirror([[w0, t0 - 0.06, z0], [w1, t1 - 0.06, z1], [0, t0 + 0.07, z0], [0, t1 + 0.07, z1], [0, t0 - 0.02, z0], [0, t1 - 0.02, z1]])));
    }
    add(merge(plates), plateM);
    // 콧구멍
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.12, 6, 5).scale(1, 0.7, 1.4).translate(sx * 0.26, 0.22, 2.7), darkM, g, false);
    // 입천장 (입이 벌어질 때 붉게 드러난다)
    add(new THREE.SphereGeometry(1, 8, 5).scale(0.5, 0.1, 1.3).translate(0, -0.46, 1.3), throatM, g, false);

    // 아래턱: 입을 벌리면 뒤쪽 축을 중심으로 아래로 돌아간다. 턱 밑은 옅은 색
    this.jawPivot.position.set(0, -0.34, -1.0);
    g.add(this.jawPivot);
    const J: [number, number, number, number][] = [
      [0.0, 0.62, 0.1, -0.34],
      [1.0, 0.86, 0.02, -0.4],
      [2.0, 0.7, -0.02, -0.36],
      [3.0, 0.5, -0.04, -0.3],
      [3.8, 0.32, -0.06, -0.22],
    ];
    const jPts: P3[] = [];
    for (const [z, hw0, top, bot] of J) { const hw = hw0 * 1.3; jPts.push([hw, top, z], [hw, bot, z], [hw * 0.5, bot - 0.05, z]); }
    add(hull(mirror(jPts)), skullM, this.jawPivot);
    add(hull(mirror([[0.52, -0.34, 0.6], [0.65, -0.46, 2.0], [0, -0.58, 2.0], [0.26, -0.36, 3.6], [0, -0.42, 3.7], [0.39, -0.34, 1.2]])), chinM, this.jawPivot);
    add(new THREE.SphereGeometry(1, 8, 5).scale(0.5, 0.1, 1.4).translate(0, 0.04, 1.9), throatM, this.jawPivot, false);
    const hwJ = (z: number) => {
      for (let i = 0; i < J.length - 1; i++) if (z <= J[i + 1][0]) return (J[i][1] + ((J[i + 1][1] - J[i][1]) * (z - J[i][0])) / (J[i + 1][0] - J[i][0])) * 1.3;
      return J[J.length - 1][1] * 1.3;
    };

    // 이빨 (작은 것들)
    const upT: THREE.BufferGeometry[] = [];
    const loT: THREE.BufferGeometry[] = [];
    [0.9, 1.35, 1.8, 2.25, 2.65].forEach((z, i) => {
      for (const sx of [-1, 1]) upT.push(aimed(spike(0.28 + i * 0.02, 0.07, 4), [sx * lerpU(z, 1) * 0.86, lerpU(z, 3) + 0.05, z], [sx * 0.05, -1, 0.2]));
    });
    [1.4, 1.85, 2.3, 2.75, 3.2].forEach((z, i) => {
      for (const sx of [-1, 1]) loT.push(aimed(spike(0.24 + i * 0.015, 0.06, 4), [sx * hwJ(z) * 0.78, 0.0, z], [-sx * 0.05, 1, 0.15]));
    });
    add(merge(upT), boneM);
    add(merge(loT), boneM, this.jawPivot);

    // 큰 독니: 입을 벌리면 앞으로 젖혀진다 (다물면 입천장 쪽으로 접힌다)
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(sx * 0.58, -0.42, 1.75);
      g.add(pv);
      this.fangs.push(pv);
      add(taperedTube([[0, 0, 0], [0, -0.58, 0.04], [0, -1.3, 0.22]], 0.15, 0.012, 6, 8), boneM, pv);
    }

    // 혀: 가늘고 긴 혀가 코끝에서 나와, 끝이 깊게 갈라진 두 가닥으로 벌어진다. 끝은 검다.
    this.tongue.position.set(0, -0.36, 2.9);
    this.tongue.rotation.x = 0.1;
    g.add(this.tongue);
    add(taperedTube([[0, 0, 0], [0, 0, 1.1], [0, 0, 2.1]], 0.075, 0.05, 5, 6), tongueM, this.tongue, false);
    this.tineL.position.set(0, 0, 2.1);
    this.tineR.position.set(0, 0, 2.1);
    this.tongue.add(this.tineL, this.tineR);
    for (const [tn, sx] of [[this.tineL, 1], [this.tineR, -1]] as const) {
      add(taperedTube([[0, 0, 0], [sx * 0.05, 0, 0.8], [sx * 0.26, 0, 1.6]], 0.05, 0.005, 4, 6), tongueM, tn, false);
    }
    this.tongue.scale.z = 0.001;

    // 턱 관절 뒤로 뻗는 광대 가시
    const cheek: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) cheek.push(aimed(spike(0.5 - i * 0.14, 0.12 - i * 0.025, 5), [sx * 1.17, -0.08 - i * 0.2, -1.0 - i * 0.26], [sx * 0.9, -0.1 - 0.1 * i, -0.6]));
    }
    add(merge(cheek), plateM);

    // 눈: 가늘고 비스듬한 호박색 + 세로로 찢어진 동공
    const eyeGeo = new THREE.SphereGeometry(1, 10, 6).scale(0.36, 0.17, 0.1);
    this.extraGeos.push(eyeGeo);
    for (const sx of [-1, 1]) {
      const eg = new THREE.Group();
      eg.position.set(sx * 0.9, 0.3, 1.12);
      eg.rotation.set(0, sx * 0.62, sx * 0.4);
      g.add(eg);
      const e = new THREE.Mesh(eyeGeo, this.eyeMat);
      eg.add(e);

    }

    // 이마의 마름모 비늘 = 약점. 평소엔 어둡고, 허점을 드러내면 호박색으로 타오른다
    add(hull([[0, 0.64, 1.05], [0.44, 0.6, 0.55], [-0.44, 0.6, 0.55], [0, 0.6, 0.0], [0, 0.5, 0.55]]), this.gemMat, g, false);

    // 목 지느러미: 목 양옆으로 물갈퀴처럼 펼쳐진다. 가시 줄기가 막 끝을 넘어 삐죽 나온다
    this.hoodGroup.position.set(0, -0.05, -1.7);
    g.add(this.hoodGroup);
    const fg = finGeometry();
    this.extraGeos.push(fg.geo);
    const ribs: THREE.BufferGeometry[] = [];
    for (let k = 0; k < fg.roots.length; k++) {
      const o = fg.roots[k];
      const tp = fg.tips[k];
      const d: P3 = [tp[0] - o[0], tp[1] - o[1], tp[2] - o[2]];
      ribs.push(aimed(spike(Math.hypot(d[0], d[1], d[2]) * 1.12, 0.075, 4), o, d));
    }
    const ribGeo = merge(ribs);
    for (const sx of [-1, 1]) {
      const fgp = new THREE.Group();
      fgp.position.set(sx * 0.95, -0.2, 0);
      fgp.scale.x = sx;
      this.hoodGroup.add(fgp);
      this.finGroups.push(fgp);
      const fm = new THREE.Mesh(fg.geo, this.hoodFront);
      fgp.add(fm);
      this.allMeshes.push(fm);
      add(ribGeo, boneM, fgp);
    }
  }

  /* ───────────────────────── 배치: 몸이 놓일 길 ───────────────────────── */
  /** 머리 위치를 정한다 (매 프레임 보스가 호출) */
  setHead(x: number, z: number) {
    this.pos.set(x, 0, z);
  }

  /** 궤적을 처음부터 다시 쓴다. pts = 머리에서 뒤로 향하는 (x,z) 나열 (간격 ≈ TS), 첫 점이 머리 */
  private setTrail(pts: number[]) {
    const n = Math.min(CAP, Math.floor(pts.length / 2) - 1);
    this.pos.set(pts[0], 0, pts[1]);
    this.trCount = n;
    // 오래된 것부터 채운다: i = n … 1
    for (let i = n; i >= 1; i--) {
      const slot = n - i;
      this.trx[slot] = pts[i * 2];
      this.trz[slot] = pts[i * 2 + 1];
    }
    this.trHead = n - 1;
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
  }

  /** 머리 뒤로 일직선으로 놓는다. heading = 머리가 향하는 수학 각 atan2(dz,dx) */
  layoutLine(x: number, z: number, heading: number) {
    const dx = Math.cos(heading);
    const dz = Math.sin(heading);
    const N = Math.ceil((BODY_LEN + 12) / TS);
    const pts: number[] = [];
    for (let i = 0; i <= N; i++) pts.push(x - dx * i * TS, z - dz * i * TS);
    this.setTrail(pts);
  }

  /**
   * 머리 뒤로 나선(똬리)을 놓는다.
   *  turn  +1 = 머리가 반시계로 돌아 들어온 길 / −1 = 시계
   *  rho0  머리 자리의 나선 반지름
   *  grow  −1 = 머리에서 멀어질수록 안쪽으로 감김 (머리가 똬리 바깥쪽) / +1 = 바깥으로 풀림 (머리가 똬리 한가운데)
   *  rhoLim  감기는 한계 반지름 (안쪽/바깥쪽)
   * 반환: 나선 중심
   */
  layoutSpiral(x: number, z: number, heading: number, turn: 1 | -1, rho0: number, grow: 1 | -1, rhoLim: number, out?: THREE.Vector3) {
    const th0 = heading - (turn * Math.PI) / 2;
    const cx = x - rho0 * Math.cos(th0);
    const cz = z - rho0 * Math.sin(th0);
    // 몸 길이가 딱 맞도록 간격(pitch) 을 정한다: L = π|ρ1² − ρ0²| / pitch
    const pitch = Math.max(3.9, (Math.PI * Math.abs(rhoLim * rhoLim - rho0 * rho0)) / (BODY_LEN + 8));
    const N = Math.ceil((BODY_LEN + 12) / TS);
    const pts: number[] = [];
    let phi = 0;
    let rho = rho0;
    for (let i = 0; i <= N; i++) {
      const th = th0 - turn * phi;
      pts.push(cx + rho * Math.cos(th), cz + rho * Math.sin(th));
      const d = TS / Math.max(1, rho);
      phi += d;
      rho += (grow * pitch * d) / TAU;
      rho = grow < 0 ? Math.max(rhoLim, rho) : Math.min(rhoLim, rho);
    }
    this.setTrail(pts);
    if (out) out.set(cx, 0, cz);
    return pitch;
  }

  /** 새 자리에 몸을 모두 땅속에 묻은 채로 놓는다 (잠행 후 재배치) */
  hideAll() {
    this.wave = 'none';
    this.baseSub = 1;
  }

  /** 머리부터 차례로 땅속으로 */
  dive() {
    this.wave = 'dive';
    this.waveT = 0;
  }
  /** 머리부터 차례로 땅 위로 */
  emerge() {
    this.wave = 'emerge';
    this.waveT = 0;
    this.baseSub = 1;
  }
  /** 즉시 전부 땅속에 (또는 위에) */
  snapSub(under: boolean) {
    this.wave = 'none';
    this.baseSub = under ? 1 : 0;
  }
  get underground() {
    return this.wave === 'none' && this.baseSub >= 1;
  }
  get waving() {
    return this.wave !== 'none';
  }

  setExposed(on: boolean) {
    this.exposed = on;
  }
  setRage(level: number) {
    this.rage = level;
  }
  flash(part: 'head' | 'body' | 'all', strength = 1) {
    if (part !== 'body') this.headFlash = Math.max(this.headFlash, strength);
    if (part !== 'head') this.bodyFlash = Math.max(this.bodyFlash, strength);
  }
  snapPose() {
    this.liftCur = this.lift;
    this.jawCur = this.jaw;
    this.hoodCur = this.hood;
    this.undCur = this.undulate;
    this.pitchCur = this.headPitch;
  }
  /** 혀를 한 번 내민다 */
  flick() {
    if (this.flicking) return;
    this.flicking = true;
    this.flickT = 0;
    this.nextFlick = (0.7 + Math.random() * 1.5) / Math.max(0.2, this.tongueRate);
    this.onFlick();
  }

  /** 머리 앞 입 위치 (독 뱉기 발사점) */
  mouth(out: THREE.Vector3) {
    return this.head.localToWorld(out.set(0, -0.52, 2.9));
  }
  headWorld(out: THREE.Vector3) {
    return out.set(this.head.position.x, this.head.position.y, this.head.position.z);
  }
  get headY() {
    return this.head.position.y;
  }
  get currentLift() {
    return this.liftCur;
  }
  /** 꼬리 끝 위치 */
  tail(out: THREE.Vector3) {
    return out.set(this.cx[NR - 1], this.cy[NR - 1], this.cz[NR - 1]);
  }
  /** 머리에서 sigma 만큼 뒤의 몸 위치 */
  bodyAt(sigma: number, out: THREE.Vector3) {
    const k = clamp(Math.round(sigma / DSEG), 0, NR - 1);
    return out.set(this.cx[k], this.cy[k], this.cz[k]);
  }

  /** 플레이어가 통과하지 못하는 몸통 원들: 몸이 멈춰 있을 때만 몸 전체, 움직이는 동안엔 머리만 */
  bodies(): Circle[] {
    const out = this.out;
    out.length = 0;
    let n = 0;
    const hs = this.headSphere;
    if (this.headUp && this.liftCur < 2.0) {
      const c = this.circles[n++];
      c.x = hs.x;
      c.z = hs.z;
      c.r = 1.5;
      out.push(c);
    }
    if (!this.solid || this.exploded) return out;
    for (let k = 4; k < NR; k += 4) {
      if (this.sub[k] > 0.3 || RAD[k] < 0.35) continue;
      if (this.cy[k] - RAD[k] > 1.4) continue;
      if (n >= this.circles.length) break;
      const c = this.circles[n++];
      c.x = this.cx[k];
      c.z = this.cz[k];
      c.r = RAD[k] * 0.88;
      out.push(c);
    }
    return out;
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    this.t += dt;
    this.updateDebris(dt);
    if (this.exploded) return;

    this.liftCur = approach(this.liftCur, Math.max(HEAD_REST, this.lift), this.liftRate, dt);
    this.jawCur = approach(this.jawCur, this.jaw, 12, dt);
    this.hoodCur = approach(this.hoodCur, this.hood, 6, dt);
    this.undCur = approach(this.undCur, this.undulate, 3, dt);
    this.pitchCur = approach(this.pitchCur, this.headPitch, 8, dt);

    if (dt > 0) {
      const sp = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ) / dt;
      this.speed = approach(this.speed, Math.min(sp, 120), 12, dt);
    }
    if (this.speed < 1.2 && this.wave === 'none') this.stillT += dt;
    else this.stillT = 0;
    this.solid = this.stillT > 0.3;

    if (this.wave !== 'none') {
      this.waveT += dt;
      if (this.waveT > (BODY_LEN + 0.5) / WAVE_SPEED + WAVE_RISE + 0.05) {
        this.baseSub = this.wave === 'dive' ? 1 : 0;
        this.wave = 'none';
      }
    }

    this.pushTrail();
    this.solveBody();
    this.placeHead(dt);
    this.updateMaterials(dt);
  }

  /** 머리가 이번 프레임에 간 만큼 궤적에 점을 더한다 */
  private pushTrail() {
    const ox = this.lastX;
    const oz = this.lastZ;
    const n = this.trCount;
    const last = (this.trHead + CAP) % CAP;
    const lx = n > 0 ? this.trx[last] : ox;
    const lz = n > 0 ? this.trz[last] : oz;
    const dx = this.pos.x - lx;
    const dz = this.pos.z - lz;
    const d = Math.hypot(dx, dz);
    if (d >= TS) {
      const steps = Math.min(Math.floor(d / TS), 400);
      for (let i = 1; i <= steps; i++) {
        this.trHead = (this.trHead + 1) % CAP;
        this.trx[this.trHead] = lx + (dx / d) * i * TS;
        this.trz[this.trHead] = lz + (dz / d) * i * TS;
        if (this.trCount < CAP) this.trCount++;
      }
    }
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
  }

  /** 궤적 위에 고리들을 놓고, 겹침을 쌓고, 관 메쉬를 쓴다 */
  private solveBody() {
    const n = this.trCount;
    const px = this.pxA;
    const pz = this.pzA;
    const cum = this.cumA;
    px[0] = this.pos.x;
    pz[0] = this.pos.z;
    cum[0] = 0;
    for (let i = 0; i < n; i++) {
      const idx = (this.trHead - i + CAP * 2) % CAP;
      px[i + 1] = this.trx[idx];
      pz[i + 1] = this.trz[idx];
      cum[i + 1] = cum[i] + Math.hypot(px[i + 1] - px[i], pz[i + 1] - pz[i]);
    }

    const L = this.liftCur;
    const Ln = Math.max(6, 1.7 * (L - HEAD_REST) + 4);
    const rest0 = RAD[0] * 0.8;
    const t = this.t;
    const und = this.undCur;
    const swayAmp = clamp((L - 2) * 0.07, 0, 0.7);
    let H = 0;
    let m = 0;
    let prevY = 0;
    let tdx = 1;
    let tdz = 0;
    {
      const sx = px[0] - px[1];
      const sz = pz[0] - pz[1];
      const sl = Math.hypot(sx, sz);
      if (sl > 1e-6) {
        tdx = sx / sl;
        tdz = sz / sl;
      }
    }
    const wv = this.wave;
    const wt = this.waveT;
    for (let k = 0; k < NR; k++) {
      const sg = k * DSEG;
      const u = sg / Ln;
      const f = u >= 1 ? 0 : 1 - smooth(u);
      const y = RAD[k] * 0.8 + (L - rest0) * f;
      this.py[k] = y;
      if (k > 0) {
        const dy = y - prevY;
        H += Math.sqrt(Math.max(0.0036, DSEG * DSEG - dy * dy));
      }
      prevY = y;
      while (m < n - 1 && cum[m + 1] < H) m++;
      const segL = cum[m + 1] - cum[m];
      let tt = segL > 1e-6 ? (H - cum[m]) / segL : 0;
      if (tt > 1.5) tt = 1.5;
      let x = px[m] + (px[m + 1] - px[m]) * tt;
      let zz = pz[m] + (pz[m + 1] - pz[m]) * tt;
      if (segL > 1e-6) {
        tdx = (px[m] - px[m + 1]) / segL;
        tdz = (pz[m] - pz[m + 1]) / segL;
      }
      // 잔물결: 머리 쪽에서 꼬리 쪽으로 흐르는 가벼운 옆 흔들림 + 목이 솟았을 때의 좌우 흔들림
      const ramp = 0.15 + 0.85 * smooth(sg / 22);
      let wob = und * 0.8 * ramp * Math.sin(sg * 0.33 - t * 2.4);
      if (swayAmp > 0 && u < 1) wob += swayAmp * Math.sin(t * 1.15 + sg * 0.2) * 4 * u * (1 - u);
      x += -tdz * wob;
      zz += tdx * wob;
      // 잠행 물결
      let sb = this.baseSub;
      if (wv !== 'none') {
        const kk = smooth((wt - sg / WAVE_SPEED) / WAVE_RISE);
        sb = wv === 'dive' ? kk : 1 - kk;
      }
      this.sub[k] = sb;
      this.cx[k] = x;
      this.cz[k] = zz;
      this.cy[k] = y;
    }

    this.stackBody();

    // 잠긴 만큼 내리고 관 정점을 쓴다
    for (let k = 0; k < NR; k++) this.cy[k] -= this.sub[k] * (2 * RAD[k] + 1.8);
    const pos = this.tubeGeo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const cx = this.cx;
    const cy = this.cy;
    const cz = this.cz;
    let nx = 0;
    let ny = 1;
    let nz = 0;
    for (let k = 0; k < NR; k++) {
      const a = k === 0 ? 0 : k - 1;
      const b = k === NR - 1 ? NR - 1 : k + 1;
      let Tx = cx[a] - cx[b];
      let Ty = cy[a] - cy[b];
      let Tz = cz[a] - cz[b];
      const Tl = Math.hypot(Tx, Ty, Tz) || 1;
      Tx /= Tl;
      Ty /= Tl;
      Tz /= Tl;
      // 위쪽 기준: 월드 위를 접선에 수직으로 눌러 편 것. 거의 수직으로 솟은 곳에선 이전 고리에서 이어받는다
      const wl = Math.sqrt(Math.max(0, 1 - Ty * Ty));
      let pnx = nx - (nx * Tx + ny * Ty + nz * Tz) * Tx;
      let pny = ny - (nx * Tx + ny * Ty + nz * Tz) * Ty;
      let pnz = nz - (nx * Tx + ny * Ty + nz * Tz) * Tz;
      let pl = Math.hypot(pnx, pny, pnz);
      if (pl < 1e-4) {
        pnx = -Ty * Tx;
        pny = 1 - Ty * Ty;
        pnz = -Ty * Tz;
        pl = Math.hypot(pnx, pny, pnz) || 1;
      }
      pnx /= pl;
      pny /= pl;
      pnz /= pl;
      if (wl > 0.3) {
        const w = smooth((wl - 0.3) / 0.4);
        const wx = (-Ty * Tx) / wl;
        const wy = (1 - Ty * Ty) / wl;
        const wz = (-Ty * Tz) / wl;
        pnx = pnx * (1 - w) + wx * w;
        pny = pny * (1 - w) + wy * w;
        pnz = pnz * (1 - w) + wz * w;
        const l2 = Math.hypot(pnx, pny, pnz) || 1;
        pnx /= l2;
        pny /= l2;
        pnz /= l2;
      }
      nx = pnx;
      ny = pny;
      nz = pnz;
      // B = T × N
      const Bx = Ty * nz - Tz * ny;
      const By = Tz * nx - Tx * nz;
      const Bz = Tx * ny - Ty * nx;
      const o3 = k * 3;
      this.fn[o3] = nx;
      this.fn[o3 + 1] = ny;
      this.fn[o3 + 2] = nz;
      this.fb[o3] = Bx;
      this.fb[o3 + 1] = By;
      this.fb[o3 + 2] = Bz;
      this.ft[o3] = Tx;
      this.ft[o3 + 1] = Ty;
      this.ft[o3 + 2] = Tz;
      const r = RAD[k];
      for (let j = 0; j < VW; j++) {
        const th = (j / M) * TAU;
        const s = Math.sin(th);
        const c = Math.cos(th);
        const ry = r * c * (c > 0 ? 1.06 : 0.8);
        const rx = r * s;
        const o = (k * VW + j) * 3;
        arr[o] = cx[k] + nx * ry + Bx * rx;
        arr[o + 1] = cy[k] + ny * ry + By * rx;
        arr[o + 2] = cz[k] + nz * ry + Bz * rx;
      }
    }
    pos.needsUpdate = true;

    // 판정 마디
    for (const s of this.segs) {
      const k = s.ring;
      s.x = cx[k];
      s.y = cy[k];
      s.z = cz[k];
      s.r = RAD[k] * 0.95;
      s.sub = this.sub[k];
      s.up = this.sub[k] < 0.5 && RAD[k] > 0.25;
    }
  }

  /** 몸이 자기 몸과 겹치는 곳: 머리 쪽 몸이 꼬리 쪽 몸 위로 곡선을 그리며 올라탄다 */
  private stackBody() {
    const cx = this.cx;
    const cz = this.cz;
    const cy = this.cy;
    const cnt = this.gridCnt;
    const gi = this.gridIdx;
    cnt.fill(0);
    const half = GN / 2;
    for (let k = NR - 1; k >= 0; k--) {
      const gx = clamp(Math.floor(cx[k] / GCELL) + half, 1, GN - 2);
      const gz = clamp(Math.floor(cz[k] / GCELL) + half, 1, GN - 2);
      let need = cy[k];
      if (this.sub[k] < 0.6) {
        const rk = RAD[k];
        for (let ax = gx - 1; ax <= gx + 1; ax++) {
          for (let az = gz - 1; az <= gz + 1; az++) {
            const cell = az * GN + ax;
            const c = cnt[cell];
            for (let q = 0; q < c; q++) {
              const j = gi[cell * GCAP + q];
              if (j - k < STACK_GAP) continue;
              const lim = (rk + RAD[j]) * 0.9;
              const dx = cx[k] - cx[j];
              const dz = cz[k] - cz[j];
              const d2 = dx * dx + dz * dz;
              if (d2 < lim * lim) {
                const req = cy[j] + Math.sqrt(lim * lim - d2);
                if (req > need) need = req;
              }
            }
          }
        }
      }
      cy[k] = need;
      const cell = gz * GN + gx;
      if (cnt[cell] < GCAP) gi[cell * GCAP + cnt[cell]++] = k;
    }
    // 올라탄 높이의 경사를 제한한다 (가파른 계단 대신 둥근 언덕)
    const s = 0.42;
    for (let k = 1; k < NR; k++) {
      const e0 = cy[k - 1] - this.py[k - 1];
      const e1 = cy[k] - this.py[k];
      if (e1 < e0 - s) cy[k] = this.py[k] + e0 - s;
    }
    for (let k = NR - 2; k >= 0; k--) {
      const e0 = cy[k + 1] - this.py[k + 1];
      const e1 = cy[k] - this.py[k];
      if (e1 < e0 - s) cy[k] = this.py[k] + e0 - s;
    }
  }

  /** 머리 모델의 위치·방향·입·후드·혀를 갱신한다 */
  private placeHead(dt: number) {
    const hd = this.head;
    hd.position.set(this.pos.x, this.liftCur - this.sub[0] * 3, this.pos.z);
    hd.rotation.set(this.pitchCur, this.headYaw, 0, 'YXZ');
    this.headUp = this.sub[0] < 0.5;
    hd.visible = this.sub[0] < 0.98;

    this.jawPivot.rotation.x = this.jawCur * 1.5;
    const fa = 1.35 * (1 - smooth(this.jawCur * 1.7 - 0.15));
    for (const f of this.fangs) f.rotation.x = fa;
    const hk = this.hoodCur;
    // 지느러미: 접으면 목 옆에 뒤로 젖혀 납작하게 붙고, 펴면 정면으로 넓게 선다
    const open = smooth(hk);
    const breathe = 0.02 * Math.sin(this.t * 2.3) * open;
    this.finGroups.forEach((fgp, i) => {
      const sx = i === 0 ? -1 : 1;
      fgp.rotation.y = sx * ((1 - open) * 1.35 + breathe);
      fgp.scale.set(sx * (0.55 + 0.45 * open), 0.5 + 0.5 * open, 0.55 + 0.45 * open);
    });

    // 혀
    if (dt > 0) {
      this.nextFlick -= dt;
      if (!this.flicking && this.nextFlick <= 0 && this.jawCur < 0.9) this.flick();
      if (this.flicking) {
        this.flickT += dt;
        const D = 0.55;
        const u = this.flickT / D;
        if (u >= 1) {
          this.flicking = false;
          this.tongue.scale.z = 0.001;
        } else {
          let ext = u < 0.2 ? u / 0.2 : u < 0.72 ? 1 + 0.08 * Math.sin(u * 60) : 1 - (u - 0.72) / 0.28;
          ext = clamp(ext, 0.001, 1.1);
          this.tongue.scale.z = ext;
          this.tongue.rotation.x = 0.1 + Math.sin(u * 22) * 0.2 * (1 - u);
          this.tongue.rotation.y = Math.sin(u * 17 + 1) * 0.1;
          const spread = 0.05 + 0.4 * smooth((u - 0.1) / 0.3);
          this.tineL.rotation.y = spread;
          this.tineR.rotation.y = -spread;
        }
      }
    }

    hd.updateMatrixWorld(true);
    // 머리 판정 구 (주둥이 쪽으로 치우친다)
    const hs = this.headSphere;
    const hp = hd.localToWorld(this.tmpA.set(0, 0.05, 0.9));
    hs.x = hp.x;
    hs.y = hp.y;
    hs.z = hp.z;
  }

  private updateMaterials(dt: number) {
    this.bodyFlash = Math.max(0, this.bodyFlash - dt * 10);
    this.headFlash = Math.max(0, this.headFlash - dt * 10);
    const heat = (m: THREE.MeshStandardMaterial, f: number, extra = 0) => {
      m.emissive.copy(m.userData.baseEmissive as THREE.Color);
      m.emissive.r += f * 0.5 + extra;
      m.emissive.g += f * 0.28;
      m.emissive.b += f * 0.06;
    };
    const rg = Math.min(2, this.rage) / 2;
    const pulse = 0.6 + 0.4 * Math.sin(this.t * (this.rage >= 2 ? 9 : 5));
    const ra = Math.min(2, this.rage);
    this.aura.visible = ra > 0 && this.tube.visible;
    this.auraMat.opacity = ra <= 0 ? 0 : (ra >= 2 ? 0.65 : 0.4) * (0.75 + 0.25 * pulse);
    this.auraMat.color.setHex(ra >= 2 ? 0x9a0c1c : 0xff3a1a);
    this.auraPuff.value = ra >= 2 ? 0.75 + 0.12 * pulse : 0.5;
    heat(this.bodyMat, this.bodyFlash, this.rage > 0 ? 0.03 + 0.05 * rg * pulse : 0);
    this.bodyMat.color.setRGB(1, 1 - 0.28 * rg, 1 - 0.32 * rg);
    for (const m of this.headMats) heat(m, this.headFlash);
    heat(this.hoodFront, this.headFlash, 0.1 * rg * pulse);
    const k = 1.3 + 0.4 * Math.sin(this.t * (this.rage > 0 ? (this.rage >= 2 ? 17 : 11) : 4));
    if (this.rage > 0) this.eyeMat.color.setRGB(1.0 * k, 0.1 * k, 0.06 * k);
    else this.eyeMat.color.setRGB(1.0 * k, 1.0 * k, 0.96 * k);
    if (this.exposed) {
      const q = 1.7 + 0.9 * Math.sin(this.t * 16);
      this.gemMat.color.setRGB(1.0 * q, 0.78 * q, 0.14 * q);
    } else if (this.rage > 0) {
      const q = 0.9 + 0.35 * Math.sin(this.t * 7);
      this.gemMat.color.setRGB(0.9 * q, 0.12 * q, 0.08 * q);
    } else {
      const q = 0.9 + 0.3 * Math.sin(this.t * 3);
      this.gemMat.color.setRGB(0.12 * q, 0.5 * q, 0.42 * q);
    }
  }

  /* ───────────────────────── 사망: 마디별 분해 ───────────────────────── */
  explode(power = 1) {
    if (this.exploded) return;
    this.exploded = true;
    this.snapSub(false);
    this.head.updateMatrixWorld(true);
    const center = new V3(this.pos.x, 1.5, this.pos.z);
    const launch = (mesh: THREE.Mesh, wp: THREE.Vector3, size: number) => {
      const dir = wp.clone().sub(center);
      dir.y = Math.abs(dir.y) * 0.5 + 0.6;
      dir.normalize();
      const sp = (4 + Math.random() * 9) * power;
      this.debris.push({
        mesh,
        vel: dir.multiplyScalar(sp).add(new V3((Math.random() - 0.5) * 3, 5 + Math.random() * 8, (Math.random() - 0.5) * 3)),
        ang: new V3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        r: Math.max(0.15, size),
        rest: false,
      });
    };
    for (const mesh of this.allMeshes) {
      if (!mesh.visible || !mesh.parent) continue;
      const wp = mesh.getWorldPosition(new V3());
      this.scene.attach(mesh);
      launch(mesh, wp, new THREE.Box3().setFromObject(mesh).getSize(new V3()).y * 0.5);
    }
    const mx = new THREE.Matrix4();
    for (let k = 3; k < NR; k += 3) {
      if (this.sub[k] >= 0.98 || RAD[k] < 0.2) continue;
      const m = new THREE.Mesh(this.chunkGeo, this.debrisMat);
      mx.makeBasis(this.tmpA.set(this.fb[k * 3], this.fb[k * 3 + 1], this.fb[k * 3 + 2]), this.tmpB.set(this.fn[k * 3], this.fn[k * 3 + 1], this.fn[k * 3 + 2]), new V3(this.ft[k * 3], this.ft[k * 3 + 1], this.ft[k * 3 + 2]));
      m.quaternion.setFromRotationMatrix(mx);
      m.position.set(this.cx[k], this.cy[k], this.cz[k]);
      m.scale.set(RAD[k], RAD[k] * 0.9, DSEG * 1.6);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      launch(m, m.position, RAD[k] * 0.8);
    }
    this.tube.visible = false;
    this.aura.visible = false;
    this.head.visible = false;
  }

  private updateDebris(dt: number) {
    for (const d of this.debris) {
      if (d.rest) continue;
      d.vel.y -= 28 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.ang.x * dt;
      d.mesh.rotation.y += d.ang.y * dt;
      d.mesh.rotation.z += d.ang.z * dt;
      const floor = Math.min(d.r, 0.6);
      if (d.mesh.position.y < floor) {
        d.mesh.position.y = floor;
        d.vel.y *= -0.35;
        d.vel.x *= 0.78;
        d.vel.z *= 0.78;
        d.ang.multiplyScalar(0.6);
        if (Math.abs(d.vel.y) < 1.2 && Math.hypot(d.vel.x, d.vel.z) < 0.6) d.rest = true;
      }
      const r = Math.hypot(d.mesh.position.x, d.mesh.position.z);
      if (r > WORLD.radius - 0.5) {
        d.vel.x *= -0.4;
        d.vel.z *= -0.4;
        d.mesh.position.x *= (WORLD.radius - 0.6) / r;
        d.mesh.position.z *= (WORLD.radius - 0.6) / r;
      }
    }
  }

  dispose() {
    this.scene.remove(this.head);
    this.scene.remove(this.tube);
    this.scene.remove(this.aura);
    this.auraMat.dispose();
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris = [];
    const geos = new Set<THREE.BufferGeometry>(this.extraGeos);
    geos.add(this.tubeGeo);
    geos.add(this.chunkGeo);
    for (const m of this.allMeshes) geos.add(m.geometry);
    geos.forEach((g) => g.dispose());
    for (const m of this.headMats) m.dispose();
    this.bodyMat.dispose();
    this.bodyTex.dispose();
    this.finTex.dispose();
    this.hoodFront.dispose();
    this.debrisMat.dispose();
    this.eyeMat.dispose();
    this.gemMat.dispose();
  }
}
