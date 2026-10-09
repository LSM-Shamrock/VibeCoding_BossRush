import * as THREE from 'three';
import { CFG } from '../../config';
import { Gait } from '../../procedural/gait';
import { PoseBlend } from '../../procedural/pose';
import { solveTwoBone, placeSegment, distPointSegment } from '../../procedural/legIK';
import { WORLD } from '../../world';

const V3 = THREE.Vector3;
const S = CFG.spider;

/* ───────────────────────── 포즈 ───────────────────────── */
export type PoseKey = 'height' | 'pitch' | 'abdomen' | 'stance' | 'frontRaise' | 'squash' | 'tremble' | 'legFollow' | 'abdPulse';

const IDLE: Record<PoseKey, number> = {
  height: 2.3, // 몸통 높이
  pitch: 0, // 음수 = 앞을 들어올림(뒷발로 섬)
  abdomen: 0.14, // 양수 = 배를 치켜듦
  stance: 1, // 발 위치 반경 배율
  frontRaise: 0, // 앞다리 2개를 허공으로 듦
  squash: 1, // 세로 압축/늘림
  tremble: 0, // 부들부들 떠는 정도
  legFollow: 0, // 1 = 발이 땅을 떠나 몸 아래로 접힘(공중)
  abdPulse: 0, // 배가 꿀렁이는 정도(알 낳기)
};

/** 이름 붙은 포즈. IDLE 위에 덮어쓴다. 공격 스크립트는 setPose('crouch') 처럼 부르기만 하면 된다. */
export const POSES = {
  idle: {},
  webWind: { height: 2.85, pitch: -0.45, frontRaise: 1, tremble: 0.03 }, // 앞다리를 들고 몸을 뒤로 젖힘
  crouch: { height: 1.2, stance: 0.82, squash: 0.86, abdomen: 0.32, tremble: 0.05 }, // 도약 직전 웅크림
  air: { height: 2.0, legFollow: 1, squash: 1.08, pitch: -0.25, abdomen: 0.2 }, // 공중: 다리를 접음
  splay: { height: 1.05, stance: 1.38, abdomen: -0.06, squash: 0.92 }, // 착지: 다리가 사방으로 퍼지고 배가 바닥에 닿음
  barrage: { height: 2.6, pitch: 0.14, abdomen: 1.05, tremble: 0.07 }, // 배를 치켜듦
  eggs: { height: 1.85, abdomen: -0.14, abdPulse: 1, tremble: 0.035, stance: 1.1 }, // 배가 꿀렁임
  rear: { height: 3.05, pitch: -0.75, frontRaise: 1, abdomen: 0.35, stance: 1.05 }, // 포효: 뒷발로 일어섬
  stagger: { height: 0.95, stance: 1.42, abdomen: -0.12, squash: 0.96 }, // 휘청: 납작 엎드림
} satisfies Record<string, Partial<Record<PoseKey, number>>>;
export type PoseName = keyof typeof POSES;

/* ───────────────────────── 구조 상수 ───────────────────────── */
const L1 = 2.6; // 윗다리
const L2 = 4.7; // 아랫다리
const HIP_Z = [0.82, 0.28, -0.28, -0.82];
const HOME_ANGLE = [0.95, 0.4, -0.2, -0.72]; // 옆 방향 기준, 양수 = 앞쪽
const HOME_R = [5.0, 5.5, 5.5, 5.1];
const LEG_COUNT = 8;

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  r: number;
  rest: boolean;
}

function mat(color: number, emissive = 0x000000) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.74, metalness: 0.08, flatShading: true });
  m.userData.baseEmissive = new THREE.Color(emissive); // 피격 플래시 후 되돌아갈 값
  return m;
}

/**
 * 거미 리그 — 구/원통/원뿔만으로 만든 몸 + 다리 8개(2본 IK + 발걸음) + 포즈 블렌딩.
 *
 *  · root        위치(XZ + 점프 높이) / 방향(yaw). 앞 = (sin yaw, cos yaw)
 *  · body        높이·기울기·압축을 포즈로 받는 몸통 그룹
 *  · abdPivot    배를 치켜드는 관절
 *  · legsGroup   월드 좌표에서 직접 그리는 다리 메시 (IK 결과를 월드로 받기 때문)
 */
