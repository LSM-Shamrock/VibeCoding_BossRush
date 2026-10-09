import * as THREE from 'three';
import { spike } from '../../geo';

const V3 = THREE.Vector3;
type V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);

/**
 * 용의 팔다리 (서양식 드래곤): 어깨 갑옷 → 윗팔(허벅지) → 아랫팔(정강이) → 손바닥(발등) → 손가락 4개(마디 3개 + 발톱).
 *
 * 움직임은 "포즈 → 스프링" 방식이다. 사인파로 계속 흔드는 대신 동작마다 이름 붙은 포즈(관절 방향 · 손가락 벌림 · 쥐는 정도)를 정하고,
 * 그 포즈로 약간 탄력 있게 *팍* 하고 자리잡는다. 그래서 흐느적거리지 않고, 포효 · 할퀴기 · 급강하 같은 동작마다 자세가 또렷하다.
 */

export type ArmPose = 'tuck' | 'roar' | 'rake' | 'reach' | 'brace' | 'gather' | 'flex' | 'lie';
export type LegPose = 'trail' | 'dive' | 'brace' | 'roar' | 'lie';

/** [바깥, 위, 앞] 몸 기준 방향 (오른쪽 기준. 왼쪽은 바깥을 뒤집는다) */
type D3 = [number, number, number];
interface PoseSpec {
  u: D3; // 윗팔 / 허벅지
  f: D3; // 아랫팔 / 정강이
  h: D3; // 손 / 발
  spread: number; // 손가락 벌림 0~1
  curl: number; // 손가락 쥠 0~1
  stiff?: number; // 스프링 세기 (클수록 팍 자리잡는다)
}

const ARM: Record<ArmPose, PoseSpec> = {
  // 날 때: 가슴 아래로 접어 뒤로 젖힌다. 손은 주먹에 가깝게 말아 쥔다
  tuck: { u: [0.4, -0.62, -0.55], f: [0.12, -0.32, -0.94], h: [0.0, -0.55, -0.83], spread: 0.25, curl: 0.85 },
  // 포효: 두 팔을 위로 활짝 치켜들고 손가락을 한껏 벌린다
  roar: { u: [0.85, 0.35, 0.4], f: [0.6, 0.72, 0.36], h: [0.35, 0.66, 0.66], spread: 1, curl: 0.16, stiff: 230 },
  // 할퀴기: 앞으로 내리긋는다
  rake: { u: [0.45, -0.25, 0.85], f: [0.25, -0.55, 0.8], h: [0.1, -0.8, 0.6], spread: 0.95, curl: 0.3, stiff: 260 },
  // 덮치기: 앞으로 쭉 뻗어 움켜쥘 준비
  reach: { u: [0.3, -0.45, 0.84], f: [0.12, -0.4, 0.91], h: [0.05, -0.35, 0.94], spread: 1, curl: 0.12, stiff: 200 },
  // 착지 버티기: 바닥을 짚는다
  brace: { u: [0.6, -0.65, 0.45], f: [0.35, -0.92, 0.2], h: [0.1, -0.5, 0.86], spread: 0.8, curl: 0.25, stiff: 240 },
  // 힘 모으기: 두 팔을 벌려 올리고 손을 움켜쥐듯 오므린다 (태양을 모은다)
  gather: { u: [0.9, 0.15, 0.2], f: [0.55, 0.75, 0.35], h: [0.2, 0.78, 0.6], spread: 1, curl: 0.45, stiff: 150 },
  // 불끈: 팔을 굽혀 주먹을 쥔다 (힘을 주는 순간)
  flex: { u: [0.75, -0.1, -0.65], f: [0.3, 0.65, 0.7], h: [0.0, 0.5, 0.85], spread: 0.3, curl: 0.95, stiff: 200 },
  // 쓰러졌을 때: 힘없이 바닥에 걸친다
  lie: { u: [0.85, -0.5, 0.1], f: [0.7, -0.7, 0.2], h: [0.2, -0.55, 0.8], spread: 0.6, curl: 0.3, stiff: 90 },
};

