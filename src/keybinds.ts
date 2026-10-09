/**
 * 키 설정. 동작(ActionId) 하나에 키를 최대 2개(기본/보조)까지 지정할 수 있다.
 * 키는 물리적 위치(KeyboardEvent.code)로 저장하므로 한/영 전환이나 자판 배열과 무관하게 동작한다.
 */
export type ActionId = 'up' | 'down' | 'left' | 'right' | 'dash' | 'special' | 'lockon' | 'mute' | 'retry';

export interface ActionInfo {
  id: ActionId;
  label: string;
  hint: string;
  group: 'move' | 'combat' | 'system';
  defaults: readonly [string, string | null];
}

export const ACTIONS: readonly ActionInfo[] = [
  { id: 'up', label: '위로 이동', hint: '', group: 'move', defaults: ['KeyW', 'ArrowUp'] },
  { id: 'down', label: '아래로 이동', hint: '', group: 'move', defaults: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: '왼쪽으로 이동', hint: '', group: 'move', defaults: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: '오른쪽으로 이동', hint: '', group: 'move', defaults: ['KeyD', 'ArrowRight'] },
  { id: 'dash', label: '대시', hint: '짧은 무적', group: 'combat', defaults: ['Space', null] },
  { id: 'special', label: '특수기', hint: '게이지가 가득 찼을 때', group: 'combat', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'lockon', label: '락온 (보스 주시)', hint: '마우스 휠 클릭으로도 가능', group: 'combat', defaults: ['KeyE', null] },
  { id: 'mute', label: '소리 켜기/끄기', hint: '', group: 'system', defaults: ['KeyM', null] },
  { id: 'retry', label: '재도전', hint: '패배·클리어 화면에서', group: 'system', defaults: ['KeyR', null] },
];

const INFO = new Map(ACTIONS.map((a) => [a.id, a]));
export const actionLabel = (id: ActionId) => INFO.get(id)!.label;

type Pair = [string | null, string | null];

const STORE_KEY = 'deepnest.keys.v1';

/* ───────────── 지정할 수 없는 키 ───────────── */
const FIXED_REASON: Record<string, string> = {
  Escape: 'Esc는 일시정지 전용 키라 바꿀 수 없습니다',
  Enter: 'Enter는 확인/계속 전용 키라 지정할 수 없습니다',
  NumpadEnter: 'Enter는 확인/계속 전용 키라 지정할 수 없습니다',
  Backquote: '` 키는 개발용 디버그 키라 지정할 수 없습니다',
};
const DENY = new Set([
  'Tab', 'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen', 'ContextMenu',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight',
  'Lang1', 'Lang2', 'Lang3', 'Lang4', 'Lang5', 'HangulMode', 'HanjaMode', 'Convert', 'NonConvert', 'KanaMode', 'Unidentified',
]);

/** 사용할 수 없는 이유 (지정 가능하면 null). Backspace/Delete 는 "비우기" 키라 여기서는 거부만 한다. */
export function denyReason(code: string): string | null {
  if (!code) return '인식할 수 없는 키입니다';
  if (FIXED_REASON[code]) return FIXED_REASON[code];
  if (/^Digit[0-9]$/.test(code)) return '숫자 0~9 키는 개발용 디버그 키라 지정할 수 없습니다';
  if (/^F\d{1,2}$/.test(code)) return '기능 키(F1~F12)는 브라우저가 쓰므로 지정할 수 없습니다';
  if (code === 'Backspace' || code === 'Delete') return '이 키는 칸을 비우는 데 쓰입니다';
  if (DENY.has(code)) return '지정할 수 없는 키입니다';
  return null;
}

/* ───────────── 표시용 이름 ───────────── */
const NAMES: Record<string, string> = {
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: '왼쪽 Ctrl',
  ControlRight: '오른쪽 Ctrl',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
};

export function codeLabel(code: string | null): string {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return `Num ${m[1]}`;
  return code;
}

export interface AssignResult {
  ok: boolean;
  msg: string;
}

export class Keybinds {
  private map = new Map<ActionId, Pair>();
  private listeners: (() => void)[] = [];

