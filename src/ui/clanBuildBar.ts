import type { CampState } from '../sim/camp';
import { residentUuid } from '../sim/residents';
import {
  CLAN_BUILD_SECONDS,
  CLAN_BUILDINGS,
  CLAN_BUILDING_ORDER,
  clanCanAfford,
  type ClanBuildingKind,
} from '../sim/clan';

export interface ClanBuildBarCallbacks {
  onSelect(kind: ClanBuildingKind | null): void;
  onBuilder(residentId: string, assigned: boolean): void;
}

/** Панель размещения зданий на общей опушке. */
export class ClanBuildBar {
  private readonly root: HTMLElement;
  private readonly buttons = new Map<ClanBuildingKind, HTMLButtonElement>();
  private readonly note: HTMLElement;
  private readonly resources: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly workers: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: ClanBuildBarCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'clan-build';
    this.root.className = 'panel';
    const head = document.createElement('div');
    head.className = 'row cb-head';
    const title = document.createElement('b');
    title.textContent = 'Стройка клана';
    const hint = document.createElement('span');
    hint.textContent = 'Выберите здание, затем место 2×2';
    head.append(title, hint);

    const list = document.createElement('div');
    list.className = 'cb-list';
    for (const kind of CLAN_BUILDING_ORDER) {
      const button = document.createElement('button');
      button.className = 'card';
      const building = CLAN_BUILDINGS[kind];
      button.textContent = `${building.name} · Д ${building.cost.wood} · К ${building.cost.stone} · Ж ${building.cost.iron}`;
      button.addEventListener('click', () => {
        const selected = button.getAttribute('aria-pressed') === 'true';
        this.cb.onSelect(selected ? null : kind);
      });
      this.buttons.set(kind, button);
      list.append(button);
    }
    this.resources = document.createElement('div');
    this.resources.className = 'cb-resources';
    this.progress = document.createElement('div');
    this.progress.className = 'cb-progress';
    this.workers = document.createElement('div');
    this.workers.className = 'cb-workers';
    this.note = document.createElement('small');
    this.note.className = 'dim';
    this.root.append(head, this.resources, list, this.progress, this.workers, this.note);
    parent.appendChild(this.root);
    this.setVisible(false);
  }

  sync(camp: CampState, selected: ClanBuildingKind | null, visible: boolean): void {
    this.setVisible(visible);
    if (!visible || camp.clan == null) return;
    const location = camp.clan.location;
    const buildings = location?.buildings ?? [];
    const construction = location?.construction ?? null;
    const stock = location?.resources;
    this.resources.textContent = stock === undefined
      ? ''
      : `Склад: дерево ${stock.wood} · камень ${stock.stone} · железо ${stock.iron}`;
    for (const [kind, button] of this.buttons) {
      const built = buildings.some((b) => b.kind === kind);
      const current = construction?.kind === kind;
      const affordable = location === undefined || clanCanAfford(location, kind);
      button.disabled = camp.clan.leader !== true || built || construction !== null;
      button.setAttribute('aria-pressed', String(selected === kind));
      button.title = built ? 'Уже построено'
        : current ? 'Сейчас строится'
          : construction !== null ? 'Сначала закончите текущую стройку'
            : camp.clan.leader !== true ? 'Строить может глава'
              : !affordable ? 'На складе клана не хватает ресурсов' : '';
    }
    this.progress.textContent = construction === null
      ? 'Сейчас стройки нет'
      : `${CLAN_BUILDINGS[construction.kind].name}: ${Math.floor(construction.work / 60)} / ${CLAN_BUILD_SECONDS / 60} мин работы`;
    this.workers.replaceChildren();
    const workerTitle = document.createElement('b');
    workerTitle.textContent = 'Рабочие на стройке';
    this.workers.append(workerTitle);
    const assigned = new Set(location?.builders ?? []);
    for (const resident of camp.residents) {
      const id = residentUuid(resident);
      const button = document.createElement('button');
      const works = assigned.has(id);
      button.textContent = `${resident.name} · ${works ? 'строит' : 'в личном лагере'}`;
      button.setAttribute('aria-pressed', String(works));
      button.disabled = construction === null || resident.hunt !== undefined;
      button.title = resident.hunt !== undefined ? 'Житель сейчас на охоте'
        : construction === null ? 'Сначала начните стройку' : '';
      button.addEventListener('click', () => this.cb.onBuilder(id, !works));
      this.workers.append(button);
    }
    if (camp.residents.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'dim';
      empty.textContent = 'В личном лагере пока нет жителей';
      this.workers.append(empty);
    }
    if (camp.clan.leader !== true) this.note.textContent = 'Размещать здания может только глава клана';
    else if (this.note.textContent === 'Размещать здания может только глава клана') this.note.textContent = '';
  }

  setReason(reason: string): void {
    this.note.textContent = reason;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
