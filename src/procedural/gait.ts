import * as THREE from 'three';

const V3 = THREE.Vector3;

export interface GaitOptions {
  /** 발이 "홈 위치"에서 이만큼 벗어나면 새로 디딘다 */
  threshold: number;
  /** 한 걸음에 걸리는 시간 */
  stepTime: number;
  /** 발을 드는 높이 */
  lift: number;
  /** 이동 속도 × lead 만큼 앞을 보고 디딘다 */
  lead: number;
}

/**
 * Gait — 발걸음 시스템.
 * 각 발은 월드에 "고정(planted)"되어 있다가, 몸이 움직여 홈 위치에서 멀어지면 호를 그리며 새 위치로 옮겨 디딘다.
 * 다리를 두 그룹으로 나눠 한 그룹이 걷는 동안 반대 그룹은 땅을 짚는다 (거미: 대각선 4개씩).
 * IK 와는 분리되어 있어서, 여기서 나온 발 위치를 LegIK 의 target 으로 넘기면 된다.
 */
export class Gait {
  readonly feet: THREE.Vector3[] = [];
  private from: THREE.Vector3[] = [];
  private to: THREE.Vector3[] = [];
  private t: number[] = [];
  private dur: number[] = [];
  private stepping: boolean[] = [];
  private liftNow: number[] = [];

  constructor(
    readonly count: number,
    private groups: number[],
  ) {
    for (let i = 0; i < count; i++) {
      this.feet.push(new V3());
      this.from.push(new V3());
      this.to.push(new V3());
      this.t.push(0);
      this.dur.push(0.2);
      this.stepping.push(false);
      this.liftNow.push(0);
    }
  }

  /** 모든 발을 홈 위치에 즉시 놓는다 */
  snap(homes: THREE.Vector3[]): void {
    for (let i = 0; i < this.count; i++) {
      this.feet[i].copy(homes[i]);
      this.stepping[i] = false;
      this.liftNow[i] = 0;
    }
  }

  /** 모든 발을 동시에 새 위치로 옮긴다 (착지 때 다리가 사방으로 퍼지는 연출) */
  slideAll(homes: THREE.Vector3[], time: number, lift = 0.4): void {
    for (let i = 0; i < this.count; i++) {
      this.from[i].copy(this.feet[i]);
      this.to[i].copy(homes[i]);
      this.t[i] = 0;
      this.dur[i] = time;
      this.stepping[i] = true;
      this.liftNow[i] = lift;
    }
  }

  isStepping(i: number): boolean {
    return this.stepping[i];
  }

  update(dt: number, homes: THREE.Vector3[], vel: THREE.Vector3, o: GaitOptions): void {
    // 진행 중인 걸음 갱신
    for (let i = 0; i < this.count; i++) {
      if (!this.stepping[i]) continue;
      this.t[i] += dt / this.dur[i];
      const k = Math.min(1, this.t[i]);
      const e = k * k * (3 - 2 * k);
      this.feet[i].lerpVectors(this.from[i], this.to[i], e);
      if (k >= 1) {
        this.stepping[i] = false;
        this.feet[i].copy(this.to[i]);
      }
    }

    // 새 걸음 시작 판정
    for (let i = 0; i < this.count; i++) {
      if (this.stepping[i]) continue;
      const dx = this.feet[i].x - homes[i].x;
      const dz = this.feet[i].z - homes[i].z;
      const d = Math.hypot(dx, dz);
      if (d <= o.threshold) continue;
      let blocked = false;
      for (let j = 0; j < this.count; j++) {
        if (this.stepping[j] && this.groups[j] !== this.groups[i]) {
          blocked = true;
          break;
        }
      }
      // 너무 뒤처졌으면 반대 그룹이 걷는 중이어도 강제로 디딘다
      if (blocked && d < o.threshold * 2.4) continue;

      this.from[i].copy(this.feet[i]);
      this.to[i].set(homes[i].x + vel.x * o.lead, homes[i].y, homes[i].z + vel.z * o.lead);
      this.t[i] = 0;
      this.dur[i] = o.stepTime;
      this.stepping[i] = true;
      this.liftNow[i] = o.lift;
    }
  }

  /** i번째 발의 현재 월드 위치 (걷는 중이면 호를 그리며 들려 있다) */
  get(i: number, out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.feet[i]);
    if (this.stepping[i]) out.y += Math.sin(Math.PI * Math.min(1, this.t[i])) * this.liftNow[i];
    return out;
  }
}
