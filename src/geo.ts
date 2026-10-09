import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 이무기 모델링용 작은 도구들: 볼록 껍질, 끝이 가늘어지는 곡선 관, 가시, 병합 */
export type P3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** 점들을 감싸는 볼록 다면체 (플랫 셰이딩과 함께 쓰면 각진 뼈대 모양이 된다) */
export function hull(points: P3[]): THREE.BufferGeometry {
  const g = new ConvexGeometry(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  g.deleteAttribute('uv');
  return g;
}

/** x ≥ 0 인 점들을 좌우 대칭으로 복제 */
export function mirror(points: P3[]): P3[] {
  const out: P3[] = [];
  for (const p of points) {
    out.push(p);
    if (Math.abs(p[0]) > 1e-4) out.push([-p[0], p[1], p[2]]);
  }
  return out;
}

/** 경로를 따라 반지름이 r0 → r1 로 줄어드는 관 (뿔, 수염, 송곳니, 혀) */
export function taperedTube(path: P3[], r0: number, r1: number, radial = 6, samples = 14, power = 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const frames = curve.computeFrenetFrames(samples, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    const r = Math.max(0.004, r0 + (r1 - r0) * Math.pow(u, power));
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      pos.push(p.x + N.x * c + B.x * s, p.y + N.y * c + B.y * s, p.z + N.z * c + B.z * s);
    }
  }
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 밑면이 원점, 끝이 +y 로 뻗는 가시 */
export function spike(len: number, r: number, radial = 5): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, radial, 1).translate(0, len / 2, 0);
  g.deleteAttribute('uv');
  return g;
}

/** 방향(dir)을 향하도록 geo 를 돌려 pos 에 놓은 사본 */
export function aimed(geo: THREE.BufferGeometry, pos: P3, dir: P3, scale: P3 = [1, 1, 1]): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  return geo.clone().applyMatrix4(m);
}

export function placed(geo: THREE.BufferGeometry, pos: P3, rot: P3 = [0, 0, 0], scale: P3 = [1, 1, 1]): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  return geo.clone().applyMatrix4(m);
}

/** 여러 조각을 하나의 지오메트리로 (그리는 횟수를 줄인다) */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.getAttribute('normal')) n.computeVertexNormals();
    return n;
  });
  const out = mergeGeometries(prepared, false);
  if (!out) throw new Error('merge failed');
  return out;
}
