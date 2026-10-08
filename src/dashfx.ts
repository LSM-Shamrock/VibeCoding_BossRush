import * as THREE from 'three';
import { PAL } from './palette';
import type { Host } from './types';

const V3 = THREE.Vector3;
const SAMPLES = 32; // 궤적 샘플 수
const TRAIL_LIFE = 0.42; // 궤적이 사라지기까지(초)
const RINGS = 10;
const RING_LIFE = 0.26;
const STREAKS = 22;
const STREAK_LIFE = 0.2;

interface RibbonSpec {
  y: number; // 궤적 높이
  width: number; // 머리 쪽 반폭
  tint: number;
  gain: number;
}

/** 카메라를 향하는 폭을 가진 띠. 머리(최신)가 굵고 꼬리로 갈수록 가늘어지며, 시간이 지나면 어두워져 사라진다(가산 혼합). */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(SAMPLES * 3 * 3);
  private col = new Float32Array(SAMPLES * 3 * 3);
  private geo = new THREE.BufferGeometry();
  private base = new THREE.Color();
  private a = new V3();
  private b = new V3();
  private t = new V3();
  private v = new V3();

  constructor(
    scene: THREE.Scene,
    private spec: RibbonSpec,
  ) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    // 샘플마다 (왼쪽 가장자리, 중심, 오른쪽 가장자리) 세 점. 가장자리는 검정 = 가산 혼합에서 투명 → 부드러운 테두리
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 3;
      const b = a + 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.base.setHex(spec.tint).multiplyScalar(spec.gain);
    scene.add(this.mesh);
  }

  /** xs/zs/ages: 최신이 0번. count: 유효 샘플 수 */
  build(xs: Float32Array, zs: Float32Array, ages: Float32Array, count: number, cam: THREE.Vector3, hot: number) {
    if (count < 2) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const { y, width } = this.spec;
    for (let i = 0; i < SAMPLES; i++) {
      const j = Math.min(i, count - 1);
      const c = this.a.set(xs[j], y, zs[j]);
      const prev = Math.max(0, j - 1);
      const next = Math.min(count - 1, j + 1);
      this.t.set(xs[prev] - xs[next], 0, zs[prev] - zs[next]);
      this.v.copy(cam).sub(c);
      this.b.crossVectors(this.t, this.v);
      let bl = this.b.length();
      if (bl < 1e-4) {
        this.b.set(0, 1, 0);
        bl = 1;
      }
      this.b.multiplyScalar(1 / bl);
      const fresh = i < count ? Math.max(0, 1 - ages[j] / TRAIL_LIFE) : 0;
      const taper = i < count ? Math.pow(1 - j / count, 0.8) : 0;
      const w = width * taper * (0.35 + 0.65 * fresh);
      const k = i < count ? Math.pow(fresh, 1.4) * (0.35 + 0.65 * taper) * hot : 0;
      const o = i * 9;
      this.pos[o] = c.x + this.b.x * w;
      this.pos[o + 1] = c.y + this.b.y * w;
      this.pos[o + 2] = c.z + this.b.z * w;
      this.pos[o + 3] = c.x;
      this.pos[o + 4] = c.y;
      this.pos[o + 5] = c.z;
      this.pos[o + 6] = c.x - this.b.x * w;
      this.pos[o + 7] = c.y - this.b.y * w;
      this.pos[o + 8] = c.z - this.b.z * w;
      // 가장자리(0, 2번)는 0, 중심(1번)만 밝다
      this.col[o + 3] = this.base.r * k;
      this.col[o + 4] = this.base.g * k;
      this.col[o + 5] = this.base.b * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}

interface RingItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  max: number;
}
interface StreakItem {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  vel: THREE.Vector3;
}

/**
 * 대시 연출:
 *  - 시작: 바닥 충격 고리 + 흙먼지, 화면이 살짝 당겨짐(FOV 펀치)
 *  - 이동 중: 카메라를 향하는 금빛 궤적 띠(가슴/무릎 두 줄), 진행 방향에 수직으로 퍼지는 속도 고리, 뒤로 흐르는 바람 줄,
 *             발밑 흙먼지·불씨
 *  - 끝: 작은 고리
 */
export class DashFx {
  private xs = new Float32Array(SAMPLES);
  private zs = new Float32Array(SAMPLES);
  private ages = new Float32Array(SAMPLES);
  private count = 0;
  private ribbons: Ribbon[];
  private rings: RingItem[] = [];
  private streaks: StreakItem[] = [];
  private ringT = 0;
  private streakT = 0;
  private dust = new V3();
  private tmp = new V3();

