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
  readonly initDataUnsafe?: { readonly user?: TelegramUser };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
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

