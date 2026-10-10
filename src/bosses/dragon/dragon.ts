import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import { BLOCKED, type Boss, type Circle, type FloatKind, type Host, type Sphere } from '../../types';
import type { Player } from '../../player';
import { DragonRig, type WingCtl } from './rig';
import { FireField } from './fire';
import { buildAttack, SEQUENCE_ATTACKS, type AttackName, type AttackScript } from './attacks';

const V3 = THREE.Vector3;
const D = CFG.dragon;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur: number, goal: number, rate: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-rate * dt));

type State = 'enter' | 'fly' | 'attack' | 'dead';
export type Ease = 'lin' | 'in' | 'out' | 'io';
export type LookMode = 'off' | 'player' | 'point';

const easeK = (k: number, e: Ease) => (e === 'in' ? k * k : e === 'out' ? 1 - (1 - k) * (1 - k) : e === 'io' ? k * k * (3 - 2 * k) : k);

/** 3D 경로를 따라 날아가는 이동 (스크립트용) */
interface Move {
  poly: THREE.Vector3[];
  cum: number[];
  total: number;
  t: number;
  dur: number;
  ease: Ease;
  onEnd?: () => void;
  seg: number;
}

interface RayState {
  T: THREE.Vector3;
  t: number;
  dur: number;
  last: THREE.Vector3;
}

/**
 * 보스 3 — 겁화의 용 (마지막 보스).
 *
 *  모델/모션: DragonRig (머리가 지나간 길을 따라오는 긴 몸통, 퍼덕이는 날개, 다리, 뿔, 입속 불)
 *  공격:      attacks.ts 의 "시간표"
 *  이 클래스는 상태머신(등장/비행/공격/사망), 페이즈, 판정, 비행(선회 · 경로 이동 · 제자리 비행)을 맡는다.
 *  평소에는 플레이어 둘레의 원을 그리며 하늘을 선회한다. 몸통은 머리가 그린 곡선을 그대로 따라오므로 머리의 움직임이 곧 몸의 모양이다.
 */
export class Dragon implements Boss {
  readonly floor = 3;
  readonly title: string = D.name;
  readonly floorLabel: string = D.floorLabel;
  readonly attackNames: readonly string[] = SEQUENCE_ATTACKS;
  readonly rig: DragonRig;
  readonly field: FireField;
  readonly phaseMarks: number[] = [...D.phaseAt];
  readonly maxHp: number = D.maxHp;

  hp: number = D.maxHp;
  alive = true;
  exposed = false;
  ready = false;
  introBeat = false;
  attacksOn = true;
  invulnerable = false;
  phaseIndex = 0;

  /** 머리 위치 · 방향 (yaw = atan2(dx, dz), pitch + = 위) */
  readonly p = new V3(0, 40, -60);
  yaw = 0;
  pitch = 0;
  speed = 0;
  /** 켜면 몸통(머리 · 마디)에 닿은 플레이어가 피해를 입는다 (저공 돌진 · 추락) */
  strikeOn = false;
  private bodyHitCd = 0;
  private lastDt = 0;
  currentAttack: AttackName | null = null;
  /** 선회 고도/반경을 잠깐 바꾼다 (유성우) */
  cruiseOverride: { alt: number; radius: number } | null = null;

  onDeath: () => void = () => {};

  private state: State = 'enter';
  private t = 0;
  private bank = 0;
  private move: Move | null = null;
  private hover: { to: THREE.Vector3; rate: number; face: number | null; pitch: number } | null = null;
  private lookMode: LookMode = 'off';
  private lookPt = new V3();
  private orbitDir = 1;
  private orbitT = 8;
  private cx = 0;
  private cz = 0;
  private idleT = 1;
  private script: AttackScript | null = null;
  private scriptT = 0;
  private stepIdx = 0;
  private seqIdx = 0;
  private phaseTrigger = false;
  private forced: AttackName | null = null;
  private enterT = 0;
  private enterStage = 0;
  private enterDrop = true;
  private beatT = 0;
  private lastNum = 0;
  private lastBlockSfx = 0;
  private lastHurtRoar = -9;
  private ray: RayState | null = null;
  private ticks: Array<(dt: number) => void> = [];
  private jet: { burnLife: number; last: THREE.Vector3; snd: number } | null = null;
  private dying = 0;
  private dyingVel = new V3();
  private deathNext = 0;
  private dustT = 0;
  private emberT = 0;
  private lockPos = new V3();
  private posXZ = new V3();

  private tmp = new V3();
  private tmp2 = new V3();
  private tmp3 = new V3();

