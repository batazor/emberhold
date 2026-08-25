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
  readonly values: readonly CosmeticValue[];
}

export const COSMETIC_CATEGORIES: readonly CosmeticCategory[] = [
  { kind: 'personal-icon', owner: 'player', sku: PERSONAL_CAMP_PACK, price: '$2.99', values: PERSONAL_CAMP_ICONS },
  { kind: 'fire', owner: 'player', sku: CAMPFIRE_PACK, price: '$1.99', values: CAMP_FIRE_STYLES },
  { kind: 'decor', owner: 'player', sku: CAMP_DECOR_PACK, price: '$2.99', values: CAMP_DECOR_STYLES },
  { kind: 'clan-icon', owner: 'clan', sku: CLAN_CAMP_PACK, price: '$4.99', values: CLAN_CAMP_ICONS },
  { kind: 'heraldry', owner: 'clan', sku: CLAN_HERALDRY_PACK, price: '$3.99', values: CLAN_HERALDRY },
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

/** Code-native previews keep the collection in the same graphic language as the map. */
const svg = (body: string, background = '#1c1a16'): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="${background}"/>${body}</svg>`)}`;

const FIRE_PREVIEW: Readonly<Record<CampFireStyle, string>> = {
  standard: svg('<path fill="#8f4e33" d="M22 70l48-8 4 10-48 8zM26 61l45 13-4 10-45-13z"/><path fill="#dfa53c" d="M49 70C27 58 44 42 51 19c18 20 22 41-2 51z"/><path fill="#c9722a" d="M49 68c-9-8-3-19 3-28 7 10 8 21-3 28z"/>'),
  ghostfire: svg('<path fill="#465c39" d="M22 70l48-8 4 10-48 8zM26 61l45 13-4 10-45-13z"/><path fill="#b7f4ef" d="M49 70C27 58 44 42 51 19c18 20 22 41-2 51z"/><path fill="#f4ffff" d="M49 68c-9-8-3-19 3-28 7 10 8 21-3 28z"/>', '#112321'),
  witchfire: svg('<path fill="#3c332c" d="M22 70l48-8 4 10-48 8zM26 61l45 13-4 10-45-13z"/><path fill="#b26cff" d="M49 70C27 58 44 42 51 19c18 20 22 41-2 51z"/><path fill="#f2ddff" d="M49 68c-9-8-3-19 3-28 7 10 8 21-3 28z"/>', '#21152c'),
};
const DECOR_PREVIEW: Readonly<Record<CampDecorStyle, string>> = {
  none: svg('<path fill="#8f4e33" d="M48 18l27 24v33H21V42z"/><path fill="#e3ba85" d="M15 43l33-29 33 29-7 7-26-22-26 22z"/>'),
  wayfarer: svg('<path stroke="#8f4e33" stroke-width="7" d="M28 75V24m40 51V24"/><path fill="#dfa53c" d="M18 31h20v25H18zm40 0h20v25H58z"/><path fill="#cb9160" d="M21 70h54v9H21z"/>'),
  sentinel: svg('<path fill="#8f4e33" d="M18 72h60v8H18zM25 24h7v49h-7zm39 0h7v49h-7z"/><path fill="#7d8892" d="M29 31l16 18-6 6-16-18zm38 0L51 49l6 6 16-18z"/><circle cx="48" cy="66" r="13" fill="#d83f35"/><circle cx="48" cy="66" r="5" fill="#dfa53c"/>'),
};
const HERALDRY_PREVIEW: Readonly<Record<ClanHeraldry, string>> = {
  plain: svg('<path fill="#8f4e33" d="M25 14h7v70h-7z"/><path fill="#847263" d="M32 20h42v43L53 76 32 63z"/>'),
  raven: svg('<path fill="#8f4e33" d="M25 14h7v70h-7z"/><path fill="#9d3434" d="M32 20h42v43L53 76 32 63z"/><path fill="#171713" d="M41 48l11-16 5 12 12 4-12 5-5 12-4-12z"/>'),
  sun: svg('<path fill="#8f4e33" d="M25 14h7v70h-7z"/><path fill="#315d82" d="M32 20h42v43L53 76 32 63z"/><circle cx="53" cy="47" r="11" fill="#dfa53c"/><path stroke="#dfa53c" stroke-width="4" d="M53 27v8m0 24v8M33 47h8m24 0h8M39 33l6 6m16 16 6 6m0-28-6 6M45 55l-6 6"/>'),
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
