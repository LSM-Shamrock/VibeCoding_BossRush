import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import { BLOCKED, type Circle, type Host, type Sphere, type Target } from '../../types';
import type { Player } from '../../player';
import type { FireField } from './fire';
import { DragonRig } from './rig';

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

type St = 'drop' | 'prowl' | 'bite' | 'spit' | 'swoop' | 'orbit' | 'daze' | 'dying';
type Atk = 'bite' | 'spit' | 'swoop' | 'orbit';

/** 본체와 같은 모델을 줄여 쓴다 (몸 길이 200 → 200×S, 굵기 · 날개도 같은 비율) */
const S = B.scale;

/**
 * 아기 용 — 본체 용과 같은 모델(DragonRig)을 크기와 몸 길이만 줄인 새끼. 낮게 날고 주로 땅에서 싸운다.
 *  · 이마와 가슴의 노란 보석이 약점.
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
  private seq: Atk[];
  private seqI = 0;
  private strike = false;
  private hitCd = 0;
  private rage = 1;
  private orbitDir = Math.random() < 0.5 ? 1 : -1;
  private orbitT = 3;
  private vy = 0;
  private hy = 1.5;
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
  private land = new V3();
  private biteLeft = 0;
  private tellScale = 1;
  private trailAcc = 0;
  private ringDone = false;
  private orbA = 0;
  private orbDir = 1;
  private orbTravel = 0;
  private shotT = 0;
  private shotN = 0;
  private gone = false;

  private rig: DragonRig;
  private bank = 0;
  private yawRate = 0;
  private tmp = new V3();
  private tmp2 = new V3();
  private tmp3 = new V3();
  private spheres: Sphere[] = [];

  constructor(
    private owner: BabyOwner,
    readonly index: number,
    x: number,
    z: number,
    hp: number,
  ) {
    this.hp = hp;
    this.maxHp = hp;
    // 하늘 높이에서 60° 로 비스듬히 내려온다: 착지점에서 바깥쪽으로 H / tan60° 떨어진 곳이 출발점
    this.land.set(x, 0, z);
    const ol = Math.hypot(x, z) || 1;
    const H = B.drop.height;
    const away = H / Math.tan((B.drop.angle * Math.PI) / 180);
    this.from.set(x + (x / ol) * away, H, z + (z / ol) * away);
    this.pos.copy(this.from);
    this.vy = 0;
    this.yaw = Math.atan2(this.land.x - this.from.x, this.land.z - this.from.z);
    this.pitch = -(B.drop.angle * Math.PI) / 180;
    this.seq = index === 0 ? ['spit', 'bite', 'orbit', 'swoop', 'bite', 'spit', 'orbit', 'swoop'] : ['bite', 'orbit', 'swoop', 'spit', 'bite', 'orbit', 'spit', 'swoop'];
    this.seqI = 0;
    this.attackT = 1.2 + index * 1.7;
    this.rig = new DragonRig(owner.host.scene, { light: false, gems: false });
    this.rig.group.scale.setScalar(S);
    this.rig.tailK = B.tail;
    this.rig.wing.hz = 1;
    this.rig.layoutLine(this.from.x / S, this.from.y / S, this.from.z / S, this.yaw, this.pitch);
    this.rig.setRage(0);
    for (let i = 0; i < this.rig.parts.length; i++) this.spheres.push({ x: 0, y: 0, z: 0, r: 1 });
    // 떨어질 자리 표시
    owner.host.fx.telegraphs.circle(x, z, 3.2, B.drop.time, () => {});
    owner.host.targets.push(this);
    this.sync(0);
  }

  get invulnerable() {
    return this.state === 'drop' || this.state === 'dying';
  }
  get attacking() {
    return this.state === 'bite' || this.state === 'spit' || this.state === 'swoop' || this.state === 'orbit';
  }
  get dazed() {
    return this.state === 'daze';
  }
  get groundPos() {
    return this.tmp3.set(this.pos.x, 0, this.pos.z);
  }

  /* ───────────────────────── 보조 ───────────────────────── */
  private fwd(out: THREE.Vector3) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  private mouthPos(out: THREE.Vector3) {
    return this.rig.mouth(out);
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
  private next(): Atk {
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
        case 'orbit':
          this.updateOrbit(dt);
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
    const k = Math.min(1, this.t / B.drop.time);
    this.pos.x = this.from.x + (this.land.x - this.from.x) * k;
    this.pos.z = this.from.z + (this.land.z - this.from.z) * k;
    this.pos.y = this.from.y + (this.hy - this.from.y) * k;
    this.speed = 50;
    this.flap.fold = 1;
    this.jaw = 0.8;
    void dt;
    if (k >= 1) {
      this.pos.set(this.land.x, this.hy, this.land.z);
      this.pitch = 0;
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
    this.hy = approach(this.hy, 1.5 + Math.sin(this.t * 6) * 0.06, 8, dt);
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
    if (this.attackT <= 0) {
      // 두 마리가 동시에 공격하지 않는다
      if (this.owner.babyList().some((o) => o !== this && o.alive && o.attacking)) this.attackT = 0.4;
      else this.startAttack(this.next());
    }
  }

  private startAttack(a: Atk) {
    this.state = a;
    this.sub = 0;
    this.t = 0;
    this.speed = 0;
    const { host } = this.owner;
    this.ringDone = false;
    if (a === 'bite') {
      this.dir.set(0, 0, 0);
      this.biteLeft = B.bite.count;
      this.tellScale = 1;
      host.sfx.telegraph();
    } else if (a === 'orbit') {
      this.roar(1);
      host.sfx.telegraph();
    } else if (a === 'swoop') {
      this.roar(0.9);
    }
  }

  /** 돌진: 웅크려 노려보다(예고선) → 일직선으로 내달려 물어뜯는다 */
  private updateBite(dt: number) {
    const { host } = this.owner;
    const tell = (B.bite.tell / this.rage) * this.tellScale;
    if (this.sub === 0) {
      const toP = this.angToPlayer();
      if (this.t < tell * 0.6) this.turn(toP, 9, dt);
      this.hy = approach(this.hy, 1.2, 10, dt);
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
    this.hy = 1.3;
    this.pos.y = this.hy;
    this.clampArena();
    this.jaw = 1;
    if (this.t > 0.06) {
      host.fx.particles.burst(this.tmp2.set(this.pos.x, 0.4, this.pos.z), 0x8a6a4a, 2, 5, 0.5, 0.3, 0.3, 3, 1.2);
      host.fx.particles.burst(this.tmp2.set(this.pos.x, 0.8, this.pos.z), 0xff8a2a, 2, 4, 0.6, 0.2, 0.4, 1, 1.8);
    }
    // 지나간 자리에 불길이 남는다
    this.trailAcc += step;
    if (this.trailAcc >= B.bite.trail) {
      this.trailAcc = 0;
      this.owner.field.burn(this.pos.x, this.pos.z, 1.7, B.bite.trailLife);
    }
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (this.runLeft <= 0 || rr > WORLD.radius - 2.3) {
      this.strike = false;
      if (--this.biteLeft > 0) {
        // 곧바로 방향을 고쳐 다시 겨눈다
        this.sub = 0;
        this.t = 0;
        this.dir.set(0, 0, 0);
        this.tellScale = 0.62;
        this.roar(0.8);
        return;
      }
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
    this.hy = approach(this.hy, 3.4, 6, dt);
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
      field.lob(M, tgt, B.spit.flight, B.spit.peak, B.spit.radius, B.spit.zone);
      if (B.spit.ring > 0 && this.shots === n && !this.ringDone) {
        // 마지막: 표적 둘레를 불덩이 고리로 가둔다
        this.ringDone = true;
        const base = Math.random() * TAU;
        for (let k = 0; k < B.spit.ring; k++) {
          const a = base + (k / B.spit.ring) * TAU;
          const q = this.tmp3.set(pl.x + Math.cos(a) * 5.5, 0, pl.z + Math.sin(a) * 5.5);
          const rq = Math.hypot(q.x, q.z);
          if (rq > WORLD.radius - 1) {
            q.x *= (WORLD.radius - 1) / rq;
            q.z *= (WORLD.radius - 1) / rq;
          }
          field.lob(M, q, B.spit.flight + 0.15, B.spit.peak + 2, B.spit.radius, B.spit.zone);
        }
      }
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
    const pl = player.pos;
    // 내리꽂기 전에 머무는 높은 지점 H: 플레이어에게서 C.back 만큼 떨어진 하늘. 몸 전체가 비스듬히 내려꽂히도록 높이와 거리를 함께 잡는다
    const hover = (out: THREE.Vector3) => {
      let dx = this.pos.x - pl.x;
      let dz = this.pos.z - pl.z;
      let l = Math.hypot(dx, dz);
      if (l < 1e-3) {
        dx = 1;
        dz = 0;
        l = 1;
      }
      out.set(pl.x + (dx / l) * C.back, C.alt, pl.z + (dz / l) * C.back);
      const r = Math.hypot(out.x, out.z);
      if (r > WORLD.radius - 1) {
        // 벽 쪽이면 안쪽(중앙 쪽)에서 내려온다
        const cl = Math.hypot(pl.x, pl.z) || 1;
        out.set(pl.x - (pl.x / cl) * C.back, C.alt, pl.z - (pl.z / cl) * C.back);
      }
      return out;
    };
    if (this.sub === 0) {
      // 날갯짓으로 높이 떠올라 H 로 간다
      const H = hover(this.tmp2);
      const dx = H.x - this.pos.x;
      const dz = H.z - this.pos.z;
      const dd = Math.hypot(dx, dz);
      this.turn(Math.atan2(dx, dz), 5, dt);
      const stepD = Math.min(dd, 20 * dt);
      if (dd > 1e-3) {
        this.pos.x += (dx / dd) * stepD;
        this.pos.z += (dz / dd) * stepD;
      }
      this.speed = stepD / Math.max(dt, 1e-4);
      this.hy = approach(this.hy, C.alt, 2.2, dt);
      this.pos.y = this.hy;
      this.pitch = approach(this.pitch, 0.5, 3, dt);
      this.flap.fold = approach(this.flap.fold, 0, 8, dt);
      this.flap.hz = 1.6;
      this.flap.amp = 0.95;
      this.jaw = approach(this.jaw, 0.4, 5, dt);
      this.lookYaw = approach(this.lookYaw, 0, 8, dt);
      if (this.t >= C.climb) {
        this.sub = 1;
        this.t = 0;
        this.goal.set(pl.x, 0, pl.z);
        const r = Math.hypot(this.goal.x, this.goal.z);
        if (r > WORLD.radius - 2) {
          this.goal.x *= (WORLD.radius - 2) / r;
          this.goal.z *= (WORLD.radius - 2) / r;
        }
        this.from.copy(hover(this.tmp2));
        this.from.x = this.goal.x + (this.from.x - pl.x);
        this.from.z = this.goal.z + (this.from.z - pl.z);
        host.fx.telegraphs.circle(this.goal.x, this.goal.z, C.radius, tell, () => {});
        host.sfx.telegraph();
        this.roar(1);
      }
      return;
    }
    if (this.sub === 1) {
      // H 에서 표적을 겨눈다 (몸을 표적 쪽으로 기울인다)
      const k = 1 - Math.exp(-6 * dt);
      const ox = this.pos.x;
      const oz = this.pos.z;
      this.pos.x += (this.from.x - this.pos.x) * k;
      this.pos.z += (this.from.z - this.pos.z) * k;
      this.hy = approach(this.hy, C.alt + Math.sin(this.t * 6) * 0.4, 6, dt);
      this.pos.y = this.hy;
      this.speed = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
      this.turn(Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z), 7, dt);
      const down = Math.atan2(C.alt - 1.3, Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z));
      this.pitch = approach(this.pitch, -down * (0.3 + 0.7 * Math.min(1, this.t / tell)), 5, dt);
      this.flap.hz = 1.8;
      this.flap.amp = 0.9;
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
    // 내리꽂기: H → 표적을 한 줄로 날아 내려 몸 전체가 같은 길을 따라온다
    const k = Math.min(1, this.t / C.dive);
    const e = k * (0.4 + 0.6 * k);
    const ox = this.pos.x;
    const oz = this.pos.z;
    this.pos.x = this.from.x + (this.goal.x - this.from.x) * e;
    this.pos.z = this.from.z + (this.goal.z - this.from.z) * e;
    this.pos.y = this.from.y + (1.3 - this.from.y) * e;
    this.hy = this.pos.y;
    this.yaw = Math.atan2(this.goal.x - this.from.x, this.goal.z - this.from.z);
    this.pitch = -Math.atan2(this.from.y - 1.3, Math.hypot(this.goal.x - this.from.x, this.goal.z - this.from.z));
    this.flap.fold = approach(this.flap.fold, 1, 14, dt);
    this.speed = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    if (k >= 1) {
      this.strike = false;
      host.shake(1.1, 0.25);
      host.sfx.land();
      host.hitStop(0.05);
      field.explode(this.goal.x, this.goal.z, C.radius, false);
      host.fx.ring(this.goal.x, this.goal.z, C.radius * 2.6, 0.6, 0xffb060);
      host.fx.particles.burst(this.tmp.set(this.goal.x, 0.6, this.goal.z), 0x7a5a42, 40, 10, 0.9, 0.4, 0.5, 6, 1.2);
      field.wave(this.goal.x, this.goal.z, C.wave, C.waveSpeed, 1.2);
      const d = Math.hypot(pl.x - this.goal.x, pl.z - this.goal.z);
      if (d < 9) player.push(this.goal.x, this.goal.z, 5 * (1 - d / 9) + 1.5);
      this.state = 'daze';
      this.dazeT = B.daze + 0.3;
      this.sub = 0;
      this.pitch = -0.1;
    }
  }

  /** 외곽 선회 사격: 맵 가장자리를 달리며 불덩이를 흩뿌린다 (표적 둘레에 흩어 던지고, 가끔 곧장 겨눈다) */
  private updateOrbit(dt: number) {
    const { host, field, player } = this.owner;
    const C = B.orbit;
    const R = WORLD.radius - 4.5;
    const pl = player.pos;
    this.hy = approach(this.hy, 1.5, 8, dt);
    this.pos.y = this.hy;
    this.flap.fold = approach(this.flap.fold, 0.9, 6, dt);
    this.flap.hz = 0.5;
    this.flap.amp = 0.2;
    this.pitch = approach(this.pitch, 0.05, 6, dt);
    this.jaw = approach(this.jaw, 0.6, 6, dt);
    if (this.sub === 0) {
      // 가장자리 고리로 달려간다
      const a = Math.atan2(this.pos.z, this.pos.x);
      const gx = Math.cos(a) * R;
      const gz = Math.sin(a) * R;
      const dx = gx - this.pos.x;
      const dz = gz - this.pos.z;
      const dd = Math.hypot(dx, dz);
      this.turn(Math.atan2(dx, dz), 8, dt);
      const sp = Math.min(dd / Math.max(dt, 1e-4), C.speed * this.rage);
      this.pos.x += (dx / (dd || 1)) * sp * dt;
      this.pos.z += (dz / (dd || 1)) * sp * dt;
      this.speed = sp;
      this.gait += dt * sp * 0.55;
      if (dd < 1.2) {
        this.sub = 1;
        this.t = 0;
        this.orbA = a;
        this.orbDir = Math.random() < 0.5 ? 1 : -1;
        this.orbTravel = 0;
        this.shotT = 0.25;
        this.shotN = 0;
        this.fireK = 1;
        host.sfx.flame(1.2, 0.5);
      }
      return;
    }
    const w = (C.speed * this.rage) / R;
    this.orbA += this.orbDir * w * dt;
    this.orbTravel += w * dt;
    const ox = this.pos.x;
    const oz = this.pos.z;
    this.pos.x = Math.cos(this.orbA) * R;
    this.pos.z = Math.sin(this.orbA) * R;
    this.speed = Math.hypot(this.pos.x - ox, this.pos.z - oz) / Math.max(dt, 1e-4);
    this.yaw = wrapPi(Math.atan2(-Math.sin(this.orbA) * this.orbDir, Math.cos(this.orbA) * this.orbDir));
    this.gait += dt * this.speed * 0.55;
    this.lookYaw = approach(this.lookYaw, clamp(wrapPi(this.angToPlayer() - this.yaw), -1.1, 1.1), 8, dt);
    this.fireK = approach(this.fireK, 0.8, 6, dt);
    this.shotT -= dt;
    if (this.shotT <= 0) {
      this.shotT += C.interval / this.rage;
      const M = this.mouthPos(this.tmp);
      const n = this.shotN++;
      const q = this.tmp3;
      if (n % 4 === 0) {
        q.set(pl.x, 0, pl.z); // 곧장 겨눈다
      } else {
        const a = Math.random() * TAU;
        const r = C.minR + Math.random() * (C.maxR - C.minR); // 둘레에 흩뿌린다
        q.set(pl.x + Math.cos(a) * r, 0, pl.z + Math.sin(a) * r);
      }
      const rq = Math.hypot(q.x, q.z);
      if (rq > WORLD.radius - 1) {
        q.x *= (WORLD.radius - 1) / rq;
        q.z *= (WORLD.radius - 1) / rq;
      }
      field.lob(M, q, C.flight, 6, C.radius, C.zone);
      host.sfx.spit();
      host.fx.particles.burst(M, 0xffb040, 8, 6, 0.4, 0.2, 0.3, 2, 2);
      this.jaw = 1;
    }
    if (this.orbTravel >= C.laps * TAU) {
      this.fireK = 0;
      this.state = 'prowl';
      this.attackT = this.gap();
    }
  }

  /** 어지러움: 머리를 늘어뜨리고 비틀거린다 — 머리 피해가 크게 늘어나는 공격 기회 */
  private updateDaze(dt: number) {
    const { host } = this.owner;
    this.dazeT -= dt;
    this.speed = approach(this.speed, 0, 6, dt);
    this.walk(this.speed * 0.5, dt);
    this.hy = approach(this.hy, 1.2, 8, dt);
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
    const ps = this.rig.parts;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].kind === 'wing') continue;
      const s = this.spheres[i];
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
    this.hy = approach(this.hy, 1.0, 5, dt);
    this.pos.y = this.hy;
    this.pitch = approach(this.pitch, -0.5, 4, dt);
    this.yaw += dt * 2.2;
    this.flap.hz = 3;
    this.flap.amp = 0.7;
    this.speed = 0;
    for (let i = 0; i < 2; i++) {
      this.bodyPt(Math.floor(Math.random() * this.rig.rings), this.tmp2);
      host.fx.particles.burst(this.tmp2, Math.random() < 0.5 ? 0xff5a1a : 0xffc060, 4, 6, 0.8, 0.3, 0.6, 3, 2);
    }
    if (this.t > 0.9) {
      host.fx.burstLight(this.tmp.set(this.pos.x, 1.2, this.pos.z), 0xffc070, 300, 1.0);
      host.fx.ring(this.pos.x, this.pos.z, 12, 0.7, 0xffd27a);
      host.sfx.explosion(true);
      host.shake(1.4, 0.3);
      for (let i = 0; i < this.rig.rings; i += 10) {
        this.bodyPt(i, this.tmp2);
        host.fx.particles.burst(this.tmp2, 0xff4a2a, 10, 10, 1.0, 0.36, 0.8, 4, 2);
        host.fx.particles.burst(this.tmp2, 0xffd060, 5, 8, 0.8, 0.28, 0.8, 4, 2);
      }
      this.rig.explodeHide();
      this.gone = true;
      this.owner.babyDown(this);
    }
  }

  /* ───────────────────────── 그리기 ───────────────────────── */
  /** i 번째 마디의 월드 위치 */
  private bodyPt(i: number, out: THREE.Vector3) {
    this.rig.ring(i, out);
    return out.multiplyScalar(S);
  }

  private sync(dt: number) {
    const r = this.rig;
    // 선회 기울기
    const yr = wrapPi(this.yaw - this.lastYaw) / Math.max(dt, 1e-4);
    this.lastYaw = this.yaw;
    this.yawRate = approach(this.yawRate, dt > 0 ? yr : 0, 8, dt || 1);
    this.bank = approach(this.bank, this.pos.y > 3 ? clamp(this.yawRate * 0.5, -0.7, 0.7) : 0, 4, dt || 1);
    r.head.set(this.pos.x / S, this.pos.y / S, this.pos.z / S);
    r.yaw = this.yaw;
    r.pitch = this.pitch;
    r.bank = this.bank;
    r.lookYaw = this.lookYaw;
    r.jaw = this.jaw;
    r.fire = this.fireK;
    r.stunned = this.state === 'daze';
    r.legGait = (this.state === 'bite' || this.state === 'orbit') && this.sub === 1;
    r.gaitHz = 2.4;
    r.undulate = 0.5 + 0.4 * clamp(this.speed / 10, 0, 1) + (this.state === 'dying' ? 0.7 : 0);
    r.wing.hz = this.flap.hz;
    r.wing.amp = this.flap.amp;
    r.wing.fold = this.flap.fold;
    r.wing.raise = 0.1;
    r.wing.spread = 1;
    r.update(dt);
    // 판정 구 (월드)
    const ps = r.parts;
    for (let i = 0; i < ps.length; i++) {
      const s = this.spheres[i];
      s.x = ps[i].x * S;
      s.y = ps[i].y * S;
      s.z = ps[i].z * S;
      s.r = ps[i].r * S * B.hitK + 0.25;
    }
    // 날갯짓 소리 (공중에 떠 있을 때만)
    if (this.alive && this.pos.y > 3 && this.flap.fold < 0.5) {
      this.beatT += dt * this.flap.hz;
      if (this.beatT >= 1) {
        this.beatT -= 1;
        const d = this.distToPlayer();
        this.owner.host.sfx.wingbeat(clamp(0.9 - d / 45, 0.12, 0.6));
      }
    }
  }
  private lastYaw = 0;

  flash() {
    this.flashT = 0.08;
    this.rig.flash(1);
  }

  /* ───────────────────────── 판정 (Target) ───────────────────────── */
  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive) return 0;
    let kind: 'head' | 'body' | 'wing' | null = null;
    const ps = this.rig.parts;
    for (let i = 0; i < ps.length; i++) {
      const s = this.spheres[i];
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dz = p.z - s.z;
      const rr = s.r + r;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        const k = ps[i].kind;
        if (k === 'head') {
          kind = 'head'; // 아기 용은 머리만 약점
          break;
        }
        if (!kind) kind = k === 'chest' ? 'body' : k;
      }
    }
    if (!kind) return 0;
    if (this.invulnerable) {
      this.owner.babyBlocked();
      return BLOCKED;
    }
    if (kind === 'head') return this.owner.babyDamage(this, dmg * (this.dazed ? D.exposedMult : D.headMult), this.dazed ? 'exposed' : 'weak', p);
    if (kind === 'wing') return this.owner.babyDamage(this, dmg * D.wingMult, 'body', p);
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
    return this.alive ? this.spheres : [];
  }

  dispose() {
    this.owner.host.targets = this.owner.host.targets.filter((x) => x !== this);
    this.rig.dispose();
  }
}
