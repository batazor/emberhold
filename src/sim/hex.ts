/**
 * Гекс-решётка поля боя (§11.3).
 *
 * **Решётка кладётся поверх той же местности, а не заводит вторую карту.**
 * Мир квадратный — путь, обзор и «путь назад» считаются по клеткам, — и второй
 * топологии он не переживёт: две сетки означают два поиска пути, две функции
 * расстояния и стену, которая в одном режиме есть, а в другом нет. Поэтому
 * гекс здесь — это способ разбить ту же плоскость: центр гекса лежит в мировых
 * координатах, а проходимость читается из `blocked` по клетке, в которую он
 * попал. Стена остаётся одной и той же стеной в обоих режимах.
 *
 * Зачем вообще гекс, если мир квадратный: у шестиугольника все шесть соседей
 * равноудалены, и «дотянулся или нет» перестаёт зависеть от того, стоит ли
 * противник по диагонали. В бою, где ход стоит хода, это разница между
 * правилом и спором.
 *
 * Координаты осевые (q, r): третья ось выводится как `-q - r`, и хранить её
 * незачем. Гексы плоской стороной вверх.
 */
import { idx, inBounds } from './grid';

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/**
 * Радиус описанной окружности гекса. Выбран так, чтобы **центры соседей
 * отстояли ровно на единицу** — на тот же шаг, что клетка мира. Тогда
 * скорость героя (§17.4) переносится в бой без пересчёта, а «две клетки»
 * и «два гекса» значат одно и то же расстояние.
 */
export const HEX_R = 1 / Math.sqrt(3);

/** Шесть соседей. Порядок закреплён: от него зависит воспроизводимость
 *  выбора цели ботом, а шаг вылазки обязан быть детерминированным. */
export const HEX_DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hexEq = (a: Hex, b: Hex): boolean => a.q === b.q && a.r === b.r;
export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

/**
 * Расстояние в шагах по решётке. В осевых координатах это половина суммы
 * модулей по трём осям — и в отличие от квадратной сетки здесь нет вопроса,
 * считать ли диагональ за один шаг или за полтора: диагоналей нет.
 */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export const hexNeighbors = (h: Hex): Hex[] =>
  HEX_DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

/** Центр гекса в мировых координатах. */
export function hexToWorld(h: Hex): { x: number; z: number } {
  return {
    x: HEX_R * 1.5 * h.q,
    z: HEX_R * Math.sqrt(3) * (h.r + h.q / 2),
  };
}

/** Гекс, в который попадает точка мира. Округление идёт по трём осям сразу:
 *  наивное округление двух даёт дыры на стыках. */
export function worldToHex(x: number, z: number): Hex {
  const q = (2 / 3) * (x / HEX_R);
  const r = z / (HEX_R * Math.sqrt(3)) - q / 2;
  return hexRound(q, r);
}

/** Округление дробных осевых координат. Ось с наибольшей поправкой выводится
 *  из двух других — иначе сумма трёх осей перестаёт быть нулём, и соседство
 *  ломается на длинных расстояниях. */
export function hexRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/**
 * Проходим ли гекс. Читается из сетки мира: центр гекса попадает в клетку,
 * и занятая клетка занимает гекс. Гекс за краем карты непроходим — поле боя
 * не может выйти за локацию.
 */
export function hexOpen(size: number, blocked: Uint8Array, h: Hex): boolean {
  const { x, z } = hexToWorld(h);
  const cx = Math.round(x);
  const cz = Math.round(z);
  if (!inBounds(size, cx, cz)) return false;
  return blocked[idx(size, cx, cz)] === 0;
}

/**
 * Куда можно дойти за `steps` шагов, обходя занятое. Волновой обход, как
 * `distanceField` у мира: ответ на вопрос «докуда достану» обязан считаться
 * одинаково в обоих режимах, иначе ход в бою и шаг вне боя расходятся.
 *
 * Возвращает карту «гекс → шагов», включая исходный (ноль шагов).
 */
export function hexReach(
  size: number,
  blocked: Uint8Array,
  from: Hex,
  steps: number,
  occupied: ReadonlySet<string> = new Set(),
): Map<string, { hex: Hex; steps: number }> {
  const seen = new Map<string, { hex: Hex; steps: number }>();
  seen.set(hexKey(from), { hex: from, steps: 0 });
  if (steps <= 0) return seen;

  let frontier: Hex[] = [from];
  for (let d = 1; d <= steps; d++) {
    const next: Hex[] = [];
    for (const cur of frontier) {
      for (const n of hexNeighbors(cur)) {
        const key = hexKey(n);
        if (seen.has(key)) continue;
        if (!hexOpen(size, blocked, n)) continue;
        // Занятый гекс не проходим насквозь: тело противника — препятствие,
        // и обойти его должно стоить шагов, иначе строй ничего не значит.
        if (occupied.has(key)) continue;
        seen.set(key, { hex: n, steps: d });
        next.push(n);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * Гексы, которые задевает отрезок между центрами. Нужен линии видимости
 * в бою: она обязана считаться по той же решётке, по которой ходят, —
 * иначе выстрел проходит там, где ход не проходит.
 */
export function hexLine(a: Hex, b: Hex): Hex[] {
  const n = hexDistance(a, b);
  if (n === 0) return [a];
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Смещение на epsilon уводит точку с границы между гексами: ровно на ней
    // округление выбирает сторону произвольно, и линия становится
    // несимметричной — тем же способом, каким это чинилось у мира.
    out.push(hexRound(
      a.q + (b.q - a.q) * t + 1e-6,
      a.r + (b.r - a.r) * t + 2e-6,
    ));
  }
  return out;
}

/** Видно ли из `a` в `b`: ни один гекс между ними не занят. Свой и целевой
 *  не проверяются — стрелок стоит там, где стоит, а цель себе не укрытие. */
export function hexSight(size: number, blocked: Uint8Array, a: Hex, b: Hex): boolean {
  const line = hexLine(a, b);
  for (let i = 1; i < line.length - 1; i++) {
    if (!hexOpen(size, blocked, line[i]!)) return false;
  }
  return true;
}
