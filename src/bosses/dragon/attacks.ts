import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import type { AttackScript, Step } from '../../types';
import type { Dragon } from './dragon';

export type { AttackScript, Step };

const V3 = THREE.Vector3;
const D = CFG.dragon;
const TAU = Math.PI * 2;

export type AttackName = 'spit' | 'strafe' | 'swoop' | 'meteor' | 'crash' | 'sunray' | 'gale' | 'roar';
export const SEQUENCE_ATTACKS: AttackName[] = ['spit', 'strafe', 'swoop', 'meteor', 'crash', 'sunray', 'gale'];

export function buildAttack(name: AttackName, s: Dragon): AttackScript {
  switch (name) {
    case 'spit':
      return spit(s);
    case 'strafe':
      return strafe(s);
    case 'swoop':
      return swoop(s);
    case 'meteor':
      return meteor(s);
    case 'crash':
      return crash(s);
    case 'sunray':
      return sunray(s);
    case 'gale':
      return gale(s);
    case 'roar':
      return roar(s);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 아레나 안(반경 - margin)으로 끌어들인다 */
function inArena(v: THREE.Vector3, margin: number) {
  const lim = WORLD.radius - margin;
  const d = Math.hypot(v.x, v.z);
  if (d > lim) {
    v.x *= lim / d;
    v.z *= lim / d;
  }
  return v;
}

/** 플레이어가 곧 있을 자리(이동 방향으로 lead 초 앞) */
function ahead(s: Dragon, lead: number) {
  const pl = s.player;
  return inArena(new V3(pl.pos.x + pl.vel.x * lead, 0, pl.pos.z + pl.vel.z * lead), 1.2);
}

/* ───────────────────────── 화염탄 ─────────────────────────
 * 입에 불을 모았다가(입속이 밝아진다) 불덩이를 연달아 던진다. 불덩이마다 착지 고리가 차오르고 터진다.
 * 페이즈 2~: 맞은 자리에 불길이 남고, 둘째 불덩이부터는 플레이어 둘레로 흩어져 떨어져 계속 움직여야 한다.
 */
function spit(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.spit;
  const W = C.windup[ph];
  const n = C.count[ph];
  const base = Math.random() * TAU;
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('player');
        s.rig.jaw = 0.55;
        s.rig.fire = 1;
        s.setWings({ hz: 0.95, amp: 0.55 });
        s.host.sfx.flame(W, 0.7);
        s.host.sfx.telegraph();
      },
    },
  ];
  for (let i = 0; i < n; i++) {
    steps.push({
      at: W + i * C.gap,
      fn: () => {
        const M = s.mouthPos(new V3());
        const tgt = ahead(s, 0.4);
        if (i > 0 && ph >= 1) {
          const a = base + (i / n) * TAU;
          const r = C.spread * (0.7 + 0.3 * ((i * 7) % 3) / 2);
          tgt.x += Math.cos(a) * r;
          tgt.z += Math.sin(a) * r;
          inArena(tgt, 1.0);
        }
        s.field.lob(M, tgt, C.flight, C.peak, C.radius, C.zone[ph]);
        s.host.sfx.spit();
        s.host.shake(0.22, 0.05);
        s.host.fx.particles.burst(M, 0xffb040, 14, 7, 0.4, 0.2, 0.3, 2, 2);
        s.host.fx.burstLight(M, 0xff8030, 90, 0.2);
        s.rig.jaw = 1;
      },
    });
    steps.push({ at: W + i * C.gap + 0.14, fn: () => (s.rig.jaw = 0.55) });
  }
  const last = W + (n - 1) * C.gap;
  steps.push({
    at: last + 0.4,
    fn: () => {
      s.rig.fire = 0;
      s.rig.jaw = 0.1;
      s.look('off');
    },
  });
  return { steps, end: last + C.flight + C.recover };
}

/** 가로지르는 선(중심 c, 방향 ang)의 양끝과 단위 방향 */
function lineOf(cx: number, cz: number, ang: number, len: number) {
  const ux = Math.cos(ang);
  const uz = Math.sin(ang);
  return { ux, uz, A: new V3(cx - ux * len * 0.5, 0, cz - uz * len * 0.5), B: new V3(cx + ux * len * 0.5, 0, cz + uz * len * 0.5) };
}

