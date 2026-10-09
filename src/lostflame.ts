import * as THREE from 'three';
import type { Host } from './types';

const V3 = THREE.Vector3;

/**
 * 피격 연출: 체력(불꽃)이 플레이어 몸에서 빠져나와 위로 날아가며 사그라든다.
 * 체력 칸 하나당 불꽃 하나.
 */
interface Wisp {
  g: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  active: boolean;
  vx: number;
  vz: number;
  sway: number;
  trail: number;
}

const bodyGeo = new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.15, 1);
const tipGeo = new THREE.ConeGeometry(0.2, 0.62, 10).translate(0, 0.42, 0);

export class LostFlames {
  private pool: Wisp[] = [];
  private tmp = new V3();

  constructor(private host: Host) {
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      mat.color.multiplyScalar(1.6);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, mat), new THREE.Mesh(tipGeo, mat));
      g.visible = false;
      host.scene.add(g);
      this.pool.push({ g, mat, t: 0, life: 1, active: false, vx: 0, vz: 0, sway: 0, trail: 0 });
    }
  }

  /** (x, z): 플레이어 위치. n: 빠져나가는 불꽃 수 */
  spawn(x: number, z: number, n = 1) {
    for (let k = 0; k < n; k++) {
      const w = this.pool.find((p) => !p.active);
      if (!w) return;
      const a = Math.random() * Math.PI * 2;
      w.active = true;
      w.t = 0;
      w.life = 1.15 + Math.random() * 0.2;
      w.vx = Math.cos(a) * 1.6;
      w.vz = Math.sin(a) * 1.6;
      w.sway = Math.random() * 6;
      w.trail = 0;
      w.g.position.set(x, 1.0, z);
      w.g.scale.setScalar(0.2);
      w.g.visible = true;
    }
    this.host.fx.particles.burst(this.tmp.set(x, 1.1, z), 0xffb040, 16, 4.5, 0.7, 0.13, 1.4, -2, 2.6);
    this.host.fx.burstLight(this.tmp.set(x, 1.4, z), 0xff8a30, 70, 0.35);
  }

  update(dt: number) {
    for (const w of this.pool) {
      if (!w.active) continue;
      w.t += dt;
      const k = w.t / w.life;
      if (k >= 1) {
        w.active = false;
        w.g.visible = false;
        continue;
      }
      // 처음엔 튕기듯 바깥으로, 이어서 위로 떠오르며 흔들린다
      const out = Math.exp(-w.t * 4);
      w.g.position.x += w.vx * out * dt + Math.sin(w.t * 7 + w.sway) * 0.4 * dt;
      w.g.position.z += w.vz * out * dt + Math.cos(w.t * 6 + w.sway) * 0.4 * dt;
      w.g.position.y += (1.2 + 3.2 * k) * dt;
      const grow = Math.min(1, w.t / 0.12);
      const fade = 1 - Math.pow(k, 2.2);
      const flick = 1 + Math.sin(w.t * 30 + w.sway) * 0.12;
      w.g.scale.setScalar((0.2 + 0.9 * grow) * (0.35 + 0.65 * fade) * flick);
      w.mat.opacity = Math.min(1, fade * 1.4);
      w.trail -= dt;
      if (w.trail <= 0) {
        w.trail = 0.045;
        this.host.fx.particles.burst(this.tmp.copy(w.g.position), 0xffa030, 1, 0.8, 0.5, 0.09 * fade + 0.03, 0.2, -1, 2.2);
      }
    }
  }

  dispose() {
    for (const w of this.pool) {
      this.host.scene.remove(w.g);
      w.mat.dispose();
    }
  }
}
