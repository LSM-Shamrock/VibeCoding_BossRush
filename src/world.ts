import { CFG } from './config';

/**
 * 지금 층의 무대 크기. 층마다 아레나 크기가 다르므로 (1층 반경 18, 2층 연못은 3배) 게임 중에 읽는 값은 전부 여기서 읽는다.
 * arena.setTheme(층) 이 setWorldFloor 를 불러 갈아 끼운다.
 */
export const WORLD: { radius: number; playerLimit: number; wallLimit: number; spawnZ: number } = {
  radius: CFG.arena.radius,
  /** 플레이어가 갈 수 있는 한계 */
  playerLimit: CFG.arena.playerLimit,
  /** 카메라가 나가지 않는 한계 */
  wallLimit: CFG.camera.wallLimit,
  /** 플레이어 시작 위치 (z, 보스는 -z 쪽) */
  spawnZ: 9,
};

export function setWorldFloor(floor: number) {
  if (floor >= 2) {
    const r = CFG.pond.radius;
    WORLD.radius = r;
    WORLD.playerLimit = r - 0.7;
    WORLD.wallLimit = r + 2.4;
    WORLD.spawnZ = CFG.pond.spawnZ;
  } else {
    WORLD.radius = CFG.arena.radius;
    WORLD.playerLimit = CFG.arena.playerLimit;
    WORLD.wallLimit = CFG.camera.wallLimit;
    WORLD.spawnZ = 9;
  }
}
