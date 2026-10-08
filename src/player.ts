import * as THREE from 'three';
import { CFG } from './config';
import { Chain } from './procedural/chain';
import { Arrows } from './arrows';
import type { Input } from './input';
import type { Host } from './types';
import { PAL } from './palette';

const V3 = THREE.Vector3;

function lerpAngle(a: number, b: number, t: number) {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

interface Ghost {
  g: THREE.Group;
  mats: THREE.MeshBasicMaterial[];
  life: number;
}
const GHOST_LIFE = 0.28;

type LampState = 'on' | 'thrown' | 'relighting';

/**
 * 등불 사냥꾼 — 원뿔/구/원통만으로 만든 플레이어.
 * 체력 = 등불 밝기(5단계), 망토 = Chain 모듈(뱀/용 몸에 재사용할 그 모듈)
 */
export class Player {
  readonly root = new THREE.Group();
  readonly pos = new V3(0, 0, 9);
  readonly vel = new V3();
  readonly hitRadius = CFG.player.hitRadius;
  readonly arrows: Arrows;
  /** true 면 사격 중지 (보스 격파 후 결과 화면까지) */
  ceaseFire = false;

  yaw = Math.PI; // 앞 방향 = (sin yaw, cos yaw). π면 -Z(보스 쪽)
  private aimYaw = Math.PI;
  hp: number = CFG.player.maxHp;
  invuln = 0;
  god = false;
  dead = false;
  autoFire = true;

  dashT = 0;
  dashCd = 0;
  private dashInv = 0;
  private dashDir = new V3(0, 0, -1);
  private ghostT = 0;

  gauge = 0;
  /** 이번 도전에서 맞은 횟수 (클리어 화면용) */
  hitsTaken = 0;
  /** 거미줄에 걸린 남은 시간 (이동 속도 감소, 대시로 벗어남) */
  slowT = 0;
  private knock = new V3();
  private web!: THREE.Mesh;
  private fireCd = 0;
  private t = 0;
  private walkPhase = 0;
  private hurtFlash = 0;
  private deadT = 0;

  /** 사망 시 호출 (게임이 오버레이를 띄움) */
  onDeath: () => void = () => {};

  // 모델 파트
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private bulb!: THREE.Mesh;
  private bulbMat = new THREE.MeshBasicMaterial({ color: CFG.lantern.color, toneMapped: false });
  private light = new THREE.PointLight(CFG.lantern.color, 30, 12, CFG.lantern.decay);
  private clothMats: THREE.MeshStandardMaterial[] = [];

  // 등불 상태
  private lampI: number = CFG.lantern.intensityByHp[4];
  private lampD: number = CFG.lantern.distanceByHp[4];
  private lampState: LampState = 'on';
  private lanternScale = 1;
  private relightT = 0;
  private flash = 0;

  // 특수기(등불 투척)
  private sp = { active: false, t: 0, from: new V3(), to: new V3() };
  private thrown!: THREE.Mesh;
  private thrownLight = new THREE.PointLight(CFG.lantern.color, 20, 12, CFG.lantern.decay);

  // 망토 (Chain + 리본 메쉬)
  private cape: Chain;
  private capeGeo = new THREE.BufferGeometry();
  private capeMesh: THREE.Mesh;

  private ghosts: Ghost[] = [];
  private tmpA = new V3();
  private tmpB = new V3();

  constructor(private host: Host) {
    this.arrows = new Arrows(host, (n) => this.addCharge(n));
    this.buildModel();

    /* 망토 */
    this.cape = new Chain(7, 0.15, new V3(0, 1.1, 0));
    const n = this.cape.count;
    this.capeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    this.capeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.capeGeo.setIndex(idx);
    const capeMat = new THREE.MeshStandardMaterial({ color: 0xb02a28, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x000000 });
    this.clothMats.push(capeMat);
    this.capeMesh = new THREE.Mesh(this.capeGeo, capeMat);
    this.capeMesh.frustumCulled = false;
    this.capeMesh.castShadow = true;
    host.scene.add(this.capeMesh);

    /* 투척 등불 */
    this.thrown = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), this.bulbMat.clone());
    (this.thrown.material as THREE.MeshBasicMaterial).color.multiplyScalar(2);
    this.thrown.visible = false;
    this.thrownLight.visible = false;
    this.thrown.add(this.thrownLight);
    host.scene.add(this.thrown);

    /* 거미줄 걸림 표시 (발밑 거미줄 문양) */
    {
      const S = 128;
      const cv = document.createElement('canvas');
      cv.width = cv.height = S;
      const g = cv.getContext('2d')!;
      g.strokeStyle = 'rgba(255,236,196,0.95)';
      g.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(S / 2, S / 2);
        g.lineTo(S / 2 + Math.cos(a) * (S / 2 - 3), S / 2 + Math.sin(a) * (S / 2 - 3));
        g.stroke();
      }
      for (const f of [0.28, 0.52, 0.76, 0.96]) {
        g.beginPath();
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const r = (S / 2 - 3) * f * (i % 2 ? 0.93 : 1);
          const x = S / 2 + Math.cos(a) * r;
          const y = S / 2 + Math.sin(a) * r;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
      mat.color.multiplyScalar(1.4);
      this.web = new THREE.Mesh(new THREE.CircleGeometry(1.15, 24).rotateX(-Math.PI / 2), mat);
      this.web.position.y = 0.06;
      this.web.visible = false;
    }

    /* 대시 잔상 풀 */
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const m1 = new THREE.MeshBasicMaterial({ color: PAL.glow, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const m2 = m1.clone();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.05, 10), m1);
      cone.position.y = 0.55;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), m2);
      head.position.y = 1.35;
      g.add(cone, head);
      g.visible = false;
      host.scene.add(g);
      this.ghosts.push({ g, mats: [m1, m2], life: 0 });
    }

    this.root.add(this.body);
    this.root.add(this.web);
    host.scene.add(this.root);
    this.cape.reset(this.capeAnchor());
    this.syncTransform();
  }

  /* ───────────── 모델 조립 ───────────── */
  private buildModel() {
    const mk = (color: number, rough = 0.85, metal = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      return m;
    };
    const cloth = mk(0xc9a272);
    const dark = mk(0x4a2c1c, 0.9);
    const wood = mk(0x6b4a2e);
    const metal = mk(0xb89a5c, 0.4, 0.6);
    this.clothMats.push(cloth, dark);

    const add = (parent: THREE.Object3D, mesh: THREE.Mesh, x = 0, y = 0, z = 0) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // 다리 (피벗 = 엉덩이)
    const legGeo = new THREE.CylinderGeometry(0.085, 0.07, 0.56, 8).translate(0, -0.28, 0);
    for (const [leg, x] of [
      [this.legL, 0.12],
      [this.legR, -0.12],
    ] as const) {
      leg.position.set(x, 0.58, 0);
      add(leg, new THREE.Mesh(legGeo, dark));
      this.body.add(leg);
    }

    // 몸통/어깨/머리/후드
    add(this.body, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.31, 0.64, 10), cloth), 0, 0.9, 0);
    add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), cloth), 0.27, 1.14, 0);
    add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), cloth), -0.27, 1.14, 0);
    add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), dark), 0, 1.4, 0);
    const hood = add(this.body, new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.42, 10), cloth), 0, 1.6, -0.03);
    hood.rotation.x = -0.28;
    // 눈 (조준 방향 식별용 발광)
    const eyeMat = new THREE.MeshBasicMaterial({ color: PAL.lanternHot, toneMapped: false });
    eyeMat.color.multiplyScalar(1.6);
    for (const x of [0.07, -0.07]) add(this.body, new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat), x, 1.42, 0.17).castShadow = false;

    // 오른팔 + 석궁 (앞으로 뻗음)
    const armR = new THREE.Group();
    armR.position.set(-0.27, 1.12, 0.02);
    add(armR, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8).translate(0, 0.275, 0).rotateX(Math.PI / 2), cloth));
    add(armR, new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.6), wood), 0, -0.02, 0.5);
    add(armR, new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.05), metal), 0, 0, 0.74);
    this.body.add(armR);

    // 왼팔 + 등불 (옆으로 늘어뜨림)
    this.armL.position.set(0.27, 1.12, 0.02);
    add(this.armL, new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.5, 8).translate(0, -0.25, 0), cloth));
    this.body.add(this.armL);
    const lamp = new THREE.Group();
    lamp.position.set(0.13, -0.55, 0.12);
    add(lamp, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 10), metal), 0, 0.17, 0);
    add(lamp, new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.035, 10), metal), 0, -0.14, 0);
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), this.bulbMat);
    lamp.add(this.bulb);
    this.light.position.set(0, 0.6, 0);
    this.light.castShadow = false;
    this.bulb.add(this.light);
    this.armL.add(lamp);
  }

  /* ───────────── 업데이트 ───────────── */
  update(dt: number, input: Input, aim: THREE.Vector3) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 9);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    for (const m of this.clothMats) m.emissive.setRGB(0.1 + this.hurtFlash * 0.9, 0.05 + this.hurtFlash * 0.12, 0.03 + this.hurtFlash * 0.1);

    if (this.dead) {
      this.updateDead(dt);
    } else {
      this.updateAlive(dt, input, aim);
    }
    this.updateSpecial(dt);
    this.web.visible = this.slowT > 0 && !this.dead;
    if (this.web.visible) {
      this.web.rotation.y += dt * 0.8;
      (this.web.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, this.slowT * 1.6);
    }
    this.updateLantern(dt);
    this.updateCape(dt);
    this.updateGhosts(dt);
    this.syncTransform();
  }

  private updateAlive(dt: number, input: Input, aim: THREE.Vector3) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.dashInv = Math.max(0, this.dashInv - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.slowT = Math.max(0, this.slowT - dt);

    // 조준
    const dx = aim.x - this.pos.x;
    const dz = aim.z - this.pos.z;
    if (dx * dx + dz * dz > 0.09) this.aimYaw = Math.atan2(dx, dz);
    this.yaw = lerpAngle(this.yaw, this.aimYaw, 1 - Math.exp(-CFG.player.turnSpeed * dt));

    // 입력 (카메라가 +Z에서 -Z를 보므로 W = -Z)
    let ix = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let iz = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    const il = Math.hypot(ix, iz);
    if (il > 0) {
      ix /= il;
      iz /= il;
    }

    // 대시
    if (input.tapped('dash') && this.dashCd <= 0 && this.dashT <= 0) {
      if (il > 0) this.dashDir.set(ix, 0, iz);
      else this.dashDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.dashT = CFG.dash.duration;
      this.dashCd = CFG.dash.cooldown;
      this.dashInv = CFG.dash.invuln;
      this.ghostT = 0;
      if (this.slowT > 0) {
        // 대시는 거미줄을 끊어낸다
        this.slowT = 0;
        this.host.fx.particles.burst(this.tmpA.set(this.pos.x, 0.5, this.pos.z), 0xfff0d0, 14, 5, 0.4, 0.1, 0.4);
      }
      this.host.sfx.dash();
      this.host.fx.particles.burst(this.tmpA.set(this.pos.x, 0.15, this.pos.z), 0xd9b87c, 12, 4, 0.4, 0.12, 0.2);
    }

    if (this.dashT > 0) {
      this.vel.copy(this.dashDir).multiplyScalar(CFG.dash.speed);
      this.dashT -= dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = CFG.dash.ghostEvery;
        this.spawnGhost();
      }
      if (this.dashT <= 0) this.vel.copy(this.dashDir).multiplyScalar(CFG.player.speed);
    } else {
      const k = Math.min(1, CFG.player.accel * dt);
      const sp = CFG.player.speed * (this.slowT > 0 ? 0.5 : 1);
      this.vel.x += (ix * sp - this.vel.x) * k;
      this.vel.z += (iz * sp - this.vel.z) * k;
    }
    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-9 * dt));

    // 아레나 경계 / 보스 몸통 충돌
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > CFG.arena.playerLimit) {
      this.pos.x *= CFG.arena.playerLimit / d;
      this.pos.z *= CFG.arena.playerLimit / d;
    }
    for (const t of this.host.targets) {
      for (const b of t.bodies()) {
        const ox = this.pos.x - b.x;
        const oz = this.pos.z - b.z;
        const od = Math.hypot(ox, oz);
        const min = b.r + CFG.player.bodyRadius;
        if (od < min && od > 1e-4) {
          this.pos.x = b.x + (ox / od) * min;
          this.pos.z = b.z + (oz / od) * min;
        }
      }
    }
    // 밀려나서 경계 밖으로 나가지 않게 한 번 더
    const d2 = Math.hypot(this.pos.x, this.pos.z);
    if (d2 > CFG.arena.playerLimit) {
      this.pos.x *= CFG.arena.playerLimit / d2;
      this.pos.z *= CFG.arena.playerLimit / d2;
    }

    // 사격
    const wantFire = !this.ceaseFire && (this.autoFire || input.mouseDown);
    if (wantFire && this.fireCd <= 0 && !this.sp.active) this.fire();

    // 특수기
    if (input.tapped('special') && this.gauge >= CFG.special.max && this.lampState === 'on' && !this.sp.active) this.startSpecial(aim);

    // 걷기 모션
    const spd = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / CFG.player.speed);
    this.walkPhase += spd * dt * 15;
    const amp = 0.75 * spd;
    this.legL.rotation.x = Math.sin(this.walkPhase) * amp;
    this.legR.rotation.x = -Math.sin(this.walkPhase) * amp;
    this.armL.rotation.set(0.2 + Math.sin(this.walkPhase) * 0.25 * spd, 0, -0.18);
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06 * spd;
    this.body.rotation.z = 0;
  }

  private fire() {
    this.fireCd = 1 / CFG.arrow.fireRate;
    const spread = (Math.random() - 0.5) * 0.04;
    const a = this.yaw + spread;
    const dir = this.tmpA.set(Math.sin(a), 0, Math.cos(a));
    // 석궁 끝(오른쪽 앞) 위치
    const mz = 1.05;
    const mx = -0.27;
    const p = this.tmpB.set(
      this.pos.x + mx * Math.cos(this.yaw) + mz * Math.sin(this.yaw),
      1.1,
      this.pos.z - mx * Math.sin(this.yaw) + mz * Math.cos(this.yaw),
    );
    this.arrows.spawn(p, dir);
    this.flash = 1; // 발사 때 등불이 순간 밝아짐
    this.host.sfx.shoot();
  }

  /* ───────────── 피격 / 사망 / 부활 ───────────── */
  takeDamage(fromX: number, fromZ: number): boolean {
    if (this.dead || this.god || this.invuln > 0 || this.dashInv > 0) return false;
    this.hp -= 1;
    this.hitsTaken++;
    this.invuln = CFG.player.invuln;
    this.hurtFlash = 1;
    this.flash = 0;
    const kx = this.pos.x - fromX;
    const kz = this.pos.z - fromZ;
    const kl = Math.hypot(kx, kz) || 1;
    this.knock.x += (kx / kl) * 9;
    this.knock.z += (kz / kl) * 9;
    this.host.hitStop(0.07);
    this.host.shake(0.7);
    this.host.sfx.playerHit();
    this.host.floatText(this.tmpA.set(this.pos.x, 2, this.pos.z), '-1', 'player');
    this.host.fx.particles.burst(this.tmpA.set(this.pos.x, 1, this.pos.z), 0xff5a4d, 18, 6, 0.5, 0.14, 0.4);
    if (this.hp <= 0) this.die();
    return true;
  }

  private die() {
    this.dead = true;
    this.deadT = 0;
    this.lampState = 'thrown'; // 등불 소등 상태로 고정
    this.sp.active = false;
    this.thrown.visible = false;
    this.thrownLight.visible = false;
    this.host.sfx.death();
    this.onDeath();
  }

  /** 거미줄 등으로 이동 속도를 줄인다 (대시로 해제) */
  slow(seconds: number) {
    if (this.dead) return;
    this.slowT = Math.max(this.slowT, seconds);
  }

  /** 밀어내기 (포효 충격파 등). 데미지 없음 */
  push(fromX: number, fromZ: number, strength: number) {
    const kx = this.pos.x - fromX;
    const kz = this.pos.z - fromZ;
    const kl = Math.hypot(kx, kz) || 1;
    this.knock.x += (kx / kl) * strength;
    this.knock.z += (kz / kl) * strength;
  }

  private updateDead(dt: number) {
    this.deadT += dt;
    const k = clamp01(this.deadT / 0.6);
    this.body.rotation.z = k * 1.45;
    this.body.position.y = 0.02 + (1 - k) * 0.05;
    this.vel.multiplyScalar(Math.max(0, 1 - 10 * dt));
    this.pos.addScaledVector(this.vel, dt);
  }

  respawn() {
    this.dead = false;
    this.hp = CFG.player.maxHp;
    this.invuln = 1.5;
    this.gauge = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.lampState = 'relighting';
    this.relightT = 0;
    this.lanternScale = 0;
    this.sp.active = false;
    this.pos.set(0, 0, 9);
    this.vel.set(0, 0, 0);
    this.knock.set(0, 0, 0);
    this.slowT = 0;
    this.yaw = this.aimYaw = Math.PI;
    this.body.rotation.z = 0;
    this.body.position.y = 0;
    this.cape.reset(this.capeAnchor());
    this.host.sfx.relight();
  }

  /* ───────────── 체력 디버그 ───────────── */
  setHp(v: number) {
    this.hp = Math.max(1, Math.min(CFG.player.maxHp, v));
  }

  /* ───────────── 특수기 게이지 / 투척 ───────────── */
  addCharge(dealt: number) {
    const before = this.gauge;
    this.gauge = Math.min(CFG.special.max, this.gauge + dealt * CFG.special.chargePerDamage);
    if (before < CFG.special.max && this.gauge >= CFG.special.max) this.host.sfx.ready();
  }

  private startSpecial(aim: THREE.Vector3) {
    this.gauge = 0;
    const from = this.bulb.getWorldPosition(new V3());
    let dx = aim.x - this.pos.x;
    let dz = aim.z - this.pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = Math.sin(this.yaw);
      dz = Math.cos(this.yaw);
      d = 1;
    }
    const range = Math.max(CFG.special.minRange, Math.min(CFG.special.maxRange, d));
    this.sp.from.copy(from);
    this.sp.to.set(this.pos.x + (dx / d) * range, 0.2, this.pos.z + (dz / d) * range);
    this.sp.t = 0;
    this.sp.active = true;
    this.lampState = 'thrown';
    this.thrown.visible = true;
    this.thrownLight.visible = true;
    this.host.sfx.special();
  }

  private updateSpecial(dt: number) {
    if (!this.sp.active) return;
    this.sp.t += dt;
    const k = clamp01(this.sp.t / CFG.special.throwTime);
    this.thrown.position.lerpVectors(this.sp.from, this.sp.to, k);
    this.thrown.position.y += Math.sin(k * Math.PI) * 3;
    this.thrown.rotation.y += dt * 12;
    if (k >= 1) this.landSpecial();
  }

  private landSpecial() {
    this.sp.active = false;
    this.thrown.visible = false;
    this.thrownLight.visible = false;
    const to = this.sp.to;
    const R = CFG.special.radius;
    const fx = this.host.fx;
    fx.ring(to.x, to.z, R, 0.5, PAL.gold);
    fx.ring(to.x, to.z, R * 0.6, 0.35, 0xfff3d6, 0.09);
    fx.particles.burst(this.tmpA.set(to.x, 0.4, to.z), PAL.lantern, 70, 13, 0.9, 0.2, 0.7);
    fx.burstLight(this.tmpA.set(to.x, 2.5, to.z), PAL.glow, 70, 0.6);
    this.host.shake(1.0);
    this.host.hitStop(0.09);
    this.host.sfx.explosion(true);
    for (const t of this.host.targets) if (t.alive) t.hitRadial(to, R, CFG.special.damage);
    this.lampState = 'relighting';
    this.relightT = 0;
  }

  /* ───────────── 등불 (체력 = 밝기) ───────────── */
  private updateLantern(dt: number) {
    const lvl = Math.min(4, Math.max(0, this.hp - 1));
    const tI = this.dead ? 0 : CFG.lantern.intensityByHp[lvl];
    const tD = CFG.lantern.distanceByHp[lvl];
    const s = 1 - Math.exp(-6 * dt);
    this.lampI += (tI - this.lampI) * s;
    this.lampD += (tD - this.lampD) * s;

    if (this.lampState === 'on') this.lanternScale = 1;
    else if (this.lampState === 'thrown') this.lanternScale = 0;
    else {
      this.relightT += dt;
      this.lanternScale = clamp01((this.relightT - CFG.special.relightDelay) / CFG.special.relightTime);
      if (this.relightT - dt < CFG.special.relightDelay && this.relightT >= CFG.special.relightDelay) this.host.sfx.relight();
      if (this.lanternScale >= 1) this.lampState = 'on';
    }

    const flick = this.invuln > 0 && !this.dead ? 0.55 + 0.45 * Math.sin(this.t * 50) : 1;
    this.light.intensity = (this.lampI * flick + this.flash * 9) * this.lanternScale;
    this.light.distance = this.lampD;
    const k = (0.35 + 1.5 * (this.lampI / CFG.lantern.intensityByHp[4])) * this.lanternScale * (0.5 + 0.5 * flick);
    this.bulbMat.color.setRGB(1.0 * k, 0.74 * k, 0.32 * k);
    this.bulb.visible = this.lanternScale > 0.02;
  }

  /* ───────────── 망토 ───────────── */
  private capeAnchor() {
    return this.tmpA.set(this.pos.x - Math.sin(this.yaw) * 0.22, 1.15 + this.body.position.y, this.pos.z - Math.cos(this.yaw) * 0.22);
  }

  private updateCape(dt: number) {
    if (this.dead) {
      this.cape.update(this.capeAnchor().setY(0.35), dt, 10, 0, this.t);
    } else {
      this.cape.update(this.capeAnchor(), dt, 6, 0.25, this.t);
    }
    const pos = this.capeGeo.getAttribute('position') as THREE.BufferAttribute;
    const n = this.cape.count;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    for (let i = 0; i < n; i++) {
      const p = this.cape.pts[i];
      const w = (0.64 - 0.36 * (i / (n - 1))) * 0.5;
      const y = Math.max(0.06, p.y);
      pos.setXYZ(i * 2, p.x - rx * w, y, p.z - rz * w);
      pos.setXYZ(i * 2 + 1, p.x + rx * w, y, p.z + rz * w);
    }
    pos.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
  }

  /* ───────────── 대시 잔상 ───────────── */
  private spawnGhost() {
    const g = this.ghosts.find((x) => x.life <= 0);
    if (!g) return;
    g.life = GHOST_LIFE;
    g.g.visible = true;
    g.g.position.set(this.pos.x, 0, this.pos.z);
    g.g.rotation.y = this.yaw;
  }

  private updateGhosts(dt: number) {
    for (const g of this.ghosts) {
      if (g.life <= 0) continue;
      g.life -= dt;
      if (g.life <= 0) {
        g.g.visible = false;
        continue;
      }
      const k = g.life / GHOST_LIFE;
      for (const m of g.mats) m.opacity = k * 0.45;
      g.g.scale.setScalar(0.85 + 0.15 * k);
    }
  }

  private syncTransform() {
    this.root.position.copy(this.pos);
    this.body.rotation.y = this.yaw;
  }
}
