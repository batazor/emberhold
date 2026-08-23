/** Декоративные указатели поселения. Координаты локальны для своей сцены. */
export type SignLocation = 'camp' | 'farm';

export interface PlayerSignpost {
  readonly x: number;
  readonly z: number;
  readonly text: string;
  /** Поворот лицевой стороны в радианах. */
  readonly turn: number;
}

export interface SignpostDecor {
  camp: PlayerSignpost[];
  farm: PlayerSignpost[];
}

export const SIGN_COST = 1;
export const SIGN_TEXT_MAX = 32;
export const SIGN_MAX_PER_LOCATION = 24;

export const emptySignpostDecor = (): SignpostDecor => ({ camp: [], farm: [] });

/** Одна строка без управляющих символов: её же пишет canvas-текстура. */
export function cleanSignText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SIGN_TEXT_MAX);
}

export function validSignposts(value: unknown): PlayerSignpost[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is PlayerSignpost =>
      v != null &&
      typeof v.x === 'number' && Number.isFinite(v.x) &&
      typeof v.z === 'number' && Number.isFinite(v.z) &&
      typeof v.turn === 'number' && Number.isFinite(v.turn) &&
      typeof v.text === 'string' && cleanSignText(v.text).length > 0,
    )
    .slice(0, SIGN_MAX_PER_LOCATION)
    .map((v) => ({ x: Math.round(v.x), z: Math.round(v.z), turn: v.turn, text: cleanSignText(v.text) }));
}
