import * as THREE from 'three';
import { CFG } from '../../config';
import { Projectiles } from '../../projectiles';
import { BLOCKED, type BossInfo, type Circle, type FloatKind, type Host, type Target } from '../../types';
import type { Player } from '../../player';
import { SpiderRig, type PoseName } from './rig';
import { buildAttack, type AttackName, type AttackScript } from './attacks';
import { Baby, Egg, type Minion, type MinionOwner } from './minions';

const V3 = THREE.Vector3;
const S = CFG.spider;

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

type State = 'enter' | 'idle' | 'attack' | 'dead';
export type FaceMode = 'track' | 'hold' | 'to';

interface Jump {
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  peak: number;
  onLand: () => void;
}

/**
 * 보스 1 — 동굴 여왕 거미.
 *
 *  모델/모션: SpiderRig (구·원통·원뿔 + 2본 IK 다리 8개 + 발걸음 + 포즈 블렌딩)
 *  공격:      attacks.ts 의 "시간표" (예비동작 → 공격 → 후딜)
 *  이 클래스는 상태머신(등장/대기/공격/사망), 페이즈, 판정, 점프, 미니언 관리를 맡는다.
 */
export class Spider implements Target, BossInfo, MinionOwner {
  readonly rig: SpiderRig;
  readonly projectiles: Projectiles;
  readonly phaseMarks = [S.phase2At];
  readonly maxHp: number = S.maxHp;

  hp: number = S.maxHp;
  alive = true;
  exposed = false;
  /** 등장 연출이 끝나 전투가 시작됐는가 */
  ready = false;
  attacksOn = true;
  invulnerable = false;
  phaseIndex = 0;

  faceMode: FaceMode = 'track';
  faceYaw = 0;
  faceRate = 3;
  currentAttack: AttackName | null = null;

  onDeath: () => void = () => {};

  private state: State = 'enter';
  private t = 0;
  private vel = new V3();
  private idleT = 1;
  private script: AttackScript | null = null;
  private scriptT = 0;
  private stepIdx = 0;
  private jump: Jump | null = null;
  private seqIdx = 0;
  private phaseTrigger = false;
  private staggerQueued = false;
  private clutchKills = 0;
  private minions: Minion[] = [];
  private forced: AttackName | null = null;
  private lastNum = 0;
  private lastBlockSfx = 0;

  // 등장 연출
  private enterMode: 'drop' | 'rise' | 'stand' = 'drop';
  private enterT = 0;
  private fallV = 0;
  private stoodUp = false;

  private tmp = new V3();

  /** drop: 천장에서 떨어지는 첫 등장 / false: 재도전 때의 짧은 기상 */
  constructor(
    readonly host: Host,
    readonly player: Player,
    drop = true,
  ) {
    this.rig = new SpiderRig(host.scene);
    this.projectiles = new Projectiles(host, player, 120);
    host.targets.push(this);
    this.intro(drop);
  }

  /* ───────────────────────── 접근자 ───────────────────────── */
  get name() {
    return this.phaseIndex ? `${S.name} · 분노` : S.name;
  }
  get pos() {
    return this.rig.pos;
  }
  /** 공격 스크립트가 쓰는 예비동작 길이 배율 */
  get tempo() {
    return S.tempo[this.phaseIndex];
  }
  get airborne() {
    return this.jump !== null || (this.state === 'enter' && this.enterMode === 'drop');
  }
  get status() {
    return `${this.state}${this.currentAttack ? ':' + this.currentAttack : ''}`;
  }

  setPose(name: PoseName, rate?: number) {
    this.rig.setPose(name, rate);
  }
  setExposed(on: boolean) {
    this.exposed = on;
    this.rig.setExposed(on);
  }

  /* ───────────────────────── 등장 ───────────────────────── */
  private intro(drop: boolean) {
    this.state = 'enter';
    this.enterT = 0;
    this.ready = false;
    this.stoodUp = false;
    this.invulnerable = true;
    this.rig.yaw = 0;
    if (drop) {
      this.enterMode = 'drop';
      this.fallV = 0;
      this.rig.pos.y = 28;
      this.rig.snapPose('air');
      this.host.sfx.bossIntro();
    } else {
      this.enterMode = 'stand';
      this.rig.pos.y = 0;
      this.rig.snapPose('stagger');
      this.rig.snapFeet();
    }
  }

