import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import type { AttackScript, Step } from '../../types';
export type { AttackScript, Step };
import type { Serpent } from './serpent';

const V3 = THREE.Vector3;
const S = CFG.serpent;
const DUST = 0xb8a58a;

export type AttackName = 'lunge' | 'spit' | 'slam' | 'breath' | 'dive' | 'rimshot' | 'rimcharge' | 'roar';
export const SEQUENCE_ATTACKS: AttackName[] = ['lunge', 'spit', 'slam', 'breath', 'dive', 'rimshot', 'rimcharge'];

const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const arenaClamp = (v: THREE.Vector3, margin: number) => {
  const lim = WORLD.radius - margin;
  const d = Math.hypot(v.x, v.z);
  if (d > lim) v.multiplyScalar(lim / d);
  return v;
};

export function buildAttack(name: AttackName, s: Serpent): AttackScript {
  switch (name) {
    case 'lunge':
      return lunge(s);
    case 'spit':
      return spit(s);
    case 'slam':
      return slam(s);
    case 'breath':
      return breath(s);
    case 'dive':
      return dive(s);
    case 'rimshot':
      return rimshot(s);
    case 'rimcharge':
      return rimcharge(s);
    case 'roar':
      return roar(s);
  }
}

/** 머리를 쳐들어 후드를 펴고 쉬익 소리를 내며 노려보는 자세 */
function rear(s: Serpent, lift: number, hood: number, jaw: number, rate = 8) {
  const r = s.rig;
  r.lift = lift;
  r.liftRate = rate;
  r.hood = hood;
  r.jaw = jaw;
  r.tongueRate = 4;
  r.undulate = 0.3;
}

/** 머리를 낮추고 입을 다문 채 다시 사냥 자세로 돌아갈 준비 */
function relax(s: Serpent) {
  const r = s.rig;
  r.hood = 0;
  r.jaw = 0.1;
  r.tongueRate = 2;
  r.undulate = 0.35;
}

/* ───────────────────────── 일직선 돌진 ─────────────────────────
 * 예비동작: 몸을 쳐들고 후드를 펴 노려봄(쉬익) → 조준 고정 후 직선 예고(tell)
 * 공격: 쏜살같이 일직선으로 물어뜯으며 달려든다. 머리에 닿으면 피격 (예고선 폭 = 머리 판정). 몸은 머리가 낸 길을 따라 곧게 뻗는다.
 * 후딜: 달려든 방향으로 나선을 그리며 똬리를 틀고 머리를 높이 쳐든다 = 약점 노출. (똬리는 머리 뒤 몸이 따라 감기며 저절로 만들어진다)
 * 페이즈 2~: 방향을 바꿔 연속 돌진 (지그재그).
 */
