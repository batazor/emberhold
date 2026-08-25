export const PERSONAL_CAMP_PACK = 'camp_marks_personal_01';
export const CLAN_CAMP_PACK = 'camp_marks_clan_01';
export const CAMPFIRE_PACK = 'campfire_rites_01';
export const CAMP_DECOR_PACK = 'camp_decor_watch_01';
export const CLAN_HERALDRY_PACK = 'clan_heraldry_01';

export type CosmeticOwner = 'player' | 'clan';
export type CosmeticKind = 'personal-icon' | 'clan-icon' | 'fire' | 'decor' | 'heraldry';
export type PersonalCampIcon = 'default' | 'watchfire' | 'horned_tent';
export type ClanCampIcon = 'default' | 'banner_tower' | 'council_totem';
export type CampFireStyle = 'standard' | 'ghostfire' | 'witchfire';
export type CampDecorStyle = 'none' | 'wayfarer' | 'sentinel';
export type ClanHeraldry = 'plain' | 'raven' | 'sun';
export type CosmeticValue = PersonalCampIcon | ClanCampIcon | CampFireStyle | CampDecorStyle | ClanHeraldry;

export const PERSONAL_CAMP_ICONS: readonly PersonalCampIcon[] = ['default', 'watchfire', 'horned_tent'];
export const CLAN_CAMP_ICONS: readonly ClanCampIcon[] = ['default', 'banner_tower', 'council_totem'];
export const CAMP_FIRE_STYLES: readonly CampFireStyle[] = ['standard', 'ghostfire', 'witchfire'];
export const CAMP_DECOR_STYLES: readonly CampDecorStyle[] = ['none', 'wayfarer', 'sentinel'];
export const CLAN_HERALDRY: readonly ClanHeraldry[] = ['plain', 'raven', 'sun'];

export interface CosmeticCategory {
  readonly kind: CosmeticKind;
  readonly owner: CosmeticOwner;
  readonly sku: string;
  readonly price: string;
  readonly stars: number;
  readonly values: readonly CosmeticValue[];
}

export const COSMETIC_CATEGORIES: readonly CosmeticCategory[] = [
  { kind: 'personal-icon', owner: 'player', sku: PERSONAL_CAMP_PACK, price: '$2.99', stars: 150, values: PERSONAL_CAMP_ICONS },
  { kind: 'fire', owner: 'player', sku: CAMPFIRE_PACK, price: '$1.99', stars: 100, values: CAMP_FIRE_STYLES },
  { kind: 'decor', owner: 'player', sku: CAMP_DECOR_PACK, price: '$2.99', stars: 150, values: CAMP_DECOR_STYLES },
  { kind: 'clan-icon', owner: 'clan', sku: CLAN_CAMP_PACK, price: '$4.99', stars: 250, values: CLAN_CAMP_ICONS },
  { kind: 'heraldry', owner: 'clan', sku: CLAN_HERALDRY_PACK, price: '$3.99', stars: 200, values: CLAN_HERALDRY },
];

export const categoriesOf = (owner: CosmeticOwner): readonly CosmeticCategory[] =>
  COSMETIC_CATEGORIES.filter((category) => category.owner === owner);

export const categoryOf = (kind: CosmeticKind): CosmeticCategory => {
  const category = COSMETIC_CATEGORIES.find((candidate) => candidate.kind === kind);
  if (category === undefined) throw new Error(`unknown cosmetic category: ${kind}`);
  return category;
};

const DEFAULT_CAMP_ICON = new URL('../../assets/kenney-cartography/png/tent.png', import.meta.url).href;
const PERSONAL_CAMP_ICON_URL: Readonly<Record<PersonalCampIcon, string>> = {
  default: DEFAULT_CAMP_ICON,
  watchfire: new URL('../../assets/camp-cosmetics/personal-watchfire.png', import.meta.url).href,
  horned_tent: new URL('../../assets/camp-cosmetics/personal-horned-tent.png', import.meta.url).href,
};
const CLAN_CAMP_ICON_URL: Readonly<Record<ClanCampIcon, string>> = {
  default: DEFAULT_CAMP_ICON,
  banner_tower: new URL('../../assets/camp-cosmetics/clan-banner-tower.png', import.meta.url).href,
  council_totem: new URL('../../assets/camp-cosmetics/clan-council-totem.png', import.meta.url).href,
};

/** Free previews stay code-native; paid variants use their final store art. */
const svg = (body: string, background = '#1c1a16'): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="${background}"/>${body}</svg>`)}`;

