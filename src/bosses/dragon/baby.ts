import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import { BLOCKED, type Circle, type Host, type Sphere, type Target } from '../../types';
import type { Player } from '../../player';
import type { FireField } from './fire';

const V3 = THREE.Vector3;
type V3 = THREE.Vector3;
const B = CFG.dragon.baby;
const D = CFG.dragon;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur: number, goal: number, rate: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

/** 아기 용을 거느리는 쪽(본체 용)이 구현한다 */
export interface BabyOwner {
  readonly host: Host;
  readonly player: Player;
  readonly field: FireField;
  /** 아기 용이 맞았다. 본체 체력이 같은 만큼 깎이고, 실제로 들어간 피해를 돌려준다 */
  babyDamage(b: BabyDragon, amount: number, kind: 'weak' | 'exposed' | 'body' | 'special' | 'splash', at: THREE.Vector3): number;
  babyBlocked(): void;
  babyDown(b: BabyDragon): void;
  babyList(): readonly BabyDragon[];
}

type St = 'drop' | 'prowl' | 'bite' | 'spit' | 'swoop' | 'daze' | 'dying';

const NSEG = 11;
const SP = 0.7;
const RADII = [0.5, 0.62, 0.68, 0.64, 0.58, 0.5, 0.42, 0.34, 0.26, 0.19, 0.11];

