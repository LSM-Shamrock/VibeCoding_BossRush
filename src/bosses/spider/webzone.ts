import * as THREE from 'three';
import { CFG } from '../../config';
import type { Host } from '../../types';
import type { Player } from '../../player';

const V3 = THREE.Vector3;
const T = CFG.spider.trap;
const IVORY = 0xf3e6c8;

/** 거미줄 무늬(방사선 + 처진 동심원)를 캔버스로 그린다. 가장자리는 부드럽게 사라진다. */
function webTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const c = S / 2;
  const R = S / 2 - 4;
  // 끈적한 막
  const fill = g.createRadialGradient(c, c, 0, c, c, R);
  fill.addColorStop(0, 'rgba(243,230,200,0.34)');
  fill.addColorStop(0.7, 'rgba(243,230,200,0.2)');
  fill.addColorStop(1, 'rgba(243,230,200,0)');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  // 줄: 12개 방사선(살짝 어긋나게) + 4겹 동심원(안쪽으로 처짐)
  const N = 12;
  const ang = (i: number) => (i / N) * Math.PI * 2 + Math.sin(i * 12.9898) * 0.07;
  g.strokeStyle = 'rgba(255,249,232,0.95)';
  g.lineCap = 'round';
  g.lineWidth = 2.6;
  for (let i = 0; i < N; i++) {
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(ang(i)) * R, c + Math.sin(ang(i)) * R);
    g.stroke();
  }
  g.lineWidth = 2;
  for (const rr of [0.2, 0.4, 0.6, 0.8]) {
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const a0 = ang(i);
      const a1 = i === N - 1 ? ang(0) + Math.PI * 2 : ang(i + 1);
      if (i === 0) g.moveTo(c + Math.cos(a0) * R * rr, c + Math.sin(a0) * R * rr);
      const am = (a0 + a1) / 2; // 두 줄 사이는 안쪽으로 처진다
      g.quadraticCurveTo(c + Math.cos(am) * R * rr * 0.9, c + Math.sin(am) * R * rr * 0.9, c + Math.cos(a1) * R * rr, c + Math.sin(a1) * R * rr);
    }
    g.stroke();
  }
  // 가장자리 페이드
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(c, c, 0, c, c, S / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.7, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = mask;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Glob {
  active: boolean;
  mesh: THREE.Mesh;
  mark: THREE.Group;
  markRing: THREE.Mesh;
  markFill: THREE.Mesh;
  t: number;
  flight: number;
  peak: number;
  radius: number;
  life: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

interface Zone {
  active: boolean;
  group: THREE.Group;
  disc: THREE.Mesh;
  t: number;
  life: number;
  x: number;
  z: number;
  r: number;
  spin: number;
}

/**
 * 거미줄 장판. 거미줄 덩어리가 포물선으로 날아가 착지 지점에 끈끈한 장판을 남긴다.
 *  - 날아가는 동안 착지 지점에 상아색 고리가 줄어들며 표시된다 (데미지는 없음)
 *  - 장판 위에 서 있으면 계속 감속 (대시 중에는 영향 없음, 대시로 빠져나오면 된다)
 *  - 일정 시간 뒤 사라진다. 동시에 maxZones 개까지, 넘치면 가장 오래된 것부터 걷힌다.
 */
export class WebZones {
  private globs: Glob[] = [];
  private zones: Zone[] = [];
  private tex = webTexture();
  private tmp = new V3();
  private globGeo = new THREE.SphereGeometry(1, 12, 9);
  private globMat = new THREE.MeshBasicMaterial({ color: IVORY, toneMapped: false });
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2);

  constructor(
    private host: Host,
    private player: Player,
  ) {
    this.globMat.color.multiplyScalar(1.7);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(this.globGeo, this.globMat);
      mesh.visible = false;
      this.host.scene.add(mesh);
      const mark = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: IVORY, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      ringMat.color.multiplyScalar(1.4);
      const fillMat = new THREE.MeshBasicMaterial({ color: IVORY, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false });
      const markRing = new THREE.Mesh(this.ringGeo, ringMat);
      const markFill = new THREE.Mesh(this.discGeo, fillMat);
      markRing.position.y = 0.07;
      markFill.position.y = 0.06;
      mark.add(markFill, markRing);
      mark.visible = false;
      this.host.scene.add(mark);
      this.globs.push({ active: false, mesh, mark, markRing, markFill, t: 0, flight: 1, peak: 5, radius: 3, life: 8, from: new V3(), to: new V3() });
    }
    const discMat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    for (let i = 0; i < T.maxZones; i++) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(this.discGeo, discMat.clone());
      disc.position.y = 0.045;
      disc.renderOrder = 1;
      group.add(disc);
      group.visible = false;
      this.host.scene.add(group);
      this.zones.push({ active: false, group, disc, t: 0, life: 8, x: 0, z: 0, r: T.radius, spin: Math.random() * 6 });
    }
  }

  /** from(입) → to(바닥)로 거미줄 덩어리를 던진다 */
  launch(from: THREE.Vector3, to: THREE.Vector3, flight: number, peak: number, radius: number, life: number) {
    const g = this.globs.find((q) => !q.active);
    if (!g) return;
    g.active = true;
    g.t = 0;
    g.flight = flight;
    g.peak = peak;
    g.radius = radius;
    g.life = life;
    g.from.copy(from);
    g.to.set(to.x, 0, to.z);
    g.mesh.visible = true;
    g.mesh.position.copy(from);
    g.mesh.scale.setScalar(0.5);
    g.mark.visible = true;
    g.mark.position.set(to.x, 0, to.z);
  }

  private land(g: Glob) {
    g.active = false;
    g.mesh.visible = false;
    g.mark.visible = false;
    const { x, z } = g.to;
    // 빈 자리 → 없으면 남은 시간이 가장 적은 장판을 재활용
    let zn = this.zones.find((q) => !q.active);
    if (!zn) zn = this.zones.reduce((a, b) => (a.life - a.t < b.life - b.t ? a : b));
    zn.active = true;
    zn.t = 0;
    zn.life = g.life;
    zn.x = x;
    zn.z = z;
    zn.r = g.radius;
    zn.group.visible = true;
    zn.group.position.set(x, 0, z);
    zn.spin = Math.random() * Math.PI * 2;
    zn.disc.rotation.y = zn.spin;
    const fx = this.host.fx;
    fx.ring(x, z, g.radius * 1.15, 0.35, IVORY, 0.09);
    fx.particles.burst(this.tmp.set(x, 0.3, z), IVORY, 22, 6.5, 0.55, 0.12, 0.5, 6, 1.5);
    fx.particles.burst(this.tmp.set(x, 0.2, z), 0xd9c8a0, 10, 3.5, 0.5, 0.16, 0.3, 4, 1.1);
    this.host.sfx.pop();
    this.host.shake(0.12);
  }

  update(dt: number) {
    const pl = this.player;
    // 날아가는 덩어리
    for (const g of this.globs) {
      if (!g.active) continue;
      g.t += dt;
      const k = Math.min(1, g.t / g.flight);
      const p = g.mesh.position;
      p.lerpVectors(g.from, g.to, k);
      p.y = g.from.y * (1 - k) + 0.3 * k + Math.sin(k * Math.PI) * g.peak;
      g.mesh.scale.setScalar(0.5 + 0.12 * Math.sin(g.t * 40));
      if (Math.random() < 0.6) this.host.fx.particles.burst(p, IVORY, 1, 0.6, 0.35, 0.09, 0, 0, 1.4);
      // 착지 지점 표시: 큰 고리가 줄어들며 장판 크기에 맞춰진다
      const s = g.radius * (1 + 0.5 * (1 - k));
      g.markRing.scale.setScalar(s);
      g.markFill.scale.setScalar(g.radius * (0.2 + 0.8 * k));
      (g.markRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * k;
      if (k >= 1) this.land(g);
    }
    // 장판
    for (const z of this.zones) {
      if (!z.active) continue;
      z.t += dt;
      if (z.t >= z.life) {
        z.active = false;
        z.group.visible = false;
        continue;
      }
      const inK = Math.min(1, z.t / 0.22);
      const outK = Math.min(1, (z.life - z.t) / 1.2);
      const k = inK * outK;
      const s = z.r * (0.55 + 0.45 * (1 - Math.pow(1 - inK, 3)));
      z.disc.scale.setScalar(s);
      // 끝이 가까우면 깜빡이며 걷힌다
      const warn = z.life - z.t < 1.6 ? 0.6 + 0.4 * Math.sin(z.t * 18) : 1;
      (z.disc.material as THREE.MeshBasicMaterial).opacity = 0.95 * k * warn;
      // 위에 서 있으면 감속. 대시 중에는 넘어가므로 영향 없음
      if (!pl.dead && pl.dashT <= 0 && k > 0.3) {
        const d = Math.hypot(pl.pos.x - z.x, pl.pos.z - z.z);
        if (d < z.r - 0.1) pl.slow(T.slow, T.slowMul);
      }
    }
  }

  clear() {
    for (const g of this.globs) {
      g.active = false;
      g.mesh.visible = false;
      g.mark.visible = false;
    }
    for (const z of this.zones) {
      z.active = false;
      z.group.visible = false;
    }
  }

  dispose() {
    this.clear();
    for (const g of this.globs) {
      this.host.scene.remove(g.mesh, g.mark);
      (g.markRing.material as THREE.Material).dispose();
      (g.markFill.material as THREE.Material).dispose();
    }
    for (const z of this.zones) {
      this.host.scene.remove(z.group);
      (z.disc.material as THREE.Material).dispose();
    }
    this.globGeo.dispose();
    this.globMat.dispose();
    this.discGeo.dispose();
    this.ringGeo.dispose();
    this.tex.dispose();
  }
}
