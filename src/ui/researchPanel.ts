import type { CampState } from '../sim/camp';
import {
  RESEARCH,
  RESEARCH_ORDER,
  researchBlock,
  researchCost,
  researchLevel,
  type ResearchBlock,
  type ResearchId,
} from '../sim/research';
import { resourceMessage } from '../i18n/gameData';
import { gameDuration, gameMarkup, gameMessage, gameText, setGameText } from '../i18n/game';

export interface ResearchPanelCallbacks {
  onStart(id: ResearchId): void;
  onClose(): void;
}

const blockMessage = (block: Exclude<ResearchBlock, 'ok'>) => {
  switch (block) {
    case 'archive': return gameMessage('Сначала постройте Архив', 'Build the Archive first');
    case 'row': return gameMessage('Нужен следующий уровень Архива', 'Requires the next Archive level');
    case 'previous': return gameMessage('Сначала изучите предыдущий узел ветки', 'Research the previous branch node first');
    case 'levels': return gameMessage('Изучите больше уровней предыдущих рядов', 'Research more levels in earlier rows');
    case 'busy': return gameMessage('Другое исследование уже идёт', 'Another research is in progress');
    case 'max': return gameMessage('Изучено полностью', 'Fully researched');
    case 'notes': return gameMessage('Не хватает Записей', 'Not enough Records');
    case 'resources': return gameMessage('Не хватает ресурсов', 'Not enough resources');
  }
};

const branchMessage = (id: ResearchId) => {
  switch (RESEARCH[id].branch) {
    case 'household': return gameMessage('Хозяйство', 'Household');
    case 'craft': return gameMessage('Ремесло', 'Craft');
    case 'scouting': return gameMessage('Разведка', 'Scouting');
  }
};

const researchIcon = (id: ResearchId): string => {
  switch (id) {
    case 'crop-rotation': return new URL('../../assets/research-icons/crop-rotation.png', import.meta.url).href;
    case 'road-provisions': return new URL('../../assets/research-icons/road-provisions.png', import.meta.url).href;
    case 'cartography': return new URL('../../assets/research-icons/cartography.png', import.meta.url).href;
    case 'work-orders': return new URL('../../assets/research-icons/work-orders.png', import.meta.url).href;
    case 'leather-packs': return new URL('../../assets/research-icons/leather-packs.png', import.meta.url).href;
    case 'careful-opening': return new URL('../../assets/research-icons/careful-opening.png', import.meta.url).href;
    case 'shelving': return new URL('../../assets/research-icons/shelving.png', import.meta.url).href;
    case 'herbalism': return new URL('../../assets/research-icons/herbalism.png', import.meta.url).href;
    case 'signal-network': return new URL('../../assets/research-icons/signal-network.png', import.meta.url).href;
  }
};

export const researchNameMessage = (id: ResearchId) => {
  switch (id) {
    case 'crop-rotation': return gameMessage('Севооборот', 'Crop rotation');
    case 'road-provisions': return gameMessage('Дорожные припасы', 'Road provisions');
    case 'cartography': return gameMessage('Картография', 'Cartography');
    case 'work-orders': return gameMessage('Рабочие наряды', 'Work orders');
    case 'leather-packs': return gameMessage('Кожаные вьюки', 'Leather packs');
    case 'careful-opening': return gameMessage('Осторожное вскрытие', 'Careful opening');
    case 'shelving': return gameMessage('Полки и опись', 'Shelves and records');
    case 'herbalism': return gameMessage('Травничество', 'Herbalism');
    case 'signal-network': return gameMessage('Сигнальная сеть', 'Signal network');
  }
};

const effectMessage = (id: ResearchId, rank: number) => {
  const index = Math.max(1, Math.min(3, rank));
  switch (id) {
    case 'crop-rotation': return index === 1
      ? gameMessage('Открывается третья грядка', 'Unlocks a third garden bed')
      : index === 2
        ? gameMessage('Открывается четвёртая грядка', 'Unlocks a fourth garden bed')
        : gameMessage('Открываются все шесть грядок', 'Unlocks all six garden beds');
    case 'road-provisions': return index === 1
      ? gameMessage('Провиант в вылазке +3', 'Sortie provisions +3')
      : index === 2
        ? gameMessage('Провиант в вылазке +6', 'Sortie provisions +6')
        : gameMessage('Провиант в вылазке +9', 'Sortie provisions +9');
    case 'cartography': return index === 1
      ? gameMessage('Обзор в вылазке +0,5', 'Sortie scouting +0.5')
      : index === 2
        ? gameMessage('Обзор в вылазке +1', 'Sortie scouting +1')
        : gameMessage('Обзор в вылазке +1,5', 'Sortie scouting +1.5');
    case 'work-orders': return index === 1
      ? gameMessage('Потолок работы жильца +1', 'Resident work cap +1')
      : index === 2
        ? gameMessage('Потолок работы жильца +2', 'Resident work cap +2')
        : gameMessage('Потолок работы жильца +3', 'Resident work cap +3');
    case 'leather-packs': return index === 1
      ? gameMessage('Рюкзак в вылазке +2', 'Sortie bag +2')
      : index === 2
        ? gameMessage('Рюкзак в вылазке +4', 'Sortie bag +4')
        : gameMessage('Рюкзак в вылазке +6', 'Sortie bag +6');
    case 'careful-opening': return index === 1
      ? gameMessage('Контейнер стоит на 1 провиант меньше', 'Containers cost 1 less provision')
      : index === 2
        ? gameMessage('Контейнер стоит на 2 провианта меньше', 'Containers cost 2 less provisions')
        : gameMessage('Контейнер стоит на 3 провианта меньше', 'Containers cost 3 less provisions');
    case 'shelving': return index === 1
      ? gameMessage('Кладовая +10', 'Storage +10')
      : index === 2
        ? gameMessage('Кладовая +20', 'Storage +20')
        : gameMessage('Кладовая +30', 'Storage +30');
    case 'herbalism': return index === 1
      ? gameMessage('Лечение как при Лазарете на уровень выше', 'Healing as with one more Infirmary level')
      : index === 2
        ? gameMessage('Лечение как на два уровня выше', 'Healing as with two more Infirmary levels')
        : gameMessage('Лечение как на три уровня выше', 'Healing as with three more Infirmary levels');
    case 'signal-network': return index === 1
      ? gameMessage('Разведка Башни +0,5', 'Watchtower scouting +0.5')
      : index === 2
        ? gameMessage('Разведка Башни +1', 'Watchtower scouting +1')
        : gameMessage('Разведка Башни +1,5', 'Watchtower scouting +1.5');
  }
};

