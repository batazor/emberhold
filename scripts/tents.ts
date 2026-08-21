/**
 * Замер палаток (`sim/residents.ts`): сколько жильцов вмещает площадка
 * на каждом уровне Жилья.
 *
 * Вопрос, ради которого скрипт заведён, поставил сам §20.4: планировка там
 * объявлена выразительной, а не механической, и возврат к вопросу отложен
 * до дня, когда зданий станет больше десяти. Палатка на жителя к этому дню
 * ведёт, и знать, где площадь начнёт вправду запирать, надо раньше, чем это
 * случится с игроком.
 *
 * Этот замер уже отменил одно решение. При следе 2×2 — том же, что у зданий,
 * — на Жилье ур. 1 влезала одна палатка, а на ур. 2 **ни одной**: четыре
 * здания стоят по клеткам 1–2 и 4–5, и двух соседних свободных столбцов
 * на 7×7 не остаётся. Рост лагеря отнимал место, и задание упиралось
 * в тупик. След уменьшен до 1×1 не ради вместимости, а ради этого.
 *
 * Запуск: npm run tents
 */
import { BUILDING_ORDER, campArea, createCamp } from '../src/sim/camp';
import { TENT_FOOT, admit, buildTent } from '../src/sim/residents';

const rows: { hq: number; area: number; built: number; tents: number; dens: number }[] = [];

for (let hq = 1; hq <= 5; hq++) {
  const camp = createCamp();
  camp.levels.hq = hq;
  // Мастерская существует с Жилья ур. 2 (§7): считать её на первом значило бы
  // мерить лагерь, которого не бывает.
  if (hq >= 2) camp.levels.forge = 1;
  camp.resources.wood = 99999;
  let tents = 0;
  for (let n = 0; n < 200; n++) {
    admit(camp, { name: `Гость ${n}`, look: 'поселенец', answer: 'строим' });
    if (buildTent(camp) === null) break;
    tents++;
  }
  const area = campArea(hq);
  const built = BUILDING_ORDER.filter((id) => camp.levels[id] > 0).length;
  // Плотность считается по клеткам, а не по постройкам: у здания след 2×2,
  // у палатки 1×1, и складывать их штуками значило бы врать о занятости.
  const cells = built * 4 + tents * TENT_FOOT * TENT_FOOT;
  rows.push({ hq, area, built, tents, dens: cells / (area * area) });
}

console.log('Жильё  площадь   зданий  палаток  занято клеток');
for (const r of rows) {
  console.log(
    `  ${r.hq}      ${`${r.area}×${r.area}`.padEnd(7)} ${String(r.built).padStart(4)} ` +
      `${String(r.tents).padStart(8)}  ${(r.dens * 100).toFixed(0).padStart(9)}%`,
  );
}

const worst = rows.reduce((a, b) => (a.tents <= b.tents ? a : b));
console.log(
  `\nхудший уровень: Жильё ${worst.hq} — ${worst.tents} палаток. ` +
    (worst.tents === 0
      ? 'НОЛЬ: задание «поставить палатку» на этом уровне упирается в тупик.'
      : 'Тупика нет ни на одном уровне.'),
);

const dips = rows.filter((r, i) => i > 0 && r.tents < rows[i - 1]!.tents);
console.log(
  dips.length === 0
    ? 'Вместимость не падает с ростом Жилья.'
    : `⚠ ПАДАЕТ С РОСТОМ: ${dips.map((r) => `ур. ${r.hq}`).join(', ')} — лагерь растёт, а мест меньше.`,
);
