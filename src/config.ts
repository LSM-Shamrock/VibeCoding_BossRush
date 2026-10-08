// 모든 수치는 여기서만 조정한다. (튜닝 요청은 이 파일만 건드리면 됨)
import { PAL } from './palette';

export const CFG = {
  // 거미(발끝 반경 약 5.4)가 움직일 공간을 위해 프로토타입(16)보다 약간 넓힘
  arena: { radius: 18, playerLimit: 17.3, pillars: 16 },

  // 플레이어와 보스를 함께 화면에 담도록: 초점 = 플레이어×followRatio + 보스×bossRatio
  camera: { fov: 32, distance: 46, elevationDeg: 58, followRatio: 0.25, bossRatio: 0.3, followMax: 6, smooth: 5 },

  player: {
    speed: 7.2,
    accel: 60,
    hitRadius: 0.32, // 피격 판정(눈에 보이는 몸보다 작게)
    bodyRadius: 0.5, // 보스 몸통과의 충돌용
    maxHp: 5,
    invuln: 0.8,
    turnSpeed: 16,
  },

  dash: { speed: 26, duration: 0.17, invuln: 0.25, cooldown: 1.2, ghostEvery: 0.022 },

  arrow: { speed: 32, life: 1.0, fireRate: 7, damage: 1, radius: 0.2, pool: 80 },

  special: {
    max: 100,
    chargePerDamage: 0.6, // 봇 테스트 결과: 2.4일 때 21초 동안 4번 사용됨 → 한 전투에 약 1회 수준으로 낮춤
    radius: 6.5,
    damage: 40,
    throwTime: 0.42,
    maxRange: 11,
    minRange: 2.5,
    relightDelay: 0.5,
    relightTime: 1.0,
  },

  // 체력(1~5) = 등불 밝기. 1칸이어도 바닥/마커가 읽히도록 하한을 둔다.
  lantern: {
    color: PAL.lantern,
    intensityByHp: [4, 7, 11, 16, 22],
    distanceByHp: [8, 10, 12, 14, 16],
    decay: 1.2,
  },

  /**
   * 보스 1 — 동굴 여왕 거미. 배열 값은 [페이즈1, 페이즈2].
   * 시간은 초, 거리는 월드 단위(플레이어 키 ≈ 1.8).
   */
  spider: {
    name: '동굴 여왕 거미',
    maxHp: 1100,
    phase2At: 0.5, // 체력 50% 이하에서 포효 후 페이즈 2
    weakMult: 2, // 배(약점) 피해 배율
    exposedMult: 3, // 후딜(약점 노출) 중 배 피해 배율
    thoraxR: 1.7, // 몸통(머리가슴) 판정 반경
    abdomenR: 2.0, // 배 판정 반경
    legBlockR: 0.5, // 다리가 화살을 막는 두께
    start: { x: 0, z: -4.5 },

    speed: [4.4, 5.6], // 걷는 속도
    turn: [1.9, 2.6], // 회전 속도 (rad/s)
    holdDist: 7.5, // 이 거리보다 멀면 다가옴
    idlePause: [0.85, 0.5], // 공격 사이 대기
    tempo: [1, 0.78], // 예비동작 길이 배율 (낮을수록 빠름)

    sequence: [
      ['pounce', 'web', 'barrage', 'pounce', 'barrage', 'web'],
      ['triple', 'eggs', 'web', 'barrage', 'pounce', 'eggs', 'triple', 'barrage'],
    ],

    // 거미줄 발사: 예고선 → 조준 투사체 (맞으면 감속, 대시로 벗어남)
    web: { windup: 0.95, recover: 0.6, speed: 21, radius: 0.5, slow: 2.4, lineW: 1.3, fanAngle: 0.3 },
    // 점프 덮치기: 웅크림 → 착지 마커 → 도약 → 착지 충격파 → 약점 노출
    pounce: { crouch: 0.62, flight: 0.62, radius: 5.0, peak: 7.5, recover: [1.8, 1.5] },
    // 연속 점프 (페이즈 2)
    triple: { count: 3, crouch: 0.38, flight: 0.5, radius: 4.4, gap: 0.1, recover: 2.5, peak: 6 },
    // 독침 탄막: 뒤돌아서 배를 치켜들고 부채꼴 발사
    barrage: { turn: 0.42, windup: 0.95, speed: 11.5, radius: 0.4, count: [5, 7], spread: [0.95, 1.3], volleys: [1, 2], volleyGap: 0.55, recover: 1.6 },
    // 알 투척 (페이즈 2): 알 2개 → 일정 시간 뒤 부화
    eggs: { windup: 0.9, count: 2, flight: 0.85, hatch: 2.0, eggHp: 4, babies: 2, recover: 1.2, maxMinions: 6 },
    baby: { hp: 2, speed: [6.0, 7.0], radius: 0.55 },
    stagger: 2.4, // 새끼를 모두 처치했을 때 여왕이 휘청이는 시간
    roar: 2.3, // 페이즈 전환 포효 (이 동안 무적)
  },

  fx: { maxParticles: 700 },
} as const;
