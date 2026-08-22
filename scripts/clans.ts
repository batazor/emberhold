/**
 * Замер активности кланов на общей карте (§4).
 *
 * DESIGN обещает: кланы «имеют лагеря, занимают локации, растут», а игрок
 * «понимает, что это фракции». Прибор меряет, что из этого карта показывает
 * на самом деле:
 *
 *  - **невидимость** — доля смен, когда клан сидит на прогулочной точке
 *    (замок/кладбище): флаг там не рисуется, и клан пропадает с карты;
 *  - **коллизии** — доля смен, когда два клана заняли одну точку: второй
 *    флаг молча не рисуется;
 *  - **телепорт** — средний прыжок клана между соседними сменами в долях
 *    экрана и доля прыжков через половину карты;
 *  - **оседлость** — как долго клан держит одну точку подряд;
 *  - **ярусы** — гистограмма занятых ярусов по кланам: различимы ли
 *    характеры на карте или все четыре ведут себя одинаково;
 *  - **игрок** — худшее по суткам число богатых (≥2) вылазок при кланах,
 *    но без заходов игрока: сколько выбора остаётся от одних кланов.
 *
 * Запуск: npm run clans
 */
import {
  CLANS,
  KIND,
  SHIFTS_PER_DAY,
  SHIFT_SEC,
  WORLD_EPOCH,
  clanState,
  dayAt,
  dayStartShift,
  regionAt,
  worldAt,
} from '../src/sim/world';

const DAYS = 60;
const DAY0 = dayAt(WORLD_EPOCH) + 3;

let shifts = 0;
let invisible = 0;
let collisions = 0;
let jumps = 0;
let jumpSum = 0;
let farJumps = 0;
const stayLengths: number[] = [];
const tierHist: number[][] = CLANS.map(() => [0, 0, 0, 0]);
const levelAt = (t: number): number[] => CLANS.map((_, k) => clanState(k, t).level);

for (let day = DAY0; day < DAY0 + DAYS; day++) {
  const region = regionAt(day);
  const prev: (number | null)[] = CLANS.map(() => null);
  const stay: number[] = CLANS.map(() => 0);
  for (let s = 0; s < SHIFTS_PER_DAY; s++) {
    const t = (dayStartShift(day) + s) * SHIFT_SEC;
    const seen = new Map<number, number>();
    for (let k = 0; k < CLANS.length; k++) {
      const node = clanState(k, t).nodes[0];
      if (node === undefined) continue;
      shifts++;
      const spot = region.nodes[node];
      if (spot === undefined) continue;
      if (KIND[spot.kind].walk) invisible++;
      else tierHist[k]![spot.tier]++;
      seen.set(node, (seen.get(node) ?? 0) + 1);
      const was = prev[k];
      if (was !== null) {
        if (was === node) stay[k]!++;
        else {
          stayLengths.push(stay[k]! + 1);
          stay[k] = 0;
          const from = region.nodes[was];
          if (from !== undefined) {
            jumps++;
            const d = Math.hypot(spot.x - from.x, spot.y - from.y);
            jumpSum += d;
            if (d > 0.5) farJumps++;
          }
        }
      }
      prev[k] = node;
    }
    for (const n of seen.values()) if (n > 1) collisions += n - 1;
  }
  for (const k of stay) stayLengths.push(k + 1);
}

/* Выбор игрока от одних кланов: worldAt без заходов. */
let worstRich = Infinity;
for (let day = DAY0; day < DAY0 + DAYS; day++) {
  const region = regionAt(day);
  for (let s = 0; s < SHIFTS_PER_DAY; s++) {
    const t = (dayStartShift(day) + s) * SHIFT_SEC;
    const world = worldAt(t);
    const rich = region.nodes.filter(
      (n) => KIND[n.kind].raidable && world[n.id]!.rich >= 2,
    ).length;
    if (rich < worstRich) worstRich = rich;
  }
}

const pct = (n: number, of: number): string => `${((n / of) * 100).toFixed(1)}%`;
const avgStay = stayLengths.reduce((a, b) => a + b, 0) / Math.max(1, stayLengths.length);

console.log(`Кланы на карте: ${DAYS} дней × ${SHIFTS_PER_DAY} смен, кланов ${CLANS.length}`);
console.log(`  невидимость (прогулочная точка): ${pct(invisible, shifts)} смен`);
console.log(`  коллизии (двое на одной точке):  ${pct(collisions, shifts)} смен`);
console.log(`  переезды: средний прыжок ${(jumpSum / Math.max(1, jumps)).toFixed(2)} экрана, ` +
  `дальше полуэкрана — ${pct(farJumps, Math.max(1, jumps))}`);
console.log(`  оседлость: в среднем ${avgStay.toFixed(2)} смены на точке подряд`);
console.log(`  худший момент: богатых (≥2) вылазок ${worstRich} — без заходов игрока`);
console.log('  ярусы по кланам (0/1/2/3):');
for (let k = 0; k < CLANS.length; k++) {
  const total = tierHist[k]!.reduce((a, b) => a + b, 0);
  const row = tierHist[k]!.map((n) => pct(n, Math.max(1, total)).padStart(6)).join(' ');
  console.log(`    ${CLANS[k]!.name.padEnd(16)} ${row}`);
}
console.log('  уровни кланов: день 3 →', levelAt((dayStartShift(DAY0) + 9) * SHIFT_SEC).join('/'),
  `— день ${DAYS} →`, levelAt((dayStartShift(DAY0 + DAYS - 1) + 9) * SHIFT_SEC).join('/'));
