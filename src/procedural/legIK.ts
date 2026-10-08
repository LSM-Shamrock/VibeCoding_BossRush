import * as THREE from 'three';

const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();

/**
 * 2본 IK (hip → knee → end).
 * - 목표가 너무 멀면 쭉 뻗은 지점까지만, 너무 가까우면 최소 길이까지만 접힌다.
 * - 무릎은 pole 방향(보통 위 + 바깥)으로 튀어나온다.
 * 거미 다리 8개, 용의 뒷다리 등 "관절 2개짜리 다리" 전부에 재사용한다.
 *
 * outEnd 에는 실제로 도달한 끝점이 들어간다 (목표에 못 닿았으면 target 과 다를 수 있음).
 */
export function solveTwoBone(
  hip: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  poleHint: THREE.Vector3,
  outKnee: THREE.Vector3,
  outEnd: THREE.Vector3,
): void {
  _dir.subVectors(target, hip);
  let d = _dir.length();
  if (d < 1e-5) {
    _dir.set(0, -1, 0);
    d = 1e-5;
  } else {
    _dir.divideScalar(d);
  }
  const dMin = Math.abs(l1 - l2) + 0.02;
  const dMax = l1 + l2 - 0.02;
  const dc = Math.min(dMax, Math.max(dMin, d));

  const cosA = (l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  // pole 에서 진행 방향 성분을 빼서 수직 방향만 남긴다
  _pole.copy(poleHint).addScaledVector(_dir, -poleHint.dot(_dir));
  if (_pole.lengthSq() < 1e-6) _pole.set(1, 0, 0).addScaledVector(_dir, -_dir.x);
  _pole.normalize();

  outKnee.copy(hip).addScaledVector(_dir, l1 * cosA).addScaledVector(_pole, l1 * sinA);
  outEnd.copy(hip).addScaledVector(_dir, dc);
}

const _up = new THREE.Vector3(0, 1, 0);

/**
 * 단위 원기둥(높이 1, 중심 원점, +Y 방향이 b쪽) 메시를 a→b 구간에 맞춰 배치한다.
 * thickness 는 가로(XZ) 스케일.
 */
export function placeSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, thickness: number): void {
  _dir.subVectors(b, a);
  const len = _dir.length();
  mesh.position.copy(a).addScaledVector(_dir, 0.5);
  mesh.scale.set(thickness, Math.max(len, 1e-4), thickness);
  if (len > 1e-5) mesh.quaternion.setFromUnitVectors(_up, _dir.divideScalar(len));
}

/** 점 p 에서 선분 a-b 까지의 3D 거리 */
export function distPointSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x;
  const dy = a.y + aby * t - p.y;
  const dz = a.z + abz * t - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
