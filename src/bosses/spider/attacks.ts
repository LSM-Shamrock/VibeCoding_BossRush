import * as THREE from 'three';
import { CFG } from '../../config';
import type { Spider } from './spider';

const V3 = THREE.Vector3;
const S = CFG.spider;

export type AttackName = 'web' | 'pounce' | 'triple' | 'barrage' | 'eggs' | 'stagger' | 'roar';
export const SEQUENCE_ATTACKS: AttackName[] = ['web', 'pounce', 'barrage', 'eggs', 'triple'];

export interface Step {
  at: number;
  fn: () => void;
}

/**
 * 공격 = "시간표". 예비동작(Telegraph) → 공격 → 후딜(약점 노출) 이 한 눈에 보이도록
 * 각 단계를 at(초) + 함수로 늘어놓는다. 보스 본체는 이 시간표를 실행만 한다.
 */
export interface AttackScript {
  steps: Step[];
  end: number;
}

const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const arenaClamp = (v: THREE.Vector3, margin: number) => {
  const lim = CFG.arena.radius - margin;
  const d = Math.hypot(v.x, v.z);
  if (d > lim) v.multiplyScalar(lim / d);
  return v;
};

export function buildAttack(name: AttackName, s: Spider): AttackScript {
  switch (name) {
    case 'web':
      return web(s);
    case 'pounce':
      return jumps(s, { n: 1, crouch: S.pounce.crouch * s.tempo, flight: S.pounce.flight, radius: S.pounce.radius, gap: 0, recover: S.pounce.recover[s.phaseIndex], peak: S.pounce.peak });
    case 'triple':
      return jumps(s, { n: S.triple.count, crouch: S.triple.crouch, flight: S.triple.flight, radius: S.triple.radius, gap: S.triple.gap, recover: S.triple.recover, peak: S.triple.peak });
    case 'barrage':
      return barrage(s);
    case 'eggs':
      return eggs(s);
    case 'stagger':
      return stagger(s);
    case 'roar':
      return roar(s);
  }
}

/* ───────────────────────── 거미줄 발사 ─────────────────────────
 * 예비동작: 앞다리 2개를 들고 몸을 뒤로 젖힘 → 예고선(굵은 직선)
 * 공격: 조준 투사체 (맞으면 감속, 대시로 끊어낼 수 있음)   페이즈 2: 3갈래
 */
function web(s: Spider): AttackScript {
  const o = S.web;
  const wind = o.windup * s.tempo;
  const steps: Step[] = [];
  const origin = new V3();
  let angles: number[] = [];

  steps.push({
    at: 0,
    fn: () => {
      s.setPose('webWind', 7);
      s.faceMode = 'track';
      s.faceRate = 4;
      s.host.sfx.telegraph();
    },
  });
  // 30% 지점에서 조준 고정: 예고선이 나타난 뒤에는 조준이 바뀌지 않는다 (옆으로 피할 수 있음)
  steps.push({
    at: wind * 0.3,
    fn: () => {
      s.faceMode = 'hold';
      s.rig.mouth(origin);
      const base = Math.atan2(s.player.pos.z - origin.z, s.player.pos.x - origin.x);
      const offs = s.phaseIndex === 0 ? [0] : [-o.fanAngle, 0, o.fanAngle];
      angles = offs.map((d) => base + d);
      for (const a of angles) s.host.fx.telegraphs.line(origin.x, origin.z, a, 26, o.lineW, wind * 0.7, () => {});
    },
  });
  steps.push({
    at: wind,
    fn: () => {
      for (const a of angles) {
        s.projectiles.spawn(origin.x, origin.z, Math.cos(a), Math.sin(a), o.speed, o.radius, 1.3, {
          kind: 'web',
          onHit: () => s.player.slow(o.slow),
        });
      }
      s.host.sfx.web();
      s.host.shake(0.25);
      s.host.fx.particles.burst(new V3(origin.x, 1.3, origin.z), 0xf3e6c8, 16, 7, 0.4, 0.1, 0.2);
      s.setPose('idle', 6);
    },
  });
  return { steps, end: wind + o.recover };
}

/* ───────────────────────── 점프 덮치기 / 연속 점프 ─────────────────────────
 * 예비동작: 다리를 모두 웅크리고 몸이 낮아짐 → 착지 마커(원)
 * 공격: 도약 → 착지 충격파 (마커 안이면 피격)
 * 후딜: 다리가 미끄러져 퍼지고 배가 바닥에 닿음 = 약점 노출
 */
interface JumpOpts {
  n: number;
  crouch: number;
  flight: number;
  radius: number;
  gap: number;
  recover: number;
  peak: number;
}

