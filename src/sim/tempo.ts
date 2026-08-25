/**
 * Резонанс жилы (§13.11, имя рабочее — §0.1): клики по работе покупают
 * скорость добычи.
 *
 * Пассивная добыча остаётся прежней — герой машет сам, ×1, и все замеры
 * §13.3–§13.5 меряют именно её. Резонанс — надстройка для того, кто остался
 * у валуна стоять: обычные клики наполняют разгон до ×2, три клика за 0,9 с
 * открывают на добыче слабую точку, и дальше скорость покупается меткостью —
 * лестница попаданий ×3 → ×4 → ×5.
 *
 * Слабая точка — круг на добыче, вокруг которого сжимается внешнее кольцо.
 * Попадание в круг — good, ступень лестницы; попадание в момент совпадения
 * колец — perfect, та же ступень и дополнительное время полки. Мимо круга —
 * короткое замедление, но ступень остаётся: наказывается только сознательный
 * промах, и наказывается жалом, а не обнулением минуты меткости. Кто просто
 * перестал кликать, не наказан вовсе — множитель тихо дотаивает до ×1:
 * иначе безопасной стратегией была бы неявка.
 *
 * Обязанности поделены так: модуль судит секунды и ступени, а пиксели —
 * дело рендера (`render/tempoRing.ts`). Попал ли клик в круг или мимо,
 * знает тот, кто рисует круг; сюда приходит уже вердикт места (`spot`,
 * `wide`, null), и отсюда уходит вердикт времени (perfect или good).
 */
import type { Rng } from '../core/rng';

/** Кликов, открывающих слабую точку, — и окно, в которое они обязаны лечь. */
export const WARMUP_TAPS = 3;
export const WARMUP_WINDOW = 0.9;

/** Разгон кликами: полступени за клик, потолок ×2 — выше только меткостью. */
export const CHEER_STEP = 0.5;
export const CHEER_MAX = 2;

/** Лестница попаданий: первое ×3, второе ×4, дальше полка ×5. */
export const COMBO_MULS = [3, 4, 5] as const;

/**
 * Полка и спад. Клик или попадание держат множитель `HOLD_SECONDS`, затем
 * он линейно тает к ×1 за `FADE_SECONDS` — «плавно возвращается», а не
 * обрывается: обрыв посреди замаха читался бы поломкой, а не паузой.
 *
 * Полка была 1,2 с и не прошла границу приемлемого результата: новичок
 * с меткостью 60% на плохом сиде получал ×2,2 — промах съедал 0,7 с
 * замедлением, и до следующей точки серия дотаивала. 1,5 с взята не на
 * глаз, а прогоном границы (`tempo.rules.ts`): худший сид новичка
 * поднимается за ×2,5, метроном остаётся под потолком.
 */
export const HOLD_SECONDS = 1.5;
export const FADE_SECONDS = 1.2;

/** Сколько сжимается внешнее кольцо — это же и темп, в котором просят попадать. */
export const APPROACH_SECONDS = 0.8;

/** После совпадения колец точка ещё принимает good: тайминг тут не строгий. */
export const SPOT_GRACE = 0.25;

/** Окно perfect вокруг момента совпадения колец, в обе стороны. */
export const PERFECT_WINDOW = 0.12;

/** Дополнительное время полки за perfect — та самая «награда за идеальный тайминг». */
export const PERFECT_EXTRA = 0.8;

/** Сознательный промах: короткое замедление, ступень остаётся. */
export const MISS_MUL = 0.75;
export const MISS_SECONDS = 0.7;

/** Слабая точка: смещение от центра добычи в долях зоны и момент рождения. */
export interface TempoSpot {
  readonly u: number;
  readonly v: number;
  readonly bornAt: number;
}

/** Резонанс одной серии. Живёт один на игру: серия умирает временем, не сценой. */
export interface Tempo {
  /** Моменты кликов разгона — по ним считается «3 за 0,9 с». */
  taps: number[];
  /** Разгон кликами, ×1..×2. Пока лестница не начата, он и есть пик серии. */
  charge: number;
  /** До какого момента множитель стоит на полке. */
  holdUntil: number;
  /** До какого момента длится замедление за промах. */
  slowUntil: number;
  /** Ступеней лестницы взято. */
  combo: number;
  /** Слабая точка; null — не открыта. */
  spot: TempoSpot | null;
}

export const startTempo = (): Tempo => ({
  taps: [],
  charge: 1,
  holdUntil: -Infinity,
  slowUntil: -Infinity,
  combo: 0,
  spot: null,
});

/** Что случилось на клике — звуку и кадру; скорость спрашивают отдельно. */
export type TempoBeat = 'cheer' | 'ring' | 'good' | 'perfect' | 'miss';

/** Вердикт места от рендера: в круг, мимо круга, по самой добыче. */
export type TempoAim = 'spot' | 'wide' | null;

/** Пик серии: лестница, если ступени взяты, иначе разгон кликами. */
const peak = (t: Tempo): number =>
  t.combo > 0 ? COMBO_MULS[Math.min(t.combo, COMBO_MULS.length) - 1]! : t.charge;

