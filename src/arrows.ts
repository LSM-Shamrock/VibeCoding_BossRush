import * as THREE from 'three';
import { CFG } from './config';
import type { Host } from './types';

const V3 = THREE.Vector3;

interface ArrowItem {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  active: boolean;
}

/** 플레이어 마법 화살 풀. 서브스텝으로 이동해서 빠른 화살이 약점을 뚫고 지나가지 않게 한다. */
export class Arrows {
  private pool: ArrowItem[] = [];
  private tmp = new V3();

  constructor(
    private host: Host,
    private onDealt: (dealt: number) => void,
  ) {
    const geo = new THREE.ConeGeometry(0.07, 0.85, 6).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: CFG.lantern.color, toneMapped: false });
    mat.color.multiplyScalar(2.2);
    for (let i = 0; i < CFG.arrow.pool; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      host.scene.add(mesh);
      this.pool.push({ mesh, vel: new V3(), life: 0, active: false });
    }
  }

  spawn(p: THREE.Vector3, dir: THREE.Vector3) {
    const a = this.pool.find((x) => !x.active);
    if (!a) return;
    a.active = true;
    a.life = CFG.arrow.life;
    a.mesh.visible = true;
    a.mesh.position.copy(p);
    a.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    a.vel.copy(dir).multiplyScalar(CFG.arrow.speed);
  }

  update(dt: number) {
    const lim = CFG.arena.radius + 1;
    for (const a of this.pool) {
      if (!a.active) continue;
      a.life -= dt;
      const dist = a.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.3));
      this.tmp.copy(a.vel).multiplyScalar(dt / steps);
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        a.mesh.position.add(this.tmp);
        for (const t of this.host.targets) {
          if (!t.alive) continue;
          const dealt = t.hitArrow(a.mesh.position, CFG.arrow.radius, CFG.arrow.damage);
          if (dealt !== 0) {
            hit = true;
            // BLOCKED(-1): 다리 등에 막힘 → 화살만 사라지고 데미지/게이지는 없음
            if (dealt > 0) this.onDealt(dealt);
            this.host.fx.particles.burst(a.mesh.position, dealt > 0 ? CFG.lantern.color : 0xffd9a0, dealt > 0 ? 7 : 5, 5, 0.3, 0.1, 0.3);
            break;
          }
        }
      }
      const p = a.mesh.position;
      if (hit || a.life <= 0 || p.x * p.x + p.z * p.z > lim * lim) {
        a.active = false;
        a.mesh.visible = false;
        continue;
      }
      if (Math.random() < 0.5) this.host.fx.particles.burst(p, CFG.lantern.color, 1, 0.4, 0.25, 0.07, 0, 0, 1.2);
    }
  }
}
