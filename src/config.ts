// 모든 수치는 여기서만 조정한다. (튜닝 요청은 이 파일만 건드리면 됨)
import { PAL } from './palette';

export const CFG = {
  // 거미(발끝 반경 약 5.4)가 움직일 공간을 위해 프로토타입(16)보다 약간 넓힘
  // pillarR: 기둥이 서 있는 반경. 플레이어(playerLimit)와 카메라(camera.wallLimit)가 갈 수 있는 곳보다 바깥
  arena: { radius: 18, playerLimit: 17.3, pillars: 16, pillarR: 27 },

  // 플레이어와 보스를 함께 화면에 담도록: 초점 = 플레이어×followRatio + 보스×bossRatio
  // 어깨 너머 3인칭: 플레이어 뒤·위에서 바라본다. 마우스로 시점(좌우/상하)을 돌린다.
  camera: {
    fov: 62,
    dist: 5.6, // 어깨(피벗)에서 카메라까지 거리
    pivotY: 2.3, // 피벗 높이 (머리 높이쯤)
    shoulder: 0.75, // 오른쪽 어깨 쪽으로 치우친 정도
    pitchDeg: 6, // 기본 내려다보는 각도 (+ = 아래)
    pitchMin: -38, // 가장 높이 올려다보는 각도 (음수 = 위)
    pitchMax: 68, // 52°에서는 발치 1.8칸 안쪽 바닥을 조준할 수 없었다 (새끼 거미가 붙었을 때)
    sens: 0.0022, // 마우스 감도 (라디안/픽셀)
    lockSmooth: 7, // 락온 시 카메라가 보스를 따라 도는 속도
    wallLimit: 20.4, // 이 반경 밖으로는 카메라가 나가지 않는다 (외벽 안쪽)
    minDist: 1.9,
    lookUpLift: 6, // 위를 볼수록 시점 중심(피벗)이 이만큼(×sin) 올라가서, 카메라가 바닥에 파묻히지 않고 캐릭터에서 떨어져 있게 한다
    floorY: 0.5, // 위를 볼 때 카메라가 이 높이 아래로 내려가지 않도록 캐릭터 쪽으로 당겨진다
  },

  player: {
    speed: 7.2,
    accel: 60,
    hitRadius: 0.32, // 피격 판정(눈에 보이는 몸보다 작게)
    bodyRadius: 0.5, // 보스 몸통과의 충돌용
    maxHp: 5,
    invuln: 0.8,
    turnSpeed: 16,
  },

  dash: { speed: 26, duration: 0.17, invuln: 0.25, cooldown: 1.2 },

  // 불꽃 차징: 마우스 왼쪽 버튼을 누르고 있으면 불꽃이 모이고(0~1), 떼면 조준점으로 발사. 배열은 [최소 차징, 완전 차징].
  // (이름은 예전 화살 시절 그대로 arrow)
  arrow: {
    chargeTime: 0.8, // 완전히 당기는 데 걸리는 시간(초)
    minPower: 0.14, // 톡 눌렀다 뗐을 때의 최소 위력(0~1)
    recover: 0.16, // 발사 후 다음 차징을 시작할 수 있을 때까지
    damage: [0.8, 14], // [최소, 완전 차징]
    damageCurve: 2.5, // 클수록 많이 모은 쪽에 위력이 몰린다 (위력 = 최소 + (최대-최소) × 차징^곡선)
    speed: [22, 44],
    radius: [0.2, 0.5],
    life: 1.3,
    pool: 40,
  },

  // 완전히 모은 불꽃: 착탄 지점 범위 즉시 피해(스플래시) + 일정 시간 타오르는 불꽃 장판
  flame: {
    fullAt: 0.95, // 이 이상 모으면 완전 차징: 맞은 곳에서 폭발한다
    splashRadius: 3.6, // 폭발 반경
    splashMult: 1, // 폭발 피해 = 불꽃 자신의 피해 × 이 값 (1 = 직격과 같음). 직접 맞은 대상은 한 번만 맞는다
  },

  special: {
    max: 100,
    chargePerDamage: 0.3, // 주는 피해에 비례해 채워진다. 차징 피해가 약 2배가 되면서 0.6 → 0.3 (초당 충전량은 이전과 비슷)
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
   * 보스 1 — 동굴 여왕 거미. 배열 값은 [페이즈1, 페이즈2, 페이즈3].
   * 시간은 초, 거리는 월드 단위(플레이어 키 ≈ 1.8).
   * 투사체 공격(web/barrage)은 날아오는 시간도 회피 시간이므로 예고(windup)를 짧게 잡는다.
   */
  spider: {
    name: '동굴 여왕 거미',
    maxHp: 1100,
    phaseAt: [0.67, 0.34], // 체력이 이 비율 이하가 되면 포효 후 다음 페이즈 (페이즈 2, 3)
    weakMult: 2, // 배(약점) 피해 배율
    exposedMult: 3, // 후딜(약점 노출) 중 배 피해 배율
    thoraxR: 1.7, // 몸통(머리가슴) 판정 반경
    abdomenR: 2.0, // 배 판정 반경
    legBlockR: 0.5, // 다리 판정 두께
    legMult: 1, // 다리에 맞았을 때 피해 배율 (몸통 = 1)
    start: { x: 0, z: -4.5 },

    speed: [4.6, 5.8, 6.6], // 걷는 속도
    turn: [2.0, 2.7, 3.3], // 회전 속도 (rad/s)
    holdDist: 7.5, // 이 거리보다 멀면 다가옴
    idlePause: [0.75, 0.48, 0.3], // 공격 사이 대기
    tempo: [1, 0.8, 0.68], // 예비동작 길이 배율 (낮을수록 빠름) — 점프/알 투척에 적용

    sequence: [
      ['pounce', 'web', 'barrage', 'pounce', 'webtrap', 'barrage', 'web'],
      ['triple', 'eggs', 'webtrap', 'barrage', 'pounce', 'eggs', 'web', 'triple', 'barrage', 'webtrap'],
      ['webtrap', 'triple', 'barrage', 'pounce', 'web', 'eggs', 'triple', 'webtrap', 'barrage', 'eggs'],
    ],

    // 거미줄 발사: 예고선 → 조준 투사체 (맞으면 감속, 대시로 벗어남). 페이즈 2~: 3갈래, 페이즈 3: 같은 갈래로 2연발
    web: { windup: [0.66, 0.56, 0.5], recover: 0.55, speed: [25, 26, 28], radius: 0.5, slow: 2.4, lineW: 1.3, fanAngle: [0, 0.3, 0.34], volleys: [1, 1, 2], volleyGap: 0.38 },
    // 점프 덮치기: 웅크림 → 착지 마커 → 도약 → 착지 충격파 → 약점 노출 (마커가 보이는 시간 ≈ crouch×0.6 + flight)
    pounce: { crouch: 0.5, flight: 0.52, radius: 5.0, peak: 7.5, recover: [1.8, 1.5, 1.25] },
    // 연속 점프 (페이즈 2~). 마커가 보이는 시간 ≈ crouch×0.6 + flight. 착지 지점은 '그때 서 있던 자리'라서
    // 가만히 달려서 벗어나려면 (마커 시간 × 걷는 속도 7.2) > radius + 0.32 여야 한다 — 이보다 짧으면 대시 없이는 못 피한다.
    triple: { count: [3, 3, 4], crouch: 0.34, flight: 0.46, radius: 4.0, gap: 0.1, recover: [2.5, 2.5, 2.1], peak: 6 },
    // 독침 탄막: 뒤돌아서 배를 치켜들고 부채꼴 발사
    barrage: { turn: 0.38, windup: [0.62, 0.52, 0.46], speed: [14, 15, 16.5], radius: 0.4, count: [5, 7, 9], spread: [0.95, 1.3, 1.5], volleys: [1, 2, 3], volleyGap: 0.5, recover: [1.6, 1.5, 1.4] },
    // 거미줄 장판: 거미줄 덩어리를 던져 바닥에 끈끈한 장판을 남긴다. 장판 위에서는 이동이 느려진다(데미지 없음, 대시로 빠져나옴)
    trap: {
      windup: [0.7, 0.6, 0.5],
      flight: 0.8, // 덩어리가 날아가는 시간 = 착지 지점 표시 시간
      peak: 6,
      count: [3, 3, 4],
      gap: 0.14,
      radius: 3.0,
      life: [8, 9, 10], // 장판이 남아 있는 시간
      maxZones: 8,
      slow: 0.35, // 장판 위에 있는 동안 계속 갱신되는 감속 지속시간
      slowMul: 0.33, // 장판 위 이동 속도 배율 (거미줄 탄은 0.5 → 장판은 약 1.5배 더 느리다)
      recover: 1.2,
    },
    // 알 투척 (페이즈 2~): 알 2개 → 일정 시간 뒤 부화. 알은 체력이 있어 깨뜨리면 새끼가 나오지 않는다
    // eggHp: 만땅 차징(14) 1발이면 깨진다 — 대신 부화(2.0초) 전에 차징을 끝내고 맞혀야 한다. 덜 모은 불꽃이면 2발 이상
    eggs: { windup: 0.9, count: 2, flight: 0.85, hatch: 2.0, eggHp: 13, babies: 2, recover: 1.2, maxMinions: 6 },
    baby: { hp: 2, speed: [6.0, 7.0, 7.8], radius: 0.55 },
    stagger: 2.4, // 새끼를 모두 처치했을 때 여왕이 휘청이는 시간
    roar: 2.3, // 페이즈 전환 포효 (이 동안 무적)
  },

  fx: { maxParticles: 700 },
} as const;
