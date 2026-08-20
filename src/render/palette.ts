/**
 * DESIGN §6.1: единая палитра обязательна, но применяется к материалам,
 * а не ремапом картинок на сборке. Один список на игру.
 */
export const PALETTE = {
  night: 0x080b12,
  day: 0xa8bcc4,
  moon: 0x9fb6d8,
  sun: 0xffe7bd,
  torch: 0xffb166,
  groundHue: 0.12,
  grassBase: 0x2c3a1c,
  grassTip: 0x8fb45f,
  rock: 0x6a6355,
  heroBody: 0xdcd2b0,
  heroCloak: 0x8a3f2e,
  scavenger: 0x6b5340,
  spearman: 0x4b3852,
  golem: 0x55504a,
  telegraph: 0xd4543a,
  loot: 0xdba845,
  evac: 0x8fd6c0,
  backdrop: 0x141410,
} as const;

/**
 * Слоты готовых моделей (§6.1). Набор KayKit Forest раскрашен своим атласом;
 * `scripts/models.ts` при запекании меняет картинку на индекс, а цвет индексу
 * назначается здесь. Поэтому чужой набор перекрашивается правкой одной строки,
 * а палитра остаётся одним списком — не двумя.
 *
 * Порядок обязан совпадать с FOREST_SLOTS из forest.data.ts; проверяет forest.ts.
 * Цвета — из палитры артбука (artbook.html), группы «Растительность»,
 * «Земля и дерево», «Камень и соль».
 */
export const FOREST_PALETTE: readonly number[] = [
  0x1f2b1a, // хвоя-тень
  0x31432a, // хвоя
  0x465c39, // мох
  0x5d7a49, // трава
  0x3f2c1d, // земля
  0x543922, // дерево-тень
  0x6f4d2c, // дерево
  0x8f6a3f, // дерево-свет
  0x3f3d34, // камень
  0x57544a, // камень-свет
  0x6f6c60, // скол
  0x8a8a7e, // соль-тень
];