  constructor(
    readonly host: Host,
    readonly player: Player,
    drop = true,
  ) {
    this.rig = new DragonRig(host.scene);
    this.field = new FireField(host, player);
    host.targets.push(this);
    this.intro(drop);
  }

  /* ───────────────────────── 접근자 ───────────────────────── */
  get name() {
    return this.phaseIndex === 0 ? D.name : `${D.name} · ${this.phaseIndex === 1 ? '분노' : '광란'}`;
  }
  get pos() {
    return this.posXZ.set(this.p.x, 0, this.p.z);
  }
  get status() {
    return `${this.state}${this.currentAttack ? ':' + this.currentAttack : ''} y=${this.p.y.toFixed(0)}`;
  }
  get moving() {
    return !!this.move;
  }
  get fwdXZ() {
    return this.tmp3.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  mouthPos(out: THREE.Vector3) {
    return this.rig.mouth(out);
  }
  exposedOn(on: boolean) {
    this.exposed = on;
  }

  /* ───────────────────────── 날개 · 시선 제어 ───────────────────────── */
  setWings(w: Partial<WingCtl>) {
    Object.assign(this.rig.wing, w);
  }
  look(mode: LookMode, pt?: THREE.Vector3) {
    this.lookMode = mode;
    if (pt) this.lookPt.copy(pt);
  }
  /** 평소 자세로 되돌린다 */
  relax() {
    const r = this.rig;
    r.jaw = 0.05;
    r.fire = 0;
    r.stunned = false;
    r.armPose = 'tuck';
    r.legPose = 'trail';
    r.legGait = false;
    r.undulate = 0.6;
    this.setWings({ hz: 0.7, amp: 0.5, fold: 0, raise: 0.1, spread: 1 });
    this.look('off');
    this.exposed = false;
  }

  /* ───────────────────────── 등장 ───────────────────────── */
  private intro(drop: boolean) {
    this.state = 'enter';
    this.ready = false;
    this.introBeat = false;
    this.invulnerable = true;
    this.enterT = 0;
    this.enterStage = 0;
    this.enterDrop = drop;
    const r = this.rig;
    this.yaw = 0;
    this.pitch = -0.2;
    this.speed = 40;
    if (drop) this.p.set(0, 50, -140);
    else this.p.set(0, 26, -52);
    r.head.copy(this.p);
    r.layoutLine(this.p.x, this.p.y, this.p.z, 0, 0);
    r.undulate = 0.5;
    r.rage = 0;
    this.setWings({ hz: 0.8, amp: 0.55, fold: 0.1, raise: 0.1, spread: 1 });
    this.relax();
    this.syncRig(0);
    r.update(0);
    const path = drop
      ? [new V3(-6, 30, -66), new V3(6, 19, -28), new V3(0, 12, 4), new V3(-24, 15, 22), new V3(-34, 14, 2)]
      : [new V3(0, 17, -22), new V3(0, 12.5, 2), new V3(-22, 14, 14), new V3(-30, 13.5, 2)];
    this.fly(path, drop ? 5.2 : 2.6, 'lin');
    this.lockPos.copy(this.p);
  }

  private updateEnter(dt: number) {
    this.enterT += dt;
    const { host, rig } = this;
    const m = this.move;
    const k = m ? m.t / m.dur : 1;
    // 아레나 위를 가로지르는 순간 포효 + 등장 카드
    const beatAt = this.enterDrop ? 0.5 : 0.35;
    if (this.enterStage === 0 && k >= beatAt) {
      this.enterStage = 1;
      this.introBeat = true;
      rig.jaw = 1;
      this.look('player');
      if (this.enterDrop) host.sfx.bossIntro();
      host.sfx.roar();
      host.shake(1.6, 0.4);
      host.flash('#ff7a2a', 0.4, 0.9);
      host.skyPulse?.(1);
      const q = this.player.pos;
      host.fx.ring(q.x, q.z, 22, 1.0, 0xffb060);
      host.fx.burstLight(this.tmp.set(this.p.x, this.p.y, this.p.z), 0xff9040, 260, 1.0);
      this.setWings({ hz: 0.55, amp: 0.7 });
    }
    if (this.enterStage === 1 && k >= beatAt + 0.18) {
      this.enterStage = 2;
      rig.jaw = 0.1;
      this.look('off');
    }
    if (this.enterStage >= 1 && !this.move) this.finishIntro();
  }

  private finishIntro() {
    this.state = 'fly';
    this.ready = true;
    this.invulnerable = false;
    this.relax();
    this.idleT = 0.8;
    this.orbitDir = Math.sign(this.p.x * -this.p.z) || 1;
    this.cx = this.p.x * 0.2;
    this.cz = this.p.z * 0.2;
    this.host.sfx.drone(true, 0);
  }

  /* ───────────────────────── 업데이트 ───────────────────────── */
  update(dt: number) {
    this.t += dt;
    this.field.update(dt);

    if (this.state === 'dead') {
      this.updateDying(dt);
      this.rig.update(dt);
      return;
    }

    switch (this.state) {
      case 'enter':
        this.updateEnter(dt);
        break;
      case 'fly':
        this.updateFly(dt);
        break;
      case 'attack':
        this.updateAttack(dt);
        break;
    }

    this.integrate(dt);
    this.updateLook(dt);
    this.updateBreath(dt);
    this.syncRig(dt);
    this.rig.update(dt);
    this.lastDt = dt;
    this.updateStrike();
    this.updateAmbient(dt);
    if (this.alive) this.lockPos.set(this.rig.headSphere.x, this.rig.headSphere.y, this.rig.headSphere.z);
    this.wingSound(dt);
  }

  private syncRig(dt: number) {
    const r = this.rig;
    r.head.copy(this.p);
    r.yaw = this.yaw;
    r.pitch = this.pitch;
    r.bank = this.bank;
    void dt;
  }

  /** 이동: 경로 → 제자리 비행 → (기본) 선회 */
  private integrate(dt: number) {
    const p = this.p;
    const ox = p.x;
    const oy = p.y;
    const oz = p.z;
    if (this.move) {
      this.stepMove(dt);
    } else if (this.hover) {
      this.stepHover(dt);
    } else {
      this.stepCruise(dt);
    }
    p.y = Math.max(p.y, 1.3);
    const dx = p.x - ox;
    const dy = p.y - oy;
    const dz = p.z - oz;
    this.speed = Math.hypot(dx, dy, dz) / Math.max(dt, 1e-4);
    // 선회 기울기: 도는 속도에 비례해 안쪽으로 눕는다 (이 값이 궤적에 실려 몸통도 차례로 기운다)
    this.bank = approach(this.bank, clamp(this.yawRate * 0.85, -0.8, 0.8), 4, dt);
  }
  private yawRate = 0;

  private setHeading(dx: number, dy: number, dz: number, dt: number, rate = 14) {
    const h = Math.hypot(dx, dz);
    if (h < 1e-5 && Math.abs(dy) < 1e-5) return;
    const gy = h > 1e-5 ? Math.atan2(dx, dz) : this.yaw;
    const gp = Math.atan2(dy, Math.max(h, 1e-5));
    const ny = this.yaw + wrapPi(gy - this.yaw) * (1 - Math.exp(-rate * dt));
    this.yawRate = approach(this.yawRate, wrapPi(ny - this.yaw) / Math.max(dt, 1e-4), 8, dt);
    this.yaw = wrapPi(ny);
    this.pitch = approach(this.pitch, gp, rate, dt);
  }

  /* ── 경로 이동 ── */
  fly(pts: THREE.Vector3[], dur: number, ease: Ease = 'lin', onEnd?: () => void) {
    const fw = this.tmp2.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const ctrl: THREE.Vector3[] = [this.p.clone().addScaledVector(fw, -9), this.p.clone()];
    for (const q of pts) ctrl.push(q.clone());
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const n = Math.max(48, Math.ceil(curve.getLength() / 0.7));
    const sp = curve.getSpacedPoints(n);
    let i0 = 0;
    let best = 1e9;
    for (let i = 0; i <= Math.floor(n * 0.6); i++) {
      const d = sp[i].distanceToSquared(this.p);
      if (d < best) {
        best = d;
        i0 = i;
      }
    }
    const poly = sp.slice(i0);
    poly[0].copy(this.p);
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + poly[i].distanceTo(poly[i - 1]));
    this.move = { poly, cum, total: cum[cum.length - 1], t: 0, dur: Math.max(0.05, dur), ease, onEnd, seg: 1 };
    this.hover = null;
  }

