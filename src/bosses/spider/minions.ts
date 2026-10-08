import * as THREE from 'three';
import { CFG } from '../../config';
import type { Circle, Host, Target } from '../../types';
import type { Player } from '../../player';
import { PAL } from '../../palette';

const V3 = THREE.Vector3;
const S = CFG.spider;

/** 알/새끼를 만들고 관리하는 쪽(거미 본체)이 구현하는 인터페이스 */
export interface MinionOwner {
  readonly phaseIndex: number;
  addMinion(m: Minion): void;
  /** byPlayer: 플레이어가 처치했는가 (자폭/부화는 false) */
  minionGone(m: Minion, byPlayer: boolean): void;
  spawnBabies(x: number, z: number, n: number): void;
  babies(): Baby[];
}

export interface Minion extends Target {
  readonly kind: 'egg' | 'baby';
  update(dt: number): void;
  dispose(): void;
  /** 보스가 죽거나 재시작할 때: 효과 없이/가볍게 정리 */
  vanish(withFx: boolean): void;
}

/* ───────────────────────── 알 ───────────────────────── */
export class Egg implements Minion {
  readonly kind = 'egg';
  alive = true;
  private mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private state: 'fly' | 'sit' = 'fly';
  private t = 0;
  private sitT = 0;
  private hp: number = S.eggs.eggHp;
  private flash = 0;
  private pos = new V3();
  /** 알 위에 뜨는 체력바 (착지한 뒤 보인다). 부화 전에 이걸 다 깎으면 새끼가 나오지 않는다 */
  private bar = new THREE.Group();
  private barBack: THREE.Mesh;
  private barFill: THREE.Mesh;
  private barMats: THREE.MeshBasicMaterial[] = [];