function lunge(s: Serpent): AttackScript {
  const o = S.lunge;
  const ph = s.phaseIndex;
  const n = o.count[ph];
  const steps: Step[] = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    const tLock = t + (k === 0 ? o.windup[ph] : o.windup[ph] * 0.45);
    const tStrike = tLock + o.tell[ph];
    const origin = new V3();
    const to = new V3();
    let reach = 0;
    let dur = 0;

    steps.push({
      at: t,
      fn: () => {
        s.faceMode = 'track';
        s.faceRate = 7;
        s.look = 'player';
        rear(s, 4.8, 0.9, 0.4, 9);
        s.host.sfx.hiss(k === 0 ? 0.9 : 0.5, 0.9);
      },
    });
    // 조준 고정: 이 뒤로는 방향이 바뀌지 않는다 (옆으로 피할 수 있음)
    steps.push({
      at: tLock,
      fn: () => {
        origin.set(s.headPos.x, 0, s.headPos.z);
        const pl = s.player.pos;
        let dx = pl.x - origin.x;
        let dz = pl.z - origin.z;
        const dist = Math.hypot(dx, dz) || 1;
        dx /= dist;
        dz /= dist;
        reach = o.reach; // 거의 맵 끝까지
        // 아레나 벽에 닿는 곳까지만
        const b = origin.x * dx + origin.z * dz;
        const c = origin.x * origin.x + origin.z * origin.z - s.headLimit * s.headLimit;
        const disc = b * b - c;
        if (disc > 0) reach = Math.min(reach, -b + Math.sqrt(disc));
        reach = Math.max(6, reach);
        dur = reach / o.speed;
        to.set(origin.x + dx * reach, 0, origin.z + dz * reach);
        s.faceMode = 'to';
        s.faceYaw = yawOf(dx, dz);
        s.faceRate = 16;
        s.look = 'heading';
        rear(s, 1.7, 1, 0, 7);
        s.rig.tongueRate = 0.3;
        s.host.fx.telegraphs.line(origin.x, origin.z, Math.atan2(dz, dx), reach + 1.2, o.width, o.tell[ph], () => {});
        s.host.sfx.telegraph();
      },
    });
    steps.push({
      at: tStrike,
      fn: () => {
        s.faceMode = 'hold';
        s.rig.lift = 1.15;
        s.rig.liftRate = 20;
        s.rig.undulate = 0.1;
        s.rig.hood = 0.35;
        s.rig.jaw = 0;
        s.strikeR = o.headHit;
        s.host.sfx.strike();
        s.host.shake(1.0, dur * 0.85); // 돌진하는 동안 땅이 울린다
        s.host.fx.particles.burst(new V3(origin.x, 0.3, origin.z), DUST, 20, 7, 0.5, 0.18, 0.4);
        s.moveTo(to.x, to.z, dur, 1.35, () => {
          s.strikeR = 0;
          s.host.shake(1.8, 0.12);
          s.host.fx.particles.burst(new V3(s.headPos.x, 0.3, s.headPos.z), DUST, 18, 6, 0.5, 0.16, 0.4);
        });
      },
    });
    // 이동 시간은 타깃까지 거리에 따라 달라지므로 다음 단계는 넉넉히 잡는다 (최대 reach/speed)
    t = tStrike + o.reach / o.speed + (last ? 0.05 : o.gap);
    if (!last) {
      steps.push({
        at: t - 0.05,
        fn: () => {
          s.faceMode = 'track';
        },
      });
    }
  }
  // 후딜: 달려든 방향 그대로 나선을 그리며 감겨 똬리를 튼다 → 한가운데서 머리를 쳐든다
  const COIL = 2.5;
  steps.push({
    at: t,
    fn: () => {
      s.faceMode = 'hold';
      s.look = 'heading';
      const r = s.rig;
      r.lift = 2.2;
      r.liftRate = 4;
      r.jaw = 0.25;
      r.hood = 0.2;
      r.undulate = 0.15;
      s.host.sfx.hiss(0.6, 0.5);
      s.followPath(s.spiralPath(9.5, 4, 1.2), 21, () => {
        s.look = 'player';
        s.faceMode = 'track';
        rear(s, 8.6, 1, 0.45, 5);
        s.rig.tongueRate = 6;
        s.rig.undulate = 0.1;
        s.host.sfx.hiss(1.1, 0.8);
        s.setExposed(true);
      });
    },
  });
  steps.push({
    at: t + COIL + o.recover[ph] - 0.5,
    fn: () => {
      relax(s);
      s.rig.lift = 2.4;
      s.rig.liftRate = 3.5;
    },
  });
  return { steps, end: t + COIL + o.recover[ph] };
}

/* ───────────────────────── 독 뱉기 ─────────────────────────
 * 예비동작: 몸을 곧추세워 플레이어를 내려다보며 입을 벌림
 * 공격: 독액 덩어리를 포물선으로 여러 개 뱉는다. 착지 지점에 붉은 고리가 줄어들며 표시된다.
 *       1번은 플레이어가 선 자리, 2번은 가던 방향의 앞쪽, 나머지는 주변 — 가만히 있거나 직진만 하면 걸린다.
 * 결과: 독 웅덩이가 남는다 (위에 서 있으면 계속 아픔, 대시로 통과 가능)
 */
