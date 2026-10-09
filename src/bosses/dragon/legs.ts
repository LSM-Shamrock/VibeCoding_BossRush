import * as THREE from 'three';
import { Gait } from '../../procedural/gait';
import { solveTwoBone, placeSegment } from '../../procedural/legIK';

const V3 = THREE.Vector3;
type V3 = THREE.Vector3;

/**
 * 용의 다리 4개 = 거미 보스 다리(bosses/spider/rig.ts)의 메커니즘을 그대로 가져온 것.
 *  · 다리 하나 = 윗다리 + 아랫다리 + 무릎 구슬 (원통 2개 + 구 1개), 2본 IK (solveTwoBone) 로 푼다.
 *  · 발은 월드에 고정(planted)돼 있다가, 몸이 움직여 홈에서 멀어지면 Gait 가 호를 그리며 옮겨 디딘다 (대각선 두 다리씩 한 조).
 *  · 무릎은 위 + 바깥으로 튀어나온다.
 * 거미와 다른 점은 숫자(크기 · 굵기 · 색)뿐이다. 거미는 땅 위에 서 있지만 용은 하늘에 떠 있으므로,
 * 발의 "홈"을 땅 대신 몸 기준 아래쪽 지점으로 잡았다. (몸이 위아래로 움직이면 고정된 발도 같이 따라 움직인다)
 */

/** 거미 대비 배율 */
const KL = 4.5; // 길이 (원통)
const KT = 16.0; // 굵기 (원통)
const KS = 8.0; // 무릎 구슬 (그대로)
// 거미 값 그대로: L1 2.6, L2 4.7, 윗다리 굵기 0.3, 아랫다리 0.27, 무릎 구 0.4
const L1 = 2.6 * KL;
const L2 = 4.7 * KL;
const UP_T = 0.3 * KT;
const LO_T = 0.27 * KT;
const KNEE_R = KS;

const LEG_COUNT = 4;
// 앞다리 2 · 뒷다리 2. 대각선끼리 한 조 (거미의 [0,1,0,1,1,0,1,0] 와 같은 대각선 규칙)
const GROUPS = [0, 1, 1, 0];
const SIDE = [1, -1, 1, -1];
const FORE = [true, true, false, false];
const HOME_ANGLE = [0.5, 0.5, -0.35, -0.35]; // 옆 방향 기준, 양수 = 앞쪽 (거미의 HOME_ANGLE 과 같은 의미)
const HOME_R = 15;
const HOME_DROP = 18;

export interface LegFrame {
  c: V3;
  R: V3;
  U: V3;
  T: V3;
  rad: number;
}

export class DragonLegs {
  private gait = new Gait(LEG_COUNT, GROUPS);
  private homes: V3[] = [];
  private upper: THREE.Mesh[] = [];
  private lower: THREE.Mesh[] = [];
  private knees: THREE.Mesh[] = [];
  private hipPrev: V3[] = [];
  private legMat: THREE.MeshStandardMaterial;
  private kneeMat: THREE.MeshStandardMaterial;
  private geos: THREE.BufferGeometry[];
  private inited = false;
  private stance = 1;
  private prevC: V3[] = [new V3(), new V3()];

  private hip = new V3();
  private knee = new V3();
  private end = new V3();
  private foot = new V3();
  private pole = new V3();
  private vel = new V3();
  private tmp = new V3();

