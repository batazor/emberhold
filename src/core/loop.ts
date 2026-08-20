/**
 * Фиксированный таймстеп симуляции, отделённый от отрисовки (DESIGN §6).
 * Симуляция всегда идёт шагами TICK, рендер получает alpha для интерполяции
 * между прошлым и текущим состоянием — иначе движение дрожит на 120-герцовых
 * экранах, где кадров больше, чем тиков.
 */
export const TICK = 1 / 60;
const MAX_FRAME = 0.25; // после сворачивания вкладки не догоняем час симуляции

export interface LoopHandlers {
  update(dt: number): void;
  render(alpha: number): void;
}

export function startLoop({ update, render }: LoopHandlers): () => void {
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    acc += Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    while (acc >= TICK) {
      update(TICK);
      acc -= TICK;
    }
    render(acc / TICK);
  };

  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
