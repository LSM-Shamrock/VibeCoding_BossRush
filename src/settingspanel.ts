import type { KeyPanel } from './keypanel';
import type { Sfx } from './audio';

/** 설정 창: 왼쪽 탭(조작 키 / 사운드) + 오른쪽 내용. 보스 선택 화면과 일시정지 화면에서 같이 쓴다 */
export class SettingsPanel {
  readonly el = document.createElement('div');
  private tabs = document.createElement('div');
  private body = document.createElement('div');
  private tab: 'keys' | 'sound' = 'keys';

  constructor(
    private keys: KeyPanel,
    private sfx: Sfx,
  ) {
    this.el.className = 'settings';
    this.tabs.className = 'st-tabs';
    this.body.className = 'st-body';
    this.el.append(this.tabs, this.body);
    // 설정 창 안의 클릭은 뒤의 오버레이(= 계속하기/시작)로 번지지 않게 한다
    this.el.addEventListener('click', (e) => e.stopPropagation());
  }

  open() {
    this.tab = 'keys';
    this.render();
  }
  close() {
    this.keys.close();
  }

  private render() {
    this.tabs.replaceChildren();
    const mk = (id: 'keys' | 'sound', label: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `st-tab${this.tab === id ? ' sel' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        if (this.tab === id) return;
        if (this.tab === 'keys') this.keys.close(); // 키 입력 대기 중이었다면 해제
        this.tab = id;
        this.render();
      });
      this.tabs.append(b);
    };
    mk('keys', '조작 키');
    mk('sound', '사운드');
    this.body.replaceChildren();
    if (this.tab === 'keys') {
      this.keys.open();
      this.body.append(this.keys.el);
    } else {
      this.body.append(this.soundPane());
    }
  }

  private soundPane() {
    // 조작 키 탭과 같은 틀: 머리글 한 줄 + 한 줄짜리 행들
    const pane = document.createElement('div');
    pane.className = 'keypanel st-sound';
    pane.innerHTML = '<div class="kp-top"><div class="kp-head"><span>사운드</span><span class="kp-msg idle">슬라이더로 음량 조절</span></div></div>';
    const body = document.createElement('div');
    body.className = 'kp-body';
    const grid = document.createElement('div');
    grid.className = 'kp-grid st-grid';
    const row = (label: string, kind: 'sfx' | 'bgm') => {
      const l = document.createElement('div');
      l.className = 'kp-label';
      l.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.step = '1';
      slider.value = String(Math.round(this.sfx.vol[kind] * 100));
      const val = document.createElement('b');
      val.className = 'st-val';
      const sync = () => {
        val.textContent = `${slider.value}%`;
        slider.style.setProperty('--p', `${slider.value}%`);
      };
      sync();
      slider.addEventListener('input', () => {
        this.sfx.setVolume(kind, parseInt(slider.value, 10) / 100);
        sync();
      });
      // 효과음은 손을 뗄 때 짧게 들려줘서 크기를 가늠할 수 있게 한다
      if (kind === 'sfx') slider.addEventListener('change', () => { this.sfx.unlock(); this.sfx.ready(); });
      grid.append(l, slider, val);
    };
    row('효과음', 'sfx');
    row('배경 음악', 'bgm');
    body.append(grid);
    pane.append(body);
    return pane;
  }
}