function spit(s: Serpent): AttackScript {
  const o = S.spit;
  const ph = s.phaseIndex;
  const wind = o.windup[ph];
  const n = o.count[ph];
  const steps: Step[] = [];
  const from = new V3();
  steps.push({
    at: 0,
    fn: () => {
      s.faceMode = 'track';
      s.faceRate = 4;
      s.look = 'player';
      rear(s, 6.8, 0.6, 0.3, 7);
      s.host.sfx.hiss(0.9, 0.8);
      s.host.sfx.telegraph();
    },
  });
  steps.push({
    at: wind * 0.55,
    fn: () => {
      s.faceMode = 'hold';
      s.rig.jaw = 1;
      s.rig.hood = 0.8;
    },
  });
  for (let i = 0; i < n; i++) {
    steps.push({
      at: wind + i * o.gap,
      fn: () => {
        s.rig.mouth(from);
        const pl = s.player;
        const to = new V3(pl.pos.x, 0, pl.pos.z);
        if (i === 1) {
          to.x += pl.vel.x * o.flight;
          to.z += pl.vel.z * o.flight;
          const dx = to.x - pl.pos.x;
          const dz = to.z - pl.pos.z;
          const dl = Math.hypot(dx, dz);
          const minD = o.radius * 1.5;
          if (dl < minD) {
            const a = dl > 0.01 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2;
            to.x = pl.pos.x + Math.cos(a) * minD;
            to.z = pl.pos.z + Math.sin(a) * minD;
          }
        } else if (i >= 2) {
          const a = Math.random() * Math.PI * 2;
          const d = 3.8 + Math.random() * 3.2;
          to.x += Math.cos(a) * d;
          to.z += Math.sin(a) * d;
        }
        arenaClamp(to, 1.5);
        s.pools.launch(from, to, o.flight, o.peak, o.radius, o.life[ph]);
        s.host.sfx.spit();
        s.host.shake(0.15);
        s.host.fx.particles.burst(new V3(from.x, from.y, from.z), 0xff3a62, 8, 6, 0.35, 0.1, 0.2);
        s.rig.jaw = 0.7;
      },
    });
  }
  const tAfter = wind + (n - 1) * o.gap + 0.35;
  steps.push({
    at: tAfter,
    fn: () => {
      s.rig.jaw = 0.15;
      s.rig.lift = 3.0;
      s.rig.liftRate = 4;
      s.rig.hood = 0.5;
      s.setExposed(true);
    },
  });
  steps.push({
    at: tAfter + o.recover - 0.4,
    fn: () => relax(s),
  });
  return { steps, end: tAfter + o.recover };
}

/* ───────────────────────── 내려찍기 ─────────────────────────
 * 예비동작: 천장 가까이 솟구쳐 플레이어를 내려다봄 → 조준 고정, 바닥에 원형 예고
 * 공격: 원 한가운데로 머리를 내리꽂는다 (원 안이면 피격) → 충격파 고리가 바깥으로 퍼진다
 *       충격파는 걷기로는 따라잡히므로 대시 무적으로 통과하거나 고리 바깥으로 벗어나야 한다.
 * 후딜: 머리가 땅에 박혀 약점 노출
 */
function slam(s: Serpent): AttackScript {
  const o = S.slam;
  const ph = s.phaseIndex;
  const n = o.count[ph];
  const steps: Step[] = [];
  let t = 0;
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    const wind = o.windup[ph];
    const tell = o.tell[ph];
    const tLock = t + wind;
    const tImpact = tLock + tell;
    const target = new V3();
    steps.push({
      at: t,
      fn: () => {
        s.faceMode = 'track';
        s.faceRate = 5;
        s.look = 'player';
        rear(s, 10, 1, 0.4, 9);
        s.host.sfx.hiss(0.8, 0.9);
        s.host.sfx.telegraph();
      },
    });
    steps.push({
      at: tLock,
      fn: () => {
        target.set(s.player.pos.x, 0, s.player.pos.z);
        arenaClamp(target, 1.2);
        s.faceMode = 'hold';
        s.host.fx.telegraphs.circle(target.x, target.z, o.radius, tell, () => {});
      },
    });
    steps.push({
      at: tImpact - o.swoop,
      fn: () => {
        s.rig.lift = 0;
        s.rig.liftRate = 30;
        s.rig.jaw = 1;
        s.rig.tongueRate = 0.3;
        s.look = 'heading';
        s.faceMode = 'hold';
        s.host.sfx.strike();
        const hp = s.headPos;
        const dist = Math.hypot(target.x - hp.x, target.z - hp.z);
        s.moveTo(target.x, target.z, Math.max(o.swoop, dist / 75), 0.55);
      },
    });
    steps.push({
      at: tImpact,
      fn: () => impact(s, target, o.radius, last),
    });
    t = tImpact + (last ? 0 : o.gap);
  }
  steps.push({
    at: t + 0.05,
    fn: () => {
      s.rig.jaw = 0.15;
      s.rig.hood = 0.3;
      s.rig.lift = 1.1;
      s.setExposed(true);
    },
  });
  steps.push({
    at: t + o.recover[ph] - 0.6,
    fn: () => {
      relax(s);
      s.rig.lift = 2.4;
    },
  });
  return { steps, end: t + o.recover[ph] };
}

function impact(s: Serpent, at: THREE.Vector3, radius: number, last: boolean) {
  const { host, player } = s;
  const o = S.slam;
  host.fx.ring(at.x, at.z, radius * 1.1, 0.45, 0x7a4ee0);
  host.fx.ring(at.x, at.z, radius * 0.55, 0.3, 0xb59af0, 0.09);
  s.spikes.erupt(at.x, at.z, radius * 0.9);
  host.fx.burstLight(new V3(at.x, 1.5, at.z), 0xffa060, 90, 0.4);
  host.shake(last ? 1.2 : 0.9);
  host.hitStop(0.06);
  host.sfx.land();
  if (!player.dead && Math.hypot(player.pos.x - at.x, player.pos.z - at.z) < radius + player.hitRadius) player.takeDamage(at.x, at.z);
  s.waves.spawn(at.x, at.z, radius, o.waveSpeed, o.waveMax, o.waveWidth, o.waveDelay);
}

