/**
 * Отрисовка местности под картой региона (§4.2). Геометрию считает
 * `sim/terrain.ts`, здесь — только цвет и штрих.
 *
 * Палитра — из тех же 34 цветов артбука, что красят модели (`render/palette.ts`,
 * §6.1). Значения переписаны сюда, а не импортированы, по границе слоёв:
 * `ui` не знает про `render` (`npm run arch`), и тащить туда полтораста
 * килобайт геометрии ради пяти чисел незачем. Имя слота стоит рядом
 * с каждым — расходиться им негде.
 *
 * Правило цвета одно и оно сильнее вкуса: **фон темнее любого цвета узла.**
 * Цвет на карте занят богатством (`RICH_COLOR`), и земля, дотянувшаяся
 * до его яркости, начала бы спорить с точкой за взгляд. Проверяется замером
 * (`mapTerrain.rules.ts`), а не глазами.
 */
import { bandOf, terrainAt } from '../sim/terrain';
import type { Mark, Point, Terrain } from '../sim/terrain';

/**
 * Ступени высоты снизу вверх: мокрая низина, тень хвои, хвоя, тень камня,
 * камень. Названия — слоты палитры §6.1, в скобках их значения.
 */
export const LAND: readonly string[] = [
  '#2b3138', // металл-тень — мокрая низина, единственная синева в земле
  '#1f2b1a', // хвоя-тень
  '#31432a', // хвоя
  '#2b2a24', // камень-тень
  '#3f3d34', // камень
];

/** Вода. Тот же серо-синий, что у металла: холоднее земли, тише узла. */
export const WATER = '#474f58';

/** Берег: тень набережной. Второй по темноте цвет палитры — тень. Мрак
 *  на его месте читался как прорезь в карте, а не как берег. */
export const BANK = '#1a1813';

/** Цвет знака по его роду. Все три — из палитры и все темнее любого узла. */
export const MARK_COLOR: Record<Mark['kind'], string> = {
  холм: '#57544a', // камень-свет
  ель: '#465c39', // мох
  болото: '#474f58', // металл
};

/**
 * Готовая картинка местности. Карта перерисовывается каждый кадр (карточка
 * ведёт живой отсчёт восстановления), а земля меняется раз в сутки — считать
 * двести граней по шестьдесят раз в секунду незачем.
 */
let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

/** Ключ кэша: день, размер и раскладка занятых точек. */
const keyOf = (day: number, spots: readonly Point[], w: number, h: number, dpr: number): string => {
  let sig = 0;
  for (const s of spots) sig = (sig * 31 + Math.round(s.x * 997) * 13 + Math.round(s.y * 997)) | 0;
  return `${day}|${spots.length}|${sig}|${Math.round(w)}×${Math.round(h)}@${dpr}`;
};

/**
 * Нарисовать землю под картой. Зовётся первой в `draw()` карты — и тем же
 * кодом рисует артбук `world.html`: копия местности разошлась бы с игрой
 * молча, как однажды уже случилось с глифом события.
 */
export function drawMapTerrain(
  ctx: CanvasRenderingContext2D,
  day: number,
  spots: readonly Point[],
  w: number,
  h: number,
  dpr: number,
): void {
  if (w <= 0 || h <= 0) return;
  const key = keyOf(day, spots, w, h, dpr);
  if (cache === null || cache.key !== key) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w * dpr));
    off.height = Math.max(1, Math.round(h * dpr));
    const c = off.getContext('2d');
    if (c === null) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(c, terrainAt(day, spots), w, h);
    cache = { key, canvas: off };
  }
  ctx.drawImage(cache.canvas, 0, 0, w, h);
}

