/**
 * Время таймеров (DESIGN §6): по серверному при наличии сети, иначе локальное
 * с фиксацией дельты. Защита от перевода часов — монотонный счётчик: время
 * никогда не идёт назад, сколько бы игрок ни крутил системные часы.
 *
 * Сервера в v0 нет, поэтому здесь только локальная половина — но интерфейс
 * уже такой, чтобы серверная синхронизация подставлялась без правок вызовов.
 */
export class Clock {
  private lastSeen: number;
  /** Сдвиг, накопленный переводом часов назад. Только растёт. */
  private offset = 0;

  constructor(lastSeen = 0) {
    this.lastSeen = lastSeen;
  }

  /** Секунды эпохи, монотонно неубывающие. */
  now(): number {
    const raw = Date.now() / 1000 + this.offset;
    if (raw < this.lastSeen) {
      // Часы уехали назад — компенсируем, а не доверяем им.
      this.offset += this.lastSeen - raw;
      return this.lastSeen;
    }
    this.lastSeen = raw;
    return raw;
  }

  get watermark(): number {
    return this.lastSeen;
  }
}

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest > 0 ? `${m} мин ${rest} с` : `${m} мин`;
  }
  return `${s} с`;
};
