import type { GameMessage } from './gameMessages';

export interface GameDurationValue {
  readonly kind: 'duration';
  readonly seconds: number;
}

export type GameMessageValue = string | number | GameDurationValue;
export type GameMessageValues = Readonly<Record<string, GameMessageValue>>;

interface GameMessagePayload {
  readonly id: string;
  readonly message: string;
  readonly values?: GameMessageValues;
}

const payload = (descriptor: GameMessage, values?: GameMessageValues): GameMessagePayload => ({
  id: descriptor.id,
  message: descriptor.message,
  ...(values === undefined ? {} : { values }),
});

const fallbackValue = (value: GameMessageValue): string | number => {
  if (typeof value !== 'object') return value;
  const seconds = Math.max(0, Math.ceil(value.seconds));
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes > 0 ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest > 0 ? `${minutes} мин ${rest} с` : `${minutes} мин`;
  }
  return `${seconds} с`;
};

const interpolate = (source: string, values: GameMessageValues = {}): string =>
  source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(fallbackValue(value));
  });

/** Natural-language Lingui ID for static UI copy declared beside its render point. */
export const gameMessage = (source: string, translation?: string): GameMessage => ({
  id: source,
  message: source,
  ...(translation === undefined ? {} : { translation }),
});

export const gameDuration = (seconds: number): GameDurationValue => ({ kind: 'duration', seconds });

export function gameText(descriptor: GameMessage, values?: GameMessageValues): string {
  return window.EmberholdLanguage?.message(descriptor, values) ?? interpolate(descriptor.message, values);
}

export function setGameText(element: Element, descriptor: GameMessage, values?: GameMessageValues): void {
  element.setAttribute('data-lingui-text', JSON.stringify(payload(descriptor, values)));
  element.textContent = gameText(descriptor, values);
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

/** Explicit text payload for existing innerHTML-based panels. */
export function gameMarkup(descriptor: GameMessage, values?: GameMessageValues): string {
  const encoded = escapeHtml(JSON.stringify(payload(descriptor, values)));
  return `<span data-lingui-text="${encoded}">${escapeHtml(gameText(descriptor, values))}</span>`;
}

export function clearGameText(element: Element): void {
  element.removeAttribute('data-lingui-text');
}

export function setGameAttribute(
  element: Element,
  name: 'alt' | 'aria-label' | 'placeholder' | 'title',
  descriptor: GameMessage,
  values?: GameMessageValues,
): void {
  const raw = element.getAttribute('data-lingui-attributes');
  let attributes: Record<string, GameMessagePayload> = {};
  if (raw !== null) {
    try {
      attributes = JSON.parse(raw) as Record<string, GameMessagePayload>;
    } catch {}
  }
  attributes[name] = payload(descriptor, values);
  element.setAttribute('data-lingui-attributes', JSON.stringify(attributes));
  element.setAttribute(name, gameText(descriptor, values));
}

export function clearGameAttribute(
  element: Element,
  name: 'alt' | 'aria-label' | 'placeholder' | 'title',
): void {
  const raw = element.getAttribute('data-lingui-attributes');
  if (raw !== null) {
    try {
      const attributes = JSON.parse(raw) as Record<string, GameMessagePayload>;
      delete attributes[name];
      if (Object.keys(attributes).length === 0) element.removeAttribute('data-lingui-attributes');
      else element.setAttribute('data-lingui-attributes', JSON.stringify(attributes));
    } catch {
      element.removeAttribute('data-lingui-attributes');
    }
  }
  element.removeAttribute(name);
}
