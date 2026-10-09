import * as THREE from 'three';
import { CFG } from './config';
import type { Host } from './types';
import type { Player } from './player';
import { WORLD } from './world';

const V3 = THREE.Vector3;

export type ProjKind = 'orange' | 'web' | 'poison' | 'venom';

const KINDS: Record<ProjKind, { color: number; hdr: number; trail: number; burst: number }> = {
  orange: { color: 0xff5a1f, hdr: 1.25, trail: 0xff7a3c, burst: 0xff9a5a },
  web: { color: 0xfff1d2, hdr: 1.7, trail: 0xe6cf9f, burst: 0xfff6e0 },
  poison: { color: 0xff2e2e, hdr: 1.6, trail: 0xff5a30, burst: 0xff8a5a },
  venom: { color: 0x4a16b4, hdr: 1.25, trail: 0x3a1090, burst: 0x6a30d0 },
};

export interface SpawnOpts {
  kind?: ProjKind;
  /** 플레이어에게 실제로 피해를 준 순간 호출 (감속 같은 부가 효과용) */
  onHit?: () => void;
  /** 바닥에 빨간 위치 표시(실제 피격 범위)를 깐다. 값은 진하기 배율 (1 = 기본) */
  mark?: number;
}

interface Proj {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  r: number;
  life: number;
  active: boolean;
  kind: ProjKind;
  onHit?: () => void;
  /** 바닥 위치 표시 (필요할 때 처음 한 번만 만든다) */
  mark?: THREE.Group;
  markK: number;
}

/** 보스 탄(구체). 모든 보스가 공용으로 쓰는 AimedShot / FanShot / RingBurst의 재료. */
export class Projectiles {
  private pool: Proj[] = [];
  private tmp = new V3();
  private geo = new THREE.SphereGeometry(1, 12, 10);
  private mats: Record<ProjKind, THREE.MeshBasicMaterial>;
  private markRingGeo = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
  private markDiscGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);

  constructor(
    private host: Host,
    private player: Player,
    size = 100,
  ) {
    const mk = (k: ProjKind) => {
      const m = new THREE.MeshBasicMaterial({ color: KINDS[k].color, toneMapped: false });
      m.color.multiplyScalar(KINDS[k].hdr);
      return m;
    };
    this.mats = { orange: mk('orange'), web: mk('web'), poison: mk('poison'), venom: mk('venom') };
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mats.orange);
      mesh.visible = false;
      host.scene.add(mesh);
      this.pool.push({ mesh, vel: new V3(), r: 0.3, life: 0, active: false, kind: 'orange', markK: 0 });
    }
  }

  spawn(x: number, z: number, dirX: number, dirZ: number, speed: number, radius = 0.3, y = 1.0, opts: SpawnOpts = {}) {
    const p = this.pool.find((a) => !a.active);
    if (!p) return;
    const l = Math.hypot(dirX, dirZ) || 1;
    p.active = true;
    p.life = 6;
    p.r = radius;
    p.kind = opts.kind ?? 'orange';
    p.onHit = opts.onHit;
    p.mesh.material = this.mats[p.kind];
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(radius);
    p.markK = opts.mark ?? 0;
    if (p.markK > 0) {
      if (!p.mark) p.mark = this.makeMark();
      p.mark.visible = true;
      // 실제 맞는 범위(탄 반경 + 플레이어 판정 반경)를 그대로 보여준다
      p.mark.scale.setScalar(radius + this.player.hitRadius);
      p.mark.position.set(x, 0, z);
      p.mark.userData.ring.material.opacity = 0.95 * Math.min(1, p.markK);
      p.mark.userData.fill.material.opacity = 0.3 * Math.min(1, p.markK);
    } else if (p.mark) p.mark.visible = false;
    p.vel.set((dirX / l) * speed, 0, (dirZ / l) * speed);
  }

  private makeMark() {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    ringMat.color.multiplyScalar(1.5);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff1010, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(this.markRingGeo, ringMat);
    const fill = new THREE.Mesh(this.markDiscGeo, fillMat);
    ring.position.y = 0.1;
    fill.position.y = 0.09;
    ring.renderOrder = fill.renderOrder = 5;
    g.add(fill, ring);
    g.userData.ring = ring;
    g.userData.fill = fill;
    this.host.scene.add(g);
    return g;
  }

  clear() {
    for (const p of this.pool) {
      p.active = false;
      p.mesh.visible = false;
      if (p.mark) p.mark.visible = false;
    }
  }

  dispose() {
    for (const p of this.pool) {
      this.host.scene.remove(p.mesh);
      if (p.mark) {
        this.host.scene.remove(p.mark);
        p.mark.userData.ring.material.dispose();
        p.mark.userData.fill.material.dispose();
      }
    }
    this.markRingGeo.dispose();
    this.markDiscGeo.dispose();
    this.geo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.pool = [];
  }

  update(dt: number) {
    const lim = WORLD.radius + 2;
    const pl = this.player;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;
      if (p.mark) p.mark.position.set(pos.x, 0, pos.z);
      const k = KINDS[p.kind];
      // 아레나 밖으로 나가는 탄만 지운다 (맵 바깥 외곽에서 안쪽으로 쏘는 탄은 살린다)
      let kill = p.life <= 0 || (pos.x * pos.x + pos.z * pos.z > lim * lim && pos.x * p.vel.x + pos.z * p.vel.z > 0);
      if (!kill && !pl.dead) {
        const dx = pos.x - pl.pos.x;
        const dz = pos.z - pl.pos.z;
        const rr = p.r + pl.hitRadius;
        if (dx * dx + dz * dz < rr * rr) {
          // 대시 무적/피격 무적 중에는 탄이 몸을 통과한다 (회피 성공)
          if (pl.takeDamage(pos.x - p.vel.x * 0.1, pos.z - p.vel.z * 0.1)) {
            this.host.fx.particles.burst(this.tmp.copy(pos), k.burst, 10, 5, 0.4, 0.12, 0.3);
            p.onHit?.();
            kill = true;
          }
        }
      }
      if (!kill && Math.random() < 0.35) this.host.fx.particles.burst(pos, k.trail, 1, 0.5, 0.3, 0.1, 0, 0, 1.4);
      if (kill) {
        p.active = false;
        p.mesh.visible = false;
        if (p.mark) p.mark.visible = false;
      }
    }
  }
}