/* ───────────────────────── 화염 숨결 통과 ─────────────────────────
 * 바닥에 긴 붉은 예고선 → 용이 선 한쪽 끝 하늘에서 내려와 선을 따라 낮게 날며 불을 뿜는다.
 * 숨결이 닿은 자리는 한동안 불탄다. 선 밖으로 빠지면 된다. (페이즈 2~: 방향을 바꿔 두 번 지나간다)
 */
function strafe(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.strafe;
  const passes = C.passes[ph];
  const tell = C.tell[ph];
  const speed = C.speed[ph];
  const LEN = 78;
  const steps: Step[] = [];
  let prevAng = Math.atan2(s.player.pos.z - s.p.z, s.player.pos.x - s.p.x);
  let t0 = 0;
  const runs: { ang: number; cx: number; cz: number }[] = [];
  const runDur = (LEN + 6) / speed;
  for (let k = 0; k < passes; k++) {
    const T0 = t0;
    steps.push({
      at: T0,
      fn: () => {
        const pl = s.player.pos;
        const ang = k === 0 ? Math.atan2(pl.z - s.p.z, pl.x - s.p.x) : prevAng + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.5);
        prevAng = ang;
        const c = ahead(s, 0.25);
        runs[k] = { ang, cx: c.x, cz: c.z };
        const { ux, uz, A, B } = lineOf(c.x, c.z, ang, LEN);
        // 예고선: 숨결이 실제로 닿는 구간(머리 앞 약 11 지점부터)
        const sx = A.x + ux * 20;
        const sz = A.z + uz * 20;
        s.host.fx.telegraphs.line(sx, sz, ang, LEN - 20, C.width, tell, () => {});
        s.host.sfx.telegraph();
        s.look('off');
        s.rig.jaw = 0.4;
        s.rig.fire = 0.6;
        s.setWings({ hz: 1.1, amp: 0.7, fold: 0 });
        s.fly([new V3(A.x - ux * 8, 16, A.z - uz * 8), new V3(A.x + ux * 10, 13, A.z + uz * 10)], tell * 0.98, 'io');
        void B;
      },
    });
    steps.push({
      at: T0 + tell,
      fn: () => {
        const r = runs[k];
        const { ux, uz, A, B } = lineOf(r.cx, r.cz, r.ang, LEN);
        s.rig.jaw = 1;
        s.rig.fire = 1;
        s.setWings({ fold: 0.4, hz: 1.5, amp: 0.3 });
        s.rig.tuck = 0.9;
        s.startJet(C.burnLife);
        s.host.sfx.flame(runDur, 1);
        s.host.shake(0.5, 0.3);
        s.fly(
          [new V3(A.x + ux * 26, 9.5, A.z + uz * 26), new V3(A.x + ux * 50, 8.2, A.z + uz * 50), new V3(B.x, 10, B.z), new V3(B.x + ux * 16, 17, B.z + uz * 16)],
          runDur,
          'lin',
          () => {
            s.stopJet();
            s.rig.jaw = 0.1;
            s.rig.fire = 0;
            s.setWings({ fold: 0, hz: 1.0, amp: 0.6 });
          },
        );
      },
    });
    t0 = T0 + tell + runDur + 0.35;
  }
  return { steps, end: t0 };
}

/* ───────────────────────── 저공 돌진 ─────────────────────────
 * 굵은 붉은 띠 → 용이 날개를 접고 땅에 닿을 듯 날아온다. 머리와 길게 끌리는 몸통이 띠를 쓸고 지나간다.
 */
