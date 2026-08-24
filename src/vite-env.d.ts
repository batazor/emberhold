/// <reference types="vite/client" />

interface EmberholdLanguageApi {
  readonly current: 'en' | 'ru';
  set(language: 'en' | 'ru'): Promise<void>;
  toggle(parent: HTMLElement, className?: string): HTMLElement;
  message(
    descriptor: { readonly id: string; readonly message: string },
    values?: Readonly<Record<string, string | number | { readonly kind: 'duration'; readonly seconds: number }>>,
  ): string;
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
