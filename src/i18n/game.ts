import type { GameMessage } from './gameMessages';

export type GameMessageValues = Readonly<Record<string, string | number>>;

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

const interpolate = (source: string, values: GameMessageValues = {}): string =>
  source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name: string) => String(values[name] ?? whole));

export function gameText(descriptor: GameMessage, values?: GameMessageValues): string {
  return window.EmberholdLanguage?.message(descriptor, values) ?? interpolate(descriptor.message, values);
}

export function setGameText(element: Element, descriptor: GameMessage, values?: GameMessageValues): void {
  element.setAttribute('data-lingui-text', JSON.stringify(payload(descriptor, values)));
  element.textContent = gameText(descriptor, values);
}

export function clearGameText(element: Element): void {
  element.removeAttribute('data-lingui-text');
}

export function setGameAttribute(
  element: Element,
  name: 'aria-label' | 'placeholder' | 'title',
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
  name: 'aria-label' | 'placeholder' | 'title',
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
