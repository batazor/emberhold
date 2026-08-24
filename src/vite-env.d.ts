/// <reference types="vite/client" />

interface EmberholdLanguageApi {
  readonly current: 'en' | 'ru';
  set(language: 'en' | 'ru'): void;
  toggle(parent: HTMLElement, className?: string): HTMLElement;
  translate(text: string): string;
  localize(root: Node): void;
  observe(document?: Document): void;
  /** Дождаться словаря: переключение на английский ждёт его один раз. */
  ready(): Promise<void>;
}

interface Window {
  readonly EmberholdLanguage?: EmberholdLanguageApi;
}
