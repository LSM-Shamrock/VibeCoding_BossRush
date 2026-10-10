import * as THREE from 'three';
import { CFG } from '../../config';
import { WORLD } from '../../world';
import type { AttackScript, Step } from '../../types';
import type { Dragon } from './dragon';

export type { AttackScript, Step };

const V3 = THREE.Vector3;
const D = CFG.dragon;
const TAU = Math.PI * 2;

export type AttackName = 'spit' | 'strafe' | 'swoop' | 'meteor' | 'crash' | 'sunray' | 'gale' | 'wind' | 'orbit' | 'land' | 'scythe' | 'roar';
export const SEQUENCE_ATTACKS: AttackName[] = ['spit', 'strafe', 'swoop', 'meteor', 'crash', 'sunray', 'gale', 'wind', 'orbit', 'land', 'scythe'];

export function buildAttack(name: AttackName, s: Dragon): AttackScript {
  const sc = build(name, s);
  sc.steps.sort((a, b) => a.at - b.at); // 단계는 시간순이어야 한다
  return sc;
}

function build(name: AttackName, s: Dragon): AttackScript {
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
    case 'wind':
      return wind(s);
    case 'orbit':
      return orbit(s);
    case 'land':
      return land(s);
    case 'scythe':
      return scythe(s);
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
        s.rig.armPose = 'flex'; s.rig.legPose = 'trail';
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
        // 부채꼴: 둘째 불덩이부터는 양옆으로도 한 쌍이 더 날아간다 (페이즈가 오를수록 자주)
        if (i > 0 && i % (ph >= 2 ? 1 : 2) === 0) {
          const px = -(tgt.z - M.z);
          const pz = tgt.x - M.x;
          const pl = Math.hypot(px, pz) || 1;
          for (const sd of [-1, 1]) {
            const f = inArena(new V3(tgt.x + (px / pl) * sd * 5.2, 0, tgt.z + (pz / pl) * sd * 5.2), 1.0);
            s.field.lob(M, f, C.flight + 0.12, C.peak + 2, C.radius * 0.9, C.zone[ph] > 0 ? C.zone[ph] * 0.7 : 0);
          }
        }
        s.host.sfx.spit();
        s.host.shake(0.22, 0.05);
        s.host.fx.particles.burst(M, 0xffb040, 14, 7, 0.4, 0.2, 0.3, 2, 2);
        s.host.fx.burstLight(M, 0xff8030, 90, 0.2);
        s.rig.jaw = 1;
        s.rig.armPose = 'rake';
      },
    });
    steps.push({ at: W + i * C.gap + 0.14, fn: () => { s.rig.jaw = 0.55; s.rig.armPose = 'flex'; } });
  }
  const last = W + (n - 1) * C.gap;
  steps.push({
    at: last + 0.4,
    fn: () => {
      s.rig.fire = 0;
      s.rig.jaw = 0.1;
      s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
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
        s.rig.armPose = 'reach'; s.rig.legPose = 'trail';
        s.fly([new V3(A.x - ux * 8, 46, A.z - uz * 8), new V3(A.x + ux * 10, 34, A.z + uz * 10)], tell * 0.98, 'io'); // 높은 하늘에서 대기
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
        s.rig.armPose = 'reach'; s.rig.legPose = 'trail';
        s.startJet(C.burnLife);
        // 페이즈 2~: 숨결이 지나가는 길 양옆으로 유성이 곁들여 떨어진다 (선 밖으로 빠져도 방심할 수 없다)
        if (ph >= 1) {
          const nM = ph >= 2 ? 6 : 4;
          for (let m = 0; m < nM; m++) {
            const along = 34 + (m / nM) * (LEN - 40) + Math.random() * 6;
            const side = (m % 2 ? 1 : -1) * (C.width * 0.5 + 3.5 + Math.random() * 3);
            const mx = A.x + ux * along - uz * side;
            const mz = A.z + uz * along + ux * side;
            const q = inArena(new V3(mx, 0, mz), 1.5);
            const dl = 0.15 + (m / nM) * (runDur * 0.8);
            s.after(dl, () => s.field.meteor(q.x, q.z, 2.6, 1.05, ux, uz, 0));
          }
        }
        s.host.sfx.flame(runDur, 1);
        s.host.shake(0.5, 0.3);
        s.fly(
          [new V3(A.x + ux * 26, 15, A.z + uz * 26), new V3(A.x + ux * 50, 13, A.z + uz * 50), new V3(B.x - ux * 4, 14, B.z - uz * 4), new V3(B.x + ux * 22, 48, B.z + uz * 22)],
          runDur,
          'lin',
          () => {
            s.stopJet();
            s.rig.armPose = 'tuck';
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
 * 굵은 붉은 띠 → 용이 날개를 접고 플레이어가 겨우 닿을 높이(머리 중심 약 5.4)로 날아온다. 머리와 길게 끌리는 몸통이 띠를 쓸고 지나간다.
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
        s.rig.armPose = 'reach'; s.rig.legPose = 'trail';
        s.fly([new V3(A.x - ux * 10, 48, A.z - uz * 10), new V3(A.x + ux * 4, 40, A.z + uz * 4)], tell * 0.98, 'io'); // 높은 하늘에서 겨눈다
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
        s.rig.armPose = 'reach'; s.rig.legPose = 'dive'; s.rig.legGait = true; s.rig.gaitHz = 2.1;
        s.setWings({ fold: 0.95, hz: 0.1, amp: 0.1 });
        s.host.sfx.leap();
        s.host.shake(0.6, 0.4);
        // 낮게 스친 길에는 불길이 남는다 (머리가 지나간 뒤 한동안 불탄다)
        for (let d = 38; d < LEN - 22; d += 7) {
          const dl = ((d + 4) / (LEN + 30)) * runDur + 0.08;
          const bx = A.x + ux * d;
          const bz = A.z + uz * d;
          s.after(dl, () => {
            s.field.burn(bx, bz, 2.6, 2.4 + ph * 0.5);
            s.host.fx.particles.burst(new V3(bx, 0.8, bz), 0xff7a28, 12, 9, 0.7, 0.3, 0.8, 5, 2);
          });
        }
        s.fly(
          [new V3(A.x + ux * 18, 24, A.z + uz * 18), new V3(A.x + ux * 38, 5.4, A.z + uz * 38), new V3(B.x - ux * 22, 5.4, B.z - uz * 22), new V3(B.x + ux * 2, 16, B.z + uz * 2), new V3(B.x + ux * 30, 50, B.z + uz * 30)],
          runDur,
          'lin',
          () => {
            s.strikeOn = false;
            s.rig.legGait = false;
            s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
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
        s.rig.armPose = 'roar'; s.rig.legPose = 'roar';
        s.cruiseOverride = { alt: 50, radius: 9 };
        s.fly([new V3(s.p.x * 0.4, 44, s.p.z * 0.4), new V3(0, 52, 0)], 2.0, 'io');
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
  // 후반: 제단을 가로지르는 유성 줄 (한 줄로 쓸고 지나간다)
  {
    const la = Math.random() * Math.PI;
    const lx = Math.cos(la);
    const lz = Math.sin(la);
    const nL = ph >= 2 ? 9 : 6;
    const dir2 = Math.random() < 0.5 ? 1 : -1;
    for (let k = 0; k < nL; k++) {
      steps.push({
        at: t1 + n * gap * 0.55 + k * 0.17,
        fn: () => {
          const d = ((k / (nL - 1)) * 2 - 1) * (WORLD.radius - 3) * dir2;
          s.field.meteor(lx * d, lz * d, C.radius * 0.95, C.tell, dirX, dirZ, 0);
          if (k % 3 === 0) s.host.sfx.telegraph();
        },
      });
    }
  }
  const tEnd = t1 + (n - 1) * gap + C.tell + 1.0;
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
      const hi = new V3(pl.x - dir.x * 26, 52, pl.z - dir.z * 26);
      s.look('player');
      s.rig.jaw = 0.8;
      s.setWings({ hz: 1.3, amp: 0.85, raise: 0.3 });
      s.rig.armPose = 'flex'; s.rig.legPose = 'trail';
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
      s.rig.armPose = 'reach'; s.rig.legPose = 'dive';
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
    field.wave(T.x, T.z, C.wave + 4, 13, 1.2, 0.38);
    if (ph >= 2) field.wave(T.x, T.z, C.wave + 8, 14, 1.0, 0.8);
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * TAU + Math.random() * 0.4;
      const q = inArena(new V3(T.x + Math.cos(a) * (R + 2.6), 0, T.z + Math.sin(a) * (R + 2.6)), 1.2);
      field.burn(q.x, q.z, 2.4, 3 + ph);
    }
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
    rig.armPose = 'brace'; rig.legPose = 'brace';
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
      rig.armPose = 'roar'; rig.legPose = 'roar';
      host.sfx.roar();
      host.sfx.wingbeat(1.5);
      host.shake(1.0, 0.3);
      s.field.wave(s.p.x, s.p.z, 14, 13, 1.3);
      host.fx.ring(s.p.x, s.p.z, 14, 0.6, 0xffa060);
      host.fx.particles.burst(new V3(s.p.x, 0.5, s.p.z), 0x7a5a42, 50, 11, 1.0, 0.5, 0.6, 6, 1.2);
      const pl = s.player;
      const d = Math.hypot(pl.pos.x - s.p.x, pl.pos.z - s.p.z);
      if (d < 14) pl.push(s.p.x, s.p.z, 8 * (1 - d / 14) + 2);
      const out = new V3(s.p.x + dir.x * 10, 34, s.p.z + dir.z * 10);
      s.fly([new V3(s.p.x + dir.x * 3, 12, s.p.z + dir.z * 3), out], 1.9, 'in');
    },
  });
  steps.push({ at: riseAt + 1.6, fn: () => { s.rig.jaw = 0.1; s.rig.armPose = 'tuck'; s.rig.legPose = 'trail'; } });
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
        station.set(Math.cos(a) * 28, 44, Math.sin(a) * 28);
        s.look('player');
        s.rig.jaw = 0.5;
        s.setWings({ hz: 0.8, amp: 0.5, raise: 0.5, spread: 1 });
        s.rig.armPose = 'gather'; s.rig.legPose = 'roar';
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
    ...[0, 1, 2, 3].map((k) => ({
      at: tFire + 0.7 + k * 1.0,
      fn: () => {
        const q = ahead(s, 0.6);
        const a = Math.random() * TAU;
        q.x += Math.cos(a) * 6.5;
        q.z += Math.sin(a) * 6.5;
        inArena(q, 1.2);
        s.field.meteor(q.x, q.z, 2.8, 1.15, Math.cos(a), Math.sin(a), 0);
        s.host.sfx.telegraph();
      },
    })),
    {
      at: tFire + C.dur + 0.15,
      fn: () => {
        s.rig.fire = 0;
        s.rig.jaw = 0.1;
        s.look('off');
        s.setWings({ hz: 0.9, amp: 0.6, raise: 0.15 });
        s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
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
  const hoverPt = new V3(0, 27, 0);
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('player');
        s.rig.jaw = 0.4;
        s.setWings({ hz: 1.2, amp: 0.7, raise: 0.5 });
        s.rig.armPose = 'flex'; s.rig.legPose = 'trail';
        s.fly([new V3(s.p.x * 0.3, 30, s.p.z * 0.3), hoverPt], 1.5, 'io', () => s.hoverAt(hoverPt, 3.5, null, 0.12));
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
        s.rig.armPose = 'roar'; s.rig.legPose = 'roar';
        s.host.sfx.telegraph();
        s.host.fx.telegraphs.circle(0, 0, C.radius, C.tell, () => slam(last));
      },
    });
    steps.push({ at: tb + 0.45, fn: () => { s.setWings({ hz: 0.9, amp: 0.4, raise: 0.4 }); s.rig.armPose = 'flex'; s.rig.legPose = 'trail'; } });
  }
  const slam = (finale: boolean) => {
    const { host, field } = s;
    s.setWings({ hz: 0, amp: 0, raise: -0.65, spread: 1 });
    s.rig.armPose = 'brace'; s.rig.legPose = 'brace';
    field.explode(0, 0, C.radius, true);
    field.wave(0, 0, WORLD.radius + 8, C.speed, C.width);
    field.wave(0, 0, WORLD.radius + 8, C.speed, C.width * 0.8, 0.42);
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
      s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
    },
  });
  return { steps, end: tEnd + 2.0 };
}

