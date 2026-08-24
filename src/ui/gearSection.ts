import { GEAR_ORDER, OFFHAND, OFFHAND_ORDER, gearItemLine, gearLine } from '../sim/gear';
import type { GearState, Offhand } from '../sim/gear';
import { gearMessage, offhandMessage } from '../i18n/gameData';
import { gameMessage, gameText, setGameAttribute, setGameText } from '../i18n/game';

function gearEffectText(source: string): string {
  if (source === 'не выковано') return gameText(gameMessage('без ковки', 'unforged'));
  const match = /^ур\. (\d+) · (.+)$/.exec(source);
  if (match === null) return window.EmberholdLanguage?.translate(source) ?? source;
  const level = Number(match[1]);
  const effect = match[2]!;
  const value = /([+−-]?\d+(?:\.\d+)?%?)$/.exec(effect)?.[1] ?? '';
  let translated = window.EmberholdLanguage?.translate(effect) ?? effect;
  if (effect.startsWith('Атака ')) translated = gameText(gameMessage('Атака {value}', 'Attack {value}'), { value });
  else if (effect.startsWith('Обзор ')) translated = gameText(gameMessage('Обзор {value}', 'Vision {value}'), { value });
  else if (effect.startsWith('Защита ')) translated = gameText(gameMessage('Защита {value}', 'Defense {value}'), { value });
  else if (effect.startsWith('Рюкзак ')) translated = gameText(gameMessage('Рюкзак {value}', 'Backpack {value}'), { value });
  else if (effect.startsWith('Под угрозой меньше на ')) translated = gameText(gameMessage('Под угрозой меньше на {value}', '{value} less at risk'), { value });
  return gameText(gameMessage('ур. {level} · {effect}', 'lvl {level} · {effect}'), { level, effect: translated });
}

/**
 * Секция снаряжения в разборе человека — одна на карточку героя
 * (`heroCard.ts`) и карточку жильца (`residentCard.ts`). Механика едина,
 * поэтому и код един: два раздела, набранных порознь, разошлись бы молча —
 * тем же путём, каким расходились панели до словаря (`style.css`).
 *
 * Комплект один на лагерь (§14: слот и есть инвентарь), и секция показывает
 * его на любом человеке: в вылазку идёт один, и несёт он именно этот
 * комплект. Жилец в мир не ходит — но смотрит на те же пять слотов и вправе
 * так же переложить левую руку: выбор общий, и рука, которую он двигает, —
 * та же самая.
 *
 * Уровни куются в Мастерской, и секция их не трогает — задаётся здесь
 * только то, что в игре вообще задаётся: левая рука, фонарь против щита
 * (§14.2). Тот же `setOffhand`, что в «Припасах».
 *
 * DOM пересобирается по ключу, а не тиком: карточки красятся каждый кадр,
 * а слоты и рука меняются ковкой и кнопкой.
 */
export class GearSection {
  readonly el: HTMLElement;
  /** Что нарисовано: слоты и рука меняются реже, чем идёт тик. */
  private key = '';

  constructor(private readonly onOffhand: (hand: Offhand) => void) {
    this.el = document.createElement('div');
    this.el.className = 'r-gear';
  }

  sync(gear: GearState | null, offhand: Offhand): void {
    if (gear === null) {
      if (this.key !== '') {
        this.key = '';
        this.el.replaceChildren();
      }
      return;
    }
    const key = `${document.documentElement.lang}:${GEAR_ORDER.map((slot) => gear[slot]).join(',')}:${offhand}`;
    if (key === this.key) return;
    this.key = key;
    const rows: HTMLElement[] = [];
    for (const slot of GEAR_ORDER) {
      // Кованая левая рука — выбор, а не строка: уровень один на слот,
      // предмета в нём два (§14.2).
      if (slot === 'torch' && gear.torch > 0) {
        const row = document.createElement('div');
        row.className = 'r-acts';
        for (const hand of OFFHAND_ORDER) {
          const b = document.createElement('button');
          const def = OFFHAND[hand];
          setGameText(b, offhandMessage[hand]);
          setGameAttribute(b, 'title', gameMessage('{effect}', '{effect}'), {
            effect: gearEffectText(gearItemLine(def, gear.torch)),
          });
          b.disabled = offhand === hand;
          b.addEventListener('click', () => this.onOffhand(hand));
          row.appendChild(b);
        }
        rows.push(row);
        continue;
      }
      const line = document.createElement('div');
      line.className = 'r-meta';
      setGameText(line, gameMessage('{item} · {effect}', '{item} · {effect}'), {
        item: gameText(gearMessage[slot]),
        effect: gearEffectText(gearLine(slot, gear[slot])),
      });
      rows.push(line);
    }
    this.el.replaceChildren(...rows);
  }
}
