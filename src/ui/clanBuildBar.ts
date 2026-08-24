import type { CampState } from '../sim/camp';
import { clearGameAttribute, clearGameText, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import { residentUuid } from '../sim/residents';
import {
  CLAN_BUILD_SECONDS,
  CLAN_BUILDINGS,
  CLAN_BUILDING_ORDER,
  clanCanAfford,
  type ClanBuildingKind,
} from '../sim/clan';

const BUILDING_BUTTON = {
  hall: gameMessages.clanBuildHall,
  store: gameMessages.clanBuildStore,
  workshop: gameMessages.clanBuildWorkshop,
} as const;

const BUILDING_PROGRESS = {
  hall: gameMessages.clanBuildHallProgress,
  store: gameMessages.clanBuildStoreProgress,
  workshop: gameMessages.clanBuildWorkshopProgress,
} as const;

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
  private leaderNote = false;

  constructor(parent: HTMLElement, private readonly cb: ClanBuildBarCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'clan-build';
    this.root.className = 'panel';
    const head = document.createElement('div');
    head.className = 'row cb-head';
    const title = document.createElement('b');
    setGameText(title, gameMessages.clanBuildTitle);
    const hint = document.createElement('span');
    setGameText(hint, gameMessages.clanBuildHint);
    head.append(title, hint);

    const list = document.createElement('div');
    list.className = 'cb-list';
    for (const kind of CLAN_BUILDING_ORDER) {
      const button = document.createElement('button');
      button.className = 'card';
      const building = CLAN_BUILDINGS[kind];
      setGameText(button, BUILDING_BUTTON[kind], building.cost);
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
    if (stock === undefined) {
      clearGameText(this.resources);
      this.resources.textContent = '';
    } else setGameText(this.resources, gameMessages.clanBuildResources, stock);
    for (const [kind, button] of this.buttons) {
      const built = buildings.some((b) => b.kind === kind);
      const current = construction?.kind === kind;
      const affordable = location === undefined || clanCanAfford(location, kind);
      button.disabled = camp.clan.leader !== true || built || construction !== null;
      button.setAttribute('aria-pressed', String(selected === kind));
      const title = built ? gameMessages.clanBuildBuilt
        : current ? gameMessages.clanBuildCurrent
          : construction !== null ? gameMessages.clanBuildFinishCurrent
            : camp.clan.leader !== true ? gameMessages.clanBuildLeaderOnly
              : !affordable ? gameMessages.clanBuildResourcesMissing : null;
      if (title === null) clearGameAttribute(button, 'title');
      else setGameAttribute(button, 'title', title);
    }
    if (construction === null) setGameText(this.progress, gameMessages.clanBuildNone);
    else setGameText(this.progress, BUILDING_PROGRESS[construction.kind], {
      done: Math.floor(construction.work / 60),
      total: CLAN_BUILD_SECONDS / 60,
    });
    this.workers.replaceChildren();
    const workerTitle = document.createElement('b');
    setGameText(workerTitle, gameMessages.clanBuildWorkers);
    this.workers.append(workerTitle);
    const assigned = new Set(location?.builders ?? []);
    for (const resident of camp.residents) {
      const id = residentUuid(resident);
      const button = document.createElement('button');
      const works = assigned.has(id);
      setGameText(button, works ? gameMessages.clanBuildWorkerAssigned : gameMessages.clanBuildWorkerCamp, {
        name: resident.name,
      });
      button.setAttribute('aria-pressed', String(works));
      button.disabled = construction === null || resident.hunt !== undefined;
      const title = resident.hunt !== undefined ? gameMessages.clanBuildWorkerHunting
        : construction === null ? gameMessages.clanBuildStartFirst : null;
      if (title === null) clearGameAttribute(button, 'title');
      else setGameAttribute(button, 'title', title);
      button.addEventListener('click', () => this.cb.onBuilder(id, !works));
      this.workers.append(button);
    }
    if (camp.residents.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'dim';
      setGameText(empty, gameMessages.clanBuildNoResidents);
      this.workers.append(empty);
    }
    if (camp.clan.leader !== true) {
      setGameText(this.note, gameMessages.clanBuildPlaceLeader);
      this.leaderNote = true;
    } else if (this.leaderNote) {
      clearGameText(this.note);
      this.note.textContent = '';
      this.leaderNote = false;
    }
  }

  setReason(reason: string): void {
    clearGameText(this.note);
    this.note.textContent = reason;
    this.leaderNote = false;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
  }
}