function paint(ctx: CanvasRenderingContext2D, land: Terrain, w: number, h: number): void {
  ctx.fillStyle = LAND[1]!;
  ctx.fillRect(0, 0, w, h);

  /* ---------- грани ---------- */

  // Плоское затенение, как и всё в игре (§6.1): у грани один цвет и прямые
  // рёбра. Обводка тем же цветом закрывает волосяной шов между треугольниками —
  // без неё сетка светится изнанкой на дробном devicePixelRatio.
  const v = (i: number, j: number): Point => land.grid[j * (land.cols + 1) + i]!;
  const H = (i: number, j: number): number => land.grid[j * (land.cols + 1) + i]!.h;
  for (let j = 0; j < land.rows; j++) {
    for (let i = 0; i < land.cols; i++) {
      const quad: readonly (readonly [Point, Point, Point])[] = [
        [v(i, j), v(i + 1, j), v(i + 1, j + 1)],
        [v(i, j), v(i + 1, j + 1), v(i, j + 1)],
      ];
      const hs: readonly number[][] = [
        [H(i, j), H(i + 1, j), H(i + 1, j + 1)],
        [H(i, j), H(i + 1, j + 1), H(i, j + 1)],
      ];
      for (let t = 0; t < 2; t++) {
        const tri = quad[t]!;
        const mid = (hs[t]![0]! + hs[t]![1]! + hs[t]![2]!) / 3;
        const color = LAND[bandOf(mid)] ?? LAND[1]!;
        ctx.beginPath();
        ctx.moveTo(tri[0].x * w, tri[0].y * h);
        ctx.lineTo(tri[1].x * w, tri[1].y * h);
        ctx.lineTo(tri[2].x * w, tri[2].y * h);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /* ---------- реки ---------- */

  // Русло к устью шире: это единственное на карте, что говорит «вниз»,
  // и стоит оно ноль каналов — направление реки ничего не решает.
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const river of land.rivers) {
    // Двумя проходами: сперва тёмный берег, потом вода. Одной линией русло
    // терялось — вода обязана быть темнее любого узла (см. заголовок файла),
    // а на светлой полосе камня такая линия почти не видна. Берег даёт руслу
    // контраст, не поднимая яркости.
    for (const [color, extra] of [[BANK, 1.1] as const, [WATER, 0] as const]) {
      ctx.strokeStyle = color;
      for (let i = 1; i < river.length; i++) {
        const a = river[i - 1]!;
        const b = river[i]!;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.lineWidth = 1 + (i / river.length) * 1.2 + extra;
        ctx.stroke();
      }
    }
  }

  /* ---------- знаки ---------- */

  ctx.lineWidth = 1;
  for (const mark of land.marks) {
    const x = mark.x * w;
    const y = mark.y * h;
    const s = mark.size * w;
    ctx.strokeStyle = MARK_COLOR[mark.kind];
    ctx.beginPath();
    if (mark.kind === 'холм') {
      // Две гряды уступом: одна читалась бы птичкой из интерфейса.
      ctx.moveTo(x - s, y + s * 0.45);
      ctx.lineTo(x - s * 0.35, y - s * 0.45);
      ctx.lineTo(x + s * 0.3, y + s * 0.45);
      ctx.moveTo(x + s * 0.1, y + s * 0.45);
      ctx.lineTo(x + s * 0.55, y - s * 0.1);
      ctx.lineTo(x + s, y + s * 0.45);
    } else if (mark.kind === 'ель') {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.6, y + s * 0.5);
      ctx.lineTo(x - s * 0.6, y + s * 0.5);
      ctx.closePath();
      ctx.moveTo(x, y + s * 0.5);
      ctx.lineTo(x, y + s * 0.95);
    } else {
      // Болото — две черты уступом: обычный значок мокрой земли на любой
      // карте. Пучок камыша, стоявший здесь до него, на десяти пикселях
      // читался стрелкой вниз, а стрелка на карте обещает направление,
      // которого фон не знает. Три черты с общим низом, стоявшие до пучка,
      // складывались в чашу — а чаша занята глифом «тихая ночь»
      // (`GLYPH.quiet` в `worldMap.ts`).
      ctx.moveTo(x - s * 0.75, y - s * 0.3);
      ctx.lineTo(x + s * 0.15, y - s * 0.3);
      ctx.moveTo(x - s * 0.15, y + s * 0.3);
      ctx.lineTo(x + s * 0.75, y + s * 0.3);
    }
    ctx.stroke();
  }
}
