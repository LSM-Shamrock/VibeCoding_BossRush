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
  hitSplash(x: number, z: number, r: number, dmg: number, y?: number): number;
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
  /** 페이즈 전환 지점(0~1). 체력바는 페이즈마다 한 줄씩 비워 간다 */
  readonly phaseMarks: number[];
  /** 지금 페이즈 (0부터) */
  readonly phaseIndex: number;
}

/** 공격 스크립트의 한 단계: at(초)에 fn 실행 */
export interface Step {
  at: number;
  fn: () => void;
}

/**
 * 공격 = "시간표". 예비동작(Telegraph) → 공격 → 후딜(약점 노출) 이 한 눈에 보이도록
 * 각 단계를 at(초) + 함수로 늘어놓는다. 보스 본체는 이 시간표를 실행만 한다.
 */
export interface AttackScript {
  steps: Step[];
  end: number;
}

/** 조준 판정용 구 (월드 좌표) */
export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

/**
 * 층마다 하나씩 나오는 보스의 공통 얼굴. 게임 본체(main.ts)는 이것만 안다.
 * 새 보스를 만들 때는 이 인터페이스를 구현하고 main.ts 의 BOSSES 목록에 한 줄 추가하면 된다.
 */
export interface Boss extends Target, BossInfo {
  /** 층 번호 (1~) */
  readonly floor: number;
  /** 보스 이름 (페이즈 접미사 없는 원래 이름) */
  readonly title: string;
  /** 예: '1층 · 거미굴' */
  readonly floorLabel: string;
  /** 월드 위치 (락온 방향/카메라 기준. y 는 바닥 높이) */
  readonly pos: THREE.Vector3;
  /** 등장 연출이 끝나 전투가 시작됐는가 */
  readonly ready: boolean;
  /** 등장 카드를 띄울 시점인가 (예: 착지/솟아오른 순간) */
  readonly introBeat: boolean;
  attacksOn: boolean;
  readonly phaseIndex: number;
  /** 보스가 화면에 입히는 색 효과 강도 0~1 (이무기 몸통 접촉 = 보라색) */
  readonly screenTint?: number;
  /** 디버그 표시용 현재 상태 */
  readonly status: string;
  /** 디버그 키(9)로 순서대로 불러낼 수 있는 공격 이름들 */
  readonly attackNames: readonly string[];
  onDeath: () => void;
  update(dt: number): void;
  /** 땅/물 위를 지나가는 몸이 남기는 물결: 지나간 자리마다 emit(x, z, 크기, 세기) 를 부른다 (2층) */
  wake?(emit: (x: number, z: number, size: number, strength: number) => void): void;
  dispose(): void;
  forceAttack(name: string): void;
  setHpFrac(f: number): void;
  /** 시선(조준 광선)이 닿는 구들. 락온 중이 아닐 때 어디를 맞히는지 판정하는 데 쓴다 */
  aimSpheres(): readonly Sphere[];
  /** 락온 중 조준할 점 (몸 중심) */
  lockPoint(out: THREE.Vector3): THREE.Vector3;
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
  /** 화면 흔들림. hold 초 동안은 세기를 유지했다가 사그라든다 (돌진 같은 지속 진동용) */
  shake(amount: number, hold?: number): void;
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
  /** 화면 전체를 color 로 번쩍였다가 seconds 동안 사라지게 한다 (포효 등) */
  flash(color: string, alpha: number, seconds: number): void;
  /** 3층: 하늘이 번쩍 (선택) */
  skyPulse?(k: number): void;
}