export class SpiderRig {
  readonly root = new THREE.Group();
  readonly pose = new PoseBlend<PoseKey>(IDLE, 8);
  readonly vel = new V3();
  yaw = 0;

  /** 판정용 원 (월드 XZ) */
  readonly thorax = { x: 0, y: 2, z: 0, r: S.thoraxR };
  readonly abdomenC = { x: 0, y: 2, z: 0, r: S.abdomenR };

  private body = new THREE.Group();
  private abdPivot = new THREE.Group();
  private abdomen = new THREE.Group();
  private legsGroup = new THREE.Group();

  private gait = new Gait(LEG_COUNT, [0, 1, 0, 1, 1, 0, 1, 0]);
  private hipLocal: THREE.Vector3[] = [];
  private homeLocal: THREE.Vector3[] = [];
  private homes: THREE.Vector3[] = [];
  private side: number[] = [];

  // 다리 메시 / 판정용 선분
  private upper: THREE.Mesh[] = [];
  private lower: THREE.Mesh[] = [];
  private knees: THREE.Mesh[] = [];
  private legMats: THREE.MeshStandardMaterial[] = [];
  private kneeMats: THREE.MeshStandardMaterial[] = [];
  private legFlash: number[] = [];
  private segHip: THREE.Vector3[] = [];
  private segKnee: THREE.Vector3[] = [];
  private segEnd: THREE.Vector3[] = [];

  // 재질
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private thoraxMats: THREE.MeshStandardMaterial[] = [];
  private abdMats: THREE.MeshStandardMaterial[] = [];
  private thoraxFlash = 0;
  private abdFlash = 0;
  private eyeMats: THREE.MeshBasicMaterial[] = [];
  private sacMat = new THREE.MeshBasicMaterial({ color: 0xffa020, toneMapped: false });
  private rage = false;
  private rageLevel = 1;
  private exposed = false;

  private gaitPhase = 0;
  private t = 0;
  private bodyMeshes: THREE.Mesh[] = [];
  private debris: Debris[] = [];
  exploded = false;

  // 스크래치
  private hipW = new V3();
  private kneeW = new V3();
  private endW = new V3();
  private foot = new V3();
  private pole = new V3();
  private tmp = new V3();

  constructor(private scene: THREE.Scene) {
    this.buildBody();
    this.buildLegs();
    this.root.add(this.body);
    scene.add(this.root);
    scene.add(this.legsGroup);

    this.root.position.set(S.start.x, 0, S.start.z);
    this.syncBody(0);
    this.computeHomes(1);
    this.gait.snap(this.homes);
    this.solveLegs(0);
  }

  get pos() {
    return this.root.position;
  }

  /* ───────────────────────── 모델 조립 ───────────────────────── */
  private buildBody() {
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.bodyMeshes.push(mesh);
      return mesh;
    };
    const bm = (color: number, emissive = 0x000000, group: 'thorax' | 'abd' = 'thorax') => {
      const m = mat(color, emissive);
      this.bodyMats.push(m);
      (group === 'thorax' ? this.thoraxMats : this.abdMats).push(m);
      return m;
    };

    // 머리가슴 + 머리
    add(this.body, new THREE.SphereGeometry(1.3, 14, 10).scale(1, 0.85, 1.15), bm(0x4a1c16, 0x1a0604), 0, 0, 0);
    add(this.body, new THREE.SphereGeometry(0.85, 12, 9).scale(1, 0.9, 1), bm(0x5c2418, 0x200806), 0, 0.12, 1.35);

    // 눈: 큰 눈 2 + 작은 눈 6 (평소 황금색, 페이즈 2에서 붉게 변함)
    const eyeM = new THREE.MeshBasicMaterial({ color: 0xffc83a, toneMapped: false });
    this.eyeMats.push(eyeM);
    const eyeGeoBig = new THREE.SphereGeometry(0.2, 10, 8);
    const eyeGeoSm = new THREE.SphereGeometry(0.11, 8, 6);
    for (const sx of [-1, 1]) {
      add(this.body, eyeGeoBig, eyeM, sx * 0.34, 0.42, 2.06).castShadow = false;
      add(this.body, eyeGeoSm, eyeM, sx * 0.62, 0.38, 1.86).castShadow = false;
      add(this.body, eyeGeoSm, eyeM, sx * 0.24, 0.72, 1.92).castShadow = false;
      add(this.body, eyeGeoSm, eyeM, sx * 0.7, 0.14, 1.74).castShadow = false;
    }

