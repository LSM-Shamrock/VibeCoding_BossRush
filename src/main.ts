import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { CFG } from './config';
import { Input } from './input';
import { Sfx } from './audio';
import { Fx } from './fx';
import { Arena } from './arena';
import { Player } from './player';
import { Spider } from './bosses/spider/spider';
import { Dragon } from './bosses/dragon/dragon';
import { Serpent } from './bosses/serpent/serpent';
import { Hud } from './hud';
import { Keybinds } from './keybinds';
import { KeyPanel } from './keypanel';
import type { Boss, FloatKind, Host, Target } from './types';
import { PAL } from './palette';
import { WORLD } from './world';
import { DIFF, DIFFS, setDifficulty, type DiffKey } from './difficulty';
import { ExitDoor } from './exitdoor';

/** 락온 중 시선이 몸통 방향보다 이만큼(rad) 더 아래를 보면 자유 조준으로 전환 */
const LOCK_FREE_AIM = 0.17;
const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 층마다 나오는 보스. 새 보스는 여기에 한 줄 추가하면 된다 (인덱스 + 1 = 층 번호) */
const BOSSES: Array<(host: Host, player: Player, drop: boolean) => Boss> = [(h, p, d) => new Spider(h, p, d), (h, p, d) => new Serpent(h, p, d), (h, p, d) => new Dragon(h, p, d)];
const FLOORS = BOSSES.length;
/** 1층 기록은 예전 키를 그대로 쓴다 */
const bestKey = (floor: number) => (floor === 1 ? 'deepnest.best.spider' : `deepnest.best.f${floor}`);

/** 보스 시작 화면(타이틀·다음 보스)에 띄울 정보 */
const FLOOR_INFO = [
  { label: '1층 · 거미굴', name: CFG.spider.name },
  { label: CFG.serpent.floorLabel, name: CFG.serpent.name },
  { label: CFG.dragon.floorLabel, name: CFG.dragon.name },
];
/** 클리어 화면에서 캐릭터가 움직이지 못하게 하는 빈 입력 */
const IDLE_INPUT = new Proxy({}, { get: () => () => false }) as unknown as Input;

type GameState = 'title' | 'intro' | 'play' | 'victory' | 'over' | 'clear' | 'next';

const fmtTime = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

class Game implements Host {
  readonly scene = new THREE.Scene();
  readonly sfx = new Sfx();
  readonly fx: Fx;
  targets: Target[] = [];

  private renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private binds = new Keybinds();
  private keyPanel: KeyPanel;
  private input: Input;
  private arena: Arena;
  readonly player: Player;
  boss: Boss | null = null;
  floor = 1;
  private hud: Hud;

  state: GameState = 'title';
  private paused = false;
  private last = performance.now();
  private time = 0;
  private fps = 60;
  private shakeAmt = 0;
  private shakeHold = 0;
  private fovKick = 0;
  private hitStopT = 0;
  private rampLeft = 0;
  private rampDur = 1;
  private slowScale = 1;
  private slowT = 0;
  // 어깨 너머 카메라
  private camYaw = Math.PI; // 바라보는 방향 (앞 = (sin, cos))
  private camPitch = (CFG.camera.pitchDeg * Math.PI) / 180; // 내려다보는 각 (+ = 아래)
  private camDist: number = CFG.camera.dist;
  private lockOn = false;
  private lookTmp = { x: 0, y: 0 };
  private aim = new V3(0, 0, 0);
  private throwAim = new V3(0, 0, 0);
  private aim3 = new V3(0, 1.1, 24);
  private rayO = new V3();
  private rayD = new V3();
  private camPos = new V3();
  private tmpV = new V3();
  private crossEl = document.getElementById('cross') as HTMLElement;
  private lockEl = document.getElementById('lockon') as HTMLElement;
  private hadLock = false;
  private lockLostAt = -1e9;
  private debugOn = false;

  // 전투 흐름
  private fightTime = 0;
  private introT = 0;
  private dropIntro = true;
  private bannerShown = false;
  private waitT = 0;
  private overShown = false;
  private debugAtk = 0;