  private stepMove(dt: number) {
    const m = this.move!;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const s = easeK(k, m.ease) * m.total;
    const { poly, cum } = m;
    let i = m.seg;
    while (i < poly.length - 1 && cum[i] < s) i++;
    m.seg = i;
    const a = i - 1;
    const segL = cum[i] - cum[a];
    const u = segL > 1e-6 ? clamp((s - cum[a]) / segL, 0, 1) : 1;
    const nx = poly[a].x + (poly[i].x - poly[a].x) * u;
    const ny = poly[a].y + (poly[i].y - poly[a].y) * u;
    const nz = poly[a].z + (poly[i].z - poly[a].z) * u;
    const dx = nx - this.p.x;
    const dy = ny - this.p.y;
    const dz = nz - this.p.z;
    // 방향은 앞쪽 점을 바라보게 해서 부드럽게 (경로 자체가 곡선)
    const j = Math.min(poly.length - 1, i + 3);
    this.setHeading(poly[j].x - nx, poly[j].y - ny, poly[j].z - nz, dt, 16);
    this.p.set(nx, ny, nz);
    void dx;
    void dy;
    void dz;
    if (k >= 1) {
      const cb = m.onEnd;
      this.move = null;
      cb?.();
    }
  }

  /* ── 제자리 비행 ── */
  hoverAt(to: THREE.Vector3 | null, rate = 2.2, face: number | null = null, pitch = 0.1) {
    this.move = null;
    this.hover = to ? { to: to.clone(), rate, face, pitch } : null;
  }

