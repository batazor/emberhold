/// <reference types="vite/client" />

interface EmberholdLanguageApi {
  readonly current: 'en' | 'ru';
  set(language: 'en' | 'ru'): Promise<void>;
  toggle(parent: HTMLElement, className?: string): HTMLElement;
  translate(text: string): string;
  localize(root: Node): void;
  observe(document?: Document): void;
}

declare module '*.po' {
  import type { Messages } from '@lingui/core';

  export const messages: Messages;
}

interface Window {
  EmberholdLanguage?: EmberholdLanguageApi;
}
