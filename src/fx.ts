import * as THREE from 'three';
import { CFG } from './config';
import { PAL } from './palette';

const V3 = THREE.Vector3;

/* ───────────────────────── 파티클 (InstancedMesh 큐브) ───────────────────────── */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly max: number;
  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private cursor = 0;
  private colorDirty = false;
  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();

  constructor(scene: THREE.Scene, max: number) {
    this.max = max;
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const white = new THREE.Color(1, 1, 1);
    this.o.scale.setScalar(0);
    this.o.updateMatrix();
    for (let i = 0; i < max; i++) {
      this.pos.push(new V3());
      this.vel.push(new V3());
      this.mesh.setColorAt(i, white);
      this.mesh.setMatrixAt(i, this.o.matrix);
    }
    scene.add(this.mesh);
  }

  burst(p: THREE.Vector3, color: number, count: number, speed: number, life = 0.6, size = 0.14, upBias = 0.4, gravity = 10, hdr = 1.8) {
    this.c.setHex(color).multiplyScalar(hdr);
    for (let n = 0; n < count; n++) {
      const i = this.cursor++ % this.max;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.35 + 0.65 * Math.random());
      this.pos[i].copy(p);
      this.vel[i].set(Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * (0.4 + upBias), Math.sin(ph) * Math.sin(th) * sp);
      this.life[i] = this.maxLife[i] = life * (0.6 + 0.4 * Math.random());
      this.size[i] = size * (0.6 + 0.8 * Math.random());
      this.grav[i] = gravity;
      this.mesh.setColorAt(i, this.c);
    }
    this.colorDirty = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p = this.pos[i];
      const v = this.vel[i];
      if (this.life[i] <= 0) {
        this.o.scale.setScalar(0);
      } else {
        v.y -= this.grav[i] * dt;
        p.addScaledVector(v, dt);
        if (p.y < 0.05) {
          p.y = 0.05;
          v.y *= -0.3;
          v.x *= 0.7;
          v.z *= 0.7;
        }
        this.o.scale.setScalar(this.size[i] * (this.life[i] / this.maxLife[i]));
      }
      this.o.position.copy(p);
      this.o.updateMatrix();
      this.mesh.setMatrixAt(i, this.o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }
}

/* ───────────────────────── 공격 예고 마커 ───────────────────────── */
type TgKind = 'circle' | 'fan' | 'line';

interface Tg {
  group: THREE.Group;
  fill: THREE.Mesh;
  mats: THREE.MeshBasicMaterial[];
  geos: THREE.BufferGeometry[];
  kind: TgKind;
  t: number;
  dur: number;
  onDetonate: () => void;
  detonated: boolean;
  flashT: number;
}

const FLASH = 0.22;

function tgMat(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
}

/**
 * 원 / 부채꼴 / 직선 예고 마커. 흐린 바탕(전체 범위) 위에 진한 면이 안쪽에서 차오르고,
 * 가득 차는 순간 폭발(onDetonate 호출). 보스의 모든 공격 가독성이 이 모듈에 달려 있다.
 */
export class Telegraphs {
  private items: Tg[] = [];
  constructor(private scene: THREE.Scene) {}

  private build(kind: TgKind, area: THREE.BufferGeometry, rim: THREE.BufferGeometry | null, dur: number, onDetonate: () => void) {
    const group = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    const geos: THREE.BufferGeometry[] = [area];

    // 어두운 밑판: 따뜻한 색 바닥 위에서도 붉은 경고색이 떠 보이게 한다
    const shadeM = tgMat(0x120403, 0.42);
    const shade = new THREE.Mesh(area, shadeM);
    shade.renderOrder = 1;
    group.add(shade);
    mats.push(shadeM);
    const baseM = tgMat(PAL.danger, 0.3);
    const base = new THREE.Mesh(area, baseM);
    const fillM = tgMat(PAL.dangerFill, 0.58);
    const fill = new THREE.Mesh(area, fillM);
    base.renderOrder = 2;
    fill.renderOrder = 3;
    fill.scale.set(0, 1, 0);
    group.add(base, fill);
    mats.push(baseM, fillM);

    if (rim) {
      const rimM = tgMat(PAL.dangerRim, 0.95);
      const r = new THREE.Mesh(rim, rimM);
      r.renderOrder = 4;
      group.add(r);
      mats.push(rimM);
      geos.push(rim);
    }
    this.scene.add(group);
    const tg: Tg = { group, fill, mats, geos, kind, t: 0, dur, onDetonate, detonated: false, flashT: 0 };
    this.items.push(tg);
    return tg;
  }