  private stepHover(dt: number) {
    const h = this.hover!;
    const k = 1 - Math.exp(-h.rate * dt);
    const ox = this.p.x;
    const oy = this.p.y;
    const oz = this.p.z;
    this.p.x += (h.to.x - this.p.x) * k;
    this.p.y += (h.to.y - this.p.y) * k + Math.sin(this.t * 1.6) * 0.012;
    this.p.z += (h.to.z - this.p.z) * k;
    let gy = h.face;
    if (gy === null) gy = Math.atan2(this.player.pos.x - this.p.x, this.player.pos.z - this.p.z);
    const ny = this.yaw + wrapPi(gy - this.yaw) * (1 - Math.exp(-2.4 * dt));
    this.yawRate = approach(this.yawRate, wrapPi(ny - this.yaw) / Math.max(dt, 1e-4), 6, dt);
    this.yaw = wrapPi(ny);
    this.pitch = approach(this.pitch, h.pitch + (h.to.y - oy) * 0.01, 2.5, dt);
    void ox;
    void oz;
  }

  /* ── 선회(기본 비행) ── */
  private stepCruise(dt: number) {
    const ph = this.phaseIndex;
    const C = D.cruise;
    const pl = this.player.pos;
    const R = this.cruiseOverride?.radius ?? C.radius[ph];
    const alt = this.cruiseOverride?.alt ?? C.alt[ph];
    const turn = C.turn[ph];
    const sp = C.speed[ph];
    this.cx += (pl.x * C.follow - this.cx) * (1 - Math.exp(-0.9 * dt));
    this.cz += (pl.z * C.follow - this.cz) * (1 - Math.exp(-0.9 * dt));
    this.orbitT -= dt;
    if (this.orbitT < 0) {
      this.orbitDir = -this.orbitDir;
      this.orbitT = 8 + Math.random() * 5;
    }
    const p = this.p;
    const a = Math.atan2(p.z - this.cz, p.x - this.cx);
    const Rt = R + 2.6 * Math.sin(this.t * 0.4);
    const da = this.orbitDir * 0.62;
    const gx = this.cx + Math.cos(a + da) * Rt;
    const gz = this.cz + Math.sin(a + da) * Rt;
    // 몸이 한 바퀴보다 길어서, 고도를 천천히 오르내려 몸통이 자기 몸과 겹치지 않게 한다
    // 상하 이동을 적극적으로: 크게 솟구쳤다 내려꽂히기를 반복한다 (몸이 한 바퀴보다 길어서 몸통이 자기 몸과 겹치지 않는 효과도 있다)
    const gy = alt + 12 * Math.sin(this.t * 0.46) + 3.5 * Math.sin(this.t * 0.97 + 1);
    const wantYaw = Math.atan2(gx - p.x, gz - p.z);
    const rate = clamp(wrapPi(wantYaw - this.yaw) * 2.4, -turn, turn);
    this.yawRate = approach(this.yawRate, rate, 6, dt);
    this.yaw = wrapPi(this.yaw + rate * dt);
    const hd = Math.max(4, Math.hypot(gx - p.x, gz - p.z));
    const wantPitch = clamp(Math.atan2(gy - p.y, hd), -0.8, 0.8);
    this.pitch += clamp((wantPitch - this.pitch) * 2.6, -1.1, 1.1) * dt;
    this.speed = approach(this.speed, sp, 1.6, dt);
    const cp = Math.cos(this.pitch);
    p.x += Math.sin(this.yaw) * cp * this.speed * dt;
    p.y += Math.sin(this.pitch) * this.speed * dt;
    p.z += Math.cos(this.yaw) * cp * this.speed * dt;
  }