const LEG: Record<LegPose, PoseSpec> = {
  // 날 때: 몸 뒤쪽으로 쭉 젖혀 늘어뜨린다
  trail: { u: [0.42, -0.48, -0.77], f: [0.14, -0.1, -0.98], h: [0.04, -0.45, -0.89], spread: 0.55, curl: 0.6 },
  // 급강하 · 내려찍기: 발톱을 앞아래로 펼쳐 낚아챈다
  dive: { u: [0.4, -0.62, 0.66], f: [0.15, -0.88, -0.2], h: [0.08, -0.3, 0.95], spread: 1, curl: 0.15, stiff: 220 },
  // 착지 버티기: 다리를 벌려 땅을 짚는다
  brace: { u: [0.85, -0.45, 0.28], f: [0.35, -0.93, -0.1], h: [0.12, -0.22, 0.97], spread: 1, curl: 0.1, stiff: 240 },
  // 포효: 뒷다리는 아래로 늘어뜨려 중심을 잡는다
  roar: { u: [0.5, -0.75, -0.4], f: [0.15, -0.55, -0.82], h: [0.05, -0.5, -0.86], spread: 0.8, curl: 0.35, stiff: 160 },
  lie: { u: [0.95, -0.35, -0.1], f: [0.65, -0.75, -0.1], h: [0.12, -0.2, 0.97], spread: 0.7, curl: 0.2, stiff: 90 },
};

/**
 * 뒷다리 달리기(네 발 짐승의 질주) 4단계: ① 앞으로 뻗어 닿기 → ② 몸 아래로 버티기 → ③ 뒤로 박차기 → ④ 접어 들어 올려 되돌리기.
 * 위상(0~1)에 따라 이 네 포즈 사이를 코사인으로 부드럽게 오간다.
 */
const GAIT: PoseSpec[] = [
  { u: [0.32, -0.42, 0.82], f: [0.12, -0.86, 0.3], h: [0.04, -0.3, 0.95], spread: 0.95, curl: 0.12 },
  { u: [0.3, -0.72, 0.18], f: [0.1, -0.92, -0.3], h: [0.04, -0.42, 0.9], spread: 0.85, curl: 0.15 },
  { u: [0.36, -0.5, -0.72], f: [0.1, -0.45, -0.9], h: [0.04, -0.8, -0.55], spread: 0.55, curl: 0.5 },
  { u: [0.42, -0.28, 0.25], f: [0.2, -0.7, -0.62], h: [0.0, -0.62, 0.7], spread: 0.4, curl: 0.75 },
];

/** 모델이 공유하는 지오메트리 · 재질 묶음 (리그가 만들고 정리한다) */
export interface LimbKit {
  seg: THREE.BufferGeometry; // 육각 절두체 (+y, 아래가 굵다)
  cuff: THREE.BufferGeometry; // 갑옷 띠
  joint: THREE.BufferGeometry; // 각진 관절 덩어리
  claw: THREE.BufferGeometry; // 발톱 (+y)
  spike: THREE.BufferGeometry; // 팔꿈치 · 무릎 가시
  armor: THREE.Material; // 갑옷 (진홍 강철)
  dark: THREE.Material; // 어두운 뼈대
  horn: THREE.Material; // 발톱 색
}

export function makeLimbKit(armor: THREE.Material, dark: THREE.Material, horn: THREE.Material): LimbKit {
  return {
    seg: new THREE.CylinderGeometry(0.62, 1, 1, 6, 1).translate(0, 0.5, 0),
    cuff: new THREE.CylinderGeometry(1.2, 1.34, 1, 6, 1).translate(0, 0.5, 0),
    joint: new THREE.IcosahedronGeometry(1, 0),
    claw: spike(1, 0.16, 4),
    spike: spike(1, 0.3, 4),
    armor,
    dark,
    horn,
  };
}

export interface LimbFrame {
  c: V3;
  R: V3;
  U: V3;
  T: V3;
  rad: number;
}

const NP = 11; // u3 f3 h3 spread curl

function packPose(p: PoseSpec, out: Float32Array, side: number) {
  const put = (o: number, d: D3) => {
    const l = Math.hypot(d[0], d[1], d[2]);
    out[o] = (d[0] / l) * side;
    out[o + 1] = d[1] / l;
    out[o + 2] = d[2] / l;
  };
  put(0, p.u);
  put(3, p.f);
  put(6, p.h);
  out[9] = p.spread;
  out[10] = p.curl;
}

export class DragonLimb {
  readonly joints: V3[] = [new V3(), new V3(), new V3(), new V3()];
  private target = new Float32Array(NP);
  private cur = new Float32Array(NP);
  private vel = new Float32Array(NP);
  private stiff = 120;
  private gaitOn = false;
  private gaitPhase = 0;
  private gaitKeys: Float32Array[] = [];
  private name = '';
  private meshes: THREE.Mesh[] = [];

  private seg: THREE.Mesh[] = [];
  private cuffs: THREE.Mesh[] = [];
  private jointMesh: THREE.Mesh[] = [];
  private pauldron: THREE.Mesh;
  private kneeSpike: THREE.Mesh;
  private toeSeg: THREE.Mesh[][] = [];
  private claws: THREE.Mesh[] = [];

