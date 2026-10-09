import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import { Projectiles } from '../../projectiles';
import { BLOCKED, type Boss, type Circle, type FloatKind, type Host, type Sphere } from '../../types';
import type { Player } from '../../player';
import { SerpentRig } from './rig';
import { buildAttack, SEQUENCE_ATTACKS, type AttackName, type AttackScript } from './attacks';
import { Shockwaves, Spikes, VenomPools } from './venom';

const V3 = THREE.Vector3;
const S = CFG.serpent;
const TAU = Math.PI * 2;
/** 화살 높이 판정 여유 */
const HIT_PAD = 0.45;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const approach = (cur: number, goal: number, rate: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

type State = 'enter' | 'hunt' | 'attack' | 'dead';
export type FaceMode = 'track' | 'hold' | 'to';

/** 머리가 따라가는 경로 (꺾은선) 와 진행 상황 */
interface Move {
  pts: number[];
  cum: number[];
  total: number;
  t: number;
  dur: number;
  /** 1 = 일정한 속도, >1 = 처음이 빠르고 점점 느려짐, <1 = 점점 빨라짐 */
  pow: number;
  onEnd?: () => void;
}

/** 몸에 닿았을 때 화면이 보라색으로 물드는 속도 배율 */
const TINT_SPEED = 1.5;

/**
 * 보스 2 — 심연의 이무기.
 *
 *  모델/모션: SerpentRig (머리가 지나간 길을 따라오는 긴 몸, 코브라처럼 솟는 목, 땅속 잠행)
 *  공격:      attacks.ts 의 "시간표"
 *  이 클래스는 상태머신(등장/사냥/공격/사망), 페이즈, 판정, 머리 이동을 맡는다.
 *  평소(사냥)에는 플레이어 둘레를 S자로 휘감듯 돌며 거리를 좁히고, 공격 거리대에 들어오면 자세를 잡고 덮친다.
 *  몸은 머리가 지나간 길을 그대로 따라오므로, 머리의 움직임이 곧 몸의 모양이다 (S자 · 똬리 · 일직선).
 */
export class Serpent implements Boss {
  readonly floor = 2;
  readonly title: string = S.name;
  readonly floorLabel: string = S.floorLabel;
  readonly attackNames: readonly string[] = SEQUENCE_ATTACKS;
  readonly rig: SerpentRig;
  readonly projectiles: Projectiles;
  readonly pools: VenomPools;
  readonly waves: Shockwaves;
  readonly spikes: Spikes;
  readonly phaseMarks: number[] = [...S.phaseAt];
  readonly maxHp: number = S.maxHp;

  hp: number = S.maxHp;
  alive = true;
  exposed = false;
  ready = false;
  introBeat = false;
  attacksOn = true;
  invulnerable = false;
  phaseIndex = 0;

  faceMode: FaceMode = 'track';
  faceYaw = 0;
  faceRate = 3;
  /** 머리가 바라보는 곳: 진행 방향 / 플레이어 */
  look: 'heading' | 'player' = 'heading';
  /** 켜면 머리가 아레나 바깥(외곽 선회 구역)까지 나갈 수 있다 */
  rimOn = false;
  /** 0 보다 크면 머리 판정이 켜져 있다 (돌진/내려찍기 중 머리에 닿으면 피격) */
  strikeR = 0;
  currentAttack: AttackName | null = null;

  onDeath: () => void = () => {};

  private state: State = 'enter';
  private t = 0;
  /** 머리가 향하는 방향 (atan2(dx,dz)) */
  private heading = 0;
  private vel = 0;
  private move: Move | null = null;
  private huntT = 0;
  private huntDist = 24;
  private orbitDir = 1;
  private orbitT = 6;
  private weavePh = Math.random() * TAU;
  private huntLazy = false;
  /** 외곽에서 몸이 전부 맵 밖으로 나올 때까지 스크립트를 멈춰 세우고 빙글 돈다 */
  private hold: { idle: () => void; t: number; max: number } | null = null;
  /** (사냥 중) 1페이즈에서 몸이 아직 맵 안에 남아 있어 외곽을 빠르게 돌아 감고 있는가 */
  private wrapping = false;
  /** 몸통 접촉 시간 (몸에 닿아 있는 동안 쌓인다) / 화면 보라색 강도 */
  private contactT = 0;
  private wakeLast = new Map<number, [number, number]>();
  screenTint = 0;
  private pending: AttackName = 'lunge';
  private script: AttackScript | null = null;
  private scriptT = 0;
  private stepIdx = 0;
  private seqIdx = 0;
  private phaseTrigger = false;
  private forced: AttackName | null = null;
  private lastNum = 0;
  private lastBlockSfx = 0;
  private enterT = 0;
  private enterDrop = true;
  private enterStage = 0;
  private lockPos = new V3();
  private list: Sphere[] = [];

  private tmp = new V3();
  private tmp2 = new V3();

  /** drop: 땅을 뚫고 솟아오르는 첫 등장 / false: 재도전 때의 짧은 등장 */
  constructor(
    readonly host: Host,
    readonly player: Player,
    drop = true,
  ) {
    this.rig = new SerpentRig(host.scene);
    this.rig.onFlick = () => {
      const d = this.dist;
      this.host.sfx.flick(clamp(1.1 - d / 60, 0.25, 1));
    };
    this.projectiles = new Projectiles(host, player, 120);
    this.pools = new VenomPools(host, player);
    this.waves = new Shockwaves(host, player);
    this.spikes = new Spikes(host);
    host.targets.push(this);
    this.intro(drop);
  }

  /* ───────────────────────── 접근자 ───────────────────────── */
  get name() {
    return this.phaseIndex === 0 ? S.name : `${S.name} · ${this.phaseIndex === 1 ? '분노' : '광란'}`;
  }
  get pos() {
    return this.rig.pos;
  }
  get status() {
    return `${this.state}${this.currentAttack ? ':' + this.currentAttack : ''}`;
  }
  /** 머리가 있는 곳 (x,z) */
  get headPos() {
    return this.rig.pos;
  }
  get dist() {
    return Math.hypot(this.player.pos.x - this.rig.pos.x, this.player.pos.z - this.rig.pos.z);
  }
  /** 머리가 갈 수 있는 한계 반경 */
  get headLimit() {
    return WORLD.radius - S.limit;
  }
  /** 머리가 향하는 방향의 수학 각 (atan2(dz,dx)) */
  /** 눈에 보이는 몸통 마디가 하나라도 아레나 안(가장자리 포함)에 남아 있는가 */
  bodyInsideArc(): boolean {
    const lim = WORLD.radius + 2.2;
    for (const sg of this.rig.segs) {
      if (!sg.up) continue;
      if (Math.hypot(sg.x, sg.z) < lim) return true;
    }
    return false;
  }
  /**
   * 몸이 전부 맵 밖으로 나올 때까지 시간표를 멈추고, 그동안 idle() 을 불러 머리가 외곽을 계속 돌게 한다.
   * (몸이 안에 남은 채로 바깥에서 쏘면 투사체가 몸에 가려져 보이지 않는다)
   */
  holdWrap(idle: () => void, max = 22) {
    this.hold = { idle, t: 0, max };
    this.rimOn = true;
  }
  get headingMath() {
    return Math.PI / 2 - this.heading;
  }
  setExposed(on: boolean) {
    this.exposed = on;
    this.rig.setExposed(on);
  }

  /* ───────────────────────── 등장 ───────────────────────── */
  private intro(drop: boolean) {
    this.state = 'enter';
    this.rimOn = true; // 1페이즈는 맵 바깥에서 시작한다
    this.enterT = 0;
    this.enterStage = 0;
    this.enterDrop = drop;
    this.ready = false;
    this.introBeat = false;
    this.invulnerable = true;
    // 땅속에 큼직한 똬리를 튼 채 숨어 있다. 머리는 똬리 한가운데에서 솟는다
    const c = S.start;
    const pl = this.player.pos;
    const psi = Math.atan2(pl.z - c.z, pl.x - c.x);
    const rhoIn = 4.6;
    const th0 = psi - Math.PI / 2;
    const hx = c.x + rhoIn * Math.cos(th0);
    const hz = c.z + rhoIn * Math.sin(th0);
    this.rig.layoutSpiral(hx, hz, psi, 1, rhoIn, 1, 18);
    this.heading = Math.PI / 2 - psi;
    this.rig.headYaw = this.heading;
    this.rig.snapSub(true);
    this.rig.lift = 1;
    this.rig.hood = 0;
    this.rig.snapPose();
    this.rig.update(0);
    this.lockPos.set(hx, 1.5, hz);
    if (!drop) this.enterT = 0.35; // 재도전: 바로 솟는다
  }

  private updateEnter(dt: number) {
    this.enterT += dt;
    const { host, player, rig } = this;
    const T = this.enterT;
    const emergeAt = 0.6;
    if (this.enterStage === 0 && T >= emergeAt) {
      this.enterStage = 1;
      rig.emerge();
      rig.lift = this.enterDrop ? 9.4 : 8;
      rig.liftRate = 12;
      rig.jaw = 1;
      rig.hood = 1;
      rig.tongueRate = 5;
      this.look = 'player';
      if (this.enterDrop) host.sfx.bossIntro();
      host.sfx.hiss(1.5, 1);
      host.shake(1.5);
      host.hitStop(0.07);
      host.sfx.land();
      const p = rig.pos;
      host.fx.ring(p.x, p.z, 14, 0.8, 0x9fe0c8);
      host.fx.burstLight(new V3(p.x, 3, p.z), 0x9fe8d0, 150, 0.55);
      this.spikes.erupt(p.x, p.z, 4);
      const pd = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
      if (pd < 16) player.push(p.x, p.z, 12 * (1 - pd / 16) + 3);
    }
    if (this.enterStage === 1 && T >= emergeAt + 0.25) {
      this.enterStage = 2;
      this.introBeat = true;
    }
    const settleAt = emergeAt + (this.enterDrop ? 2.3 : 1.2);
    if (this.enterStage === 2 && T >= settleAt) {
      this.enterStage = 3;
      rig.lift = 4.2;
      rig.liftRate = 3.5;
      rig.jaw = 0.1;
      rig.hood = 0.4;
      rig.tongueRate = 2.5;
    }
    if (this.enterStage === 3 && T >= settleAt + 1.0) this.finishIntro();
    if (this.enterStage >= 1) this.faceHead(dt, 3);
  }

  private finishIntro() {
    this.state = 'hunt';
    this.ready = true;
    this.invulnerable = false;
    this.look = 'heading';
    this.enterHunt(0.8);
    this.host.sfx.drone(true, 0);
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    this.t += dt;
    this.projectiles.update(dt);
    this.pools.update(dt);
    this.waves.update(dt);
    this.spikes.update(dt);

    if (this.state === 'dead') {
      this.rig.update(dt);
      return;
    }

    switch (this.state) {
      case 'enter':
        this.updateEnter(dt);
        break;
      case 'hunt':
        this.updateHunt(dt);
        break;
      case 'attack':
        this.updateAttack(dt);
        break;
    }

    this.integrate(dt);
    this.rig.update(dt);
    this.updateContact(dt);
    if (this.rig.headUp) this.lockPos.set(this.rig.headSphere.x, this.rig.headSphere.y, this.rig.headSphere.z);
    // 기어가는 소리: 머리가 땅 위에서 빨리 움직일수록 크게
    this.host.sfx.slither(this.rig.underground ? 0 : clamp(this.rig.speed / 16, 0, 1.2));
  }

  /**
   * 몸통에 닿아 있으면 화면이 보라색으로 물들고, 오래 닿아 있으면 체력을 잃는다.
   * 가늘어지는 꼬리 끝(반지름이 작은 마디)과 높이 쳐든 목 아래는 제외.
   */
  private updateContact(dt: number) {
    const pl = this.player;
    let touching = false;
    if (!pl.dead && this.state !== 'enter') {
      for (const sg of this.rig.segs) {
        if (!sg.up || sg.r < 0.95 || sg.y > sg.r + 1.3) continue;
        if (Math.hypot(pl.pos.x - sg.x, pl.pos.z - sg.z) < sg.r + 0.75) {
          touching = true;
          break;
        }
      }
    }
    if (touching) this.contactT += dt;
    else this.contactT = Math.max(0, this.contactT - dt * 1.5);
    // 화면의 보랏빛이 100% 에 이르렀을 때 체력이 깎인다
    if (this.contactT * TINT_SPEED >= S.contact.hurtAfter && this.screenTint >= 0.97) {
      this.contactT = (S.contact.hurtAfter * 0.35) / TINT_SPEED;
      pl.takeDamage(pl.pos.x + (Math.random() - 0.5), pl.pos.z + 1);
    }
    // 보랏빛은 체력이 깎이기까지의 시간보다 1.5배 빠르게 짙어진다
    const goal = touching ? 0.35 + 0.65 * Math.min(1, (this.contactT * TINT_SPEED) / S.contact.hurtAfter) : 0;
    this.screenTint += (goal - this.screenTint) * (1 - Math.exp(-(goal > this.screenTint ? 8 * TINT_SPEED : 3) * dt));
  }

  /** 머리와 몸 군데군데가 땅(물)을 스치며 남기는 물결 */
  wake(emit: (x: number, z: number, size: number, strength: number) => void) {
    if (this.state === 'enter' && this.rig.underground) return;
    const segs = this.rig.segs;
    const test = (key: number, x: number, y: number, z: number, r: number, gap: number, head: boolean) => {
      if (y > r + 1.3) {
        this.wakeLast.delete(key);
        return;
      }
      const last = this.wakeLast.get(key);
      if (!last) {
        this.wakeLast.set(key, [x, z]);
        return;
      }
      if (Math.hypot(x - last[0], z - last[1]) < gap) return;
      last[0] = x;
      last[1] = z;
      emit(x, z, 0.8 + r * 0.9, head ? 0.6 : 0.42);
    };
    const p = this.rig.pos;
    test(-1, p.x, this.rig.currentLift * 0.4, p.z, 2.2, 4.5, true);
    for (let i = 4; i < segs.length; i += 9) {
      const sg = segs[i];
      if (!sg.up || sg.r < 0.7) {
        this.wakeLast.delete(i);
        continue;
      }
      test(i, sg.x, sg.y, sg.z, sg.r, 5.5 + sg.r, false);
    }
  }

  /** 속도/이동을 위치로 옮기고 머리 방향·충돌 판정을 갱신한다 */
  private integrate(dt: number) {
    const p = this.rig.pos;
    const ox = p.x;
    const oz = p.z;
    let x = ox;
    let z = oz;
    if (this.move) {
      const m = this.move;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      const e = m.pow === 1 ? k : m.pow > 1 ? 1 - Math.pow(1 - k, m.pow) : Math.pow(k, 1 / m.pow);
      this.samplePath(m, e * m.total);
      x = this.tmp.x;
      z = this.tmp.z;
      if (k >= 1) {
        const cb = m.onEnd;
        this.move = null;
        this.vel = 0;
        cb?.();
      }
    } else {
      if (this.state !== 'hunt') this.vel = approach(this.vel, 0, 4.5, dt);
      x += Math.sin(this.heading) * this.vel * dt;
      z += Math.cos(this.heading) * this.vel * dt;
    }
    const lim = this.rimOn ? WORLD.radius + S.rim.out + 3.5 : this.headLimit;
    const d = Math.hypot(x, z);
    if (d > lim) {
      x *= lim / d;
      z *= lim / d;
    }
    if (this.move && (x !== ox || z !== oz)) this.heading = yawOf(x - ox, z - oz);
    this.rig.setHead(x, z);

    if (this.state !== 'enter') this.faceHead(dt, 8);
    // 머리가 높이 떠 있는 동안엔 닿지 않는다 (내려꽂히는 순간부터 판정)
    if (this.strikeR > 0 && !this.player.dead && this.rig.currentLift < 3.4) this.checkStrike(ox, oz, x, z);
  }

  /** 머리 모양(방향/기울기)을 갱신한다 */
  private faceHead(dt: number, rate: number) {
    const r = this.rig;
    let goal = this.heading;
    if (this.look === 'player') {
      goal = yawOf(this.player.pos.x - r.pos.x, this.player.pos.z - r.pos.z);
      // 이동 중에는 진행 방향에서 너무 꺾이지 않게 (몸이 따라 휘는 만큼만 고개를 돌린다)
      if (this.state === 'hunt' || this.move) goal = this.heading + clamp(wrapPi(goal - this.heading), -0.95, 0.95);
    }
    const e = wrapPi(goal - r.headYaw);
    const step = rate * dt * (1 + Math.abs(e));
    r.headYaw += Math.max(-step, Math.min(step, e));
    if (this.look === 'player') {
      const dh = Math.max(1, Math.hypot(this.player.pos.x - r.pos.x, this.player.pos.z - r.pos.z));
      r.headPitch = clamp(Math.atan2(r.currentLift - 0.6, dh) * 0.95, 0, 1.0);
    } else {
      r.headPitch = clamp((r.currentLift - 1.5) * 0.04, 0, 0.3);
    }
  }

  /** 이번 프레임에 머리가 지나간 선분이 플레이어에 닿았는가 */
  private checkStrike(ox: number, oz: number, x: number, z: number) {
    const pl = this.player;
    const R = this.strikeR + pl.hitRadius;
    const sx = x - ox;
    const sz = z - oz;
    const l2 = sx * sx + sz * sz;
    let u = l2 > 1e-8 ? ((pl.pos.x - ox) * sx + (pl.pos.z - oz) * sz) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const cx = ox + sx * u;
    const cz = oz + sz * u;
    if (Math.hypot(pl.pos.x - cx, pl.pos.z - cz) < R) pl.takeDamage(cx - Math.sin(this.heading), cz - Math.cos(this.heading));
  }

  /* ───────────────────────── 경로 이동 (스크립트용) ───────────────────────── */
  private samplePath(m: Move, s: number) {
    const { pts, cum } = m;
    const n = cum.length;
    let i = 1;
    while (i < n - 1 && cum[i] < s) i++;
    const a = i - 1;
    const segL = cum[i] - cum[a];
    const u = segL > 1e-6 ? clamp((s - cum[a]) / segL, 0, 1) : 1;
    this.tmp.set(pts[a * 2] + (pts[i * 2] - pts[a * 2]) * u, 0, pts[a * 2 + 1] + (pts[i * 2 + 1] - pts[a * 2 + 1]) * u);
  }

  /** (x,z) 로 dur 초 동안 머리를 직선으로 움직인다 (돌진/내려찍기) */
  moveTo(x: number, z: number, dur: number, pow = 1, onEnd?: () => void) {
    const p = this.rig.pos;
    this.moveAlong([p.x, p.z, x, z], dur, pow, onEnd);
  }

  /** 꺾은선 pts(x,z 나열) 를 따라 dur 초 동안 머리를 움직인다 (똬리 · S자) */
  moveAlong(pts: number[], dur: number, pow = 1, onEnd?: () => void) {
    const cum = [0];
    for (let i = 1; i < pts.length / 2; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    const total = cum[cum.length - 1];
    this.move = { pts, cum, total, t: 0, dur: Math.max(0.05, dur), pow, onEnd };
    if (total > 0.2) this.heading = yawOf(pts[2] - pts[0], pts[3] - pts[1]);
  }

  /** pts 경로를 일정한 속도(speed)로 따라간다. 걸리는 시간(초)을 돌려준다 */
  followPath(pts: number[], speed: number, onEnd?: () => void) {
    let len = 0;
    for (let i = 1; i < pts.length / 2; i++) len += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const dur = Math.max(0.3, len / speed);
    this.moveAlong(pts, dur, 1, onEnd);
    return dur;
  }

  /** 머리 앞쪽으로 나선을 그리며 감겨 드는 경로. 중심이 아레나 안쪽에 오는 쪽으로 돈다 */
  spiralPath(rho0: number, rho1: number, turns: number): number[] {
    const p = this.rig.pos;
    const psi = this.headingMath;
    const lim = this.headLimit;
    let best = 1;
    let bestD = 1e9;
    for (const turn of [1, -1]) {
      const th = psi - (turn * Math.PI) / 2;
      const cx = p.x - rho0 * Math.cos(th);
      const cz = p.z - rho0 * Math.sin(th);
      const d = Math.hypot(cx, cz) + Math.random() * 0.5 + Math.max(0, Math.hypot(cx, cz) + rho0 - lim) * 3;
      if (d < bestD) {
        bestD = d;
        best = turn;
      }
    }
    const turn = best;
    const th0 = psi - (turn * Math.PI) / 2;
    const cx = p.x - rho0 * Math.cos(th0);
    const cz = p.z - rho0 * Math.sin(th0);
    const pitch = (rho0 - rho1) / turns;
    const pts: number[] = [];
    let phi = 0;
    let rho = rho0;
    while (rho > rho1) {
      const th = th0 + turn * phi;
      pts.push(cx + rho * Math.cos(th), cz + rho * Math.sin(th));
      const d = 1.2 / rho;
      phi += d;
      rho -= (pitch * d) / TAU;
    }
    return pts;
  }

  /* ───────────────────────── 사냥: 플레이어 둘레를 S자로 휘감는다 ───────────────────────── */
  private enterHunt(minBonus = 0) {
    this.state = 'hunt';
    this.huntT = -minBonus;
    this.pending = this.pickNext();
    this.look = 'player';
    this.faceMode = 'track';
    const r = this.rig;
    r.liftRate = 3.5;
    r.jaw = 0.08;
    r.hood = 0;
    r.tongueRate = 2 + this.phaseIndex * 0.5;
    r.undulate = 0.35;
    this.vel = Math.max(this.vel, S.hunt.speed[this.phaseIndex] * 0.5);
  }

  private updateHunt(dt: number) {
    const pl = this.player;
    const p = this.rig.pos;
    const ph = this.phaseIndex;
    const H = S.hunt;
    this.huntT += dt;
    if (this.phaseTrigger) {
      this.phaseTrigger = false;
      this.pending = 'roar';
    }
    const name = this.pending;
    const band = (S.band as Record<string, readonly number[]>)[name];
    this.huntDist = band ? (band[0] + band[1]) / 2 : 22;

    const dx = pl.pos.x - p.x;
    const dz = pl.pos.z - p.z;
    const d = Math.hypot(dx, dz);

    // 머리를 살짝 들고 플레이어를 노려보며 다가온다
    this.rig.lift = 2.3 + 0.5 * Math.sin(this.t * 1.3);
    this.rig.jaw = 0.06 + 0.06 * Math.sin(this.t * 0.8);

    // 둘레를 도는 방향이 가끔 바뀐다
    this.orbitT -= dt;
    if (this.orbitT < 0 && !this.wrapping) {
      this.orbitDir = -this.orbitDir;
      this.orbitT = 5 + Math.random() * 5;
    }
    let tx: number;
    let tz: number;
    if (ph === 0) {
      // 1페이즈: 맵 바깥 둘레(외곽)를 따라 돈다. 플레이어가 있는 쪽 바깥에 머물며 공격한다
      this.rimOn = true;
      // 몸이 아직 맵 안에 남아 있으면 플레이어를 쫓지 않고 외곽을 빠르게 돌아 몸을 전부 바깥으로 감아 낸다
      this.wrapping = this.bodyInsideArc();
      const R = WORLD.radius + S.rim.out;
      const aP = Math.atan2(pl.pos.z, pl.pos.x);
      const aH = Math.atan2(p.z, p.x);
      const e = wrapPi(aP + this.orbitDir * 0.5 - aH);
      const step = this.wrapping ? this.orbitDir * 0.32 : Math.abs(e) < 0.12 ? 0 : Math.sign(e) * 0.5;
      const rr = Math.hypot(p.x, p.z);
      // 안쪽에 있으면 바깥으로 빠져나간다. 코너를 안쪽으로 베어 물지 않도록 반경이 모자란 만큼 더 바깥을 겨눈다
      const rt = rr < R - 3 ? Math.max(rr + 8, R * 0.7) : R + clamp((R - rr) * 1.6, 0, 7);
      tx = Math.cos(aH + step) * rt;
      tz = Math.sin(aH + step) * rt;
      this.huntLazy = step === 0;
    } else {
      this.huntLazy = false;
      this.wrapping = false;
      // 목표: 플레이어 둘레의 원 위, 지금 각도에서 조금 앞선 점 (멀면 그냥 다가가게 된다)
      const aHead = Math.atan2(-dz, -dx);
      const lead = this.orbitDir * clamp(0.9 - Math.abs(d - this.huntDist) * 0.012, 0.35, 0.9);
      tx = pl.pos.x + Math.cos(aHead + lead) * this.huntDist;
      tz = pl.pos.z + Math.sin(aHead + lead) * this.huntDist;
      // 바깥에서 들어온 뒤(2페이즈~)에는 머리가 안쪽으로 들어오면 외곽 허용을 푼다
      if (this.rimOn && Math.hypot(p.x, p.z) < this.headLimit - 0.5 && this.currentAttack === null) this.rimOn = false;
    }
    let goal = yawOf(tx - p.x, tz - p.z);
    // S자로 휘청이는 움직임
    goal += H.weaveAmp[ph] * (this.wrapping ? 0.15 : 1) * Math.sin(this.t * TAU * H.weaveHz + this.weavePh);
    // 벽 가까이에선 안쪽으로 꺾는다 (1페이즈는 바깥이 제자리)
    const edge = Math.hypot(p.x, p.z);
    const soft = this.headLimit - 9;
    if (ph > 0 && edge > soft) {
      const w = clamp((edge - soft) / 9, 0, 1);
      goal += wrapPi(yawOf(-p.x, -p.z) - goal) * w;
    }
    const e = wrapPi(goal - this.heading);
    const turn = H.turn * dt * (this.wrapping ? 2 : 1);
    this.heading += clamp(e, -turn, turn);
    // 가까이 붙으면 속도를 늦춰 휘감듯 돈다
    const sp = ph === 0 ? (this.wrapping ? S.rim.wrap : H.speed[0] * (this.huntLazy ? 0.25 : 0.9)) : H.speed[ph] * clamp(0.55 + d / 40, 0.6, 1.15);
    this.vel = approach(this.vel, sp, 2.5, dt);

    if (!this.attacksOn || this.huntT < H.minTime[ph]) return;
    // 몸이 전부 맵 밖으로 나온 다음에야 공격한다
    if (ph === 0 && this.wrapping) return;
    // 2페이즈~ 맵 안에서만 공격한다 (3페이즈의 외곽 패턴은 어디서든)
    const outside = Math.hypot(p.x, p.z) > this.headLimit + 0.5;
    if (ph >= 1 && outside && name !== 'rimshot' && name !== 'rimcharge' && name !== 'roar') return;
    const inBand = ph === 0 || !band || (d >= band[0] && d <= band[1]);
    if (name === 'roar' || inBand || this.huntT >= H.minTime[ph] + H.maxWait) this.startAttack(name);
  }

  /* ───────────────────────── 공격 실행 ───────────────────────── */
  private pickNext(): AttackName {
    if (this.phaseTrigger) {
      this.phaseTrigger = false;
      return 'roar';
    }
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      return f;
    }
    const seq = S.sequence[this.phaseIndex];
    return seq[this.seqIdx++ % seq.length] as AttackName;
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
    if (!this.move) {
      if (this.faceMode === 'track') this.turnHeading(dt, yawOf(this.player.pos.x - this.rig.pos.x, this.player.pos.z - this.rig.pos.z), this.faceRate);
      else if (this.faceMode === 'to') this.turnHeading(dt, this.faceYaw, this.faceRate);
    }
    if (this.hold) {
      const h = this.hold;
      h.t += dt;
      if (!this.bodyInsideArc() || h.t > h.max) this.hold = null;
      else {
        if (!this.move) h.idle();
        return;
      }
    }
    this.scriptT += dt;
    while (this.stepIdx < sc.steps.length && sc.steps[this.stepIdx].at <= this.scriptT) {
      sc.steps[this.stepIdx++].fn();
      if (this.hold) break; // 몸을 감는 동안엔 뒤 단계를 시작하지 않는다
    }
    if (this.scriptT >= sc.end && !this.move) this.endAttack();
  }

  private turnHeading(dt: number, goal: number, rate: number) {
    const e = wrapPi(goal - this.heading);
    const maxStep = rate * dt * (1 + Math.abs(e) * 1.2);
    this.heading += Math.max(-maxStep, Math.min(maxStep, e));
  }

  private endAttack() {
    this.script = null;
    this.hold = null;
    this.currentAttack = null;
    this.strikeR = 0;
    if (this.phaseIndex === 0) this.rimOn = true;
    this.invulnerable = false;
    this.setExposed(false);
    this.enterHunt();
  }

  /** 디버그: 사냥 중이면 다음 공격을 즉시 지정, 공격 중이면 끊고 시작 */
  forceAttack(name: string) {
    if (!this.alive || this.state === 'enter') return;
    if (this.state === 'attack') this.abortAttack();
    this.forced = name as AttackName;
    this.pending = name as AttackName;
    this.huntT = 99;
  }

  private abortAttack() {
    this.script = null;
    this.hold = null;
    this.move = null;
    if (this.rimOn && this.phaseIndex > 0) {
      this.rimOn = false;
      const p = this.rig.pos;
      const d = Math.hypot(p.x, p.z);
      if (d > this.headLimit) this.rig.setHead((p.x * this.headLimit) / d, (p.z * this.headLimit) / d);
    }
    this.host.fx.telegraphs.clear();
    this.currentAttack = null;
    this.strikeR = 0;
    this.invulnerable = false;
    this.setExposed(false);
    // 땅속에 있었다면 올라온다 (머리 자리에서 새로 감아 솟는다)
    if (this.rig.underground || this.rig.waving) this.erupt(this.rig.pos.x, this.rig.pos.z, false);
    this.enterHunt();
  }

  /* ───────────────────────── 땅속 → 솟구침 ───────────────────────── */
  /**
   * (x,z)에서 머리를 내밀며 솟는다. 몸은 아레나 한가운데 쪽으로 큼직한 나선을 그리며 머리 뒤에 놓여, 머리부터 차례로 솟아오른다.
   * 이미 땅속에 있어야 한다.
   */
  erupt(x: number, z: number, wave = true) {
    const rho = 15;
    const rhoIn = 4.5;
    const turn: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const nAng = Math.hypot(x, z) < 3 ? Math.random() * TAU : Math.atan2(-z, -x);
    const psi = nAng - (turn * Math.PI) / 2;
    this.rig.layoutSpiral(x, z, psi, turn, rho, -1, rhoIn);
    this.heading = Math.PI / 2 - psi;
    this.rig.headYaw = this.heading;
    this.rig.snapSub(true);
    if (wave) this.rig.emerge();
    else this.rig.snapSub(false);
    this.move = null;
    this.vel = 0;
  }

  /* ───────────────────────── 페이즈 ───────────────────────── */
  beginNextPhase() {
    this.phaseIndex = Math.min(S.phaseAt.length, this.phaseIndex + 1);
    this.seqIdx = 0;
    this.invulnerable = true;
    this.rig.setRage(this.phaseIndex);
    this.host.sfx.drone(true, this.phaseIndex >= 2 ? 1 : 0.5);
  }

  private nextPhaseAt(): number | undefined {
    return (S.phaseAt as readonly number[])[this.phaseIndex];
  }

  /* ───────────────────────── 판정 (Target) ───────────────────────── */
  bodies(): Circle[] {
    return this.alive ? this.rig.bodies() : [];
  }

  aimSpheres(): readonly Sphere[] {
    const l = this.list;
    l.length = 0;
    if (!this.alive) return l;
    if (this.rig.headUp) l.push(this.rig.headSphere);
    for (const s of this.rig.segs) if (s.up) l.push(s);
    return l;
  }

  lockPoint(out: THREE.Vector3) {
    return out.copy(this.lockPos);
  }

  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive) return 0;
    const rig = this.rig;
    let part: 'head' | 'body' | null = null;
    if (rig.headUp) {
      const hs = rig.headSphere;
      if (Math.hypot(p.x - hs.x, p.z - hs.z) < hs.r + r && Math.abs(p.y - hs.y) < hs.r + HIT_PAD) part = 'head';
    }
    if (!part) {
      for (const s of rig.segs) {
        if (!s.up) continue;
        if (Math.hypot(p.x - s.x, p.z - s.z) < s.r + r && Math.abs(p.y - s.y) < s.r + HIT_PAD) {
          part = 'body';
          break;
        }
      }
    }
    if (!part) return 0;
    if (this.invulnerable) {
      this.blockSfx();
      return BLOCKED;
    }
    if (part === 'head') {
      const kind = this.exposed ? 'exposed' : 'weak';
      return this.damage(dmg * (this.exposed ? S.exposedMult : S.headMult), kind, p);
    }
    return this.damage(dmg * S.bodyMult, 'body', p);
  }

  hitRadial(c: THREE.Vector3, radius: number, dmg: number) {
    if (!this.alive || this.invulnerable) return;
    if (this.touches(c.x, c.z, radius)) this.damage(dmg, 'special', c);
  }

  hitSplash(x: number, z: number, r: number, dmg: number): number {
    if (!this.alive || this.invulnerable) return 0;
    return this.touches(x, z, r) ? this.damage(dmg, 'splash', this.tmp2.set(x, 1.2, z)) : 0;
  }

  private touches(x: number, z: number, r: number): boolean {
    const rig = this.rig;
    if (rig.headUp) {
      const hs = rig.headSphere;
      if (Math.hypot(x - hs.x, z - hs.z) < r + hs.r) return true;
    }
    for (const s of rig.segs) if (s.up && Math.hypot(x - s.x, z - s.z) < r + s.r) return true;
    return false;
  }

  private blockSfx() {
    if (this.t - this.lastBlockSfx > 0.06) {
      this.host.sfx.block();
      this.lastBlockSfx = this.t;
    }
  }

  private damage(amount: number, kind: 'body' | 'weak' | 'exposed' | 'special' | 'splash', at?: THREE.Vector3): number {
    let nh = this.hp - amount;
    const next = this.nextPhaseAt();
    if (next !== undefined && nh <= this.maxHp * next) {
      nh = this.maxHp * next;
      this.phaseTrigger = true;
    }
    this.hp = Math.max(0, nh);
    if (kind === 'special') this.rig.flash('all');
    else if (kind === 'splash') this.rig.flash('all', 0.6);
    else if (kind === 'body') this.rig.flash('body', 0.8);
    else this.rig.flash('head');
    const heavy = amount >= 6;
    const strong = kind !== 'body' || heavy;
    this.host.sfx.hit(amount);
    if (strong && kind !== 'body' && this.t - this.lastHurtHiss > 0.9) {
      this.lastHurtHiss = this.t;
      this.host.sfx.hiss(0.5, 0.7);
    }
    if (strong || this.t - this.lastNum > 0.22) {
      this.lastNum = this.t;
      // 숫자는 실제로 맞은 자리에서 뜬다
      const hs = this.rig.headSphere;
      const where = at ? this.tmp.set(at.x, at.y + 1.8, at.z) : !this.rig.headUp ? this.tmp.set(this.lockPos.x, this.lockPos.y + 2.2, this.lockPos.z) : this.tmp.set(hs.x, hs.y + 2.4, hs.z);
      const fk: FloatKind = kind === 'weak' || kind === 'exposed' || kind === 'special' ? kind : 'normal';
      this.host.floatText(where, String(Math.round(amount)) + (kind === 'exposed' ? '!' : ''), fk);
    }
    if (strong) {
      this.host.hitStop(0.035);
      this.host.shake(0.18);
    }
    if (this.hp <= 0) this.die();
    return amount;
  }
  private lastHurtHiss = -9;

  /* ───────────────────────── 사망 ───────────────────────── */
  private die() {
    if (this.state === 'dead') return;
    const { host } = this;
    this.alive = false;
    this.state = 'dead';
    this.script = null;
    this.move = null;
    this.strikeR = 0;
    this.setExposed(false);
    host.fx.telegraphs.clear();
    this.projectiles.clear();
    this.pools.clear();
    this.waves.clear();
    this.spikes.clear();

    const c = this.tmp2.set(this.lockPos.x, Math.max(1.5, this.lockPos.y), this.lockPos.z).clone();
    host.hitStop(0.22);
    host.slowmo(0.28, 1.5);
    host.shake(1.8);
    host.sfx.bossDeath();
    host.sfx.hiss(1.8, 1);
    host.sfx.drone(false);
    host.sfx.slither(0);
    host.fx.ring(c.x, c.z, 16, 1.1, 0xffd27a);
    host.fx.ring(c.x, c.z, 9, 0.7, 0xffffff, 0.09);
    host.fx.burstLight(c, 0xffc070, 220, 1.1);
    host.fx.particles.burst(c, 0xff4a2a, 120, 15, 1.3, 0.3, 0.9);
    host.fx.particles.burst(c, 0xffa020, 80, 11, 1.1, 0.24, 0.8);
    host.fx.particles.burst(c, 0xffe06a, 40, 9, 1.0, 0.2, 0.8);
    this.rig.explode(1);
    this.onDeath();
  }

  /* ───────────────────────── 디버그 ───────────────────────── */
  setHpFrac(f: number) {
    if (!this.alive) return;
    this.hp = Math.max(1, this.maxHp * f);
    const next = this.nextPhaseAt();
    if (next !== undefined && this.hp <= this.maxHp * next) {
      this.hp = this.maxHp * next;
      this.phaseTrigger = true;
    }
  }

  dispose() {
    this.projectiles.dispose();
    this.pools.dispose();
    this.waves.dispose();
    this.spikes.dispose();
    this.rig.dispose();
    this.host.sfx.drone(false);
    this.host.sfx.slither(0);
    this.host.targets = this.host.targets.filter((t) => t !== this);
  }
}
