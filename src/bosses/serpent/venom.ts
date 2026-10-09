import * as THREE from 'three';
import { CFG } from '../../config';
import type { Host } from '../../types';
import type { Player } from '../../player';

const V3 = THREE.Vector3;
const P = CFG.serpent.spit;
/** 독: 어두운 적자색 바탕 + 밝은 분홍빛 테두리 (보라색) */
const VENOM = 0x4a16b4;
const VENOM_HOT = 0x7a3ee0;

/** 독 웅덩이 무늬: 어두운 바탕, 터지는 거품, 밝은 테두리. 가장자리는 부드럽게 사라진다. */
function poolTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const c = S / 2;
  const R = S / 2 - 6;
  const fill = g.createRadialGradient(c, c, 0, c, c, R);
  fill.addColorStop(0, 'rgba(18,4,52,0.92)');
  fill.addColorStop(0.75, 'rgba(34,8,84,0.85)');
  fill.addColorStop(1, 'rgba(56,16,118,0.8)');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  // 거품
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineWidth = 2.5;
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * R * 0.82;
    const r = 5 + rnd() * 15;
    g.strokeStyle = `rgba(${100 + Math.floor(rnd() * 40)},${60 + Math.floor(rnd() * 30)},220,${0.35 + rnd() * 0.35})`;
    g.beginPath();
    g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r, 0, Math.PI * 2);
    g.stroke();
  }
  // 테두리
  g.strokeStyle = 'rgba(110,60,210,0.98)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(c, c, R - 3, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(170,130,240,0.8)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c, c, R - 8, 0, Math.PI * 2);
  g.stroke();
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

interface Pool {
  active: boolean;
  group: THREE.Group;
  disc: THREE.Mesh;
  t: number;
  life: number;
  x: number;
  z: number;
  r: number;
}

/**
 * 독 웅덩이. 독액 덩어리가 포물선으로 날아가 착지 지점에 웅덩이를 남긴다.
 *  - 날아가는 동안 착지 지점에 붉은 고리가 줄어들며 표시된다 (데미지 없음)
 *  - 웅덩이 위에 서 있으면 tick 초마다 1 피해 (대시 무적 중에는 통과)
 *  - 일정 시간 뒤 사라진다. 동시에 maxPools 개까지, 넘치면 남은 시간이 가장 적은 것부터 걷힌다.
 */
export class VenomPools {
  private globs: Glob[] = [];
  private pools: Pool[] = [];
  private tex = poolTexture();
  private tmp = new V3();
  private cool = 0;
  private globGeo = new THREE.SphereGeometry(1, 12, 9);
  private globMat = new THREE.MeshBasicMaterial({ color: VENOM, toneMapped: false });
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private ringGeo = new THREE.RingGeometry(0.9, 1, 56).rotateX(-Math.PI / 2);

