import * as THREE from 'three';
import type { ActionId, Keybinds } from './keybinds';

/** 설정과 무관하게 브라우저 기본 동작(스크롤/포커스 이동)을 막을 키 */
const ALWAYS_PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  readonly keys = new Set<string>();
  /** 이번 프레임에 새로 눌린 키 (endFrame에서 비움) */
  readonly pressed = new Set<string>();
  readonly mouseNDC = new THREE.Vector2();
  mouseDown = false;
  /** 마우스 이동량 누적 (포인터 락 상태에서 시점 회전에 사용) */
  lookDX = 0;
  lookDY = 0;
  private el: HTMLElement;

  constructor(el: HTMLElement, private binds: Keybinds) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (ALWAYS_PREVENT.has(e.code) || this.binds.isBound(e.code))) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    el.addEventListener('pointermove', (e) => {
      this.setMouse(e);
      if (document.pointerLockElement === el) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    });
    el.addEventListener('pointerdown', (e) => {
      this.setMouse(e);
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 1) {
        e.preventDefault();
        this.pressed.add('MouseMiddle');
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private setMouse(e: PointerEvent) {
    this.mouseNDC.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  /** 물리 키 코드로 직접 조회 (Esc/Enter/디버그 키처럼 설정과 무관한 키) */
  down(code: string) {
    return this.keys.has(code);
  }
  hit(code: string) {
    return this.pressed.has(code);
  }
  /** 동작 기준 조회: 현재 키 설정에 따라 기본/보조 키 중 하나라도 눌려 있으면 true */
  held(action: ActionId) {
    for (const k of this.binds.keys(action)) if (this.keys.has(k)) return true;
    return false;
  }
  /** 이번 프레임에 새로 눌렸는지 */
  tapped(action: ActionId) {
    for (const k of this.binds.keys(action)) if (this.pressed.has(k)) return true;
    return false;
  }
  /** 쌓인 마우스 이동량을 꺼내고 비운다 */
  takeLook(out: { x: number; y: number }) {
    out.x = this.lookDX;
    out.y = this.lookDY;
    this.lookDX = this.lookDY = 0;
  }
  get locked() {
    return document.pointerLockElement === this.el;
  }
  endFrame() {
    this.pressed.clear();
  }
}
