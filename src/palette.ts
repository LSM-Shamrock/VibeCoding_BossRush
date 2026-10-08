/**
 * 색상 규칙 (유적 · 붉은색/황금색 계열)
 *
 *   금색·호박색  = 플레이어 / 아군 / 보스의 약점   (등불, 화살, 대시, 특수기, 약점 주머니)
 *   붉은색       = 위험                           (예고 마커, 보스 탄, 피격)
 *   상아·뼈색    = 거미줄, 알, 송곳니 같은 중립 요소
 *   돌/모래/암갈색 = 배경
 *
 * 배경이 따뜻한 색이므로 위험 표시는 "색상 대비" 대신 "밝기 대비"(발광 + 밝은 테두리)로 읽히게 한다.
 */
export const PAL = {
  // 플레이어 / 아군 (금·호박)
  lantern: 0xffc46a,
  lanternHot: 0xffe6b0,
  gold: 0xffd27a,
  goldDeep: 0xc9962e,
  glow: 0xffd9a0,

  // 불 / 불씨
  flame: 0xff8a2a,
  flameHot: 0xffd060,
  ember: 0xff5a1f,

  // 위험 (붉은색)
  danger: 0xff3b30,
  dangerFill: 0xff5a3c,
  dangerRim: 0xffb89a,
  blood: 0xff2e2e,

  // 중립
  ivory: 0xf3e6c8,
  bone: 0xcfc4a8,
  dust: 0xb8a58a,

  // 배경
  fog: 0x1b0d08,
  void: 0x0d0604,
  stoneDark: 0x3a2b22,
  stoneMid: 0x6a5242,
  stoneLight: 0x8f7660,
} as const;