  constructor(
    private host: Host,
    private player: Player,
  ) {
    this.globMat.color.multiplyScalar(1.15);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(this.globGeo, this.globMat);
      mesh.visible = false;
      this.host.scene.add(mesh);
      const mark = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      ringMat.color.multiplyScalar(1.3);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0xe01212, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
      const markRing = new THREE.Mesh(this.ringGeo, ringMat);
      const markFill = new THREE.Mesh(this.discGeo, fillMat);
      markRing.position.y = 0.07;
      markFill.position.y = 0.06;
      mark.add(markFill, markRing);
      mark.visible = false;
      this.host.scene.add(mark);
      this.globs.push({ active: false, mesh, mark, markRing, markFill, t: 0, flight: 1, peak: 5, radius: 2.5, life: 8, from: new V3(), to: new V3() });
    }
    const discMat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    for (let i = 0; i < P.maxPools; i++) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(this.discGeo, discMat.clone());
      disc.position.y = 0.045;
      disc.renderOrder = 1;
      group.add(disc);
      group.visible = false;
      this.host.scene.add(group);
      this.pools.push({ active: false, group, disc, t: 0, life: 8, x: 0, z: 0, r: P.radius });
    }
    discMat.dispose();
  }

  /** from(입) → to(바닥)로 독액 덩어리를 던진다 */
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
    let pl = this.pools.find((q) => !q.active);
    if (!pl) pl = this.pools.reduce((a, b) => (a.life - a.t < b.life - b.t ? a : b));
    pl.active = true;
    pl.t = 0;
    pl.life = g.life;
    pl.x = x;
    pl.z = z;
    pl.r = g.radius;
    pl.group.visible = true;
    pl.group.position.set(x, 0, z);
    pl.disc.rotation.y = Math.random() * Math.PI * 2;
    const fx = this.host.fx;
    fx.ring(x, z, g.radius * 1.15, 0.35, VENOM_HOT, 0.09);
    fx.particles.burst(this.tmp.set(x, 0.3, z), VENOM, 22, 6.5, 0.55, 0.13, 0.5, 6, 1.6);
    fx.particles.burst(this.tmp.set(x, 0.2, z), 0x3a0f90, 10, 3.5, 0.5, 0.16, 0.3, 4, 1.2);
    this.host.sfx.pop();
    this.host.shake(0.14);
  }

  update(dt: number) {
    const pl = this.player;
    this.cool -= dt;
    for (const g of this.globs) {
      if (!g.active) continue;
      g.t += dt;
      const k = Math.min(1, g.t / g.flight);
      const p = g.mesh.position;
      p.lerpVectors(g.from, g.to, k);
      p.y = g.from.y * (1 - k) + 0.3 * k + Math.sin(k * Math.PI) * g.peak;
      g.mesh.scale.setScalar(0.55 + 0.12 * Math.sin(g.t * 40));
      if (Math.random() < 0.6) this.host.fx.particles.burst(p, VENOM, 1, 0.6, 0.35, 0.09, 0, 0, 1.4);
      const s = g.radius * (1 + 0.5 * (1 - k));
      g.markRing.scale.setScalar(s);
      g.markFill.scale.setScalar(g.radius * (0.2 + 0.8 * k));
      (g.markRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * k;
      if (k >= 1) this.land(g);
    }
    for (const z of this.pools) {
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
      z.disc.scale.setScalar(z.r * (0.55 + 0.45 * (1 - Math.pow(1 - inK, 3))));
      z.disc.rotation.y += dt * 0.25;
      const warn = z.life - z.t < 1.6 ? 0.6 + 0.4 * Math.sin(z.t * 18) : 1;
      (z.disc.material as THREE.MeshBasicMaterial).opacity = 0.95 * k * warn;
      if (Math.random() < dt * 5 * (z.r / 2.5)) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * z.r * 0.85;
        this.host.fx.particles.burst(this.tmp.set(z.x + Math.cos(a) * d, 0.1, z.z + Math.sin(a) * d), VENOM, 2, 1.6, 0.55, 0.09, 0.7, 2, 1.5);
      }
      // 위에 서 있으면 아프다 (대시 무적 중에는 통과: takeDamage 가 false 면 다음 프레임에 다시 본다)
      if (!pl.dead && this.cool <= 0 && k > 0.3) {
        const d = Math.hypot(pl.pos.x - z.x, pl.pos.z - z.z);
        if (d < z.r - 0.05 && pl.takeDamage(z.x, z.z)) this.cool = P.tick;
      }
    }
  }

  clear() {
    for (const g of this.globs) {
      g.active = false;
      g.mesh.visible = false;
      g.mark.visible = false;
    }
    for (const z of this.pools) {
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
    for (const z of this.pools) {
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

/* ───────────────────────── 충격파 ───────────────────────── */
const WAVE_VS = `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const WAVE_FS = `
uniform float uR;
uniform float uW;
uniform float uA;
varying vec2 vP;
void main() {
  float d = length(vP);
  float body = smoothstep(uR - uW, uR - uW * 0.15, d) * (1.0 - smoothstep(uR - 0.02, uR + 0.14, d));
  if (body < 0.01) discard;
  float lead = smoothstep(uR - uW * 0.4, uR, d);
  vec3 col = mix(vec3(0.28, 0.05, 0.95), vec3(0.8, 0.4, 1.7), lead);
  gl_FragColor = vec4(col, body * uA);
}`;

interface Wave {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  wall: THREE.Mesh;
  wallMat: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  r: number;
  speed: number;
  maxR: number;
  width: number;
  hit: boolean;
  delay: number;
}

/**
 * 충격파 고리: 한 점에서 바깥으로 퍼지는 띠. 닿으면 1 피해 (대시 무적으로 통과 가능).
 * 띠의 두께는 항상 width 이고, 보이는 모양과 판정이 같다.
 */
export class Shockwaves {
  private waves: Wave[] = [];
  private wallGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);

  constructor(
    private host: Host,
    private player: Player,
  ) {
    const size = (CFG.serpent.slam.waveMax + 2) * 2;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: WAVE_VS,
        fragmentShader: WAVE_FS,
        uniforms: { uR: { value: 0 }, uW: { value: 1 }, uA: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.09;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.host.scene.add(mesh);
      const wallMat = new THREE.MeshBasicMaterial({ color: 0x5a24c8, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const wall = new THREE.Mesh(this.wallGeo, wallMat);
      wall.visible = false;
      this.host.scene.add(wall);
      this.waves.push({ active: false, mesh, mat, wall, wallMat, x: 0, z: 0, r: 0, speed: 9, maxR: 15, width: 1.1, hit: false, delay: 0 });
    }
  }

  spawn(x: number, z: number, r0: number, speed: number, maxR: number, width: number, delay = 0) {
    const w = this.waves.find((q) => !q.active) ?? this.waves[0];
    w.active = true;
    w.x = x;
    w.z = z;
    w.r = r0;
    w.speed = speed;
    w.maxR = maxR;
    w.width = width;
    w.hit = false;
    w.delay = delay;
    w.mesh.visible = true;
    w.mesh.position.set(x, 0.09, z);
    w.wall.visible = true;
    w.wall.position.set(x, 0, z);
    this.host.sfx.land();
  }

  update(dt: number) {
    const pl = this.player;
    for (const w of this.waves) {
      if (!w.active) continue;
      const prev = w.r;
      if (w.delay > 0) w.delay -= dt;
      else w.r += w.speed * dt;
      const fade = 1 - Math.min(1, Math.max(0, (w.r - w.maxR * 0.65) / (w.maxR * 0.35)));
      if (w.r >= w.maxR) {
        w.active = false;
        w.mesh.visible = false;
        w.wall.visible = false;
        continue;
      }
      w.mat.uniforms.uR.value = w.r;
      w.mat.uniforms.uW.value = w.width;
      w.mat.uniforms.uA.value = fade;
      w.wall.scale.set(w.r, 0.75, w.r);
      w.wallMat.opacity = 0.32 * fade;
      // 지난 프레임부터 이번 프레임까지 띠가 훑고 지나간 구간에 플레이어가 있으면 피격
      if (!w.hit && !pl.dead) {
        const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
        const lo = prev - w.width;
        if (d + pl.hitRadius >= lo && d - pl.hitRadius <= w.r + 0.1) {
          if (pl.takeDamage(w.x, w.z)) w.hit = true;
        }
      }
    }
  }

  clear() {
    for (const w of this.waves) {
      w.active = false;
      w.mesh.visible = false;
      w.wall.visible = false;
    }
  }

  dispose() {
    this.clear();
    const geo = this.waves[0].mesh.geometry;
    for (const w of this.waves) {
      this.host.scene.remove(w.mesh, w.wall);
      w.mat.dispose();
      w.wallMat.dispose();
    }
    geo.dispose();
    this.wallGeo.dispose();
  }
}

/* ───────────────────────── 솟는 가시 (잠행 공격) ───────────────────────── */
interface Spike {
  mesh: THREE.Mesh;
  active: boolean;
  t: number;
  delay: number;
  h: number;
  w: number;
  hold: number;
}

/** 땅에서 솟았다 가라앉는 뼈 가시들. 판정은 호출하는 쪽(공격 스크립트)이 하고, 여기는 모양만 맡는다. */
export class Spikes {
  private pool: Spike[] = [];
  private geo = new THREE.ConeGeometry(0.62, 1, 7).translate(0, 0.5, 0);
  private mat = new THREE.MeshStandardMaterial({ color: 0xd8caa6, emissive: 0x2a2210, roughness: 0.7, flatShading: true });

  constructor(private host: Host) {
    for (let i = 0; i < 54; i++) {
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.host.scene.add(mesh);
      this.pool.push({ mesh, active: false, t: 0, delay: 0, h: 1, w: 1, hold: 0.3 });
    }
  }

  /** (x,z) 중심으로 반경 radius 안에 가시 한 무리를 솟게 한다 */
  erupt(x: number, z: number, radius: number) {
    const add = (px: number, pz: number, w: number, h: number, delay: number) => {
      const s = this.pool.find((q) => !q.active);
      if (!s) return;
      s.active = true;
      s.t = -delay;
      s.delay = delay;
      s.w = w;
      s.h = h;
      s.hold = 0.28 + Math.random() * 0.1;
      s.mesh.position.set(px, -h, pz);
      s.mesh.scale.set(w, h, w);
      s.mesh.rotation.set((Math.random() - 0.5) * 0.25, Math.random() * 6, (Math.random() - 0.5) * 0.25);
      s.mesh.visible = false;
    };
    add(x, z, radius * 0.5, radius * 1.7, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
      const d = radius * (0.5 + Math.random() * 0.12);
      add(x + Math.cos(a) * d, z + Math.sin(a) * d, radius * 0.26, radius * 1.0, 0.03 + Math.random() * 0.06);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      const d = radius * (0.85 + Math.random() * 0.12);
      add(x + Math.cos(a) * d, z + Math.sin(a) * d, radius * 0.17, radius * 0.6, 0.05 + Math.random() * 0.08);
    }
    const f = this.host.fx;
    f.ring(x, z, radius * 1.15, 0.4, 0xffb89a, 0.09);
    f.particles.burst(new V3(x, 0.3, z), 0xb8a58a, 26, 7, 0.6, 0.18, 0.6, 8, 1.4);
    f.burstLight(new V3(x, 1.5, z), 0xffa060, 70, 0.35);
    this.host.shake(0.55);
    this.host.sfx.land();
  }

  update(dt: number) {
    for (const s of this.pool) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t < 0) continue;
      s.mesh.visible = true;
      const rise = 0.1;
      const sink = 0.3;
      let k: number;
      if (s.t < rise) k = 1 - Math.pow(1 - s.t / rise, 3);
      else if (s.t < rise + s.hold) k = 1;
      else k = 1 - Math.min(1, (s.t - rise - s.hold) / sink);
      s.mesh.position.y = -s.h * (1 - k);
      if (s.t >= rise + s.hold + sink) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  clear() {
    for (const s of this.pool) {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  dispose() {
    this.clear();
    for (const s of this.pool) this.host.scene.remove(s.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
