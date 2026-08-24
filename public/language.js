(() => {
  'use strict';

  const STORAGE_KEY = 'emberhold/language';
  const LANGUAGES = ['en', 'ru'];
  const CYRILLIC = /[А-Яа-яЁё]/;

  // The generated catalog is kept next to the small runtime so every artbook
  // can use it without becoming a separate Vite entry point.
  let catalog = { exact: {}, patterns: {} };

  const read = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (LANGUAGES.includes(saved)) return saved;
    } catch {}
    return 'en';
  };

  let current = read();
  const original = new WeakMap();
  let patternEntries = [];
  const compilePatterns = () => Object.entries(catalog.patterns).map(([source, target]) => {
    const holes = [...source.matchAll(/ZXQPH(\d+)QXZ/g)].map((match) => Number(match[1]));
    const escaped = source
      .split(/ZXQPH\d+QXZ/g)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const expression = '^' + escaped.map((part, index) => index === 0 ? part : '([\\s\\S]*?)' + part).join('') + '$';
    return { regex: new RegExp(expression), target, holes };
  });

  const normalized = (text) => text.replace(/\s+/g, ' ').trim();

  function translate(text) {
    if (current !== 'en' || !CYRILLIC.test(text)) return text;
    const leading = text.match(/^\s*/)?.[0] ?? '';
    const trailing = text.match(/\s*$/)?.[0] ?? '';
    const source = normalized(text);
    let translated = catalog.exact[source];
    if (translated === undefined) {
      for (const pattern of patternEntries) {
        const match = pattern.regex.exec(source);
        if (match === null) continue;
        translated = pattern.target.replace(/ZXQPH(\d+)QXZ/g, (_, raw) => {
          const at = pattern.holes.indexOf(Number(raw));
          return translate(match[at + 1] ?? '');
        });
        break;
      }
    }
    return translated === undefined ? text : leading + translated + trailing;
  }

  function textNode(node) {
    const parent = node.parentElement;
    if (parent === null || parent.closest('script,style,noscript,code,pre,[translate="no"]') !== null) return;
    const value = node.nodeValue ?? '';
    let source = original.get(node);
    if (typeof source === 'string' && value !== source && value !== translate(source)) source = undefined;
    source ??= value;
    if (CYRILLIC.test(source)) original.set(node, source);
    const next = current === 'en' ? translate(source) : source;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];
  function element(node) {
    if (node.closest('[translate="no"]') !== null) return;
    let saved = original.get(node);
    if (typeof saved !== 'object' || saved === null) saved = {};
    for (const name of ATTRIBUTES) {
      if (!node.hasAttribute(name)) continue;
      const value = node.getAttribute(name) ?? '';
      let source = saved[name];
      if (typeof source === 'string' && value !== source && value !== translate(source)) source = undefined;
      source ??= value;
      if (!(name in saved) && CYRILLIC.test(source)) {
        saved[name] = source;
        original.set(node, saved);
      } else if (saved[name] !== source && CYRILLIC.test(source)) {
        saved[name] = source;
        original.set(node, saved);
      }
      const next = current === 'en' ? translate(source) : source;
      if (node.getAttribute(name) !== next) node.setAttribute(name, next);
    }
  }

  function localize(root) {
    if (root.nodeType === 3) {
      textNode(root);
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const doc = root.nodeType === 9 ? root : root.ownerDocument;
    if (root.nodeType === 1) element(root);
    const walker = doc.createTreeWalker(root, 1 | 4);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.nodeType === 3) textNode(node);
      else element(node);
    }
    doc.documentElement.lang = current;
  }

  const observed = new Set();
  function observe(doc = document) {
    if (observed.has(doc)) return;
    observed.add(doc);
    localize(doc);
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') textNode(mutation.target);
        else if (mutation.type === 'attributes') element(mutation.target);
        else for (const node of mutation.addedNodes) localize(node);
      }
    }).observe(doc, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }

  /**
   * Переключение — **без перезагрузки**. Перезагрузка была простым решением
   * и стоила больше, чем экономила: тап по языку выбрасывал игрока из кадра,
   * а на карточке регистрации стирал набранную почту. Обратный перевод
   * при этом ничего не стоит — исходная строка помнится у каждого узла
   * (`original`), и `localize` возвращает её сам.
   */
  async function set(language) {
    if (!LANGUAGES.includes(language) || language === current) return;
    current = language;
    try { localStorage.setItem(STORAGE_KEY, language); } catch {}
    document.documentElement.lang = current;
    if (language === 'en') await ready();
    for (const doc of observed) localize(doc);
    for (const group of toggles) paint(group);
    dispatchEvent(new CustomEvent('emberhold-language-changed', { detail: current }));
  }

  /** Переключатели на экране: их надписи обязаны знать о смене языка. */
  const toggles = new Set();
  function paint(group) {
    for (const button of group.querySelectorAll('button[data-lang]')) {
      const on = button.dataset.lang === current;
      button.className = on ? 'on' : '';
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function toggle(parent, className = '') {
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
      button.addEventListener('click', () => { void set(language); });
      group.appendChild(button);
    }
    paint(group);
    toggles.add(group);
    parent.appendChild(group);
    return group;
  }

  const SOURCE = new URL('./language-en.gz.txt', document.currentScript?.src ?? location.href);
  let loading = null;

  /**
   * Каталог. Грузится один раз и по требованию: страница, открытая
   * по-русски, не платит за словарь вовсе, а переключённая на английский
   * ждёт его ровно один раз.
   */
  function ready() {
    if (loading !== null) return loading;
    loading = fetch(SOURCE)
      .then((response) => {
        if (!response.ok) throw new Error(`language catalog: ${response.status}`);
        return response.text();
      })
      .then((encoded) => {
        const bytes = Uint8Array.from(atob(encoded.replace(/\s/g, '')), (char) => char.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).json();
      })
      .then((loaded) => {
        catalog = loaded;
        patternEntries = compilePatterns();
        for (const doc of observed) localize(doc);
        dispatchEvent(new CustomEvent('emberhold-language-ready'));
      })
      .catch((error) => { console.error(error); loading = null; });
    return loading;
  }

  window.EmberholdLanguage = { get current() { return current; }, set, toggle, translate, localize, observe, ready };
  document.documentElement.lang = current;
  const embedded = window.self !== window.top;
  if (!embedded) observe(document);

  if (current === 'en') void ready();

  /**
   * Плавающий переключатель — только для артбуков и страниц-замеров.
   * В самой игре его нет: угол экрана занят кадром, а язык живёт там же,
   * где громкость и «Новая игра», — в настройках под шестернёй (§18.5).
   * Пустой хвост адреса — это и есть игра (`/`), поэтому он в списке.
   */
  const standalone = () => {
    const page = location.pathname.split('/').pop() ?? '';
    if (window.self !== window.top || page === '' || /^(index|artbooks)\.html$/.test(page)) return;
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
})();
