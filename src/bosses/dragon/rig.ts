import * as THREE from 'three';
import { envHolder } from '../../envmap';
import { aimed, hull, merge, mirror, spike, taperedTube, type P3 } from '../../geo';
import type { Circle, Sphere } from '../../types';

const V3 = THREE.Vector3;
type V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const UP = new V3(0, 1, 0);

/* ───────────────────────── 치수 ───────────────────────── */
/** 머리 뒤로 이어지는 몸통(목 · 가슴 · 허리 · 꼬리) 길이 */
export const BODY_LEN = 50;
/** 마디 간격 */
const DS = 0.6;
export const NR = Math.floor(BODY_LEN / DS) + 1;
/** 몸통 단면 분할 수 */
const M = 14;
const VW = M + 1;
/** 머리가 지나간 길(궤적)을 남기는 간격 */
const TS = 0.4;
const CAP = Math.ceil((BODY_LEN + 30) / TS);
/** 머리 배율 */
const HS = 1.55;
/** 날개가 붙는 마디 / 날개막 뒤쪽이 붙는 마디 / 앞다리 · 뒷다리 마디 */
const IW = 15;
const IH = 36;
const IFL = 19;
const IHL = 38;
/** 날개 배율 */
const WS = 0.95;
const ARM = [4.8, 6.6];
const FING = [13, 11.8, 9.6, 7.4];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (k: number) => {
  const c = clamp(k, 0, 1);
  return c * c * (3 - 2 * c);
};
const approach = (cur: number, goal: number, rate: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** 마디 반지름: 가는 목 → 두툼한 가슴 → 허리 → 길게 가늘어지는 꼬리 */
function radiusAt(s: number) {
  if (s < 11) return 1.15 + 1.0 * smooth(s / 11);
  if (s < 28) return 2.15 - 0.55 * smooth((s - 11) / 17);
  const k = (s - 28) / (BODY_LEN - 28);
  return 1.6 * Math.pow(Math.max(0, 1 - k), 1.15) + 0.08;
}
const RAD = new Float32Array(NR);
for (let i = 0; i < NR; i++) RAD[i] = radiusAt(i * DS);

/* ───────────────────────── 텍스처 ───────────────────────── */
function canvas2d(w: number, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, g: cv.getContext('2d', { willReadFrequently: true })! };
}

/** 비늘 무늬. glow=false: 밝은 회색 바탕에 어두운 윤곽(정점 색과 곱해진다) / glow=true: 윤곽을 따라 용암빛이 흐른다 */
function scaleTexture(glow: boolean): THREE.CanvasTexture {
  const S = 256;
  const { cv, g } = canvas2d(S);
  g.fillStyle = glow ? '#000' : '#cfcfcf';
  g.fillRect(0, 0, S, S);
  let seed = glow ? 5 : 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = 10;
  const cols = 8;
  const h = S / rows;
  const w = S / cols;
  for (let r = -1; r <= rows; r++) {
    for (let c = -1; c <= cols; c++) {
      const x = (c + (r & 1) * 0.5) * w + w * 0.5;
      const y = r * h + h * 0.5;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          const px = x + ox;
          const py = y + oy;
          if (px < -w || px > S + w || py < -h || py > S + h) continue;
          g.beginPath();
          g.moveTo(px - w * 0.55, py - h * 0.25);
          g.quadraticCurveTo(px - w * 0.5, py + h * 0.85, px, py + h * 0.95);
          g.quadraticCurveTo(px + w * 0.5, py + h * 0.85, px + w * 0.55, py - h * 0.25);
          if (!glow) {
            const v = 170 + Math.floor(rnd() * 60);
            g.fillStyle = `rgb(${v},${v},${v})`;
            g.fill();
            g.strokeStyle = 'rgba(20,10,10,0.85)';
            g.lineWidth = 2.6;
            g.stroke();
          } else {
            const hot = rnd() < 0.18;
            g.fillStyle = hot ? 'rgba(120,32,6,0.55)' : 'rgba(0,0,0,0)';
            g.fill();
            g.strokeStyle = hot ? 'rgba(255,150,40,0.95)' : 'rgba(255,90,20,0.55)';
            g.lineWidth = hot ? 2.4 : 1.4;
            g.stroke();
          }
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!glow) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stdMat(color: number, emissive = 0x000000, rough = 0.55, metal = 0.25, flat = false) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, roughness: rough, metalness: metal, flatShading: flat });
  if (envHolder.tex) {
    m.envMap = envHolder.tex;
    m.envMapIntensity = 0.55;
  }
  return m;
}

export interface DragonPart extends Sphere {
  kind: 'head' | 'body' | 'wing';
}

/** 날개 제어값 (보스 로직이 목표값을 정하면 리그가 부드럽게 따라간다) */
export interface WingCtl {
  /** 초당 날갯짓 횟수 */
  hz: number;
  /** 날갯짓 진폭(라디안) */
  amp: number;
  /** 0 = 활짝 / 1 = 몸에 바짝 접음 (급강하) */
  fold: number;
  /** 날개를 들어 올리는 정도 (+ = 위로, - = 아래로 늘어뜨림) */
  raise: number;
  /** 손가락뼈 벌림 0~1 */
  spread: number;
}

interface TrailPt {
  x: number;
  y: number;
  z: number;
  b: number;
}

interface Bone {
  mesh: THREE.Mesh;
}

/**
 * 용 모델/모션. 뱀 이무기와 같은 방식 — 머리가 지나간 길(궤적)을 몸통 마디들이 그대로 따라온다 —
 * 에 하늘을 나는 용에 필요한 것을 더했다.
 *
 *   · 몸통: 3D 궤적을 따라가는 관(tube). 머리의 급선회는 몸통의 큰 곡선이 되고, 선회 기울기(뱅크)도 궤적에 실려 몸이 차례로 기운다.
 *           그 위에 꼬리로 갈수록 커지는 파도(좌우 · 상하)를 얹어 헤엄치듯 일렁인다.
 *   · 날개: 어깨 → 팔꿈치 → 손목 → 손가락뼈 4개 + 날개막. 팔과 손가락이 시간차를 두고 꺾이며 퍼덕인다 (아래로 빠르게, 위로 느리게).
 *   · 다리 · 꼬리 칼날 · 등 가시 · 머리(뿔, 갈기, 수염, 아래턱, 입속 불빛).
 *   · 쓰러짐(lieDown): 추락해 땅에 박히면 몸통이 하늘에서 쏟아져 내려 똬리 치듯 바닥에 눕는다.
 */