function jumps(s: Spider, o: JumpOpts): AttackScript {
  const steps: Step[] = [];
  let t = 0;
  for (let k = 0; k < o.n; k++) {
    const last = k === o.n - 1;
    const target = new V3();
    const tLock = t + o.crouch * 0.4;
    const tLeap = t + o.crouch;
    const tLand = tLeap + o.flight;

    steps.push({
      at: t,
      fn: () => {
        s.setPose('crouch', 9);
        s.faceMode = 'track';
        s.faceRate = 5;
        s.host.sfx.telegraph();
      },
    });
    // 착지 지점은 도약 직전에 고정 → 마커를 보고 벗어날 시간이 있다
    steps.push({
      at: tLock,
      fn: () => {
        target.copy(s.player.pos).setY(0);
        arenaClamp(target, 1.2);
        s.faceMode = 'to';
        s.faceYaw = yawOf(target.x - s.pos.x, target.z - s.pos.z);
        s.faceRate = 8;
        s.host.fx.telegraphs.circle(target.x, target.z, o.radius, tLand - tLock, () => {});
      },
    });
    steps.push({
      at: tLeap,
      fn: () => {
        s.host.sfx.leap();
        s.host.fx.particles.burst(new V3(s.pos.x, 0.3, s.pos.z), 0xb8a58a, 20, 6, 0.5, 0.16, 0.4);
        s.startJump(target, o.flight, o.peak, () => land(s, target, o.radius, last));
      },
    });
    t = tLand + (last ? 0 : o.gap);
  }
  // 후딜: 마지막 착지 이후
  steps.push({ at: t + 0.02, fn: () => s.setExposed(true) });
  steps.push({ at: t + o.recover - 0.5, fn: () => s.setPose('idle', 4) });
  return { steps, end: t + o.recover };
}

function land(s: Spider, to: THREE.Vector3, radius: number, last: boolean) {
  const { host, player } = s;
  host.fx.ring(to.x, to.z, radius * 1.08, 0.45, 0xffb36b);
  host.fx.ring(to.x, to.z, radius * 0.55, 0.3, 0xffffff, 0.09);
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = radius * (0.3 + Math.random() * 0.8);
    host.fx.particles.burst(new V3(to.x + Math.cos(a) * d, 0.2, to.z + Math.sin(a) * d), 0xb8a58a, 3, 5, 0.6, 0.18, 0.7);
  }
  host.fx.burstLight(new V3(to.x, 1.5, to.z), 0xffa060, 90, 0.4);
  host.shake(last ? 1.0 : 0.7);
  host.hitStop(0.05);
  host.sfx.land();
  if (!player.dead && Math.hypot(player.pos.x - to.x, player.pos.z - to.z) < radius + player.hitRadius) player.takeDamage(to.x, to.z);

  // 다리가 사방으로 퍼지며 착지
  if (last) {
    s.setPose('splay', 26);
    s.rig.slideFeet(1.38, 0.13);
  } else {
    s.setPose('crouch', 20);
    s.rig.slideFeet(0.9, 0.1);
  }
}

/* ───────────────────────── 독침 탄막 ─────────────────────────
 * 예비동작: 뒤돌아서 배를 치켜들고 부들부들 + 부채꼴 예고
 * 공격: 부채꼴 독침 (페이즈 2: 엇갈린 2연발)
 * 후딜: 배가 천천히 내려옴 = 약점 노출 (배가 플레이어를 향해 있다)
 */
function barrage(s: Spider): AttackScript {
  const o = S.barrage;
  const ph = s.phaseIndex;
  const wind = o.windup * s.tempo;
  const steps: Step[] = [];
  const origin = new V3();
  let aim = 0;
  const n = o.count[ph];
  const spread = o.spread[ph];

  steps.push({
    at: 0,
    fn: () => {
      // 배(꼬리쪽)가 플레이어를 향하도록 180° 회전
      s.faceMode = 'to';
      s.faceYaw = yawOf(s.player.pos.x - s.pos.x, s.player.pos.z - s.pos.z) + Math.PI;
      s.faceRate = 9;
      s.setPose('barrage', 6);
      s.host.sfx.telegraph();
    },
  });
  steps.push({
    at: o.turn,
    fn: () => {
      s.faceMode = 'hold';
      s.rig.muzzle(origin);
      aim = Math.atan2(s.player.pos.z - origin.z, s.player.pos.x - origin.x);
      s.host.fx.telegraphs.fan(origin.x, origin.z, aim, spread / 2 + 0.05, 24, wind, () => {});
    },
  });
  const tFire = o.turn + wind;
  for (let v = 0; v < o.volleys[ph]; v++) {
    steps.push({
      at: tFire + v * o.volleyGap,
      fn: () => {
        for (let j = 0; j < n; j++) {
          const a = aim - spread / 2 + (j + 0.5 * (v % 2)) * (spread / (n - 1));
          s.projectiles.spawn(origin.x, origin.z, Math.cos(a), Math.sin(a), o.speed, o.radius, 1.7, { kind: 'poison' });
        }
        s.host.sfx.spit();
        s.host.shake(0.3);
        s.host.fx.particles.burst(new V3(origin.x, 2.5, origin.z), 0xff4a2a, 14, 6, 0.4, 0.12, 0.3);
      },
    });
  }
  const tAfter = tFire + (o.volleys[ph] - 1) * o.volleyGap + 0.25;
  steps.push({
    at: tAfter,
    fn: () => {
      s.setPose('idle', 2.4); // 배가 천천히 내려온다
      s.setExposed(true);
    },
  });
  return { steps, end: tAfter + o.recover };
}

