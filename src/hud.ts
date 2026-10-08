import * as THREE from 'three';
import { CFG } from './config';
import type { BossInfo, FloatKind } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HudState {
  hp: number;
  dashReady: number; // 0~1
  gauge: number; // 0~1
  boss: BossInfo | null;
  /** 등장 연출 중 체력바가 차오르는 비율(0~1). 전투 중에는 1 */
  bossReveal: number;
  god: boolean;
  muted: boolean;
  bossAttacks: boolean;
  slowed: boolean;
  fps: number;
  debug: string;
}

export class Hud {
  private lamps: HTMLElement[] = [];
  private hpSeen = false;
  private prevHp = -1;
  private hurtEl = $('hurt');
  private lowEl = $('lowhp');
  private dashFill = $('dashfill');
  private spFill = $('spfill');
  private spWrap = $('spwrap');
  private boss = $('bossbar');
  private bossName = $('bossname');
  private bossFill = $('bossfill');
  private bossChip = $('bosschip');
  private bossMarks = $('bossmarks');
  private bossTag = $('bosstag');
  private status = $('status');
  private fpsEl = $('fps');
  private dmgLayer = $('dmglayer');
  private overlay = $('overlay');
  private ovTitle = $('ovtitle');
  private ovBody = $('ovbody');
  private toastEl = $('toast');
  private bannerEl = $('banner');
  private bannerT = $('bt');
  private bannerS = $('bs');
  private debuff = $('debuff');
  private kDash = $('kdash');
  private kSpecial = $('kspecial');
  private kDebuff = $('kdebuff');
  private toastTimer = 0;
  private bannerTimer = 0;
  private v = new THREE.Vector3();
  private lastStatus = '';
  private marksKey = '';

  constructor(private camera: THREE.Camera) {
    const wrap = $('lamps');
    for (let i = 0; i < CFG.player.maxHp; i++) {
      const d = document.createElement('span');
      d.className = 'lamp';
      // 불꽃 모양: 바깥 불길(.fo) + 안쪽 심지(.fi)
      d.innerHTML =
        '<svg viewBox="0 0 24 32" aria-hidden="true">' +
        '<path class="fo" d="M12 1.5C12.6 7 19.6 10.6 20.6 18.6C21.5 25.6 17.5 30.6 12 30.6C6.5 30.6 2.5 26 3.2 19.4C3.6 15.2 6 12.8 7.6 10.2C8.2 12.4 9.3 13.7 10.7 14.1C10.2 9.6 10.6 5 12 1.5Z"/>' +
        '<path class="fi" d="M12 16.2C12.8 19.2 16.3 20.8 16.3 24.8C16.3 27.8 14.4 29.3 12 29.3C9.6 29.3 7.7 27.8 7.7 24.8C7.7 21.8 10.8 20.2 12 16.2Z"/>' +
        '</svg>';
      wrap.appendChild(d);
      this.lamps.push(d);
    }
  }

