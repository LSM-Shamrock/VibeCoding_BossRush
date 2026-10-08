import * as THREE from 'three';
import { CFG } from './config';
import { PAL } from './palette';

const MAX_DOTS = 56;
const SPACING = 0.7;
const MAX_LEN = MAX_DOTS * SPACING;

/**
 * 투사체 경로 표시: 불꽃을 모으는 동안 총구에서 조준점까지 점선이 이어지고,
 * 도착점에 마커가 뜬다. 완전히 모으면 마커가 스플래시 범위(바닥)까지 보여 준다.
 */
export class AimLine {
  private dots: THREE.InstancedMesh;
  private end: THREE.Mesh;
  private ground: THREE.Mesh;
  private o = new THREE.Object3D();
  private c = new THREE.Color();
  private dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, MAX_DOTS);
    this.dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dots.frustumCulled = false;
    this.dots.count = 0;
    this.dots.setColorAt(0, this.c.setHex(PAL.flame)); // instanceColor 버퍼를 미리 만든다
    scene.add(this.dots);

    // 도착 마커: 카메라를 보는 이중 링 + 중심점
    const endMat = new THREE.MeshBasicMaterial({ color: PAL.flameHot, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
    endMat.color.multiplyScalar(1.4);
    this.end = new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 32), endMat);
    this.end.add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), endMat));
    this.end.visible = false;
    this.end.renderOrder = 5;
    scene.add(this.end);

    // 스플래시 범위(바닥)
    const gMat = new THREE.MeshBasicMaterial({ color: PAL.flame, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.ground = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2), gMat);
    this.ground.add(new THREE.Mesh(new THREE.CircleGeometry(0.93, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.ember, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.ground.visible = false;
    scene.add(this.ground);
  }

  /** from: 총구, to: 조준점, charge 0~1. visible=false면 숨긴다. */
  update(visible: boolean, from: THREE.Vector3, to: THREE.Vector3, charge: number, t: number) {
    if (!visible) {
      this.dots.count = 0;
      this.end.visible = false;
      this.ground.visible = false;
      return;
    }
    const full = charge >= CFG.flame.fullAt;
    this.dir.copy(to).sub(from);
    const len = this.dir.length();
    if (len < 0.01) {
      this.dots.count = 0;
      this.end.visible = false;
      this.ground.visible = false;
      return;
    }
    this.dir.divideScalar(len);
    const shown = Math.min(len, MAX_LEN);
    const n = Math.min(MAX_DOTS, Math.floor(shown / SPACING));
    const march = ((t * 7) % 1) * SPACING; // 점들이 발사 방향으로 흘러간다
    const base = 0.07 + 0.07 * charge;
    for (let i = 0; i < n; i++) {
      const d = i * SPACING + march;
      if (d > shown) {
        this.o.scale.setScalar(0);
      } else {
        // 앞쪽(총구)과 먼 끝에서 작아지며 사라진다
        const fade = Math.min(1, d / 1.5) * Math.min(1, (shown - d) / 2.0 + 0.2);
        this.o.position.copy(this.dir).multiplyScalar(d).add(from);
        this.o.scale.setScalar(base * (0.55 + 0.45 * fade) * (1 + 0.25 * Math.sin(t * 20 - i * 0.8)));
        this.c.setHex(full ? PAL.flameHot : PAL.flame).multiplyScalar((0.9 + 1.6 * charge) * (0.35 + 0.65 * fade));
        this.dots.setColorAt(i, this.c);
      }
      this.o.updateMatrix();
      this.dots.setMatrixAt(i, this.o.matrix);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;

    // 도착 마커 (경로가 너무 길어 잘렸다면 표시하지 않는다)
    const reach = len <= MAX_LEN + 1;
    this.end.visible = reach;
    if (reach) {
      this.end.position.copy(to);
      this.end.lookAt(this.camera.position);
      const dist = this.camera.position.distanceTo(to);
      const s = Math.max(0.16, dist * 0.018) * (0.7 + 0.5 * charge) * (full ? 1.15 + 0.12 * Math.sin(t * 24) : 1);
      this.end.scale.setScalar(s);
    }
    // 완전 차징: 바닥에 폭발 범위
    this.ground.visible = full && reach;
    if (this.ground.visible) {
      this.ground.position.set(to.x, 0.075, to.z);
      this.ground.scale.setScalar(CFG.flame.splashRadius * (0.97 + 0.03 * Math.sin(t * 18)));
    }
  }
}