export class DragonRig {
  readonly group = new THREE.Group();
  /** 머리 위치(목 끝) — 매 프레임 보스가 정한다 */
  readonly head = new V3(0, 20, 0);
  yaw = 0;
  pitch = 0;
  /** 머리를 몸통과 따로 돌리는 값(플레이어를 노려볼 때) */
  lookYaw = 0;
  lookPitch = 0;
  /** 선회 기울기(+ = 오른쪽으로 기움) */
  bank = 0;
  jaw = 0;
  /** 입속 불빛 0~1 */
  fire = 0;
  /** 0 평소 / 1 분노 / 2 광란 */
  rage = 0;
  stunned = false;
  /** 파도 세기 */
  undulate = 0.6;
  wing: WingCtl = { hz: 0.7, amp: 0.55, fold: 0, raise: 0.1, spread: 1 };
  /** 다리를 접는 정도 0~1 */
  tuck = 0.4;
  readonly parts: DragonPart[] = [];
  readonly headSphere: DragonPart;
  /** 날개 끝 · 팔꿈치 위치(연출용) */
  readonly wingTips: V3[] = [new V3(), new V3()];
  speed = 0;

  private t = 0;
  private flapPh = 0;
  private cur: WingCtl = { hz: 0.7, amp: 0.55, fold: 0, raise: 0.1, spread: 1 };
  private curJaw = 0;
  private curFire = 0;
  private curTuck = 0.4;
  private curUnd = 0.6;
  private curStun = 0;
  private rageCur = 0;

  /* 궤적 */
  private trail: TrailPt[] = [];
  private trFirst = 0;
  private trCount = 0;
  private prevHead = new V3();

  /* 마디 */
  private P: V3[] = [];
  private Pout: V3[] = [];
  private T: V3[] = [];
  private U: V3[] = [];
  private Rv: V3[] = [];
  private Bk = new Float32Array(NR);
  private collapseFrom: V3[] | null = null;
  private collapseT = 9;
  private lyingK = 0;

  /* 메시 */
  private bodyMat: THREE.MeshStandardMaterial;
  private memMat: THREE.MeshStandardMaterial;
  private boneMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshBasicMaterial;
  private bodyGeo: THREE.BufferGeometry;
  private bodyPos: Float32Array;
  private spines: THREE.InstancedMesh;
  private nSpine: number;
  private headRoot = new THREE.Group();
  private jawPivot = new THREE.Group();
  private mouthGlow: THREE.Mesh;
  private mouthLight: THREE.PointLight;
  private whiskers: THREE.Group[] = [];
  private wings: { side: number; bones: THREE.Mesh[]; mem: THREE.Mesh; memGeo: THREE.BufferGeometry; memPos: Float32Array; pts: V3[] }[] = [];
  private limbs: { ring: number; side: number; bones: Bone[]; claws: THREE.Mesh; fore: boolean }[] = [];
  private tailBlade: THREE.Mesh;
  private boneGeo = new THREE.CylinderGeometry(0.62, 1, 1, 7, 1).translate(0, 0.5, 0);
  private disposables: Array<{ dispose(): void }> = [];

  private f = new V3();
  private tv = new V3();
  private tv2 = new V3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private sv = new V3();
  private pv = new V3();
  private ev = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    this.group.frustumCulled = false;
    for (let i = 0; i < NR; i++) {
      this.P.push(new V3());
      this.Pout.push(new V3());
      this.T.push(new V3(0, 0, 1));
      this.U.push(new V3(0, 1, 0));
      this.Rv.push(new V3(1, 0, 0));
    }
    for (let i = 0; i < CAP; i++) this.trail.push({ x: 0, y: 0, z: 0, b: 0 });

