import * as THREE from 'three';
import { CFG } from './config';
import { DIFF } from './difficulty';
import type { Player } from './player';
import type { Host } from './types';

const V3 = THREE.Vector3;
const H = CFG.heal;

interface Item {
  g: THREE.Group;
  halo: THREE.Mesh;
  ring: THREE.Mesh;
  active: boolean;
  t: number;
  x: number;
  z: number;
  spin: number;
}

const bodyGeo = new THREE.SphereGeometry(0.34, 12, 10).scale(1, 1.15, 1);
const tipGeo = new THREE.ConeGeometry(0.34, 1.05, 12).translate(0, 0.7, 0);
const haloGeo = new THREE.SphereGeometry(0.95, 14, 10);
const ringGeo = new THREE.RingGeometry(0.95, 1.2, 40).rotateX(-Math.PI / 2);

/**
 * 체력 회복 불꽃: 용의 불꽃 공격이 땅에 불을 남기는 자리에 가끔 떨어진다. 먹으면 체력 1칸 회복.
 * 운에 너무 기대지 않도록 보정을 둔다 —
 *  · 판정은 gate 초에 한 번만 (불꽃이 한꺼번에 여러 군데 생겨도 한 번으로 친다)
 *  · 확률 = base + inc × (연속으로 못 받은 횟수), guarantee 번 못 받으면 반드시 떨어진다
 *  · 체력이 가득 차 있으면 굴리지도 쌓지도 않는다 / 이미 떠 있거나 방금 떨어졌으면 건너뛴다(횟수 쌓이지 않음)
 */
export class HealFlames {
  private items: Item[] = [];
  private clock = 0;
  private lastTry = -99;
  private lastDrop = -99;
  private misses = 0;
  private tmp = new V3();

  constructor(
    private host: Host,
    private player: Player,
  ) {
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, toneMapped: false });
    coreMat.color.multiplyScalar(1.8);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, toneMapped: false, transparent: true, opacity: 0.95 });
    flameMat.color.multiplyScalar(1.6);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd66a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.mats = [coreMat, flameMat, haloMat, ringMat];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, coreMat);
      const tip = new THREE.Mesh(tipGeo, flameMat);
      const halo = new THREE.Mesh(haloGeo, haloMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      g.add(body, tip, halo);
      g.visible = false;
      ring.visible = false;
      host.scene.add(g, ring);
      this.items.push({ g, halo, ring, active: false, t: 0, x: 0, z: 0, spin: Math.random() * 6 });
    }
  }
  private mats: THREE.Material[];

  /** 불꽃 공격이 (x,z) 에 불을 남겼다 → 가끔 회복 불꽃이 같은 자리에 떨어진다 */
  tryDrop(x: number, z: number) {
    const pl = this.player;
    if (pl.dead || pl.hp >= DIFF.hp) return;
    if (this.clock - this.lastTry < H.gate) return;
    this.lastTry = this.clock;
    if (this.items.filter((i) => i.active).length >= H.maxActive || this.clock - this.lastDrop < H.minGap) return;
    const lowK = 1 - (pl.hp - 1) / Math.max(1, DIFF.hp - 1 || 1); // 체력이 낮을수록 1 에 가깝다 (1칸 = 1)
    const p = this.misses >= H.guarantee ? 1 : Math.min(0.9, (H.base + H.inc * this.misses) * (1 + H.low * lowK));
    if (Math.random() >= p) {
      this.misses++;
      return;
    }
    const it = this.items.find((i) => !i.active);
    if (!it) return;
    this.misses = 0;
    this.lastDrop = this.clock;
    it.active = true;
    it.t = 0;
    it.x = x;
    it.z = z;
    it.g.visible = true;
    it.ring.visible = true;
    it.ring.position.set(x, 0.06, z);
    this.host.fx.ring(x, z, 5, 0.5, 0xffd66a);
    this.host.fx.particles.burst(this.tmp.set(x, 1, z), 0xffd66a, 18, 5, 0.6, 0.16, 0.5, 0, 2.4);
    this.host.sfx.ready();
  }

  update(dt: number) {
    this.clock += dt;
    const pl = this.player;
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      const left = H.life - it.t;
      if (left <= 0) {
        this.hide(it);
        continue;
      }
      const grow = Math.min(1, it.t / 0.35);
      const blink = left < 3 ? (Math.sin(it.t * 18) > 0 ? 1 : 0.25) : 1;
      it.g.position.set(it.x, 1.25 + Math.sin(it.t * 3 + it.spin) * 0.18, it.z);
      it.g.rotation.y += dt * 2.2;
      it.g.scale.setScalar((0.2 + 0.8 * grow) * (1 + Math.sin(it.t * 11) * 0.06) * blink);
      it.halo.scale.setScalar(1 + Math.sin(it.t * 5) * 0.12);
      it.ring.scale.setScalar(1 + 0.18 * Math.sin(it.t * 4));
      if (Math.random() < dt * 8) this.host.fx.particles.burst(this.tmp.set(it.x + (Math.random() - 0.5) * 0.6, 1.5, it.z + (Math.random() - 0.5) * 0.6), 0xffd25a, 1, 0.8, 0.6, 0.1, 0.1, -1, 2.4);
      if (!pl.dead && pl.hp < DIFF.hp && Math.hypot(pl.pos.x - it.x, pl.pos.z - it.z) < H.pickup && Math.abs(pl.pos.y - 0.6) < 2.5) {
        pl.heal(1);
        this.host.sfx.relight();
        this.host.floatText(this.tmp.set(pl.pos.x, 2.2, pl.pos.z), '+1', 'exposed');
        this.host.fx.particles.burst(this.tmp.set(pl.pos.x, 1.1, pl.pos.z), 0xffd66a, 26, 6, 0.8, 0.16, 0.8, -1, 2.4);
        this.host.fx.burstLight(this.tmp.set(pl.pos.x, 1.4, pl.pos.z), 0xffb040, 90, 0.4);
        this.hide(it);
      }
    }
  }

  private hide(it: Item) {
    it.active = false;
    it.g.visible = false;
    it.ring.visible = false;
  }

  dispose() {
    for (const it of this.items) this.host.scene.remove(it.g, it.ring);
    for (const m of this.mats) m.dispose();
  }
}
