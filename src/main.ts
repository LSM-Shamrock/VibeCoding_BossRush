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
import { SEQUENCE_ATTACKS } from './bosses/spider/attacks';
import { Hud } from './hud';
import { Keybinds } from './keybinds';
import { KeyPanel } from './keypanel';
import type { FloatKind, Host, Target } from './types';
import { PAL } from './palette';

const V3 = THREE.Vector3;
const BEST_KEY = 'deepnest.best.spider';

type GameState = 'title' | 'intro' | 'play' | 'victory' | 'over' | 'clear';

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
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private binds = new Keybinds();
  private keyPanel: KeyPanel;
  private input: Input;
  private arena: Arena;
  readonly player: Player;
  boss: Spider | null = null;
  private hud: Hud;

  state: GameState = 'title';
  private paused = false;
  private last = performance.now();
  private time = 0;
  private fps = 60;
  private shakeAmt = 0;
  private hitStopT = 0;
  private slowScale = 1;
  private slowT = 0;
  private camFocus = new V3();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new V3(0, 1, 0), 0);
  private aim = new V3(0, 0, 0);
  private reticle: THREE.Group;
  private aimLine: THREE.Line;
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

    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, window.innerWidth / window.innerHeight, 0.5, 200);

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
    this.arena = new Arena(this.scene);
    this.player = new Player(this);
    this.hud = new Hud(this.camera);
    this.keyPanel = new KeyPanel(this.binds);
    this.refreshKeyLabels();
    this.binds.onChange(() => this.refreshKeyLabels());

    // 조준 커서 + 조준선
    this.reticle = new THREE.Group();
    const rm = new THREE.MeshBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
    rm.color.multiplyScalar(1.4);
    this.reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32).rotateX(-Math.PI / 2), rm));
    this.reticle.add(new THREE.Mesh(new THREE.CircleGeometry(0.06, 12).rotateX(-Math.PI / 2), rm));
    this.reticle.position.y = 0.08;
    this.scene.add(this.reticle);
    const lg = new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]);
    this.aimLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: PAL.gold, transparent: true, opacity: 0.22, depthWrite: false }));
    this.aimLine.frustumCulled = false;
    this.scene.add(this.aimLine);

    this.player.onDeath = () => {
      if (this.state === 'victory' || this.state === 'clear') return;
      this.state = 'over';
      this.overShown = false;
      this.waitT = 1.3; // 쓰러지는 연출을 볼 시간
      this.sfx.drone(false);
    };

    // 타이틀 → 시작
    this.hud.showOverlay(
      'DEEP NEST',
      `1층 · 거미굴 — <b>동굴 여왕 거미</b><br>
       <span style="color:#a8957c">${this.binds.moveSummary()} 이동 · 마우스 조준(자동 사격) · ${this.binds.label('dash')} 대시(무적) · ${this.binds.label('special')} 특수기</span><br>
       <span style="color:#a8957c">예고선과 바닥 마커가 보이면 피하고, 거미의 몸이 곧 신호다. 배(주황빛)가 약점.</span><br>
       <span style="color:#a8957c">Esc 로 일시정지 — 그 화면에서 키를 바꿀 수 있습니다.</span><br>
       <div class="go">클릭하여 시작</div>`,
    );
    document.getElementById('overlay')!.addEventListener('click', () => this.onOverlayClick());
    window.addEventListener('blur', () => {
      if (!this.paused && (this.state === 'play' || this.state === 'intro')) this.setPaused(true);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(this.frame);
  }

  /* ───────────── Host 구현 ───────────── */
  shake(amount: number) {
    this.shakeAmt = Math.min(1.8, Math.max(this.shakeAmt, amount));
  }
  hitStop(seconds: number) {
    this.hitStopT = Math.max(this.hitStopT, seconds);
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

  /* ───────────── 흐름 ───────────── */
  private onOverlayClick() {
    this.sfx.unlock();
    if (this.paused) {
      this.setPaused(false);
    } else if (this.state === 'title') {
      this.startFight(true);
    } else if ((this.state === 'over' && this.overShown) || this.state === 'clear') {
      this.startFight(this.state === 'clear');
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
    }
  }

  /** drop: 천장에서 떨어지는 등장(첫 도전/클리어 후) / false: 재도전 때는 짧은 기상 */
  private startFight(drop: boolean) {
    this.sfx.unlock();
    this.fx.telegraphs.clear();
    this.boss?.dispose();
    this.boss = null;
    this.targets = [];
    this.player.respawn();
    this.player.hitsTaken = 0;
    this.dropIntro = drop;
    this.boss = new Spider(this, this.player, drop);
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
  }

  private onBossDeath() {
    this.state = 'victory';
    this.waitT = 3.4;
    this.hud.banner('격파', CFG.spider.name, 3.0);
    window.setTimeout(() => this.sfx.victory(), 1400);
  }

  private showOver() {
    this.overShown = true;
    const left = this.boss ? Math.round((this.boss.hp / this.boss.maxHp) * 100) : 100;
    this.hud.showOverlay(
      '등불이 꺼졌다',
      `${CFG.spider.name}의 남은 체력 <b>${left}%</b><br>
       <span style="color:#a8957c">같은 보스에게 처음부터 다시 도전합니다.</span><br>
       <div class="go">${this.binds.label('retry')} 키 또는 클릭으로 재도전</div>`,
    );
  }

  private showClear() {
    const t = this.fightTime;
    let best = NaN;
    try {
      best = parseFloat(localStorage.getItem(BEST_KEY) ?? '');
    } catch {
      /* 저장소를 못 쓰는 환경이면 기록 없이 진행 */
    }
    const isBest = !(best <= t);
    if (isBest) {
      try {
        localStorage.setItem(BEST_KEY, String(t));
      } catch {
        /* ignore */
      }
    }
    this.state = 'clear';
    this.hud.showOverlay(
      '1층 클리어',
      `<b>${CFG.spider.name}</b> 격파<br>
       소요 시간 <b>${fmtTime(t)}</b>${isBest ? ' <span style="color:#ffd27a">· 최고 기록!</span>' : ` <span style="color:#a8957c">· 최고 ${fmtTime(best)}</span>`}<br>
       피격 <b>${this.player.hitsTaken}</b>회<br>
       <span style="color:#a8957c">다음 층의 보스(뱀·용)는 준비 중입니다.</span><br>
       <div class="go">${this.binds.label('retry')} 키 또는 클릭으로 다시 도전</div>`,
    );
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
    if (this.input.hit('Enter') && (this.state === 'title' || this.paused)) this.onOverlayClick();
    if ((this.state === 'over' && this.overShown) || this.state === 'clear') {
      if (this.input.tapped('retry') || this.input.hit('Enter')) this.onOverlayClick();
    }
    if (this.input.hit('Escape') && (this.state === 'play' || this.state === 'intro' || this.paused)) this.setPaused(!this.paused);
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
    } else if (this.slowT > 0) {
      this.slowT -= raw;
      dt = raw * this.slowScale;
    }

    if (this.state !== 'title') {
      this.debugKeys();
      if (this.input.tapped('autofire')) {
        this.player.autoFire = !this.player.autoFire;
        this.hud.toast(this.player.autoFire ? '자동 사격 ON' : '자동 사격 OFF (마우스 왼쪽 버튼을 누르고 있는 동안 발사)');
      }
    }

    this.updateAim();
    // 일시정지 중에는 게임 입력(대시/특수기 등)을 처리하지 않는다 — 키 설정 화면에서 누른 키가 게임에 새지 않도록
    if (this.state !== 'title' && !this.paused) {
      this.player.update(dt, this.input, this.aim);
      this.player.arrows.update(dt);
      this.boss?.update(dt);
      this.updateFlow(raw, dt);
    }
    this.fx.update(dt);
    this.arena.update(raw, this.time);
    this.updateCamera(raw);
    this.updateReticle();

    const boss = this.boss && this.boss.alive && this.state !== 'title' ? this.boss : null;
    const reveal = this.state === 'intro' ? Math.min(1, Math.max(0, (this.introT - (this.dropIntro ? 1.0 : 0.1)) / 1.2)) : 1;
    this.hud.update({
      hp: this.player.hp,
      dashReady: 1 - this.player.dashCd / CFG.dash.cooldown,
      gauge: this.player.gauge / CFG.special.max,
      boss,
      bossReveal: reveal,
      god: this.player.god,
      autoFire: this.player.autoFire,
      muted: this.sfx.muted,
      bossAttacks: this.boss?.attacksOn ?? true,
      slowed: this.player.slowT > 0 && !this.player.dead,
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
        if (boss && !this.bannerShown && boss.pos.y <= 0.05) {
          this.bannerShown = true;
          this.hud.banner(CFG.spider.name, '1층 · 거미굴', 3.0);
        }
        if (boss?.ready) this.state = 'play';
        break;
      }
      case 'play':
        this.fightTime += dt;
        break;
      case 'victory':
        this.waitT -= raw;
        if (this.waitT <= 0) this.showClear();
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
    if (!boss) return;
    if (i.hit('Digit5')) {
      boss.attacksOn = !boss.attacksOn;
      this.hud.toast(boss.attacksOn ? '보스 공격 ON' : '보스 공격 OFF');
    }
    if (i.hit('Digit6')) this.startFight(false);
    if (i.hit('Digit7') && boss.alive) {
      boss.setHpFrac(CFG.spider.phase2At - 0.001);
      this.hud.toast('페이즈 2 진입 예약');
    }
    if (i.hit('Digit8') && boss.alive) boss.setHpFrac(0.05);
    if (i.hit('Digit9') && boss.alive && boss.ready) {
      const name = SEQUENCE_ATTACKS[this.debugAtk++ % SEQUENCE_ATTACKS.length];
      boss.forceAttack(name);
      this.hud.toast(`다음 공격: ${name}`);
    }
  }

  private updateAim() {
    this.ray.setFromCamera(this.input.mouseNDC, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, this.tmpAim);
    if (hit) this.aim.copy(hit);
  }
  private tmpAim = new V3();

  private updateCamera(raw: number) {
    // 플레이어를 부분적으로만 따라가는 쿼터뷰 고정 카메라
    const p = this.player.pos;
    const b = this.boss && this.boss.alive ? this.boss.pos : null;
    const tx = p.x * CFG.camera.followRatio + (b ? b.x * CFG.camera.bossRatio : 0);
    const tz = p.z * CFG.camera.followRatio + (b ? b.z * CFG.camera.bossRatio : 0);
    const l = Math.hypot(tx, tz);
    const k = l > CFG.camera.followMax ? CFG.camera.followMax / l : 1;
    this.camFocus.x += (tx * k - this.camFocus.x) * (1 - Math.exp(-CFG.camera.smooth * raw));
    this.camFocus.z += (tz * k - this.camFocus.z) * (1 - Math.exp(-CFG.camera.smooth * raw));

    const el = (CFG.camera.elevationDeg * Math.PI) / 180;
    // 좁은 화면에서도 아레나 좌우가 잘리지 않도록 거리를 늘린다
    const hTan = Math.tan((CFG.camera.fov * Math.PI) / 360) * this.camera.aspect;
    const d = Math.max(CFG.camera.distance, (CFG.arena.radius + 2) / hTan);
    this.shakeAmt *= Math.exp(-9 * raw);
    const sx = (Math.random() - 0.5) * 2 * this.shakeAmt * 0.45;
    const sy = (Math.random() - 0.5) * 2 * this.shakeAmt * 0.45;
    this.camera.position.set(this.camFocus.x + sx, d * Math.sin(el) + sy, this.camFocus.z + d * Math.cos(el));
    this.camera.lookAt(this.camFocus.x, 0, this.camFocus.z);
  }

  private updateReticle() {
    this.reticle.visible = this.state !== 'title';
    this.aimLine.visible = (this.state === 'play' || this.state === 'intro') && !this.player.dead;
    this.reticle.position.set(this.aim.x, 0.08, this.aim.z);
    this.reticle.scale.setScalar(1 + 0.08 * Math.sin(this.time * 8));
    const pos = this.aimLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, this.player.pos.x, 0.9, this.player.pos.z);
    pos.setXYZ(1, this.aim.x, 0.08, this.aim.z);
    pos.needsUpdate = true;
  }
}

const game = new Game();
// 콘솔 디버깅용 (예: __game.player.setHp(1), __game.boss.forceAttack('pounce'))
(window as unknown as { __game: Game }).__game = game;
