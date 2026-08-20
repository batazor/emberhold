/**
 * Что показывает и что играет каждая сцена. Таблица, а не четыре набора
 * вызовов в переходах: панелей семь, сцен три, и раскладывались они руками
 * в toRaid, toGlade, toCamp и toTitle по отдельности. Такой список ломается
 * молча — новая панель, забытая в одном переходе, остаётся висеть поверх
 * чужой сцены, и увидеть это можно только пройдя игру целиком.
 *
 * Решение здесь, применение — в main: показывать умеют сами панели, а фича
 * знает только, чему быть видимым. Поэтому таблица проверяется в Node
 * (`scene.rules.ts`), без DOM и без звука.
 */

export type Scene = 'title' | 'camp' | 'raid';

/** Кто на экране. */
export interface Panels {
  /** Полосы вылазки (§11.1). */
  readonly hud: boolean;
  /** Лист лагеря. */
  readonly campHud: boolean;
  readonly roster: boolean;
  readonly stats: boolean;
  readonly startScreen: boolean;
  /** Предложение разбить лагерь — его поднимает пролог, а не сцена. */
  readonly campPrompt: boolean;
  /** Экран возврата (§20.1) — его открывает конец вылазки, а не сцена. */
  readonly returnScreen: boolean;
}

/**
 * Панели сцены. `quiet` — кадры 9 и 10 раскадровки: лагерь показывает ровно
 * одно действие, отряд и данные ждут своей очереди.
 */
export function panelsFor(scene: Scene, quiet = false): Panels {
  const none = {
    hud: false,
    campHud: false,
    roster: false,
    stats: false,
    startScreen: false,
    campPrompt: false,
    returnScreen: false,
  };
  switch (scene) {
    case 'title':
      return { ...none, startScreen: true };
    case 'camp':
      return { ...none, campHud: true, roster: !quiet, stats: !quiet };
    case 'raid':
      return { ...none, hud: true };
  }
}

/** Что звучит (§18.4, §18.2). */
export interface Sound {
  /** Ярус подложки или null — тишина. */
  readonly ambient: number | null;
  /** Единственная мелодия игры звучит только в лагере. */
  readonly campTune: boolean;
  /** Пульс провианта отсчитывает только там, где провиант тратится. */
  readonly pulse: boolean;
}

export function soundFor(scene: Scene, tier: number): Sound {
  switch (scene) {
    case 'title':
      return { ambient: null, campTune: false, pulse: false };
    case 'camp':
      return { ambient: null, campTune: true, pulse: false };
    case 'raid':
      return { ambient: tier, campTune: false, pulse: true };
  }
}