const FIRE_PREVIEW: Readonly<Record<CampFireStyle, string>> = {
  standard: svg('<path fill="#8f4e33" d="M22 70l48-8 4 10-48 8zM26 61l45 13-4 10-45-13z"/><path fill="#dfa53c" d="M49 70C27 58 44 42 51 19c18 20 22 41-2 51z"/><path fill="#c9722a" d="M49 68c-9-8-3-19 3-28 7 10 8 21-3 28z"/>'),
  ghostfire: new URL('../../assets/camp-cosmetics/fire-ghostfire.png', import.meta.url).href,
  witchfire: new URL('../../assets/camp-cosmetics/fire-witchfire.png', import.meta.url).href,
};
const DECOR_PREVIEW: Readonly<Record<CampDecorStyle, string>> = {
  none: svg('<path fill="#8f4e33" d="M48 18l27 24v33H21V42z"/><path fill="#e3ba85" d="M15 43l33-29 33 29-7 7-26-22-26 22z"/>'),
  wayfarer: new URL('../../assets/camp-cosmetics/decor-wayfarer.png', import.meta.url).href,
  sentinel: new URL('../../assets/camp-cosmetics/decor-sentinel.png', import.meta.url).href,
};
const HERALDRY_PREVIEW: Readonly<Record<ClanHeraldry, string>> = {
  plain: svg('<path fill="#8f4e33" d="M25 14h7v70h-7z"/><path fill="#847263" d="M32 20h42v43L53 76 32 63z"/>'),
  raven: new URL('../../assets/camp-cosmetics/heraldry-black-sigil.png', import.meta.url).href,
  sun: new URL('../../assets/camp-cosmetics/heraldry-golden-sigil.png', import.meta.url).href,
};

export const personalCampIcon = (value: unknown): PersonalCampIcon =>
  typeof value === 'string' && PERSONAL_CAMP_ICONS.includes(value as PersonalCampIcon) ? value as PersonalCampIcon : 'default';
export const clanCampIcon = (value: unknown): ClanCampIcon =>
  typeof value === 'string' && CLAN_CAMP_ICONS.includes(value as ClanCampIcon) ? value as ClanCampIcon : 'default';
export const campFireStyle = (value: unknown): CampFireStyle =>
  typeof value === 'string' && CAMP_FIRE_STYLES.includes(value as CampFireStyle) ? value as CampFireStyle : 'standard';
export const campDecorStyle = (value: unknown): CampDecorStyle =>
  typeof value === 'string' && CAMP_DECOR_STYLES.includes(value as CampDecorStyle) ? value as CampDecorStyle : 'none';
export const clanHeraldry = (value: unknown): ClanHeraldry =>
  typeof value === 'string' && CLAN_HERALDRY.includes(value as ClanHeraldry) ? value as ClanHeraldry : 'plain';

export const personalCampIconUrl = (value: unknown): string => PERSONAL_CAMP_ICON_URL[personalCampIcon(value)];
export const clanCampIconUrl = (value: unknown): string => CLAN_CAMP_ICON_URL[clanCampIcon(value)];
export const cosmeticPreviewUrl = (kind: CosmeticKind, value: unknown): string => {
  if (kind === 'personal-icon') return personalCampIconUrl(value);
  if (kind === 'clan-icon') return clanCampIconUrl(value);
  if (kind === 'fire') return FIRE_PREVIEW[campFireStyle(value)];
  if (kind === 'decor') return DECOR_PREVIEW[campDecorStyle(value)];
  return HERALDRY_PREVIEW[clanHeraldry(value)];
};
export const cosmeticValue = (kind: CosmeticKind, value: unknown): CosmeticValue => {
  if (kind === 'personal-icon') return personalCampIcon(value);
  if (kind === 'clan-icon') return clanCampIcon(value);
  if (kind === 'fire') return campFireStyle(value);
  if (kind === 'decor') return campDecorStyle(value);
  return clanHeraldry(value);
};

export type CosmeticCollectionAction = 'sign-in' | 'create-clan' | 'equipped' | 'obtain' | 'equip' | 'role';
export function cosmeticCollectionAction(state: {
  readonly signedIn: boolean;
  readonly clanExists: boolean;
  readonly available: boolean;
  readonly equipped: boolean;
  readonly canEquip: boolean;
}): CosmeticCollectionAction {
  if (!state.signedIn) return 'sign-in';
  if (!state.clanExists) return 'create-clan';
  if (!state.available) return 'obtain';
  if (state.equipped) return 'equipped';
  return state.canEquip ? 'equip' : 'role';
}
