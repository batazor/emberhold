/**
 * Настройки игрока. Пока это только микшер (§18.5), но лежит он отдельно от
 * сейва намеренно: громкость — не состояние игры. Она обязана переживать
 * «Новую игру», иначе первое, что слышит игрок после сброса, — звук, который
 * он специально выключил.
 *
 * Модуль в core рядом со звуком и часами: это граница хранилища, а не
 * игровое правило. Разбор сырого значения вынесен в чистую `readMix` —
 * её проверяет `settings.rules.ts` без браузера.
 */
import { DEFAULT_MIX } from './audio';
import type { Mix } from './audio';

const KEY = 'emberhold/settings';

const knob = (raw: unknown, fallback: number): number => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(1, raw));
};

/**
 * Микшер из сырого объекта. Каждая ручка читается по одной и с проверкой:
 * настройкам из хранилища доверия не больше, чем сейву (§6). Испорченное
 * поле возвращается к умолчанию, а не роняет игру в тишину.
 */
export function readMix(raw: unknown): Mix {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    master: knob(o.master, DEFAULT_MIX.master),
    sfx: knob(o.sfx, DEFAULT_MIX.sfx),
    ui: knob(o.ui, DEFAULT_MIX.ui),
    amb: knob(o.amb, DEFAULT_MIX.amb),
  };
}

export function loadMix(): Mix {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_MIX;
    return readMix(JSON.parse(raw));
  } catch {
    // Приватный режим Safari и Node: хранилища нет — играем на умолчаниях.
    return DEFAULT_MIX;
  }
}

export function saveMix(mix: Mix): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(mix));
  } catch {
    /* см. loadMix() */
  }
}