  constructor() {
    this.setDefaults();
    this.load();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** 이 동작에 지정된 키 (기본 → 보조 순, 비어 있으면 제외) */
  keys(a: ActionId): string[] {
    const p = this.map.get(a)!;
    return p.filter((k): k is string => !!k);
  }
  slots(a: ActionId): Readonly<Pair> {
    return this.map.get(a)!;
  }
  isBound(code: string) {
    for (const p of this.map.values()) if (p[0] === code || p[1] === code) return true;
    return false;
  }

  /** UI 문구용: 기본 키 이름 */
  label(a: ActionId) {
    return codeLabel(this.map.get(a)![0]);
  }
  /** UI 문구용: 이동 키 요약 (예: "W A S D") */
  moveSummary() {
    return (['up', 'left', 'down', 'right'] as const).map((a) => this.label(a)).join(' ');
  }

  /** (action, slot) 칸에 키를 지정한다. 다른 동작이 쓰던 키면 그쪽에서 빼 오거나 서로 교환한다. */
  assign(action: ActionId, slot: 0 | 1, code: string): AssignResult {
    const why = denyReason(code);
    if (why) return { ok: false, msg: why };
    const cur = this.map.get(action)!;
    if (cur[slot] === code) return { ok: true, msg: '' };

    const snap = this.snapshot();
    const old = cur[slot];
    let msg = `${actionLabel(action)} ← ${codeLabel(code)}`;

    let hit: { a: ActionId; s: 0 | 1 } | null = null;
    for (const [a, p] of this.map) {
      for (const s of [0, 1] as const) {
        if (p[s] === code && !(a === action && s === slot)) hit = { a, s };
      }
    }

    cur[slot] = code;
    if (hit) {
      const other = this.map.get(hit.a)!;
      other[hit.s] = null;
      if (!other[0] && !other[1]) {
        // 상대 동작의 하나뿐인 키를 가져온 경우: 내가 쓰던 키를 상대에게 넘겨 교환한다
        if (old) {
          other[hit.s] = old;
          msg = `${actionLabel(action)} ↔ ${actionLabel(hit.a)} 키를 서로 바꿨습니다`;
        } else {
          this.restore(snap);
          return { ok: false, msg: `${codeLabel(code)} 키는 '${actionLabel(hit.a)}'의 유일한 키라 가져올 수 없습니다` };
        }
      } else if (hit.a !== action) {
        msg = `${actionLabel(action)} ← ${codeLabel(code)}  ('${actionLabel(hit.a)}'에서는 해제됨)`;
      }
    }
    this.normalize();
    this.commit();
    return { ok: true, msg };
  }

  /** 칸 비우기. 동작에 키가 하나도 안 남게 되면 거부한다. */
  clear(action: ActionId, slot: 0 | 1): AssignResult {
    const cur = this.map.get(action)!;
    if (!cur[slot]) return { ok: true, msg: '' };
    if (this.keys(action).length <= 1) return { ok: false, msg: '마지막 남은 키는 비울 수 없습니다 (다른 키로 바꿔 주세요)' };
    cur[slot] = null;
    this.normalize();
    this.commit();
    return { ok: true, msg: `${actionLabel(action)}의 키를 비웠습니다` };
  }

  reset() {
    this.setDefaults();
    this.commit();
  }

  /* ───────────── 내부 ───────────── */
  private setDefaults() {
    this.map.clear();
    for (const a of ACTIONS) this.map.set(a.id, [a.defaults[0], a.defaults[1]]);
  }

  private snapshot(): [ActionId, Pair][] {
    return [...this.map].map(([a, p]) => [a, [p[0], p[1]] as Pair]);
  }
  private restore(s: [ActionId, Pair][]) {
    this.map = new Map(s);
  }

  /** 기본 칸이 비고 보조 칸만 남았으면 앞으로 당긴다 */
  private normalize() {
    for (const p of this.map.values()) {
      if (!p[0] && p[1]) {
        p[0] = p[1];
        p[1] = null;
      }
    }
  }

  private commit() {
    try {
      const o: Record<string, Pair> = {};
      for (const [a, p] of this.map) o[a] = p;
      localStorage.setItem(STORE_KEY, JSON.stringify(o));
    } catch {
      /* 저장소를 못 쓰는 환경이면 이번 접속 동안만 유지 */
    }
    for (const fn of this.listeners) fn();
  }

  private load() {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const next = new Map<ActionId, Pair>();
      const used = new Set<string>();
      for (const a of ACTIONS) {
        const v = o[a.id];
        if (!Array.isArray(v)) throw new Error('missing');
        const p: Pair = [null, null];
        for (const s of [0, 1] as const) {
          const k = v[s];
          if (k == null) continue;
          if (typeof k !== 'string' || denyReason(k) || used.has(k)) throw new Error('invalid');
          used.add(k);
          p[s] = k;
        }
        if (!p[0] && !p[1]) throw new Error('empty');
        next.set(a.id, p);
      }
      this.map = next;
      this.normalize();
    } catch {
      // 손상되었거나 규칙에 안 맞는 저장값은 버리고 기본값 사용
      this.setDefaults();
    }
  }
}
