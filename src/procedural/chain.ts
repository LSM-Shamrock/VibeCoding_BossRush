import * as THREE from 'three';

const _d = new THREE.Vector3();

/**
 * 머리(anchor)가 움직이면 각 마디가 앞 마디를 일정 거리로 따라가는 세그먼트 체인.
 * 지금은 플레이어 망토에 쓰고, 이후 뱀 몸통 / 용의 목·꼬리에 그대로 재사용한다.
 */
export class Chain {
  readonly pts: THREE.Vector3[] = [];

  constructor(
    readonly count: number,
    readonly seg: number,
    origin: THREE.Vector3,
  ) {
    for (let i = 0; i < count; i++) this.pts.push(origin.clone().add(new THREE.Vector3(0, -i * seg, 0)));
  }

  reset(anchor: THREE.Vector3) {
    for (let i = 0; i < this.count; i++) this.pts[i].set(anchor.x, anchor.y - i * this.seg, anchor.z);
  }

  /** gravity: 아래로 처지는 힘 / sway: 좌우 흔들림 세기 */
  update(anchor: THREE.Vector3, dt: number, gravity = 6, sway = 0, t = 0) {
    this.pts[0].copy(anchor);
    for (let i = 1; i < this.count; i++) {
      const p = this.pts[i];
      const q = this.pts[i - 1];
      p.y -= gravity * dt;
      if (sway) p.x += Math.sin(t * 3 + i * 0.9) * sway * dt;
      _d.subVectors(p, q);
      const len = _d.length();
      if (len > 1e-5) _d.multiplyScalar(this.seg / len);
      else _d.set(0, -this.seg, 0);
      p.copy(q).add(_d);
    }
  }
}