  constructor(
    private host: Host,
    private owner: MinionOwner,
    private from: THREE.Vector3,
    private to: THREE.Vector3,
  ) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xe6d3a6, emissive: 0x5a3208, roughness: 0.5, flatShading: true });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 9).scale(0.85, 1.15, 0.85), this.mat);
    this.mesh.castShadow = true;
    this.mesh.position.copy(from);
    host.scene.add(this.mesh);

    // 떨어질 자리 표시 (데미지 없음 — 붉은색 대신 금색으로 구분)
    this.ringMat = new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 28).rotateX(-Math.PI / 2), this.ringMat);
    this.ring.position.set(to.x, 0.06, to.z);
    host.scene.add(this.ring);

    // 체력바: 어두운 밑판 + 금색 채움 (왼쪽 기준으로 줄어든다). 다리/몸에 가려도 보이도록 깊이 검사를 끈다.
    const W = 1.5;
    const H = 0.17;
    const mk = (color: number, op: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false });
      this.barMats.push(m);
      return m;
    };
    this.barBack = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.1, H + 0.1), mk(0x120403, 0.85));
    const fillMat = mk(0xffa62a, 1); // 블룸에 번져 흰색이 되지 않도록 밝기를 올리지 않는다
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(W, H).translate(W / 2, 0, 0.01), fillMat);
    this.barFill.position.x = -W / 2;
    this.barBack.renderOrder = 20;
    this.barFill.renderOrder = 21;
    this.bar.add(this.barBack, this.barFill);
    this.bar.visible = false;
    host.scene.add(this.bar);
  }

  /** 맞은 만큼 체력바를 줄이고 숫자를 띄운다 */
  private onHit(dmg: number) {
    this.flash = 1;
    this.host.floatText(this.tmpText.set(this.pos.x, 1.9, this.pos.z), String(Math.max(1, Math.round(dmg))), 'normal');
  }
  private tmpText = new V3();

  update(dt: number) {
    if (!this.alive) return;
    this.t += dt;
    const E = S.eggs;
    if (this.state === 'fly') {
      const k = Math.min(1, this.t / E.flight);
      this.pos.lerpVectors(this.from, this.to, k);
      this.pos.y = this.from.y * (1 - k) + 0.7 * k + Math.sin(k * Math.PI) * 5.5;
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.x += dt * 9;
      this.mesh.rotation.z += dt * 6;
      this.ring.scale.setScalar(1.3 - 0.3 * k);
      if (k >= 1) {
        this.state = 'sit';
        this.pos.set(this.to.x, 0.7, this.to.z);
        this.mesh.position.copy(this.pos);
        this.mesh.rotation.set(0, Math.random() * 6, 0);
        this.host.scene.remove(this.ring);
        this.host.fx.particles.burst(new V3(this.to.x, 0.2, this.to.z), 0xd9c08a, 12, 4, 0.5, 0.12, 0.3);
        this.host.sfx.pop();
      }
      return;
    }
    // 앉아서 부화 대기: 점점 흔들리고 밝아진다
    this.sitT += dt;
    this.bar.visible = true;
    this.bar.position.set(this.pos.x, 1.7, this.pos.z);
    this.bar.quaternion.copy(this.host.camera.quaternion);
    // 가까이 있어도 화면을 가리지 않도록, 거리에 따라 크기를 보정한다
    this.bar.scale.setScalar(Math.min(1.3, Math.max(0.42, this.host.camera.position.distanceTo(this.pos) / 18)));
    this.barFill.scale.x = Math.max(0.001, this.hp / S.eggs.eggHp);
    const p = Math.min(1, this.sitT / E.hatch);
    this.flash = Math.max(0, this.flash - dt * 9);
    this.mesh.rotation.z = Math.sin(this.sitT * (6 + 26 * p)) * 0.1 * (0.3 + p);
    const s = 1 + 0.08 * Math.sin(this.sitT * (4 + 18 * p)) * p;
    this.mesh.scale.set(s, s, s);
    const g = 0.18 + 0.7 * p * p + this.flash;
    this.mat.emissive.setRGB(0.5 * g + this.flash * 0.7, 0.26 * g + this.flash * 0.4, 0.05 * g + this.flash * 0.12);
    if (this.sitT >= E.hatch) this.hatch();
  }

  private hatch() {
    this.alive = false;
    const { x, z } = this.pos;
    this.host.fx.particles.burst(new V3(x, 0.6, z), 0xffd27a, 26, 7, 0.6, 0.16, 0.6);
    this.host.sfx.pop();
    this.owner.spawnBabies(x, z, S.eggs.babies);
    this.remove();
    this.owner.minionGone(this, false);
  }

  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive || this.state !== 'sit') return 0;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 0.8 + r || p.y > 2.4) return 0;
    this.hp -= dmg;
    this.onHit(dmg);
    this.host.sfx.hit(false);
    if (this.hp <= 0) this.kill();
    return dmg;
  }

  hitSplash(x: number, z: number, r: number, dmg: number): number {
    if (!this.alive || this.state !== 'sit') return 0;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > 0.8 + r) return 0;
    this.hp -= dmg;
    this.onHit(dmg);
    this.host.sfx.hit(false);
    if (this.hp <= 0) this.kill();
    return dmg;
  }

  hitRadial(c: THREE.Vector3, radius: number, _dmg: number) {
    if (!this.alive || this.state !== 'sit') return;
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < radius + 0.6) this.kill();
  }

  /** 부화 전에 깨뜨리면 새끼가 나오지 않는다 */
  private kill() {
    this.alive = false;
    this.host.fx.particles.burst(new V3(this.pos.x, 0.6, this.pos.z), 0xf3e6c8, 22, 7, 0.6, 0.15, 0.6);
    this.host.sfx.pop();
    this.remove();
    this.owner.minionGone(this, true);
  }

  bodies(): Circle[] {
    return [];
  }

  vanish(withFx: boolean) {
    if (!this.alive) return;
    this.alive = false;
    if (withFx) this.host.fx.particles.burst(new V3(this.pos.x, 0.6, this.pos.z), 0xf3e6c8, 14, 6, 0.5, 0.14, 0.6);
    this.remove();
  }

  private remove() {
    this.host.scene.remove(this.mesh);
    this.host.scene.remove(this.ring);
    this.host.scene.remove(this.bar);
    this.dispose();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
    this.barBack.geometry.dispose();
    this.barFill.geometry.dispose();
    for (const m of this.barMats) m.dispose();
  }
}

/* ───────────────────────── 새끼 거미 ───────────────────────── */
const babyBodyGeo = new THREE.SphereGeometry(0.42, 10, 8).scale(1, 0.75, 1.2);
const babyLegGeo = new THREE.CylinderGeometry(0.035, 0.06, 0.8, 5).translate(0, -0.4, 0);

