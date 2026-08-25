/**
 * Два лагеря разработки. Они заполняют соседский слой, пока сервер не вернул
 * ни одного настоящего игрока, и дают пройти весь путь «карта → карточка →
 * осмотр лагеря» без второго аккаунта.
 *
 * Снимок отделён от строки таблицы намеренно. `LiveCamp` — дешёвая публичная
 * сводка, которую карта читает для всех; полное состояние нужно только после
 * явного входа. Когда сервер начнёт отдавать публичные снимки, UI продолжит
 * получать тот же `InspectableCamp`, а эти две записи можно будет удалить.
 */
import { createCamp } from './camp';
import type { CampState } from './camp';
import type { LiveCamp } from './standing';
import { campLevel, campPower } from './standing';

export interface InspectableCamp extends LiveCamp {
  readonly inspectable: true;
  readonly camp: CampState;
}

function emberArtel(): CampState {
  const camp = createCamp();
  camp.levels = {
    hq: 3, kitchen: 2, storage: 3, forge: 2, infirmary: 1, yard: 1,
    archery: 1, barracks: 0, watchtower: 0, archive: 0,
  };
  camp.resources = { stone: 24, wood: 18, iron: 7, crystal: 0, food: 21, meat: 2, pelt: 1 };
  camp.residents = [
    { id: 'sim-ember-runa', name: 'Руна', look: 'поселенка', seed: 101, answer: 'строим', rest: false },
    { id: 'sim-ember-tikhon', name: 'Тихон', look: 'поселенец', seed: 102, answer: 'кормим', rest: false },
    { id: 'sim-ember-varr', name: 'Варр', look: 'кузнец', seed: 103, answer: 'ходим', rest: true },
  ];
  camp.tents = [{ x: 0, z: 7 }, { x: 3, z: 7 }, { x: 7, z: 7 }];
  camp.chests = [{ x: 0, z: 3 }, { x: 7, z: 3 }];
  camp.fires = [{ x: 3, z: 0 }];
  camp.walls = {
    cells: [],
    fences: ['0:0', '1:0', '2:0', '3:0', '3:1', '3:2'],
    fence: 'дерево',
    roads: ['1:1', '1:2', '2:2'],
    lamps: ['1:1'],
    towers: {},
    gates: [],
    stairs: {},
    work: null,
  };
  return camp;
}

function northWatch(): CampState {
  const camp = createCamp();
  camp.levels = {
    hq: 4, kitchen: 4, storage: 4, forge: 3, infirmary: 2, yard: 3,
    archery: 3, barracks: 2, watchtower: 3, archive: 0,
  };
  camp.resources = { stone: 46, wood: 31, iron: 18, crystal: 4, food: 34, meat: 5, pelt: 3 };
  camp.residents = [
    { id: 'sim-watch-mira', name: 'Мира', look: 'охотник', seed: 201, answer: 'ходим', rest: false },
    { id: 'sim-watch-sava', name: 'Сава', look: 'поселенец', seed: 202, answer: 'строим', rest: false },
    { id: 'sim-watch-lada', name: 'Лада', look: 'поселенка', seed: 203, answer: 'кормим', rest: false },
    { id: 'sim-watch-olin', name: 'Олин', look: 'лесник', seed: 204, answer: 'строим', rest: false },
  ];
  camp.tents = [{ x: 0, z: 8 }, { x: 3, z: 8 }, { x: 6, z: 8 }, { x: 8, z: 0 }];
  camp.chests = [{ x: 0, z: 3 }, { x: 8, z: 3 }, { x: 8, z: 6 }];
  camp.fires = [{ x: 3, z: 0 }, { x: 5, z: 8 }];
  camp.walls = {
    cells: ['0:0', '1:0', '2:0', '3:0', '3:1', '3:2', '3:3'],
    fences: ['0:3', '1:3', '2:3'],
    fence: 'камень',
    roads: ['1:1', '1:2', '2:2', '2:3'],
    lamps: ['1:1', '2:3'],
    towers: { '0:0': 1, '3:0': 2, '3:3': 1 },
    gates: ['1:0'],
    stairs: { '3:2': 3 },
    work: null,
  };
  return camp;
}

const make = (id: string, clan: string, camp: CampState): InspectableCamp => ({
  id,
  clan,
  power: campPower(camp),
  level: campLevel(camp),
  folk: 1 + camp.residents.length,
  likes: 0,
  liked: false,
  inspectable: true,
  camp,
});

/** Стабильные id держат лагеря на одном месте глобальной карты. */
export const SIMULATED_CAMPS: readonly InspectableCamp[] = [
  make('sim-ember-artel', 'Артель Углей', emberArtel()),
  make('sim-north-watch', 'Северный Дозор', northWatch()),
];

export function simulatedCamp(id: string): InspectableCamp | null {
  return SIMULATED_CAMPS.find((item) => item.id === id) ?? null;
}

/** Публичные строки без копирования снимков: `LiveCamp` читает только сводку. */
export const simulatedCampRows = (): LiveCamp[] => [...SIMULATED_CAMPS];