export class ResearchPanel {
  readonly root: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly current: HTMLElement;
  private readonly cards = new Map<ResearchId, HTMLButtonElement>();
  private last: { camp: CampState; now: number } | null = null;

  constructor(parent: HTMLElement, private readonly cb: ResearchPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'research';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="panel research-panel">
        <div class="row mid research-head">
          <div><small>Архив</small><h2>Развитие лагеря</h2></div>
          <button class="ghost research-close">Закрыть</button>
        </div>
        <div class="card row mid research-summary">
          <b class="research-notes"></b><span class="research-current dim"></span>
        </div>
        <div class="research-tree"></div>
      </div>`;
    parent.appendChild(this.root);
    const notes = this.root.querySelector('.research-notes');
    const current = this.root.querySelector('.research-current');
    const tree = this.root.querySelector('.research-tree');
    const close = this.root.querySelector('.research-close');
    if (!(notes instanceof HTMLElement) || !(current instanceof HTMLElement) ||
        !(tree instanceof HTMLElement) || !(close instanceof HTMLButtonElement)) {
      throw new Error('не собрана панель исследований');
    }
    this.notes = notes;
    this.current = current;
    setGameText(this.root.querySelector('.research-head small')!, gameMessage('Архив', 'Archive'));
    setGameText(this.root.querySelector('.research-head h2')!, gameMessage('Развитие лагеря', 'Camp development'));
    setGameText(close, gameMessage('Закрыть', 'Close'));
    close.addEventListener('click', () => this.hide());

    for (let row = 1; row <= 3; row += 1) {
      const line = document.createElement('section');
      line.className = 'research-row';
      line.innerHTML = '<h3></h3><div class="research-row-grid"></div>';
      setGameText(line.querySelector('h3')!, gameMessage('Ряд {row}', 'Row {row}'), { row });
      const grid = line.querySelector('.research-row-grid')!;
      for (const id of RESEARCH_ORDER.filter((key) => RESEARCH[key].row === row)) {
        const def = RESEARCH[id];
        const button = document.createElement('button');
        button.className = `card research-card branch-${def.branch}`;
        button.dataset['research'] = id;
        button.addEventListener('click', () => {
          if (this.last === null || researchBlock(this.last.camp, id) !== 'ok') return;
          this.cb.onStart(id);
        });
        grid.appendChild(button);
        this.cards.set(id, button);
      }
      tree.appendChild(line);
    }
  }

  show(camp: CampState, now: number): void {
    this.root.hidden = false;
    this.sync(camp, now);
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.cb.onClose();
  }

  sync(camp: CampState, now: number): void {
    this.last = { camp, now };
    setGameText(this.notes, gameMessage('Записи · {count}', 'Records · {count}'), {
      count: camp.research.notes,
    });
    const job = camp.research.job;
    if (job === null) setGameText(this.current, gameMessage('Очередь свободна', 'Queue available'));
    else setGameText(this.current, gameMessage('{name} · ещё {duration}', '{name} · {duration} left'), {
      name: gameText(researchNameMessage(job.id)),
      duration: gameDuration(Math.max(0, job.endsAt - now)),
    });

    for (const id of RESEARCH_ORDER) {
      const button = this.cards.get(id)!;
      const level = researchLevel(camp, id);
      const block = researchBlock(camp, id);
      const next = Math.min(3, level + 1);
      const cost = researchCost(id, next);
      const resource = Object.entries(cost.resources)[0] as [keyof typeof resourceMessage, number] | undefined;
      const price = resource === undefined ? '' : gameText(resourceMessage[resource[0]]);
      button.innerHTML =
        `<img class="research-icon" src="${researchIcon(id)}" alt="">` +
        `<small>${gameMarkup(branchMessage(id))}</small>` +
        `<b>${gameMarkup(researchNameMessage(id))}</b>` +
        `<span>${gameMarkup(gameMessage('ур. {level} / 3', 'Lv. {level} / 3'), { level })}</span>` +
        `<p>${gameMarkup(effectMessage(id, level >= 3 ? 3 : level + 1))}</p>` +
        (level >= 3
          ? `<i>${gameMarkup(blockMessage('max'))}</i>`
          : `<i>${block === 'ok'
            ? gameMarkup(gameMessage('Записи {notes} · {resource} {amount} · {duration}', 'Records {notes} · {resource} {amount} · {duration}'), {
              notes: cost.notes,
              resource: price,
              amount: resource?.[1] ?? 0,
              duration: gameDuration(cost.seconds),
            })
            : gameMarkup(blockMessage(block))}</i>`);
      button.disabled = block !== 'ok';
      button.classList.toggle('done', level >= 3);
      button.classList.toggle('active', job?.id === id);
    }
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
