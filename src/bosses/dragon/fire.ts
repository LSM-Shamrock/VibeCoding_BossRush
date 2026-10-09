import * as THREE from 'three';
import type { Host } from '../../types';
import type { Player } from '../../player';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const TAU = Math.PI * 2;
const FIRE = 0xff6a1a;
const HOT = 0xffc060;

/** 불타는 바닥 무늬: 그을린 바탕 + 이글거리는 얼룩 + 밝은 테두리 (가장자리는 부드럽게) */
function zoneTexture(): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const c = S / 2;
  const R = S / 2 - 6;
  const fill = g.createRadialGradient(c, c, 0, c, c, R);
  fill.addColorStop(0, 'rgba(70,14,2,0.9)');
  fill.addColorStop(0.7, 'rgba(130,30,4,0.85)');
  fill.addColorStop(1, 'rgba(200,58,8,0.85)');
  g.fillStyle = fill;
  g.beginPath();
  g.arc(c, c, R, 0, TAU);
  g.fill();
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * R * 0.85;
    const r = 6 + rnd() * 22;
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,${150 + Math.floor(rnd() * 80)},40,${0.45 + rnd() * 0.4})`);
    gr.addColorStop(1, 'rgba(255,90,10,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = 'rgba(255,170,60,0.98)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(c, c, R - 3, 0, TAU);
  g.stroke();
  g.strokeStyle = 'rgba(255,230,150,0.8)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c, c, R - 9, 0, TAU);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WAVE_VS = `
varying vec2 vP;
void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const WAVE_FS = `
uniform float uR; uniform float uW; uniform float uA;
varying vec2 vP;
void main(){
  float d = length(vP);
  float body = smoothstep(uR - uW, uR - uW*0.15, d) * (1.0 - smoothstep(uR - 0.02, uR + 0.14, d));
  if (body < 0.01) discard;
  float lead = smoothstep(uR - uW*0.4, uR, d);
  vec3 col = mix(vec3(0.95,0.28,0.04), vec3(2.2,1.3,0.5), lead);
  gl_FragColor = vec4(col, body*uA);
}`;