/* ───────────────────────── 폭풍 날갯짓 ─────────────────────────
 * 용이 아레나 밖 하늘에서 몸을 세우고(수직 자세) 거대한 날개를 크게 휘젓는다. 날개를 내리칠 때마다 회오리 바람이 아레나로 쏟아져 내려온다.
 * 회오리는 플레이어가 서 있던 쪽으로 굴러오며 가까이 가면 몸을 빨아들인다. 닿으면 피해. 옆으로 비키거나 대시(무적)로 피한다.
 */
function makeTornado(scene: THREE.Scene) {
  const g = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const layers: THREE.Mesh[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const geo = new THREE.CylinderGeometry(0.7 + (i + 1) * 0.5, 0.7 + i * 0.5, 1.0, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 ? 0xdfeaff : 0xa9bddc,
      transparent: true,
      opacity: 0.5 - 0.22 * k,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.5 + i * 0.95;
    m.frustumCulled = false;
    g.add(m);
    geos.push(geo);
    mats.push(mat);
    layers.push(m);
  }
  scene.add(g);
  return {
    g,
    layers,
    dispose() {
      scene.remove(g);
      for (const x of geos) x.dispose();
      for (const x of mats) x.dispose();
    },
  };
}

function wind(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.wind;
  const n = C.flaps[ph];
  const a0 = Math.random() * TAU;
  const hoverPt = new V3(Math.cos(a0) * C.dist, C.alt, Math.sin(a0) * C.dist);
  const face = Math.atan2(-Math.cos(a0), -Math.sin(a0));
  const per = 1 / C.hz; // 날갯짓 한 번의 길이
  const tStart = 2.8; // 날갯짓 시작
  interface Tor { t: ReturnType<typeof makeTornado>; x: number; z: number; y: number; y0: number; dx: number; dz: number; d: number; age: number; spin: number }
  const tors: Tor[] = [];
  let tt = 0;
  let prevF = -1;
  let flaps = 0;
  const P = new V3();
  const tipA = new V3();
  s.onEnd(() => {
    for (const q of tors) q.t.dispose();
    tors.length = 0;
    s.rig.wingSwing = false;
  });
  // 날개를 앞으로 휘두르는 순간, 날개 끝에서 회오리가 뿜어져 나와 땅으로 내려꽂힌다
  const launch = () => {
    const tgt = ahead(s, 0.8);
    const cnt = C.count[ph];
    for (let k = 0; k < cnt; k++) {
      const tip = s.rig.wingTips[k % 2];
      tipA.copy(tip);
      if (cnt === 3 && k === 2) tipA.copy(s.rig.wingTips[0]).add(s.rig.wingTips[1]).multiplyScalar(0.5);
      const base = Math.atan2(tgt.z - tipA.z, tgt.x - tipA.x);
      const ang = base + (k - (cnt - 1) / 2) * C.fan;
      const y0 = Math.min(tipA.y, 70);
      const q: Tor = { t: makeTornado(s.host.scene), x: tipA.x, z: tipA.z, y: y0, y0, dx: Math.cos(ang), dz: Math.sin(ang), d: 0, age: 0, spin: Math.random() * TAU };
      q.t.g.position.set(q.x, q.y, q.z);
      tors.push(q);
      s.host.fx.particles.burst(tipA, 0xdfe9ff, 26, 14, 0.7, 0.2, 0.3, 0, 1.6);
      s.host.fx.burstLight(tipA, 0xcfe0ff, 220, 0.4);
    }
    s.host.sfx.wingbeat(2);
    s.host.sfx.land();
    s.host.shake(0.9, 0.3);
    s.host.skyPulse?.(0.5);
  };
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('player');
        s.rig.jaw = 0.3;
        s.setWings({ hz: 1.0, amp: 0.7, raise: 0.4 });
        s.rig.armPose = 'flex'; s.rig.legPose = 'trail';
        // 몸을 세우고 하늘에서 내려온다 (아레나 밖이라 수직 자세가 된다)
        s.fly([new V3(hoverPt.x * 1.1, hoverPt.y + 30, hoverPt.z * 1.1), hoverPt], 2.4, 'io', () => s.hoverAt(hoverPt, 3, face, 0));
        s.host.sfx.roar();
        s.host.banner('폭풍 날갯짓', '날개를 휘두를 때마다 회오리가 쏟아진다 — 떨어지는 곳에서 벗어나라', 2.2);
        s.host.skyPulse?.(0.7);
      },
    },
    {
      at: tStart - 0.5,
      fn: () => {
        s.rig.wingSwing = true; // 날개를 활짝 펴고 크게 휘두르는 동작으로 바뀐다
        s.setWings({ hz: C.hz, amp: 0.9, raise: 0.25, spread: 1 });
        s.rig.jaw = 0.5;
        s.host.sfx.telegraph();
      },
    },
    {
      at: 0.1,
      fn: () => {
        s.onTick((dt) => {
          tt += dt;
          if (tt > tStart) {
            const cyc = s.rig.flapCycle;
            const f = cyc - Math.floor(cyc);
            // 휘두르기가 앞으로 거의 다 뻗는 순간(한 번의 동작의 약 36% 지점)에 맞춰 발사
            if (prevF >= 0 && prevF < 0.36 && f >= 0.36 && flaps < n) {
              flaps++;
              launch();
            }
            prevF = f;
          }
          const pl = s.player;
          for (let i = tors.length - 1; i >= 0; i--) {
            const q = tors[i];
            const sp = C.speed[ph];
            q.age += dt;
            q.x += q.dx * sp * dt;
            q.z += q.dz * sp * dt;
            q.d += sp * dt;
            q.spin += dt * 9;
            // 날개 끝에서 땅까지 내려꽂힌다
            q.y = q.y0 * Math.max(0, 1 - q.age / C.fall) ** 1.4;
            const grow = Math.min(1, 0.35 + q.age / 0.7);
            q.t.g.position.set(q.x, q.y, q.z);
            q.t.g.scale.set(grow, 0.55 + 0.45 * grow, grow);
            for (let k = 0; k < q.t.layers.length; k++) {
              q.t.layers[k].rotation.y = q.spin * (1 + k * 0.18);
              q.t.layers[k].position.x = Math.sin(q.spin * 0.6 + k * 0.7) * 0.25 * k * 0.3;
            }
            for (let m = 0; m < 3; m++) {
              const a = Math.random() * TAU;
              const h = Math.random() * 7;
              const r = (0.9 + h * 0.5) * grow;
              P.set(q.x + Math.cos(a) * r, q.y + 0.3 + h, q.z + Math.sin(a) * r);
              s.host.fx.particles.burst(P, Math.random() < 0.5 ? 0xdfe9ff : 0x9a8a78, 1, 2, 0.4, 0.14, 0.1, 0, 1.4);
            }
            if (!pl.dead && q.y < 2.5) {
              const rx = pl.pos.x - q.x;
              const rz = pl.pos.z - q.z;
              const dist = Math.hypot(rx, rz);
              if (dist < C.radius * grow + pl.hitRadius && pl.pos.y < 6) pl.takeDamage(q.x, q.z);
              if (dist < C.pull && dist > 0.5) pl.push(pl.pos.x + rx, pl.pos.z + rz, 38 * dt);
            }
            if (q.d > C.reach || Math.hypot(q.x, q.z) > WORLD.radius + 16) {
              q.t.dispose();
              tors.splice(i, 1);
            }
          }
        });
      },
    },
  ];
  const tEnd = tStart + n * per + C.reach / C.speed[ph];
  steps.push({
    at: tEnd + 0.3,
    fn: () => {
      s.rig.wingSwing = false;
      s.rig.jaw = 0.1;
      s.look('off');
      s.setWings({ hz: 1.0, amp: 0.6, raise: 0.15 });
      s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
    },
  });
  return { steps, end: tEnd + 1.3 };
}