function swoop(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.swoop;
  const passes = C.passes[ph];
  const tell = C.tell[ph];
  const speed = C.speed[ph];
  const LEN = 84;
  const steps: Step[] = [];
  let prevAng = 0;
  let t0 = 0;
  const runs: { ang: number; cx: number; cz: number }[] = [];
  const runDur = (LEN + 20) / speed;
  for (let k = 0; k < passes; k++) {
    const T0 = t0;
    steps.push({
      at: T0,
      fn: () => {
        const pl = s.player.pos;
        const ang = k === 0 ? Math.atan2(pl.z - s.p.z, pl.x - s.p.x) : prevAng + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.4);
        prevAng = ang;
        const c = ahead(s, 0.3);
        runs[k] = { ang, cx: c.x, cz: c.z };
        const { ux, uz, A } = lineOf(c.x, c.z, ang, LEN);
        s.host.fx.telegraphs.line(A.x + ux * 14, A.z + uz * 14, ang, LEN - 14, C.width, tell, () => {});
        s.host.sfx.telegraph();
        s.look('player');
        s.rig.jaw = 0.5;
        s.setWings({ hz: 1.2, amp: 0.7, fold: 0 });
        s.fly([new V3(A.x - ux * 10, 15, A.z - uz * 10), new V3(A.x + ux * 6, 10, A.z + uz * 6)], tell * 0.98, 'io');
      },
    });
    steps.push({
      at: T0 + tell,
      fn: () => {
        const r = runs[k];
        const { ux, uz, A, B } = lineOf(r.cx, r.cz, r.ang, LEN);
        s.strikeOn = true;
        s.look('off');
        s.rig.jaw = 1;
        s.rig.tuck = 1;
        s.setWings({ fold: 0.95, hz: 0.1, amp: 0.1 });
        s.host.sfx.leap();
        s.host.shake(0.6, 0.4);
        s.fly(
          [new V3(A.x + ux * 24, 4.6, A.z + uz * 24), new V3(A.x + ux * 38, 2.6, A.z + uz * 38), new V3(B.x - ux * 18, 2.6, B.z - uz * 18), new V3(B.x + ux * 4, 6, B.z + uz * 4), new V3(B.x + ux * 24, 17, B.z + uz * 24)],
          runDur,
          'lin',
          () => {
            s.strikeOn = false;
            s.rig.jaw = 0.1;
            s.setWings({ fold: 0, hz: 1.2, amp: 0.8 });
          },
        );
      },
    });
    t0 = T0 + tell + runDur + 0.3;
  }
  return { steps, end: t0 };
}

/* ───────────────────────── 유성우 (페이즈 2~) ─────────────────────────
 * 용이 하늘 끝까지 솟아올라 포효하면 구름이 갈라지며 불타는 유성이 쏟아진다.
 * 유성마다 착지 고리가 차오른다. 일부는 플레이어가 서 있는 곳을 겨눈다.
 */
function meteor(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.meteor;
  const n = C.count[ph];
  const gap = C.gap[ph];
  const t1 = 2.3;
  const ang0 = Math.random() * TAU;
  const dirX = Math.cos(ang0);
  const dirZ = Math.sin(ang0);
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('off');
        s.rig.jaw = 0.9;
        s.rig.fire = 0.8;
        s.setWings({ hz: 1.0, amp: 0.75, raise: 0.4 });
        s.cruiseOverride = { alt: 37, radius: 9 };
        s.fly([new V3(s.p.x * 0.4, 34, s.p.z * 0.4), new V3(0, 38, 0)], 2.0, 'io');
        s.host.sfx.roar();
        s.host.flash('#ff5a1a', 0.45, 0.9);
        s.host.skyPulse?.(1);
        s.host.shake(0.7, 0.4);
      },
    },
    {
      at: 1.9,
      fn: () => {
        s.host.banner('유성우', '하늘이 불탄다 — 고리가 사라지기 전에 벗어나라', 1.8);
        s.host.skyPulse?.(1);
        s.host.fx.burstLight(s.p.clone(), 0xff7a28, 300, 0.8);
      },
    },
  ];
  for (let i = 0; i < n; i++) {
    steps.push({
      at: t1 + i * gap,
      fn: () => {
        let x: number;
        let z: number;
        if (i % 3 === 0) {
          const t = ahead(s, 0.5);
          x = t.x;
          z = t.z;
        } else {
          const r = Math.sqrt(Math.random()) * (WORLD.radius - 2.5);
          const a = Math.random() * TAU;
          x = Math.cos(a) * r;
          z = Math.sin(a) * r;
        }
        s.field.meteor(x, z, C.radius, C.tell, dirX, dirZ, C.zone[ph]);
        if (i % 2 === 0) s.host.sfx.telegraph();
      },
    });
  }
  const tEnd = t1 + (n - 1) * gap + C.tell;
  steps.push({
    at: tEnd + 0.2,
    fn: () => {
      s.rig.fire = 0;
      s.rig.jaw = 0.1;
      s.cruiseOverride = null;
    },
  });
  return { steps, end: tEnd + 1.4 };
}

