export const PERSONAL_CAMP_PACK = 'camp_marks_personal_01';
export const CLAN_CAMP_PACK = 'camp_marks_clan_01';

export type PersonalCampIcon = 'default' | 'watchfire' | 'horned_tent';
export type ClanCampIcon = 'default' | 'banner_tower' | 'council_totem';

export const PERSONAL_CAMP_ICONS: readonly PersonalCampIcon[] = [
  'default',
  'watchfire',
  'horned_tent',
];

export const CLAN_CAMP_ICONS: readonly ClanCampIcon[] = [
  'default',
  'banner_tower',
  'council_totem',
];

const DEFAULT_CAMP_ICON = new URL(
  '../../assets/kenney-cartography/png/tent.png',
  import.meta.url,
).href;

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

export const personalCampIcon = (value: unknown): PersonalCampIcon =>
  typeof value === 'string' && PERSONAL_CAMP_ICONS.includes(value as PersonalCampIcon)
    ? value as PersonalCampIcon
    : 'default';

export const clanCampIcon = (value: unknown): ClanCampIcon =>
  typeof value === 'string' && CLAN_CAMP_ICONS.includes(value as ClanCampIcon)
    ? value as ClanCampIcon
    : 'default';

export const personalCampIconUrl = (value: unknown): string =>
  PERSONAL_CAMP_ICON_URL[personalCampIcon(value)];

export const clanCampIconUrl = (value: unknown): string =>
  CLAN_CAMP_ICON_URL[clanCampIcon(value)];

export type CosmeticCollectionAction =
  | 'sign-in'
  | 'create-clan'
  | 'equipped'
  | 'obtain'
  | 'equip'
  | 'role';

/** Чистая машина состояний кнопки коллекции — предпросмотр действий не совершает. */
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
