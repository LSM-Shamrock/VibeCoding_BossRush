import * as THREE from 'three';
import { CFG } from './config';
import { PAL } from './palette';
import { Blasts } from './blast';
import type { Host, Target } from './types';
import { WORLD } from './world';

const V3 = THREE.Vector3;

interface Fireball {
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  tail: THREE.Mesh;
  coreMat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
  /** 차징 세기 0~1 */
  power: number;
  damage: number;
  radius: number;
  age: number;
  phase: number;
}

/**
 * 플레이어의 불꽃 투사체 풀 (파일/클래스 이름은 예전 화살 시절 그대로 유지).
 * 차징한 만큼 크고 빠르고 아프다. 서브스텝으로 이동해서 빠른 불꽃이 약점을 뚫고 지나가지 않게 한다.
 */
export class Arrows {
  private pool: Fireball[] = [];
  private tmp = new V3();
  /** 날아가는 불꽃을 따라다니는 조명 하나 (모든 불꽃에 조명을 달면 비싸다) */
  private glow = new THREE.PointLight(PAL.flame, 0, 14, 1.6);
  /** 완전히 모은 불꽃의 폭발 연출 */
  private blasts: Blasts;

  constructor(
    private host: Host,
    private onDealt: (dealt: number) => void,
  ) {
    host.scene.add(this.glow);
    this.blasts = new Blasts(host);
    const coreGeo = new THREE.IcosahedronGeometry(0.3, 1);
    const haloGeo = new THREE.SphereGeometry(0.55, 12, 10);
    // 꼬리: 공 뒤쪽(-z)으로 길게 늘어지는 불꽃
    const tailGeo = new THREE.ConeGeometry(0.42, 2.0, 10, 1, true).translate(0, 1.0, 0).rotateX(-Math.PI / 2);
    const haloMat = new THREE.MeshBasicMaterial({ color: PAL.flame, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    haloMat.color.multiplyScalar(1.3);
    const tailMat = new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    tailMat.color.multiplyScalar(1.4);
    for (let i = 0; i < CFG.arrow.pool; i++) {
      const coreMat = new THREE.MeshBasicMaterial({ color: PAL.flameHot, toneMapped: false });
      const core = new THREE.Mesh(coreGeo, coreMat);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      const tail = new THREE.Mesh(tailGeo, tailMat);
      for (const m of [core, halo, tail]) m.castShadow = false;
      const group = new THREE.Group();
      group.add(tail, halo, core);
      group.visible = false;
      host.scene.add(group);
      this.pool.push({ group, core, halo, tail, coreMat, vel: new V3(), life: 0, active: false, power: 0, damage: 1, radius: 0.2, age: 0, phase: Math.random() * 10 });
    }
  }

  spawn(p: THREE.Vector3, dir: THREE.Vector3, power: number) {
    const a = this.pool.find((x) => !x.active);
    if (!a) return;
    const C = CFG.arrow;
    a.active = true;
    a.life = C.life;
    a.age = 0;
    a.group.visible = true;
    a.group.position.copy(p);
    a.group.lookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z);
    const k = power * power * 0.4 + power * 0.6; // 약하게 당긴 불꽃은 속도가 더 빨리 떨어진다
    a.power = power;
    a.damage = C.damage[0] + (C.damage[1] - C.damage[0]) * Math.pow(power, C.damageCurve);
    a.radius = C.radius[0] + (C.radius[1] - C.radius[0]) * power;
    a.vel.copy(dir).multiplyScalar(C.speed[0] + (C.speed[1] - C.speed[0]) * k);
    a.group.scale.setScalar(0.45 + 1.0 * power);
    // 많이 당길수록 백열에 가깝게
    a.coreMat.color.set(power >= 0.95 ? 0xffe8a8 : PAL.flameHot).multiplyScalar(1.0 + 0.7 * power);
  }

  update(dt: number) {
    const lim = WORLD.radius + 10; // 맵 바깥(이무기 외곽 구역)까지 날아간다
    let lead: Fireball | null = null;
    for (const a of this.pool) {
      if (!a.active) continue;
      a.life -= dt;
      a.age += dt;
      const dist = a.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.3));
      this.tmp.copy(a.vel).multiplyScalar(dt / steps);
      let hit = false;
      let dealtNow = 0;
      let hitTarget: Target | null = null;
      for (let s = 0; s < steps && !hit; s++) {
        a.group.position.add(this.tmp);
        for (const t of this.host.targets) {
          if (!t.alive) continue;
          const dealt = t.hitArrow(a.group.position, a.radius, a.damage);
          if (dealt !== 0) {
            hit = true;
            dealtNow = dealt;
            hitTarget = t;
            break;
          }
        }
      }
      const p = a.group.position;
      const floor = p.y < 0.05;
      const out = p.y > 30 || a.life <= 0 || p.x * p.x + p.z * p.z > lim * lim;
      if (hit || floor || out) {
        // BLOCKED(-1): 다리 등에 막힘 → 불꽃만 꺼지고 데미지/게이지는 없음
        if (hit && dealtNow > 0) this.onDealt(dealtNow);
        if (hit || floor) this.impact(a, floor && !hit, dealtNow > 0, hitTarget);
        a.active = false;
        a.group.visible = false;
        continue;
      }

      // 일렁임
      const fl = 1 + 0.14 * Math.sin(a.age * 34 + a.phase) + 0.08 * Math.sin(a.age * 57 + a.phase * 2);
      a.halo.scale.setScalar(fl);
      a.tail.scale.set(1, 1, (0.85 + 0.3 * Math.sin(a.age * 41 + a.phase)) * (0.7 + 0.6 * a.power));
      // 꼬리 불씨: 위로 떠오르며 사라진다
      const n = a.power > 0.6 ? 2 : 1;
      this.host.fx.particles.burst(p, Math.random() < 0.4 ? PAL.flameHot : PAL.flame, n, 0.9 + a.power, 0.5, 0.12 + 0.16 * a.power, 0.3, -2.5, 1.7);
      if (!lead || a.power > lead.power) lead = a;
    }
    // 조명은 가장 센 불꽃 하나만 따라간다
    if (lead) {
      this.glow.position.copy(lead.group.position);
      this.glow.intensity = 14 + 60 * lead.power;
    } else {
      this.glow.intensity = 0;
    }
    this.blasts.update(dt);
  }

  /** 재도전/부활 때 날아가는 불꽃과 폭발 연출을 모두 치운다 */
  reset() {
    for (const a of this.pool) {
      a.active = false;
      a.group.visible = false;
    }
    this.glow.intensity = 0;
    this.blasts.clear();
  }

  /** 적중/지면 충돌 연출. 차징이 셀수록 크고 밝다. 완전히 모았다면 그 자리에서 폭발해 범위 안의 모두에게 같은 피해. */
  private impact(a: Fireball, onGround: boolean, damaged: boolean, hitTarget: Target | null) {
    const fx = this.host.fx;
    const F = CFG.flame;
    const p = a.group.position;
    const k = a.power;
    if (!damaged && !onGround) {
      // 막힘: 작은 불똥만
      fx.particles.burst(p, PAL.flameHot, 6, 5, 0.3, 0.1, 0.3);
      return;
    }
    fx.particles.burst(p, PAL.flame, 8 + Math.round(k * 26), 5 + k * 5, 0.55, 0.14 + 0.1 * k, 0.5, 8, 1.8);
    fx.particles.burst(p, PAL.flameHot, 4 + Math.round(k * 10), 7 + k * 4, 0.3, 0.1, 0.2, 10, 1.8);
    fx.burstLight(this.tmp.set(p.x, Math.max(0.8, p.y), p.z), PAL.flame, 40 + 110 * k, 0.28 + 0.2 * k);
    if (onGround) fx.ring(p.x, p.z, 0.8 + 1.8 * k, 0.3, PAL.flame, 0.08);
    if (k < F.fullAt) return;

    // ── 완전 차징: 폭발. 직접 맞은 대상은 이미 피해를 입었으니 건너뛰고, 범위 안의 나머지 모두에게 같은 피해.
    const R = F.splashRadius;
    this.host.shake(damaged ? 0.55 : 0.4);
    this.host.sfx.boom();
    this.blasts.spawn(p.x, p.y, p.z, R);
    fx.burstLight(this.tmp.set(p.x, Math.max(1.2, p.y), p.z), PAL.flameHot, 150, 0.4);
    fx.ring(p.x, p.z, R, 0.42, PAL.flameHot, 0.09);
    fx.ring(p.x, p.z, R * 0.62, 0.32, PAL.flame, 0.1);
    fx.particles.burst(this.tmp.set(p.x, 0.5, p.z), PAL.flame, 50, 11, 0.8, 0.22, 0.4, 5, 1.8);
    fx.particles.burst(this.tmp.set(p.x, 0.6, p.z), PAL.flameHot, 22, 14, 0.5, 0.14, 0.3, 6, 1.8);
    fx.particles.burst(this.tmp.set(p.x, 0.4, p.z), PAL.ember, 24, 7, 1.1, 0.18, 0.5, 2, 1.5);
    const dmg = a.damage * F.splashMult;
    for (const t of this.host.targets) {
      if (!t.alive || t === hitTarget) continue;
      const dealt = t.hitSplash(p.x, p.z, R, dmg);
      if (dealt > 0) this.onDealt(dealt);
    }
  }
}
