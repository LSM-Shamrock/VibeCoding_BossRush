import type * as THREE from 'three';
import type { Fx } from './fx';
import type { Sfx } from './audio';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** 불꽃 판정 결과: 0 = 빗나감(불꽃은 계속 날아감), 양수 = 준 데미지, BLOCKED = 막힘(불꽃만 꺼짐, 데미지 없음 — 포효 중 무적 등) */
export const BLOCKED = -1;

/** 플레이어 공격을 받는 대상(보스, 알, 새끼, 분신 등) */
export interface Target {
  readonly alive: boolean;
  hitArrow(p: THREE.Vector3, r: number, dmg: number): number;
  /** 범위 공격(특수기) 판정 */
  hitRadial(c: THREE.Vector3, radius: number, dmg: number): void;
  /** 불꽃 범위 피해(풀차징 스플래시 / 불꽃 장판). 바닥 위 (x,z) 원과 겹치면 피해를 주고 준 피해를 돌려준다 (겹치지 않으면 0) */
  hitSplash(x: number, z: number, r: number, dmg: number): number;
  /** 플레이어가 통과하지 못하는 몸통 원들 (없으면 빈 배열) */
  bodies(): Circle[];
}

/** HUD 보스 체력바에 필요한 정보 */
export interface BossInfo {
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly exposed: boolean;
  /** 페이즈 전환 지점(0~1). 체력바에 눈금으로 표시 */
  readonly phaseMarks: number[];
}

export type FloatKind = 'normal' | 'weak' | 'exposed' | 'special' | 'player';


/** 게임 본체가 플레이어/보스/이펙트에 제공하는 공용 기능 */
export interface Host {
  readonly scene: THREE.Scene;
  /** 게임 카메라 (카메라를 향하는 이펙트용) */
  readonly camera: THREE.Camera;
  readonly fx: Fx;
  readonly sfx: Sfx;
  targets: Target[];
  shake(amount: number): void;
  /** 시야각을 순간적으로 deg 만큼 벌렸다가 되돌린다 (대시의 속도감) */
  punch(deg: number): void;
  hitStop(seconds: number): void;
  /** 히트스톱이 끝난 뒤 시간 배율을 0 → 1 로 서서히 되돌린다 (피격 연출) */
  rampUp(seconds: number): void;
  /** 일정 시간 동안 시간 배율을 낮춘다 (연출용 슬로모션) */
  slowmo(scale: number, seconds: number): void;
  floatText(p: THREE.Vector3, text: string, kind: FloatKind): void;
  /** 화면 중앙에 큰 글자를 잠깐 띄운다 */
  banner(title: string, sub: string, seconds: number): void;
}
