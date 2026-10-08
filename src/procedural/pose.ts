/**
 * PoseBlend — 이름 붙은 포즈(웅크림, 젖힘, 대기 ...)를 값 단위로 부드럽게 섞는 모듈.
 * 각 키마다 목표값과 따라가는 속도(rate)를 가지며, 공격 스크립트는 `to({...})` 로 목표만 바꿔주면 된다.
 * 보스의 "예비동작 → 공격 → 후딜" 모션을 전부 이 모듈로 연출한다 (뱀/용도 재사용 예정).
 */
export class PoseBlend<K extends string> {
  readonly cur: Record<K, number>;
  readonly tgt: Record<K, number>;
  private readonly rate: Record<K, number>;

  constructor(
    base: Record<K, number>,
    private defaultRate = 8,
  ) {
    this.cur = { ...base };
    this.tgt = { ...base };
    this.rate = {} as Record<K, number>;
    for (const k of Object.keys(base) as K[]) this.rate[k] = defaultRate;
  }

  /** 목표 포즈 설정. rate 를 주면 이번에 바뀌는 키들만 그 속도로 따라간다 (클수록 빠름) */
  to(p: Partial<Record<K, number>>, rate = this.defaultRate): void {
    for (const k of Object.keys(p) as K[]) {
      this.tgt[k] = p[k] as number;
      this.rate[k] = rate;
    }
  }

  /** 즉시 적용 (보간 없이) */
  snap(p: Partial<Record<K, number>>): void {
    for (const k of Object.keys(p) as K[]) {
      this.cur[k] = this.tgt[k] = p[k] as number;
    }
  }

  update(dt: number): void {
    for (const k of Object.keys(this.cur) as K[]) {
      this.cur[k] += (this.tgt[k] - this.cur[k]) * (1 - Math.exp(-this.rate[k] * dt));
    }
  }
}
