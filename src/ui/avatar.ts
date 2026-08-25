/**
 * Двумерные лица для веера: рыцарь, лучник, бандит, поселенец, торговец.
 *
 * **Почему рисуются кодом, а не лежат картинками.** Людей в лагере столько,
 * сколько их пришло, и заранее нарисованный набор портретов означал бы либо
 * пять лиц на сорок человек, либо сорок файлов под прототип, который ещё
 * не решён. Лицо выводится из вида и сида — как сам поселенец (`settler.ts`)
 * и как жильцы замка: тот же человек в том же лагере всегда с тем же лицом.
 * Готовые наборы (game-icons, DiceBear) смотрелись и были отвергнуты по той же
 * причине: чужая палитра и чужой набор лиц против сорока своих людей.
 *
 * **Цвета — те же 34 из артбука** (`render/palette.ts`, §6.1). Своей палитры
 * у портрета нет и быть не может: аватар стоит поверх лагеря, и второй набор
 * цветов рядом с первым читался бы чужой игрой.
 *
 * Лицо — не портрет, а **силуэт**: на сорока четырёх пикселях различается
 * шлем, капюшон, повязка и шляпа, а черты — нет. Вид узнаётся головным
 * убором и цветом сукна. А вот **человек внутри вида** узнаётся приметами:
 * бровями, бородой, усами, ртом — тем, что сид раздаёт из тех же цветов.
 * Без примет тридцать поселенцев были бы тремя оттенками сукна.
 */
import { MATERIAL } from '../core/palette';
import { mulberry32 } from '../core/rng';

/** Кого рисуем. Классы героев (§11.7) и виды жильцов (`garrison.ts`). */
export type AvatarLook =
  | 'knight' | 'archer' | 'rogue'
  | 'поселенец' | 'поселенка' | 'торговец' | 'кузнец' | 'охотник' | 'лесник';

export const AVATAR_LOOKS: readonly AvatarLook[] = [
  'knight',
  'archer',
  'rogue',
  'поселенец',
  'поселенка',
  'торговец',
  'кузнец',
  'охотник',
  'лесник',
];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

const C = {
  тень: hex(MATERIAL['тень']),
  мрак: hex(MATERIAL['мрак']),
  сталь: hex(MATERIAL['сталь']),
  металл: hex(MATERIAL['металл']),
  'металл-тень': hex(MATERIAL['металл-тень']),
  кожа: hex(MATERIAL['кожа']),
  'дерево-тень': hex(MATERIAL['дерево-тень']),
  дерево: hex(MATERIAL['дерево']),
  'дерево-свет': hex(MATERIAL['дерево-свет']),
  солома: hex(MATERIAL['солома']),
  'сукно-тень': hex(MATERIAL['сукно-тень']),
  сукно: hex(MATERIAL['сукно']),
  'сукно-свет': hex(MATERIAL['сукно-свет']),
  хвоя: hex(MATERIAL['хвоя']),
  мох: hex(MATERIAL['мох']),
  трава: hex(MATERIAL['трава']),
  латунь: hex(MATERIAL['латунь']),
  'краска-алая': hex(MATERIAL['краска-алая']),
  жар: hex(MATERIAL['жар']),
  'соль-тень': hex(MATERIAL['соль-тень']),
} as const;

/** Оттенки кожи: три ступени одного слота артбука, а не три новых цвета. */
const SKIN = [C.кожа, C.солома, C['дерево-свет']];

/** Сукно, которым красится плечо. Разное у разных людей — иначе все на одно лицо. */
const CLOTH = [C.сукно, C['сукно-тень'], C['сукно-свет'], C.мох, C.хвоя, C['дерево-тень']];

/** Волосы и борода: четыре земляных тона из тех же 34 — от смоли до соломы. */
const HAIR = [C.мрак, C['дерево-тень'], C.дерево, C.солома];

/** Фон кружка: у героя тёплый, у жильца холодный — ряды различаются до лица. */
const BACK: Record<AvatarLook, string> = {
  knight: C['металл-тень'],
  archer: C['металл-тень'],
  rogue: C['металл-тень'],
  поселенец: C.тень,
  поселенка: C.тень,
  торговец: C.тень,
  кузнец: C.тень,
  охотник: C.тень,
  лесник: C.тень,
};