/* ───────────────────────── 선회 사격 ─────────────────────────
 * 이무기처럼 아레나 가장자리를 낮게 빙글빙글 돈다. 긴 몸통이 가장자리를 휘감아 안쪽으로 몰아넣고,
 * 도는 동안 플레이어가 달려가는 앞쪽으로 불덩이를 쉼 없이 던진다. (페이즈 2~: 가장자리 안쪽에 불길이 남는다)
 */
function orbit(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.orbit;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const a0 = Math.atan2(s.p.z, s.p.x);
  const R = C.radius;
  const revs = C.revs[ph];
  const speed = C.speed[ph];
  const N = Math.ceil((revs * TAU) / 0.3);
  const pts: THREE.Vector3[] = [];
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    const a = a0 + dir * (0.4 + revs * TAU * u);
    const down = Math.min(1, u / 0.18); // 처음 4분의 1바퀴쯤에 낮게 내려온다
    const alt = 46 * (1 - down) + C.alt * down + Math.sin(u * 22) * 1.4;
    const r = R + (1 - down) * 8;
    pts.push(new V3(Math.cos(a) * r, alt, Math.sin(a) * r));
  }
  const a1 = a0 + dir * (0.4 + revs * TAU);
  pts.push(new V3(Math.cos(a1 + dir * 0.5) * (R + 6), 40, Math.sin(a1 + dir * 0.5) * (R + 6)));
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
  const dur = len / speed;
  let tt = 0;
  let fireT = 0;
  let burnT = 0;
  const M = new V3();
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        s.look('player');
        s.rig.jaw = 0.5;
        s.rig.fire = 0.8;
        s.setWings({ hz: 1.3, amp: 0.55, fold: 0.2, raise: 0.1 });
        s.rig.armPose = 'reach'; s.rig.legPose = 'trail';
        s.fly(pts, dur, 'lin');
        s.host.sfx.roar();
        s.host.banner('선회 사격', '아레나를 휘감는다 — 가장자리에서 벗어나라', 1.8);
        s.host.skyPulse?.(0.6);
      },
    },
    {
      at: 0.1,
      fn: () => {
        s.onTick((dt) => {
          tt += dt;
          // 낮게 내려온 뒤(전체 시간의 18% 이후)부터 사격
          if (tt < dur * 0.2 || tt > dur * 0.93) return;
          fireT -= dt;
          if (fireT <= 0) {
            fireT = C.interval[ph];
            s.mouthPos(M);
            const tgt = ahead(s, 0.45);
            s.field.lob(M.clone(), tgt, C.flight, C.peak, C.bomb, C.zone[ph]);
            s.host.sfx.spit();
            s.host.fx.particles.burst(M, 0xffb040, 10, 6, 0.35, 0.18, 0.3, 2, 2);
            s.host.fx.burstLight(M, 0xff8030, 70, 0.18);
            s.rig.jaw = 1;
            s.after(0.14, () => { s.rig.jaw = 0.5; });
          }
          // 가장자리 안쪽에 불길을 남긴다 (안쪽으로 몰아넣기)
          if (ph >= 1) {
            burnT -= dt;
            if (burnT <= 0) {
              burnT = 0.7;
              const a = Math.atan2(s.p.z, s.p.x);
              s.field.burn(Math.cos(a) * 20.5, Math.sin(a) * 20.5, 2.3, 2.6);
            }
          }
        });
      },
    },
    {
      at: dur,
      fn: () => {
        s.rig.fire = 0;
        s.rig.jaw = 0.1;
        s.look('off');
        s.setWings({ hz: 1.0, amp: 0.6, fold: 0, raise: 0.15 });
        s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
      },
    },
  ];
  return { steps, end: dur + 1.0 };
}