  circle(x: number, z: number, radius: number, dur: number, onDetonate: () => void) {
    const area = new THREE.CircleGeometry(radius, 56).rotateX(-Math.PI / 2);
    const rim = new THREE.RingGeometry(radius - 0.09, radius, 56).rotateX(-Math.PI / 2);
    const tg = this.build('circle', area, rim, dur, onDetonate);
    tg.group.position.set(x, 0.05, z);
  }

  /** angle: 월드 XZ 평면에서의 방향각 (atan2(dz, dx)), half: 반각(rad) */
  fan(x: number, z: number, angle: number, half: number, range: number, dur: number, onDetonate: () => void) {
    const area = new THREE.CircleGeometry(range, 40, -half, half * 2).rotateX(-Math.PI / 2);
    const rim = new THREE.RingGeometry(range - 0.09, range, 40, 1, -half, half * 2).rotateX(-Math.PI / 2);
    const tg = this.build('fan', area, rim, dur, onDetonate);
    tg.group.position.set(x, 0.05, z);
    tg.group.rotation.y = -angle;
  }

  line(x: number, z: number, angle: number, length: number, width: number, dur: number, onDetonate: () => void) {
    const area = new THREE.PlaneGeometry(length, width).translate(length / 2, 0, 0).rotateX(-Math.PI / 2);
    const tg = this.build('line', area, null, dur, onDetonate);
    tg.group.position.set(x, 0.05, z);
    tg.group.rotation.y = -angle;
  }

  clear() {
    for (const it of this.items) this.dispose(it);
    this.items = [];
  }

  private dispose(it: Tg) {
    this.scene.remove(it.group);
    for (const g of it.geos) g.dispose();
    for (const m of it.mats) m.dispose();
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.detonated) {
        it.t += dt;
        const k = Math.min(1, it.t / it.dur);
        if (it.kind === 'line') it.fill.scale.set(k, 1, 1);
        else it.fill.scale.set(k, 1, k);
        // 임박할수록 바탕이 빠르게 깜빡여서 "곧 터진다"를 알려준다
        it.mats[1].opacity = 0.22 + 0.14 * (0.5 + 0.5 * Math.sin(it.t * (6 + 22 * k * k)));
        if (it.t >= it.dur) {
          it.detonated = true;
          it.flashT = FLASH;
          it.fill.scale.set(1, 1, 1);
          for (const m of it.mats) {
            m.color.setRGB(1, 1, 1);
            m.opacity = 1;
          }
          it.onDetonate();
        }
      } else {
        it.flashT -= dt;
        const a = Math.max(0, it.flashT / FLASH);
        for (const m of it.mats) m.opacity = a;
        it.group.scale.setScalar(1 + (1 - a) * 0.1);
        if (it.flashT <= 0) {
          this.dispose(it);
          this.items.splice(i, 1);
        }
      }
    }
  }
}

/* ───────────────────────── 충격파 링 / 순간 조명 ───────────────────────── */
interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
  maxR: number;
}

interface BurstLight {
  light: THREE.PointLight;
  t: number;
  dur: number;
  peak: number;
}

export class Fx {
  readonly particles: Particles;
  readonly telegraphs: Telegraphs;
  private rings: RingFx[] = [];
  private ringGeo = new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2);
  private lights: BurstLight[] = [];

  constructor(private scene: THREE.Scene) {
    this.particles = new Particles(scene, CFG.fx.maxParticles);
    this.telegraphs = new Telegraphs(scene);
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 16, 1.6);
      scene.add(light);
      this.lights.push({ light, t: 0, dur: 1, peak: 0 });
    }
  }

  ring(x: number, z: number, maxR: number, dur: number, color = 0xffffff, y = 0.07) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
    mat.color.multiplyScalar(1.6);
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, t: 0, dur, maxR });
  }

  burstLight(p: THREE.Vector3, color: number, peak: number, dur: number) {
    let slot = this.lights[0];
    for (const l of this.lights) if (l.t <= 0 || l.t / l.dur < slot.t / slot.dur) slot = l;
    slot.light.position.copy(p);
    slot.light.color.setHex(color);
    slot.t = slot.dur = dur;
    slot.peak = peak;
  }

  update(dt: number) {
    this.particles.update(dt);
    this.telegraphs.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const e = 1 - (1 - k) * (1 - k);
      r.mesh.scale.setScalar(Math.max(0.1, r.maxR * e));
      r.mat.opacity = 1 - k;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
      }
    }
    for (const l of this.lights) {
      if (l.t > 0) {
        l.t -= dt;
        const k = Math.max(0, l.t / l.dur);
        l.light.intensity = l.peak * k * k;
      } else {
        l.light.intensity = 0;
      }
    }
  }
}