/* ───────────────────────── 독 뿜기 ─────────────────────────
 * 예비동작: 몸을 세우고 플레이어 쪽을 향해 입을 벌림 + 부채꼴 예고
 * 공격: 머리를 좌우로 휘저으며 독 방울을 연달아 뿜는다 (조준이 부채꼴 한쪽 끝에서 반대쪽 끝으로 훑는다)
 * 후딜: 머리를 늘어뜨림 = 약점 노출
 */
function breath(s: Serpent): AttackScript {
  const o = S.breath;
  const ph = s.phaseIndex;
  const wind = o.windup[ph];
  const steps: Step[] = [];
  const origin = new V3();
  let base = 0;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const M = Math.round(o.dur[ph] / o.interval);

  steps.push({
    at: 0,
    fn: () => {
      s.faceMode = 'track';
      s.faceRate = 5;
      s.look = 'player';
      rear(s, 3.3, 0.9, 0.5, 7);
      s.host.sfx.hiss(0.9, 0.9);
      s.host.sfx.telegraph();
    },
  });
  steps.push({
    at: wind * 0.45,
    fn: () => {
      s.faceMode = 'hold';
      s.rig.jaw = 1;
      s.rig.mouth(origin);
      base = Math.atan2(s.player.pos.z - origin.z, s.player.pos.x - origin.x);
      s.host.fx.telegraphs.fan(origin.x, origin.z, base, o.half + 0.06, o.range, wind * 0.55, () => {});
    },
  });
  for (let j = 0; j < M; j++) {
    steps.push({
      at: wind + j * o.interval,
      fn: () => {
        const a = base + dir * (-o.half + (2 * o.half * j) / (M - 1));
        // 머리가 조준을 따라 돌아간다
        s.faceMode = 'to';
        s.faceYaw = yawOf(Math.cos(a), Math.sin(a));
        s.faceRate = 14;
        s.look = 'heading';
        s.rig.mouth(origin);
        s.projectiles.spawn(origin.x, origin.z, Math.cos(a), Math.sin(a), o.speed[ph], o.radius, Math.max(0.9, origin.y), { kind: 'venom', mark: 0.4 });
        if (j % 3 === 0) {
          s.host.sfx.spit();
          s.host.shake(0.12);
          s.host.fx.particles.burst(new V3(origin.x, origin.y, origin.z), 0x4a16b4, 6, 5, 0.35, 0.1, 0.3);
        }
      },
    });
  }
  const tAfter = wind + M * o.interval + 0.2;
  steps.push({
    at: tAfter,
    fn: () => {
      s.faceMode = 'hold';
      s.rig.jaw = 0.1;
      s.rig.lift = 1.6;
      s.rig.liftRate = 3.5;
      s.rig.hood = 0.4;
      s.setExposed(true);
    },
  });
  steps.push({
    at: tAfter + o.recover[ph] - 0.4,
    fn: () => relax(s),
  });
  return { steps, end: tAfter + o.recover[ph] };
}

/* ───────────────────────── 잠행 & 솟구침 ─────────────────────────
 * 예비동작: 머리부터 땅속으로 파고든다 (몸이 차례로 가라앉음). 이 동안은 맞힐 수 없다.
 * 공격: 플레이어 발밑(과 앞쪽)에 원형 예고가 연달아 뜨고, 터지듯 뼈 가시가 솟는다.
 * 마무리: 마지막 원에서 머리가 솟구친다 (원 안이면 피격). 몸이 새 자리에 큼직하게 감겨 머리부터 차례로 솟아오른다.
 *         머리는 한동안 높이 떠 있다 = 약점 노출
 */