/* ───────────────────────── 착지 (공격 기회) ─────────────────────────
 * 하늘의 용에게는 불꽃이 닿지 않는다. 용이 숨을 고르러 플레이어 반대편 땅에 내려앉아 엎드린다 —
 * 머리와 가슴 보석이 드러나 피해가 크게 늘어나는 공격 기회. 몸에 닿은 채 오래 있으면 피해를 입는다.
 */
function land(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.land;
  const stay = C.stay[ph];
  const T = new V3();
  const dir = new V3();
  const arriveAt = C.descend;
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        const pl = s.player.pos;
        const a = Math.atan2(pl.z, pl.x) + Math.PI + (Math.random() - 0.5) * 0.9;
        T.set(Math.cos(a) * C.far, 0, Math.sin(a) * C.far);
        dir.set(pl.x - T.x, 0, pl.z - T.z).normalize();
        s.look('player');
        s.rig.jaw = 0.4;
        s.setWings({ hz: 1.2, amp: 0.9, raise: 0.3 });
        s.rig.armPose = 'flex'; s.rig.legPose = 'trail';
        s.fly([new V3(T.x - dir.x * 10, 26, T.z - dir.z * 10), new V3(T.x, 1.4, T.z)], arriveAt, 'io');
        s.host.sfx.roar();
        s.host.banner('착지', '지쳐 엎드린다 — 머리와 가슴 보석을 노려라!', 2.0);
        s.host.skyPulse?.(0.5);
      },
    },
    {
      at: arriveAt,
      fn: () => {
        const { host, rig } = s;
        host.shake(1.4, 0.3);
        host.sfx.land();
        host.fx.ring(T.x, T.z, 12, 0.7, 0xffd27a);
        host.fx.particles.burst(new V3(T.x, 0.8, T.z), 0x7a5a42, 50, 11, 1.1, 0.5, 0.6, 7, 1.2);
        host.fx.burstLight(new V3(T.x, 3, T.z), 0xffa050, 200, 0.6);
        const pl = s.player;
        const d = Math.hypot(pl.pos.x - T.x, pl.pos.z - T.z);
        if (d < 10) pl.push(T.x, T.z, 8 * (1 - d / 10) + 2);
        rig.lieDown();
        rig.stunned = true;
        rig.armPose = 'brace'; rig.legPose = 'brace';
        s.exposedOn(true);
        s.hoverAt(new V3(T.x, 1.4, T.z), 8, Math.atan2(dir.x, dir.z), -0.28);
      },
    },
  ];
  for (let k = 0; k < Math.floor(stay / 0.45); k++) {
    steps.push({
      at: arriveAt + 0.6 + k * 0.45,
      fn: () => {
        const M = s.mouthPos(new V3());
        s.host.fx.particles.burst(M, 0x555050, 5, 2.5, 1.2, 0.5, 0.9, -1, 1);
        s.host.fx.particles.burst(M, 0xff6a20, 2, 2, 0.6, 0.2, 0.5, 0, 2);
      },
    });
  }
  const riseAt = arriveAt + stay;
  steps.push({
    at: riseAt,
    fn: () => {
      const { host, rig } = s;
      s.exposedOn(false);
      rig.stunned = false;
      rig.liftOff();
      rig.jaw = 0.8;
      s.setWings({ hz: 1.5, amp: 1.0, fold: 0, raise: 0.25 });
      rig.armPose = 'roar'; rig.legPose = 'roar';
      host.sfx.roar();
      host.sfx.wingbeat(1.5);
      host.shake(1.0, 0.3);
      host.fx.ring(s.p.x, s.p.z, 14, 0.6, 0xffa060);
      host.fx.particles.burst(new V3(s.p.x, 0.5, s.p.z), 0x7a5a42, 50, 11, 1.0, 0.5, 0.6, 6, 1.2);
      const pl = s.player;
      const d = Math.hypot(pl.pos.x - s.p.x, pl.pos.z - s.p.z);
      if (d < 14) pl.push(s.p.x, s.p.z, 8 * (1 - d / 14) + 2); // 날갯짓 바람에 밀려난다 (피해 없음)
      s.fly([new V3(s.p.x - dir.x * 3, 12, s.p.z - dir.z * 3), new V3(s.p.x - dir.x * 14, 40, s.p.z - dir.z * 14)], 1.9, 'in');
    },
  });
  steps.push({ at: riseAt + 1.6, fn: () => { s.rig.jaw = 0.1; s.rig.armPose = 'tuck'; s.rig.legPose = 'trail'; } });
  return { steps, end: riseAt + 1.9 };
}

