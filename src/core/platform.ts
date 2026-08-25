/**
 * Тонкая граница платформы. Игра не знает, кто открыл её — обычный браузер,
 * Telegram Mini App или мини-приложение ВКонтакте; различаются только вход,
 * цена, приглашения и открытие оплаты.
 */
import bridge from '@vkontakte/vk-bridge';

export type PlatformKind = 'web' | 'telegram' | 'vk';
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
  readonly platform?: string;
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

const telegramSdk = (): TelegramWebApp | null => window.Telegram?.WebApp ?? null;

/** The SDK is loaded on the web too; only a real Telegram WebView has a platform. */
const telegram = (): TelegramWebApp | null => {
  const app = telegramSdk();
  return app !== null && (app.initData !== '' || (app.platform !== undefined && app.platform !== 'unknown'))
    ? app
    : null;
};

const telegramIdentity = (): TelegramWebApp | null => {
  const app = window.Telegram?.WebApp;
  // Platform detection may use Telegram's host marker, but identity never may:
  // only signed initData crosses the authentication boundary.
  return app !== undefined && app.initData !== '' ? app : null;
};

/**
 * Идентификатор мини-приложения в каталоге ВК. Он публичный — им же
 * открывается игра снаружи, — и потому живёт в клиенте рядом с именем
 * бота. Секрет приложения, которым проверяется подпись входа, сюда
 * не попадает никогда: он остаётся на сервере.
 */
const VK_APP_ID = 54735735;

/**
 * ВК передаёт параметры запуска в адресной строке кадра, и `vk_app_id`
 * есть среди них всегда. Признак берётся из адреса, а не из моста:
 * платформу нужно знать до того, как мост ответит.
 */
const vk = (): boolean => new URLSearchParams(location.search).has('vk_app_id');

export const platformKind = (): PlatformKind =>
  telegram() !== null ? 'telegram' : vk() ? 'vk' : 'web';
export const telegramInitData = (): string | null => telegramIdentity()?.initData ?? null;

/**
 * Main Mini App deep links expose the payload twice. Prefer signed initData,
 * but keep the documented query fallback for older Telegram clients.
 *
 * У ВК роль `startapp` играет хвост ссылки после решётки: клиент переносит
 * его в адрес кадра как есть.
 */
export function platformStartParam(): string | null {
  const fromInitData = telegram()?.initDataUnsafe?.start_param;
  const raw = fromInitData
    ?? (vk() ? location.hash.replace(/^#/, '') : null)
    ?? new URLSearchParams(location.search).get('tgWebAppStartParam');
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

/**
 * Приглашение обязано вести туда, откуда игрок его получил: ссылка на бота,
 * открытая внутри ВК, уводит игрока с платформы и теряет токен по дороге.
 */
const inviteLink = (payload: string): string => platformKind() === 'vk'
  ? `https://vk.com/app${VK_APP_ID}#${payload}`
  : `https://t.me/emberhold_game_bot?startapp=${payload}`;

export const clanInviteLink = (token: string): string =>
  inviteLink(`clan_${encodeURIComponent(token)}`);

export const gameReferralLink = (token: string): string =>
  inviteLink(`ref_${encodeURIComponent(token)}`);

export type ShareResult = 'shared' | 'copied' | 'failed';

/**
 * Telegram gets its native chat picker; browsers use the OS share sheet.
 *
 * ВК своего окна не даёт бесплатно: кадр мини-приложения чужой странице
 * не родня, и `navigator.share` в нём молча недоступен — отправку берёт
 * на себя мост.
 */
export async function shareClanInvite(link: string, text: string): Promise<ShareResult> {
  const app = telegram();
  if (app?.openTelegramLink !== undefined) {
    app.HapticFeedback?.impactOccurred('light');
    app.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return 'shared';
  }
  if (vk()) {
    // Отказ игрока в окне отправки приходит сюда исключением — и это отказ,
    // а не поломка: ссылка уже создана, звать её неудачей нельзя.
    try {
      await bridge.send('VKWebAppShare', { link });
      return 'shared';
    } catch {
      return 'failed';
    }
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

/**
 * Пока мини-приложение не сказало «я загрузилось», ВК показывает поверх
 * кадра свой загрузчик — игра при этом работает, но её не видно. Сигнал
 * посылается первым делом и до сцены: он стоит одного сообщения, а его
 * отсутствие выглядит как намертво зависшая игра.
 */
export function initPlatform(): void {
  const app = telegram();
  if (app === null) {
    if (!vk()) return;
    void bridge.send('VKWebAppInit').catch(() => {
      // Мост отвечает отказом только вне клиента ВК. Игра там всё равно
      // играется — молчание здесь честнее сломанного запуска.
    });
    document.documentElement.dataset.platform = 'vk';
    return;
  }
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
  document.documentElement.dataset.platform = 'telegram';
}

export function platformPrice(webPrice: string, stars: number): string {
  return platformKind() === 'telegram' ? `${stars} ⭐` : webPrice;
}

/**
 * Чем платит игрок, в том виде, в каком это записывает телеметрия (§9):
 * целое число минорных единиц и валюта рядом. У Telegram это звёзды —
 * `XTR` по ISO 4217, и минорной единицы у них нет вовсе, поэтому звезда
 * записывается единицей. Складывать `XTR` с `USD` нельзя, и ровно затем
 * валюта названа рядом с числом, а не подразумевается.
 */
export function platformCharge(webMinor: number, stars: number): { priceMinor: number; currency: string } {
  return platformKind() === 'telegram'
    ? { priceMinor: stars, currency: 'XTR' }
    : { priceMinor: webMinor, currency: 'USD' };
}

/**
 * Telegram оставляет игрока в игре; веб передаёт управление Stripe.
 *
 * В ВК игра живёт в кадре, а Stripe в кадр не встраивается — увести туда
 * `location` значило бы обменять оплату на пустой прямоугольник. Оплата
 * уходит наружу, а игра остаётся открытой там, где была.
 */
export async function openPlatformCheckout(url: string): Promise<CheckoutResult> {
  const app = telegram();
  if (app === null) {
    // Не «redirected»: уходит соседняя вкладка, а не эта. Для витрины это
    // начатая оплата, которую ещё предстоит дождаться, — то есть «pending».
    if (vk()) return window.open(url, '_blank', 'noopener') === null ? 'failed' : 'pending';
    location.assign(url);
    return 'redirected';
  }
  return new Promise((resolve) => {
    app.HapticFeedback?.impactOccurred('light');
    app.openInvoice(url, resolve);
  });
}