function dive(s: Serpent): AttackScript {
  const o = S.dive;
  const ph = s.phaseIndex;
  const n = o.count[ph];
  const tell = o.tell[ph];
  const gap = o.gap[ph];
  const steps: Step[] = [];
  const t0 = o.sink;
  const prev = new V3(1e5, 0, 1e5);

  steps.push({
    at: 0,
    fn: () => {
      s.faceMode = 'hold';
      s.look = 'heading';
      s.rig.undulate = 0.4;
      s.rig.lift = 0.4;
      s.rig.jaw = 0.6;
      s.rig.hood = 0;
      s.rig.dive();
      s.host.sfx.strike();
      s.host.sfx.hiss(0.7, 0.8);
      s.host.shake(0.5);
      s.host.fx.particles.burst(new V3(s.headPos.x, 0.3, s.headPos.z), DUST, 26, 7, 0.6, 0.18, 0.5);
      s.host.fx.ring(s.headPos.x, s.headPos.z, 5, 0.5, DUST);
      // 머리가 땅을 파고들며 앞으로 미끄러져 들어간다
      const a = s.headingMath;
      s.moveTo(s.headPos.x + Math.cos(a) * 7, s.headPos.z + Math.sin(a) * 7, 0.55, 0.6);
    },
  });

  // 가시 + 마지막 머리
  for (let e = 0; e <= n; e++) {
    const isHead = e === n;
    const radius = isHead ? o.finalRadius : o.radius;
    const tTell = t0 + e * gap;
    const tBurst = tTell + tell;
    const target = new V3();
    steps.push({
      at: tTell,
      fn: () => {
        const pl = s.player;
        target.set(pl.pos.x, 0, pl.pos.z);
        if (e > 0) {
          // 가던 방향의 앞쪽을 노린다 (직진만 하면 걸림)
          target.x += pl.vel.x * tell * 0.55;
          target.z += pl.vel.z * tell * 0.55;
        }
        // 직전 원과 겹치지 않게 살짝 밀어낸다 (겹치면 한 번에 둘 다 안 피해지는 구간이 생김)
        const dx = target.x - prev.x;
        const dz = target.z - prev.z;
        const dl = Math.hypot(dx, dz);
        const minD = radius + o.radius + 0.4;
        if (dl < minD) {
          const a = dl > 0.01 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2;
          target.x = prev.x + Math.cos(a) * minD;
          target.z = prev.z + Math.sin(a) * minD;
        }
        arenaClamp(target, 2.4 + (isHead ? 2 : 0));
        prev.copy(target);
        s.host.fx.telegraphs.circle(target.x, target.z, radius, tell, () => {});
        s.host.sfx.telegraph();
        s.host.fx.particles.burst(new V3(target.x, 0.2, target.z), DUST, 6, 3, 0.5, 0.12, 0.3);
      },
    });
    steps.push({
      at: tBurst,
      fn: () => {
        const { host, player } = s;
        const hit = !player.dead && Math.hypot(player.pos.x - target.x, player.pos.z - target.z) < radius + player.hitRadius;
        if (!isHead) {
          s.spikes.erupt(target.x, target.z, radius);
          if (hit) player.takeDamage(target.x, target.z);
          return;
        }
        // 머리가 솟는다
        s.erupt(target.x, target.z);
        s.look = 'player';
        s.faceMode = 'track';
        rear(s, 9.6, 1, 1, 24);
        s.rig.tongueRate = 6;
        s.host.sfx.hiss(1.2, 1);
        s.spikes.erupt(target.x, target.z, radius * 0.9);
        host.fx.ring(target.x, target.z, radius * 1.3, 0.5, 0xffb36b);
        host.shake(1.2);
        host.hitStop(0.06);
        host.sfx.land();
        host.fx.burstLight(new V3(target.x, 2, target.z), 0xffa060, 100, 0.45);
        if (hit) player.takeDamage(target.x, target.z);
      },
    });
  }
  const tUp = t0 + n * gap + tell;
  steps.push({
    at: tUp + 0.7,
    fn: () => {
      s.setExposed(true);
      s.rig.lift = 8.2;
      s.rig.liftRate = 2.5;
      s.rig.jaw = 0.4;
    },
  });
  steps.push({
    at: tUp + o.recover[ph] - 0.6,
    fn: () => {
      relax(s);
      s.rig.lift = 2.4;
      s.rig.liftRate = 3.5;
    },
  });
  return { steps, end: tUp + o.recover[ph] };
}

/* ───────────────────────── 외곽 선회 (2페이즈~) ─────────────────────────
 * 아레나 바깥(석단 둘레의 물 위)으로 나가 몸을 석단에 빙 두르듯 돌면서 공격한다.
 *  - rimshot: 한 바퀴 넘게 돌며 안쪽의 플레이어를 겨눠 독탄을 쏜다. 끝나면 안쪽으로 들어와 똬리 + 약점 노출.
 *  - rimcharge: 반 바퀴쯤 돌다가 플레이어를 겨눈 일직선으로 맵을 가로질러 반대편 바깥까지 내달린다(예고선 표시). 마지막엔 안쪽에서 똬리 + 약점 노출.
 * 머리가 바깥에 있는 동안엔 화살이 닿지 않는다 (탄은 아레나 안쪽으로만 날아온다).
 */
const TAU_ = Math.PI * 2;
const rimR = () => WORLD.radius + S.rim.out;