/* ───────────────────────── 추락 강타 (페이즈 2~) ─────────────────────────
 * 하늘 높이 올라 표적 위치를 정하면 큰 원이 차오른다. 날개를 접고 그곳에 내리꽂힌다.
 * 충격파가 퍼지고 용은 땅에 처박혀 몸통이 쏟아져 내려 눕는다 — 한동안 쓰러져 있다(머리 피해 대폭 증가). 일어설 때 날갯짓 돌풍.
 */
function crash(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.crash;
  const tell = C.tell[ph];
  const stun = C.stun[ph];
  const R = C.radius;
  const lockAt = 1.1;
  const impactAt = lockAt + tell;
  const T = new V3();
  const dir = new V3();
  const steps: Step[] = [];
  steps.push({
    at: 0,
    fn: () => {
      const pl = s.player.pos;
      const a = Math.random() * TAU;
      dir.set(Math.cos(a), 0, Math.sin(a));
      const hi = new V3(pl.x - dir.x * 26, 31, pl.z - dir.z * 26);
      s.look('player');
      s.rig.jaw = 0.8;
      s.setWings({ hz: 1.3, amp: 0.85, raise: 0.3 });
      s.host.sfx.roar();
      s.host.skyPulse?.(0.7);
      s.fly([hi], 1.0, 'io', () => s.hoverAt(hi, 4, Math.atan2(dir.x, dir.z), 0.12));
    },
  });
  steps.push({
    at: lockAt,
    fn: () => {
      T.copy(ahead(s, 0.3));
      s.host.fx.telegraphs.circle(T.x, T.z, R, tell, () => impact());
      s.host.sfx.telegraph();
      s.host.fx.ring(T.x, T.z, R * 1.3, 0.6, 0xff6a3a);
    },
  });
  // 날개를 접고 내리꽂는다 (착지 고리가 가득 차는 순간 머리가 닿도록)
  const diveDur = 0.52;
  steps.push({
    at: impactAt - diveDur,
    fn: () => {
      dir.set(T.x - s.p.x, 0, T.z - s.p.z).normalize();
      s.look('off');
      s.rig.jaw = 1;
      s.rig.tuck = 1;
      s.setWings({ fold: 1, hz: 0.05, amp: 0, raise: -0.2 });
      s.strikeOn = true;
      const mid = new V3((s.p.x + T.x) * 0.5, (s.p.y + 1.4) * 0.42, (s.p.z + T.z) * 0.5);
      s.fly([mid, new V3(T.x, 1.4, T.z)], diveDur, 'in');
      s.host.sfx.leap();
    },
  });
  const impact = () => {
    const { host, field, rig } = s;
    field.explode(T.x, T.z, R, true);
    field.wave(T.x, T.z, C.wave, 12, 1.5);
    host.hitStop(0.12);
    host.shake(2.4, 0.4);
    host.flash('#ffb060', 0.5, 0.5);
    host.skyPulse?.(0.8);
    host.sfx.land();
    host.sfx.explosion(true);
    host.fx.ring(T.x, T.z, R * 2.4, 0.9, 0xffd27a);
    host.fx.burstLight(new V3(T.x, 3, T.z), 0xffa050, 320, 0.9);
    host.fx.particles.burst(new V3(T.x, 0.8, T.z), 0x7a5a42, 70, 13, 1.2, 0.5, 0.6, 7, 1.2);
    host.fx.particles.burst(new V3(T.x, 0.6, T.z), 0xff7a28, 60, 12, 1.0, 0.3, 0.8, 6, 2);
    const pl = s.player;
    const d = Math.hypot(pl.pos.x - T.x, pl.pos.z - T.z);
    if (d < R * 2.2) pl.push(T.x, T.z, 10 * (1 - d / (R * 2.2)) + 3);
    // 땅에 박힌 채 미끄러지고, 몸통이 쏟아져 내려 눕는다
    rig.lieDown();
    rig.stunned = true;
    rig.tuck = 0.2;
    s.exposedOn(true);
    s.fly([new V3(T.x + dir.x * 10, 1.4, T.z + dir.z * 10)], 0.85, 'out', () => {
      s.strikeOn = false;
      s.hoverAt(new V3(s.p.x, 1.4, s.p.z), 8, Math.atan2(dir.x, dir.z), -0.28);
    });
  };
  // 쓰러져 있는 동안 콧김
  for (let k = 0; k < Math.floor(stun / 0.4); k++) {
    steps.push({
      at: impactAt + 1.0 + k * 0.4,
      fn: () => {
        const M = s.mouthPos(new V3());
        s.host.fx.particles.burst(M, 0x555050, 6, 2.5, 1.2, 0.5, 0.9, -1, 1);
        s.host.fx.particles.burst(M, 0xff6a20, 2, 2, 0.6, 0.2, 0.5, 0, 2);
      },
    });
  }
  const riseAt = impactAt + stun;
  steps.push({
    at: riseAt,
    fn: () => {
      const { host, rig } = s;
      s.exposedOn(false);
      rig.stunned = false;
      rig.liftOff();
      rig.jaw = 0.8;
      s.setWings({ hz: 1.5, amp: 1.0, fold: 0, raise: 0.25 });
      host.sfx.roar();
      host.sfx.wingbeat(1.5);
      host.shake(1.0, 0.3);
      s.field.wave(s.p.x, s.p.z, 14, 13, 1.3);
      host.fx.ring(s.p.x, s.p.z, 14, 0.6, 0xffa060);
      host.fx.particles.burst(new V3(s.p.x, 0.5, s.p.z), 0x7a5a42, 50, 11, 1.0, 0.5, 0.6, 6, 1.2);
      const pl = s.player;
      const d = Math.hypot(pl.pos.x - s.p.x, pl.pos.z - s.p.z);
      if (d < 14) pl.push(s.p.x, s.p.z, 8 * (1 - d / 14) + 2);
      const out = new V3(s.p.x + dir.x * 10, 15, s.p.z + dir.z * 10);
      s.fly([new V3(s.p.x + dir.x * 3, 8, s.p.z + dir.z * 3), out], 1.7, 'in');
    },
  });
  steps.push({ at: riseAt + 1.6, fn: () => (s.rig.jaw = 0.1) });
  return { steps, end: riseAt + 1.9 };
}

