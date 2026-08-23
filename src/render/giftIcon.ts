import { ADVENTURERS_MODELS } from './adventurers.data';
import { DUNGEON_MODELS } from './dungeon.data';
import { RESOURCES_MODELS } from './resources.data';
import {
  ADVENTURERS_PALETTE,
  DUNGEON_PALETTE,
  RESOURCES_PALETTE,
} from './palette';
import { bakedIcon } from './gearIcon';
import type { Part } from './baked';

/**
 * Значки подарка за вход (§29.4).
 *
 * **Карточка дня показывает ту же вещь, которую игрок увидит в лагере.**
 * Бревно, слиток и валун — те самые модели, которыми в сцене лежат ресурсы
 * (`render/resources.ts`), сундук — тот, что встанет на площадку. Рисовать
 * их плоскими значками значило бы завести второй словарь предметов рядом
 * с наборами: подпись «камень» и валун в лагере разошлись бы молча — ровно
 * тем же путём, каким расходились панели до словаря §6.2.
 *
 * Художник общий с значками снаряжения (`gearIcon`): тот же ракурс 45°/30°,
 * тот же свет, тот же перевод цвета. Второй художник означал бы второй свет
 * и второй способ переврать палитру.
 *
 * Кристалла в списке нет, и это не пропуск: подарок его не даёт никогда
 * (§29.1), а значок под несуществующий день — приглашение его завести.
 */
export type GiftIconName = 'дерево' | 'камень' | 'железо' | 'сундук' | 'стрелы';

const SOURCE: Record<GiftIconName, Part> = {
  дерево: { model: RESOURCES_MODELS['Wood_Log_A'], palette: RESOURCES_PALETTE },
  камень: { model: RESOURCES_MODELS['Stone_Chunks_Small'], palette: RESOURCES_PALETTE },
  железо: { model: RESOURCES_MODELS['Iron_Bars_Stack_Small'], palette: RESOURCES_PALETTE },
  сундук: { model: DUNGEON_MODELS['chest'], palette: DUNGEON_PALETTE },
  // Стрела, а не колчан: подарком идут стрелы, и колчан на карточке обещал бы
  // вместимость — вещь из §14.3, которую подарок не трогает.
  стрелы: { model: ADVENTURERS_MODELS['arrow_bow'], palette: ADVENTURERS_PALETTE },
};

/** Значок подарка как `data:`-URL. Пустая строка — нет канваса, нет картинки. */
export const giftIcon = (name: GiftIconName): string => bakedIcon(SOURCE[name], name);