    // 송곳니 + 촉수
    const fangM = bm(0xcfc4a8, 0x1a1608);
    for (const sx of [-1, 1]) {
      const fang = add(this.body, new THREE.ConeGeometry(0.15, 0.95, 7), fangM, sx * 0.3, -0.55, 2.1);
      fang.rotation.x = Math.PI - 0.35;
      const palp = add(this.body, new THREE.CylinderGeometry(0.1, 0.14, 0.9, 6), bm(0x3a1812), sx * 0.72, -0.25, 2.1);
      palp.rotation.x = 1.1;
    }

    // 배 (치켜드는 관절 → 배 그룹)
    this.abdPivot.position.set(0, 0.25, -1.0);
    this.body.add(this.abdPivot);
    this.abdomen.position.set(0, 0.35, -2.3);
    this.abdPivot.add(this.abdomen);
    const abdM = bm(0x7c2218, 0x2a0a06, 'abd');
    add(this.abdomen, new THREE.SphereGeometry(1.9, 16, 12).scale(1, 0.9, 1.25), abdM, 0, 0, 0);

    // 약점: 등을 따라 이어진 발광 주머니 (후딜에는 금색으로 밝아짐)
    add(this.abdomen, new THREE.SphereGeometry(0.55, 12, 9), this.sacMat, 0, 1.52, -0.6).castShadow = false;
    add(this.abdomen, new THREE.SphereGeometry(0.46, 12, 9), this.sacMat, 0, 1.08, -1.85).castShadow = false;
    add(this.abdomen, new THREE.SphereGeometry(0.4, 12, 9), this.sacMat, 0, 1.58, 0.55).castShadow = false;