export class Baby implements Minion {
  readonly kind = 'baby';
  alive = true;
  readonly pos = new V3();
  private vel = new V3();
  private group = new THREE.Group();
  private mat = new THREE.MeshStandardMaterial({ color: 0x8a2c22, emissive: 0x2a0c06, roughness: 0.7, flatShading: true });
  private eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, toneMapped: false });
  private legPivots: THREE.Group[] = [];
  private hp: number = S.baby.hp;
  private flash = 0;
  private phase = Math.random() * 6;
  private born = 0;
  private from = new V3();
  private yaw = 0;

  constructor(
    private host: Host,
    private owner: MinionOwner,
    private player: Player,
    x: number,
    z: number,
    tx: number,
    tz: number,
  ) {
    this.from.set(x, 0.3, z);
    this.pos.set(tx, 0, tz);
    this.eyeMat.color.multiplyScalar(1.7);

    const body = new THREE.Mesh(babyBodyGeo, this.mat);
    body.position.y = 0.45;
    body.castShadow = true;
    this.group.add(body);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), this.eyeMat);
      eye.position.set(sx * 0.16, 0.6, 0.42);
      this.group.add(eye);
    }
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const row = i % 3;
      const pv = new THREE.Group();
      pv.position.set(side * 0.3, 0.45, 0.25 - row * 0.28);
      pv.rotation.y = side * (Math.PI / 2) + (row - 1) * 0.5 * side;
      const leg = new THREE.Mesh(babyLegGeo, this.mat);
      leg.rotation.z = Math.PI / 2 + 0.45; // 바깥-아래로 뻗음
      leg.castShadow = true;
      pv.add(leg);
      this.group.add(pv);
      this.legPivots.push(pv);
    }
    this.group.position.copy(this.from);
    host.scene.add(this.group);
  }

  update(dt: number) {
    if (!this.alive) return;
    const sp = S.baby.speed[Math.min(2, this.owner.phaseIndex)];
    this.flash = Math.max(0, this.flash - dt * 9);
    this.mat.emissive.setRGB(0.17 + this.flash * 0.9, 0.05 + this.flash * 0.45, 0.03 + this.flash * 0.1);

    // 알에서 튀어나오는 도약 (0.4초 동안은 무적/무공격)
    this.born += dt;
    const JUMP = 0.4;
    if (this.born < JUMP) {
      const k = this.born / JUMP;
      this.group.position.set(
        this.from.x + (this.pos.x - this.from.x) * k,
        this.from.y * (1 - k) + Math.sin(k * Math.PI) * 1.6,
        this.from.z + (this.pos.z - this.from.z) * k,
      );
      this.animateLegs(dt, 1.6);
      return;
    }

    const pl = this.player;
    let dx = pl.pos.x - this.pos.x;
    let dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // 형제끼리 겹치지 않게 살짝 밀어냄
    let sx = 0;
    let sz = 0;
    for (const o of this.owner.babies()) {
      if (o === this || !o.alive) continue;
      const ox = this.pos.x - o.pos.x;
      const oz = this.pos.z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 1e-4) {
        sx += ox / od;
        sz += oz / od;
      }
    }
    const tx = dx + sx * 0.8;
    const tz = dz + sz * 0.8;
    const tl = Math.hypot(tx, tz) || 1;
    const k = Math.min(1, 10 * dt);
    this.vel.x += ((tx / tl) * sp - this.vel.x) * k;
    this.vel.z += ((tz / tl) * sp - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > CFG.arena.playerLimit) {
      this.pos.x *= CFG.arena.playerLimit / r;
      this.pos.z *= CFG.arena.playerLimit / r;
    }

    const targetYaw = Math.atan2(this.vel.x, this.vel.z);
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, 14 * dt);
    this.group.position.set(this.pos.x, Math.abs(Math.sin(this.phase * 2)) * 0.05, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.animateLegs(dt, Math.hypot(this.vel.x, this.vel.z));

    // 접촉하면 자폭 (대시 무적 중이면 통과하고 계속 쫓아옴)
    if (!pl.dead && d < S.baby.radius + pl.hitRadius + 0.35) {
      if (pl.takeDamage(this.pos.x, this.pos.z)) this.die(false);
    }
  }

  private animateLegs(dt: number, speed: number) {
    this.phase += dt * (6 + speed * 2.6);
    this.legPivots.forEach((pv, i) => {
      pv.rotation.x = Math.sin(this.phase + (i % 2) * Math.PI + i * 0.9) * 0.45;
    });
  }

  hitArrow(p: THREE.Vector3, r: number, dmg: number): number {
    if (!this.alive || this.born < 0.4) return 0;
    if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > S.baby.radius + r || p.y > 2.4) return 0;
    this.hp -= dmg;
    this.flash = 1;
    this.host.sfx.hit(false);
    if (this.hp <= 0) this.die(true);
    return dmg;
  }

  hitSplash(x: number, z: number, r: number, dmg: number): number {
    if (!this.alive || this.born < 0.4) return 0;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > S.baby.radius + r) return 0;
    this.hp -= dmg;
    this.flash = 1;
    if (this.hp <= 0) this.die(true);
    return dmg;
  }

  hitRadial(c: THREE.Vector3, radius: number, _dmg: number) {
    if (!this.alive) return;
    if (Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < radius + 0.4) this.die(true);
  }

  private die(byPlayer: boolean) {
    this.alive = false;
    this.host.fx.particles.burst(new V3(this.pos.x, 0.5, this.pos.z), byPlayer ? 0xffb04a : 0xff8a5a, 18, 6, 0.5, 0.14, 0.5);
    this.host.sfx.pop();
    this.remove();
    this.owner.minionGone(this, byPlayer);
  }

  bodies(): Circle[] {
    return [];
  }

  vanish(withFx: boolean) {
    if (!this.alive) return;
    this.alive = false;
    if (withFx) this.host.fx.particles.burst(new V3(this.pos.x, 0.5, this.pos.z), 0xffb04a, 12, 5, 0.5, 0.12, 0.5);
    this.remove();
  }

  private remove() {
    this.host.scene.remove(this.group);
    this.dispose();
  }

  dispose() {
    this.mat.dispose();
    this.eyeMat.dispose();
  }
}