  /* ── 시선 ── */
  private updateLook(dt: number) {
    const r = this.rig;
    let gy = 0;
    let gp = 0;
    if (this.lookMode !== 'off') {
      const tx = this.lookMode === 'player' ? this.player.pos.x : this.lookPt.x;
      const ty = this.lookMode === 'player' ? 0.9 : this.lookPt.y;
      const tz = this.lookMode === 'player' ? this.player.pos.z : this.lookPt.z;
      gy = clamp(wrapPi(Math.atan2(tx - this.p.x, tz - this.p.z) - this.yaw), -1.15, 1.15);
      const h = Math.hypot(tx - this.p.x, tz - this.p.z);
      gp = clamp(Math.atan2(ty - (this.p.y + 1), Math.max(2, h)) - this.pitch, -0.95, 0.5);
    }
    r.lookYaw = approach(r.lookYaw, gy, 7, dt);
    r.lookPitch = approach(r.lookPitch, gp, 7, dt);
  }

  /* ── 숨결 · 광선 ── */
  startJet(burnLife: number) {
    this.jet = { burnLife, last: new V3(1e5, 0, 1e5), snd: 0 };
  }
  stopJet() {
    this.jet = null;
  }
  startRay(T: THREE.Vector3, dur: number) {
    this.ray = { T: T.clone(), t: 0, dur, last: new V3(1e5, 0, 1e5) };
    this.host.sfx.sunFire(dur);
  }
  stopRay() {
    this.ray = null;
  }
  get rayOn() {
    return !!this.ray;
  }

  private updateBreath(dt: number) {
    const { host, field, player } = this;
    if (this.jet) {
      const j = this.jet;
      const M = this.mouthPos(this.tmp);
      const f = this.fwdXZ;
      const reach = M.y / Math.tan(0.62);
      const G = this.tmp2.set(M.x + f.x * reach, 0, M.z + f.z * reach);
      field.jet(M, G, 1);
      j.snd -= dt;
      if (j.snd <= 0) {
        host.sfx.flame(0.6, 0.9);
        j.snd = 0.5;
      }
      host.shake(0.3, 0.04);
      if (Math.hypot(G.x - j.last.x, G.z - j.last.z) > 2.2 && Math.hypot(G.x, G.z) < WORLD.radius + 1) {
        field.burn(G.x, G.z, D.strafe.burnR, j.burnLife);
        j.last.copy(G);
      }
    }
    const ray = this.ray;
    if (ray) {
      ray.t += dt;
      const k = Math.min(1, ray.t / 0.3) * Math.min(1, (ray.dur - ray.t) / 0.5);
      // 조준점이 플레이어를 쫓는다 (플레이어가 달리는 속도보다 아주 조금 빠르다)
      const pl = player.pos;
      const dx = pl.x - ray.T.x;
      const dz = pl.z - ray.T.z;
      const d = Math.hypot(dx, dz);
      const ramp = Math.min(1, 0.4 + ray.t * 0.5);
      const step = Math.min(d, D.sunray.chase * ramp * dt);
      if (d > 1e-4) {
        ray.T.x += (dx / d) * step;
        ray.T.z += (dz / d) * step;
      }
      const lim = WORLD.radius + 3;
      const rr = Math.hypot(ray.T.x, ray.T.z);
      if (rr > lim) {
        ray.T.x *= lim / rr;
        ray.T.z *= lim / rr;
      }
      ray.T.y = 0;
      const M = this.mouthPos(this.tmp);
      field.ray(M, ray.T, Math.max(0, k));
      this.look('point', this.tmp2.set(ray.T.x, 0, ray.T.z));
      host.shake(0.35 * k, 0.04);
      if (!player.dead && Math.hypot(pl.x - ray.T.x, pl.z - ray.T.z) < D.sunray.radius + player.hitRadius) player.takeDamage(ray.T.x, ray.T.z);
      if (Math.hypot(ray.T.x - ray.last.x, ray.T.z - ray.last.z) > 2.6) {
        field.burn(ray.T.x, ray.T.z, D.sunray.radius * 0.95, 3.4);
        ray.last.copy(ray.T);
      }
      if (ray.t >= ray.dur) {
        const T = ray.T.clone();
        this.ray = null;
        field.explode(T.x, T.z, 5.2, true);
        host.flash('#ffd9a0', 0.5, 0.5);
      }
    }
  }

