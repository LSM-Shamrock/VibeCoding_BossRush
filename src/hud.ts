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
  autoFire: boolean;
  muted: boolean;
  bossAttacks: boolean;
  slowed: boolean;
  fps: number;
  debug: string;
}

export class Hud {
  private lamps: HTMLElement[] = [];
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
      wrap.appendChild(d);
      this.lamps.push(d);
    }
  }

  update(s: HudState) {
    this.lamps.forEach((l, i) => l.classList.toggle('off', i >= s.hp));
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
      `자동 사격 ${s.autoFire ? 'ON' : 'OFF'} · 소리 ${s.muted ? 'OFF' : 'ON'} · 보스 공격 ${s.bossAttacks ? 'ON' : 'OFF'}` +
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
    el.className = `dmg ${kind}`;
    el.textContent = text;
    el.style.left = `${(this.v.x * 0.5 + 0.5) * window.innerWidth + (Math.random() - 0.5) * 24}px`;
    el.style.top = `${(-this.v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.dmgLayer.appendChild(el);
    while (this.dmgLayer.childElementCount > 40) this.dmgLayer.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 800);
  }
}