/**
 * Устойчивая соль вида. Длина строки здесь не подходит: `archer`, `кузнец`
 * и `лесник` состоят из шести символов и раньше при одном сиде получали
 * один и тот же набор лица. Явная таблица заодно не меняется от рефакторинга
 * названий и позволяет сохранить лицо между перерисовками и релизами.
 */
const LOOK_SALT: Record<AvatarLook, number> = {
  knight: 0x0b,
  archer: 0x1d,
  rogue: 0x2f,
  поселенец: 0x43,
  поселенка: 0x59,
  торговец: 0x6d,
  кузнец: 0x83,
  охотник: 0x97,
  лесник: 0xad,
};

type TraitKind = 0 | 1 | 2;

/** Жребии, из которых собирается лицо. Удобны галерее и тестам генератора. */
export interface AvatarTraits {
  readonly skin: string;
  readonly cloth: string;
  readonly hair: string;
  readonly brows: TraitKind;
  readonly beard: TraitKind;
  readonly mouth: TraitKind;
  readonly face: TraitKind;
  readonly eyes: TraitKind;
  readonly nose: TraitKind;
  readonly accent: TraitKind;
}

const pickKind = (rng: () => number): TraitKind => Math.floor(rng() * 3) as TraitKind;

/**
 * Выводит внешность отдельно от разметки. Порядок бросков — часть формата:
 * добавлять новые следует в хвост, чтобы уже живущие в сейвах люди не менялись.
 */
export function avatarTraits(look: AvatarLook, seed = 0): AvatarTraits {
  const rng = mulberry32(seed * 7 + LOOK_SALT[look]);
  const skin = SKIN[Math.floor(rng() * SKIN.length)]!;
  const cloth = CLOTH[Math.floor(rng() * CLOTH.length)]!;
  const hairYoung = HAIR[Math.floor(rng() * HAIR.length)]!;
  const brows = pickKind(rng);
  const beard = pickKind(rng);
  const mouth = pickKind(rng);
  const accent = pickKind(rng);
  const hair = rng() < 0.15 ? C['соль-тень'] : hairYoung;

  return {
    skin,
    cloth,
    hair,
    brows,
    beard,
    mouth,
    accent,
    face: pickKind(rng),
    eyes: pickKind(rng),
    nose: pickKind(rng),
  };
}

/** Брови: нет, ровные или сдвинутые. Цвет — волос, как у живых людей. */
const brows = (kind: number, hair: string): string => {
  if (kind === 0) return '';
  if (kind === 1) {
    return (
      `<rect x="15.5" y="18.6" width="4" height="1.6" rx="0.8" fill="${hair}"/>` +
      `<rect x="24.5" y="18.6" width="4" height="1.6" rx="0.8" fill="${hair}"/>`
    );
  }
  // Сдвинутые: клином к переносице — хмурый.
  return (
    `<path d="M15 20.4l4.6-1.6v1.8L15 21.6z" fill="${hair}"/>` +
    `<path d="M29 20.4l-4.6-1.6v1.8l4.6 1z" fill="${hair}"/>`
  );
};

/** Рот: нет, черта или улыбка. Борода лопатой рот съедает — тогда его не рисуют. */
const mouth = (kind: number): string => {
  if (kind === 0) return '';
  if (kind === 1) return `<rect x="19.7" y="28.6" width="4.6" height="1.4" rx="0.7" fill="${C.мрак}"/>`;
  return `<path d="M19 28q3 2.4 6 0" stroke="${C.мрак}" stroke-width="1.4" fill="none"/>`;
};

/** Растительность: чисто, усы или борода лопатой. */
const beard = (kind: number, hair: string): string => {
  if (kind === 0) return '';
  if (kind === 1) return `<rect x="17.5" y="26.2" width="9" height="2.4" rx="1.2" fill="${hair}"/>`;
  return (
    `<path d="M12 24v3c0 5 4.5 8 10 8s10-3 10-8v-3c-2 3-5.5 4.5-10 4.5S14 27 12 24z" fill="${hair}"/>` +
    `<rect x="17.5" y="25.4" width="9" height="2.2" rx="1.1" fill="${hair}"/>`
  );
};