  /** 몸통에 닿은 플레이어: 머리든 몸통이든 플레이어가 닿는 높이로 지나가면 피해 (돌진 · 추락 · 몸통이 끌려오는 구간 포함).
   *  쓰러져 바닥에 누운 몸은 벽처럼 막기만 하고 피해는 주지 않는다 */
  private updateStrike() {
    this.bodyHitCd = Math.max(0, this.bodyHitCd - this.lastDt);
    if (this.bodyHitCd > 0 || this.player.dead || !this.alive || this.dying > 0 || this.state === 'enter' || this.rig.lying) return;
    const pl = this.player.pos;
    for (const s of this.rig.parts) {
      if (s.kind === 'wing') continue;
      const R = s.r * 0.9 + 0.35;
      if (Math.hypot(pl.x - s.x, pl.z - s.z) < R && Math.abs(s.y - 0.9) < s.r + 1.2) {
        if (this.player.takeDamage(s.x, s.z)) this.bodyHitCd = 2.4; // 긴 몸통이 한 번 훑는 동안 연달아 맞지 않게
        return;
      }
    }
  }

  /** 불씨 · 먼지 · 날갯짓 바람 */
  private updateAmbient(dt: number) {
    const { host, rig, p } = this;
    const fx = host.fx;
    // 몸에서 흩날리는 불씨
    this.emberT += dt * (4 + this.phaseIndex * 5);
    while (this.emberT >= 1) {
      this.emberT -= 1;
      const i = Math.floor(Math.random() * rig.rings);
      rig.ring(i, this.tmp);
      fx.particles.burst(this.tmp, Math.random() < 0.5 ? 0xff6a1a : 0xffb040, 1, 1.0, 0.8, 0.2, 1.0, -1.5, 1.9);
    }
    // 낮게 날면 아래 땅에 먼지/불똥이 휘날린다
    if (p.y < 6 && this.speed > 14 && !rig.lying) {
      this.dustT -= dt;
      if (this.dustT <= 0) {
        this.dustT = 0.05;
        fx.particles.burst(this.tmp.set(p.x, 0.3, p.z), 0x6a4a3a, 4, 7, 0.7, 0.4, 0.3, 4, 1.0);
        fx.particles.burst(this.tmp.set(p.x, 0.3, p.z), 0xff8a30, 2, 5, 0.5, 0.2, 0.5, 4, 1.8);
        host.shake(0.28, 0.05);
      }
    }
  }

  private wingSound(dt: number) {
    this.beatT += dt * this.rig.wing.hz;
    if (this.beatT >= 1) {
      this.beatT -= 1;
      const d = Math.hypot(this.player.pos.x - this.p.x, this.player.pos.z - this.p.z);
      const v = clamp(1.15 - d / 55, 0.2, 1);
      if (this.rig.wing.amp > 0.15) this.host.sfx.wingbeat(v);
    }
  }

  /* ───────────────────────── 선회 → 공격 ───────────────────────── */
  private updateFly(dt: number) {
    const rig = this.rig;
    const hz = 0.55 + clamp(this.pitch, 0, 0.6) * 1.1;
    const cycle = 0.5 + 0.5 * Math.sin(this.t * 0.5);
    this.setWings({ hz, amp: 0.3 + 0.38 * cycle + clamp(this.pitch, 0, 0.5) * 0.4, fold: 0, raise: 0.1, spread: 1 });
    rig.undulate = 0.55 + 0.15 * this.phaseIndex;
    if (this.phaseTrigger) {
      this.phaseTrigger = false;
      this.startAttack('roar');
      return;
    }
    if (!this.attacksOn) return;
    this.idleT -= dt;
    if (this.idleT <= 0) this.startAttack(this.pickNext());
  }

