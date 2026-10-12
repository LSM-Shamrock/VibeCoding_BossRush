// 외부 음원 없이 Web Audio API로 효과음을 합성한다.
// 측정 결과 개별 효과음의 최대 진폭이 0.01~0.22 수준이라 마스터를 0.8로 둬도 클리핑 여유가 있다.
const MASTER = 0.8;
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 효과음 · 배경 음악 각각의 음량 조절 버스 (설정 창의 사운드 탭) */
  private sfxBus!: GainNode;
  private bgmBus!: GainNode;
  vol = { sfx: 1, bgm: 1 };
  private static readonly VOL_KEY = 'deepnest.volume';
  constructor() {
    try {
      const o = JSON.parse(localStorage.getItem(Sfx.VOL_KEY) ?? 'null');
      if (o && typeof o.sfx === 'number') this.vol.sfx = Math.min(1, Math.max(0, o.sfx));
      if (o && typeof o.bgm === 'number') this.vol.bgm = Math.min(1, Math.max(0, o.bgm));
    } catch {
      /* 저장값이 없거나 못 읽으면 기본값 */
    }
  }
  setVolume(kind: 'sfx' | 'bgm', v: number) {
    this.vol[kind] = Math.min(1, Math.max(0, v));
    const bus = kind === 'sfx' ? this.sfxBus : this.bgmBus;
    if (bus) bus.gain.value = this.vol[kind];
    try {
      localStorage.setItem(Sfx.VOL_KEY, JSON.stringify(this.vol));
    } catch {
      /* ignore */
    }
  }
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  /** 브라우저 정책상 첫 사용자 입력 이후에 호출해야 소리가 난다 */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = this.vol.sfx;
        this.sfxBus.connect(this.master);
        this.bgmBus = this.ctx.createGain();
        this.bgmBus.gain.value = this.vol.bgm;
        this.bgmBus.connect(this.master);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : MASTER;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dur: number, vol: number, f0: number, f1: number, type: BiquadFilterType = 'lowpass', delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t);
    s.stop(t + dur + 0.03);
  }

  shoot() {
    this.tone(900, 380, 0.07, 'square', 0.05);
    this.noise(0.05, 0.03, 4000, 1500, 'highpass');
  }
  /** 피격음: 들어간 데미지(amount)가 클수록 낮고 묵직하고 크게, 작을수록 가볍고 짧게. 14 ≈ 완전 차징 기본 공격 */
  hit(amount: number) {
    const t = Math.min(1, Math.sqrt(Math.max(0, amount) / 20)); // 0..1 (0.8→0.2, 5→0.5, 14→0.84)
    // 가벼운 '틱' → 큰 데미지일수록 음정이 높고 길게 울리는 '팅'
    this.tone(700 + 700 * t, 900 + 1500 * t, 0.04 + 0.08 * t, 'triangle', 0.04 + 0.1 * t);
    if (t > 0.3) this.tone(520 - 240 * t, 200 - 80 * t, 0.06 + 0.1 * t, 'square', 0.03 + 0.06 * t);
    // 묵직한 타격감: 저음 쿵 + 잡음
    if (t > 0.5) {
      this.tone(150 - 60 * t, 48, 0.12 + 0.16 * t, 'sine', 0.1 + 0.16 * (t - 0.5));
      this.noise(0.05 + 0.08 * t, 0.04 + 0.08 * (t - 0.5), 2500, 500, 'lowpass');
    }
  }
  dash() {
    this.noise(0.18, 0.12, 600, 3200, 'bandpass');
  }

  /* ───────────── 불꽃 차징 (누르고 있는 동안 계속 나는 소리) ───────────── */
  // 톤(오실레이터)을 쓰지 않는다 — 음정이 있으면 레이저/기계음처럼 들린다. 잡음을 필터로 깎은 '바람'만 쓴다.
  private chg: {
    src: AudioBufferSourceNode[];
    lfo: OscillatorNode[];
    wf: BiquadFilterNode;
    lp: BiquadFilterNode;
    wg: GainNode;
    rg: GainNode;
    timer: number;
    level: number;
    /** 다음 맥동을 낼 오디오 시각 */
    next: number;
    /** 완전히 모인 뒤인가 */
    full: boolean;
  } | null = null;

  /** 차징 시작: 불꽃을 빨아들이는 바람 소리. 모일수록 바람이 밝아지고 조금 커지고, 가끔 불씨 튀는 소리가 섞인다. */
  chargeStart() {
    if (!this.ctx || !this.master || !this.noiseBuf || this.chg) return;
    const c = this.ctx;
    const mkNoise = () => {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      return src;
    };
    // ① 바람: 밴드패스 잡음. 중심 주파수가 서서히 오른다.
    const wSrc = mkNoise();
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 380;
    wf.Q.value = 0.8;
    const lp = c.createBiquadFilter(); // 쉭— 하는 고음을 깎아 바람답게
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.5;
    const wg = c.createGain();
    wg.gain.value = 0.0001;
    wSrc.connect(wf).connect(lp).connect(wg).connect(this.sfxBus);
    // ② 숨결: 낮은 대역만 통과시킨 잡음 (몸통 있는 공기 소리)
    const rSrc = mkNoise();
    const rf = c.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 170;
    rf.Q.value = 0.4;
    const rg = c.createGain();
    rg.gain.value = 0.0001;
    rSrc.connect(rf).connect(rg).connect(this.sfxBus);
    // ③ 바람이 일렁이도록 아주 느린 두 개의 흔들림 (세기, 음색). 박자가 느리고 불규칙해서 기계 떨림처럼 들리지 않는다.
    const swell = c.createOscillator();
    swell.frequency.value = 0.9;
    const swellG = c.createGain();
    swellG.gain.value = 0.009;
    swell.connect(swellG).connect(wg.gain);
    const gust = c.createOscillator();
    gust.frequency.value = 0.37;
    const gustG = c.createGain();
    gustG.gain.value = 70;
    gust.connect(gustG).connect(wf.frequency);
    for (const n of [wSrc, rSrc]) n.start(0, Math.random() * 0.9);
    swell.start();
    gust.start();
    // ④ 맥동 + 불씨 소리: 25ms 마다 앞을 내다보며 예약한다. 맥동 간격은 모일수록 빨라진다(두… 둥… 두둥둥둥둥).
    const timer = window.setInterval(() => this.chargeTick(), 25);
    this.chg = { src: [wSrc, rSrc], lfo: [swell, gust], wf, lp, wg, rg, timer, level: 0, next: c.currentTime, full: false };
    this.chargeLevel(0);
    this.chargeTick();
  }

  /** 맥동 간격: 처음 0.22초 → 가득 찰 때 0.06초 */
  private pulseGap(k: number) {
    return 0.22 * Math.pow(0.27, k);
  }

  private chargeTick() {
    const n = this.chg;
    if (!n || !this.ctx) return;
    const now = this.ctx.currentTime;
    // 맥동 하나 = 짧게 터지는 바람 한 줌(+ 초반엔 낮은 둥). 음정이 아니라 잡음이라 기계음처럼 들리지 않는다.
    while (n.next < now + 0.06) {
      const k = n.level;
      const d = Math.max(0, n.next - now);
      this.noise(0.1 + 0.05 * (1 - k), 0.11 + 0.05 * k, 480 + 900 * k, 1700 + 2500 * k, 'bandpass', d);
      if (k < 0.8) this.tone(175 - 55 * k, 85, 0.11, 'sine', 0.09 * (1 - k), d);
      n.next += this.pulseGap(k);
    }
    // 불씨 튀는 소리: 모일수록 촘촘해진다
    const k = n.level;
    if (Math.random() < 0.05 + 0.5 * k * k) this.noise(0.03, 0.006 + 0.012 * k, 2200 + Math.random() * 2600, 700, 'bandpass');
  }

  /** 차징 세기 0~1: 바람이 밝아지고(380 → 1500Hz) 조금씩 커진다 */
  chargeLevel(level: number) {
    if (!this.ctx || !this.chg) return;
    const t = this.ctx.currentTime;
    const n = this.chg;
    const k = Math.max(0, Math.min(1, level));
    n.level = k;
    n.wf.frequency.setTargetAtTime(340 + 1000 * k * k, t, 0.08);
    n.lp.frequency.setTargetAtTime(1000 + 1500 * k, t, 0.08);
    const boost = n.full ? 0.03 : 0; // 가득 찬 뒤엔 바람이 한 단계 더 거세진다
    n.wg.gain.setTargetAtTime(0.036 + 0.06 * k + boost, t, 0.08);
    n.rg.gain.setTargetAtTime(0.042 + 0.06 * k + boost, t, 0.08);
  }

  /** 완전히 모였다는 신호: 딱 하는 균열음 + 훅 빨려 들어가는 바람 + 묵직한 저음 한 방 + 흩어지는 불씨. (모두 잡음/저음이라 음정이 없다) */
  chargeFull() {
    this.noise(0.06, 0.11, 3000, 9000, 'highpass');
    this.noise(0.3, 0.14, 300, 2600, 'bandpass');
    this.tone(150, 44, 0.4, 'sine', 0.2);
    this.noise(0.55, 0.04, 6500, 2500, 'highpass', 0.05);
    if (this.chg) {
      this.chg.full = true;
      this.chargeLevel(this.chg.level);
    }
  }

  /** 발사/취소: 소리를 짧게 줄여서 끈다 */
  chargeStop() {
    if (!this.ctx || !this.chg) return;
    const t = this.ctx.currentTime;
    const n = this.chg;
    this.chg = null;
    window.clearInterval(n.timer);
    for (const g of [n.wg, n.rg]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.0001, t, 0.03);
    }
    window.setTimeout(() => {
      n.src.forEach((x) => x.stop());
      n.lfo.forEach((x) => x.stop());
    }, 300);
  }

  /** 완전 차징 불꽃의 폭발 */
  boom() {
    this.noise(0.55, 0.3, 2800, 90, 'lowpass');
    this.noise(0.3, 0.1, 5200, 1400, 'highpass');
    this.tone(125, 38, 0.45, 'sine', 0.3);
  }
  playerHit() {
    this.tone(160, 50, 0.3, 'sawtooth', 0.22);
    this.noise(0.22, 0.18, 1400, 200);
  }
  explosion(big: boolean) {
    this.noise(big ? 0.7 : 0.38, big ? 0.5 : 0.3, 2000, 60);
    this.tone(110, 35, big ? 0.6 : 0.4, 'sine', big ? 0.45 : 0.3);
  }
  telegraph() {
    this.tone(180, 380, 0.5, 'sawtooth', 0.035);
  }
  special() {
    this.tone(300, 900, 0.3, 'sine', 0.14);
  }
  ready() {
    this.tone(660, 990, 0.12, 'triangle', 0.1);
    this.tone(990, 1320, 0.14, 'triangle', 0.1, 0.1);
  }
  relight() {
    this.tone(200, 620, 0.55, 'sine', 0.08);
  }
  death() {
    this.tone(300, 40, 0.9, 'sawtooth', 0.2);
  }

  /* ───────────── 보스 / 거미 ───────────── */
  /** 방패처럼 화살이 다리에 막히는 소리 */
  block() {
    this.tone(2400, 1500, 0.05, 'triangle', 0.05);
  }
  /** 거미줄 발사 */
  web() {
    this.noise(0.28, 0.14, 5000, 900, 'highpass');
    this.tone(700, 260, 0.2, 'sawtooth', 0.05);
  }
  /** 독침 / 알 투척 */
  spit() {
    this.tone(500, 160, 0.16, 'square', 0.07);
    this.noise(0.12, 0.08, 3000, 700, 'bandpass');
  }
  /** 점프 시작 (웅크렸다 도약) */
  leap() {
    this.noise(0.35, 0.16, 300, 2200, 'bandpass');
    this.tone(120, 300, 0.25, 'sine', 0.12);
  }
  /** 착지 충격파 */
  land() {
    this.noise(0.55, 0.45, 1500, 50);
    this.tone(95, 28, 0.6, 'sine', 0.5);
    this.tone(260, 70, 0.2, 'square', 0.08);
  }
  /** 용의 포효: 목이 울리는 낮은 으르렁(떨리는 톱니파 + 포먼트) → 터져 나오는 고함 → 길게 갈라지며 잦아드는 소리 */
  roar(vol = 1) {
    this.growl(1.0 * vol, 2.6, 190, 0.2);
    // 저음으로 바닥을 울리는 몸통
    this.tone(52, 30, 2.8, 'sine', 0.5 * vol);
    this.tone(70, 28, 1.0, 'sine', 0.55 * vol, 0.5);
    // 거친 숨 / 쇳소리 끝자락
    this.noise(2.2, 0.22 * vol, 1700, 150, 'bandpass');
    this.noise(1.4, 0.2 * vol, 5600, 900, 'highpass', 0.25);
    this.noise(0.5, 0.42 * vol, 900, 40, 'lowpass', 0.5);
  }
  /** 아기 용의 울음: 높고 짧게 찢어지는 소리 */
  babyRoar(vol = 1) {
    this.growl(0.7 * vol, 0.9, 520, 0.12);
    this.tone(900, 420, 0.5, 'sawtooth', 0.05 * vol);
    this.noise(0.5, 0.12 * vol, 4200, 900, 'bandpass');
  }
  /**
   * 으르렁 한 번: 피치가 솟았다 내려앉고(pitch 시작 주파수), 느리게 떨리며(비브라토), 입 모양처럼 필터가 열렸다 닫힌다.
   * len 초, base = 시작 기본음, rise = 처음 솟는 정도 (0~)
   */
  private growl(vol: number, len: number, base: number, rise: number) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vol, t + 0.18);
    g.gain.setValueAtTime(0.2 * vol, t + len * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    // 입 모양: 두 개의 포먼트(밴드패스) 를 거친다
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 2.2;
    f1.frequency.setValueAtTime(base * 2.2, t);
    f1.frequency.exponentialRampToValueAtTime(base * 5.5, t + len * 0.3);
    f1.frequency.exponentialRampToValueAtTime(base * 1.6, t + len);
    const f2 = c.createBiquadFilter();
    f2.type = 'lowpass';
    f2.frequency.setValueAtTime(base * 9, t);
    f2.frequency.exponentialRampToValueAtTime(base * 2.5, t + len);
    f1.connect(f2).connect(g).connect(this.sfxBus);
    const lfo = c.createOscillator();
    lfo.frequency.value = 18 + base * 0.02;
    const lg = c.createGain();
    lg.gain.value = base * 0.07;
    lfo.connect(lg);
    for (const [det, type] of [[0, 'sawtooth'], [9, 'sawtooth'], [-7, 'square']] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.setValueAtTime(base * 0.7, t);
      o.frequency.exponentialRampToValueAtTime(base * (1 + rise * 3), t + 0.22);
      o.frequency.exponentialRampToValueAtTime(Math.max(24, base * 0.32), t + len);
      lg.connect(o.frequency);
      o.connect(f1);
      o.start(t);
      o.stop(t + len + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + len + 0.05);
  }
  /** 알 / 새끼가 터지는 소리 */
  pop() {
    this.tone(420, 120, 0.1, 'square', 0.08);
    this.noise(0.1, 0.1, 3500, 600, 'highpass');
  }
  /** 보스 사망 */
  /** 용의 화염 숨결: 낮게 우르릉거리는 바람 소리 (len 초) */
  flame(len = 1.2, vol = 1) {
    this.noise(len, 0.2 * vol, 500, 1700, 'bandpass');
    this.noise(len * 0.9, 0.12 * vol, 2600, 450, 'lowpass', 0.05);
    this.tone(96, 58, len, 'sawtooth', 0.06 * vol);
  }
  /** 거대한 날갯짓: 공기를 가르는 휙 소리 + 가죽막이 펄럭이는 둔탁한 소리 */
  wingbeat(vol = 1) {
    this.noise(0.42, 0.34 * vol, 380, 1500, 'bandpass'); // 휘익
    this.noise(0.38, 0.22 * vol, 1500, 220, 'bandpass', 0.18); // 내리칠 때 휘잉
    this.noise(0.26, 0.28 * vol, 520, 70, 'lowpass', 0.14); // 펄럭
    this.tone(66, 36, 0.32, 'sine', 0.34 * vol, 0.14); // 쿵
  }

  /* ───────────── 비행 바람 소리 (이동 중 계속) ───────────── */
  private windNodes: { src: AudioBufferSourceNode; f: BiquadFilterNode; g: GainNode } | null = null;
  /**
   * 용이 빠르게 움직일 때 귀를 스치는 바람 소리. 매 프레임 세기(0~1)를 넘겨 준다. 거의 0이면 서서히 꺼진다.
   * 속도가 오를수록 소리가 커지고 높아진다.
   */
  wind(k: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    if (!this.windNodes) {
      if (k < 0.02) return;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.9;
      f.frequency.value = 400;
      const g = c.createGain();
      g.gain.value = 0.0001;
      // 일렁이는 돌풍
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.7;
      const lg = c.createGain();
      lg.gain.value = 160;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start();
      this.windNodes = { src, f, g };
    }
    const w = this.windNodes;
    const kk = Math.max(0, Math.min(1, k));
    w.g.gain.setTargetAtTime(kk * 0.2, c.currentTime, 0.12);
    w.f.frequency.setTargetAtTime(320 + 900 * kk, c.currentTime, 0.12);
  }
  /** 태양 광선: 차오르는 울림(charge) / 발사 */
  sunCharge(len = 2) {
    this.tone(110, 520, len, 'sawtooth', 0.08);
    this.tone(55, 260, len, 'sine', 0.25);
    this.noise(len, 0.12, 300, 5200, 'bandpass');
  }
  sunFire(len = 4) {
    this.noise(len, 0.3, 2400, 900, 'bandpass');
    this.tone(70, 62, len, 'sawtooth', 0.14);
    this.tone(140, 130, len, 'square', 0.05);
    this.noise(0.6, 0.5, 3000, 80, 'lowpass');
  }
  bossDeath() {
    this.noise(1.6, 0.5, 2500, 40);
    this.tone(140, 24, 1.6, 'sawtooth', 0.3);
    this.tone(80, 22, 2.0, 'sine', 0.5);
  }
  /** 클리어 팡파르 */
  victory() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f * 1.002, 0.5, 'triangle', 0.12, i * 0.14));
  }
  /** 보스 등장 */
  bossIntro() {
    this.tone(70, 34, 1.0, 'sawtooth', 0.14);
    this.noise(0.8, 0.14, 800, 80, 'lowpass');
  }

  /* ───────────── 뱀 소리 ───────────── */
  /**
   * 뱀의 쉬익 소리: 높은 대역의 거친 잡음 + 빠른 떨림(쉭쉭 갈라지는 느낌) + 낮은 숨소리.
   * len 초 동안, vol 0~1. 대역이 올라갔다 내려가며 "스스ㅅㅅ슈" 하고 흐른다.
   */
  hiss(len = 0.8, vol = 1) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    const t = c.currentTime;
    const mk = () => {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      return s;
    };
    // 높은 쉭 소리
    const src = mk();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1900;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.55;
    bp.frequency.setValueAtTime(3400, t);
    bp.frequency.exponentialRampToValueAtTime(6400, t + len * 0.45);
    bp.frequency.exponentialRampToValueAtTime(4600, t + len);
    const env = c.createGain();
    const peak = 0.19 * vol;
    const att = Math.min(0.1, len * 0.22);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(peak, t + att);
    env.gain.setValueAtTime(peak, t + len * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    // 거친 떨림 (진폭 변조)
    const am = c.createGain();
    am.gain.value = 0.72;
    const lfo = c.createOscillator();
    lfo.frequency.value = 20 + Math.random() * 10;
    const lg = c.createGain();
    lg.gain.value = 0.26;
    lfo.connect(lg).connect(am.gain);
    src.connect(hp).connect(bp).connect(am).connect(env).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
    lfo.start(t);
    lfo.stop(t + len + 0.05);
    // 낮은 숨소리 (몸통이 큰 뱀의 바람)
    const src2 = mk();
    const bp2 = c.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 1.1;
    bp2.frequency.setValueAtTime(1100, t);
    bp2.frequency.exponentialRampToValueAtTime(1900, t + len * 0.5);
    bp2.frequency.exponentialRampToValueAtTime(900, t + len);
    const env2 = c.createGain();
    env2.gain.setValueAtTime(0.0001, t);
    env2.gain.exponentialRampToValueAtTime(0.05 * vol, t + att * 1.4);
    env2.gain.setValueAtTime(0.05 * vol, t + len * 0.5);
    env2.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src2.connect(bp2).connect(env2).connect(this.sfxBus);
    src2.start(t, Math.random() * 0.5);
    src2.stop(t + len + 0.05);
  }
  /** 혀 낼름: 아주 짧고 높은 '츠츠' */
  flick(vol = 1) {
    this.noise(0.05, 0.13 * vol, 8200, 5200, 'bandpass');
    this.noise(0.04, 0.1 * vol, 9000, 6000, 'bandpass', 0.075);
  }
  /** 물어뜯으려 덮치는 소리: 휙 + 쉭 + 묵직한 마찰 */
  strike() {
    this.noise(0.34, 0.2, 6500, 1700, 'bandpass');
    this.noise(0.24, 0.12, 900, 180, 'lowpass');
    this.tone(210, 70, 0.18, 'sawtooth', 0.06);
    this.hiss(0.36, 0.8);
  }

  private slitherNodes: {
    src: AudioBufferSourceNode;
    lfo: OscillatorNode;
    lg: GainNode;
    amp: GainNode;
    bp: BiquadFilterNode;
  } | null = null;
  private slitherLevel = 0;
  private slitherAt = 0;
  private slitherQuiet = 0;

  /**
   * 몸이 바닥을 쓸며 기어가는 소리 (계속 호출). level 0~1+ = 속도. 빠를수록 크고 촘촘하고 밝다.
   * 사각사각 비늘 쓸리는 소리 = 대역 잡음 + 느린 진폭 떨림.
   */
  slither(level: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const c = this.ctx;
    const now = c.currentTime;
    if (level < 0.02) {
      this.slitherQuiet += 1;
      if (this.slitherNodes && this.slitherQuiet > 120) {
        const n = this.slitherNodes;
        n.amp.gain.setTargetAtTime(0.0001, now, 0.1);
        const stop = () => {
          try {
            n.src.stop();
            n.lfo.stop();
          } catch {
            /* 이미 멈춤 */
          }
        };
        window.setTimeout(stop, 500);
        this.slitherNodes = null;
      }
      return;
    }
    this.slitherQuiet = 0;
    if (!this.slitherNodes) {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.value = 1300;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3800;
      const amp = c.createGain();
      amp.gain.value = 0.0001;
      const lfo = c.createOscillator();
      lfo.frequency.value = 5;
      const lg = c.createGain();
      lg.gain.value = 0;
      lfo.connect(lg).connect(amp.gain);
      src.connect(bp).connect(lp).connect(amp).connect(this.sfxBus);
      src.start();
      lfo.start();
      this.slitherNodes = { src, lfo, lg, amp, bp };
    }
    if (now - this.slitherAt < 0.08 && Math.abs(level - this.slitherLevel) < 0.05) return;
    this.slitherAt = now;
    this.slitherLevel = level;
    const n = this.slitherNodes;
    const l = Math.min(1.2, level);
    const base = 0.012 + 0.05 * l;
    n.amp.gain.setTargetAtTime(base, now, 0.1);
    n.lg.gain.setTargetAtTime(base * 0.8, now, 0.1);
    n.lfo.frequency.setTargetAtTime(3.5 + 7 * l, now, 0.15);
    n.bp.frequency.setTargetAtTime(900 + 1500 * l, now, 0.15);
  }

  /* ───────────── 배경 드론 ───────────── */
  private droneNodes: { o: OscillatorNode[]; g: GainNode; f: BiquadFilterNode } | null = null;

  /** 낮은 드론 BGM. intensity 0~1 (페이즈 2에서 올림). off면 서서히 끔 */
  drone(on: boolean, intensity = 0) {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    if (!on) {
      if (this.droneNodes) {
        const d = this.droneNodes;
        d.g.gain.cancelScheduledValues(c.currentTime);
        d.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.4);
        window.setTimeout(() => d.o.forEach((o) => o.stop()), 1800);
        this.droneNodes = null;
      }
      return;
    }
    if (!this.droneNodes) {
      const g = c.createGain();
      g.gain.value = 0.0001;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 180;
      const oscs: OscillatorNode[] = [];
      for (const [fr, type, det] of [
        [55, 'sawtooth', 0],
        [55, 'sawtooth', 7],
        [82.4, 'triangle', -4],
      ] as const) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start();
        oscs.push(o);
      }
      // 느린 LFO로 필터를 숨쉬듯 열고 닫는다
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.12;
      const lg = c.createGain();
      lg.gain.value = 70;
      lfo.connect(lg).connect(f.frequency);
      lfo.start();
      oscs.push(lfo);
      f.connect(g).connect(this.bgmBus);
      this.droneNodes = { o: oscs, g, f };
    }
    const d = this.droneNodes;
    d.g.gain.setTargetAtTime(0.045 + 0.05 * intensity, c.currentTime, 0.6);
    d.f.frequency.setTargetAtTime(170 + 220 * intensity, c.currentTime, 0.6);
  }
}