  update(s: HudState) {
    this.lamps.forEach((l, i) => {
      const off = i >= s.hp;
      // 방금 꺼진 칸은 붉게 번쩍이며 줄어든다
      if (off && !l.classList.contains('off') && this.hpSeen) {
        l.classList.remove('hit');
        void l.offsetWidth;
        l.classList.add('hit');
      }
      l.classList.toggle('off', off);
    });
    // 맞아서 체력이 줄어든 순간: 화면 가장자리가 붉게 번쩍인다. 체력이 1~2칸이면 계속 붉게 맥동한다.
    if (this.hpSeen && s.hp < this.prevHp) {
      this.hurtEl.classList.remove('on');
      void this.hurtEl.offsetWidth;
      this.hurtEl.classList.add('on');
    }
    this.prevHp = s.hp;
    this.lowEl.classList.toggle('on', s.hp > 0 && s.hp <= 2);
    this.lowEl.classList.toggle('crit', s.hp === 1);
    this.hpSeen = true;
    this.dashFill.style.width = `${Math.round(s.dashReady * 100)}%`;
    this.dashFill.classList.toggle('ready', s.dashReady >= 1);
    this.spFill.style.width = `${Math.round(s.gauge * 100)}%`;
    this.spWrap.classList.toggle('ready', s.gauge >= 1);
    this.debuff.classList.toggle('hidden', !s.slowed);

    const b = s.boss;
    this.boss.classList.toggle('hidden', !b);
    if (b) {
      const frac = Math.min(s.bossReveal, Math.max(0, b.hp / b.maxHp));
      this.bossName.textContent = b.name;
      this.bossFill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.bossChip.style.width = `${(frac * 100).toFixed(1)}%`;
      this.bossTag.classList.toggle('on', b.exposed && b.alive);
      this.bossFill.classList.toggle('exposed', b.exposed && b.alive);
      // 페이즈 눈금
      const key = b.phaseMarks.join(',');
      if (key !== this.marksKey) {
        this.marksKey = key;
        this.bossMarks.innerHTML = b.phaseMarks.map((m) => `<i style="left:${m * 100}%"></i>`).join('');
      }
    }

    const st =
      `소리 ${s.muted ? 'OFF' : 'ON'} · 보스 공격 ${s.bossAttacks ? 'ON' : 'OFF'}` +
      (s.god ? ' · <b>무적</b>' : '') +
      (s.debug ? ` · <span class="dbg">${s.debug}</span>` : '');
    if (st !== this.lastStatus) {
      this.status.innerHTML = st;
      this.lastStatus = st;
    }
    this.fpsEl.textContent = `${Math.round(s.fps)} fps`;
  }

  toast(msg: string, sec = 1.6) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), sec * 1000);
  }

  /** 화면 중앙의 큰 글자 (보스 등장 카드, 페이즈 전환 등) */
  banner(title: string, sub: string, sec = 2.4) {
    this.bannerT.textContent = title;
    this.bannerS.textContent = sub;
    // 애니메이션 재시작
    this.bannerEl.classList.remove('on');
    void this.bannerEl.offsetWidth;
    this.bannerEl.style.setProperty('--dur', `${sec}s`);
    this.bannerEl.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('on'), sec * 1000);
  }

  showOverlay(title: string, body: string) {
    this.overlay.classList.remove('compact');
    this.ovTitle.textContent = title;
    this.ovBody.innerHTML = body;
    this.overlay.classList.remove('hidden');
  }
  /** 일시정지 화면: 제목 + 호출한 쪽이 만든 패널(키 설정) + 계속하기 안내 */
  showPause(panel: HTMLElement) {
    this.overlay.classList.add('compact');
    this.ovTitle.textContent = '일시정지';
    this.ovBody.replaceChildren(panel);
    const go = document.createElement('div');
    go.className = 'go';
    go.textContent = '클릭 또는 Esc 로 계속';
    this.ovBody.append(go);
    this.overlay.classList.remove('hidden');
  }
  /** HUD 안의 키 이름 표시를 현재 키 설정에 맞춘다 */
  setKeyLabels(dash: string, special: string) {
    this.kDash.textContent = dash;
    this.kSpecial.textContent = special;
    this.kDebuff.textContent = dash;
  }
  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  floatText(p: THREE.Vector3, text: string, kind: FloatKind) {
    this.v.copy(p).project(this.camera);
    if (this.v.z > 1) return;
    const el = document.createElement('div');
    // 크기는 종류(약점 등), 색은 숫자 크기로 정한다 (클수록 주황 → 붉은색)
    const n = parseInt(text, 10);
    const tier = kind === 'player' || !Number.isFinite(n) ? '' : n >= 12 ? ' t4' : n >= 8 ? ' t3' : n >= 4 ? ' t2' : ' t1';
    el.className = `dmg ${kind}${tier}`;
    el.textContent = text;
    el.style.left = `${(this.v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 24}px`;
    el.style.top = `${(-this.v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.dmgLayer.appendChild(el);
    while (this.dmgLayer.childElementCount > 40) this.dmgLayer.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 800);
  }
}