  private pickNext(): AttackName {
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      return f;
    }
    const seq = D.sequence[this.phaseIndex];
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
  }

  private updateAttack(dt: number) {
    const sc = this.script;
    if (!sc) {
      this.endAttack();
      return;
    }
    this.scriptT += dt;
    for (const f of this.ticks) f(dt);
    while (this.stepIdx < sc.steps.length && sc.steps[this.stepIdx].at <= this.scriptT) sc.steps[this.stepIdx++].fn();
    if (this.scriptT >= sc.end && !this.move) this.endAttack();
  }

  /** 공격 중 매 프레임 불리는 함수를 등록한다 (충전 중인 빛 등). 공격이 끝나면 비워진다 */
  onTick(fn: (dt: number) => void) {
    this.ticks.push(fn);
  }

  /** 공격 중 delay 초 뒤에 한 번 실행한다 (공격이 끝나면 취소) */
  after(delay: number, fn: () => void) {
    let t = 0;
    let done = false;
    this.onTick((dt) => {
      if (done) return;
      t += dt;
      if (t >= delay) {
        done = true;
        fn();
      }
    });
  }

  private endAttack() {
    this.script = null;
    this.ticks = [];
    this.currentAttack = null;
    this.strikeOn = false;
    this.cruiseOverride = null;
    this.hover = null;
    this.jet = null;
    this.ray = null;
    this.invulnerable = false;
    this.relax();
    this.state = 'fly';
    this.idleT = D.idle[this.phaseIndex];
  }

  /** 디버그: 선회 중이면 다음 공격을 즉시 지정, 공격 중이면 끊고 시작 */
  forceAttack(name: string) {
    if (!this.alive || this.state === 'enter') return;
    if (this.state === 'attack') this.abortAttack();
    this.forced = name as AttackName;
    this.idleT = 0;
  }

  private abortAttack() {
    this.script = null;
    this.ticks = [];
    this.move = null;
    this.hover = null;
    this.jet = null;
    this.ray = null;
    this.strikeOn = false;
    this.cruiseOverride = null;
    this.host.fx.telegraphs.clear();
    this.field.clear();
    this.currentAttack = null;
    this.invulnerable = false;
    if (this.rig.lying) this.rig.liftOff();
    this.relax();
    this.state = 'fly';
  }

  /* ───────────────────────── 페이즈 ───────────────────────── */
  beginNextPhase() {
    this.phaseIndex = Math.min(D.phaseAt.length, this.phaseIndex + 1);
    this.seqIdx = 0;
    this.invulnerable = true;
    this.rig.setRage(this.phaseIndex);
    this.host.sfx.drone(true, this.phaseIndex >= 2 ? 1 : 0.5);
  }

  private nextPhaseAt(): number | undefined {
    return (D.phaseAt as readonly number[])[this.phaseIndex];
  }

  /* ───────────────────────── 판정 (Target) ───────────────────────── */
  bodies(): Circle[] {
    return this.alive && this.rig.lying ? this.rig.bodies() : [];
  }

  aimSpheres(): readonly Sphere[] {
    return this.alive ? this.rig.parts : [];
  }

  lockPoint(out: THREE.Vector3) {
    return out.copy(this.lockPos);
  }

  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive) return 0;
    let kind: 'head' | 'body' | 'wing' | null = null;
    for (const s of this.rig.parts) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dz = p.z - s.z;
      const rr = s.r + r;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        if (s.kind === 'head') {
          kind = 'head';
          break;
        }
        if (!kind) kind = s.kind;
      }
    }
    if (!kind) return 0;
    if (this.invulnerable) {
      this.blockSfx();
      return BLOCKED;
    }
    if (kind === 'head') return this.damage(dmg * (this.exposed ? D.exposedMult : D.headMult), this.exposed ? 'exposed' : 'weak', p);
    if (kind === 'wing') return this.damage(dmg * D.wingMult, 'body', p);
    return this.damage(dmg * D.bodyMult, 'body', p);
  }

  hitRadial(c: THREE.Vector3, radius: number, dmg: number) {
    if (!this.alive || this.invulnerable) return;
    // 특수기(등불 폭발)는 바닥에서 터지므로 위 하늘의 용에게는 "머리 위"를 기준으로 닿는다
    for (const s of this.rig.parts) {
      if (Math.hypot(c.x - s.x, c.z - s.z) < radius + s.r && s.y < 26) {
        this.damage(dmg, 'special', this.tmp2.set(s.x, s.y, s.z));
        return;
      }
    }
  }

  hitSplash(x: number, z: number, r: number, dmg: number, y = 1): number {
    if (!this.alive || this.invulnerable) return 0;
    for (const s of this.rig.parts) {
      const dx = x - s.x;
      const dy = y - s.y;
      const dz = z - s.z;
      const rr = r + s.r;
      if (dx * dx + dy * dy + dz * dz < rr * rr) return this.damage(dmg, 'splash', this.tmp2.set(s.x, s.y, s.z));
    }
    return 0;
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
    this.rig.flash(kind === 'body' ? 0.5 : 1);
    const strong = kind !== 'body' || amount >= 6;
    this.host.sfx.hit(amount);
    if (strong && kind !== 'body' && this.t - this.lastHurtRoar > 1.2) {
      this.lastHurtRoar = this.t;
    }
    if (strong || this.t - this.lastNum > 0.22) {
      this.lastNum = this.t;
      const where = at ? this.tmp.set(at.x, at.y + 1.8, at.z) : this.tmp.set(this.lockPos.x, this.lockPos.y + 2.4, this.lockPos.z);
      const fk: FloatKind = kind === 'weak' || kind === 'exposed' || kind === 'special' ? kind : 'normal';
      this.host.floatText(where, String(Math.round(amount)) + (kind === 'exposed' ? '!' : ''), fk);
    }
    if (strong) {
      this.host.hitStop(0.035);
      this.host.shake(0.16);
    }
    if (this.hp <= 0) this.die();
    return amount;
  }

  /* ───────────────────────── 사망: 불덩이가 되어 추락 ───────────────────────── */
  private die() {
    if (this.state === 'dead') return;
    const { host } = this;
    this.alive = false;
    this.state = 'dead';
    this.script = null;
    this.ticks = [];
    this.move = null;
    this.hover = null;
    this.jet = null;
    this.ray = null;
    this.strikeOn = false;
    this.exposed = false;
    host.fx.telegraphs.clear();
    this.field.clear();
    host.hitStop(0.22);
    host.slowmo(0.3, 1.8);
    host.shake(1.8, 0.3);
    host.sfx.bossDeath();
    host.sfx.roar();
    host.sfx.drone(false);
    host.flash('#ffd9a0', 0.55, 0.9);
    host.skyPulse?.(1);
    const c = this.tmp.set(this.lockPos.x, this.lockPos.y, this.lockPos.z);
    host.fx.burstLight(c, 0xffc070, 300, 1.2);
    host.fx.particles.burst(c, 0xff4a2a, 100, 16, 1.3, 0.34, 0.8);
    host.fx.particles.burst(c, 0xffe06a, 50, 12, 1.0, 0.24, 0.8);
    this.dying = 0.0001;
    this.deathNext = 0;
    const f = this.fwdXZ;
    this.dyingVel.set(f.x * 9, 4, f.z * 9);
    this.setWings({ hz: 0.2, amp: 0.2, fold: 0.8, raise: -0.6 });
    this.rig.jaw = 1;
    this.rig.undulate = 1.3;
    this.rig.stunned = false;
    this.onDeath();
  }

  private updateDying(dt: number) {
    const { host, rig, p } = this;
    if (this.dying <= 0) return;
    const fx = host.fx;
    this.dying += dt;
    const n = rig.rings;
    // 머리부터 꼬리까지 번갈아 터지며 떨어진다
    this.deathNext -= dt;
    while (this.deathNext <= 0) {
      this.deathNext += 0.035;
      const i = Math.floor(Math.random() * n);
      rig.ring(i, this.tmp);
      fx.particles.burst(this.tmp, Math.random() < 0.5 ? 0xff5a1a : 0xffc060, 6, 7, 0.9, 0.34, 0.6, 4, 2);
      fx.particles.burst(this.tmp, 0x2a1008, 3, 3, 1.2, 0.5, 0.8, 1, 1);
      if (Math.random() < 0.25) fx.burstLight(this.tmp, 0xff8030, 130, 0.35);
    }
    if (p.y > 1.4) {
      this.dyingVel.y -= 24 * dt;
      p.addScaledVector(this.dyingVel, dt);
      this.pitch = approach(this.pitch, -0.9, 2, dt);
      this.bank = approach(this.bank, 0.9, 1.5, dt);
      this.yaw += dt * 0.8;
      if (p.y <= 1.4) {
        p.y = 1.4;
        this.finalBlast();
      }
    } else if (this.dying > 3.6) {
      this.dying = 0;
    }
    this.syncRig(dt);
    rig.undulate = 1.3;
    host.shake(0.3, 0.05);
  }

  private finalBlast() {
    const { host, rig, p } = this;
    const fx = host.fx;
    host.hitStop(0.18);
    host.shake(2.6, 0.5);
    host.flash('#ffffff', 0.7, 1.0);
    host.skyPulse?.(1);
    host.sfx.explosion(true);
    host.sfx.boom();
    fx.ring(p.x, p.z, 30, 1.2, 0xffd27a);
    fx.ring(p.x, p.z, 16, 0.8, 0xffffff, 0.09);
    fx.burstLight(this.tmp.set(p.x, 3, p.z), 0xffc070, 400, 1.4);
    for (let i = 0; i < rig.rings; i += 2) {
      rig.ring(i, this.tmp);
      fx.particles.burst(this.tmp, 0xff4a2a, 9, 14, 1.3, 0.4, 0.9, 5, 2);
      fx.particles.burst(this.tmp, 0xffd060, 5, 10, 1.0, 0.3, 0.9, 5, 2);
    }
    rig.explodeHide();
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
    this.field.dispose();
    this.rig.dispose();
    this.host.sfx.drone(false);
    this.host.targets = this.host.targets.filter((t) => t !== this);
  }
}

void TAU;
