import { i18n, type Messages } from '@lingui/core';
import { legacyPatterns } from './legacy';

type Language = 'en' | 'ru';

const STORAGE_KEY = 'emberhold/language';
const LANGUAGES: readonly Language[] = ['en', 'ru'];
const CYRILLIC = /[А-Яа-яЁё]/;
const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'] as const;

const catalogs: Record<Language, () => Promise<Messages>> = {
  en: () => import('../locales/en/messages.po').then((catalog) => catalog.messages),
  // Russian is the source language already present in the DOM. Its PO catalog
  // remains part of the translation workflow, but does not need to ship.
  ru: async () => ({}),
};

const loaded = new Set<Language>();
const original = new WeakMap<Node, string | Record<string, string>>();
const rendered = new WeakMap<Node, string | Record<string, string>>();
const observed = new Map<Document, MutationObserver>();

const read = (): Language => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {}
  return 'en';
};

let current: Language = read();
let activation = 0;

const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim();

const patternEntries = legacyPatterns.map(({ source }) => {
  const holes = [...source.matchAll(/ZXQPH(\d+)QXZ/g)].map((match) => Number(match[1]));
  const escaped = source
    .split(/ZXQPH\d+QXZ/g)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const expression = `^${escaped.map((part, index) => (index === 0 ? part : `([\\s\\S]*?)${part}`)).join('')}$`;
  return { id: source, holes, regex: new RegExp(expression) };
});

function translate(text: string): string {
  if (!loaded.has(current) || current === 'ru' || !CYRILLIC.test(text)) return text;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const source = normalized(text);
  if (Object.hasOwn(i18n.messages, source)) return leading + i18n._(source) + trailing;

  for (const pattern of patternEntries) {
    const match = pattern.regex.exec(source);
    if (match === null) continue;
    const values: Record<string, string> = {};
    pattern.holes.forEach((hole, index) => {
      values[`value${hole}`] = translate(match[index + 1] ?? '');
    });
    return leading + i18n._(pattern.id, values) + trailing;
  }
  return text;
}

function textNode(node: Node): void {
  const parent = node.parentElement;
  if (parent === null || parent.closest('script,style,noscript,code,pre,[translate="no"]') !== null) return;
  const value = node.nodeValue ?? '';
  let source = original.get(node);
  const previous = rendered.get(node);
  if (typeof source === 'string' && value !== source && value !== previous) source = undefined;
  source ??= value;
  if (typeof source !== 'string') return;
  if (CYRILLIC.test(source)) original.set(node, source);
  const next = translate(source);
  rendered.set(node, next);
  if (node.nodeValue !== next) node.nodeValue = next;
}

function element(node: Element): void {
  if (node.closest('[translate="no"]') !== null) return;
  const stored = original.get(node);
  const saved: Record<string, string> = typeof stored === 'object' && stored !== null ? stored : {};
  const last = rendered.get(node);
  const painted: Record<string, string> = typeof last === 'object' && last !== null ? last : {};
  for (const name of ATTRIBUTES) {
    if (!node.hasAttribute(name)) continue;
    const value = node.getAttribute(name) ?? '';
    let source: string | undefined = saved[name];
    if (typeof source === 'string' && value !== source && value !== painted[name]) source = undefined;
    source ??= value;
    if (saved[name] !== source && CYRILLIC.test(source)) {
      saved[name] = source;
      original.set(node, saved);
    }
    const next = translate(source);
    painted[name] = next;
    rendered.set(node, painted);
    if (node.getAttribute(name) !== next) node.setAttribute(name, next);
  }
}

function localize(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    textNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (doc === null) return;
  if (root.nodeType === Node.ELEMENT_NODE) element(root as Element);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) textNode(node);
    else element(node as Element);
  }
  doc.documentElement.lang = current;
}

function observe(doc: Document = document): void {
  if (observed.has(doc)) return;
  localize(doc);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') textNode(mutation.target);
      else if (mutation.type === 'attributes') element(mutation.target as Element);
      else for (const node of mutation.addedNodes) localize(node);
    }
  });
  observer.observe(doc, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
  observed.set(doc, observer);
}

function syncToggles(): void {
  for (const doc of observed.keys()) {
    doc.documentElement.lang = current;
    for (const button of doc.querySelectorAll<HTMLButtonElement>('.language-toggle button[data-lang]')) {
      const on = button.dataset.lang === current;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }
}

async function activate(language: Language): Promise<void> {
  const request = ++activation;
  if (!loaded.has(language)) {
    const messages = await catalogs[language]();
    i18n.load(language, messages);
    loaded.add(language);
  }
  if (request !== activation || language !== current) return;
  i18n.activate(language);
  syncToggles();
  for (const doc of observed.keys()) localize(doc);
  window.dispatchEvent(new CustomEvent('emberhold-language-ready', { detail: { language } }));
}

async function set(language: Language): Promise<void> {
  if (!LANGUAGES.includes(language)) return;
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {}
  syncToggles();
  await activate(language);
}

function toggle(parent: HTMLElement, className = ''): HTMLElement {
  const group = document.createElement('span');
  group.className = `language-toggle ${className}`.trim();
  group.setAttribute('translate', 'no');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Language');
  for (const language of LANGUAGES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.lang = language;
    button.textContent = language.toUpperCase();
    button.className = language === current ? 'on' : '';
    button.setAttribute('aria-pressed', String(language === current));
    button.addEventListener('click', () => void set(language));
    group.appendChild(button);
  }
  parent.appendChild(group);
  return group;
}

window.EmberholdLanguage = {
  get current() {
    return current;
  },
  set,
  toggle,
  translate,
  localize,
  observe,
};
document.documentElement.lang = current;

const embedded = window.self !== window.top;
if (!embedded) observe(document);
void activate(current);

const standalone = (): void => {
  if (embedded || /^(index|artbooks)\.html$/.test(location.pathname.split('/').pop() ?? '')) return;
  const style = document.createElement('style');
  style.textContent = `
    #emberhold-language { position:fixed; z-index:10000; top:max(10px,env(safe-area-inset-top)); right:10px;
      display:inline-flex; border:1px solid rgba(128,128,128,.55); background:Canvas; color:CanvasText;
      box-shadow:0 2px 12px rgba(0,0,0,.14); font:11px/1 system-ui,sans-serif; }
    #emberhold-language button { border:0; border-right:1px solid rgba(128,128,128,.45); padding:7px 9px;
      background:transparent; color:inherit; cursor:pointer; }
    #emberhold-language button:last-child { border-right:0; }
    #emberhold-language button.on { background:#8a6a12; color:#fff; }`;
  document.head.appendChild(style);
  const host = document.createElement('span');
  host.id = 'emberhold-language';
  document.body.appendChild(host);
  toggle(host);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', standalone, { once: true });
else standalone();
