import type { ResourceKind } from '../sim/resources';

const ICONS: Partial<Record<ResourceKind, string>> = {
  meat: new URL('../../assets/item-icons/meat.png', import.meta.url).href,
  pelt: new URL('../../assets/item-icons/fox-pelt.png', import.meta.url).href,
};

export const resourceIcon = (kind: ResourceKind): string | undefined => ICONS[kind];