/** 머리 위치에서 가장 가까운 외곽 지점으로 나간다. 도착 각도를 돌려준다 */
function rimEnter(s: Serpent, dir: number): number {
  const p = s.headPos;
  const near = Math.hypot(p.x, p.z) > 6;
  const a = near ? Math.atan2(p.z, p.x) : Math.atan2(-s.player.pos.z, -s.player.pos.x);
  const a1 = a + dir * 0.2;
  const R = rimR();
  s.rimOn = true;
  s.faceMode = 'hold';
  s.look = 'heading';
  s.rig.lift = 1.4;
  s.rig.liftRate = 6;
  s.rig.hood = 1;
  s.rig.jaw = 0.1;
  s.rig.tongueRate = 5;
  s.rig.undulate = 0.25;
  s.host.sfx.hiss(1.2, 1);
  s.host.shake(0.4);
  s.moveAlong([p.x, p.z, Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97, Math.cos(a1) * R, Math.sin(a1) * R], S.rim.enter, 1);
  return a1;
}

/**
 * 맵 안에서 밖으로 나온 직후: 몸이 전부 맵 밖으로 나올 때까지 시간표를 멈추고 외곽을 빠르게 돈다.
 * (몸이 안에 남은 채 쏘면 투사체가 몸에 가려 보이지 않는다)
 */
function wrapOut(s: Serpent, dir: number) {
  const idle = () => {
    const p = s.headPos;
    const R = rimR();
    const a = Math.atan2(p.z, p.x);
    const span = 0.14 * TAU_;
    const pts = [p.x, p.z];
    for (let i = 1; i <= 5; i++) pts.push(Math.cos(a + (dir * span * i) / 5) * R, Math.sin(a + (dir * span * i) / 5) * R);
    s.look = 'heading';
    s.moveAlong(pts, (span * R) / S.rim.wrap, 1);
  };
  s.holdWrap(idle);
}

/** 외곽을 따라 도는 경로. a0 에서 dir 방향으로 laps 바퀴 */
function rimArc(a0: number, dir: number, laps: number): number[] {
  const R = rimR();
  const n = Math.max(6, Math.ceil(laps * 40));
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + dir * laps * TAU_ * (i / n);
    pts.push(Math.cos(a) * R, Math.sin(a) * R);
  }
  return pts;
}

/** 머리에서 (dx,dz) 방향 반직선이 반경 rho 의 원과 만나는 먼 쪽 거리 */
function rayToCircle(ox: number, oz: number, dx: number, dz: number, rho: number) {
  const b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - rho * rho;
  const disc = Math.max(0, b * b - c);
  return Math.max(4, -b + Math.sqrt(disc));
}

/** 똬리를 틀고 머리를 쳐든다 (약점 노출). 머리가 바깥에 있으면 먼저 안쪽으로 들어온다 */
function coilExposed(s: Serpent) {
  s.rimOn = false;
  s.faceMode = 'hold';
  s.look = 'heading';
  const r = s.rig;
  r.lift = 2.2;
  r.liftRate = 4;
  r.jaw = 0.25;
  r.hood = 0.2;
  r.undulate = 0.15;
  s.host.sfx.hiss(0.6, 0.5);
  s.followPath(s.spiralPath(9.5, 4, 1.2), 21, () => {
    s.look = 'player';
    s.faceMode = 'track';
    rear(s, 8.6, 1, 0.45, 5);
    s.rig.tongueRate = 6;
    s.rig.undulate = 0.1;
    s.host.sfx.hiss(1.1, 0.8);
    s.setExposed(true);
  });
}

function rimFinish(s: Serpent, t: number, recover: number, comeIn: boolean, dir: number): { steps: Step[]; end: number } {
  const COIL = 2.5;
  const back = comeIn ? S.rim.back : 0;
  const steps: Step[] = [];
  steps.push({
    at: t,
    fn: () => {
      if (!comeIn) {
        coilExposed(s);
        return;
      }
      const p = s.headPos;
      const a = Math.atan2(p.z, p.x) - dir * 0.15;
      const rin = (WORLD.radius - 3.6) * 0.82;
      s.faceMode = 'hold';
      s.look = 'heading';
      s.rig.lift = 1.6;
      s.rig.hood = 0.5;
      s.rig.jaw = 0.1;
      s.moveTo(Math.cos(a) * rin, Math.sin(a) * rin, S.rim.back, 1.2, () => coilExposed(s));
    },
  });
  steps.push({
    at: t + back + COIL + recover - 0.5,
    fn: () => {
      s.rimOn = false;
      relax(s);
      s.rig.lift = 2.4;
      s.rig.liftRate = 3.5;
    },
  });
  return { steps, end: t + back + COIL + recover };
}

