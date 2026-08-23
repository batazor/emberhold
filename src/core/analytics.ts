import posthog from 'posthog-js';

/**
 * Куда уходит телеметрия §9. Модуль ничего не знает об игре: он принимает имя
 * события и плоский набор полей. Форма событий остаётся в `sim/telemetry.ts`,
 * сеть — здесь, ровно как у облачного сейва (`core/cloud.ts`).
 *
 * Граница проведена не для красоты. `sim/` обязан гоняться в Node —
 * на нём держатся `npm run measure`, `play` и все `*.rules.ts` (§0). Импорт
 * браузерной библиотеки в `sim/telemetry.ts` утянул бы `window` в замеры,
 * и headless-правило `npm run arch` упало бы справедливо. Поэтому сток
 * **регистрируют**, а не импортируют: в браузере его ставит `main.ts`,
 * в Node не ставит никто, и телеметрия там остаётся чистым буфером.
 *
 * Сбои проглатываются целиком: аналитика — наблюдение за игрой, а не её
 * часть, и «PostHog не ответил» обязано значить ровно ничего.
 */

/** Публичный ключ проекта — он и должен лежать в клиенте, как у Supabase. */
const PROJECT_KEY = 'phc_Bch96xpu3dxGXL4FeLVpSRgozLM4H65vtZfT4J2uu5QT';
const API_HOST = 'https://eu.i.posthog.com';

/**
 * Событие в том виде, в каком его знает эта сторона границы: имя, время
 * и что угодно сверх. `at` — секунды эпохи с игровых часов (`core/clock.ts`),
 * а не момент отправки: событие могло пролежать в очереди, и разница
 * в несколько секунд по вылазке уже врёт.
 */
export interface Signal {
  readonly t: string;
  readonly at: number;
  readonly [field: string]: unknown;
}

let live = false;

/**
 * Поднять аналитику и вернуть сток для `setTelemetrySink`. null — подняться
 * не вышло (нет сети, блокировщик, приватный режим); зовущий на это не
 * смотрит, потому что делать с отказом ему всё равно нечего.
 *
 * Автосъём выключен весь: автозахват кликов, просмотры страниц, вебвиталы.
 * §9 говорит «меряем ровно то, что перечислено в документе, и ни одного поля
 * сверх», и здесь это не лозунг — игра рисуется в одном canvas на одной
 * странице, так что автозахват прислал бы тысячи кликов по холсту, из которых
 * не следует ничего. Всё, что мы хотим знать, уже перечислено типом
 * `TelemetryEvent`.
 */
export function startAnalytics(): ((signal: Signal) => void) | null {
  try {
    posthog.init(PROJECT_KEY, {
      api_host: API_HOST,
      defaults: '2026-08-29',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      disable_session_recording: true,
      // Человек появляется только со входом в облако (§6). До него игрок —
      // анонимный distinct_id, и заводить под него карточку не за чем:
      // уникальных игроков считает сам distinct_id.
      person_profiles: 'identified_only',
    });
    live = true;
  } catch {
    return null;
  }

  return (signal: Signal): void => {
    try {
      const { t, at, ...rest } = signal;
      posthog.capture(t, rest, { timestamp: new Date(at * 1000) });
    } catch {
      /* см. заголовок файла */
    }
  };
}

/**
 * Связать события с вошедшим в облако (§6). До этого у игрока анонимный
 * distinct_id, после — почта: один и тот же человек с телефона и с ноутбука
 * должен быть одним человеком, иначе «уходят домой ли слишком рано»
 * считается по устройствам, а спрашивалось про людей.
 */
export function analyticsIdentify(email: string): void {
  if (!live) return;
  try {
    posthog.identify(email, { email });
  } catch {
    /* см. заголовок файла */
  }
}
