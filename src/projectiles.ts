import * as THREE from 'three';
import { CFG } from './config';
import type { Host } from './types';
import type { Player } from './player';

const V3 = THREE.Vector3;

export type ProjKind = 'orange' | 'web' | 'poison';

const KINDS: Record<ProjKind, { color: number; hdr: number; trail: number; burst: number }> = {
  orange: { color: 0xff5a1f, hdr: 1.25, trail: 0xff7a3c, burst: 0xff9a5a },
  web: { color: 0xfff1d2, hdr: 1.7, trail: 0xe6cf9f, burst: 0xfff6e0 },
  poison: { color: 0xff2e2e, hdr: 1.6, trail: 0xff5a30, burst: 0xff8a5a },
};

export interface SpawnOpts {
  kind?: ProjKind;
  /** 플레이어에게 실제로 피해를 준 순간 호출 (감속 같은 부가 효과용) */
  onHit?: () => void;
}

interface Proj {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  r: number;
  life: number;
  active: boolean;
  kind: ProjKind;
  onHit?: () => void;
}

/** 보스 탄(구체). 모든 보스가 공용으로 쓰는 AimedShot / FanShot / RingBurst의 재료. */
export class Projectiles {
  private pool: Proj[] = [];
  private tmp = new V3();
  private geo = new THREE.SphereGeometry(1, 12, 10);
  private mats: Record<ProjKind, THREE.MeshBasicMaterial>;

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
    this.mats = { orange: mk('orange'), web: mk('web'), poison: mk('poison') };
    for (let i = 0; i < size; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mats.orange);
      mesh.visible = false;
      host.scene.add(mesh);
      this.pool.push({ mesh, vel: new V3(), r: 0.3, life: 0, active: false, kind: 'orange' });
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
    p.vel.set((dirX / l) * speed, 0, (dirZ / l) * speed);
  }

  clear() {
    for (const p of this.pool) {
      p.active = false;
      p.mesh.visible = false;
    }
  }

  dispose() {
    for (const p of this.pool) this.host.scene.remove(p.mesh);
    this.geo.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.pool = [];
  }

  update(dt: number) {
    const lim = CFG.arena.radius + 2;
    const pl = this.player;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;
      const k = KINDS[p.kind];
      let kill = p.life <= 0 || pos.x * pos.x + pos.z * pos.z > lim * lim;
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
      }
    }
  }
}