  constructor(private group: THREE.Group) {
    const upperGeo = new THREE.CylinderGeometry(0.8, 1, 1, 7);
    const lowerGeo = new THREE.CylinderGeometry(0.34, 0.9, 1, 7);
    const kneeGeo = new THREE.SphereGeometry(0.4, 9, 7);
    this.geos = [upperGeo, lowerGeo, kneeGeo];
    // 색만 용에 맞춰 바꿨다 (거미: 0x35160e / 무릎 0xc08a34)
    this.legMat = new THREE.MeshStandardMaterial({ color: 0x6a1a12, emissive: 0x3a0c06, roughness: 0.74, metalness: 0.08, flatShading: true });
    this.kneeMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, emissive: 0x4a2806, roughness: 0.74, metalness: 0.08, flatShading: true });
    for (let i = 0; i < LEG_COUNT; i++) {
      this.homes.push(new V3());
      this.hipPrev.push(new V3());
      const up = new THREE.Mesh(upperGeo, this.legMat);
      const lo = new THREE.Mesh(lowerGeo, this.legMat);
      const kn = new THREE.Mesh(kneeGeo, this.kneeMat);
      for (const m of [up, lo, kn]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        group.add(m);
      }
      this.upper.push(up);
      this.lower.push(lo);
      this.knees.push(kn);
    }
  }

  /** fore: 앞다리 몸통 프레임, hind: 뒷다리 몸통 프레임. lie: 쓰러져 바닥에 엎드림 */
  update(dt: number, fore: LegFrame, hind: LegFrame, lie: boolean) {
    // 엎드리면 발이 사방으로 퍼진다 (거미의 stagger 와 같은 발상)
    this.stance += ((lie ? 1.4 : 1) - this.stance) * Math.min(1, dt * 6);

    // 몸 속도 (XZ) — 거미의 vel 과 같은 용도
    this.vel.set(0, 0, 0);
    if (dt > 1e-5 && this.inited) {
      this.vel.set((fore.c.x - this.prevC[0].x) / dt, 0, (fore.c.z - this.prevC[0].z) / dt);
    }
    this.prevC[0].copy(fore.c);

    // 홈 위치: 몸 기준 옆 · 앞 · 아래
    const hips: V3[] = [];
    for (let i = 0; i < LEG_COUNT; i++) {
      const f = FORE[i] ? fore : hind;
      const s = SIDE[i];
      const hip = new V3().copy(f.c).addScaledVector(f.R, s * f.rad * 0.8).addScaledVector(f.U, -f.rad * (FORE[i] ? 0.3 : 0.5));
      hips.push(hip);
      const a = HOME_ANGLE[i];
      const r = HOME_R * this.stance;
      this.homes[i]
        .copy(hip)
        .addScaledVector(f.R, s * r * Math.cos(a))
        .addScaledVector(f.T, r * Math.sin(a));
      this.homes[i].y = Math.max(0.3, hip.y - HOME_DROP);
    }

    if (!this.inited) {
      this.gait.snap(this.homes);
      for (let i = 0; i < LEG_COUNT; i++) this.hipPrev[i].copy(hips[i]);
      this.inited = true;
    }
    // 너무 멀리 떨어졌으면(등장 · 순간이동) 걸음 대신 즉시 놓는다
    for (let i = 0; i < LEG_COUNT; i++) {
      const fx = this.gait.feet[i].x - this.homes[i].x;
      const fz = this.gait.feet[i].z - this.homes[i].z;
      if (Math.hypot(fx, fz) > 45) {
        this.gait.snap(this.homes);
        break;
      }
    }

    this.gait.update(dt, this.homes, this.vel, {
      threshold: 1.25 * KL,
      stepTime: Math.max(0.12, 0.2 - Math.hypot(this.vel.x, this.vel.z) * 0.012),
      lift: 1.05 * KL,
      lead: 0.12,
    });

    for (let i = 0; i < LEG_COUNT; i++) {
      const f = FORE[i] ? fore : hind;
      const s = SIDE[i];
      const hip = hips[i];
      // 하늘에는 땅이 없으니, 박힌 발도 몸이 오르내린 만큼 같이 오르내린다
      if (!this.gait.isStepping(i)) this.gait.feet[i].y = Math.max(0.3, this.gait.feet[i].y + (hip.y - this.hipPrev[i].y));
      this.hipPrev[i].copy(hip);

      this.gait.get(i, this.foot);

      // 무릎은 위 + 바깥으로 튀어나온다
      const a = HOME_ANGLE[i];
      this.pole
        .copy(f.R)
        .multiplyScalar(s * Math.cos(a))
        .addScaledVector(f.T, Math.sin(a));
      this.pole.y = 0;
      if (this.pole.lengthSq() < 1e-6) this.pole.set(s, 0, 0);
      this.pole.normalize().multiplyScalar(0.45);
      this.pole.y = 1;

      this.hip.copy(hip);
      solveTwoBone(this.hip, this.foot, L1, L2, this.pole, this.knee, this.end);
      placeSegment(this.upper[i], this.hip, this.knee, UP_T);
      placeSegment(this.lower[i], this.knee, this.end, LO_T);
      this.knees[i].position.copy(this.knee);
      this.knees[i].scale.setScalar(KNEE_R);
    }
    void this.tmp;
  }

  setVisible(v: boolean) {
    for (const m of [...this.upper, ...this.lower, ...this.knees]) m.visible = v;
  }

  dispose() {
    for (const m of [...this.upper, ...this.lower, ...this.knees]) this.group.remove(m);
    for (const g of this.geos) g.dispose();
    this.legMat.dispose();
    this.kneeMat.dispose();
  }
}
