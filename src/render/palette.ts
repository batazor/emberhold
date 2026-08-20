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
