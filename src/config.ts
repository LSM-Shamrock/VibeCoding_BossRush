// 모든 수치는 여기서만 조정한다. (튜닝 요청은 이 파일만 건드리면 됨)
import { PAL } from './palette';

export const CFG = {
  // 거미(발끝 반경 약 5.4)가 움직일 공간을 위해 프로토타입(16)보다 약간 넓힘
  // pillarR: 기둥이 서 있는 반경. 플레이어(playerLimit)와 카메라(camera.wallLimit)가 갈 수 있는 곳보다 바깥
  arena: { radius: 18, playerLimit: 17.3, pillars: 16, pillarR: 27 },
  // 2층 연못 석단: 반경 약 1.33배(18→24). 뱀이 몸을 펴고 돌아다닐 수 있는 넓이 (spawnZ = 플레이어 시작 z)
  pond: { radius: 24, spawnZ: 10.8 },
  // 3층 하늘 신전 제단: 구름 바다 위에 뜬 대리석 제단. 용(몸길이 ≈ 50, 날개폭 ≈ 45)은 하늘을 선회하므로 아레나는 반경만 넓다
  // 3층: 반경 24 → 96 (4배). 시작 위치도 넓어진 만큼 바깥쪽으로
  peak: { radius: 96, spawnZ: 30 },

  // 플레이어와 보스를 함께 화면에 담도록: 초점 = 플레이어×followRatio + 보스×bossRatio
  // 어깨 너머 3인칭: 플레이어 뒤·위에서 바라본다. 마우스로 시점(좌우/상하)을 돌린다.
  camera: {
    fov: 62,
    dist: 5.6, // 어깨(피벗)에서 카메라까지 거리
    pivotY: 2.3, // 피벗 높이 (머리 높이쯤)
    shoulder: 0.75, // 오른쪽 어깨 쪽으로 치우친 정도
    pitchDeg: 6, // 기본 내려다보는 각도 (+ = 아래)
    pitchMin: -62, // 가장 높이 올려다보는 각도 (음수 = 위)
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
    damageCurve: 1.5, // 클수록 많이 모은 쪽에 위력이 몰린다 (1 = 비례). 2.5 → 1.5: 덜 모은 불꽃과 완전 차징의 차이를 줄임 (위력 = 최소 + (최대-최소) × 차징^곡선)
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

  /**
   * 보스 2 — 심연의 이무기 (2층). 배열 값은 [페이즈1, 페이즈2, 페이즈3].
   * 머리가 약점이고 몸통은 단단하다(피해 ×bodyMult). 머리는 늘 움직이고, 땅속으로 숨기도 한다.
   * 정면으로 달려드는 공격(lunge/slam)은 '예고(tell)가 보이는 시간 × 걷는 속도 7.2 > 반경 + 0.32' 가 되게 잡았다.
   */
  serpent: {
    name: '심연의 이무기',
    floorLabel: '2층 · 이무기의 못',
    maxHp: 1200,
    phaseAt: [0.67, 0.34],
    headMult: 2, // 머리(약점) 피해 배율
    bodyMult: 0.6, // 몸통 피해 배율 — 맞히기는 쉽지만 덜 아프다
    exposedMult: 3, // 후딜(머리를 쳐들고 허점을 보일 때) 머리 피해 배율
    headR: 2.3, // 머리 판정 반경
    headScale: 1.4, // 머리 모델 배율
    bodyLen: 242, // 머리 중심에서 꼬리 끝까지
    bodyR: 1.65, // 가장 굵은 몸통 반지름
    start: { x: 0, z: -31 }, // 첫 등장 때 똬리의 중심
    limit: 3.6, // 머리가 아레나 벽에서 떨어져야 하는 거리

    // 사냥: 머리가 플레이어 둘레를 S자로 휘감듯 돌며 거리를 좁힌다. 몸은 머리가 지나간 길을 그대로 따라온다.
    hunt: {
      speed: [11, 13, 15],
      turn: 2.3, // 최대 선회 속도 (rad/s)
      weaveAmp: [0.8, 0.95, 1.1], // 좌우로 휘청이는 각도 (rad)
      weaveHz: 0.3,
      minTime: [2.4, 1.9, 1.5], // 공격과 공격 사이 최소 사냥 시간
      maxWait: 4.5, // 공격 거리대에 못 들어가도 이 시간이 지나면 시작
    },
    // 공격별 시작 거리대 (머리 ↔ 플레이어)
    band: { lunge: [10, 20], spit: [8, 18], slam: [6, 11], breath: [9, 15], dive: [0, 99], rimshot: [0, 99], rimcharge: [0, 99] },

    sequence: [
      ['lunge', 'spit', 'rimshot', 'breath', 'lunge', 'spit', 'breath'],
      ['lunge', 'dive', 'breath', 'slam', 'spit', 'lunge', 'dive', 'slam'],
      ['dive', 'lunge', 'rimshot', 'breath', 'spit', 'lunge', 'rimcharge', 'slam', 'breath'],
    ],

    // 돌진: 몸을 쳐들고 좌우로 흔들며 노려봄(windup) → 조준 고정 후 직선 예고(tell) → 일직선으로 쏜살같이 물어뜯음.
    // 페이즈가 오르면 방향을 바꿔 연속 돌진. 후딜에는 머리를 쳐든 채 똬리를 튼다 (약점 노출).
    lunge: { windup: [0.7, 0.58, 0.48], tell: [0.64, 0.52, 0.44], speed: 105, reach: 110, width: 4.4, headHit: 2.1, count: [1, 2, 3], gap: 0.3, recover: [2.6, 2.3, 2.0] },
    // 독 뱉기: 몸을 세워 독액 덩어리 여러 개를 포물선으로 뱉는다 → 닿으면 아픈 독 웅덩이가 남는다
    spit: { windup: [0.9, 0.76, 0.64], flight: 0.9, peak: 8, count: [3, 4, 5], gap: 0.18, radius: 2.8, life: [7, 8, 9], maxPools: 12, tick: 1.0, recover: 1.7 },
    // 내려찍기: 높이 솟구쳤다가 예고 원 한가운데로 머리를 내리꽂는다 → 충격파 고리가 바깥으로 퍼진다.
    slam: { windup: [0.82, 0.7, 0.6], tell: [0.66, 0.56, 0.48], radius: 3.4, swoop: 0.28, waveSpeed: 7, waveDelay: 0.14, waveMax: 17, waveWidth: 1.1, count: [1, 1, 2], gap: 0.55, recover: [2.0, 1.8, 1.6] },
    // 독 뿜기: 부채꼴 예고 → 머리를 휘저으며 독 방울을 연달아 뿜는다
    breath: { windup: [1.0, 0.86, 0.74], dur: [1.0, 1.15, 1.3], interval: 0.065, half: 0.46, speed: [19, 21, 23], radius: 0.4, range: 56, recover: [1.8, 1.6, 1.5] },
    // 잠행: 땅속으로 파고들어 플레이어 발밑에서 연달아 솟구친다. 마지막엔 머리가 튀어나오며 몸이 새 자리에 감겨 솟는다 (약점 노출)
    dive: { sink: 0.6, count: [2, 3, 3], radius: 2.6, tell: [1.05, 0.92, 0.82], gap: [0.8, 0.66, 0.56], finalRadius: 3.3, recover: [2.6, 2.3, 2.0] },
    // 외곽 선회 (2페이즈~): 아레나 바깥(물 위)으로 나가 석단 둘레에 몸을 두르고 빙글 돌며 안쪽으로 독탄을 쏘거나, 가로질러 돌진한다.
    // wrap = 몸이 맵 안에 남았을 때 외곽을 돌며 감아 내는 머리 속도 (몸이 전부 밖으로 나온 뒤에야 공격)
    // out = 석단 가장자리에서 바깥으로 떨어진 거리(머리가 도는 반경 = 아레나 반경 + out)
    rim: { out: 5.5, enter: 1.7, back: 0.9, wrap: 85 },
    // 외곽 사격: 한 바퀴 넘게 돌며 플레이어를 겨눠 쏜다 (3페이즈는 3갈래)
    rimshot: { laps: [0.6, 1.2, 1.2], speed: [22, 30, 30], interval: [1.0, 0.6, 0.6], shot: [13, 16, 16], radius: 0.55, fan: 0.2, recover: [2.4, 2.2, 2.2] },
    // 외곽 돌진: 반 바퀴쯤 돌다가 플레이어를 겨눈 일직선으로 맵을 가로질러 반대편 바깥까지 내달린다. 마지막엔 안쪽에서 똬리 + 약점 노출
    rimcharge: { laps: [0.65, 0.65, 0.65], speed: [30, 30, 30], count: [3, 3, 3], windup: [0.6, 0.6, 0.6], tell: [0.7, 0.7, 0.7], charge: 100, width: 4.4, headHit: 2.1, gap: 0.35, recover: [2.2, 2.2, 2.2] },
    // 몸통 접촉: 이 시간(초) 동안 계속 닿아 있으면 체력 1 (꼬리 끝은 제외)
    contact: { hurtAfter: 1.7 }, // 몸에 닿은 채 이 시간(초)이 지나면 체력 1. 그동안 화면 보랏빛이 0 → 100% 로 짙어진다
    roar: 2.6, // 페이즈 전환 포효 (이 동안 무적)
  },

  /**
   * 보스 3 — 겁화의 용 (마지막 보스). 하늘을 선회하며 싸운다. 배열 값은 [페이즈1, 페이즈2, 페이즈3].
   * 예고(tell)가 보이는 시간은 (시간 × 달리기 7.2) > 반경 + 0.32 가 되게 잡아 달리기만으로 피할 수 있다. 대시는 충격파 · 광선 추격용.
   */
  dragon: {
    name: '겁화의 용',
    floorLabel: '3층 · 하늘 신전',
    maxHp: 1300, // 이전 1500 → 약 절반을 원했지만 이무기(1200)보다는 높아야 해서 1300
    phaseAt: [0.67, 0.34],
    headMult: 1.5, // 머리 피해 배율
    bodyMult: 0.7, // 몸통
    wingMult: 0.5, // 날개
    exposedMult: 3, // 추락해 쓰러진 동안 머리 피해 배율

    // 평소 비행: 플레이어 쪽으로 치우친 중심 둘레를 원을 그리며 선회한다 (몸통이 그 궤적을 따라 휘감긴다)
    cruise: { radius: [33, 30, 27], alt: [27, 26, 25], speed: [20, 24, 28], turn: [0.8, 0.95, 1.1], follow: 0.45 },
    idle: [1.7, 1.2, 0.85],

    sequence: [
      ['spit', 'strafe', 'swoop', 'spit', 'strafe', 'swoop'],
      ['meteor', 'strafe', 'crash', 'spit', 'swoop', 'meteor', 'strafe', 'crash'],
      ['sunray', 'gale', 'strafe', 'crash', 'meteor', 'sunray', 'swoop', 'gale', 'spit', 'crash'],
    ],

    // 화염탄: 입에 불을 모았다가 불덩이를 연달아 던진다. 착지 고리가 차오른다. (페이즈 2~: 바닥에 불이 남는다)
    spit: { windup: [1.0, 0.85, 0.7], count: [3, 4, 5], gap: 0.34, flight: 1.2, peak: 9, radius: 2.9, zone: [0, 5, 6], spread: 4.6, recover: 0.9 },
    // 화염 숨결 통과: 바닥에 긴 예고선 → 용이 선을 따라 낮게 날며 불을 뿜는다. 지나간 자리는 한동안 불탄다
    strafe: { tell: [1.55, 1.4, 1.25], width: 5.2, speed: [34, 38, 42], passes: [1, 2, 2], burnR: 2.7, burnLife: 2.6 },
    // 저공 돌진: 굵은 예고선 → 땅 위를 스치듯 날아오며 머리와 몸통으로 쓸어버린다
    swoop: { tell: [1.2, 1.05, 0.95], width: 6.8, speed: [44, 48, 52], passes: [1, 1, 2] },
    // 유성우 (페이즈 2~): 용이 하늘 높이 올라 포효하면 불타는 유성이 쏟아진다
    meteor: { count: [0, 8, 12], gap: [0.3, 0.3, 0.22], tell: 1.35, radius: 3.1, zone: [0, 0, 4] },
    // 추락 강타 (페이즈 2~): 하늘에서 표적 위로 내리꽂아 충격파를 일으키고, 쓰러져 약점이 드러난다
    crash: { tell: [1.7, 1.7, 1.5], radius: 7.0, stun: [3.6, 3.6, 3.0], wave: 18 },
    // 태양 광선 (페이즈 3): 입가에 태양을 모아 쏜다. 광선의 조준점이 플레이어를 끈질기게 쫓는다
    sunray: { charge: 2.3, dur: 4.4, chase: 7.3, radius: 2.4, lock: 1.0 },
    // 날개 충격파 (페이즈 3): 제단 위에서 날개를 내리칠 때마다 땅을 훑는 불꽃 고리가 퍼진다
    gale: { beats: 3, gap: 1.4, tell: 0.85, speed: 14, width: 1.5, radius: 3.8 },
    roar: 3.0, // 페이즈 전환 포효 (이 동안 무적)
  },

  fx: { maxParticles: 1200 },
} as const;
