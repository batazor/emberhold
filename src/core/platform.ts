/**
 * Тонкая граница платформы. Игра не знает, кто открыл её — обычный браузер
 * или Telegram Mini App; различаются только вход, цена и открытие оплаты.
 */

export type PlatformKind = 'web' | 'telegram';
export type CheckoutResult = 'paid' | 'cancelled' | 'failed' | 'pending' | 'redirected';

interface TelegramUser {
  readonly id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

interface TelegramWebApp {
  readonly initData: string;
  readonly initDataUnsafe?: { readonly user?: TelegramUser; readonly start_param?: string };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  openTelegramLink?(url: string): void;
  openInvoice(url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  readonly HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void };
}

declare global {
  interface Window { Telegram?: { readonly WebApp?: TelegramWebApp }; }
}

const telegram = (): TelegramWebApp | null => {
  const app = window.Telegram?.WebApp;
  // Наличие объекта от подключённого SDK ещё не означает запуск из Telegram:
  // в обычном браузере initData пуст, и доверять такому окружению нельзя.
  return app !== undefined && app.initData !== '' ? app : null;
};

export const platformKind = (): PlatformKind => telegram() === null ? 'web' : 'telegram';
export const telegramInitData = (): string | null => telegram()?.initData ?? null;

/**
 * Main Mini App deep links expose the payload twice. Prefer signed initData,
 * but keep the documented query fallback for older Telegram clients.
 */
export function platformStartParam(): string | null {
  const fromInitData = telegram()?.initDataUnsafe?.start_param;
  const raw = fromInitData ?? new URLSearchParams(location.search).get('tgWebAppStartParam');
  return raw !== null && /^[A-Za-z0-9_-]{1,512}$/.test(raw) ? raw : null;
}

export const clanInviteStartToken = (): string | null => {
  const match = platformStartParam()?.match(
    /^clan_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

export const gameReferralStartToken = (): string | null => {
  const match = platformStartParam()?.match(
    /^ref_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

export const clanInviteLink = (token: string): string =>
  `https://t.me/emberhold_game_bot?startapp=clan_${encodeURIComponent(token)}`;

export const gameReferralLink = (token: string): string =>
  `https://t.me/emberhold_game_bot?startapp=ref_${encodeURIComponent(token)}`;

export type ShareResult = 'shared' | 'copied' | 'failed';

/** Telegram gets its native chat picker; browsers use the OS share sheet. */
export async function shareClanInvite(link: string, text: string): Promise<ShareResult> {
  const app = telegram();
  if (app?.openTelegramLink !== undefined) {
    app.HapticFeedback?.impactOccurred('light');
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return 'shared';
  }
  try {
    if (navigator.share !== undefined) {
      await navigator.share({ title: 'Emberhold', text, url: link });
      return 'shared';
    }
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export const shareGameInvite = shareClanInvite;

export function initPlatform(): void {
  const app = telegram();
  if (app === null) return;
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
  document.documentElement.dataset.platform = 'telegram';
}

export function platformPrice(webPrice: string, stars: number): string {
  return platformKind() === 'telegram' ? `${stars} ⭐` : webPrice;
}

/** Telegram оставляет игрока в игре; веб передаёт управление Stripe. */
export async function openPlatformCheckout(url: string): Promise<CheckoutResult> {
  const app = telegram();
  if (app === null) {
    location.assign(url);
    return 'redirected';
  }
  return new Promise((resolve) => {
    app.HapticFeedback?.impactOccurred('light');
    app.openInvoice(url, resolve);
  });
}