  constructor(private host: Host) {
    const s = host.scene;
    this.ribbons = [
      new Ribbon(s, { y: 1.0, width: 0.55, tint: PAL.gold, gain: 1.15 }),
      new Ribbon(s, { y: 0.34, width: 0.8, tint: PAL.flame, gain: 0.95 }),
    ];
    const ringGeo = new THREE.RingGeometry(0.82, 1, 36);
    for (let i = 0; i < RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: PAL.lanternHot, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      mat.color.multiplyScalar(1.05);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      s.add(mesh);
      this.rings.push({ mesh, mat, t: RING_LIFE, max: 1 });
    }
    const streakGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < STREAKS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: PAL.flameHot, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      mat.color.multiplyScalar(1.1);
      const mesh = new THREE.Mesh(streakGeo, mat);
      mesh.visible = false;
      s.add(mesh);
      this.streaks.push({ mesh, mat, t: STREAK_LIFE, vel: new V3() });
    }
  }

  private pushSample(x: number, z: number) {
    for (let i = SAMPLES - 1; i > 0; i--) {
      this.xs[i] = this.xs[i - 1];
      this.zs[i] = this.zs[i - 1];
      this.ages[i] = this.ages[i - 1];
    }
    this.xs[0] = x;
    this.zs[0] = z;
    this.ages[0] = 0;
    this.count = Math.min(SAMPLES, this.count + 1);
  }

  /** 대시를 시작하는 순간 */
  begin(x: number, z: number, dx: number, dz: number) {
    this.count = 0;
    this.pushSample(x, z);
    this.ringT = 0;
    this.streakT = 0;
    const fx = this.host.fx;
    fx.ring(x, z, 2.6, 0.34, PAL.dust, 0.07);
    fx.ring(x, z, 1.5, 0.22, PAL.gold, 0.09);
    // 출발 반대쪽으로 흙먼지가 터진다
    this.dust.set(x - dx * 0.4, 0.15, z - dz * 0.4);
    fx.particles.burst(this.dust, 0xd9b87c, 14, 4.5, 0.5, 0.2, 0.25, 8, 1.2);
    fx.particles.burst(this.dust, PAL.flameHot, 8, 5, 0.4, 0.1, 0.3, 6, 1.8);
    this.host.punch(7);
  }

  /** 대시 이동 중 매 프레임 */
  step(dt: number, x: number, z: number, dx: number, dz: number) {
    this.pushSample(x, z);
    // 속도 고리: 진행 방향에 수직으로, 앞에서 뒤로 남는다
    this.ringT -= dt;
    if (this.ringT <= 0) {
      this.ringT = 0.034;
      const r = this.rings.find((q) => q.t >= RING_LIFE);
      if (r) {
        r.t = 0;
        r.max = 1.25 + Math.random() * 0.35;
        r.mesh.visible = true;
        r.mesh.position.set(x, 0.95, z);
        r.mesh.lookAt(x + dx, 0.95, z + dz);
      }
    }
    // 뒤로 흐르는 바람 줄
    this.streakT -= dt;
    while (this.streakT <= 0) {
      this.streakT += 0.016;
      const s = this.streaks.find((q) => q.t >= STREAK_LIFE);
      if (!s) break;
      const side = (Math.random() - 0.5) * 2.0;
      const up = 0.15 + Math.random() * 1.6;
      const ahead = (Math.random() - 0.3) * 1.2;
      s.t = 0;
      s.mesh.visible = true;
      s.mesh.position.set(x + dx * ahead - dz * side, up, z + dz * ahead + dx * side);
      s.mesh.rotation.set(0, Math.atan2(dx, dz), 0);
      s.mesh.scale.set(1, 1, 1.4 + Math.random() * 1.8);
      s.vel.set(-dx, 0, -dz).multiplyScalar(22 + Math.random() * 14);
    }
    // 발밑 흙먼지 / 불씨
    const fx = this.host.fx;
    this.dust.set(x - dx * 0.3, 0.12, z - dz * 0.3);
    fx.particles.burst(this.dust, 0xd9b87c, 2, 2.2, 0.45, 0.16, 0.2, 6, 1.1);
    if (Math.random() < 0.7) fx.particles.burst(this.dust.set(x, 0.5 + Math.random() * 0.8, z), Math.random() < 0.5 ? PAL.flameHot : PAL.flame, 1, 1.5, 0.45, 0.1, 0.3, 2, 1.8);
  }

  /** 대시가 끝나는 순간 */
  finish(x: number, z: number) {
    this.host.fx.ring(x, z, 1.4, 0.2, PAL.dust, 0.07);
    this.host.fx.particles.burst(this.tmp.set(x, 0.15, z), 0xd9b87c, 6, 3, 0.4, 0.14, 0.2, 8, 1.1);
  }

  /** 매 프레임: 늙히고 그린다 */
  update(dt: number) {
    for (let i = 0; i < this.count; i++) this.ages[i] += dt;
    while (this.count > 0 && this.ages[this.count - 1] > TRAIL_LIFE) this.count--;
    const cam = this.host.camera.position;
    const hot = 1;
    if (this.count >= 2) {
      this.ribbons[0].build(this.xs, this.zs, this.ages, this.count, cam, hot);
      this.ribbons[1].build(this.xs, this.zs, this.ages, this.count, cam, hot * 0.7);
    } else {
      for (const r of this.ribbons) r.hide();
    }
    for (const r of this.rings) {
      if (r.t >= RING_LIFE) continue;
      r.t += dt;
      if (r.t >= RING_LIFE) {
        r.mesh.visible = false;
        continue;
      }
      const k = r.t / RING_LIFE;
      r.mesh.scale.setScalar(0.35 + (r.max - 0.35) * (1 - Math.pow(1 - k, 2)));
      r.mat.opacity = 0.6 * (1 - k) * (1 - k);
    }
    for (const s of this.streaks) {
      if (s.t >= STREAK_LIFE) continue;
      s.t += dt;
      if (s.t >= STREAK_LIFE) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      const k = s.t / STREAK_LIFE;
      s.mat.opacity = 0.65 * Math.sin(Math.PI * Math.min(1, k * 1.15));
    }
  }

  reset() {
    this.count = 0;
    for (const r of this.ribbons) r.hide();
    for (const r of this.rings) {
      r.t = RING_LIFE;
      r.mesh.visible = false;
    }
    for (const s of this.streaks) {
      s.t = STREAK_LIFE;
      s.mesh.visible = false;
    }
  }
}