/* ───────────────────────── 태양 광선 (페이즈 3) ─────────────────────────
 * 용이 하늘 끝에서 날개를 활짝 펴고 입가에 태양을 키운다(하늘이 어두워지고 빛이 소용돌이친다).
 * 땅에 붉은 고리가 표적을 가두면 광선이 내리꽂히고, 광선의 조준점은 플레이어를 끈질기게 쫓으며 지나간 자리를 불사른다.
 */
function sunray(s: Dragon): AttackScript {
  const C = D.sunray;
  const t1 = 2.0;
  const tFire = t1 + C.charge;
  const station = new V3();
  let tt = 0;
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        const pl = s.player.pos;
        const a = Math.atan2(pl.z, pl.x) + Math.PI + (Math.random() - 0.5) * 0.9;
        station.set(Math.cos(a) * 28, 25, Math.sin(a) * 28);
        s.look('player');
        s.rig.jaw = 0.5;
        s.setWings({ hz: 0.8, amp: 0.5, raise: 0.5, spread: 1 });
        s.host.sfx.telegraph();
        s.host.skyPulse?.(0.5);
        s.fly([station], t1, 'io', () => s.hoverAt(station, 3, null, 0.22));
      },
    },
    {
      at: t1,
      fn: () => {
        s.rig.jaw = 0.95;
        s.rig.fire = 1;
        s.setWings({ hz: 0.5, amp: 0.3, raise: 0.8 });
        s.host.sfx.sunCharge(C.charge);
        s.host.banner('태양 광선', '조준점이 끝까지 쫓아온다 — 멈추지 마라', 2.0);
        s.host.skyPulse?.(1);
        const tmp = new V3();
        const fwd = new V3();
        s.onTick((dt) => {
          tt += dt;
          const k = clamp((tt - t1) / C.charge, 0, 1);
          s.mouthPos(tmp);
          s.rig.headForward(fwd);
          tmp.addScaledVector(fwd, 2.4 + 1.8 * k);
          s.field.charge(tmp, s.rayOn ? 1 : k);
          s.host.shake(0.08 + 0.3 * k, 0.05);
          if (Math.random() < dt * 3 * k) s.host.skyPulse?.(0.5);
        });
      },
    },
    {
      at: tFire - C.lock,
      fn: () => {
        const T = ahead(s, 0.3);
        s.host.fx.telegraphs.circle(T.x, T.z, C.radius + 0.8, C.lock, () => {
          s.startRay(T, C.dur);
          s.host.shake(1.2, 0.4);
          s.host.flash('#fff0d0', 0.4, 0.4);
        });
        s.host.sfx.telegraph();
      },
    },
    {
      at: tFire + C.dur + 0.15,
      fn: () => {
        s.rig.fire = 0;
        s.rig.jaw = 0.1;
        s.look('off');
        s.setWings({ hz: 0.9, amp: 0.6, raise: 0.15 });
        s.host.shake(0.8, 0.2);
      },
    },
  ];
  return { steps, end: tFire + C.dur + 1.6 };
}