  constructor() {
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    const pr = Math.min(window.devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, window.innerWidth / window.innerHeight, 0.15, 1500);

    // 후처리: MSAA 렌더타깃 + Bloom(발광 부위만 번짐) + 톤매핑 출력
    const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.input = new Input(canvas, this.binds);
    this.fx = new Fx(this.scene);
    this.arena = new Arena(this.scene, this.renderer);
    this.player = new Player(this);
    this.hud = new Hud(this.camera);
    this.keyPanel = new KeyPanel(this.binds);
    this.refreshKeyLabels();
    this.binds.onChange(() => this.refreshKeyLabels());

    // 포인터 락: 마우스를 가두고 움직임을 시점 회전에 쓴다. 락이 풀리면(Esc 포함) 일시정지.
    document.addEventListener('pointerlockchange', () => {
      const locked = this.input.locked;
      if (this.hadLock && !locked && !this.paused && (this.state === 'play' || this.state === 'intro')) {
        this.lockLostAt = performance.now();
        this.setPaused(true);
      }
      this.hadLock = locked;
    });
    canvas.addEventListener('pointerdown', () => {
      if (!this.paused && (this.state === 'play' || this.state === 'intro' || this.state === 'victory') && !this.input.locked) this.lockPointer();
    });

    this.player.onDeath = () => {
      if (this.state === 'victory' || this.state === 'clear' || this.state === 'next') return;
      this.state = 'over';
      this.showCursor(true);
      this.overShown = false;
      this.waitT = 1.3; // 쓰러지는 연출을 볼 시간
      this.sfx.drone(false);
    };

    // 타이틀 → 보스 선택 → 시작
    this.showSelect(true);
    document.getElementById('overlay')!.addEventListener('click', () => this.onOverlayClick());
    window.addEventListener('blur', () => {
      if (!this.paused && (this.state === 'play' || this.state === 'intro')) this.setPaused(true);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(this.frame);
  }

  /* ───────────── Host 구현 ───────────── */
  shake(amount: number, hold = 0) {
    this.shakeAmt = Math.min(2.2, Math.max(this.shakeAmt, amount));
    if (hold > 0) this.shakeHold = Math.max(this.shakeHold, hold);
  }
  punch(deg: number) {
    this.fovKick = Math.max(this.fovKick, deg);
  }
  hitStop(seconds: number) {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }
  rampUp(seconds: number) {
    this.rampDur = Math.max(0.01, seconds);
    this.rampLeft = this.rampDur;
  }
  slowmo(scale: number, seconds: number) {
    this.slowScale = scale;
    this.slowT = Math.max(this.slowT, seconds);
  }
  floatText(p: THREE.Vector3, text: string, kind: FloatKind) {
    this.hud.floatText(p, text, kind);
  }
  banner(title: string, sub: string, seconds: number) {
    this.hud.banner(title, sub, seconds);
  }
  flash(color: string, alpha: number, seconds: number) {
    this.hud.flash(color, alpha, seconds);
  }
  skyPulse(k: number) {
    this.arena.skyPulse(k);
  }

  /** 페이즈가 오르면 보스 몸에서 불꽃이 이글거린다: 2페이즈 = 붉은 불꽃, 3페이즈 = 검붉고 더 거센 불꽃 */
  private flameT = 0;
  private bossFlames(dt: number) {
    const b = this.boss;
    if (!b || !b.alive || b.phaseIndex < 1 || (this.state !== 'play' && this.state !== 'intro')) return;
    const hot = b.phaseIndex >= 2;
    this.flameT += dt * (hot ? 130 : 48);
    const spheres = b.aimSpheres();
    if (spheres.length === 0) return;
    while (this.flameT >= 1) {
      this.flameT -= 1;
      const sp = spheres[Math.floor(Math.random() * spheres.length)];
      const a = Math.random() * Math.PI * 2;
      const rr = sp.r * (0.5 + Math.random() * 0.7);
      this.flameP.set(sp.x + Math.cos(a) * rr, Math.max(0.2, sp.y + (Math.random() - 0.3) * sp.r), sp.z + Math.sin(a) * rr);
      if (hot) this.fx.particles.burst(this.flameP, Math.random() < 0.5 ? 0x7a0614 : 0xb01020, 1, 1.6, 0.9, 0.3, 1.4, -4, 2.4);
      else this.fx.particles.burst(this.flameP, Math.random() < 0.5 ? 0xff4a12 : 0xff8a22, 1, 1.2, 0.7, 0.2, 1.2, -3, 2.0);
    }
  }
  private flameP = new THREE.Vector3();
  private exitDoor: ExitDoor | null = null;

  /* ───────────── 흐름 ───────────── */
  /** 보스 시작 전 난이도 선택 (노멀 5칸 / 하드 3칸 / 크레이지 1칸) */
  private diffPicker() {
    const btn = (k: DiffKey) =>
      `<button type="button" class="diff${DIFF.key === k ? ' sel' : ''}" data-d="${k}"><b>${DIFFS[k].label}</b><small>${DIFFS[k].note}</small></button>`;
    return `<div class="diffs">${btn('normal')}${btn('hard')}${btn('crazy')}</div>`;
  }

  private bindDiff() {
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('#ovbody .diff'));
    for (const b of btns) {
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // 오버레이 전체 클릭(= 시작)으로 번지지 않게
        setDifficulty(b.dataset.d as DiffKey);
        for (const o of btns) o.classList.toggle('sel', o === b);
      });
    }
  }

  private onOverlayClick() {
    this.sfx.unlock();
    if (this.paused) {
      this.setPaused(false);
    } else if ((this.state === 'over' && this.overShown) || this.state === 'clear') {
      this.showSelect(false); // 쓰러졌거나 클리어했으면 보스 선택 화면으로
    }
    // 보스 선택 화면은 '시작' 버튼(또는 Enter)으로만 시작한다
  }

  /** 타이틀·다음 보스 화면에서 고른 난이도로 보스전을 시작한다 */
  private startPending() {
    this.sfx.unlock();
    if ((this.state === 'title' || this.state === 'next') && this.unlocked(this.pick)) this.startFight(true, this.pick);
  }

  private bindStart() {
    const b = document.querySelector<HTMLButtonElement>('#ovbody .startbtn');
    b?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.startPending();
    });
  }

  /* ───────────── 보스 선택 ───────────── */
  private pick = 1;
  private static readonly CLEAR_KEY = 'deepnest.cleared';

  /** 지금까지 처음으로 쓰러뜨린 가장 깊은 층 (예전 기록 키도 인정한다) */
  private clearedFloor(): number {
    let n = 0;
    try {
      n = parseInt(localStorage.getItem(Game.CLEAR_KEY) ?? '', 10) || 0;
      for (let f = 1; f <= FLOORS; f++) if (Number.isFinite(parseFloat(localStorage.getItem(bestKey(f)) ?? ''))) n = Math.max(n, f);
    } catch {
      /* 저장소를 못 쓰면 기록 없이 */
    }
    return Math.min(n, FLOORS);
  }
  private unlocked(floor: number) {
    return floor <= this.clearedFloor() + 1;
  }
  private markCleared(floor: number) {
    try {
      if (floor > this.clearedFloor()) localStorage.setItem(Game.CLEAR_KEY, String(floor));
    } catch {
      /* ignore */
    }
  }
  private bestOf(floor: number): number {
    try {
      return parseFloat(localStorage.getItem(bestKey(floor)) ?? '');
    } catch {
      return NaN;
    }
  }

  /** 보스 선택 화면: 큰 보스 카드 3장(앞 보스를 깨야 열린다) + 난이도 선택 + 시작. 타이틀 · 클리어 · 패배 뒤에 공통으로 온다 */
  private showSelect(first: boolean) {
    if (!first) {
      // 전투가 끝난 뒤: 보스와 잔재를 치우고 캐릭터는 가만히 둔다
      this.sfx.drone(false);
      this.fx.telegraphs.clear();
      this.exitDoor?.dispose();
      this.exitDoor = null;
      this.boss?.dispose();
      this.boss = null;
      this.targets = [];
      this.player.vel.set(0, 0, 0);
      this.player.dashT = 0;
      this.showCursor(true);
    }
    this.state = first ? 'title' : 'next';
    const open = Math.min(FLOORS, this.clearedFloor() + 1);
    if (!this.unlocked(this.pick) || first) this.pick = first ? open : Math.min(this.pick, open);
    const cards = FLOOR_INFO.map((info, i) => {
      const f = i + 1;
      const ok = this.unlocked(f);
      const best = this.bestOf(f);
      const done = f <= this.clearedFloor();
      const status = !ok ? '🔒 이전 보스를 쓰러뜨려야 열립니다' : Number.isFinite(best) ? `최고 기록 ${fmtTime(best)}` : done ? '격파 완료' : '미도전';
      return `<button type="button" class="bcard${ok ? '' : ' locked'}${f === this.pick ? ' sel' : ''}" data-f="${f}" ${ok ? '' : 'aria-disabled="true"'}>
        <small class="fl">${info.label}</small>
        <b class="nm">${ok ? info.name : '? ? ?'}</b>
        <span class="st">${status}</span>
      </button>`;
    }).join('');
    this.hud.showOverlay(
      first ? 'DEEP NEST' : '보스 선택',
      `${first ? `<span style="color:#a8957c;font-size:13px">${this.binds.moveSummary()} 이동 · 마우스 시점 · 왼쪽 버튼 길게 눌러 불꽃 모으기(떼면 발사) · ${this.binds.label('lockon')} 락온 · ${this.binds.label('dash')} 대시(무적) · ${this.binds.label('jump')} 점프 · ${this.binds.label('special')} 특수기 · Esc 일시정지(키 설정)</span>` : '<span style="color:#a8957c">도전할 보스를 고르세요.</span>'}
       <div class="bcards">${cards}</div>
       ${this.diffPicker()}
       <button type="button" class="startbtn">시작</button>`,
    );
    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('#ovbody .bcard'));
    for (const b of btns) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const f = parseInt(b.dataset.f ?? '1', 10);
        if (!this.unlocked(f)) {
          b.classList.remove('shake');
          void b.offsetWidth;
          b.classList.add('shake');
          return;
        }
        this.pick = f;
        for (const o of btns) o.classList.toggle('sel', o === b);
      });
    }
    this.bindDiff();
    this.bindStart();
  }

  /** 쓰러졌거나 보스를 잡았을 땐 포인터 락을 풀고 마우스 커서를 다시 보여준다 */
  private showCursor(on: boolean) {
    const c = document.getElementById('c') as HTMLCanvasElement | null;
    if (c) c.style.cursor = on ? 'default' : 'none';
    if (on) {
      try {
        document.exitPointerLock();
      } catch {
        /* 무시 */
      }
    }
  }

  private lockPointer() {
    this.showCursor(false);
    try {
      const c = document.getElementById('c') as HTMLCanvasElement;
      const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* 포인터 락을 못 쓰는 환경이면 락 없이 진행 */
    }
  }

  private setPaused(p: boolean) {
    this.paused = p;
    if (p) {
      this.keyPanel.open();
      this.hud.showPause(this.keyPanel.el);
    } else {
      this.keyPanel.close();
      this.hud.hideOverlay();
      (document.getElementById('c') as HTMLCanvasElement).focus();
      this.lockPointer();
    }
  }

  /** drop: 천장에서 떨어지는 등장(첫 도전/클리어 후) / false: 재도전 때는 짧은 기상 */
  private startFight(drop: boolean, floor = this.floor) {
    this.sfx.unlock();
    if (floor !== this.floor || !this.boss) this.arena.setTheme(floor);
    this.floor = floor;
    this.fx.telegraphs.clear();
    this.exitDoor?.dispose();
    this.exitDoor = null;
    this.boss?.dispose();
    this.boss = null;
    this.targets = [];
    this.player.respawn();
    this.player.hitsTaken = 0;
    this.dropIntro = drop;
    this.boss = BOSSES[floor - 1](this, this.player, drop);
    this.boss.onDeath = () => this.onBossDeath();
    this.state = 'intro';
    this.fightTime = 0;
    this.introT = 0;
    this.bannerShown = false;
    this.overShown = false;
    this.paused = false;
    this.keyPanel.close();
    this.hud.hideOverlay();
    (document.getElementById('c') as HTMLCanvasElement).focus();
    this.lockOn = false;
    this.camYaw = Math.atan2(-this.player.pos.x, -this.player.pos.z); // 아레나 중앙(보스)을 향해 시작
    this.camPitch = (CFG.camera.pitchDeg * Math.PI) / 180;
    this.lockPointer();
  }

  private onBossDeath() {
    this.state = 'victory';
    this.waitT = 3.0; // 이 뒤에 출구 문이 솟는다 (그동안 플레이어는 그대로 움직일 수 있다)
    this.hud.banner('격파', this.boss?.title ?? '', 3.0);
    window.setTimeout(() => this.sfx.victory(), 1400);
  }

  /** 보스를 잡은 뒤 맵 반대편에 문을 연다 */
  private openExitDoor() {
    const R = WORLD.radius;
    const p = this.player.pos;
    let dx = -p.x;
    let dz = -p.z;
    if (Math.hypot(dx, dz) < 4) {
      dx = 0;
      dz = -1;
    }
    const l = Math.hypot(dx, dz);
    const x = (dx / l) * R * 0.55;
    const z = (dz / l) * R * 0.55;
    this.exitDoor?.dispose();
    this.exitDoor = new ExitDoor(this, x, z, 0, 0);
    this.sfx.victory();
    this.hud.banner('문이 열렸다', '빛나는 문으로 들어가면 클리어', 3.0);
    this.shake(0.6, 0.3);
  }

  private showOver() {
    this.overShown = true;
    const left = this.boss ? Math.round((this.boss.hp / this.boss.maxHp) * 100) : 100;
    this.hud.showOverlay(
      '등불이 꺼졌다',
      `${this.boss?.title ?? ''}의 남은 체력 <b>${left}%</b><br>
       <span style="color:#a8957c">보스 선택 화면으로 돌아갑니다.</span><br>
       <div class="go">${this.binds.label('retry')} 키 또는 클릭으로 보스 선택</div>`,
    );
  }

  private showClear() {
    const t = this.fightTime;
    const floor = this.floor;
    const key = bestKey(floor);
    let best = NaN;
    try {
      best = parseFloat(localStorage.getItem(key) ?? '');
    } catch {
      /* 저장소를 못 쓰는 환경이면 기록 없이 진행 */
    }
    const isBest = !(best <= t);
    if (isBest) {
      try {
        localStorage.setItem(key, String(t));
      } catch {
        /* ignore */
      }
    }
    this.markCleared(floor);
    this.state = 'clear';
    this.player.vel.set(0, 0, 0);
    this.player.dashT = 0;
    this.hud.showOverlay(
      `${floor}층 클리어`,
      `<b>${this.boss?.title ?? ''}</b> 격파<br>
       소요 시간 <b>${fmtTime(t)}</b>${isBest ? ' <span style="color:#ffd27a">· 최고 기록!</span>' : ` <span style="color:#a8957c">· 최고 ${fmtTime(best)}</span>`}<br>
       피격 <b>${this.player.hitsTaken}</b>회<br>
       <button type="button" class="startbtn nextbtn">보스 선택</button>`,
    );
    document.querySelector<HTMLButtonElement>('#ovbody .nextbtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showSelect(false);
    });
  }

  private refreshKeyLabels() {
    this.hud.setKeyLabels(this.binds.label('dash'), this.binds.label('special'));
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 자동화 테스트용: true 면 루프가 시뮬레이션을 돌리지 않고 렌더만 한다 (advance 로 직접 진행) */
  manual = false;
  advance(dt: number) {
    this.update(dt);
    this.input.endFrame();
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const raw = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps += (1 / Math.max(raw, 1e-4) - this.fps) * 0.05;
    if (!this.manual) {
      this.update(raw);
      this.input.endFrame();
    }
    this.composer.render();
  };

  private update(raw: number) {
    this.time += raw;

    // 키 입력 (오버레이 상태와 무관한 것)
    if (this.input.hit('Enter') && (this.state === 'title' || this.state === 'next')) this.startPending();
    else if (this.input.hit('Enter') && this.paused) this.onOverlayClick();
    if ((this.state === 'over' && this.overShown) || this.state === 'clear') {
      if (this.input.tapped('retry') || this.input.hit('Enter')) this.onOverlayClick();
    }
    if (this.input.hit('Escape') && (this.state === 'play' || this.state === 'intro' || this.paused) && performance.now() - this.lockLostAt > 300) {
      this.setPaused(!this.paused);
    }
    if (this.input.tapped('mute')) {
      this.sfx.setMuted(!this.sfx.muted);
      this.hud.toast(this.sfx.muted ? '소리 꺼짐' : '소리 켜짐');
    }
    if (this.input.hit('Backquote')) {
      this.debugOn = !this.debugOn;
      this.hud.toast(this.debugOn ? '디버그 표시 ON' : '디버그 표시 OFF');
    }

    // 시간 배율: 일시정지 > 히트스톱(완전 정지) > 슬로모션
    let dt = raw;
    if (this.paused) {
      dt = 0;
    } else if (this.hitStopT > 0) {
      this.hitStopT -= raw;
      dt = 0;
    } else if (this.rampLeft > 0) {
      // 0배속 → 1배속 (처음엔 느리게 풀리다가 점점 빨라진다)
      this.rampLeft -= raw;
      const k = Math.min(1, Math.max(0, 1 - this.rampLeft / this.rampDur));
      dt = raw * k * k * (3 - 2 * k);
    } else if (this.slowT > 0) {
      this.slowT -= raw;
      dt = raw * this.slowScale;
    }

    if (this.state !== 'title') {
      this.debugKeys();
    }

    this.updateLook(raw);
    this.updateAim();
    // 일시정지 중에는 게임 입력(대시/특수기 등)을 처리하지 않는다 — 키 설정 화면에서 누른 키가 게임에 새지 않도록
    if (this.state !== 'title' && !this.paused) {
      const still = this.state === 'clear' || this.state === 'next'; // 결과·시작 화면에서는 캐릭터가 움직이지 않는다
      this.player.ceaseFire = this.state === 'victory' || still;
      this.player.trigger = !still && this.input.mouseDown && (this.input.locked || this.manual);
      this.player.update(dt, still ? IDLE_INPUT : this.input, this.aim);
      this.player.arrows.update(dt);
      this.boss?.update(dt);
      this.bossFlames(dt);
      this.updateRipples(dt);
      this.hud.setTint(this.boss && this.boss.alive ? (this.boss.screenTint ?? 0) : 0);
      this.updateFlow(raw, dt);
    } else if (this.paused) {
      this.player.cancelDraw(); // 일시정지 중에 놓은 버튼으로 불꽃이 나가지 않게
    }
    this.fx.update(dt);
    this.arena.update(raw, this.time, this.player.pos.x, this.player.pos.z);
    this.updateCamera(raw);
    this.updateCrosshair();

    const boss = this.boss && this.boss.alive && this.state !== 'title' ? this.boss : null;
    const reveal = this.state === 'intro' ? Math.min(1, Math.max(0, (this.introT - (this.dropIntro ? 1.0 : 0.1)) / 1.2)) : 1;
    this.hud.update({
      hp: this.player.hp,
      maxHp: DIFF.hp,
      dashReady: 1 - this.player.dashCd / CFG.dash.cooldown,
      gauge: this.player.gauge / CFG.special.max,
      boss,
      bossReveal: reveal,
      god: this.player.god,
      muted: this.sfx.muted,
      bossAttacks: this.boss?.attacksOn ?? true,
      fps: this.fps,
      debug: this.debugOn && this.boss ? this.boss.status : '',
    });
  }

  /** 상태별 진행 (등장 → 전투 → 격파/패배 → 결과 화면) */
  private updateFlow(raw: number, dt: number) {
    const boss = this.boss;
    switch (this.state) {
      case 'intro': {
        this.introT += dt;
        // 보스가 착지하는 순간 등장 카드
        if (boss && !this.bannerShown && boss.introBeat) {
          this.bannerShown = true;
          this.hud.banner(boss.title, boss.floorLabel, 3.0);
        }
        if (boss?.ready) this.state = 'play';
        break;
      }
      case 'play':
        this.fightTime += dt;
        break;
      case 'victory':
        this.waitT -= raw;
        if (!this.exitDoor && this.waitT <= 0) this.openExitDoor();
        if (this.exitDoor) {
          this.exitDoor.update(raw);
          if (this.exitDoor.entered(this.player.pos.x, this.player.pos.z)) {
            this.showCursor(true);
            this.showClear();
          }
        }
        break;
      case 'over':
        if (!this.overShown) {
          this.waitT -= raw;
          if (this.waitT <= 0) this.showOver();
        }
        break;
      default:
        break;
    }
  }

  /** 디버그 키: 보스 구현/튜닝 때 테스트 시간을 줄이기 위한 도구 */
  private debugKeys() {
    const i = this.input;
    const boss = this.boss;
    if (i.hit('Digit1')) {
      this.player.god = !this.player.god;
      this.hud.toast(this.player.god ? '무적 ON' : '무적 OFF');
    }
    if (i.hit('Digit2') && !this.player.dead) this.player.setHp(this.player.hp - 1);
    if (i.hit('Digit3') && !this.player.dead) this.player.setHp(this.player.hp + 1);
    if (i.hit('Digit4')) this.player.addCharge(CFG.special.max / CFG.special.chargePerDamage);
    if (i.hit('Digit0')) this.startFight(false, (this.floor % FLOORS) + 1);
    if (!boss) return;
    if (i.hit('Digit5')) {
      boss.attacksOn = !boss.attacksOn;
      this.hud.toast(boss.attacksOn ? '보스 공격 ON' : '보스 공격 OFF');
    }
    if (i.hit('Digit6')) this.startFight(false);
    if (i.hit('Digit7') && boss.alive) {
      const next = boss.phaseMarks[boss.phaseIndex];
      if (next === undefined) {
        this.hud.toast('마지막 페이즈입니다');
      } else {
        boss.setHpFrac(next - 0.001);
        this.hud.toast(`페이즈 ${boss.phaseIndex + 2} 진입 예약`);
      }
    }
    if (i.hit('Digit8') && boss.alive) boss.setHpFrac(0.05);
    if (i.hit('Digit9') && boss.alive && boss.ready) {
      const names = boss.attackNames;
      const name = names[this.debugAtk++ % names.length];
      boss.forceAttack(name);
      this.hud.toast(`다음 공격: ${name}`);
    }
  }

  /** 마우스/락온으로 카메라 방향(요·피치) 갱신 */
  private updateLook(raw: number) {
    const C = CFG.camera;
    const look = this.lookTmp;
    this.input.takeLook(look);
    const playing = !this.paused && this.state !== 'title' && this.state !== 'over' && this.state !== 'clear' && this.state !== 'next';
    const b = this.boss && this.boss.alive ? this.boss : null;
    if (this.input.hit('MouseMiddle') || this.input.tapped('lockon')) {
      if (playing && !this.input.hit('Escape')) {
        this.lockOn = !this.lockOn && !!b;
        this.hud.toast(this.lockOn ? '락온' : '락온 해제');
      }
    }
    if (!b) this.lockOn = false;
    if (!playing || !this.input.locked) return;
    if (this.lockOn && b) {
      // 락온: 카메라가 보스 쪽으로 따라 돈다 (좌우 마우스는 무시, 상하는 허용)
      const target = Math.atan2(b.pos.x - this.player.pos.x, b.pos.z - this.player.pos.z);
      this.camYaw = lerpAngle(this.camYaw, target, 1 - Math.exp(-C.lockSmooth * raw));
    } else {
      this.camYaw -= look.x * C.sens;
    }
    this.camPitch = clampN(this.camPitch + look.y * C.sens, (C.pitchMin * Math.PI) / 180, (C.pitchMax * Math.PI) / 180);
  }

  /** 조준점: 크로스헤어(화면 중앙)가 가리키는 방향. 락온 중이면 보스. */
  private updateAim() {
    const C = CFG.camera;
    const p = this.player.pos;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const rx = -fz;
    const rz = fx;
    // 화면 중앙선은 어깨(피벗)를 지나므로 그 선 위의 먼 점을 조준한다
    const px = p.x + rx * C.shoulder;
    const pz = p.z + rz * C.shoulder;
    const b = this.boss && this.boss.alive ? this.boss : null;
    if (this.lockOn && b) {
      this.aim.set(b.pos.x, 0, b.pos.z);
    } else {
      this.aim.set(px + fx * 24, 0, pz + fz * 24);
    }
    // 특수기 투척점: 락온이면 보스, 아니면 정면 40° 안의 보스(보조 조준), 없으면 정면 9칸
    this.throwAim.set(p.x + fx * 9, 0, p.z + fz * 9);
    if (b) {
      const dx = b.pos.x - p.x;
      const dz = b.pos.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      if (this.lockOn || (dx * fx + dz * fz) / d > Math.cos((40 * Math.PI) / 180)) this.throwAim.set(b.pos.x, 0, b.pos.z);
    }
    this.updateAim3(fx, fz, px, pz, b);
    this.player.camYaw = this.camYaw;
    this.player.throwAim = this.throwAim;
  }

  /** 시점 중심 높이: 위를 볼수록 올라간다 */
  private pivotY() {
    return CFG.camera.pivotY + this.player.pos.y * 0.75 + Math.max(0, -Math.sin(this.camPitch)) * CFG.camera.lookUpLift;
  }

  /**
   * 조준점(3D): 화면 중앙 십자가(어깨 피벗을 지나는 시선)가 실제로 가리키는 점.
   * 시선이 처음 닿는 것 — 보스 몸(몸통/배 구) → 바닥 — 이고, 아무것도 없으면 먼 점.
   * 보정(자동 조준)은 없다. 락온 중에만 보스 몸통을 향한다.
   */
  private updateAim3(fx: number, fz: number, px: number, pz: number, b: Boss | null) {
    const cp = Math.cos(this.camPitch);
    const O = this.rayO.set(px, this.pivotY(), pz);
    const D = this.rayD.set(fx * cp, -Math.sin(this.camPitch), fz * cp);
    // 락온 중에는 보스 몸통을 향하지만, 시선을 몸통 방향보다 확연히 아래로 내리면(새끼 거미·알을 쏠 때)
    // 그쪽을 자유롭게 조준한다. 그렇지 않으면 락온 중에는 아래를 볼 수 없다.
    let lockedOnBoss = false;
    const lp = this.tmpV;
    if (b && this.lockOn) {
      b.lockPoint(lp);
      const hd = Math.hypot(lp.x - O.x, lp.z - O.z) || 1;
      const pitchToBoss = Math.atan2(O.y - lp.y, hd); // + = 몸통이 아래에 있음
      lockedOnBoss = this.camPitch - pitchToBoss < LOCK_FREE_AIM;
    }
    if (b && lockedOnBoss) {
      b.lockPoint(lp);
      this.aim3.set(lp.x, lp.y, lp.z);
    } else {
      let s = 60;
      if (D.y < -1e-3) s = Math.min(s, (O.y - 0.05) / -D.y); // 바닥
      if (b) {
        for (const c of b.aimSpheres()) {
          // 시선과 구의 첫 교점
          const wx = c.x - O.x;
          const wy = c.y - O.y;
          const wz = c.z - O.z;
          const tca = wx * D.x + wy * D.y + wz * D.z;
          if (tca <= 0) continue;
          const d2 = wx * wx + wy * wy + wz * wz - tca * tca;
          if (d2 >= c.r * c.r) continue;
          const t = tca - Math.sqrt(c.r * c.r - d2);
          if (t > 0.5 && t < s) s = t;
        }
      }
      this.aim3.set(O.x + D.x * s, O.y + D.y * s, O.z + D.z * s);
    }
    this.player.aimPoint.copy(this.aim3);
    this.player.aimDir.copy(D);
  }

  private updateCamera(raw: number) {
    const C = CFG.camera;
    const p = this.player.pos;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const dx = fx * cp;
    const dy = -sp;
    const dz = fz * cp;
    const px = p.x - fz * C.shoulder;
    const pz = p.z + fx * C.shoulder;
    const py = this.pivotY();

    // 외벽 안쪽에 머물도록: 피벗→카메라 선분이 wallLimit 원을 넘으면 거리를 줄인다
    let want: number = C.dist;
    const ox = -dx; // 피벗에서 카메라 방향(수평)
    const oz = -dz;
    const a = ox * ox + oz * oz;
    const bq = px * ox + pz * oz;
    const c = px * px + pz * pz - WORLD.wallLimit * WORLD.wallLimit;
    if (a > 1e-6 && c < 0) {
      const t = (-bq + Math.sqrt(Math.max(0, bq * bq - a * c))) / a;
      want = Math.min(want, Math.max(C.minDist, t));
    }
    if (sp < -1e-3) want = Math.min(want, Math.max(C.minDist, (py - C.floorY) / -sp));
    const k = want < this.camDist ? 1 - Math.exp(-18 * raw) : 1 - Math.exp(-4 * raw);
    this.camDist += (want - this.camDist) * k;

    if (this.shakeHold > 0) this.shakeHold -= raw;
    else this.shakeAmt *= Math.exp(-(this.shakeAmt > 0.8 ? 6 : 9) * raw);
    const sx = (Math.random() - 0.5) * 2 * this.shakeAmt * 0.12;
    const sy = (Math.random() - 0.5) * 2 * this.shakeAmt * 0.12;
    const cx = px - dx * this.camDist + sx;
    const cy = Math.max(0.35, py - dy * this.camDist + sy);
    const cz = pz - dz * this.camDist;
    // FOV 펀치 (대시 등): 순식간에 벌어졌다가 부드럽게 돌아온다
    this.fovKick *= Math.exp(-9 * raw);
    const fov = C.fov + (this.fovKick > 0.02 ? this.fovKick : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(cx, cy, cz);
    this.camPos.set(cx, cy, cz);
    this.camera.lookAt(cx + dx * 10, cy + dy * 10, cz + dz * 10);
  }

  private lastFoot = new THREE.Vector2(1e9, 1e9);
  private footAcc = 0;
  private footSide = 1;
  /** 2층: 플레이어 발걸음/대시와 이무기가 지나간 자리에 물결 */
  private updateRipples(dt: number) {
    if (this.floor !== 2 || dt <= 0) return;
    const p = this.player;
    if (!p.dead) {
      const d = Math.hypot(p.pos.x - this.lastFoot.x, p.pos.z - this.lastFoot.y);
      if (d < 3) {
        this.footAcc += d;
        const dash = p.dashT > 0;
        const step = dash ? 0.55 : 0.95;
        if (this.footAcc >= step) {
          this.footAcc = 0;
          this.footSide = -this.footSide;
          this.arena.ripple(p.pos.x + this.footSide * 0.22, p.pos.z, dash ? 1.5 : 0.55, dash ? 0.6 : 0.4);
        }
      }
    }
    this.lastFoot.set(p.pos.x, p.pos.z);
    const b = this.boss;
    if (b && b.alive && b.wake) b.wake((x, z, size, strength) => this.arena.ripple(x, z, size, strength));
  }

  private updateCrosshair() {
    const show = (this.state === 'play' || this.state === 'intro') && !this.paused && !this.player.dead && this.input.locked;
    const b = this.boss && this.boss.alive ? this.boss : null;
    const locking = show && this.lockOn && !!b;
    this.crossEl.classList.toggle('hidden', !show || locking);
    const ch = this.player.drawn ? this.player.charge : 0;
    this.crossEl.classList.toggle('drawing', ch > 0);
    this.crossEl.classList.toggle('full', ch >= 1);
    this.crossEl.style.setProperty('--p', ch.toFixed(3));
    this.lockEl.classList.toggle('hidden', !locking);
    if (locking && b) {
      const v = b.lockPoint(this.tmpV);
      v.y += 1.3;
      v.project(this.camera);
      if (v.z < 1) {
        this.lockEl.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
        this.lockEl.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
      } else {
        this.lockEl.classList.add('hidden');
      }
    }
  }
}

const game = new Game();
// 콘솔 디버깅용 (예: __game.player.setHp(1), __game.boss.forceAttack('pounce'))
(window as unknown as { __game: Game }).__game = game;
