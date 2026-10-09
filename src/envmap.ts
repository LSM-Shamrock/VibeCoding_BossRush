import type * as THREE from 'three';

/** 2층 아레나가 만든 반사용 환경맵. 물/젖은 돌바닥/이무기 비늘이 같이 쓴다 (없으면 반사 없음) */
export const envHolder: { tex: THREE.Texture | null } = { tex: null };
