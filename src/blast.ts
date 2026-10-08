import * as THREE from 'three';
import { PAL } from './palette';
import type { Host } from './types';

const LIFE = 0.55;
const COUNT = 4;

interface Blast {
  group: THREE.Group;
  core: THREE.Mesh;
  fire: THREE.Mesh;
  dome: THREE.Mesh;
  t: number;
  active: boolean;
  radius: number;
}

/**
 * 완전 차징 불꽃의 폭발 연출: 맞은 자리에서 불덩이가 부풀며 퍼지고 사그라든다.
 * (피해 계산은 arrows.ts 에서 한다. 여기는 눈에 보이는 부분만.)
 */
export class Blasts {
  private items: Blast[] = [];

  constructor(host: Host) {
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const domeGeo = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2); // 바닥에 깔리는 반구
    const mk = (color: number, mul: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      m.color.multiplyScalar(mul);
      return m;
    };
    for (let i = 0; i < COUNT; i++) {
      const group = new THREE.Group();
      const fire = new THREE.Mesh(geo, mk(PAL.flame, 1.1));
      const core = new THREE.Mesh(geo, mk(0xffe8a8, 1.0));
      const dome = new THREE.Mesh(domeGeo, mk(PAL.ember, 1.0));
      group.add(dome, fire, core);
      group.visible = false;
      host.scene.add(group);
      this.items.push({ group, core, fire, dome, t: LIFE, active: false, radius: 1 });
    }
  }

  spawn(x: number, y: number, z: number, radius: number) {
    const b = this.items.find((q) => !q.active) ?? this.items.reduce((a, c) => (a.t > c.t ? a : c));
    b.active = true;
    b.t = 0;
    b.radius = radius;
    b.group.visible = true;
    b.group.position.set(x, Math.max(0.5, Math.min(y, 2.2)), z);
    b.dome.position.y = -b.group.position.y + 0.05; // 반구는 바닥(y≈0)에 붙인다
  }

  update(dt: number) {
    for (const b of this.items) {
      if (!b.active) continue;
      b.t += dt;
      if (b.t >= LIFE) {
        b.active = false;
        b.group.visible = false;
        continue;
      }
      const k = b.t / LIFE;
      const out = 1 - Math.pow(1 - k, 3); // 빠르게 퍼지고 끝에서 느려진다
      const R = b.radius;
      b.fire.scale.setScalar(Math.max(0.01, R * (0.25 + 0.75 * out)));
      (b.fire.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.pow(1 - k, 1.5);
      b.core.scale.setScalar(Math.max(0.01, R * (0.15 + 0.32 * out)));
      (b.core.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.pow(1 - Math.min(1, k * 2.1), 1.5);
      b.dome.scale.set(R * (0.4 + 0.75 * out), R * 0.55 * (0.4 + 0.6 * out), R * (0.4 + 0.75 * out));
      (b.dome.material as THREE.MeshBasicMaterial).opacity = 0.34 * Math.pow(1 - k, 1.7);
    }
  }

  clear() {
    for (const b of this.items) {
      b.active = false;
      b.group.visible = false;
    }
  }
}