function rimshot(s: Serpent): AttackScript {
  const o = S.rimshot;
  const ph = Math.min(2, s.phaseIndex);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const steps: Step[] = [];
  const dur = (o.laps[ph] * TAU_ * rimR()) / o.speed[ph];
  const T0 = S.rim.enter + 0.1;
  steps.push({
    at: 0,
    fn: () => {
      rimEnter(s, dir);
    },
  });
  // 몸이 전부 맵 밖으로 나올 때까지 감고 난 뒤에 쏘기 시작한다
  steps.push({ at: T0, fn: () => wrapOut(s, dir) });
  steps.push({
    at: T0 + 0.01,
    fn: () => {
      s.look = 'player';
      s.moveAlong(rimArc(Math.atan2(s.headPos.z, s.headPos.x), dir, o.laps[ph]), dur, 1);
      s.host.sfx.hiss(1, 1);
    },
  });
  const fan = ph >= 2 ? [-o.fan, 0, o.fan] : [0];
  const origin = new V3();
  for (let k = 0; T0 + 0.5 + k * o.interval[ph] < T0 + dur - 0.3; k++) {
    const at = T0 + 0.5 + k * o.interval[ph];
    steps.push({
      at,
      fn: () => {
        const pl = s.player.pos;
        s.rig.mouth(origin);
        s.rig.jaw = 0.85;
        const base = Math.atan2(pl.z - origin.z, pl.x - origin.x);
        for (const f of fan) s.projectiles.spawn(origin.x, origin.z, Math.cos(base + f), Math.sin(base + f), o.shot[ph], o.radius, Math.max(0.9, origin.y), { kind: 'venom', mark: 1 });
        s.host.sfx.spit();
        s.host.fx.particles.burst(new V3(origin.x, origin.y, origin.z), 0x4a16b4, 6, 5, 0.35, 0.1, 0.3);
      },
    });
    steps.push({
      at: at + 0.22,
      fn: () => {
        s.rig.jaw = 0.12;
      },
    });
  }
  const tEnd = T0 + dur + 0.1;
  if (ph === 0) {
    // 1페이즈: 바깥에 머문 채 머리를 쳐들고 약점을 드러낸다 (화살이 바깥까지 닿는다)
    steps.push({
      at: tEnd,
      fn: () => {
        s.faceMode = 'track';
        s.look = 'player';
        rear(s, 3.2, 0.9, 0.2, 4);
        s.setExposed(true);
      },
    });
    steps.push({
      at: tEnd + o.recover[0] - 0.4,
      fn: () => {
        relax(s);
        s.rig.lift = 2.4;
      },
    });
    return { steps, end: tEnd + o.recover[0] };
  }
  const fin = rimFinish(s, tEnd, o.recover[ph], true, dir);
  return { steps: steps.concat(fin.steps), end: fin.end };
}

function rimcharge(s: Serpent): AttackScript {
  const o = S.rimcharge;
  const ph = Math.min(2, s.phaseIndex);
  const n = o.count[ph];
  const dir = Math.random() < 0.5 ? 1 : -1;
  const steps: Step[] = [];
  const T0 = S.rim.enter + 0.1;
  const dur = (o.laps[ph] * TAU_ * rimR()) / o.speed[ph];
  steps.push({
    at: 0,
    fn: () => {
      rimEnter(s, dir);
    },
  });
  steps.push({ at: T0, fn: () => wrapOut(s, dir) });
  steps.push({
    at: T0 + 0.01,
    fn: () => {
      s.look = 'player';
      s.moveAlong(rimArc(Math.atan2(s.headPos.z, s.headPos.x), dir, o.laps[ph] * 0.5), dur * 0.5, 1);
      s.host.sfx.hiss(0.9, 1);
    },
  });
  const slot = o.windup[ph] + o.tell[ph] + (2 * rimR()) / o.charge + o.gap;
  let t = T0 + dur * 0.5 + 0.1;
  for (let k = 0; k < n; k++) {
    const last = k === n - 1;
    const origin = new V3();
    const to = new V3();
    let len = 0;
    steps.push({
      at: t,
      fn: () => {
        s.faceMode = 'track';
        s.faceRate = 7;
        s.look = 'player';
        rear(s, 1.8, 1, 0.3, 9);
        s.host.sfx.hiss(0.9, 0.9);
      },
    });
    steps.push({
      at: t + o.windup[ph],
      fn: () => {
        origin.set(s.headPos.x, 0, s.headPos.z);
        const pl = s.player.pos;
        let dx = pl.x - origin.x;
        let dz = pl.z - origin.z;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl;
        dz /= dl;
        len = rayToCircle(origin.x, origin.z, dx, dz, last ? s.headLimit - 0.3 : rimR());
        to.set(origin.x + dx * len, 0, origin.z + dz * len);
        s.faceMode = 'to';
        s.faceYaw = yawOf(dx, dz);
        s.faceRate = 16;
        s.look = 'heading';
        rear(s, 1.7, 1, 0, 7);
        s.rig.tongueRate = 0.3;
        s.host.fx.telegraphs.line(origin.x, origin.z, Math.atan2(dz, dx), len + 1.2, o.width, o.tell[ph], () => {});
        s.host.sfx.telegraph();
      },
    });
    steps.push({
      at: t + o.windup[ph] + o.tell[ph],
      fn: () => {
        s.faceMode = 'hold';
        s.rig.lift = 1.15;
        s.rig.liftRate = 20;
        s.rig.undulate = 0.1;
        s.rig.hood = 0.35;
        s.rig.jaw = 0;
        s.strikeR = o.headHit;
        s.host.sfx.strike();
        s.host.shake(1.0, (len / o.charge) * 0.85);
        s.moveTo(to.x, to.z, len / o.charge, 1.35, () => {
          s.strikeR = 0;
          s.host.shake(1.8, 0.12);
        });
      },
    });
    t += slot;
  }
  // 마지막 돌진은 안쪽에서 멈추므로 되돌아오는 이동 없이 곧장 똬리
  const fin = rimFinish(s, t, o.recover[ph], false, dir);
  return { steps: steps.concat(fin.steps), end: fin.end };
}