/** 두 아기 용이 같은 재질을 쓰되 피격 번쩍임은 따로 하도록 재질을 복제해 쓴다 */
function makeMats() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a2a1a, emissive: 0x2a0804, roughness: 0.72, metalness: 0.1, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: 0xd68a3a, emissive: 0x3a1804, roughness: 0.8, flatShading: true });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6d4aa, emissive: 0x2a2010, roughness: 0.6, flatShading: true });
  const wing = new THREE.MeshStandardMaterial({ color: 0xb23a1e, emissive: 0x4a1006, roughness: 0.8, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a0e0a, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const gem = new THREE.MeshBasicMaterial({ color: 0xffe040, toneMapped: false });
  gem.color.multiplyScalar(2.4);
  const eye = new THREE.MeshBasicMaterial({ color: 0xffc040, toneMapped: false });
  eye.color.multiplyScalar(2);
  const glow = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  glow.color.multiplyScalar(1.6);
  return { skin, belly, bone, wing, dark, gem, eye, glow };
}

function wingGeo() {
  // 날개막 (오른쪽 날개, +x 가 바깥). 왼쪽은 x 를 뒤집어 쓴다
  const P = [
    [0, 0, 0.3],
    [1.3, 0.12, 0.55],
    [2.9, 0.25, 0.0],
    [2.05, 0.0, -1.0],
    [1.0, 0.0, -1.1],
    [0, 0, -0.75],
  ];
  const pos: number[] = [];
  const tri = (a: number, b: number, c: number) => pos.push(...P[a], ...P[b], ...P[c]);
  tri(0, 1, 2);
  tri(0, 2, 3);
  tri(0, 3, 4);
  tri(0, 4, 5);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function bar(len: number, r0: number, r1: number, mat: THREE.Material) {
  // +x 로 뻗는 가는 뼈대
  const g = new THREE.CylinderGeometry(r1, r0, len, 5).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0);
  return new THREE.Mesh(g, mat);
}

/**
 * 아기 용 — 본체 용보다 훨씬 작고 짧은 새끼. 낮게 날고 주로 땅에서 싸운다.
 *  · 머리가 지나간 길을 짧은 몸통(11마디)이 따라온다. 이마의 노란 보석이 약점.
 *  · 공격: 돌진(bite, 닿으면 바로 피해) / 불덩이 뱉기(spit) / 날아올라 내리꽂기(swoop). 돌진 · 내리꽂기 뒤에는 어지러워 머리가 크게 드러난다.
 *  · 맞은 피해는 그대로 본체 용 체력에서 깎인다 (둘이 합쳐 1페이즈 체력).
 */
export class BabyDragon implements Target {
  alive = true;
  hp: number;
  readonly maxHp: number;
  /** 머리 중심 위치 (y = 머리 높이) */
  readonly pos = new V3();
  yaw = 0;
  private pitch = 0;
  private state: St = 'drop';
  private t = 0;
  private sub = 0;
  private attackT = 1.5;
  private seq: ('bite' | 'spit' | 'swoop')[];
  private seqI = 0;
  private strike = false;
  private hitCd = 0;
  private rage = 1;
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private orbitT = 3;
  private vy = 0;
  private hy = 1.35;
  private jaw = 0.1;
  private fireK = 0;
  private flap = { hz: 0.5, amp: 0.3, fold: 0.85, phase: Math.random() * TAU };
  private gait = 0;
  private speed = 0;
  private flashT = 0;
  private dazeT = 0;
  private roarT = 0;
  private beatT = 0;
  /** 공격 지점(돌진 방향 / 내리꽂는 곳) */
  private goal = new V3();
  private from = new V3();
  private dir = new V3();
  private runLeft = 0;
  private shots = 0;
  private lookYaw = 0;
  private gone = false;

  private trail: V3[] = [];
  private root = new THREE.Group();
  private head = new THREE.Group();
  private jawMesh!: THREE.Mesh;
  private mouth!: THREE.Mesh;
  private segs: THREE.Mesh[] = [];
  private wings: { piv: THREE.Group; sign: number }[] = [];
  private legs: { g: THREE.Group; seg: number; side: number; ph: number }[] = [];
  private mats = makeMats();
  private geos: THREE.BufferGeometry[] = [];
  private tmp = new V3();
  private tmp2 = new V3();
  private tmp3 = new V3();
  private q = new THREE.Quaternion();
  private spheres: Sphere[] = [];
  private segPos: V3[] = [];

  constructor(
    private owner: BabyOwner,
    readonly index: number,
    x: number,
    z: number,
    hp: number,
  ) {
    this.hp = hp;
    this.maxHp = hp;
    this.pos.set(x, 70, z);
    this.vy = 0;
    this.yaw = Math.atan2(-x, -z);
    this.seq = index === 0 ? ['spit', 'bite', 'swoop', 'bite', 'spit', 'swoop'] : ['bite', 'swoop', 'spit', 'swoop', 'bite', 'spit'];
    this.seqI = 0;
    this.attackT = 1.2 + index * 1.7;
    this.build();
    const f = this.fwd(this.tmp);
    for (let k = 0; k < 90; k++) this.trail.push(new V3(x - f.x * 0.2 * k, 70, z - f.z * 0.2 * k));
    for (let i = 0; i < NSEG + 2; i++) this.segPos.push(new V3());
    for (let i = 0; i < 8; i++) this.spheres.push({ x: 0, y: 0, z: 0, r: 1 });
    this.owner.host.scene.add(this.root);
    // 떨어질 자리 표시
    owner.host.fx.telegraphs.circle(x, z, 3.2, Math.sqrt((70 - this.hy) / 35), () => {});
    this.sync(0);
  }

  get invulnerable() {
    return this.state === 'drop' || this.state === 'dying';
  }
  get dazed() {
    return this.state === 'daze';
  }
  get groundPos() {
    return this.tmp3.set(this.pos.x, 0, this.pos.z);
  }

  /* ───────────────────────── 모델 ───────────────────────── */
  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  private mesh(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D) {
    const me = new THREE.Mesh(this.geo(g), m);
    me.castShadow = true;
    parent.add(me);
    return me;
  }

  private build() {
    const M = this.mats;
    // 몸통 마디
    for (let i = 0; i < NSEG; i++) {
      const r = RADII[i];
      const s = new THREE.Mesh(this.geo(new THREE.IcosahedronGeometry(1, 0)), i % 3 === 1 ? M.belly : M.skin);
      s.scale.set(r * 1.05, r * 0.95, SP * 0.78);
      s.castShadow = true;
      this.root.add(s);
      this.segs.push(s);
      // 등 가시
      if (i > 0 && i < NSEG - 1) {
        const sp = this.mesh(new THREE.ConeGeometry(r * 0.28, r * 0.9, 4), M.bone, s);
        sp.position.set(0, r * 0.95, 0);
        sp.scale.set(1 / (r * 1.05), 1 / (r * 0.95), 1 / (SP * 0.78));
        sp.scale.multiplyScalar(0.9);
      }
    }
    // 머리
    this.root.add(this.head);
    const skull = this.mesh(new THREE.IcosahedronGeometry(1, 0), M.skin, this.head);
    skull.scale.set(0.62, 0.5, 0.78);
    const snout = this.mesh(new THREE.ConeGeometry(0.34, 0.9, 5).rotateX(Math.PI / 2).translate(0, -0.05, 0.75), M.skin, this.head);
    snout.scale.set(1.15, 0.85, 1);
    this.jawMesh = this.mesh(new THREE.ConeGeometry(0.3, 0.85, 5).rotateX(Math.PI / 2).translate(0, 0, 0.42), M.belly, this.head);
    this.jawMesh.position.set(0, -0.26, 0.2);
    this.mouth = this.mesh(new THREE.SphereGeometry(0.34, 10, 8), M.glow, this.head);
    this.mouth.position.set(0, -0.2, 0.95);
    this.mouth.castShadow = false;
    this.mouth.visible = false;
    for (const sd of [-1, 1]) {
      const horn = this.mesh(new THREE.ConeGeometry(0.15, 1.0, 5).rotateX(-Math.PI / 2 - 0.5), M.bone, this.head);
      horn.position.set(sd * 0.36, 0.34, -0.3);
      horn.rotation.z = sd * -0.3;
      const eye = this.mesh(new THREE.SphereGeometry(0.11, 8, 6), M.eye, this.head);
      eye.position.set(sd * 0.33, 0.14, 0.38);
      eye.castShadow = false;
      const ear = this.mesh(new THREE.ConeGeometry(0.1, 0.5, 4).rotateX(-Math.PI / 2 - 0.2), M.dark, this.head);
      ear.position.set(sd * 0.5, 0.18, -0.28);
      ear.rotation.z = sd * -0.9;
    }
    // 이마의 노란 보석 (약점)
    const gem = this.mesh(new THREE.OctahedronGeometry(1, 0), M.gem, this.head);
    gem.scale.set(0.15, 0.24, 0.12);
    gem.position.set(0, 0.46, 0.2);
    gem.rotation.x = -0.35;
    gem.castShadow = false;
    // 날개
    const wg = this.geo(wingGeo());
    for (const sign of [1, -1]) {
      const piv = new THREE.Group();
      const arm = bar(1.3, 0.09, 0.07, M.dark);
      const fore = bar(1.7, 0.07, 0.035, M.dark);
      fore.position.set(1.3, 0.12, 0.55);
      fore.rotation.z = -0.1;
      fore.rotation.y = 0.28;
      const mem = new THREE.Mesh(wg, M.wing);
      mem.castShadow = true;
      piv.add(mem, arm, fore);
      piv.scale.x = sign;
      this.root.add(piv);
      this.wings.push({ piv, sign });
    }
    // 다리 (앞 · 뒤)
    for (const [seg, ph] of [[1, 0], [4, Math.PI]] as const) {
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const up = this.mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.62, 5).translate(0, -0.31, 0), M.skin, g);
        const lo = this.mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.6, 5).translate(0, -0.3, 0), M.skin, g);
        lo.position.y = -0.6;
        lo.rotation.x = 0.5;
        const foot = this.mesh(new THREE.ConeGeometry(0.16, 0.34, 4).rotateX(Math.PI / 2).translate(0, 0, 0.12), M.bone, g);
        foot.position.set(0, -1.1, 0.14);
        void up;
        this.root.add(g);
        this.legs.push({ g, seg, side, ph: ph + (side > 0 ? Math.PI : 0) });
      }
    }
  }

  /* ───────────────────────── 보조 ───────────────────────── */
  private fwd(out: THREE.Vector3) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  private mouthPos(out: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    return out.set(this.pos.x + Math.sin(this.yaw) * cp * 1.25, this.pos.y + Math.sin(this.pitch) * 1.25 - 0.1, this.pos.z + Math.cos(this.yaw) * cp * 1.25);
  }
  private distToPlayer() {
    const p = this.owner.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }
  private angToPlayer() {
    const p = this.owner.player.pos;
    return Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }
  private turn(goal: number, rate: number, dt: number) {
    this.yaw = wrapPi(this.yaw + wrapPi(goal - this.yaw) * (1 - Math.exp(-rate * dt)));
  }
  private clampArena() {
    const lim = WORLD.radius - 2.2;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > lim) {
      this.pos.x *= lim / r;
      this.pos.z *= lim / r;
    }
  }
  /** 바라보는 쪽으로 speed 만큼 걷는다 */
  private walk(speed: number, dt: number) {
    const f = this.fwd(this.tmp);
    this.pos.x += f.x * speed * dt;
    this.pos.z += f.z * speed * dt;
    this.speed = speed;
    this.clampArena();
  }
  private roar(vol = 1) {
    if (this.roarT > 0) return;
    this.roarT = 0.8;
    const d = this.distToPlayer();
    this.owner.host.sfx.babyRoar(clamp(1.1 - d / 45, 0.35, 1) * vol);
  }
  private next(): 'bite' | 'spit' | 'swoop' {
    return this.seq[this.seqI++ % this.seq.length];
  }
  private gap() {
    return (B.gap[0] + Math.random() * (B.gap[1] - B.gap[0])) / this.rage;
  }

  /** 다른 아기 용을 쓰러뜨려 남은 한 마리가 격분 */
  enrage() {
    this.rage = B.rage;
    this.roar(1.2);
    this.attackT = Math.min(this.attackT, 0.8);
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    if (this.gone) return;
    this.t += dt;
    this.roarT = Math.max(0, this.roarT - dt);
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.alive) {
      switch (this.state) {
        case 'drop':
          this.updateDrop(dt);
          break;
        case 'prowl':
          this.updateProwl(dt);
          break;
        case 'bite':
          this.updateBite(dt);
          break;
        case 'spit':
          this.updateSpit(dt);
          break;
        case 'swoop':
          this.updateSwoop(dt);
          break;
        case 'daze':
          this.updateDaze(dt);
          break;
      }
      this.touch();
    } else if (this.state === 'dying') {
      this.updateDying(dt);
    }
    this.sync(dt);
  }

  private updateDrop(dt: number) {
    const { host } = this.owner;
    this.vy += 70 * dt;
    this.pos.y -= this.vy * dt;
    this.flap.fold = 1;
    this.jaw = 0.8;
    if (this.pos.y <= this.hy) {
      this.pos.y = this.hy;
      this.vy = 0;
      this.state = 'prowl';
      this.sub = 0;
      this.attackT = 0.9 + this.index * 1.4;
      host.shake(1.0, 0.25);
      host.sfx.land();
      this.roar(1.2);
      host.fx.ring(this.pos.x, this.pos.z, 8, 0.6, 0xffd27a);
      this.owner.field.explode(this.pos.x, this.pos.z, 3.2, false);
      host.fx.particles.burst(this.tmp.set(this.pos.x, 0.6, this.pos.z), 0x7a5a42, 36, 9, 0.9, 0.4, 0.5, 6, 1.2);
    }
  }

  private updateProwl(dt: number) {
    const pl = this.owner.player.pos;
    const d = this.distToPlayer();
    const toP = this.angToPlayer();
    this.orbitT -= dt;
    if (this.orbitT <= 0) {
      this.orbitDir = -this.orbitDir;
      this.orbitT = 2.5 + Math.random() * 3;
    }
    // 먼 곳에서는 다가오고, 너무 가까우면 물러나며, 그 사이에서는 플레이어 둘레를 빙빙 돈다
    let goal = toP;
    let sp = B.run * this.rage;
    if (d > B.far) goal = toP + this.orbitDir * 0.25;
    else if (d < B.near) goal = toP + Math.PI * 0.75 * this.orbitDir;
    else goal = toP + this.orbitDir * 1.25;
    // 다른 아기 용과 겹치지 않게
    for (const o of this.owner.babyList()) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      if (dx * dx + dz * dz < 25) goal = Math.atan2(dx, dz);
    }
    // 벽 가까이에서는 안쪽으로
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > WORLD.radius - 4.5) goal = Math.atan2(-this.pos.x, -this.pos.z);
    this.turn(goal, 4.2, dt);
    this.walk(sp, dt);
    this.hy = approach(this.hy, 1.35 + Math.sin(this.t * 6) * 0.06, 8, dt);
    this.pos.y = this.hy;
    this.pitch = approach(this.pitch, 0, 6, dt);
    this.lookYaw = approach(this.lookYaw, clamp(wrapPi(toP - this.yaw), -1, 1), 6, dt);
    this.jaw = approach(this.jaw, 0.1, 6, dt);
    this.fireK = approach(this.fireK, 0, 6, dt);
    this.flap.fold = approach(this.flap.fold, 0.88, 6, dt);
    this.flap.hz = 0.4;
    this.flap.amp = 0.15;
    this.gait += dt * (sp * 0.55);
    void pl;
    this.attackT -= dt;
    if (this.attackT <= 0) this.startAttack(this.next());
  }

  private startAttack(a: 'bite' | 'spit' | 'swoop') {
    this.state = a;
    this.sub = 0;
    this.t = 0;
    this.speed = 0;
    const { host } = this.owner;
    if (a === 'bite') {
      this.dir.set(0, 0, 0);
      host.sfx.telegraph();
    } else if (a === 'swoop') {
      this.roar(0.9);
    }
  }

  /** 돌진: 웅크려 노려보다(예고선) → 일직선으로 내달려 물어뜯는다 */
  private updateBite(dt: number) {
    const { host } = this.owner;
    const tell = B.bite.tell / this.rage;
    if (this.sub === 0) {
      const toP = this.angToPlayer();
      if (this.t < tell * 0.6) this.turn(toP, 9, dt);
      this.hy = approach(this.hy, 0.95, 10, dt);
      this.pos.y = this.hy;
      this.pitch = approach(this.pitch, -0.12, 8, dt);
      this.jaw = approach(this.jaw, 0.5, 8, dt);
      this.lookYaw = approach(this.lookYaw, 0, 8, dt);
      this.flap.fold = approach(this.flap.fold, 1, 8, dt);
      this.gait += dt * 2;
      if (!this.dir.lengthSq()) {
        // 예고선: 겨눈 방향으로 쭉
        const d = this.distToPlayer();
        const L = clamp(d + 6, B.bite.min, B.bite.max);
        this.runLeft = L;
        const ang = Math.atan2(this.owner.player.pos.x - this.pos.x, this.owner.player.pos.z - this.pos.z);
        this.dir.set(Math.sin(ang), 0, Math.cos(ang));
        host.fx.telegraphs.line(this.pos.x, this.pos.z, Math.atan2(this.dir.z, this.dir.x), L, 2.6, tell, () => {});
      }
      if (this.t >= tell) {
        this.sub = 1;
        this.t = 0;
        this.yaw = Math.atan2(this.dir.x, this.dir.z);
        this.strike = true;
        this.jaw = 1;
        this.roar(1);
        host.sfx.leap();
        host.shake(0.4, 0.3);
      }
      return;
    }
    // 달리기
    const sp = B.bite.speed * Math.min(1, 0.35 + this.t * 5);
    const step = sp * dt;
    const f = this.fwd(this.tmp);
    this.pos.x += f.x * step;
    this.pos.z += f.z * step;
    this.runLeft -= step;
    this.speed = sp;
    this.gait += dt * 20;
    this.hy = 1.1;
    this.pos.y = this.hy;
    this.clampArena();
    this.jaw = 1;
    if (this.t > 0.06) {
      host.fx.particles.burst(this.tmp2.set(this.pos.x, 0.4, this.pos.z), 0x8a6a4a, 2, 5, 0.5, 0.3, 0.3, 3, 1.2);
    }
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (this.runLeft <= 0 || rr > WORLD.radius - 2.3) {
      this.strike = false;
      this.state = 'daze';
      this.dazeT = B.daze;
      this.sub = 0;
      host.shake(0.5, 0.15);
      host.fx.particles.burst(this.tmp2.set(this.pos.x, 0.5, this.pos.z), 0x7a5a42, 20, 7, 0.7, 0.3, 0.5, 4, 1.2);
    }
  }

  /** 불덩이 뱉기: 몸을 일으켜 입에 불을 모았다가 불덩이를 연달아 던진다 */
  private updateSpit(dt: number) {
    const { host, field, player } = this.owner;
    const wind = B.spit.windup / this.rage;
    const toP = this.angToPlayer();
    this.turn(toP, 6, dt);
    this.hy = approach(this.hy, 2.5, 6, dt);
    this.pos.y = this.hy;
    this.pitch = approach(this.pitch, 0.42, 6, dt);
    this.lookYaw = approach(this.lookYaw, 0, 8, dt);
    this.flap.fold = approach(this.flap.fold, 0.55, 5, dt);
    this.flap.hz = 0.7;
    this.flap.amp = 0.45;
    this.jaw = approach(this.jaw, 0.7, 8, dt);
    this.fireK = approach(this.fireK, this.t < wind ? 1 : 0.7, 8, dt);
    this.speed = 0;
    if (this.sub === 0) {
      this.sub = 1;
      host.sfx.flame(wind, 0.5);
      host.sfx.telegraph();
    }
    const n = B.spit.count;
    const at = wind + this.shots * B.spit.gap;
    if (this.shots < n && this.t >= at) {
      this.shots++;
      const M = this.mouthPos(this.tmp);
      // 플레이어가 가는 방향을 조금 앞서 겨눈다
      const pl = player.pos;
      const tgt = this.tmp2.set(pl.x, 0, pl.z);
      if (this.shots > 1) {
        const a = Math.random() * TAU;
        tgt.x += Math.cos(a) * B.spit.spread;
        tgt.z += Math.sin(a) * B.spit.spread;
      }
      const r = Math.hypot(tgt.x, tgt.z);
      if (r > WORLD.radius - 1) {
        tgt.x *= (WORLD.radius - 1) / r;
        tgt.z *= (WORLD.radius - 1) / r;
      }
      field.lob(M, tgt, B.spit.flight, B.spit.peak, B.spit.radius, 0);
      host.sfx.spit();
      host.fx.particles.burst(M, 0xffb040, 10, 6, 0.4, 0.2, 0.3, 2, 2);
      host.fx.burstLight(M, 0xff8030, 70, 0.2);
      this.jaw = 1;
      host.shake(0.15, 0.05);
    }
    if (this.shots >= n && this.t >= wind + (n - 1) * B.spit.gap + B.spit.recover / this.rage) {
      this.shots = 0;
      this.fireK = 0;
      this.state = 'prowl';
      this.attackT = this.gap();
    }
  }

  /** 내리꽂기: 날갯짓으로 떠올라 플레이어 위를 겨눈다(예고 원) → 내리꽂는다. 착지 뒤에는 어지러워 머리가 드러난다 */
  private updateSwoop(dt: number) {
    const { host, field, player } = this.owner;
    const C = B.swoop;
    const tell = C.tell / this.rage;
    if (this.sub === 0) {
      // 떠오르며 플레이어 쪽으로 다가간다
      const toP = this.angToPlayer();
      this.turn(toP + this.orbitDir * 0.5, 4, dt);
      const d = this.distToPlayer();
      this.walk(d > 9 ? 12 : 4, dt);
      this.hy = approach(this.hy, C.alt, 3.2, dt);
      this.pos.y = this.hy;
      this.pitch = approach(this.pitch, 0.2, 4, dt);
      this.flap.fold = approach(this.flap.fold, 0, 8, dt);
      this.flap.hz = 2.6;
      this.flap.amp = 1.0;
      this.jaw = approach(this.jaw, 0.4, 5, dt);
      this.lookYaw = approach(this.lookYaw, 0, 8, dt);
      if (this.t >= C.climb) {
        this.sub = 1;
        this.t = 0;
        const pl = player.pos;
        this.goal.set(pl.x, 0, pl.z);
        const r = Math.hypot(this.goal.x, this.goal.z);
        if (r > WORLD.radius - 2) {
          this.goal.x *= (WORLD.radius - 2) / r;
          this.goal.z *= (WORLD.radius - 2) / r;
        }
        host.fx.telegraphs.circle(this.goal.x, this.goal.z, C.radius, tell, () => {});
        host.sfx.telegraph();
        this.roar(1);
      }
      return;
    }
    if (this.sub === 1) {
      // 표적 위로 이동하며 겨눈다
      this.turn(Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z), 6, dt);
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const dd = Math.hypot(dx, dz);
      const stepD = Math.min(dd - 0.5 > 0 ? dd - 0.5 : 0, 16 * dt);
      if (dd > 1e-3) {
        this.pos.x += (dx / dd) * stepD;
        this.pos.z += (dz / dd) * stepD;
      }
      this.speed = stepD / Math.max(dt, 1e-4);
      this.hy = approach(this.hy, C.alt + 0.8 + Math.sin(this.t * 7) * 0.3, 6, dt);
      this.pos.y = this.hy;
      this.pitch = approach(this.pitch, -0.2, 6, dt);
      this.flap.hz = 2.8;
      this.flap.amp = 1.0;
      this.flap.fold = approach(this.flap.fold, 0, 8, dt);
      if (this.t >= tell) {
        this.sub = 2;
        this.t = 0;
        this.from.copy(this.pos);
        this.strike = true;
        this.jaw = 1;
        host.sfx.leap();
      }
      return;
    }
    // 내리꽂기
    const k = Math.min(1, this.t / C.dive);
    const e = k * k;
    this.pos.x = this.from.x + (this.goal.x - this.from.x) * e;
    this.pos.z = this.from.z + (this.goal.z - this.from.z) * e;
    this.pos.y = this.from.y + (1.1 - this.from.y) * e;
    this.hy = this.pos.y;
    this.yaw = Math.atan2(this.goal.x - this.from.x, this.goal.z - this.from.z);
    this.pitch = -1.0 * Math.min(1, k * 3);
    this.flap.fold = approach(this.flap.fold, 1, 14, dt);
    this.speed = 30;
    if (k >= 1) {
      this.strike = false;
      host.shake(1.1, 0.25);
      host.sfx.land();
      host.hitStop(0.05);
      field.explode(this.goal.x, this.goal.z, C.radius, false);
      host.fx.ring(this.goal.x, this.goal.z, C.radius * 2.6, 0.6, 0xffb060);
      host.fx.particles.burst(this.tmp.set(this.goal.x, 0.6, this.goal.z), 0x7a5a42, 40, 10, 0.9, 0.4, 0.5, 6, 1.2);
      const pl = player.pos;
      const d = Math.hypot(pl.x - this.goal.x, pl.z - this.goal.z);
      if (d < 9) player.push(this.goal.x, this.goal.z, 5 * (1 - d / 9) + 1.5);
      this.state = 'daze';
      this.dazeT = B.daze + 0.3;
      this.sub = 0;
      this.pitch = -0.1;
    }
  }

  /** 어지러움: 머리를 늘어뜨리고 비틀거린다 — 머리 피해가 크게 늘어나는 공격 기회 */
  private updateDaze(dt: number) {
    const { host } = this.owner;
    this.dazeT -= dt;
    this.speed = approach(this.speed, 0, 6, dt);
    this.walk(this.speed * 0.5, dt);
    this.hy = approach(this.hy, 1.0, 8, dt);
    this.pos.y = this.hy;
    this.pitch = approach(this.pitch, -0.2, 6, dt);
    this.jaw = approach(this.jaw, 0.35, 6, dt);
    this.flap.fold = approach(this.flap.fold, 0.95, 6, dt);
    this.lookYaw = Math.sin(this.t * 7) * 0.5;
    this.fireK = 0;
    if (Math.random() < dt * 8) {
      host.fx.particles.burst(this.tmp.set(this.pos.x + (Math.random() - 0.5), this.pos.y + 1.1, this.pos.z + (Math.random() - 0.5)), 0xffe060, 1, 1.3, 0.7, 0.14, 0.2, -1, 2.4);
    }
    if (this.dazeT <= 0) {
      this.state = 'prowl';
      this.attackT = this.gap();
      this.roar(0.8);
    }
  }

  /** 돌진 · 내리꽂기 중에는 몸에 닿으면 바로 피해 */
  private touch() {
    if (!this.strike) return;
    const pl = this.owner.player;
    if (pl.dead || this.hitCd > 0) return;
    for (const s of this.spheres) {
      if (Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z) < s.r + 0.6 && Math.abs(s.y - (0.9 + pl.pos.y)) < s.r + 1.3) {
        if (pl.takeDamage(s.x, s.z)) this.hitCd = 0.25;
        break;
      }
    }
  }

  /* ───────────────────────── 사망 ───────────────────────── */
  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dying';
    this.t = 0;
    this.strike = false;
    this.sub = 0;
    const { host } = this.owner;
    host.sfx.babyRoar(1.2);
    host.sfx.bossDeath();
    host.hitStop(0.12);
    host.shake(1.0, 0.25);
    host.fx.burstLight(this.tmp.set(this.pos.x, this.pos.y + 1, this.pos.z), 0xffc070, 200, 0.8);
    this.fireK = 0;
    this.flap.fold = 0.3;
    this.jaw = 1;
  }

  private updateDying(dt: number) {
    const { host } = this.owner;
    this.hy = approach(this.hy, 0.6, 5, dt);
    this.pos.y = this.hy;
    this.pitch = approach(this.pitch, -0.5, 4, dt);
    this.yaw += dt * 4;
    this.flap.hz = 3;
    this.flap.amp = 0.7;
    this.speed = 0;
    for (let i = 0; i < 2; i++) {
      const s = this.segPos[Math.floor(Math.random() * NSEG)];
      host.fx.particles.burst(s, Math.random() < 0.5 ? 0xff5a1a : 0xffc060, 4, 6, 0.8, 0.3, 0.6, 3, 2);
    }
    if (this.t > 0.9) {
      host.fx.burstLight(this.tmp.set(this.pos.x, 1.2, this.pos.z), 0xffc070, 300, 1.0);
      host.fx.ring(this.pos.x, this.pos.z, 12, 0.7, 0xffd27a);
      host.sfx.explosion(true);
      host.shake(1.4, 0.3);
      for (let i = 0; i < NSEG; i += 2) {
        host.fx.particles.burst(this.segPos[i], 0xff4a2a, 10, 10, 1.0, 0.36, 0.8, 4, 2);
        host.fx.particles.burst(this.segPos[i], 0xffd060, 5, 8, 0.8, 0.28, 0.8, 4, 2);
      }
      this.root.visible = false;
      this.gone = true;
      this.owner.babyDown(this);
    }
  }

  /* ───────────────────────── 그리기 ───────────────────────── */
  private sync(dt: number) {
    const M = this.mats;
    // 머리
    this.head.position.copy(this.pos);
    this.head.rotation.set(-(this.pitch), this.yaw + this.lookYaw * 0.8, 0, 'YXZ');
    this.jawMesh.rotation.x = this.jaw * 0.55;
    this.mouth.visible = this.fireK > 0.05;
    if (this.mouth.visible) this.mouth.scale.setScalar(0.5 + 0.9 * this.fireK + Math.sin(this.t * 40) * 0.05);
    // 몸통 궤적
    const tr = this.trail;
    if (tr.length < 2 || tr[0].distanceToSquared(tr[1]) > 0.04) tr.unshift(this.pos.clone());
    else tr[0].copy(this.pos);
    if (tr.length > 90) tr.length = 90;
    const need = (NSEG + 2) * SP + 1.2;
    let acc = 0;
    let ti = 0;
    for (let k = 0; k < NSEG + 2; k++) {
      const want = 0.95 + k * SP;
      while (ti < tr.length - 1) {
        const sl = tr[ti].distanceTo(tr[ti + 1]);
        if (acc + sl >= want) break;
        acc += sl;
        ti++;
      }
      const out = this.segPos[k];
      if (ti >= tr.length - 1) {
        out.copy(tr[tr.length - 1]);
      } else {
        const sl = tr[ti].distanceTo(tr[ti + 1]) || 1;
        out.lerpVectors(tr[ti], tr[ti + 1], clamp((want - acc) / sl, 0, 1));
      }
    }
    void need;
    // 꼬리 물결 + 바닥에 붙기
    const moving = clamp(this.speed / 8, 0, 1);
    for (let i = 0; i < NSEG + 2; i++) {
      const sp = this.segPos[i];
      const k = i / NSEG;
      const sway = Math.sin(this.t * (3 + moving * 4) - i * 0.55) * (0.1 + 0.5 * k * k) * (0.35 + 0.65 * moving + (this.state === 'dying' ? 1 : 0));
      const prev = i === 0 ? this.pos : this.segPos[i - 1];
      const dx = sp.x - prev.x;
      const dz = sp.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      sp.x += (-dz / l) * sway;
      sp.z += (dx / l) * sway;
      const r = RADII[Math.min(i, NSEG - 1)];
      sp.y = Math.max(sp.y, r * 0.75);
    }
    for (let i = 0; i < NSEG; i++) {
      const s = this.segs[i];
      s.position.copy(this.segPos[i]);
      const prev = i === 0 ? this.pos : this.segPos[i - 1];
      this.tmp.copy(prev);
      if (this.tmp.distanceToSquared(s.position) > 1e-6) s.lookAt(this.tmp);
      const sph = i < 8 ? this.spheres[i] : null;
      if (sph) {
        sph.x = s.position.x;
        sph.y = s.position.y;
        sph.z = s.position.z;
        sph.r = RADII[i] * 1.25;
      }
    }
    // 날개
    this.flap.phase += dt * this.flap.hz * TAU;
    const wingBase = this.segPos[1];
    const fold = this.flap.fold;
    const stroke = Math.sin(this.flap.phase);
    for (const w of this.wings) {
      const ang = (0.55 + stroke * this.flap.amp) * (1 - fold) - 0.15 * fold + 0.1;
      w.piv.position.set(wingBase.x, wingBase.y + RADII[1] * 0.6, wingBase.z);
      w.piv.rotation.set(0, 0, 0);
      // 몸 방향에 맞춰 놓는다 (몸 마디 1 의 방향)
      w.piv.quaternion.copy(this.segs[1].quaternion);
      this.q.setFromAxisAngle(this.tmp.set(0, 0, 1), ang * w.sign);
      w.piv.quaternion.multiply(this.q);
      this.q.setFromAxisAngle(this.tmp.set(0, 1, 0), (-0.25 + fold * 0.9) * w.sign);
      w.piv.quaternion.multiply(this.q);
      w.piv.scale.set(w.sign * (1 - 0.55 * fold), 1 - 0.3 * fold, 1);
    }
    // 날갯짓 소리 (공중에 떠 있을 때만)
    if (this.alive && this.pos.y > 3 && fold < 0.5) {
      this.beatT += dt * this.flap.hz;
      if (this.beatT >= 1) {
        this.beatT -= 1;
        const d = this.distToPlayer();
        this.owner.host.sfx.wingbeat(clamp(0.9 - d / 45, 0.12, 0.6));
      }
    }
    // 다리
    for (const l of this.legs) {
      const sp = this.segPos[l.seg];
      const s = this.segs[l.seg];
      this.tmp.set(1, 0, 0).applyQuaternion(s.quaternion);
      l.g.position.set(sp.x + this.tmp.x * l.side * RADII[l.seg] * 0.8, sp.y - 0.05, sp.z + this.tmp.z * l.side * RADII[l.seg] * 0.8);
      const air = this.pos.y > 3;
      const swing = air ? 0.25 : Math.sin(this.gait + l.ph) * 0.65 * (0.15 + 0.85 * moving);
      l.g.rotation.set(swing, this.yaw, 0, 'YXZ');
    }
    // 피격 번쩍임
    const f = this.flashT > 0 ? 1 : 0;
    M.skin.emissive.setRGB(0.16 + 0.9 * f, 0.03 + 0.5 * f, 0.02 + 0.3 * f);
    M.belly.emissive.setRGB(0.22 + 0.7 * f, 0.1 + 0.4 * f, 0.02 + 0.2 * f);
    M.gem.color.setRGB(2.6, 2.1 + 0.4 * Math.sin(this.t * 6), 0.3);
  }

  flash() {
    this.flashT = 0.08;
  }

  /* ───────────────────────── 판정 (Target) ───────────────────────── */
  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive) return 0;
    const hs = 1.0;
    let kind: 'head' | 'body' | null = null;
    {
      const dx = p.x - this.pos.x;
      const dy = p.y - this.pos.y;
      const dz = p.z - this.pos.z;
      const rr = hs + r;
      if (dx * dx + dy * dy + dz * dz < rr * rr) kind = 'head';
    }
    if (!kind) {
      for (const s of this.spheres) {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const dz = p.z - s.z;
        const rr = s.r + r;
        if (dx * dx + dy * dy + dz * dz < rr * rr) {
          kind = 'body';
          break;
        }
      }
    }
    if (!kind) return 0;
    if (this.invulnerable) {
      this.owner.babyBlocked();
      return BLOCKED;
    }
    if (kind === 'head') return this.owner.babyDamage(this, dmg * (this.dazed ? D.exposedMult : D.headMult), this.dazed ? 'exposed' : 'weak', p);
    return this.owner.babyDamage(this, dmg * D.bodyMult, 'body', p);
  }

  hitRadial(c: THREE.Vector3, radius: number, dmg: number) {
    if (!this.alive || this.invulnerable) return;
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < radius + 1.2) this.owner.babyDamage(this, dmg, 'special', this.tmp2.set(this.pos.x, this.pos.y, this.pos.z));
  }

  hitSplash(x: number, z: number, r: number, dmg: number, y = 1): number {
    if (!this.alive || this.invulnerable) return 0;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) < r + 1.0 && Math.abs(y - this.pos.y) < 3 + r) {
      return this.owner.babyDamage(this, dmg, 'splash', this.tmp2.set(this.pos.x, this.pos.y, this.pos.z));
    }
    return 0;
  }

  bodies(): Circle[] {
    return [];
  }

  aimSphereList(): readonly Sphere[] {
    return this.alive ? [{ x: this.pos.x, y: this.pos.y, z: this.pos.z, r: 1.0 }, ...this.spheres] : [];
  }

  dispose() {
    this.owner.host.scene.remove(this.root);
    for (const g of this.geos) g.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
  }
}