    // 등 가시 (실루엣용)
    const spikeM = bm(0x1c0c08, 0x000000, 'abd');
    const A = 1.9;
    const B = 1.71;
    const C = 2.375;
    for (const [px, py, pz] of [
      [0.9, 1.23, -1.2],
      [1.0, 1.44, 0.3],
      [0.5, 0.8, -2.0],
      [1.25, 0.9, -0.55],
    ] as const) {
      for (const sx of [-1, 1]) {
        const spike = add(this.abdomen, new THREE.ConeGeometry(0.17, 0.75, 6), spikeM, sx * px, py, pz);
        const n = new V3((sx * px) / (A * A), py / (B * B), pz / (C * C)).normalize();
        spike.quaternion.setFromUnitVectors(new V3(0, 1, 0), n);
        spike.position.addScaledVector(n, 0.25);
      }
    }
    // 실젖(뒤쪽 돌기)
    for (const sx of [-1, 1]) {
      const sp = add(this.abdomen, new THREE.ConeGeometry(0.2, 0.7, 6), spikeM, sx * 0.25, -0.1, -2.5);
      sp.rotation.x = -Math.PI / 2;
    }
  }

  private buildLegs() {
    const upperGeo = new THREE.CylinderGeometry(0.8, 1, 1, 7);
    const lowerGeo = new THREE.CylinderGeometry(0.34, 0.9, 1, 7);
    const kneeGeo = new THREE.SphereGeometry(0.4, 9, 7);
    for (let n = 0; n < LEG_COUNT; n++) {
      const s = n < 4 ? -1 : 1;
      const i = n % 4;
      this.side.push(s);
      this.hipLocal.push(new V3(s * 0.95, 0.05, HIP_Z[i]));
      this.homeLocal.push(new V3(s * HOME_R[i] * Math.cos(HOME_ANGLE[i]), 0, HOME_R[i] * Math.sin(HOME_ANGLE[i])));
      this.homes.push(new V3());
      this.segHip.push(new V3());
      this.segKnee.push(new V3());
      this.segEnd.push(new V3());

      const m = mat(0x35160e, 0x140604);
      const km = mat(0xc08a34, 0x2a1604); // 무릎: 금빛 마디
      this.legMats.push(m);
      this.kneeMats.push(km);
      this.legFlash.push(0);
      const up = new THREE.Mesh(upperGeo, m);
      const lo = new THREE.Mesh(lowerGeo, m);
      const kn = new THREE.Mesh(kneeGeo, km);
      for (const mesh of [up, lo, kn]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.legsGroup.add(mesh);
      }
      this.upper.push(up);
      this.lower.push(lo);
      this.knees.push(kn);
    }
  }

  /* ───────────────────────── 외부 API ───────────────────────── */
  setPose(name: PoseName, rate?: number) {
    this.pose.to({ ...IDLE, ...POSES[name] }, rate);
  }

  /** 보간 없이 즉시 해당 포즈로 */
  snapPose(name: PoseName) {
    this.pose.snap({ ...IDLE, ...POSES[name] });
  }

  /** level: 1 = 분노(페이즈 2), 2 = 광란(페이즈 3) — 눈이 더 빠르게 번쩍인다 */
  setRage(on: boolean, level = 1) {
    this.rage = on;
    this.rageLevel = level;
  }
  setExposed(on: boolean) {
    this.exposed = on;
  }

  /** 맞은 부위만 살짝 번쩍 (자동 사격 중 계속 맞아도 눈이 아프지 않도록 약하게) */
  flashPart(part: 'thorax' | 'abdomen', strength = 1) {
    if (part === 'thorax') this.thoraxFlash = Math.max(this.thoraxFlash, strength);
    else this.abdFlash = Math.max(this.abdFlash, strength);
  }
  flashAll(strength = 1) {
    this.flashPart('thorax', strength);
    this.flashPart('abdomen', strength);
  }
  flashLeg(i: number) {
    this.legFlash[i] = 1;
  }

  /** 입 앞 (거미줄 발사 지점) */
  mouth(out: THREE.Vector3) {
    return this.body.localToWorld(out.set(0, -0.1, 2.5));
  }
  /** 배 끝 (독침 발사 지점) */
  muzzle(out: THREE.Vector3) {
    return this.abdomen.localToWorld(out.set(0, 0.1, -2.5));
  }
  abdomenWorld(out: THREE.Vector3) {
    return this.abdomen.getWorldPosition(out);
  }

  /** 화살이 다리에 닿았는지: 닿은 다리 번호, 없으면 -1 */
  legBlock(p: THREE.Vector3, r: number): number {
    const rr = S.legBlockR + r;
    for (let i = 0; i < LEG_COUNT; i++) {
      if (distPointSegment(p, this.segKnee[i], this.segEnd[i]) < rr) return i;
      if (distPointSegment(p, this.segHip[i], this.segKnee[i]) < rr) return i;
    }
    return -1;
  }

  /** 바닥 위 (x,z) 원이 다리(발/무릎)에 닿는지 — 불꽃 장판/스플래시용 */
  legTouch(x: number, z: number, r: number): boolean {
    const rr = r + S.legBlockR;
    for (let i = 0; i < LEG_COUNT; i++) {
      if (Math.hypot(this.segEnd[i].x - x, this.segEnd[i].z - z) < rr) return true;
      if (Math.hypot(this.segKnee[i].x - x, this.segKnee[i].z - z) < rr) return true;
    }
    return false;
  }

  /** 착지/기상: 모든 발을 지정한 반경으로 동시에 내딛는다 */
  slideFeet(stance: number, time: number) {
    this.computeHomes(stance);
    this.gait.slideAll(this.homes, time, 0.5);
  }

  /** 발을 현재 자세의 홈 위치에 즉시 놓는다 (등장 연출 등) */
  snapFeet(stance = this.pose.cur.stance) {
    this.computeHomes(stance);
    this.gait.snap(this.homes);
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    this.t += dt;
    this.updateDebris(dt);
    if (this.exploded) return;

    this.pose.update(dt);
    this.syncBody(dt);
    this.computeHomes(this.pose.cur.stance);

    const air = this.pose.cur.legFollow;
    if (air < 0.5) {
      const spd = Math.hypot(this.vel.x, this.vel.z);
      this.gait.update(dt, this.homes, this.vel, {
        threshold: 1.25 * this.pose.cur.stance,
        stepTime: Math.max(0.12, 0.2 - spd * 0.012),
        lift: 1.05,
        lead: 0.12,
      });
    }
    this.solveLegs(dt);
    this.updateMaterials(dt);
  }

  private syncBody(dt: number) {
    const p = this.pose.cur;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.gaitPhase += dt * (2 + spd * 1.3);
    const walk = Math.min(1, spd / 3) * (1 - p.legFollow);
    const bob = Math.sin(this.gaitPhase * 2) * 0.08 * walk;
    const tr = p.tremble;
    this.body.position.set(
      tr ? (Math.random() - 0.5) * tr * 2 : 0,
      p.height + bob + (tr ? (Math.random() - 0.5) * tr : 0),
      tr ? (Math.random() - 0.5) * tr * 2 : 0,
    );
    this.body.rotation.set(p.pitch, 0, Math.sin(this.gaitPhase) * 0.03 * walk);
    const sq = Math.max(0.5, p.squash);
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.abdPivot.rotation.x = p.abdomen;
    const pulse = 1 + 0.14 * p.abdPulse * (0.5 + 0.5 * Math.sin(this.t * 13));
    this.abdomen.scale.set(pulse, pulse, pulse);
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);

    // 판정 원
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.thorax.x = this.pos.x + sy * 0.45;
    this.thorax.z = this.pos.z + cy * 0.45;
    this.body.getWorldPosition(this.tmp);
    this.thorax.y = this.tmp.y;
    this.abdomen.getWorldPosition(this.tmp);
    this.abdomenC.x = this.tmp.x;
    this.abdomenC.y = this.tmp.y;
    this.abdomenC.z = this.tmp.z;
  }

  private computeHomes(stance: number) {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    for (let i = 0; i < LEG_COUNT; i++) {
      const lx = this.homeLocal[i].x * stance;
      const lz = this.homeLocal[i].z * stance;
      this.homes[i].set(this.pos.x + lx * cy + lz * sy, 0, this.pos.z - lx * sy + lz * cy);
    }
  }

  private solveLegs(_dt: number) {
    const p = this.pose.cur;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    for (let i = 0; i < LEG_COUNT; i++) {
      const s = this.side[i];
      this.hipW.copy(this.hipLocal[i]);
      this.body.localToWorld(this.hipW);

      this.gait.get(i, this.foot);

      // 앞다리 들기 (거미줄 예비동작/포효): 허공을 휘젓는다
      if ((i === 0 || i === 4) && p.frontRaise > 0.01) {
        const wig = Math.sin(this.t * 9 + i) * 0.35;
        const lx = s * 1.5 + wig * s;
        const lz = 3.6;
        this.tmp.set(
          this.pos.x + lx * cy + lz * sy,
          this.pos.y + p.height + 1.9 + Math.sin(this.t * 7 + i * 2) * 0.3,
          this.pos.z - lx * sy + lz * cy,
        );
        this.foot.lerp(this.tmp, Math.min(1, p.frontRaise));
      }

      // 공중: 다리를 몸 아래로 접는다
      if (p.legFollow > 0.001) {
        const lx = this.homeLocal[i].x * 0.4;
        const lz = this.homeLocal[i].z * 0.4;
        this.tmp.set(this.pos.x + lx * cy + lz * sy, this.pos.y + Math.max(0.4, p.height - 1.5), this.pos.z - lx * sy + lz * cy);
        this.foot.lerp(this.tmp, Math.min(1, p.legFollow));
      }

      // 무릎은 위 + 바깥으로 튀어나온다
      this.pole.set(this.homeLocal[i].x * cy + this.homeLocal[i].z * sy, 0, -this.homeLocal[i].x * sy + this.homeLocal[i].z * cy);
      this.pole.normalize().multiplyScalar(0.45);
      this.pole.y = 1;

      solveTwoBone(this.hipW, this.foot, L1, L2, this.pole, this.kneeW, this.endW);

      this.segHip[i].copy(this.hipW);
      this.segKnee[i].copy(this.kneeW);
      this.segEnd[i].copy(this.endW);
      placeSegment(this.upper[i], this.hipW, this.kneeW, 0.3);
      placeSegment(this.lower[i], this.kneeW, this.endW, 0.27);
      this.knees[i].position.copy(this.kneeW);
    }
  }

  private updateMaterials(dt: number) {
    this.thoraxFlash = Math.max(0, this.thoraxFlash - dt * 12);
    this.abdFlash = Math.max(0, this.abdFlash - dt * 12);
    // 피격 점멸은 흰색이 아니라 달아오르는 주황빛으로 (붉은 몸이 회색으로 날아가지 않게)
    const heat = (m: THREE.MeshStandardMaterial, f: number) => {
      m.emissive.copy(m.userData.baseEmissive as THREE.Color);
      m.emissive.r += f * 0.5;
      m.emissive.g += f * 0.2;
      m.emissive.b += f * 0.04;
    };
    for (const m of this.thoraxMats) heat(m, this.thoraxFlash);
    for (const m of this.abdMats) heat(m, this.abdFlash);
    for (let i = 0; i < LEG_COUNT; i++) {
      this.legFlash[i] = Math.max(0, this.legFlash[i] - dt * 9);
      this.legMats[i].emissive.setRGB(0.08 + this.legFlash[i] * 0.7, 0.026 + this.legFlash[i] * 0.3, 0.016 + this.legFlash[i] * 0.06);
      this.kneeMats[i].emissive.setRGB(0.16 + this.legFlash[i] * 0.7, 0.09 + this.legFlash[i] * 0.4, 0.02 + this.legFlash[i] * 0.1);
    }
    // 눈: 평소엔 황금색, 분노하면 붉게 / 약점 주머니: 후딜엔 금색으로 크게 깜빡
    const k = 1.3 + 0.4 * Math.sin(this.t * (this.rage ? (this.rageLevel >= 2 ? 17 : 11) : 4));
    if (this.rage) this.eyeMats[0].color.setRGB(1.0 * k, 0.12 * k, 0.08 * k);
    else this.eyeMats[0].color.setRGB(1.0 * k, 0.78 * k, 0.12 * k);
    if (this.exposed) {
      const q = 1.5 + 0.9 * Math.sin(this.t * 16);
      this.sacMat.color.setRGB(1.0 * q, 0.8 * q, 0.15 * q);
    } else {
      const q = 0.95 + 0.3 * Math.sin(this.t * (this.rage ? (this.rageLevel >= 2 ? 13 : 8) : 3.2));
      this.sacMat.color.setRGB(1.0 * q, 0.5 * q, 0.06 * q);
    }
  }

  /* ───────────────────────── 사망: 마디별 분해 ───────────────────────── */
  explode(power = 1) {
    if (this.exploded) return;
    this.pose.snap({ squash: 1 });
    this.syncBody(0);
    this.root.updateMatrixWorld(true);
    const center = this.tmp.set(this.pos.x, this.pos.y + 1.8, this.pos.z).clone();

    const parts: THREE.Mesh[] = [...this.bodyMeshes, ...this.upper, ...this.lower, ...this.knees];
    for (const mesh of parts) {
      const wp = mesh.getWorldPosition(new V3());
      this.scene.attach(mesh);
      const dir = wp.clone().sub(center);
      dir.y = Math.abs(dir.y) * 0.5 + 0.6;
      dir.normalize();
      const sp = (4 + Math.random() * 9) * power;
      this.debris.push({
        mesh,
        vel: dir.multiplyScalar(sp).add(new V3((Math.random() - 0.5) * 3, 5 + Math.random() * 8, (Math.random() - 0.5) * 3)),
        ang: new V3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        r: Math.max(0.15, new THREE.Box3().setFromObject(mesh).getSize(new V3()).y * 0.5),
        rest: false,
      });
    }
    this.exploded = true;
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
    this.scene.remove(this.root);
    this.scene.remove(this.legsGroup);
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris = [];
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.bodyMats) m.dispose();
    for (const m of this.legMats) m.dispose();
    for (const m of this.kneeMats) m.dispose();
    for (const m of this.eyeMats) m.dispose();
    this.sacMat.dispose();
  }
}
