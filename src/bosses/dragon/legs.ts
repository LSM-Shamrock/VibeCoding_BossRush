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
// 옆 방향 기준, 양수 = 앞쪽. 앞에서 볼 때만 ㄱ자가 되던 다리를 머리 쪽 안쪽으로 45° 돌려, 옆에서도 ㄱ자로 보이게 했다
const TURN = Math.PI / 4;
const HOME_ANGLE = [0.5 + TURN, 0.5 + TURN, -0.35 + TURN, -0.35 + TURN];
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
  private paws: THREE.Group[] = [];
  private clawMat: THREE.MeshStandardMaterial;
  private pawGeos: THREE.BufferGeometry[] = [];
  private mb = new THREE.Matrix4();
  private bx = new V3();
  private bz = new V3();
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
    this.clawMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc2, emissive: 0x1a1608, roughness: 0.6, metalness: 0.1, flatShading: true });
    const toeGeo = new THREE.CylinderGeometry(0.5, 0.8, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2); // +Z 방향
    const clawGeo = new THREE.ConeGeometry(0.8, 1, 5).translate(0, 0.5, 0).rotateX(Math.PI / 2);
    const palmGeo = new THREE.CylinderGeometry(0.85, 1, 1, 8); // 위아래가 평평
    this.pawGeos.push(toeGeo, clawGeo, palmGeo);
    for (let i = 0; i < LEG_COUNT; i++) {
      this.paws.push(this.buildPaw(palmGeo, toeGeo, clawGeo));
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

  /** 손발: 손바닥 + 발가락 4개(마디 2개) + 발톱. 로컬: +Z 앞, +Y 위 */
  private buildPaw(palmGeo: THREE.BufferGeometry, toeGeo: THREE.BufferGeometry, clawGeo: THREE.BufferGeometry) {
    const g = new THREE.Group();
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.frustumCulled = false;
      parent.add(m);
      return m;
    };
    const palm = mk(palmGeo, this.legMat, g);
    palm.scale.set(3.6, 1.7, 4.4);
    palm.position.y = 0.85; // 밑면이 평평하고 발끝 높이(y=0)에 닿는다
    // 앞발톱 3개 + 뒷발톱 1개. 발가락은 그루터기만 남기고 발톱이 튀어나온다. 아래로 말리지 않고 수평으로 뻗는다.
    const claw = (x: number, z: number, yaw: number, stub: number, clawLen: number) => {
      const dg = new THREE.Group();
      dg.position.set(x, 1.2, z);
      dg.rotation.y = yaw;
      g.add(dg);
      mk(toeGeo, this.legMat, dg).scale.set(1.5, 1.5, stub);
      const cl = new THREE.Group();
      cl.position.z = stub;
      dg.add(cl);
      mk(clawGeo, this.clawMat, cl).scale.set(1.3, 1.3, clawLen);
    };
    for (let k = -1; k <= 1; k++) claw(k * 2.5, 3.5, -k * (5 * Math.PI / 180), 1.6, 3.6); // 바깥 발가락을 안쪽으로 5° 모은다
    claw(0, -3.4, Math.PI, 1.2, 3.2);
    g.scale.setScalar(0.75);
    this.group.add(g);
    return g;
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
      // 손발: 발끝에 놓고, 몸 앞쪽을 향해 바닥과 나란히 편다
      const paw = this.paws[i];
      paw.position.copy(this.end);
      this.bz.copy(f.T);
      this.bz.y = 0;
      if (this.bz.lengthSq() < 1e-6) this.bz.set(0, 0, 1);
      this.bz.normalize();
      this.bx.set(0, 1, 0).cross(this.bz);
      this.mb.makeBasis(this.bx, this.tmp.set(0, 1, 0), this.bz);
      paw.quaternion.setFromRotationMatrix(this.mb);
    }
  }

  setVisible(v: boolean) {
    for (const m of [...this.upper, ...this.lower, ...this.knees]) m.visible = v;
    for (const p of this.paws) p.visible = v;
  }

  dispose() {
    for (const m of [...this.upper, ...this.lower, ...this.knees]) this.group.remove(m);
    for (const p of this.paws) this.group.remove(p);
    for (const g of [...this.geos, ...this.pawGeos]) g.dispose();
    this.clawMat.dispose();
    this.legMat.dispose();
    this.kneeMat.dispose();
  }
}