/** 빛줄기(화염 숨결 / 태양 광선)용 셰이더: 길이 방향으로 흘러가는 불꽃 무늬 + 가운데가 더 밝은 단면 */
const STREAK_VS = `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const STREAK_FS = `
uniform float uT; uniform float uA; uniform float uFreq; uniform float uSpeed; uniform float uFade;
uniform vec3 uC0; uniform vec3 uC1;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1.0,0.0)), f.x), mix(h(i+vec2(0.0,1.0)), h(i+vec2(1.0,1.0)), f.x), f.y); }
void main(){
  float len = vUv.y;
  float ang = vUv.x * 6.2831;
  float f = pow(abs(dot(vN, vV)), 0.65);
  float nz = n(vec2(ang*2.0 + uT*0.7, len*uFreq - uT*uSpeed))*0.6 + n(vec2(ang*4.0 - uT, len*uFreq*2.1 - uT*uSpeed*1.4))*0.4;
  float a = f * (0.4 + 0.9*nz) * smoothstep(0.0, 0.06, len) * (1.0 - smoothstep(uFade, 1.0, len));
  vec3 col = mix(uC0, uC1, clamp(len*1.15 + (1.0-nz)*0.35, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + f), a * uA);
}`;

/** 한 점에서 한 점으로 뻗는 빛줄기 하나 (끝으로 갈수록 굵어지거나 일정) */
class Streak {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private dir = new V3();
  constructor(scene: THREE.Scene, nearK: number, c0: number, c1: number, freq: number, speed: number, fade: number) {
    const geo = new THREE.CylinderGeometry(1, nearK, 1, 22, 8, true).translate(0, 0.5, 0);
    // 원기둥의 위쪽(굵은 쪽, radiusTop)이 y=1(끝), 아래쪽(가는 쪽)이 y=0(입)이 되도록 그대로 쓴다
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VS,
      fragmentShader: STREAK_FS,
      uniforms: {
        uT: { value: 0 },
        uA: { value: 1 },
        uFreq: { value: freq },
        uSpeed: { value: speed },
        uFade: { value: fade },
        uC0: { value: new THREE.Color(c0) },
        uC1: { value: new THREE.Color(c1) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  set(from: THREE.Vector3, to: THREE.Vector3, radius: number, a: number, t: number) {
    this.dir.subVectors(to, from);
    const L = this.dir.length();
    this.mesh.visible = L > 0.1 && a > 0.01;
    if (!this.mesh.visible) return;
    this.dir.multiplyScalar(1 / L);
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir);
    this.mesh.scale.set(radius, L, radius);
    this.mat.uniforms.uA.value = a;
    this.mat.uniforms.uT.value = t;
  }
  hide() {
    this.mesh.visible = false;
  }
  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

interface Ball {
  active: boolean;
  group: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  tail: THREE.Mesh;
  t: number;
  dur: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  peak: number;
  scale: number;
  meteor: boolean;
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
}

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
 * 용의 불 도구함: 불덩이(포물선) · 유성 · 불타는 바닥 · 땅을 훑는 충격파 고리 · 화염 숨결 줄기 · 태양 광선 · 입가의 태양구.
 * 예고 원은 fx.telegraphs 로 그리고, 터지는 순간의 연출 · 피격 · 바닥 불은 여기서 처리한다.
 */
export class FireField {
  private balls: Ball[] = [];
  private zones: Zone[] = [];
  private waves: Wave[] = [];
  private tex = zoneTexture();
  private tmp = new V3();
  private tmp2 = new V3();
  private ballGeo = new THREE.SphereGeometry(1, 14, 10);
  private discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private wallGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true).translate(0, 0.5, 0);
  private tailGeo = new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0);
  private coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.5, 0.6), toneMapped: false });
  private haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.5, 0.1), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  private tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.42, 0.1), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  /** 입에서 뿜는 화염 줄기 (겉 / 속) */
  private jetOut: Streak;
  private jetIn: Streak;
  private jetT = 0;
  private jetK = 0;
  /** 태양 광선 (겉 / 속) + 맞은 곳의 불덩어리 + 조명 */
  private rayOut: Streak;
  private rayIn: Streak;
  private rayHit: THREE.Mesh;
  private rayLight: THREE.PointLight;
  private rayT = 0;
  private rayK = 0;
  /** 입가의 태양구 */
  private orb: THREE.Group;
  private orbCore: THREE.Mesh;
  private orbHalo: THREE.Mesh;
  private orbRings: THREE.Mesh[] = [];
  private orbLight: THREE.PointLight;
  private orbT = 0;
  private orbK = 0;
  private clock = 0;

  constructor(
    private host: Host,
    private player: Player,
    zoneMax = 28,
  ) {
    const scene = host.scene;
    for (let i = 0; i < 24; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(this.ballGeo, this.coreMat);
      const halo = new THREE.Mesh(this.ballGeo, this.haloMat);
      halo.scale.setScalar(1.7);
      const tail = new THREE.Mesh(this.tailGeo, this.tailMat);
      group.add(tail, halo, core);
      group.visible = false;
      scene.add(group);
      this.balls.push({ active: false, group, core, halo, tail, t: 0, dur: 1, from: new V3(), to: new V3(), peak: 0, scale: 1, meteor: false });
    }
    const discMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    for (let i = 0; i < zoneMax; i++) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(this.discGeo, discMat.clone());
      disc.position.y = 0.05;
      disc.renderOrder = 1;
      group.add(disc);
      group.visible = false;
      scene.add(group);
      this.zones.push({ active: false, group, disc, t: 0, life: 6, x: 0, z: 0, r: 2.5 });
    }
    discMat.dispose();
    const size = 62;
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    for (let i = 0; i < 5; i++) {
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
      scene.add(mesh);
      const wallMat = new THREE.MeshBasicMaterial({ color: 0xff5a12, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
      const wall = new THREE.Mesh(this.wallGeo, wallMat);
      wall.visible = false;
      scene.add(wall);
      this.waves.push({ active: false, mesh, mat, wall, wallMat, x: 0, z: 0, r: 0, speed: 9, maxR: 15, width: 1.1, hit: false, delay: 0 });
    }

    this.jetOut = new Streak(scene, 0.1, 0xff3a08, 0xffd070, 3.2, 5.5, 0.7);
    this.jetIn = new Streak(scene, 0.06, 0xffa020, 0xffffff, 4.4, 8, 0.55);
    this.rayOut = new Streak(scene, 0.8, 0xff4a0a, 0xffe090, 1.6, 7, 0.97);
    this.rayIn = new Streak(scene, 0.7, 0xffd080, 0xffffff, 2.2, 10, 0.98);
    this.rayHit = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.4, 0.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.rayHit.visible = false;
    scene.add(this.rayHit);
    this.rayLight = new THREE.PointLight(0xff8a30, 0, 40, 1.4);
    scene.add(this.rayLight);

    this.orb = new THREE.Group();
    this.orbCore = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.8, 1.2), toneMapped: false }));
    this.orbHalo = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.55, 0.12), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.orbHalo.scale.setScalar(1.8);
    this.orb.add(this.orbCore, this.orbHalo);
    const ringGeo = new THREE.TorusGeometry(1, 0.045, 8, 64);
    for (let i = 0; i < 3; i++) {
      const rm = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.1, 0.4), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      rm.rotation.set(i * 1.05, i * 0.6, i * 0.3);
      rm.scale.setScalar(2.6 + i * 0.5);
      this.orb.add(rm);
      this.orbRings.push(rm);
    }
    this.orb.visible = false;
    scene.add(this.orb);
    this.orbLight = new THREE.PointLight(0xff9a40, 0, 60, 1.3);
    scene.add(this.orbLight);
  }

  private take(): Ball | null {
    return this.balls.find((b) => !b.active) ?? null;
  }

  private place(b: Ball) {
    b.group.visible = true;
    b.group.position.copy(b.from);
  }

  /** 입(from)에서 바닥(to)으로 불덩이를 던진다. 날아가는 동안 착지 지점에 붉은 고리가 차오르고, 닿으면 폭발한다 */
  lob(from: THREE.Vector3, to: THREE.Vector3, flight: number, peak: number, radius: number, zoneLife = 0) {
    const b = this.take();
    if (!b) return;
    b.active = true;
    b.meteor = false;
    b.t = 0;
    b.dur = flight;
    b.peak = peak;
    b.scale = 0.95;
    b.from.copy(from);
    b.to.set(to.x, 0.5, to.z);
    this.place(b);
    b.tail.visible = false;
    this.host.fx.telegraphs.circle(to.x, to.z, radius, flight, () => {
      b.active = false;
      b.group.visible = false;
      this.explode(to.x, to.z, radius, true);
      if (zoneLife > 0) this.burn(to.x, to.z, radius * 0.9, zoneLife);
    });
  }

  /** 하늘에서 떨어지는 유성: tell 초 뒤 (x,z) 에 떨어진다. (dirX,dirZ) = 떨어져 오는 쪽 (정규화 불필요) */
  meteor(x: number, z: number, radius: number, tell: number, dirX: number, dirZ: number, zoneLife = 0) {
    const b = this.take();
    if (!b) return;
    b.active = true;
    b.meteor = true;
    b.t = 0;
    b.dur = tell;
    b.peak = 0;
    b.scale = 0.9 + radius * 0.14;
    const l = Math.hypot(dirX, dirZ) || 1;
    b.from.set(x + (dirX / l) * 34, 56, z + (dirZ / l) * 34);
    b.to.set(x, 0.6, z);
    this.place(b);
    b.tail.visible = true;
    this.host.fx.telegraphs.circle(x, z, radius, tell, () => {
      b.active = false;
      b.group.visible = false;
      this.explode(x, z, radius, true);
      this.host.fx.particles.burst(this.tmp.set(x, 1, z), 0x2a1208, 16, 9, 1.1, 0.34, 0.9, 6, 1);
      if (zoneLife > 0) this.burn(x, z, radius * 0.85, zoneLife);
    });
  }

  /** 불타는 바닥을 남긴다 (위에 서 있으면 피해) */
  burn(x: number, z: number, r: number, life: number) {
    let z0 = this.zones.find((q) => !q.active);
    if (!z0) z0 = this.zones.reduce((a, b) => (a.life - a.t < b.life - b.t ? a : b));
    z0.active = true;
    z0.t = 0;
    z0.life = life;
    z0.x = x;
    z0.z = z;
    z0.r = r;
    z0.group.visible = true;
    z0.group.position.set(x, 0, z);
    z0.disc.rotation.y = Math.random() * TAU;
  }

  /** (x,z) 에서 퍼져 나가는 불꽃 고리 (닿으면 1 피해, 대시 무적으로 통과) */
  wave(x: number, z: number, maxR: number, speed: number, width: number, delay = 0) {
    const w = this.waves.find((q) => !q.active) ?? this.waves[0];
    w.active = true;
    w.x = x;
    w.z = z;
    w.r = 0;
    w.speed = speed;
    w.maxR = maxR;
    w.width = width;
    w.hit = false;
    w.delay = delay;
    w.mesh.visible = false;
    w.wall.visible = false;
  }

  /** 폭발 연출 + 범위 안 플레이어 피격 */
  explode(x: number, z: number, r: number, big: boolean) {
    const { host, player } = this;
    const fx = host.fx;
    fx.ring(x, z, r * 1.25, 0.42, HOT);
    fx.ring(x, z, r * 0.62, 0.3, 0xffffff, 0.09);
    fx.burstLight(this.tmp.set(x, 1.6, z), 0xff8030, big ? 120 : 80, 0.42);
    fx.particles.burst(this.tmp.set(x, 0.4, z), FIRE, big ? 40 : 26, 9, 0.75, 0.22, 0.8, 8, 1.8);
    fx.particles.burst(this.tmp.set(x, 0.3, z), HOT, big ? 22 : 12, 7, 0.5, 0.16, 0.9, 6, 2);
    fx.particles.burst(this.tmp.set(x, 0.2, z), 0x3a1a10, 8, 4, 0.9, 0.3, 0.6, 3, 1);
    host.shake(big ? 0.85 : 0.45, 0.06);
    host.sfx.explosion(big);
    if (!player.dead && Math.hypot(player.pos.x - x, player.pos.z - z) < r + player.hitRadius) player.takeDamage(x, z);
  }

  /** 입에서 땅까지 뻗는 화염 줄기. 매 프레임 불러야 켜져 있다 (k = 세기 0~1, 굵기) */
  jet(from: THREE.Vector3, to: THREE.Vector3, k = 1) {
    this.jetT = 0.07;
    this.jetK = k;
    const w = 1.1 + 2.3 * k;
    this.jetOut.set(from, to, w * 1.9, 0.85 * k, this.clock);
    this.jetIn.set(from, to, w, 1.0 * k, this.clock);
    // 닿은 곳: 퍼지는 불꽃
    const fx = this.host.fx;
    for (let i = 0; i < 2; i++) {
      this.tmp2.set(to.x + (Math.random() - 0.5) * 3, 0.3 + Math.random() * 1.2, to.z + (Math.random() - 0.5) * 3);
      fx.particles.burst(this.tmp2, Math.random() < 0.5 ? FIRE : HOT, 2, 5, 0.5, 0.2, 0.6, 3, 2);
    }
    if (Math.random() < 0.4) fx.burstLight(this.tmp2.set(to.x, 1.5, to.z), 0xff7a28, 55, 0.22);
  }

  /** 태양 광선. 매 프레임 불러야 켜져 있다 (k = 0~1: 시작/끝에서 가늘어진다) */
  ray(from: THREE.Vector3, to: THREE.Vector3, k = 1) {
    this.rayT = 0.07;
    this.rayK = k;
    const w = (0.9 + 0.12 * Math.sin(this.clock * 40)) * 2.5 * k;
    this.rayOut.set(from, to, w * 1.7, 0.95 * k, this.clock);
    this.rayIn.set(from, to, w * 0.8, 1.0 * k, this.clock);
    this.rayHit.visible = true;
    this.rayHit.position.set(to.x, 0.6, to.z);
    this.rayHit.scale.setScalar((1.8 + 0.4 * Math.sin(this.clock * 31)) * k);
    this.rayLight.position.set(to.x, 3, to.z);
    this.rayLight.intensity = 300 * k;
    const fx = this.host.fx;
    for (let i = 0; i < 3; i++) {
      this.tmp2.set(to.x + (Math.random() - 0.5) * 3.4, 0.4 + Math.random() * 1.6, to.z + (Math.random() - 0.5) * 3.4);
      fx.particles.burst(this.tmp2, Math.random() < 0.4 ? 0xfff0c0 : HOT, 2, 8, 0.6, 0.2, 1.1, 5, 2.2);
    }
    // 광선 줄기를 타고 오르는 불똥
    const u = Math.random();
    this.tmp2.lerpVectors(from, to, u);
    fx.particles.burst(this.tmp2, HOT, 2, 2.5, 0.5, 0.2, 0.2, 0, 2.2);
  }

  /** 입가에 모이는 태양구. 매 프레임 불러야 켜져 있다 (k = 0~1 크기) */
  charge(at: THREE.Vector3, k: number) {
    this.orbT = 0.07;
    this.orbK = k;
    this.orb.visible = true;
    this.orb.position.copy(at);
    const s = 0.35 + 2.0 * k;
    this.orbCore.scale.setScalar(s * (0.95 + 0.05 * Math.sin(this.clock * 35)));
    this.orbHalo.scale.setScalar(s * 1.6);
    for (let i = 0; i < this.orbRings.length; i++) {
      const rm = this.orbRings[i];
      rm.rotation.x += 0.03 * (i + 1);
      rm.rotation.y += 0.04;
      rm.scale.setScalar(s * (1.5 + i * 0.35) * (1.4 - 0.4 * Math.min(1, k * 1.2)));
      (rm.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.7 * k;
    }
    this.orbLight.position.copy(at);
    this.orbLight.intensity = 300 * k * k;
    // 빨려 드는 불씨
    const fx = this.host.fx;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * TAU;
      const b = Math.acos(2 * Math.random() - 1);
      const d = 6 + Math.random() * 6;
      this.tmp2.set(at.x + Math.sin(b) * Math.cos(a) * d, at.y + Math.cos(b) * d, at.z + Math.sin(b) * Math.sin(a) * d);
      fx.particles.burst(this.tmp2, Math.random() < 0.5 ? FIRE : HOT, 1, 0.5, 0.35, 0.18, 0, 0, 2.2);
    }
  }

  update(dt: number) {
    const pl = this.player;
    const fx = this.host.fx;
    this.clock += dt;

    for (const b of this.balls) {
      if (!b.active) continue;
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const p = b.group.position;
      const prevY = p.y;
      if (b.meteor) {
        const e = Math.pow(k, 1.5);
        p.lerpVectors(b.from, b.to, e);
        // 꼬리: 날아온 방향의 반대쪽으로 길게
        this.tmp.subVectors(b.from, b.to).normalize();
        b.tail.quaternion.setFromUnitVectors(UP, this.tmp);
        b.tail.scale.set(b.scale * 0.62, 12 + 9 * (1 - k), b.scale * 0.62);
        b.tail.position.set(0, 0, 0);
      } else {
        p.lerpVectors(b.from, b.to, k);
        p.y = b.from.y * (1 - k) + b.to.y * k + Math.sin(k * Math.PI) * b.peak;
      }
      b.core.scale.setScalar(b.scale * (0.9 + 0.12 * Math.sin(b.t * 38)));
      b.halo.scale.setScalar(b.scale * 1.5);
      void prevY;
      fx.particles.burst(p, FIRE, b.meteor ? 3 : 1, 1.2, 0.5, b.meteor ? 0.3 : 0.22, 0.1, 0, 1.7);
      if (Math.random() < 0.6) fx.particles.burst(p, HOT, 1, 0.6, 0.3, 0.14, 0, 0, 2.1);
      if (b.t > b.dur + 0.4) {
        b.active = false;
        b.group.visible = false;
      }
    }

    for (const z of this.zones) {
      if (!z.active) continue;
      z.t += dt;
      if (z.t >= z.life) {
        z.active = false;
        z.group.visible = false;
        continue;
      }
      const inK = Math.min(1, z.t / 0.2);
      const outK = Math.min(1, (z.life - z.t) / 1.0);
      const k = inK * outK;
      z.disc.scale.setScalar(z.r * (0.55 + 0.45 * (1 - Math.pow(1 - inK, 3))));
      z.disc.rotation.y += dt * 0.35;
      const warn = z.life - z.t < 1.4 ? 0.6 + 0.4 * Math.sin(z.t * 18) : 1;
      (z.disc.material as THREE.MeshBasicMaterial).opacity = 0.95 * k * warn;
      if (Math.random() < dt * 10 * (z.r / 2.5)) {
        const a = Math.random() * TAU;
        const d = Math.sqrt(Math.random()) * z.r * 0.85;
        fx.particles.burst(this.tmp.set(z.x + Math.cos(a) * d, 0.15, z.z + Math.sin(a) * d), Math.random() < 0.5 ? FIRE : HOT, 2, 1.9, 0.7, 0.13, 1.4, -1, 1.8);
      }
      if (!pl.dead && k > 0.3) {
        const d = Math.hypot(pl.pos.x - z.x, pl.pos.z - z.z);
        if (d < z.r - 0.05) pl.takeDamage(z.x, z.z);
      }
    }

    for (const w of this.waves) {
      if (!w.active) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        continue;
      }
      w.r += w.speed * dt;
      if (w.r >= w.maxR) {
        w.active = false;
        w.mesh.visible = false;
        w.wall.visible = false;
        continue;
      }
      w.mesh.visible = true;
      w.wall.visible = true;
      w.mesh.position.x = w.x;
      w.mesh.position.z = w.z;
      const fade = Math.min(1, (w.maxR - w.r) / 3.5);
      w.mat.uniforms.uR.value = w.r;
      w.mat.uniforms.uW.value = w.width;
      w.mat.uniforms.uA.value = 0.95 * fade;
      w.wall.position.set(w.x, 0, w.z);
      w.wall.scale.set(w.r, 0.5 + 0.35 * fade, w.r);
      w.wallMat.opacity = 0.32 * fade;
      if (Math.random() < 0.8) {
        const a = Math.random() * TAU;
        fx.particles.burst(this.tmp.set(w.x + Math.cos(a) * w.r, 0.2, w.z + Math.sin(a) * w.r), FIRE, 1, 1.5, 0.35, 0.12, 0.5, 2, 1.8);
      }
      if (!w.hit && !pl.dead) {
        const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
        if (d > w.r - w.width - pl.hitRadius && d < w.r + pl.hitRadius) {
          if (pl.takeDamage(w.x, w.z)) w.hit = true;
        }
      }
    }

    if (this.jetT > 0) {
      this.jetT -= dt;
      if (this.jetT <= 0) {
        this.jetOut.hide();
        this.jetIn.hide();
      }
    }
    if (this.rayT > 0) {
      this.rayT -= dt;
      if (this.rayT <= 0) {
        this.rayOut.hide();
        this.rayIn.hide();
        this.rayHit.visible = false;
        this.rayLight.intensity = 0;
      }
    }
    if (this.orbT > 0) {
      this.orbT -= dt;
      if (this.orbT <= 0) {
        this.orb.visible = false;
        this.orbLight.intensity = 0;
      }
    }
  }

  clear() {
    for (const b of this.balls) {
      b.active = false;
      b.group.visible = false;
    }
    for (const z of this.zones) {
      z.active = false;
      z.group.visible = false;
    }
    for (const w of this.waves) {
      w.active = false;
      w.mesh.visible = false;
      w.wall.visible = false;
    }
    this.jetT = this.rayT = this.orbT = 0;
    this.jetOut.hide();
    this.jetIn.hide();
    this.rayOut.hide();
    this.rayIn.hide();
    this.rayHit.visible = false;
    this.rayLight.intensity = 0;
    this.orb.visible = false;
    this.orbLight.intensity = 0;
  }

  dispose() {
    this.clear();
    const s = this.host.scene;
    for (const b of this.balls) s.remove(b.group);
    for (const z of this.zones) {
      s.remove(z.group);
      (z.disc.material as THREE.Material).dispose();
    }
    for (const w of this.waves) {
      s.remove(w.mesh, w.wall);
      w.mat.dispose();
      w.wallMat.dispose();
    }
    this.waves[0]?.mesh.geometry.dispose();
    this.jetOut.dispose(s);
    this.jetIn.dispose(s);
    this.rayOut.dispose(s);
    this.rayIn.dispose(s);
    s.remove(this.rayHit, this.rayLight, this.orb, this.orbLight);
    this.rayHit.geometry.dispose();
    (this.rayHit.material as THREE.Material).dispose();
    for (const rm of this.orbRings) (rm.material as THREE.Material).dispose();
    this.orbRings[0]?.geometry.dispose();
    (this.orbCore.material as THREE.Material).dispose();
    (this.orbHalo.material as THREE.Material).dispose();
    this.ballGeo.dispose();
    this.discGeo.dispose();
    this.wallGeo.dispose();
    this.tailGeo.dispose();
    this.coreMat.dispose();
    this.haloMat.dispose();
    this.tailMat.dispose();
    this.tex.dispose();
  }
}
