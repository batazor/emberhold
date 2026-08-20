/**
 * Замерный стенд (?bench=1). Кадры гонятся синхронно, без
 * requestAnimationFrame, по двум причинам: fps упирается в частоту экрана
 * и прячет запас, а миллисекунды на кадр — нет; и скрытая вкладка кадров
 * вообще не рисует, поэтому замер из панели предпросмотра иначе меряет
 * замерший кадр.
 *
 * Это отладочный орган, как ?tier и ползунок «Ночь», — не механика. Живёт
 * отдельной фичой: в игре он не участвует, а в main занимал больше места,
 * чем сам кадровый цикл.
 */
import type { SceneRig } from '../../render/scene';

/**
 * Что стенду нужно от игры. Кадр рисует main — он один знает про режимы;
 * стенд знает про пиксели и секундомер и ничего про то, что на экране.
 */
export interface BenchHooks {
  readonly rig: SceneRig;
  /** Нарисовать один кадр текущего режима — синхронно, здесь и сейчас. */
  readonly draw: () => void;
  /** Сводка сцены для отладчика. */
  readonly state: () => unknown;
  /** Плотность травы: по ней и идёт замер. */
  readonly setGrass: (perTile: number) => void;
  /** Сколько травинок сейчас в сцене. */
  readonly blades: () => number;
}

/** Вешает `window.bench`. Вызывать только под ?bench=1. */
export function installBench(hooks: BenchHooks): void {
  const { rig, draw } = hooks;
  const gl = rig.renderer.getContext();

  (window as unknown as Record<string, unknown>)['bench'] = {
    /** Нарисовать один кадр: скриншот скрытой вкладки иначе показывает старый. */
    frame: draw,
    rig,
    state: hooks.state,
    /**
     * Яркость кадра сеткой cols×rows, 0–255. Скрытая вкладка не отдаёт
     * скриншот, а буфер отдаёт: «темно» становится числом.
     */
    luma(cols = 24, rows = 14): number[][] {
      draw();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const line: number[] = [];
        for (let c = 0; c < cols; c++) {
          let sum = 0;
          let n = 0;
          const x0 = Math.floor((c * w) / cols);
          const x1 = Math.floor(((c + 1) * w) / cols);
          // Строки буфера идут снизу вверх — переворачиваем, чтобы сетка
          // читалась так же, как экран.
          const y0 = Math.floor(((rows - 1 - r) * h) / rows);
          const y1 = Math.floor(((rows - r) * h) / rows);
          for (let y = y0; y < y1; y += 4) {
            for (let x = x0; x < x1; x += 4) {
              const i = (y * w + x) * 4;
              sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
              n++;
            }
          }
          line.push(n === 0 ? 0 : Math.round(sum / n));
        }
        out.push(line);
      }
      return out;
    },
    night(value: number): void {
      rig.night = value;
      draw();
    },
    /** Средние миллисекунды на кадр при данной плотности травы. */
    run(perTile: number, frames = 120): unknown {
      hooks.setGrass(perTile);
      // Барьер — чтение пикселя, а не gl.finish: finish в браузере не ждёт
      // конца кадра, и замер вырождается во время выдачи команд.
      const sync = new Uint8Array(4);
      const wait = (): void => {
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
      };
      for (let i = 0; i < 20; i++) draw(); // прогрев: шейдер компилируется один раз
      wait();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        draw();
        wait();
      }
      const ms = (performance.now() - t0) / frames;
      return {
        perTile,
        blades: hooks.blades(),
        ms: Number(ms.toFixed(3)),
        draw: rig.drawCalls,
      };
    },
  };
}
