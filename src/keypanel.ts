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
    top.innerHTML = '<div class="kp-head"><span>조작 키</span><span class="kp-btn" role="button" data-do="reset">기본값으로 되돌리기</span></div>';
    top.append(this.msgEl);
    const body = document.createElement('div');
    body.className = 'kp-body';

    const fixed = document.createElement('div');
    fixed.className = 'kp-fixed';
    fixed.innerHTML = `
      <div><span>시점 회전 / 조준</span><b>마우스 (화면 중앙 조준점)</b></div>
      <div><span>락온</span><b>마우스 휠 클릭</b></div>
      <div><span>불꽃 쏘기</span><b>마우스 왼쪽 버튼을 누르고 있으면 불꽃이 모이고, 떼면 조준점으로 발사 (끝까지 모으면 맞은 곳에서 폭발해 주변 적에게 같은 피해)</b></div>
      <div><span>일시정지</span><b>Esc</b></div>
      <div><span>확인 / 계속</span><b>Enter · 클릭</b></div>`;

    const dbg = document.createElement('details');
    dbg.className = 'kp-debug';
    dbg.innerHTML = `
      <summary>개발용 디버그 키 (바꿀 수 없음)</summary>
      <div><b>1</b> 무적 · <b>2</b> 체력 -1 · <b>3</b> 체력 +1 · <b>4</b> 특수 게이지 충전</div>
      <div><b>5</b> 보스 공격 켜기/끄기 · <b>6</b> 보스 재시작 · <b>7</b> 다음 페이즈로 · <b>8</b> 보스 체력 5%</div>
      <div><b>9</b> 다음 공격 강제 (거미줄→점프→탄막→알→연속점프→거미줄 장판) · <b>\`</b> 디버그 표시</div>`;

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
    this.msgEl.textContent = text || '칸을 클릭한 뒤 바꿀 키를 누르세요';
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
