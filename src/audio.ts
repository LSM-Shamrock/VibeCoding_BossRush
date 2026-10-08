// 외부 음원 없이 Web Audio API로 효과음을 합성한다.
// 측정 결과 개별 효과음의 최대 진폭이 0.01~0.22 수준이라 마스터를 0.8로 둬도 클리핑 여유가 있다.
const MASTER = 0.8;
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
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
    o.connect(g).connect(this.master);
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
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.03);
  }

  shoot() {
    this.tone(900, 380, 0.07, 'square', 0.05);
    this.noise(0.05, 0.03, 4000, 1500, 'highpass');
  }
  hit(weak: boolean) {
    if (weak) {
      this.tone(1200, 1800, 0.09, 'triangle', 0.12);
      this.tone(600, 300, 0.06, 'square', 0.05);
    } else {
      this.tone(220, 120, 0.06, 'square', 0.07);
    }
  }
  dash() {
    this.noise(0.18, 0.12, 600, 3200, 'bandpass');
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
  /** 페이즈 전환 포효 */
  roar() {
    this.tone(95, 55, 1.4, 'sawtooth', 0.2);
    this.tone(142, 80, 1.2, 'square', 0.08, 0.08);
    this.noise(1.2, 0.2, 1200, 120, 'bandpass');
    this.tone(60, 40, 1.8, 'sine', 0.4);
  }
  /** 알 / 새끼가 터지는 소리 */
  pop() {
    this.tone(420, 120, 0.1, 'square', 0.08);
    this.noise(0.1, 0.1, 3500, 600, 'highpass');
  }
  /** 보스 사망 */
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
      f.connect(g).connect(this.master);
      this.droneNodes = { o: oscs, g, f };
    }
    const d = this.droneNodes;
    d.g.gain.setTargetAtTime(0.045 + 0.05 * intensity, c.currentTime, 0.6);
    d.f.frequency.setTargetAtTime(170 + 220 * intensity, c.currentTime, 0.6);
  }
}