/* ───────────────────────── 회전 광선 ─────────────────────────
 * 용이 제단 한가운데 하늘에서 입가에 빛을 모으고, 광선의 끝이 제단 위를 구불구불 쓸고 다닌다.
 * 지나간 자리는 불타오른다. 광선 끝이 다가오면 반경 방향으로 비켜서면 된다. (대시도 가능)
 */
function scythe(s: Dragon): AttackScript {
  const ph = s.phaseIndex;
  const C = D.scythe;
  const dur = C.dur[ph];
  const charge = C.charge;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const T = new V3();
  const M = new V3();
  const last = new V3(1e5, 0, 1e5);
  let a0 = 0;
  let phase0 = 0;
  let tt = 0;
  const pos = (u: number, out: THREE.Vector3) => {
    const a = a0 + dir * C.omega * u;
    const r = 11.5 + 7.5 * Math.sin(1.55 * u + phase0);
    return out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  };
  const steps: Step[] = [
    {
      at: 0,
      fn: () => {
        const pl = s.player.pos;
        // 플레이어가 서 있는 쪽에서 광선이 시작해 반대로 휘돈다
        a0 = Math.atan2(pl.z, pl.x) - dir * 0.9;
        phase0 = Math.random() * TAU;
        s.look('player');
        s.rig.jaw = 0.95;
        s.rig.fire = 1;
        s.setWings({ hz: 0.7, amp: 0.4, raise: 0.8, spread: 1 });
        s.rig.armPose = 'gather'; s.rig.legPose = 'roar';
        s.fly([new V3(0, 40, 0)], 1.3, 'io', () => s.hoverAt(new V3(0, 40, 0), 3, null, 0.2));
        s.host.sfx.sunCharge(charge);
        s.host.banner('회전 광선', '광선 끝이 휘돈다 — 비켜서라', 1.8);
        s.host.skyPulse?.(1);
        pos(0, T);
        s.host.fx.telegraphs.circle(T.x, T.z, C.radius + 0.9, charge, () => {});
        s.host.sfx.telegraph();
      },
    },
    {
      at: 0.4,
      fn: () => {
        s.onTick((dt) => {
          tt += dt;
          s.mouthPos(M);
          const k = Math.min(1, tt / charge);
          if (tt < charge) {
            s.rig.headForward(T);
            M.addScaledVector(T, 2.4 + 1.6 * k);
            s.field.charge(M, k);
            s.host.shake(0.08 + 0.25 * k, 0.05);
            return;
          }
          const u = tt - charge;
          if (u > dur) return;
          pos(u, T);
          const fade = Math.min(1, u / 0.3) * Math.min(1, (dur - u) / 0.45);
          s.field.ray(M, T, Math.max(0, fade));
          s.look('point', T);
          s.host.shake(0.35 * fade, 0.04);
          const pl = s.player;
          if (!pl.dead && fade > 0.3 && Math.hypot(pl.pos.x - T.x, pl.pos.z - T.z) < C.radius + pl.hitRadius) pl.takeDamage(T.x, T.z);
          if (Math.hypot(T.x - last.x, T.z - last.z) > 2.4) {
            s.field.burn(T.x, T.z, C.radius * 0.9, 2.3);
            last.copy(T);
          }
        });
      },
    },
    {
      at: charge + dur + 0.2,
      fn: () => {
        s.rig.fire = 0;
        s.rig.jaw = 0.1;
        s.look('off');
        s.setWings({ hz: 0.9, amp: 0.6, raise: 0.15 });
        s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
        s.host.fx.burstLight(T.clone().setY(2), 0xffd9a0, 200, 0.5);
        s.field.explode(T.x, T.z, 3.2, true);
      },
    },
  ];
  return { steps, end: charge + dur + 1.7 };
}

/* ───────────────────────── 페이즈 전환 포효 ─────────────────────────
 * 하늘 높이 떠올라 날개를 펴고 포효 → 불기둥을 하늘로 뿜는다 → 충격파(밀어내기, 피해 없음). 포효 동안 무적.
 */
function roar(s: Dragon): AttackScript {
  const T = D.roar;
  const hold = new V3(0, 42, 0);
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
          s.rig.armPose = 'roar'; s.rig.legPose = 'roar';
          s.fly([new V3(s.p.x * 0.5, 36, s.p.z * 0.5), hold], 1.1, 'io', () => s.hoverAt(hold, 3, null, 0.45));
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
          s.rig.armPose = 'tuck'; s.rig.legPose = 'trail';
        },
      },
    ],
    end: T,
  };
}
