import * as THREE from 'three';
import type { Host } from './types';

const V3 = THREE.Vector3;

/**
 * 보스를 잡으면 맵에 솟아오르는 출구 문. 빛나는 문 안으로 들어가면 클리어.
 * 돌기둥 두 개 + 상인방, 안쪽은 금빛으로 일렁이는 빛의 막.
 */
export class ExitDoor {
  readonly pos = new V3();
  /** 문 안쪽으로 들어갔다고 보는 반경 */
  readonly radius = 1.7;
  private group = new THREE.Group();
  private veil: THREE.Mesh;
  private veilMat: THREE.MeshBasicMaterial;
  private glow: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private light: THREE.PointLight;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private t = 0;

  constructor(
    private host: Host,
    x: number,
    z: number,
    faceX: number,
    faceZ: number,
  ) {
    this.pos.set(x, 0, z);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8576, roughness: 0.85, flatShading: true, emissive: 0x2a2010, emissiveIntensity: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffd27a, roughness: 0.4, metalness: 0.5, emissive: 0xffa640, emissiveIntensity: 0.9 });
    this.mats.push(stone, gold);
    const box = (w: number, h: number, d: number, px: number, py: number, mat: THREE.Material) => {
      const g = new THREE.BoxGeometry(w, h, d);
      this.geos.push(g);
      const m = new THREE.Mesh(g, mat);
      m.position.set(px, py, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const W = 3.4; // 안쪽 폭
    const H = 4.6; // 기둥 높이
    box(0.9, H, 1.0, -(W / 2 + 0.45), H / 2, stone);
    box(0.9, H, 1.0, W / 2 + 0.45, H / 2, stone);
    box(W + 2.2, 0.8, 1.2, 0, H + 0.4, stone);
    box(W + 2.5, 0.16, 1.3, 0, H + 0.85, gold);
    box(1.1, 0.1, 1.1, -(W / 2 + 0.45), H + 0.05, gold);
    box(1.1, 0.1, 1.1, W / 2 + 0.45, H + 0.05, gold);
    // 빛의 막
    const vg = new THREE.PlaneGeometry(W, H);
    this.geos.push(vg);
    this.veilMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(1.6), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.mats.push(this.veilMat);
    this.veil = new THREE.Mesh(vg, this.veilMat);
    this.veil.position.y = H / 2;
    this.group.add(this.veil);
    // 바닥 빛무리
    const gg = new THREE.CircleGeometry(3.6, 32).rotateX(-Math.PI / 2);
    this.geos.push(gg);
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc060).multiplyScalar(1.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mats.push(this.glowMat);
    this.glow = new THREE.Mesh(gg, this.glowMat);
    this.glow.position.y = 0.08;
    this.group.add(this.glow);
    this.light = new THREE.PointLight(0xffc878, 0, 26, 1.4);
    this.light.position.set(0, 2.6, 1.2);
    this.group.add(this.light);

    this.group.position.set(x, 0, z);
    this.group.rotation.y = Math.atan2(faceX - x, faceZ - z); // 문의 앞면(+z)이 아레나 중앙을 향한다
    this.group.scale.set(1, 0.001, 1);
    host.scene.add(this.group);
    host.fx.particles.burst(new V3(x, 0.4, z), 0xffd27a, 50, 8, 1.1, 0.2, 1.4, -2);
    host.fx.burstLight(new V3(x, 2.5, z), 0xffc878, 120, 0.6);
    host.fx.ring(x, z, 6, 0.9, 0xffd27a);
  }

  update(dt: number) {
    this.t += dt;
    const rise = Math.min(1, this.t / 1.2);
    const e = 1 - Math.pow(1 - rise, 3);
    this.group.scale.y = Math.max(0.001, e);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3.2);
    this.veilMat.opacity = e * (0.38 + 0.2 * pulse);
    this.glowMat.opacity = e * (0.3 + 0.12 * pulse);
    this.light.intensity = e * (36 + 10 * pulse);
    if (rise >= 1 && Math.random() < dt * 14) {
      // 빛의 막에서 금빛 입자가 피어오른다
      this.host.fx.particles.burst(new V3(this.pos.x + (Math.random() - 0.5) * 2.2, 0.3, this.pos.z + (Math.random() - 0.5) * 2.2), 0xffd890, 1, 1.0, 1.1, 0.1, 1.5, -1.5, 1.4);
    }
  }

  /** (x,z) 가 문 안쪽에 들어왔는가 (문이 다 솟은 뒤부터) */
  entered(x: number, z: number) {
    return this.t > 1.2 && Math.hypot(x - this.pos.x, z - this.pos.z) < this.radius;
  }

  dispose() {
    this.host.scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
