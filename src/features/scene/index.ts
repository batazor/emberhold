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

export type Scene = 'title' | 'camp' | 'visit' | 'raid';

/** Кто на экране. */
export interface Panels {
  /** Полосы вылазки (§11.1). */
  readonly hud: boolean;
  /** Лист лагеря. */
  readonly campHud: boolean;
  readonly roster: boolean;
  readonly startScreen: boolean;
  /** Предложение разбить лагерь — его поднимает пролог, а не сцена. */
  readonly campPrompt: boolean;
  /** Экран возврата (§20.1) — его открывает конец вылазки, а не сцена. */
  readonly returnScreen: boolean;
}

/**
 * Панели сцены. `quiet` — кадры 9 и 10 раскадровки: лагерь показывает ровно
 * одно действие, отряд ждёт своей очереди. Сводки в таблице больше нет:
 * она открывается из настроек (`ui/settings.ts`), а шестерня видна во всех
 * сценах — прятать её сценой было бы уже другим решением.
 */
export function panelsFor(scene: Scene, quiet = false): Panels {
  const none = {
    hud: false,
    campHud: false,
    roster: false,
    startScreen: false,
    campPrompt: false,
    returnScreen: false,
  };
  switch (scene) {
    case 'title':
      return { ...none, startScreen: true };
    case 'camp':
      return { ...none, campHud: true, roster: !quiet };
    case 'visit':
      // Гостевой режим держит свою компактную рамку снаружи этой таблицы;
      // боевой и хозяйственный интерфейсы в чужой лагерь не проходят.
      return none;
    case 'raid':
      return { ...none, hud: true };
  }
}

/** Что звучит (§18.4, §18.2). */
export interface Sound {
  /** Ярус подложки или null — тишина. */
  readonly ambient: number | null;
  /** Фоновая музыка звучит везде; под землёй — свой, пещерный плейлист. */
  readonly campTune: 'camp' | 'cave';
  /** Пульс провианта отсчитывает только там, где провиант тратится. */
  readonly pulse: boolean;
}

/** Копи и дно (§18.4): с этого яруса вылазка уходит под землю. */
const UNDERGROUND_TIER = 2;

export function soundFor(scene: Scene, tier: number): Sound {
  switch (scene) {
    case 'title':
      return { ambient: null, campTune: 'camp', pulse: false };
    case 'camp':
      return { ambient: null, campTune: 'camp', pulse: false };
    case 'visit':
      return { ambient: null, campTune: 'camp', pulse: false };
    case 'raid':
      return {
        ambient: tier,
        campTune: tier >= UNDERGROUND_TIER ? 'cave' : 'camp',
        pulse: true,
      };
  }
}