  /* 치수 */
  private L: number[];
  private R: number[];
  private digitL: number[];
  private digitR: number[];
  private spacing: number;
  private clawS: number;

  private d1 = new V3();
  private d2 = new V3();
  private d3 = new V3();
  private lat = new V3();
  private pn = new V3();
  private a = new V3();
  private b = new V3();
  private t1 = new V3();
  private t2 = new V3();
  private q = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private sc = new V3();
  private pos = new V3();
  private mT = new V3();
  private mC = new V3();

  constructor(private group: THREE.Group, private kit: LimbKit, readonly side: number, readonly fore: boolean) {
    const f = fore;
    this.L = f ? [9.6, 10.2, 4.6] : [10.5, 11, 6.8];
    this.R = f ? [2.6, 1.8, 1.4] : [3.6, 2.2, 1.5];
    this.digitL = f ? [4.6, 3.6, 2.8] : [4.8, 3.7, 2.8];
    this.digitR = f ? [0.85, 0.62, 0.46] : [1.05, 0.8, 0.58];
    this.spacing = f ? 1.3 : 1.6;
    this.clawS = f ? 2.3 : 2.7;

    const add = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const me = new THREE.Mesh(g, m);
      me.castShadow = true;
      me.frustumCulled = false;
      this.group.add(me);
      this.meshes.push(me);
      return me;
    };
    for (let i = 0; i < (f ? 3 : 5); i++) this.seg.push(add(kit.seg, kit.armor));
    for (let i = 0; i < (f ? 6 : 8); i++) this.cuffs.push(add(kit.cuff, kit.armor));
    for (let i = 0; i < 3; i++) this.jointMesh.push(add(kit.joint, kit.dark));
    this.pauldron = add(kit.joint, kit.armor);
    this.kneeSpike = add(kit.spike, kit.horn);
    for (let k = 0; k < 4; k++) {
      this.toeSeg.push([0, 1, 2].map(() => add(kit.seg, kit.dark)));
      this.claws.push(add(kit.claw, kit.horn));
    }
    for (const g of GAIT) {
      const arr = new Float32Array(NP);
      packPose(g, arr, side);
      this.gaitKeys.push(arr);
    }
    this.setPose(f ? 'tuck' : 'trail', true);
  }

  /** 달리기 모드: 뒷다리가 위상에 맞춰 네 발 짐승처럼 구른다 */
  setGait(on: boolean, phase: number) {
    if (this.fore) return;
    if (!on && this.gaitOn) this.name = ''; // 끝나면 원래 포즈를 다시 적용
    this.gaitOn = on;
    this.gaitPhase = phase;
  }

  setPose(name: ArmPose | LegPose, snap = false) {
    if (name === this.name && !snap) return;
    this.name = name;
    const spec = this.fore ? ARM[name as ArmPose] : LEG[name as LegPose];
    if (!spec) return;
    packPose(spec, this.target, this.side);
    this.stiff = spec.stiff ?? 130;
    if (snap) {
      this.cur.set(this.target);
      this.vel.fill(0);
    }
  }

  /** 포즈 스프링을 풀고 관절 위치를 구해 메시를 놓는다 */
  update(dt: number, fr: LimbFrame, t: number, groundY = 0.3) {
    if (this.gaitOn) {
      const ph = (this.gaitPhase + (this.side < 0 ? 0.1 : 0)) % 1;
      const x = ph * 4;
      const i0 = Math.floor(x) % 4;
      const i1 = (i0 + 1) % 4;
      const w = 0.5 - 0.5 * Math.cos(Math.PI * (x - Math.floor(x)));
      const A = this.gaitKeys[i0];
      const B = this.gaitKeys[i1];
      for (let i = 0; i < NP; i++) this.target[i] = A[i] + (B[i] - A[i]) * w;
      this.stiff = 320;
    }
    // 스프링 (약간 덜 감쇠 → 팍 하고 자리잡으며 살짝 되튄다)
    const k = this.stiff;
    const c = 2 * 0.74 * Math.sqrt(k);
    let left = Math.min(dt, 0.1);
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      for (let i = 0; i < NP; i++) {
        const acc = k * (this.target[i] - this.cur[i]) - c * this.vel[i];
        this.vel[i] += acc * h;
        this.cur[i] += this.vel[i] * h;
      }
      left -= h;
    }
    const s = this.side;
    const cu = this.cur;
    const local = (o: number, out: V3) => {
      // 저장된 x 는 이미 side 가 곱해져 있다 → 바깥 = R * x
      out.set(fr.R.x * cu[o] + fr.U.x * cu[o + 1] + fr.T.x * cu[o + 2], fr.R.y * cu[o] + fr.U.y * cu[o + 1] + fr.T.y * cu[o + 2], fr.R.z * cu[o] + fr.U.z * cu[o + 1] + fr.T.z * cu[o + 2]);
      return out.normalize();
    };
    const d1 = local(0, this.d1);
    const d2 = local(3, this.d2);
    const d3 = local(6, this.d3);
    const spread = Math.min(1, Math.max(0, cu[9]));
    const curl = Math.min(1.1, Math.max(0, cu[10]));

    // 숨쉴 때 어깨가 살짝 오르내린다 (흔들림이 아니라 호흡)
    const breath = Math.sin(t * 2.2 + s) * 0.05;
    const j = this.joints;
    j[0]
      .copy(fr.c)
      .addScaledVector(fr.R, s * fr.rad * 0.8)
      .addScaledVector(fr.U, -fr.rad * (this.fore ? 0.3 : 0.5) + breath);
    j[1].copy(j[0]).addScaledVector(d1, this.L[0]);
    j[2].copy(j[1]).addScaledVector(d2, this.L[1]);
    j[3].copy(j[2]).addScaledVector(d3, this.L[2]);
    for (let i = 1; i < 4; i++) if (j[i].y < groundY) j[i].y = groundY;

    if (this.fore) {
      this.setSeg(this.seg[0], j[0], j[1], this.R[0]);
      this.setSeg(this.seg[1], j[1], j[2], this.R[1]);
    } else {
      // 뒷다리: 허벅지 2파츠(굵은 윗부분 + 가는 아랫부분), 종아리 2파츠(불룩한 윗부분 + 가는 아랫부분).
      // 각 파츠는 곧은 막대라 휘지 않고, 꺾이는 곳은 다리 전체(엉덩이) · 무릎 · 발목뿐이다.
      this.mT.lerpVectors(j[0], j[1], 0.5);
      this.mC.lerpVectors(j[1], j[2], 0.5);
      this.setSeg(this.seg[0], j[0], this.mT, this.R[0]);
      this.setSeg(this.seg[3], this.mT, j[1], this.R[0] * 0.69);
      this.setSeg(this.seg[1], j[1], this.mC, this.R[1] * 1.25);
      this.setSeg(this.seg[4], this.mC, j[2], this.R[1] * 0.7);
    }
    this.setSeg(this.seg[2], j[2], j[3], this.R[2]);
    // 갑옷 띠
    const cuffAt = (idx: number, a: V3, b: V3, r: number, t0: number, len: number) => {
      const m = this.cuffs[idx];
      this.pos.lerpVectors(a, b, t0);
      this.t1.subVectors(b, a);
      const L = this.t1.length();
      if (L < 1e-4) return;
      this.t1.multiplyScalar(1 / L);
      m.position.copy(this.pos);
      m.quaternion.setFromUnitVectors(UP, this.t1);
      const rr = r * (1 - 0.38 * t0) * 0.98;
      m.scale.set(rr, L * len, rr);
    };
    cuffAt(0, j[0], j[1], this.R[0], 0.12, 0.3);
    cuffAt(2, j[1], j[2], this.R[1], 0.1, 0.32);
    if (this.fore) {
      cuffAt(1, j[0], j[1], this.R[0], 0.55, 0.22);
      cuffAt(3, j[1], j[2], this.R[1], 0.56, 0.24);
    } else {
      this.cuffs[1].scale.set(0, 0, 0);
      this.cuffs[3].scale.set(0, 0, 0);
      // 파츠 이음매 띠 (허벅지 · 종아리)
      const seam = (idx: number, a: V3, b: V3, at: V3, rr: number) => {
        const m = this.cuffs[idx];
        this.t1.subVectors(b, a).normalize();
        m.position.copy(at).addScaledVector(this.t1, -0.5);
        m.quaternion.setFromUnitVectors(UP, this.t1);
        m.scale.set(rr, 1, rr);
      };
      seam(6, j[0], j[1], this.mT, this.R[0] * 0.56);
      seam(7, j[1], j[2], this.mC, this.R[1] * 0.64);
    }
    cuffAt(4, j[2], j[3], this.R[2], 0.1, 0.5);
    cuffAt(5, j[2], j[3], this.R[2], 0.7, 0.26);

    // 관절 덩어리
    const jm = (m: THREE.Mesh, p: V3, r: number) => {
      m.position.copy(p);
      m.scale.setScalar(r);
      m.rotation.set(p.x * 0.3, p.z * 0.3, 0);
    };
    jm(this.jointMesh[0], j[1], this.R[1] * 1.28);
    jm(this.jointMesh[1], j[2], this.R[2] * 1.3);
    jm(this.jointMesh[2], j[3], this.digitR[0] * 1.5);
    // 어깨 · 엉덩이 갑옷 덩어리 (몸통과 이어 주는 큼직한 각진 덩어리)
    this.pauldron.position.copy(j[0]).addScaledVector(d1, this.L[0] * 0.1);
    this.pauldron.scale.set(this.R[0] * 1.55, this.R[0] * 1.3, this.R[0] * 1.8);
    this.t1.copy(fr.T);
    this.pauldron.quaternion.setFromUnitVectors(new V3(0, 0, 1), this.t1);
    // 팔꿈치 · 무릎 가시: 관절이 꺾이는 바깥쪽으로
    this.t1.copy(d1).sub(d2);
    if (this.t1.lengthSq() < 0.02) this.t1.copy(fr.U);
    this.t1.normalize();
    this.kneeSpike.position.copy(j[1]);
    this.kneeSpike.quaternion.setFromUnitVectors(UP, this.t1);
    this.kneeSpike.scale.setScalar(this.fore ? 2.2 : 3.6);

    // 손가락 · 발가락
    this.lat.copy(fr.R).multiplyScalar(s);
    this.lat.addScaledVector(d3, -this.lat.dot(d3));
    if (this.lat.lengthSq() < 1e-4) this.lat.copy(fr.T).addScaledVector(d3, -fr.T.dot(d3));
    this.lat.normalize();
    // 쥐는 방향 = 손바닥 쪽 (cross(lat, h) 에 side 를 곱한다)
    this.pn.crossVectors(this.lat, d3).multiplyScalar(s).normalize();
    for (let kd = 0; kd < 4; kd++) {
      const thumb = kd === 0;
      const lenK = thumb ? 0.72 : kd === 2 ? 1.08 : 1;
      const ang = spread * (kd - 1.5) * 0.36 + (thumb ? -0.14 * spread : 0);
      // 발 · 손바닥 위의 시작점
      this.a.copy(j[3]).addScaledVector(this.lat, (kd - 1.5) * this.spacing * (0.55 + 0.45 * spread));
      // 방향: 손 방향을 벌림각만큼 옆으로 틀고, 마디마다 손바닥 쪽으로 더 말린다
      this.b.copy(d3).multiplyScalar(Math.cos(ang)).addScaledVector(this.lat, Math.sin(ang));
      const cl = curl * (0.9 + 0.07 * kd);
      let prev = this.a;
      for (let sI = 0; sI < 3; sI++) {
        const th = cl * (0.42 + sI * 0.55) * (thumb ? 1.1 : 1);
        this.t1.copy(this.b).multiplyScalar(Math.cos(th)).addScaledVector(this.pn, Math.sin(th));
        const L = this.digitL[sI] * lenK;
        this.t2.copy(prev).addScaledVector(this.t1, L);
        if (this.t2.y < groundY * 0.7) this.t2.y = groundY * 0.7;
        this.setSeg(this.toeSeg[kd][sI], prev, this.t2, this.digitR[sI] * (thumb ? 1.1 : 1));
        if (sI === 2) {
          // 발톱: 마지막 마디보다 한 번 더 굽어서 갈고리처럼
          const th2 = th + 0.55;
          this.t1.copy(this.b).multiplyScalar(Math.cos(th2)).addScaledVector(this.pn, Math.sin(th2));
          const cm = this.claws[kd];
          cm.position.copy(this.t2);
          cm.quaternion.setFromUnitVectors(UP, this.t1);
          const cs = this.clawS * (thumb ? 0.85 : 1);
          cm.scale.set(cs, cs * 1.25, cs);
        }
        // 다음 마디의 시작점은 이 끝점
        if (sI < 2) {
          this.a.copy(this.t2);
          prev = this.a;
        }
      }
    }
  }

  private setSeg(m: THREE.Mesh, a: V3, b: V3, r: number) {
    this.t1.subVectors(b, a);
    const L = this.t1.length();
    m.position.copy(a);
    if (L < 1e-4) {
      m.scale.set(0, 0, 0);
      return;
    }
    this.t1.multiplyScalar(1 / L);
    m.quaternion.setFromUnitVectors(UP, this.t1);
    m.scale.set(r, L, r);
  }

  /** 손(발) 끝 위치: 이펙트용 */
  tip(out: V3) {
    return out.copy(this.joints[3]);
  }

  setVisible(v: boolean) {
    for (const m of this.meshes) m.visible = v;
  }
}
