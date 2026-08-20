import type { BuildingId, CampState } from './camp';
import { BUILDING_ORDER, campArea, createCamp } from './camp';
import { emptyResources } from './resources';
import type { ResourceKind } from './resources';

/**
 * §6: состояние — единый сериализуемый объект, версионированный, localStorage.
 * Серверной валидации в v0 нет, но структура сразу пригодна к переносу:
 * ни одного поля, которое нельзя проверить на сервере.
 */
const KEY = 'new-world/save';
const VERSION = 1;

interface SaveV1 {
  version: 1;
  savedAt: number;
  /** Монотонная отметка времени — с ней клок не сбрасывается переводом часов. */
  watermark: number;
  levels: Record<BuildingId, number>;
  layout: Record<BuildingId, { x: number; z: number }>;
  resources: Record<ResourceKind, number>;
  construction: CampState['construction'];
  raids: number;
}

export interface LoadResult {
  readonly camp: CampState;
  readonly watermark: number;
}

export function save(camp: CampState, watermark: number): void {
  const data: SaveV1 = {
    version: VERSION,
    savedAt: Date.now() / 1000,
    watermark,
    levels: camp.levels,
    layout: camp.layout,
    resources: camp.resources,
    construction: camp.construction,
    raids: camp.raids,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Приватный режим или переполнение — игра обязана продолжать работать
    // без сохранения, а не падать на записи.
  }
}

export function load(): LoadResult {
  const camp = createCamp();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === null) return { camp, watermark: 0 };

  try {
    const data = JSON.parse(raw) as Partial<SaveV1>;
    // Чужая или будущая версия — начинаем заново, но не роняем игру.
    if (data.version !== VERSION) return { camp, watermark: 0 };

    for (const id of BUILDING_ORDER) {
      const level = data.levels?.[id];
      if (typeof level === 'number' && level >= 1 && level <= 6) camp.levels[id] = level;
      const pos = data.layout?.[id];
      if (pos !== undefined && typeof pos.x === 'number' && typeof pos.z === 'number') {
        camp.layout[id] = { x: pos.x, z: pos.z };
      }
    }

    // Площадь зависит от Штаба, а сейв мог быть записан другой версией правил.
    // Здание, не влезающее в текущую площадь, возвращается на место по умолчанию:
    // молча уехавшая за край постройка выглядит как пропажа.
    const area = campArea(camp.levels.hq);
    const fallback = createCamp().layout;
    for (const id of BUILDING_ORDER) {
      const p = camp.layout[id];
      if (p.x < 0 || p.z < 0 || p.x + 2 > area || p.z + 2 > area) camp.layout[id] = fallback[id];
    }
    const res = emptyResources();
    for (const kind of Object.keys(res) as ResourceKind[]) {
      const value = data.resources?.[kind];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        res[kind] = Math.floor(value);
      }
    }
    camp.resources = res;
    if (typeof data.raids === 'number') camp.raids = data.raids;

    const c = data.construction;
    if (c != null && BUILDING_ORDER.includes(c.building) && typeof c.endsAt === 'number') {
      camp.construction = c;
    }
    return { camp, watermark: typeof data.watermark === 'number' ? data.watermark : 0 };
  } catch {
    return { camp, watermark: 0 };
  }
}

export function wipe(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* см. save() */
  }
}