/**
 * Множитель скорости работы сейчас. Замедление за промах — пол, а не
 * ступень: пик под ним цел и возвращается сам, когда штрафные секунды
 * вышли, — ровно это и обещано словами «возврат на предыдущую ступень».
 */
export function tempoBoost(t: Tempo, now: number): number {
  if (now < t.slowUntil) return MISS_MUL;
  const over = now - t.holdUntil;
  if (over <= 0) return peak(t);
  if (over >= FADE_SECONDS) return 1;
  return 1 + (peak(t) - 1) * (1 - over / FADE_SECONDS);
}

/** Серия дотаяла до ×1 — следующий клик начнёт всё заново. */
const expired = (t: Tempo, now: number): boolean =>
  now - t.holdUntil >= FADE_SECONDS && now >= t.slowUntil;

/** Точка в единичном круге. Не у самого края: круг должен целиком лечь в зону. */
const freshSpot = (rng: Rng, now: number): TempoSpot => {
  const r = 0.85 * Math.sqrt(rng());
  const a = rng() * Math.PI * 2;
  return { u: r * Math.cos(a), v: r * Math.sin(a), bornAt: now };
};

/** Сколько живёт одна точка: сжатие кольца и хвост доброго тайминга. */
export const SPOT_SECONDS = APPROACH_SECONDS + SPOT_GRACE;

/**
 * Тик резонанса — раз в кадр. Просроченная точка перескакивает на новое
 * место, пока серия жива: пропуск — не промах, и наказания за него нет,
 * но и ступень без попадания не продлить — полка дотает сама.
 */
export function stepTempo(t: Tempo, now: number, rng: Rng): void {
  if (t.spot === null) return;
  if (expired(t, now)) {
    t.taps.length = 0;
    t.charge = 1;
    t.combo = 0;
    t.spot = null;
    return;
  }
  if (now - t.spot.bornAt > SPOT_SECONDS) t.spot = freshSpot(rng, now);
}

/**
 * Клик по работе. Пока точка не открыта, любой клик — разгон; с открытой
 * точкой место судит рендер (`aim`), а время — здесь: perfect отстоит
 * от совпадения колец не дальше `PERFECT_WINDOW`. Клик по самой добыче
 * (`aim === null`) остаётся разгоном — им серию продлевают без риска.
 */
export function tempoBeat(t: Tempo, now: number, rng: Rng, aim: TempoAim): TempoBeat {
  if (expired(t, now)) {
    t.taps.length = 0;
    t.charge = 1;
    t.combo = 0;
    t.spot = null;
  }

  if (t.spot !== null && aim === 'spot') {
    const offBeat = Math.abs(now - (t.spot.bornAt + APPROACH_SECONDS));
    const perfect = offBeat <= PERFECT_WINDOW;
    t.combo = Math.min(t.combo + 1, COMBO_MULS.length);
    t.holdUntil = now + HOLD_SECONDS + (perfect ? PERFECT_EXTRA : 0);
    t.slowUntil = -Infinity;
    t.spot = freshSpot(rng, now);
    return perfect ? 'perfect' : 'good';
  }

  if (t.spot !== null && aim === 'wide') {
    // Полка промахом не продлевается: замедление кончится, ступень вернётся,
    // но держать ×5 вечно, тыкая мимо, нельзя. Точка при этом перескакивает
    // сразу, не досиживая свой срок: цель убежала — и это жало, но новая
    // попытка даётся немедленно, иначе промах наказывал бы дважды —
    // замедлением и ожиданием. Границу держит прогон: без перескока новичок
    // на плохом сиде проваливался под ×2,5 (`tempo.rules.ts`).
    t.slowUntil = now + MISS_SECONDS;
    t.spot = freshSpot(rng, now);
    return 'miss';
  }

  t.taps.push(now);
  while (t.taps.length > 0 && now - t.taps[0]! > WARMUP_WINDOW) t.taps.shift();
  t.charge = Math.min(CHEER_MAX, t.charge + CHEER_STEP);
  // Кликами продлевается только разгон. Лестницу держат попадания — «каждое
  // попадание обновляет таймер комбо», и ничто другое его не обновляет:
  // иначе ×5 стоял бы вечно на кликах по добыче, без единого попадания.
  if (t.combo === 0) t.holdUntil = Math.max(t.holdUntil, now + HOLD_SECONDS);
  if (t.spot === null && t.taps.length >= WARMUP_TAPS) {
    t.spot = freshSpot(rng, now);
    return 'ring';
  }
  return 'cheer';
}

/** Точка и сжатие кольца (0 — родилось, 1 — совпало) — рендеру. */
export function tempoSpotNow(
  t: Tempo,
  now: number,
): { u: number; v: number; closing: number } | null {
  if (t.spot === null || expired(t, now)) return null;
  return {
    u: t.spot.u,
    v: t.spot.v,
    closing: Math.min(1, (now - t.spot.bornAt) / APPROACH_SECONDS),
  };
}
