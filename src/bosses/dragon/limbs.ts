import * as THREE from 'three';
import { spike } from '../../geo';

/** 모델이 공유하는 지오메트리 · 재질 묶음 (리그가 만들고 정리한다) */
export interface LimbKit {
  seg: THREE.BufferGeometry; // 육각 절두체 (+y, 아래가 굵다)
  cuff: THREE.BufferGeometry; // 갑옷 띠
  joint: THREE.BufferGeometry; // 각진 관절 덩어리
  claw: THREE.BufferGeometry; // 발톱 (+y)
  spike: THREE.BufferGeometry; // 팔꿈치 · 무릎 가시
  armor: THREE.Material; // 갑옷 (진홍 강철)
  dark: THREE.Material; // 어두운 뼈대
  horn: THREE.Material; // 발톱 색
}

export function makeLimbKit(armor: THREE.Material, dark: THREE.Material, horn: THREE.Material): LimbKit {
  return {
    seg: new THREE.CylinderGeometry(0.62, 1, 1, 6, 1).translate(0, 0.5, 0),
    cuff: new THREE.CylinderGeometry(1.2, 1.34, 1, 6, 1).translate(0, 0.5, 0),
    joint: new THREE.IcosahedronGeometry(1, 0),
    claw: spike(1, 0.16, 4),
    spike: spike(1, 0.3, 4),
    armor,
    dark,
    horn,
  };
}
