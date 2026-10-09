/** 난이도: 플레이어 체력(불꽃 칸 수)만 달라진다. 보스 시작 전 화면에서 고른다. */
export type DiffKey = 'normal' | 'hard' | 'crazy';

export const DIFFS: Record<DiffKey, { label: string; hp: number; note: string }> = {
  normal: { label: '노멀', hp: 5, note: '체력 5칸' },
  hard: { label: '하드', hp: 3, note: '체력 3칸' },
  crazy: { label: '크레이지', hp: 1, note: '체력 1칸' },
};

const KEY = 'deepnest.difficulty';

function load(): DiffKey {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'normal' || v === 'hard' || v === 'crazy') return v;
  } catch {
    /* 저장소를 못 쓰는 환경이면 기본값 */
  }
  return 'normal';
}

/** 지금 고른 난이도 (게임 중에 읽는 값은 전부 여기서 읽는다) */
export const DIFF: { key: DiffKey; hp: number } = (() => {
  const k = load();
  return { key: k, hp: DIFFS[k].hp };
})();

export function setDifficulty(k: DiffKey) {
  DIFF.key = k;
  DIFF.hp = DIFFS[k].hp;
  try {
    localStorage.setItem(KEY, k);
  } catch {
    /* ignore */
  }
}