/* ───────────────────────── 페이즈 전환 포효 ─────────────────────────
 * 몸을 높이 세워 후드를 펴고 포효 → 눈이 붉게 → 충격파(밀어내기, 데미지 없음). 포효 동안 무적.
 */
function roar(s: Serpent): AttackScript {
  const T = S.roar;
  return {
    steps: [
      {
        at: 0,
        fn: () => {
          s.beginNextPhase();
          s.faceMode = 'track';
          s.faceRate = 3;
          s.look = 'player';
          rear(s, 10.5, 1, 1, 6);
          s.rig.tongueRate = 7;
          s.host.sfx.roar();
          s.host.sfx.hiss(2.0, 1);
          s.host.flash(s.phaseIndex >= 2 ? '#4a0008' : '#ff3a1a', 0.55, 1.1);
          s.host.slowmo(0.4, 1.0);
          s.host.shake(0.8);
        },
      },
      {
        at: 0.35,
        fn: () => {
          if (s.phaseIndex >= 2) s.host.banner('광란', '이무기가 이성을 잃었다 — 공격이 더욱 거세진다', 2.2);
          else s.host.banner('분노', '심연의 이무기가 격노했다', 2.0);
        },
      },
      {
        at: 0.65,
        fn: () => {
          const { host, player } = s;
          const p = s.headPos;
          host.fx.ring(p.x, p.z, 20, 0.9, 0xff5a4a);
          host.fx.ring(p.x, p.z, 11, 0.6, 0xffb09a, 0.09);
          host.fx.burstLight(new V3(p.x, 3, p.z), 0xff3a2a, 150, 0.9);
          host.shake(2.4);
          host.flash(s.phaseIndex >= 2 ? '#2a0004' : '#ff5a3a', 0.45, 0.8);
          const d = Math.hypot(player.pos.x - p.x, player.pos.z - p.z);
          if (d < 18) player.push(p.x, p.z, 16 * (1 - d / 18) + 4);
          host.fx.particles.burst(new V3(p.x, 1, p.z), 0xff6a4a, 90, 16, 1.1, 0.24, 0.5);
          host.fx.particles.burst(new V3(p.x, 3, p.z), s.phaseIndex >= 2 ? 0x8a0a14 : 0xff3a1a, 60, 8, 1.4, 0.3, 1.5, -2);
        },
      },
      // 포효가 이어지는 동안 충격파 고리가 연달아 퍼지고 화면이 계속 떨린다
      ...[0.95, 1.3, 1.65].map((at, i) => ({
        at,
        fn: () => {
          const p = s.headPos;
          s.host.fx.ring(p.x, p.z, 26 + i * 8, 0.9, s.phaseIndex >= 2 ? 0x8a1020 : 0xff6a4a);
          s.host.shake(1.5 - i * 0.35);
          s.host.sfx.land();
        },
      })),
      {
        at: T - 0.8,
        fn: () => {
          relax(s);
          s.rig.lift = 2.4;
          s.rig.liftRate = 3.5;
        },
      },
    ],
    end: T,
  };
}