/** Нос: точка света, короткая тень или угловатый профиль. */
const nose = (kind: TraitKind): string => {
  if (kind === 0) return `<circle cx="22" cy="25.8" r="0.9" fill="${C['дерево-свет']}"/>`;
  if (kind === 1) return `<rect x="21.3" y="24" width="1.4" height="3.5" rx="0.7" fill="${C['дерево-тень']}"/>`;
  return `<path d="M22 23.5l-1.5 4h3" stroke="${C['дерево-тень']}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
};

/**
 * Лицо в SVG, 44×44 в собственных координатах и растягивается под слот.
 * Возвращается разметкой, а не элементом: строку одинаково легко положить
 * в `innerHTML` и проверить в Node.
 */
export function avatarSvg(look: AvatarLook, seed = 0): string {
  const traits = avatarTraits(look, seed);
  const {
    skin,
    cloth,
    hair,
    brows: browKind,
    beard: beardKind,
    mouth: mouthKind,
    face: faceKind,
    eyes: eyeKind,
    nose: noseKind,
    accent: extra,
  } = traits;

  const body =
    `<circle cx="22" cy="22" r="22" fill="${BACK[look]}"/>` +
    `<path d="M4 44a18 14 0 0 1 36 0z" fill="${cloth}"/>`;
  const head =
    faceKind === 0
      ? `<rect x="13" y="13" width="18" height="20" rx="6" fill="${skin}"/>`
      : faceKind === 1
        ? `<rect x="12" y="13" width="20" height="20" rx="7" fill="${skin}"/>`
        : `<rect x="11" y="13" width="22" height="20" rx="9" fill="${skin}"/>`;
  const eyes =
    eyeKind === 0
      ? `<circle cx="17.5" cy="23" r="1.6" fill="${C.мрак}"/>` +
        `<circle cx="26.5" cy="23" r="1.6" fill="${C.мрак}"/>`
      : eyeKind === 1
        ? `<rect x="16" y="21" width="3" height="4" rx="1.5" fill="${C.мрак}"/>` +
          `<rect x="25" y="21" width="3" height="4" rx="1.5" fill="${C.мрак}"/>`
        : `<rect x="15.5" y="22" width="4" height="2" rx="1" fill="${C.мрак}"/>` +
          `<rect x="24.5" y="22" width="4" height="2" rx="1" fill="${C.мрак}"/>`;
  // Лицо целиком: приметы поверх глаз, убор — поверх примет.
  const face =
    head +
    eyes +
    brows(browKind, hair) +
    nose(noseKind) +
    beard(beardKind, hair) +
    (beardKind === 2 ? '' : mouth(mouthKind));

  // Рыцарь лица не показывает, и приметы у него кузнечные: жребии примет
  // (брови, борода, рот) переиспользуются на тон купола, забрало и заклёпки —
  // новых бросков нет, и сид даёт то же лицо всем остальным видам.
  const dome = beardKind === 0 ? C.металл : C.сталь;
  /** Подбородник контрастом к куполу: одним цветом шлем слипался бы в пятно. */
  const trim = beardKind === 0 ? C.сталь : C.металл;
  /** Забрало: щель, крест или решётка — по нему рыцари узнают друг друга. */
  const visor =
    `<rect x="11" y="19" width="22" height="4" rx="1" fill="${C['металл-тень']}"/>` +
    (browKind === 1
      ? `<rect x="20.5" y="16.5" width="3" height="9" rx="1.2" fill="${C['металл-тень']}"/>`
      : browKind === 2
        ? `<rect x="15.5" y="19" width="2" height="4" fill="${dome}"/>` +
          `<rect x="21" y="19" width="2" height="4" fill="${dome}"/>` +
          `<rect x="26.5" y="19" width="2" height="4" fill="${dome}"/>`
        : '');
  const rivets =
    mouthKind === 2
      ? `<circle cx="13.8" cy="16.6" r="1.2" fill="${C.латунь}"/>` +
        `<circle cx="30.2" cy="16.6" r="1.2" fill="${C.латунь}"/>`
      : '';
  /** Наплечники: герой в железе, а не в одном сукне — но сукно из-под них видно. */
  const pauldrons =
    `<path d="M4 44a18 14 0 0 1 9-12l4 6a12 9 0 0 0-8 6z" fill="${dome}"/>` +
    `<path d="M40 44a18 14 0 0 0-9-12l-4 6a12 9 0 0 1 8 6z" fill="${dome}"/>`;

  /**
   * Три семейства рыцарских шлемов. Акцент меняет весь силуэт, а не только
   * красную деталь сверху: большой шлем, вытянутый салад и турнирный купол.
   */
  const knightHelm =
    extra === 0
      ? `<path d="M11 18a11 9 0 0 1 22 0v10l-3 4H14l-3-4z" fill="${dome}"/>` +
        visor +
        rivets +
        `<path d="M18 14V9h8v5l-2 3h-4z" fill="${C['краска-алая']}"/>` +
        `<rect x="13" y="27" width="18" height="4" rx="1" fill="${trim}"/>`
      : extra === 1
        ? `<path d="M9 22c1-8 6-13 14-13 7 0 11 5 12 13l5 3-8 2-3 5H15l-4-6z" fill="${dome}"/>` +
          visor +
          `<path d="M22 15c1-5 4-8 10-9-1 5-4 9-8 11z" fill="${C['краска-алая']}"/>` +
          `<path d="M14 27h18l-3 5H16z" fill="${trim}"/>` +
          `<circle cx="32" cy="25" r="1.2" fill="${C.латунь}"/>`
        : `<path d="M10 22a12 11 0 0 1 24 0v7l-5 4H15l-5-4z" fill="${dome}"/>` +
          visor +
          rivets +
          `<rect x="15" y="9" width="14" height="5" rx="2.5" fill="${C['краска-алая']}"/>` +
          `<rect x="13" y="27" width="18" height="5" rx="2" fill="${trim}"/>` +
          `<circle cx="16" cy="29.5" r="1" fill="${C.латунь}"/>` +
          `<circle cx="28" cy="29.5" r="1" fill="${C.латунь}"/>`;

  /** Пряди поселенки: по плечам, коса набок или узел — из тех же волос. */
  const strands =
    extra === 0
      ? `<rect x="8" y="16" width="5" height="16" rx="2.5" fill="${hair}"/>` +
        `<rect x="31" y="16" width="5" height="16" rx="2.5" fill="${hair}"/>`
      : extra === 1
        ? `<rect x="30" y="16" width="5" height="20" rx="2.5" fill="${hair}"/>` +
          `<circle cx="32.5" cy="34" r="2" fill="${C.латунь}"/>`
        : `<circle cx="22" cy="11" r="4.5" fill="${hair}"/>`;

  const gear: Record<AvatarLook, string> = {
    // Рыцарь: глухие шлемы разных школ. Глаз не видно — их и не должно.
    knight: pauldrons + knightHelm,
    // Лучник: капюшон с боковинами и тетива через плечо. Тетива идёт ниже
    // лица: через лицо она читалась царапиной, а не снаряжением.
    archer:
      face +
      `<path d="M9 26a13 13 0 0 1 26 0v-5a13 13 0 0 0-26 0z" fill="${C.хвоя}"/>` +
      `<path d="M9 21a13 13 0 0 1 26 0l-4 2a9 9 0 0 0-18 0z" fill="${C.мох}"/>` +
      `<rect x="9" y="20" width="4" height="11" rx="2" fill="${C.хвоя}"/>` +
      `<rect x="31" y="20" width="4" height="11" rx="2" fill="${C.хвоя}"/>` +
      (extra === 0
        ? `<circle cx="22" cy="35" r="2.2" fill="${C.латунь}"/>`
        : extra === 1
          ? `<path d="M19 33l6 5m0-5-6 5" stroke="${C.солома}" stroke-width="1.5" stroke-linecap="round"/>`
          : `<path d="M28 14c3-4 6-5 9-5-1 4-3 7-7 8z" fill="${C.солома}"/>`) +
      `<path d="M6 44 32 33" stroke="${C.солома}" stroke-width="1.5" fill="none"/>` +
      `<path d="M33 27a9 9 0 0 1 0 14" stroke="${C['дерево-тень']}" stroke-width="2" fill="none"/>`,
    // Бандит: три разных клобука и маски. Не одна мелкая серьга поверх общего
    // силуэта, а три фигуры, которые различаются уже на 44 px: острый хвост,
    // короткая накидка и глубокий асимметричный капюшон.
    rogue:
      head +
      beard(beardKind, hair) +
      (extra === 0
        ? `<path d="M8 26a14 15 0 0 1 28 0l-4 8-5-5H17l-5 5z" fill="${C['сукно-тень']}"/>` +
          `<path d="M10 20l7-10 5 4 5-4 7 10-4 3a9 9 0 0 0-16 0z" fill="${C.мрак}"/>` +
          `<path d="M11 21h22v5H11z" fill="${C['дерево-тень']}"/>` +
          `<rect x="16" y="22" width="4" height="2.5" rx="1" fill="${C['соль-тень']}"/>` +
          `<rect x="24" y="22" width="4" height="2.5" rx="1" fill="${C['соль-тень']}"/>` +
          `<path d="M32 22l8-3-4 5 4 4-8-2z" fill="${C['дерево-тень']}"/>`
        : extra === 1
          ? `<path d="M9 27a13 13 0 0 1 26 0v5l-6-3H15l-6 3z" fill="${C.хвоя}"/>` +
            `<path d="M11 20a11 11 0 0 1 22 0l-4 2a8 8 0 0 0-14 0z" fill="${C['сукно-тень']}"/>` +
            `<rect x="11" y="20" width="22" height="6" rx="2" fill="${C.мрак}"/>` +
            `<rect x="16" y="22" width="4" height="2" rx="1" fill="${C['соль-тень']}"/>` +
            `<rect x="24" y="22" width="4" height="2" rx="1" fill="${C['соль-тень']}"/>` +
            `<circle cx="12" cy="28.5" r="2" fill="none" stroke="${C.латунь}" stroke-width="1.3"/>`
          : `<path d="M6 33l4-14 8-9 14 5 6 18-8-5-4 7H14z" fill="${C['сукно-тень']}"/>` +
            `<path d="M10 19l8-9 14 5-3 6-6-3-9 5z" fill="${C.мрак}"/>` +
            `<path d="M11 21l21-2-1 6-19 2z" fill="${C['дерево-тень']}"/>` +
            `<path d="M16 22l4-.4v2.5l-4 .4zm8-.8 4-.4v2.5l-4 .4z" fill="${C['соль-тень']}"/>` +
            `<path d="M29 31l3 3-3 3-3-3z" fill="${C.латунь}"/>`),
    // Поселенец: соломенная шапка и травинка — он с поля, а не из отряда.
    поселенец:
      face +
      `<path d="M7 18h30l-4-4a11 11 0 0 0-22 0z" fill="${C.солома}"/>` +
      `<path d="M7 18h30v2H7z" fill="${C['дерево-тень']}"/>` +
      (extra === 0
        ? `<path d="M34 36c3-3 4-8 3-12" stroke="${C.трава}" stroke-width="1.5" fill="none"/>`
        : extra === 1
          ? `<path d="M12 13h7v4h-8z" fill="${C['дерево-тень']}"/>`
          : `<path d="M34 37v-11m0 3-3-2m3 5 3-2" stroke="${C.солома}" stroke-width="1.4" stroke-linecap="round"/>`),
    // Поселенка: волосы с чёлкой и пряди — модель без чепца, и лицо без него:
    // волосы и есть шапка (assets/folk, Settler_Female). Бороды не бывает.
    поселенка:
      head +
      eyes +
      brows(browKind, hair) +
      nose(noseKind) +
      mouth(mouthKind) +
      `<path d="M10 19a12 12 0 0 1 24 0v-4a12 12 0 0 0-24 0z" fill="${hair}"/>` +
      `<path d="M10 17h24v3l-5-2H15l-5 2z" fill="${hair}"/>` +
      strands,
    // Торговец: широкополая шляпа и монета у плеча.
    торговец:
      face +
      `<path d="M5 17h34v3H5z" fill="${C['дерево-тень']}"/>` +
      `<path d="M13 17a9 9 0 0 1 18 0z" fill="${C.дерево}"/>` +
      (extra === 0
        ? `<circle cx="34" cy="34" r="5" fill="${C.латунь}"/>` +
          `<circle cx="34" cy="34" r="2" fill="${C.жар}"/>`
        : extra === 1
          ? `<path d="M29 31h10l-1 9h-8z" fill="${C['дерево-тень']}"/>` +
            `<path d="M31 31q3-5 6 0" stroke="${C.солома}" stroke-width="1.4" fill="none"/>`
          : `<path d="M28 13c4-5 8-6 11-5-2 4-5 7-9 8z" fill="${C['краска-алая']}"/>`),
    // Кузнец (§6.1.13): тёмная косынка на лбу и молот у плеча.
    кузнец:
      face +
      `<path d="M10 19a12 12 0 0 1 24 0v-3a12 12 0 0 0-24 0z" fill="${C.мрак}"/>` +
      `<rect x="10" y="17" width="24" height="3" rx="1.5" fill="${C['сукно-тень']}"/>` +
      `<rect x="31" y="26" width="3" height="13" rx="1.5" fill="${C['дерево-тень']}"/>` +
      (extra === 0
        ? `<rect x="28" y="24" width="9" height="5" rx="1" fill="${C.металл}"/>`
        : extra === 1
          ? `<path d="M27 24h11l-2 5h-7z" fill="${C.металл}"/>`
          : `<path d="M29 23h6l4 3-4 3h-6z" fill="${C.сталь}"/>`),
    // Охотник (§6.1.13): красный капюшон и перо — он из леса, а не со двора.
    охотник:
      face +
      `<path d="M9 26a13 13 0 0 1 26 0v-5a13 13 0 0 0-26 0z" fill="${C['краска-алая']}"/>` +
      `<path d="M9 21a13 13 0 0 1 26 0l-4 2a9 9 0 0 0-18 0z" fill="${C['краска-алая']}"/>` +
      `<rect x="9" y="20" width="4" height="11" rx="2" fill="${C['сукно-тень']}"/>` +
      `<rect x="31" y="20" width="4" height="11" rx="2" fill="${C['сукно-тень']}"/>` +
      (extra === 0
        ? `<path d="M31 14c3-3 6-4 9-4-1 3-3 6-7 7z" fill="${C.мох}"/>`
        : extra === 1
          ? `<path d="M13 14c-3-3-6-4-9-4 1 3 3 6 7 7z" fill="${C.солома}"/>`
          : `<path d="M30 14c2-4 5-6 8-7 0 4-2 7-6 9z" fill="${C.трава}"/>` +
            `<path d="M14 14c-2-3-4-4-6-4 0 3 2 5 5 6z" fill="${C.трава}"/>`),
    // Лесник (§6.1.6.3): хвойный капюшон, наброшенный на плечи, и топор
    // у плеча. Капюшон, а не шапка, — он отличает лесника от охотника
    // в том же кружке: у охотника алый и с пером, здесь хвойный и глухой.
    // Топор берётся тем же, чем занят: он куплен рубить дерево, и в кружке
    // это единственное, что о нём стоит сказать.
    лесник:
      face +
      `<path d="M8 27a14 14 0 0 1 28 0v-6a14 14 0 0 0-28 0z" fill="${C.хвоя}"/>` +
      `<path d="M8 22a14 14 0 0 1 28 0l-4 2a10 10 0 0 0-20 0z" fill="${C.хвоя}"/>` +
      `<path d="M7 25l3 14h-3z" fill="${C.мох}"/>` +
      `<path d="M37 25l-3 14h3z" fill="${C.мох}"/>` +
      `<rect x="30" y="21" width="2.6" height="18" rx="1.3" fill="${C['дерево-тень']}"/>` +
      (extra === 0
        ? `<path d="M28 20h4l3 3-3 3h-4z" fill="${C.сталь}"/>`
        : extra === 1
          ? `<path d="M27 19h5l4 4-4 4h-5l2-4z" fill="${C.металл}"/>`
          : `<path d="M28 19h4l4 2v4l-4 2h-4l2-4z" fill="${C.сталь}"/>`),
  };

  return (
    `<svg viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">` +
    body +
    gear[look] +
    `</svg>`
  );
}