/* ───────────────────────── 날개 충격파 (페이즈 3) ─────────────────────────
 * 제단 한복판 위에서 날개를 높이 들었다가 내리친다. 내리칠 때마다 땅을 훑는 불꽃 고리가 사방으로 퍼지고 돌풍이 몸을 밀어낸다.
 * 고리는 대시(무적)로 통과한다. 마지막 일격은 고리 두 겹.
 */
function gale(s: Dragon): AttackScript {
  const C = D.gale;
  const t1 = 1.9;
  const hoverPt = new V3(0, 12.5, 0);
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('player');
        s.rig.jaw = 0.4;
        s.setWings({ hz: 1.2, amp: 0.7, raise: 0.5 });
        s.fly([new V3(s.p.x * 0.3, 15, s.p.z * 0.3), hoverPt], 1.5, 'io', () => s.hoverAt(hoverPt, 3.5, null, 0.12));
        s.host.sfx.roar();
        s.host.skyPulse?.(0.7);
      },
    },
  ];
  for (let k = 0; k < C.beats; k++) {
    const tb = t1 + k * C.gap;
    const last = k === C.beats - 1;
    // 날개를 높이 들어 올리며 중앙에 예고 → 가득 차는 순간 내리친다
    steps.push({
      at: tb - C.tell,
      fn: () => {
        s.setWings({ hz: 0.2, amp: 0, raise: 1.05, spread: 1 });
        s.host.sfx.telegraph();
        s.host.fx.telegraphs.circle(0, 0, C.radius, C.tell, () => slam(last));
      },
    });
    steps.push({ at: tb + 0.45, fn: () => s.setWings({ hz: 0.9, amp: 0.4, raise: 0.4 }) });
  }
  const slam = (finale: boolean) => {
    const { host, field } = s;
    s.setWings({ hz: 0, amp: 0, raise: -0.65, spread: 1 });
    field.explode(0, 0, C.radius, true);
    field.wave(0, 0, WORLD.radius + 8, C.speed, C.width);
    if (finale) field.wave(0, 0, WORLD.radius + 8, C.speed * 1.2, C.width, 0.32);
    host.shake(1.6, 0.35);
    host.sfx.wingbeat(1.8);
    host.sfx.land();
    host.skyPulse?.(0.8);
    host.fx.ring(0, 0, 30, 0.9, 0xffb060);
    host.fx.burstLight(new V3(0, 2, 0), 0xff8a30, 260, 0.6);
    host.fx.particles.burst(new V3(0, 0.8, 0), 0xff7a28, 70, 16, 1.1, 0.3, 0.9, 5, 2);
    host.fx.particles.burst(new V3(0, 0.6, 0), 0x5a4030, 40, 12, 1.2, 0.5, 0.6, 5, 1);
    // 돌풍: 중심에서 멀어질수록 약하게 밀어낸다
    const pl = s.player;
    const d = Math.hypot(pl.pos.x, pl.pos.z);
    if (d < 24) pl.push(0, 0, 8 * (1 - d / 24) + 2);
  };
  const tEnd = t1 + (C.beats - 1) * C.gap;
  steps.push({
    at: tEnd + 1.0,
    fn: () => {
      s.rig.jaw = 0.1;
      s.look('off');
      s.setWings({ hz: 1.0, amp: 0.6, raise: 0.15 });
    },
  });
  return { steps, end: tEnd + 2.0 };
}