/* ───────────────────────── 알 투척 (페이즈 2) ─────────────────────────
 * 예비동작: 배가 꿀렁이며 떨림
 * 공격: 플레이어 근처로 알 2개를 던짐 → 일정 시간 뒤 부화(새끼 거미)
 * 알은 화살로 깨뜨릴 수 있다. 새끼를 모두 잡으면 여왕이 휘청인다.
 */
function eggs(s: Spider): AttackScript {
  const o = S.eggs;
  const wind = o.windup * s.tempo;
  const steps: Step[] = [];
  steps.push({
    at: 0,
    fn: () => {
      s.faceMode = 'track';
      s.faceRate = 3;
      s.setPose('eggs', 5);
      s.host.sfx.telegraph();
    },
  });
  steps.push({
    at: wind,
    fn: () => {
      const base = Math.random() * Math.PI * 2;
      for (let k = 0; k < o.count; k++) {
        const a = base + k * Math.PI + (Math.random() - 0.5) * 0.8;
        const d = 2.4 + Math.random() * 1.8;
        const to = new V3(s.player.pos.x + Math.cos(a) * d, 0, s.player.pos.z + Math.sin(a) * d);
        arenaClamp(to, 1.5);
        s.throwEgg(to);
      }
      s.host.sfx.spit();
      s.setPose('idle', 4);
      s.setExposed(true);
    },
  });
  return { steps, end: wind + o.recover };
}

/* ───────────────────────── 휘청 (새끼를 모두 처치) ───────────────────────── */
function stagger(s: Spider): AttackScript {
  const T = S.stagger;
  return {
    steps: [
      {
        at: 0,
        fn: () => {
          s.faceMode = 'hold';
          s.setPose('stagger', 6);
          s.setExposed(true);
          s.host.banner('새끼를 모두 처치!', '여왕이 휘청인다 — 약점을 노려라', 1.8);
          s.host.shake(0.5);
        },
      },
      { at: T - 0.55, fn: () => s.setPose('idle', 3) },
    ],
    end: T,
  };
}

/* ───────────────────────── 페이즈 전환 포효 ─────────────────────────
 * 뒷발로 일어서 포효 → 눈이 붉게 → 충격파(밀어내기, 데미지 없음). 포효 동안 무적.
 */
function roar(s: Spider): AttackScript {
  const T = S.roar;
  return {
    steps: [
      {
        at: 0,
        fn: () => {
          s.beginPhase2();
          s.faceMode = 'track';
          s.faceRate = 3;
          s.setPose('rear', 5);
          s.host.sfx.roar();
          s.host.slowmo(0.45, 0.7);
        },
      },
      {
        at: 0.35,
        fn: () => {
          s.rig.setRage(true);
          s.host.banner('분노', '동굴 여왕 거미가 격노했다', 2.0);
        },
      },
      {
        at: 0.65,
        fn: () => {
          const { host, player, pos } = s;
          host.fx.ring(pos.x, pos.z, 15, 0.9, 0xff5a4a);
          host.fx.ring(pos.x, pos.z, 9, 0.6, 0xffb09a, 0.09);
          host.fx.burstLight(new V3(pos.x, 3, pos.z), 0xff3a2a, 140, 0.9);
          host.shake(1.4);
          const d = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
          if (d < 14) player.push(pos.x, pos.z, 16 * (1 - d / 14) + 4);
          host.fx.particles.burst(new V3(pos.x, 1, pos.z), 0xff6a4a, 50, 14, 0.9, 0.2, 0.5);
        },
      },
      { at: T - 0.8, fn: () => s.setPose('idle', 3.5) },
    ],
    end: T,
  };
}