  private updateEnter(dt: number) {
    this.enterT += dt;
    this.faceToPlayer(dt, 2);
    if (this.enterMode === 'drop') {
      this.fallV += 62 * dt;
      this.rig.pos.y = Math.max(0, this.rig.pos.y - this.fallV * dt);
      if (this.rig.pos.y <= 0) {
        const { host, player } = this;
        this.enterMode = 'rise';
        this.enterT = 0;
        host.shake(1.5);
        host.hitStop(0.07);
        host.sfx.land();
        host.fx.ring(this.pos.x, this.pos.z, 10, 0.7, 0xffb36b);
        host.fx.burstLight(new V3(this.pos.x, 1.5, this.pos.z), 0xffa060, 120, 0.5);
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = 2 + Math.random() * 5;
          host.fx.particles.burst(new V3(this.pos.x + Math.cos(a) * d, 0.2, this.pos.z + Math.sin(a) * d), 0xb8a58a, 3, 5, 0.6, 0.2, 0.7);
        }
        const pd = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        if (pd < 11) player.push(this.pos.x, this.pos.z, 12 * (1 - pd / 11) + 3);
        this.setPose('splay', 30);
        this.rig.slideFeet(1.38, 0.12);
      }
      return;
    }
    const standAt = this.enterMode === 'rise' ? 0.9 : 0.35;
    if (!this.stoodUp && this.enterT >= standAt) {
      this.stoodUp = true;
      this.setPose('idle', 3);
    }
    if (this.enterT >= standAt + 0.9) this.finishIntro();
  }

  private finishIntro() {
    this.state = 'idle';
    this.ready = true;
    this.invulnerable = false;
    this.idleT = 0.9;
    this.host.sfx.drone(true, 0);
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    this.t += dt;
    this.projectiles.update(dt);
    for (const m of [...this.minions]) m.update(dt);

    if (this.state === 'dead') {
      this.rig.update(dt);
      return;
    }

    if (this.jump) this.updateJump(dt);

    switch (this.state) {
      case 'enter':
        this.updateEnter(dt);
        break;
      case 'idle':
        this.updateIdle(dt);
        break;
      case 'attack':
        this.updateAttack(dt);
        break;
    }

    // 아레나 안에 가두기 (발끝이 벽을 넘지 않게)
    const lim = CFG.arena.radius - 5;
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > lim) {
      this.pos.x *= lim / d;
      this.pos.z *= lim / d;
    }

    this.rig.vel.copy(this.vel);
    this.rig.update(dt);
  }

  private updateIdle(dt: number) {
    this.faceToPlayer(dt, S.turn[this.phaseIndex]);
    this.walk(dt);
    this.idleT -= dt;
    if (!this.attacksOn || this.idleT > 0) return;
    const err = Math.abs(wrapPi(this.yawToPlayer() - this.rig.yaw));
    if (err > 0.55 && this.idleT > -1.6) return; // 대충 마주 본 뒤에 공격
    this.startAttack(this.pickNext());
  }

  /** 플레이어와의 거리를 유지하며 걷는다 (멀면 다가오고, 너무 가까우면 물러남) */
  private walk(dt: number) {
    const pl = this.player;
    const dx = pl.pos.x - this.pos.x;
    const dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const sp = S.speed[this.phaseIndex];
    let want = 0;
    if (d > S.holdDist + 0.8) want = sp;
    else if (d < 4.5) want = -sp * 0.55;
    const k = 1 - Math.exp(-6 * dt);
    this.vel.x += ((dx / d) * want - this.vel.x) * k;
    this.vel.z += ((dz / d) * want - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }

  private yawToPlayer() {
    return yawOf(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }

  private faceToPlayer(dt: number, rate: number) {
    this.turnTo(dt, this.yawToPlayer(), rate);
  }

  private turnTo(dt: number, goal: number, rate: number) {
    const e = wrapPi(goal - this.rig.yaw);
    const maxStep = rate * dt * (1 + Math.abs(e) * 1.2);
    this.rig.yaw += Math.max(-maxStep, Math.min(maxStep, e));
  }

  /* ───────────────────────── 공격 실행 ───────────────────────── */
  private pickNext(): AttackName {
    if (this.phaseTrigger) {
      this.phaseTrigger = false;
      return 'roar';
    }
    if (this.staggerQueued) {
      this.staggerQueued = false;
      return 'stagger';
    }
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      return f;
    }
    const seq = S.sequence[this.phaseIndex];
    for (let tries = 0; tries < seq.length; tries++) {
      const name = seq[this.seqIdx++ % seq.length] as AttackName;
      // 이미 알/새끼가 많으면 알 투척은 건너뜀
      if (name === 'eggs' && this.minions.length >= 3) continue;
      return name;
    }
    return 'web';
  }

  private startAttack(name: AttackName) {
    const sc = buildAttack(name, this);
    sc.steps.sort((a, b) => a.at - b.at);
    this.script = sc;
    this.scriptT = 0;
    this.stepIdx = 0;
    this.currentAttack = name;
    this.state = 'attack';
    this.faceMode = 'track';
    this.faceRate = 3;
  }

  private updateAttack(dt: number) {
    const sc = this.script;
    if (!sc) {
      this.endAttack();
      return;
    }
    // 점프 중이 아니면 서서히 멈춘다
    if (!this.jump) {
      this.vel.multiplyScalar(Math.exp(-7 * dt));
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }
    if (this.faceMode === 'track') this.faceToPlayer(dt, this.faceRate);
    else if (this.faceMode === 'to') this.turnTo(dt, this.faceYaw, this.faceRate);

    this.scriptT += dt;
    while (this.stepIdx < sc.steps.length && sc.steps[this.stepIdx].at <= this.scriptT) sc.steps[this.stepIdx++].fn();
    if (this.scriptT >= sc.end && !this.jump) this.endAttack();
  }

  private endAttack() {
    this.script = null;
    this.currentAttack = null;
    this.state = 'idle';
    this.idleT = S.idlePause[this.phaseIndex];
    this.faceMode = 'track';
    this.invulnerable = false;
    this.setExposed(false);
    this.setPose('idle', 4);
  }

  /** 디버그: 대기 중이면 다음 공격을 즉시 지정, 공격 중이면 끊고 시작 */
  forceAttack(name: AttackName) {
    if (!this.alive || this.state === 'enter') return;
    if (this.state === 'attack') this.abortAttack();
    this.forced = name;
    this.idleT = 0;
  }

  private abortAttack() {
    this.script = null;
    this.jump = null;
    this.rig.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.host.fx.telegraphs.clear();
    this.currentAttack = null;
    this.state = 'idle';
    this.idleT = 0;
    this.faceMode = 'track';
    this.invulnerable = false;
    this.setExposed(false);
    this.setPose('idle', 6);
    this.rig.snapFeet(1);
  }

  /* ───────────────────────── 점프 ───────────────────────── */
  startJump(to: THREE.Vector3, dur: number, peak: number, onLand: () => void) {
    this.jump = {
      t: 0,
      dur,
      from: new V3(this.pos.x, 0, this.pos.z),
      to: to.clone(),
      peak,
      onLand,
    };
    this.vel.set(0, 0, 0);
    this.setPose('air', 22);
  }

  private updateJump(dt: number) {
    const j = this.jump!;
    j.t += dt;
    const k = Math.min(1, j.t / j.dur);
    this.pos.x = j.from.x + (j.to.x - j.from.x) * k;
    this.pos.z = j.from.z + (j.to.z - j.from.z) * k;
    this.pos.y = j.peak * 4 * k * (1 - k);
    if (k >= 1) {
      this.pos.y = 0;
      const cb = j.onLand;
      this.jump = null;
      cb();
    }
  }

  /* ───────────────────────── 페이즈 ───────────────────────── */
  /** 포효 시작 시 호출 (attacks.ts) */
  beginPhase2() {
    this.phaseIndex = 1;
    this.seqIdx = 0;
    this.invulnerable = true;
    this.host.sfx.drone(true, 1);
  }

  /* ───────────────────────── 판정 (Target) ───────────────────────── */
  bodies(): Circle[] {
    if (!this.alive || this.airborne) return [];
    return [this.rig.thorax, this.rig.abdomenC];
  }

  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive || this.airborne) return 0;

    // 1) 발끝이 화살을 막는다
    const leg = this.rig.legBlock(p, r);
    if (leg >= 0) {
      this.rig.flashLeg(leg);
      this.blockSfx();
      return BLOCKED;
    }

    // 2) 몸통 / 배
    const th = this.rig.thorax;
    const ab = this.rig.abdomenC;
    const inT = Math.hypot(p.x - th.x, p.z - th.z) < th.r + r;
    const inA = Math.hypot(p.x - ab.x, p.z - ab.z) < ab.r + r;
    if (!inT && !inA) return 0;
    if (this.invulnerable) {
      this.blockSfx();
      return BLOCKED;
    }
    const weak = inA && !inT;
    const mult = weak ? (this.exposed ? S.exposedMult : S.weakMult) : 1;
    const kind = !weak ? 'normal' : this.exposed ? 'exposed' : 'weak';
    return this.damage(dmg * mult, kind);
  }

  hitRadial(c: THREE.Vector3, radius: number, dmg: number) {
    if (!this.alive || this.airborne || this.invulnerable) return;
    const th = this.rig.thorax;
    const ab = this.rig.abdomenC;
    if (Math.hypot(c.x - th.x, c.z - th.z) < radius + th.r || Math.hypot(c.x - ab.x, c.z - ab.z) < radius + ab.r) this.damage(dmg, 'special');
  }

  private blockSfx() {
    if (this.t - this.lastBlockSfx > 0.06) {
      this.host.sfx.block();
      this.lastBlockSfx = this.t;
    }
  }

  private damage(amount: number, kind: 'normal' | 'weak' | 'exposed' | 'special'): number {
    // 페이즈 1에서는 50% 아래로 내려가지 않고, 포효(페이즈 전환)를 예약한다
    let nh = this.hp - amount;
    if (this.phaseIndex === 0 && nh <= this.maxHp * S.phase2At) {
      nh = this.maxHp * S.phase2At;
      this.phaseTrigger = true;
    }
    this.hp = Math.max(0, nh);
    if (kind === 'special') this.rig.flashAll();
    else this.rig.flashPart(kind === 'normal' ? 'thorax' : 'abdomen');
    const strong = kind !== 'normal';
    this.host.sfx.hit(strong);
    if (strong || this.t - this.lastNum > 0.22) {
      this.lastNum = this.t;
      const where = kind === 'special' ? this.tmp.set(this.pos.x, 4, this.pos.z) : this.tmp.set(this.rig.abdomenC.x, 3.4, this.rig.abdomenC.z);
      this.host.floatText(where, String(Math.round(amount)) + (kind === 'exposed' ? '!' : ''), kind as FloatKind);
    }
    if (strong) {
      this.host.hitStop(0.035);
      this.host.shake(0.18);
    }
    if (this.hp <= 0) this.die();
    return amount;
  }

  /* ───────────────────────── 사망: 마디별 분해 ───────────────────────── */
  private die() {
    if (this.state === 'dead') return;
    const { host } = this;
    this.alive = false;
    this.state = 'dead';
    this.script = null;
    this.jump = null;
    this.setExposed(false);
    host.fx.telegraphs.clear();
    this.projectiles.clear();
    for (const m of [...this.minions]) m.vanish(true);
    this.minions = [];

    const c = new V3(this.pos.x, 2.2, this.pos.z);
    host.hitStop(0.22);
    host.slowmo(0.28, 1.5);
    host.shake(1.8);
    host.sfx.bossDeath();
    host.sfx.drone(false);
    host.fx.ring(this.pos.x, this.pos.z, 16, 1.1, 0xffd27a);
    host.fx.ring(this.pos.x, this.pos.z, 9, 0.7, 0xffffff, 0.09);
    host.fx.burstLight(c, 0xffc070, 220, 1.1);
    host.fx.particles.burst(c, 0xff4a2a, 120, 15, 1.3, 0.3, 0.9);
    host.fx.particles.burst(c, 0xffa020, 80, 11, 1.1, 0.24, 0.8);
    host.fx.particles.burst(c, 0xffe06a, 40, 9, 1.0, 0.2, 0.8);
    this.rig.explode(1);
    this.onDeath();
  }

  /* ───────────────────────── 알 / 새끼 (MinionOwner) ───────────────────────── */
  addMinion(m: Minion) {
    this.minions.push(m);
    this.host.targets.push(m);
  }

  minionGone(m: Minion, byPlayer: boolean) {
    this.minions = this.minions.filter((x) => x !== m);
    this.host.targets = this.host.targets.filter((x) => x !== m);
    if (byPlayer) this.clutchKills++;
    // 알/새끼를 하나라도 잡고 전부 정리하면 여왕이 휘청인다 (다음 대기 시점에 발동)
    if (this.minions.length === 0 && this.clutchKills > 0) {
      this.clutchKills = 0;
      if (this.alive && this.phaseIndex > 0) this.staggerQueued = true;
    }
  }

  spawnBabies(x: number, z: number, n: number) {
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      if (this.minions.length >= S.eggs.maxMinions) break;
      const a = base + (i / n) * Math.PI * 2;
      const tx = x + Math.cos(a) * 1.5;
      const tz = z + Math.sin(a) * 1.5;
      this.addMinion(new Baby(this.host, this, this.player, x, z, tx, tz));
    }
  }

  babies(): Baby[] {
    return this.minions.filter((m): m is Baby => m.kind === 'baby');
  }

  throwEgg(to: THREE.Vector3) {
    const from = this.rig.muzzle(new V3());
    this.addMinion(new Egg(this.host, this, from, to));
  }

  /* ───────────────────────── 디버그 ───────────────────────── */
  setHpFrac(f: number) {
    if (!this.alive) return;
    this.hp = Math.max(1, this.maxHp * f);
    if (this.phaseIndex === 0 && this.hp <= this.maxHp * S.phase2At) {
      this.hp = this.maxHp * S.phase2At;
      this.phaseTrigger = true;
    }
  }

  dispose() {
    for (const m of this.minions) m.vanish(false);
    this.minions = [];
    this.projectiles.dispose();
    this.rig.dispose();
    this.host.sfx.drone(false);
    this.host.targets = this.host.targets.filter((t) => t !== this);
  }
}