/* ───────────────────────── 페이즈 전환 포효 ─────────────────────────
 * 하늘 높이 떠올라 날개를 펴고 포효 → 불기둥을 하늘로 뿜는다 → 충격파(밀어내기, 피해 없음). 포효 동안 무적.
 */
function roar(s: Dragon): AttackScript {
  const T = D.roar;
  const hold = new V3(0, 21, 0);
  let tt = 0;
  return {
    steps: [
      {
        at: 0,
        fn: () => {
          s.beginNextPhase();
          s.look('player');
          s.rig.jaw = 1;
          s.rig.fire = 0.7;
          s.setWings({ hz: 0.5, amp: 0.25, raise: 0.9, spread: 1 });
          s.fly([new V3(s.p.x * 0.5, 22, s.p.z * 0.5), hold], 1.1, 'io', () => s.hoverAt(hold, 3, null, 0.45));
          s.host.sfx.roar();
          s.host.flash(s.phaseIndex >= 2 ? '#4a0008' : '#ff3a1a', 0.55, 1.1);
          s.host.slowmo(0.4, 1.0);
          s.host.shake(0.9, 0.4);
          s.host.skyPulse?.(1);
          const tmp = new V3();
          const up = new V3();
          s.onTick((dt) => {
            tt += dt;
            if (tt < 0.8 || tt > T - 0.6) return;
            // 하늘을 향해 불기둥
            s.mouthPos(tmp);
            up.set(tmp.x + Math.sin(s.yaw) * 5, tmp.y + 26, tmp.z + Math.cos(s.yaw) * 5);
            s.field.jet(tmp, up, 1);
            s.host.shake(0.5, 0.05);
          });
        },
      },
      {
        at: 0.35,
        fn: () => {
          if (s.phaseIndex >= 2) s.host.banner('광란', '겁화의 용이 이성을 잃었다 — 하늘이 불탄다', 2.4);
          else s.host.banner('분노', '겁화의 용이 격노했다', 2.0);
        },
      },
      {
        at: 0.8,
        fn: () => {
          const { host } = s;
          const pl = s.player;
          const q = pl.pos;
          host.fx.ring(q.x, q.z, 24, 0.9, 0xff5a4a);
          host.fx.ring(0, 0, 14, 0.6, 0xffb09a, 0.09);
          host.fx.burstLight(new V3(0, 4, 0), 0xff3a2a, 260, 0.9);
          host.shake(2.4, 0.4);
          host.flash(s.phaseIndex >= 2 ? '#2a0004' : '#ff5a3a', 0.45, 0.8);
          const d = Math.hypot(q.x, q.z);
          if (d < 24) pl.push(0, 0, 12 * (1 - d / 24) + 4);
          host.fx.particles.burst(new V3(0, 1, 0), 0xff6a4a, 90, 16, 1.1, 0.24, 0.5);
          host.skyPulse?.(1);
        },
      },
      ...[1.1, 1.45, 1.8].map((at, i) => ({
        at,
        fn: () => {
          s.host.fx.ring(0, 0, 28 + i * 8, 0.9, s.phaseIndex >= 2 ? 0x8a1020 : 0xff6a4a);
          s.host.shake(1.4 - i * 0.3, 0.2);
          s.host.sfx.wingbeat(1.4);
          s.host.skyPulse?.(0.6);
        },
      })),
      {
        at: T - 0.7,
        fn: () => {
          s.rig.jaw = 0.1;
          s.rig.fire = 0;
          s.look('off');
          s.setWings({ hz: 0.9, amp: 0.55, raise: 0.1 });
        },
      },
    ],
    end: T,
  };
}