    /* ── 재질 ── */
    const sc = scaleTexture(false);
    const glow = scaleTexture(true);
    this.disposables.push(sc, glow);
    this.bodyMat = stdMat(0xffffff, 0xff5a14, 0.5, 0.3);
    this.bodyMat.vertexColors = true;
    this.bodyMat.map = sc;
    this.bodyMat.emissiveMap = glow;
    this.bodyMat.emissiveIntensity = 0.45;
    this.memMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, emissive: 0xff3a08, emissiveIntensity: 0.1, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    this.boneMat = stdMat(0x2b1210, 0x3a0c04, 0.6, 0.35, true);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.4), toneMapped: false });
    this.disposables.push(this.bodyMat, this.memMat, this.boneMat, this.eyeMat);
    const horn = stdMat(0xd8c9a4, 0x2a1a08, 0.45, 0.2, true);
    const dark = stdMat(0x1c0c0b, 0x2a0a04, 0.6, 0.3, true);
    this.disposables.push(horn, dark);

    /* ── 몸통 관 ── */
    const nv = NR * VW;
    this.bodyPos = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 3);
    for (let i = 0; i < NR; i++) {
      const tailK = smooth((i * DS - 20) / 30);
      for (let j = 0; j < VW; j++) {
        const a = (j / M) * TAU;
        const v = i * VW + j;
        uv[v * 2] = (j / M) * 4;
        uv[v * 2 + 1] = (i * DS) / 2.4;
        const belly = smooth(-Math.sin(a) * 1.7 - 0.12);
        const back = [0.42 - 0.12 * tailK, 0.07, 0.055];
        const bel = [0.92, 0.62, 0.3];
        col[v * 3] = lerp(back[0], bel[0], belly);
        col[v * 3 + 1] = lerp(back[1], bel[1], belly);
        col[v * 3 + 2] = lerp(back[2], bel[2], belly);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < NR - 1; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * VW + j;
        const b = a + 1;
        const c = a + VW;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.bodyGeo = new THREE.BufferGeometry();
    this.bodyGeo.setAttribute('position', new THREE.BufferAttribute(this.bodyPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.bodyGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.bodyGeo.setIndex(idx);
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.frustumCulled = false;
    body.castShadow = true;
    this.group.add(body);
    this.disposables.push(this.bodyGeo);

    /* ── 등 가시 ── */
    this.nSpine = Math.floor((NR - 8) / 2);
    const spGeo = merge([spike(1.7, 0.36, 5), aimed(spike(0.9, 0.2, 4), [0.0, 0.0, 0.0], [0.35, 1, 0])]);
    this.spines = new THREE.InstancedMesh(spGeo, dark, this.nSpine);
    this.spines.frustumCulled = false;
    this.spines.castShadow = true;
    this.group.add(this.spines);
    this.disposables.push(spGeo);

    /* ── 머리 ── */
    this.buildHead(horn, dark);
    this.headSphere = { x: 0, y: 0, z: 0, r: 2.7, kind: 'head' };
    this.mouthLight = new THREE.PointLight(0xff7a28, 0, 46, 1.4);
    this.headRoot.add(this.mouthLight);
    this.mouthLight.position.set(0, -0.3, 3.2);
    this.mouthGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.9, 0.2), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.mouthGlow.position.set(0, -0.1, 1.9);
    this.headRoot.add(this.mouthGlow);
    this.disposables.push(this.mouthGlow.geometry, this.mouthGlow.material as THREE.Material);
    this.group.add(this.headRoot);

    /* ── 날개 · 다리 · 꼬리 칼날 ── */
    for (const side of [1, -1]) this.buildWing(side);
    for (const [ring, fore] of [[IFL, true], [IHL, false]] as [number, boolean][]) for (const side of [1, -1]) this.buildLimb(ring, side, fore, dark, horn);
    const blade = hull(mirror([[0, 0.14, 0], [0.55, 0.14, -0.6], [1.35, 0.1, -2.0], [0.5, 0.06, -3.6], [0, 0.04, -5.2], [0, -0.14, 0], [0.55, -0.14, -0.6], [1.35, -0.1, -2.0], [0.5, -0.06, -3.6]]));
    this.tailBlade = new THREE.Mesh(blade, stdMat(0x1a0d0c, 0x3a0c04, 0.5, 0.5, true));
    this.tailBlade.castShadow = true;
    this.group.add(this.tailBlade);
    this.disposables.push(blade, this.tailBlade.material as THREE.Material);

    /* 판정 구 */
    this.parts.push(this.headSphere);
    for (let i = 2; i < NR; i += 2) this.parts.push({ x: 0, y: 0, z: 0, r: RAD[i] + 0.3, kind: 'body' });
    for (let k = 0; k < 8; k++) this.parts.push({ x: 0, y: 0, z: 0, r: 2, kind: 'wing' });
    this.layoutLine(0, 20, 0, 0, 1);
  }

  /* ───────────────────────── 모델링 ───────────────────────── */
  private buildHead(horn: THREE.Material, dark: THREE.Material) {
    const r = this.headRoot;
    r.scale.setScalar(HS);
    const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = r) => {
      const me = new THREE.Mesh(g, m);
      me.castShadow = true;
      parent.add(me);
      this.disposables.push(g);
      return me;
    };
    const scalesMat = this.bodyMat.clone();
    scalesMat.vertexColors = false;
    scalesMat.map = null;
    scalesMat.emissiveMap = null;
    scalesMat.color.setHex(0x4a0f0b);
    scalesMat.emissive.setHex(0x3a0a02);
    scalesMat.emissiveIntensity = 0.5;
    scalesMat.flatShading = true;
    this.disposables.push(scalesMat);
    // 두개골
    const skull = hull(
      mirror([
        [0, 1.2, -1.9],
        [0.85, 0.95, -1.7],
        [1.15, 0.1, -1.7],
        [0.75, -0.5, -1.6],
        [1.2, 0.75, 0.2],
        [1.3, -0.1, 0.2],
        [0.95, -0.55, 0.2],
        [0.55, 0.52, 2.6],
        [0.62, -0.1, 2.95],
        [0.46, -0.34, 2.7],
        [0.34, 0.36, 3.4],
        [0.34, -0.16, 3.5],
        [0, 0.6, 2.4],
      ]),
    );
    add(skull, scalesMat);
    // 눈두덩
    for (const s of [1, -1]) {
      const brow = hull([
        [s * 0.55, 0.78, -0.2],
        [s * 1.28, 0.74, -0.1],
        [s * 1.1, 1.18, 0.1],
        [s * 0.5, 0.95, 1.3],
        [s * 0.92, 0.62, 1.5],
        [s * 0.45, 0.7, 0.4],
      ]);
      add(brow, dark);
      // 눈 (세로 홍채)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), this.eyeMat);
      eye.scale.set(0.8, 1.0, 1.35);
      eye.position.set(s * 0.98, 0.52, 0.75);
      r.add(eye);
      this.disposables.push(eye.geometry);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.07), new THREE.MeshBasicMaterial({ color: 0x050202 }));
      slit.position.set(s * 1.1, 0.52, 0.8);
      r.add(slit);
      this.disposables.push(slit.geometry, slit.material as THREE.Material);
      // 콧구멍 혹
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), dark);
      nose.position.set(s * 0.22, 0.46, 3.22);
      r.add(nose);
      this.disposables.push(nose.geometry);
    }
    // 큰 뿔 (뒤로 휘어 넘어간다) + 작은 뿔 + 볼 가시
    const bigHorn = merge([
      taperedTube([[0.55, 0.85, -0.9], [1.1, 1.5, -2.4], [1.45, 1.55, -4.2], [1.3, 1.1, -5.6]], 0.34, 0.02, 7, 14),
      taperedTube([[-0.55, 0.85, -0.9], [-1.1, 1.5, -2.4], [-1.45, 1.55, -4.2], [-1.3, 1.1, -5.6]], 0.34, 0.02, 7, 14),
      taperedTube([[0.95, 0.4, -1.0], [1.7, 0.6, -2.0], [2.5, 0.35, -3.1]], 0.2, 0.02, 6, 10),
      taperedTube([[-0.95, 0.4, -1.0], [-1.7, 0.6, -2.0], [-2.5, 0.35, -3.1]], 0.2, 0.02, 6, 10),
      taperedTube([[1.1, -0.2, -0.5], [1.9, -0.45, -1.1], [2.5, -0.8, -1.4]], 0.17, 0.02, 6, 8),
      taperedTube([[-1.1, -0.2, -0.5], [-1.9, -0.45, -1.1], [-2.5, -0.8, -1.4]], 0.17, 0.02, 6, 8),
    ]);
    add(bigHorn, horn);
    // 이마에서 목으로 이어지는 갈기(지느러미 가시)
    const crest: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const z = 1.4 - i * 0.55;
      crest.push(aimed(spike(0.9 + i * 0.12, 0.17, 4), [0, 1.0 + (i < 2 ? 0.0 : 0.15), z], [0, 1, -0.7 - i * 0.12]));
    }
    add(merge(crest), dark);
    // 귀지느러미 (부채처럼 뒤로 펼쳐진다)
    const fins: THREE.BufferGeometry[] = [];
    for (const s of [1, -1]) {
      for (let k = 0; k < 4; k++) {
        const ang = 0.15 + k * 0.28;
        fins.push(aimed(spike(2.6 - k * 0.3, 0.42, 3), [s * 0.95, 0.35 + k * 0.08, -0.9], [s * Math.sin(ang) * 0.9, 0.25 - k * 0.1, -Math.cos(ang)], [1, 1, 0.22]));
      }
    }
    const finMat = new THREE.MeshStandardMaterial({ color: 0x8a1c0e, emissive: 0xff3a08, emissiveIntensity: 0.35, roughness: 0.7, side: THREE.DoubleSide, flatShading: true });
    this.disposables.push(finMat);
    add(merge(fins), finMat);
    // 윗니 · 송곳니
    const upper: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const z = 0.5 + i * 0.4;
      const w = 0.96 - Math.min(0.5, i * 0.06);
      for (const s of [1, -1]) upper.push(aimed(spike(i === 7 ? 0.8 : 0.42, i === 7 ? 0.1 : 0.07, 4), [s * w * 0.62, -0.38, z], [0, -1, 0.12]));
    }
    add(merge(upper), horn);
    // 수염 (두 갈래, 흔들린다)
    for (const s of [1, -1]) {
      for (let k = 0; k < 2; k++) {
        const g = new THREE.Group();
        g.position.set(s * 0.45, 0.05 - k * 0.2, 3.0 - k * 0.5);
        const w = taperedTube([[0, 0, 0], [s * 1.0, 0.3, 0.2], [s * 2.0, -0.1, -0.9], [s * 2.8, -0.9, -2.4], [s * 3.1, -1.3, -4.0]], 0.07, 0.015, 5, 14);
        add(w, horn, g);
        r.add(g);
        this.whiskers.push(g);
      }
    }
    // 아래턱: 어금니 쪽을 축으로 아래로 벌어진다
    this.jawPivot.position.set(0, -0.35, -0.7);
    r.add(this.jawPivot);
    const jaw = hull(
      mirror([
        [0.75, 0.0, 0.1],
        [0.86, -0.28, 0.9],
        [0.56, -0.34, 2.6],
        [0.4, -0.18, 3.4],
        [0.52, 0.04, 1.8],
        [0.36, 0.04, 3.6],
        [0, -0.32, 3.7],
        [0, -0.1, -0.3],
      ]),
    );
    add(jaw, scalesMat, this.jawPivot);
    const lower: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const z = 0.8 + i * 0.5;
      for (const s of [1, -1]) lower.push(aimed(spike(0.36, 0.06, 4), [s * 0.5, 0.02, z], [0, 1, -0.1]));
    }
    add(merge(lower), horn, this.jawPivot);
    // 입속(붉은 살)
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 3.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.12, 0.05), toneMapped: false }));
    inner.position.set(0, 0.0, 1.9);
    this.jawPivot.add(inner);
    this.disposables.push(inner.geometry, inner.material as THREE.Material);
    // 턱 밑 수염 가시
    add(merge([aimed(spike(1.4, 0.2, 4), [0, -0.3, 3.0], [0, -1, -0.6]), aimed(spike(1.0, 0.16, 4), [0, -0.3, 2.2], [0, -1, -0.5])]), dark, this.jawPivot);
  }

  private buildWing(side: number) {
    const bones: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.boneGeo, this.boneMat);
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      bones.push(m);
    }
    // 날개막: S E W F1 F2 F3 F4 M1 M2 M3 B0 M4
    const NV = 12;
    const memPos = new Float32Array(NV * 3);
    const memCol = new Float32Array(NV * 3);
    const cols = [
      [0.22, 0.04, 0.035], // S
      [0.26, 0.05, 0.04], // E
      [0.32, 0.06, 0.04], // W
      [0.62, 0.14, 0.06], // F1
      [0.7, 0.18, 0.07],
      [0.78, 0.22, 0.08],
      [0.85, 0.28, 0.09], // F4
      [0.52, 0.1, 0.05], // M1
      [0.58, 0.12, 0.05],
      [0.64, 0.14, 0.06],
      [0.5, 0.1, 0.05], // B0
      [0.6, 0.13, 0.05], // M4
    ];
    for (let i = 0; i < NV; i++) cols[i].forEach((c, k) => (memCol[i * 3 + k] = c * 0.55));
    const tri = [2, 3, 7, 2, 7, 4, 2, 4, 8, 2, 8, 5, 2, 5, 9, 2, 9, 6, 2, 6, 11, 2, 11, 10, 2, 10, 0, 2, 0, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(memPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(memCol, 3));
    g.setIndex(tri);
    const mem = new THREE.Mesh(g, this.memMat);
    mem.frustumCulled = false;
    mem.castShadow = true;
    this.group.add(mem);
    this.disposables.push(g);
    const pts: V3[] = [];
    for (let i = 0; i < 12; i++) pts.push(new V3());
    this.wings.push({ side, bones, mem, memGeo: g, memPos, pts });
  }

  private buildLimb(ring: number, side: number, fore: boolean, dark: THREE.Material, horn: THREE.Material) {
    const bones: Bone[] = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.boneGeo, i === 2 ? dark : this.boneMat);
      m.castShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      bones.push({ mesh: m });
    }
    const claws = merge([0, 1, 2].map((k) => aimed(spike(0.9, 0.12, 4), [(k - 1) * 0.28, 0, 0.1], [(k - 1) * 0.3, -0.55, 0.9])));
    const cm = new THREE.Mesh(claws, horn);
    cm.frustumCulled = false;
    this.group.add(cm);
    this.disposables.push(claws);
    this.limbs.push({ ring, side, bones, claws: cm, fore });
  }

  /* ───────────────────────── 배치 · 제어 ───────────────────────── */
  /** 머리를 (x,y,z) 에 두고 몸통을 뒤쪽으로 곧게 편다 (등장 · 재시작) */
  layoutLine(x: number, y: number, z: number, yaw: number, pitch: number) {
    void pitch;
    this.head.set(x, y, z);
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    this.trFirst = 0;
    this.trCount = CAP;
    for (let k = 0; k < CAP; k++) {
      const p = this.trail[k];
      p.x = x + dx * (k + 1) * TS;
      p.y = y;
      p.z = z + dz * (k + 1) * TS;
      p.b = 0;
    }
    this.yaw = yaw;
    this.pitch = 0;
    this.prevHead.copy(this.head);
    this.collapseFrom = null;
    this.collapseT = 9;
    this.lyingK = 0;
  }

  /**
   * 땅에 처박힌 순간: 몸통이 하늘에서 쏟아져 내려 바닥에 S자로 눕는다.
   * 궤적을 바닥의 S자 곡선으로 바꿔치고, 지금 보이는 마디 위치에서 새 위치로 빠르게 내려앉게 섞는다.
   */
  lieDown() {
    this.collapseFrom = this.Pout.map((p) => p.clone());
    this.collapseT = 0;
    this.lyingK = 1;
    let x = this.head.x;
    let z = this.head.z;
    const base = this.yaw + Math.PI;
    const flip = Math.random() < 0.5 ? 1 : -1;
    this.trFirst = 0;
    this.trCount = CAP;
    for (let k = 0; k < CAP; k++) {
      const d = k * TS;
      const ang = base + flip * 1.25 * Math.sin(d * 0.36) * Math.min(1, d / 6);
      x += Math.sin(ang) * TS;
      z += Math.cos(ang) * TS;
      const p = this.trail[k];
      p.x = x;
      p.y = 0;
      p.z = z;
      p.b = 0;
    }
  }

  /** 다시 날아오른다(몸통 쓰러짐 풀림 — 궤적은 그대로 두면 머리를 따라 미끄러지듯 올라온다) */
  liftOff() {
    this.lyingK = 0;
  }

  get lying() {
    return this.lyingK > 0;
  }

  /** 머리가 있는 곳에서 입 끝까지 월드 좌표 */
  mouth(out: THREE.Vector3) {
    return this.headRoot.localToWorld(out.set(0, -0.2, 3.3));
  }

  /** 머리 중심 */
  headCenter(out: THREE.Vector3) {
    return out.set(this.headSphere.x, this.headSphere.y, this.headSphere.z);
  }

  /** 머리가 바라보는 방향(월드) */
  headForward(out: THREE.Vector3) {
    return out.set(0, 0, 1).applyQuaternion(this.headRoot.quaternion).normalize();
  }

  /** i 번째 마디의 월드 위치 */
  ring(i: number, out: THREE.Vector3) {
    return out.copy(this.Pout[clamp(i, 0, NR - 1)]);
  }
  ringRadius(i: number) {
    return RAD[clamp(i, 0, NR - 1)];
  }
  get rings() {
    return NR;
  }

  setRage(level: number) {
    this.rage = level;
  }

  /** 맞았을 때 번쩍 */
  hurt = 0;
  flash(k = 1) {
    this.hurt = Math.max(this.hurt, k);
  }

  /** 땅에 닿는 낮은 마디들의 충돌 원 (쓰러져 있을 때만 의미가 있다) */
  bodies(): Circle[] {
    const out: Circle[] = [];
    for (const p of this.parts) {
      if (p.kind === 'wing') continue;
      if (p.y - p.r > 1.7) continue;
      out.push({ x: p.x, z: p.z, r: p.r * 0.82 });
    }
    return out;
  }

  /* ───────────────────────── 매 프레임 ───────────────────────── */
  private trailAt(k: number): TrailPt {
    return this.trail[(this.trFirst + k) % CAP];
  }

  private pushTrail() {
    const h = this.head;
    if (this.trCount === 0) return;
    let last = this.trailAt(0);
    let dx = h.x - last.x;
    let dy = h.y - last.y;
    let dz = h.z - last.z;
    let d = Math.hypot(dx, dy, dz);
    let guard = 0;
    while (d >= TS && guard++ < 40) {
      const k = TS / d;
      this.trFirst = (this.trFirst - 1 + CAP) % CAP;
      const p = this.trail[this.trFirst];
      p.x = last.x + dx * k;
      p.y = last.y + dy * k;
      p.z = last.z + dz * k;
      p.b = this.bank;
      if (this.trCount < CAP) this.trCount++;
      last = p;
      dx = h.x - last.x;
      dy = h.y - last.y;
      dz = h.z - last.z;
      d = Math.hypot(dx, dy, dz);
    }
  }

  private sample() {
    const h = this.head;
    const n = this.trCount;
    let px = h.x;
    let py = h.y;
    let pz = h.z;
    let pb = this.bank;
    let ni = 0;
    let nx = this.trailAt(0).x;
    let ny = this.trailAt(0).y;
    let nz = this.trailAt(0).z;
    let nb = this.trailAt(0).b;
    let segL = Math.hypot(nx - px, ny - py, nz - pz);
    let acc = 0;
    for (let i = 0; i < NR; i++) {
      const target = i * DS;
      while (acc + segL < target && ni < n - 1) {
        acc += segL;
        px = nx;
        py = ny;
        pz = nz;
        pb = nb;
        ni++;
        const q = this.trailAt(ni);
        nx = q.x;
        ny = q.y;
        nz = q.z;
        nb = q.b;
        segL = Math.hypot(nx - px, ny - py, nz - pz);
      }
      const u = segL > 1e-6 ? clamp((target - acc) / segL, 0, 1) : 1;
      this.P[i].set(px + (nx - px) * u, py + (ny - py) * u, pz + (nz - pz) * u);
      this.Bk[i] = pb + (nb - pb) * u;
    }
  }

  /** 마디마다 앞(T) · 위(U) · 오른쪽(Rv) 축 */
  private frames(P: V3[], keepUp: boolean) {
    const T = this.T;
    const U = this.U;
    const R = this.Rv;
    for (let i = 0; i < NR; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(NR - 1, i + 1)];
      T[i].subVectors(a, b);
      if (T[i].lengthSq() < 1e-8) T[i].set(0, 0, 1);
      T[i].normalize();
    }
    if (!keepUp) {
      // 머리 위쪽 = 진행 방향을 피치로 돌린 위쪽 (급강하하면 등이 앞쪽을 본다)
      const cy = Math.cos(this.pitch);
      const sy = Math.sin(this.pitch);
      U[0].set(-Math.sin(this.yaw) * sy, cy, -Math.cos(this.yaw) * sy);
      U[0].addScaledVector(T[0], -U[0].dot(T[0])).normalize();
      for (let i = 1; i < NR; i++) {
        U[i].copy(U[i - 1]);
        U[i].addScaledVector(T[i], -U[i].dot(T[i]));
        if (U[i].lengthSq() < 1e-6) U[i].copy(U[i - 1]);
        U[i].normalize();
        // 서서히 하늘쪽(등이 위)으로 돌려세운다
        this.tv.copy(UP).addScaledVector(T[i], -UP.dot(T[i]));
        if (this.tv.lengthSq() > 0.05) U[i].addScaledVector(this.tv.normalize(), 0.05).normalize();
      }
    } else {
      for (let i = 0; i < NR; i++) {
        U[i].addScaledVector(T[i], -U[i].dot(T[i])).normalize();
      }
    }
    for (let i = 0; i < NR; i++) R[i].crossVectors(U[i], T[i]).normalize();
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const W = this.cur;
    const g = this.wing;
    W.hz = approach(W.hz, g.hz, 3, dt);
    W.amp = approach(W.amp, g.amp, 4, dt);
    W.fold = approach(W.fold, g.fold, 5, dt);
    W.raise = approach(W.raise, g.raise, 6, dt);
    W.spread = approach(W.spread, g.spread, 4, dt);
    this.curJaw = approach(this.curJaw, this.jaw, 9, dt);
    this.curFire = approach(this.curFire, this.fire, 6, dt);
    this.curTuck = approach(this.curTuck, this.tuck, 3, dt);
    this.curUnd = approach(this.curUnd, this.undulate, 2, dt);
    this.curStun = approach(this.curStun, this.stunned ? 1 : 0, 6, dt);
    this.rageCur = approach(this.rageCur, this.rage, 1.5, dt);
    this.hurt = Math.max(0, this.hurt - dt * 5);
    this.flapPh += dt * TAU * W.hz;
    this.speed = this.head.distanceTo(this.prevHead) / Math.max(dt, 1e-4);
    this.prevHead.copy(this.head);

    this.pushTrail();
    this.sample();

    // 쓰러짐: 하늘에 남은 마디가 바닥의 새 자리로 쏟아져 내린다
    if (this.collapseFrom && this.collapseT < 1) {
      this.collapseT += dt / 0.8;
      for (let i = 0; i < NR; i++) {
        const k = clamp(this.collapseT * (1.05 + (i / NR) * 0.55) - (i / NR) * 0.12, 0, 1);
        const from = this.collapseFrom[i];
        const to = this.P[i];
        const kxz = smooth(k);
        to.x = lerp(from.x, to.x, kxz);
        to.z = lerp(from.z, to.z, kxz);
        to.y = lerp(from.y, to.y, k * k);
      }
      if (this.collapseT >= 1) this.collapseFrom = null;
    }

    // ── 파도(헤엄치는 일렁임): 꼬리로 갈수록 크다. 쓰러져 있을 때는 몸을 비틀며 숨쉰다 ──
    this.frames(this.P, false);
    const und = this.curUnd * (1 - 0.8 * this.lyingK);
    const flapBob = Math.sin(this.flapPh);
    for (let i = 0; i < NR; i++) {
      const s = i * DS;
      const ramp = smooth(s / 40);
      const amp = und * (0.12 + 1.9 * ramp);
      const lat = amp * Math.sin(t * 2.6 - s * 0.24);
      const ver = amp * 0.5 * Math.sin(t * 2.1 - s * 0.2 + 1.3);
      const pi = this.P[i];
      const po = this.Pout[i];
      po.copy(pi).addScaledVector(this.Rv[i], lat).addScaledVector(this.U[i], ver);
      // 날갯짓에 어깨가 출렁인다
      const sh = Math.exp(-Math.pow((i - IW) / 7, 2));
      po.y += -flapBob * 0.55 * this.cur.amp * sh * (1 - this.lyingK);
      // 숨쉬기(가슴)
      const br = 1 + 0.025 * Math.sin(t * 2.4 - s * 0.15);
      void br;
      po.y = Math.max(po.y, RAD[i] * 0.78 + 0.1);
    }
    this.head.y = Math.max(this.head.y, 1.3);
    // 파도를 얹은 위치로 축을 다시 구한다 (관이 휜 길을 따라가도록)
    this.frames(this.Pout, true);
    // 선회 기울기: 궤적에 실려 온 값으로 몸을 눕힌다
    for (let i = 0; i < NR; i++) {
      const b = this.Bk[i] * (1 - this.lyingK);
      if (Math.abs(b) > 1e-3) {
        const c = Math.cos(b);
        const s = Math.sin(b);
        const U = this.U[i];
        const R = this.Rv[i];
        this.tv.copy(U).multiplyScalar(c).addScaledVector(R, s);
        this.tv2.copy(R).multiplyScalar(c).addScaledVector(U, -s);
        U.copy(this.tv);
        R.copy(this.tv2);
      }
    }

    this.updateBody();
    this.updateHead(dt);
    this.updateWings();
    this.updateLimbs();
    this.updateParts();
    this.updateMaterials(t);
  }

  private updateBody() {
    const pos = this.bodyPos;
    const flat = 0.9;
    for (let i = 0; i < NR; i++) {
      const c = this.Pout[i];
      const R = this.Rv[i];
      const U = this.U[i];
      const rr = RAD[i] * (1 + 0.03 * Math.sin(this.t * 2.4 - i * 0.25));
      for (let j = 0; j < VW; j++) {
        const a = (j / M) * TAU;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr * flat;
        const v = (i * VW + j) * 3;
        pos[v] = c.x + R.x * x + U.x * y;
        pos[v + 1] = c.y + R.y * x + U.y * y;
        pos[v + 2] = c.z + R.z * x + U.z * y;
      }
    }
    const attr = this.bodyGeo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.bodyGeo.computeVertexNormals();

    // 등 가시
    for (let k = 0; k < this.nSpine; k++) {
      const i = 4 + k * 2;
      const c = this.Pout[i];
      const U = this.U[i];
      const T = this.T[i];
      const R = this.Rv[i];
      this.tv.copy(U).addScaledVector(T, -0.5).normalize();
      this.tv2.crossVectors(R, this.tv).normalize();
      this.m4.makeBasis(R, this.tv, this.tv2);
      const sz = i < 9 ? 0.55 + i * 0.05 : clamp(RAD[i] * 0.62 + 0.25, 0.3, 1.5);
      this.m4.scale(this.sv.set(sz, sz * (1 + 0.12 * Math.sin(this.t * 3 + i)), sz));
      this.m4.setPosition(c.x + U.x * RAD[i] * 0.86, c.y + U.y * RAD[i] * 0.86, c.z + U.z * RAD[i] * 0.86);
      this.spines.setMatrixAt(k, this.m4);
    }
    this.spines.instanceMatrix.needsUpdate = true;

    // 꼬리 칼날
    const e = NR - 1;
    this.m4.makeBasis(this.Rv[e], this.U[e], this.T[e]);
    this.m4.setPosition(this.Pout[e]);
    this.tailBlade.matrixAutoUpdate = false;
    this.tailBlade.matrix.copy(this.m4);
    this.tailBlade.matrixWorldNeedsUpdate = true;
  }

  private updateHead(dt: number) {
    const r = this.headRoot;
    r.position.copy(this.Pout[0]);
    this.ev.set(-(this.pitch + this.lookPitch), this.yaw + this.lookYaw, -this.bank * 0.9, 'YXZ');
    r.quaternion.setFromEuler(this.ev);
    const stun = this.curStun;
    // 아래턱: 입을 벌리면 위쪽 숨결, 숨 쉴 때 살짝 떨림
    this.jawPivot.rotation.x = this.curJaw * 0.72 + 0.03 * Math.sin(this.t * 3) + stun * 0.18;
    // 입속 불빛
    const f = this.curFire;
    this.mouthGlow.visible = f > 0.02;
    this.mouthGlow.scale.setScalar(0.4 + f * 2.4 * (0.92 + 0.08 * Math.sin(this.t * 40)));
    this.mouthLight.intensity = 220 * f;
    // 수염
    for (let i = 0; i < this.whiskers.length; i++) {
      const w = this.whiskers[i];
      const side = i < 2 ? 1 : -1;
      w.rotation.y = side * (0.1 + 0.05 * Math.sin(this.t * 2.2 + i)) - this.bank * 0.2 * side;
      w.rotation.x = 0.1 * Math.sin(this.t * 2.9 + i * 1.7) + Math.min(0.5, this.speed * 0.012);
    }
    r.updateMatrixWorld(true);
    void dt;
  }

  /** 날개 한쪽의 관절 위치를 구한다 */
  private updateWings() {
    const W = this.cur;
    const i = IW;
    const c0 = this.Pout[i];
    const R = this.Rv[i];
    const U = this.U[i];
    const T = this.T[i];
    const rad = RAD[i];
    const fold = W.fold;
    const stun = this.curStun;
    const th = this.flapPh;
    const shape = (p: number) => Math.sin(p) + 0.22 * Math.sin(2 * p);
    const lenK = 1 - 0.42 * fold;
    const dir = (side: number, sweep: number, elev: number, out: V3) => {
      const ce = Math.cos(elev);
      const lx = side * Math.cos(sweep) * ce;
      const ly = Math.sin(elev);
      const lz = -Math.sin(sweep) * ce;
      return out.set(R.x * lx + U.x * ly + T.x * lz, R.y * lx + U.y * ly + T.y * lz, R.z * lx + U.z * ly + T.z * lz);
    };
    const hip = this.Pout[IH];
    const hipR = this.Rv[IH];
    const hipU = this.U[IH];
    const tips = this.wingTips;
    for (let wi = 0; wi < 2; wi++) {
      const w = this.wings[wi];
      const side = w.side;
      const bias = 0.12 + W.raise - stun * 0.9;
      const amp = W.amp * (1 - stun);
      const eA = bias + amp * shape(th) * 1.0;
      const eB = bias * 0.9 + amp * shape(th - 0.28);
      const sweepA = lerp(0.95, 1.38, fold);
      const sweepB = lerp(-0.18, 1.45, fold);
      const S = this.pv.set(c0.x + R.x * side * rad * 0.5 + U.x * rad * 0.62, c0.y + R.y * side * rad * 0.5 + U.y * rad * 0.62, c0.z + R.z * side * rad * 0.5 + U.z * rad * 0.62).clone();
      const d1 = dir(side, sweepA, eA, this.tv);
      const E = S.clone().addScaledVector(d1, ARM[0] * WS * lenK);
      const d2 = dir(side, sweepB, eB, this.tv);
      const Wr = E.clone().addScaledVector(d2, ARM[1] * WS * lenK);
      const p = w.pts;
      p[0].copy(S);
      p[1].copy(E);
      p[2].copy(Wr);
      // 손가락뼈: 시간차를 두고 꺾인다 (끝이 늦게 따라온다)
      const spreadK = lerp(0.55, 1, W.spread) * (1 - fold);
      for (let k = 0; k < 4; k++) {
        const sweepF = lerp(0.12 + k * 0.4 * spreadK + 0.1 * (1 - spreadK), 1.5, fold);
        const elevF = bias * 0.8 + amp * shape(th - 0.52 - 0.14 * k) * (1.05 + 0.1 * k) - 0.04 * k;
        const d = dir(side, sweepF, elevF, this.tv);
        p[3 + k].copy(Wr).addScaledVector(d, FING[k] * WS * lenK);
      }
      // 날개막 뒤쪽 끝 = 허리 옆
      p[10].set(hip.x + hipR.x * side * RAD[IH] * 0.7 + hipU.x * RAD[IH] * 0.1, hip.y + hipR.y * side * RAD[IH] * 0.7 + hipU.y * RAD[IH] * 0.1, hip.z + hipR.z * side * RAD[IH] * 0.7 + hipU.z * RAD[IH] * 0.1);
      // 막 가장자리: 손가락 사이가 안쪽으로 파인다
      const scal = 0.2 + 0.12 * Math.sin(th * 2 + side);
      for (let k = 0; k < 3; k++) p[7 + k].lerpVectors(p[3 + k], p[4 + k], 0.5).lerp(p[2], scal);
      p[11].lerpVectors(p[6], p[10], 0.5).lerp(p[2], scal);
      // 늘어진 날개가 땅을 뚫지 않게
      for (let k = 0; k < 12; k++) if (p[k].y < 0.12) p[k].y = 0.12;
      for (let k = 0; k < 12; k++) {
        w.memPos[k * 3] = p[k].x;
        w.memPos[k * 3 + 1] = p[k].y;
        w.memPos[k * 3 + 2] = p[k].z;
      }
      (w.memGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      w.memGeo.computeVertexNormals();
      w.memGeo.computeBoundingSphere();
      // 뼈대
      this.setBone(w.bones[0], p[0], p[1], 0.42);
      this.setBone(w.bones[1], p[1], p[2], 0.36);
      for (let k = 0; k < 4; k++) this.setBone(w.bones[2 + k], p[2], p[3 + k], 0.2 - k * 0.012);
      tips[wi].copy(p[3]);
    }
  }

  private setBone(m: THREE.Mesh, a: V3, b: V3, r: number) {
    this.tv.subVectors(b, a);
    const L = this.tv.length();
    m.position.copy(a);
    if (L < 1e-4) {
      m.scale.set(0, 0, 0);
      return;
    }
    this.tv.multiplyScalar(1 / L);
    m.quaternion.setFromUnitVectors(UP, this.tv);
    m.scale.set(r, L, r);
  }

  private updateLimbs() {
    const tuck = this.curTuck;
    const t = this.t;
    for (const l of this.limbs) {
      const c = this.Pout[l.ring];
      const R = this.Rv[l.ring];
      const U = this.U[l.ring];
      const T = this.T[l.ring];
      const rad = RAD[l.ring];
      const s = l.side;
      const sw = Math.sin(t * 1.7 + l.ring + s) * 0.35 * (1 - tuck);
      const hip = this.pv.set(c.x + R.x * s * rad * 0.7 - U.x * rad * 0.45, c.y + R.y * s * rad * 0.7 - U.y * rad * 0.45, c.z + R.z * s * rad * 0.7 - U.z * rad * 0.45).clone();
      const k = l.fore ? 0.85 : 1.1;
      // 무릎: 옆 · 아래 · (접으면 몸 뒤쪽으로)
      const knee = hip
        .clone()
        .addScaledVector(R, s * 1.0 * k)
        .addScaledVector(U, -(1.3 - tuck * 0.7) * k)
        .addScaledVector(T, (0.5 - tuck * 1.9 + sw) * k);
      const foot = knee
        .clone()
        .addScaledVector(R, s * 0.35 * k)
        .addScaledVector(U, -(1.9 - tuck * 1.5) * k)
        .addScaledVector(T, (0.8 - tuck * 2.4 + sw) * k);
      const toe = foot.clone().addScaledVector(T, 0.9 * k).addScaledVector(U, -0.25 * k);
      if (foot.y < 0.3) foot.y = 0.3;
      if (toe.y < 0.2) toe.y = 0.2;
      this.setBone(l.bones[0].mesh, hip, knee, 0.62 * k);
      this.setBone(l.bones[1].mesh, knee, foot, 0.46 * k);
      this.setBone(l.bones[2].mesh, foot, toe, 0.34 * k);
      l.claws.position.copy(toe);
      this.tv.subVectors(toe, foot).normalize();
      l.claws.quaternion.setFromUnitVectors(new V3(0, 0, 1), this.tv);
      l.claws.scale.setScalar(k * 1.1);
    }
  }

  private updateParts() {
    const hr = this.headRoot;
    // 머리 판정구: 머리 중앙보다 약간 앞
    const hs = this.headSphere;
    this.tv.set(0, 0.1, 1.2).applyMatrix4(hr.matrixWorld);
    hs.x = this.tv.x;
    hs.y = this.tv.y;
    hs.z = this.tv.z;
    let n = 1;
    for (let i = 2; i < NR; i += 2) {
      const p = this.parts[n++];
      const c = this.Pout[i];
      p.x = c.x;
      p.y = c.y;
      p.z = c.z;
    }
    for (const w of this.wings) {
      const pts = w.pts;
      const mk = (a: V3, r: number) => {
        const p = this.parts[n++];
        p.x = a.x;
        p.y = a.y;
        p.z = a.z;
        p.r = r;
      };
      mk(pts[1], 2.0);
      mk(pts[2], 2.2);
      this.tv.lerpVectors(pts[2], pts[3], 0.5);
      mk(this.tv, 2.1);
      this.tv.lerpVectors(pts[2], pts[3], 0.88);
      mk(this.tv, 1.7);
    }
  }

  private updateMaterials(t: number) {
    const rg = this.rageCur;
    const beat = 0.5 + 0.5 * Math.sin(t * (2.2 + rg * 1.4));
    const hurt = this.hurt;
    this.bodyMat.emissiveIntensity = 0.42 + 0.3 * rg * (0.7 + 0.5 * beat) + hurt * 0.9 + this.curFire * 0.35;
    this.bodyMat.emissive.setRGB(1, 0.35 + 0.2 * hurt - 0.1 * rg, 0.08 + 0.2 * hurt);
    this.memMat.emissiveIntensity = 0.1 + 0.2 * rg * (0.7 + 0.5 * beat) + hurt * 0.5;
    this.eyeMat.color.setRGB(2.2, 1.7 - 0.62 * rg, 0.4 - 0.2 * rg).multiplyScalar(1 + this.curFire * 0.3);
  }

  explodeHide() {
    this.group.visible = false;
  }

  dispose() {
    this.scene.remove(this.group);
    this.spines.dispose();
    for (const d of this.disposables) d.dispose();
    this.boneGeo.dispose();
    for (const w of this.wings) w.memGeo.dispose();
    this.mouthLight.dispose();
  }
}
