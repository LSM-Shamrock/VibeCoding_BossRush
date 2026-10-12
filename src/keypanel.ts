import { ACTIONS, codeLabel, type ActionId, type Keybinds } from './keybinds';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * 일시정지 화면에 들어가는 "조작 키" 패널.
 * 칸을 클릭 → 바꿀 키를 누르면 지정 / Esc 취소 / Backspace 비우기.
 * 입력 대기 중에는 키 이벤트를 캡처 단계에서 가로채므로, 누른 키가 게임 동작(일시정지 해제 등)으로 새지 않는다.
 */
export class KeyPanel {
  readonly el = document.createElement('div');
  private grid = document.createElement('div');
  private msgEl = document.createElement('div');
  private listen: { action: ActionId; slot: 0 | 1 } | null = null;

  constructor(private binds: Keybinds) {
    this.el.className = 'keypanel';
    this.grid.className = 'kp-grid';
    this.msgEl.className = 'kp-msg';
    this.setMsg('', '');

    const top = document.createElement('div');
    top.className = 'kp-top';
    const head = document.createElement('div');
    head.className = 'kp-head';
    const ttl = document.createElement('span');
    ttl.textContent = '조작 키';
    head.append(ttl, this.msgEl);
    const rs = document.createElement('span');
    rs.className = 'kp-btn';
    rs.setAttribute('role', 'button');
    rs.dataset.do = 'reset';
    rs.textContent = '기본값';
    head.append(rs);
    top.append(head);
    const body = document.createElement('div');
    body.className = 'kp-body';

    // 바꿀 수 없는 키: 위 표와 같은 칸 구조로 한 줄씩
    const row = (label: string, value: string) => `<div class="kp-label">${label}</div><div class="kp-val">${value}</div>`;
    const fixed = document.createElement('div');
    fixed.className = 'kp-grid kp-fixed';
    fixed.innerHTML =
      row('시점 회전 / 조준', '마우스') +
      row('락온', '마우스 휠 클릭') +
      row('불꽃 쏘기', '왼쪽 버튼 (길게 눌러 모으고 떼면 발사)') +
      row('설정 / 일시정지', 'Esc') +
      row('확인', 'Enter · 클릭');

    const dbg = document.createElement('details');
    dbg.className = 'kp-debug';
    dbg.innerHTML =
      '<summary>디버그 키</summary><div class="kp-grid">' +
      [
        ['무적', '1'], ['체력 -1', '2'], ['체력 +1', '3'], ['특수 게이지 충전', '4'], ['보스 공격 켜기/끄기', '5'],
        ['보스 재시작', '6'], ['다음 페이즈', '7'], ['보스 체력 5%', '8'], ['다음 공격 강제', '9'], ['다음 층 보스로', '0'], ['디버그 표시', '`'],
      ]
        .map(([l, k]) => row(l, `<b>${k}</b>`))
        .join('') +
      '</div>';

    body.append(this.grid, fixed, dbg);
    this.el.append(top, body);

    this.el.addEventListener('click', (e) => {
      e.stopPropagation(); // 오버레이 클릭(= 계속하기)으로 번지지 않게
      this.click(e.target as HTMLElement);
    });
    window.addEventListener('blur', () => this.cancel());
    this.render();
  }

  /** 일시정지 화면이 열릴 때 */
  get listening() {
    return !!this.listen;
  }
  open() {
    this.cancel(true);
    this.setMsg('', '');
    this.render();
  }
  /** 닫힐 때 (입력 대기 중이었다면 해제) */
  close() {
    this.cancel(true);
  }

  private click(t: HTMLElement) {
    const cap = t.closest<HTMLElement>('[data-slot]');
    if (cap) {
      const action = cap.dataset.action as ActionId;
      const slot = Number(cap.dataset.slot) as 0 | 1;
      if (this.listen && this.listen.action === action && this.listen.slot === slot) this.cancel();
      else this.startListen(action, slot);
      return;
    }
    if (t.closest('[data-do="reset"]')) {
      this.cancel(true);
      this.binds.reset();
      this.setMsg('기본 키로 되돌렸습니다', 'ok');
      this.render();
      return;
    }
    this.cancel(); // 패널의 다른 곳을 누르면 입력 대기만 취소
  }

  private startListen(action: ActionId, slot: 0 | 1) {
    this.cancel(true);
    this.listen = { action, slot };
    window.addEventListener('keydown', this.onKey, true);
    this.setMsg('바꿀 키를 누르세요 · Esc 취소 · Backspace 비우기', 'hint');
    this.render();
  }

  private cancel(silent = false) {
    if (!this.listen) return;
    this.listen = null;
    window.removeEventListener('keydown', this.onKey, true);
    if (!silent) {
      this.setMsg('', '');
      this.render();
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const l = this.listen;
    if (!l) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // 게임 입력(Input)에는 전달하지 않는다
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.cancel();
      return;
    }
    const res = e.code === 'Backspace' || e.code === 'Delete' ? this.binds.clear(l.action, l.slot) : this.binds.assign(l.action, l.slot, e.code);
    if (res.ok) {
      this.cancel(true);
      this.setMsg(res.msg, res.msg ? 'ok' : '');
    } else {
      this.setMsg(res.msg, 'err'); // 계속 입력 대기
    }
    this.render();
  };

  private setMsg(text: string, kind: 'ok' | 'err' | 'hint' | '') {
    this.msgEl.textContent = text || '칸을 클릭해 키 변경';
    this.msgEl.className = `kp-msg ${text ? kind : 'idle'}`;
  }

  private render() {
    const l = this.listen;
    this.grid.innerHTML =
      `<div class="kp-th"></div><div class="kp-th">기본</div><div class="kp-th">보조</div>` +
      ACTIONS.map((a, i) => {
        const sep = i > 0 && ACTIONS[i - 1].group !== a.group ? ' kp-sep' : '';
        const slots = this.binds.slots(a.id);
        const cell = (slot: 0 | 1) => {
          const code = slots[slot];
          const on = !!l && l.action === a.id && l.slot === slot;
          const cls = `keycap${on ? ' listening' : ''}${!code && !on ? ' empty' : ''}`;
          return `<div class="kp-cell${sep}"><span class="${cls}" role="button" data-action="${a.id}" data-slot="${slot}">${on ? '키를 누르세요' : esc(codeLabel(code))}</span></div>`;
        };
        return `<div class="kp-label${sep}">${esc(a.label)}${a.hint ? `<small>${esc(a.hint)}</small>` : ''}</div>${cell(0)}${cell(1)}`;
      }).join('');
  }
}
