import type { CampState } from '../sim/camp';
import {
  HUNT_SECONDS,
  HUNT_UNLOCK_FOXES,
  RESIDENT_ORDER,
  RESIDENT_ORDERS,
  RESIDENT_SCHEDULE_ORDER,
  RESIDENT_SCHEDULES,
  foxesCaught,
  hasRoof,
  huntBlock,
  residentStateAt,
  scheduleOf,
} from '../sim/residents';
import type { ResidentOrder, ResidentScheduleId } from '../sim/residents';
import { formatDuration } from '../core/clock';
import { avatarSvg } from './avatar';

export interface ResidentManagerCallbacks {
  onWork(index: number, order: ResidentOrder): void;
  onSchedule(index: number, schedule: ResidentScheduleId): void;
  onHunt(index: number): void;
  onRecall(index: number): void;
}

const time = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
const slots = (list: readonly (readonly [number, number])[]): string =>
  list.map(([from, to]) => `${time(from)}–${time(to)}`).join(', ');

/** Полноэкранный диспетчер жителей: один список отвечает на «кто, где и когда». */
export class ResidentManager {
  private readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly list: HTMLElement;
  private camp: CampState | null = null;
  private now = 0;
  private paintedAt = -1;

  constructor(parent: HTMLElement, private readonly cb: ResidentManagerCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'resident-manager';
    this.root.innerHTML = `
      <div class="panel rm-page">
        <div class="rm-head"><span><b>Жители и задания</b><small id="rm-progress"></small></span>
          <button id="rm-close" aria-label="Закрыть">Закрыть</button></div>
        <p class="dim rm-help">Сон и еда занимают своё время. Постоянная работа выполняется только в рабочие окна. Охота — отдельное поручение на ${formatDuration(HUNT_SECONDS)}; отзыв возвращает человека без добычи.</p>
        <div id="rm-list" class="rm-list"></div>
      </div>`;
    this.progress = this.root.querySelector('#rm-progress')!;
    this.list = this.root.querySelector('#rm-list')!;
    this.root.querySelector('#rm-close')!.addEventListener('click', () => this.hide());
    parent.appendChild(this.root);
    this.hide();
  }

  get visible(): boolean {
    return this.root.classList.contains('on');
  }

  show(camp: CampState, now: number): void {
    this.root.classList.add('on');
    this.sync(camp, now, true);
  }

  hide(): void {
    this.root.classList.remove('on');
  }

  sync(camp: CampState, now: number, force = false): void {
    this.camp = camp;
    this.now = now;
    if (!this.visible) return;
    const minute = Math.floor(now / 60);
    if (!force && minute === this.paintedAt) return;
    this.paintedAt = minute;
    const caught = foxesCaught(camp);
    this.progress.textContent = caught >= HUNT_UNLOCK_FOXES
      ? `Охота открыта · поймано лис: ${caught}`
      : `Охота откроется после ${HUNT_UNLOCK_FOXES} лис · ${caught}/${HUNT_UNLOCK_FOXES}`;
    if (camp.residents.length === 0) {
      this.list.innerHTML = '<p class="dim">В лагере пока нет поселенцев</p>';
      return;
    }
    this.list.replaceChildren(...camp.residents.map((_, index) => this.row(index)));
  }

  private row(index: number): HTMLElement {
    const camp = this.camp!;
    const r = camp.residents[index]!;
    const row = document.createElement('article');
    row.className = 'card rm-person';

    const identity = document.createElement('div');
    identity.className = 'rm-id';
    const face = document.createElement('span');
    face.className = 'face';
    face.innerHTML = avatarSvg(r.look, r.seed);
    const who = document.createElement('span');
    const state = hasRoof(camp, index) ? residentStateAt(r, this.now) : 'без крыши';
    who.innerHTML = `<b></b><small class="${hasRoof(camp, index) ? 'good' : 'dim'}"></small>`;
    who.querySelector('b')!.textContent = r.name;
    who.querySelector('small')!.textContent = state;
    identity.append(face, who);

    const schedule = document.createElement('label');
    schedule.className = 'rm-schedule';
    schedule.append('Расписание ');
    const select = document.createElement('select');
    for (const id of RESIDENT_SCHEDULE_ORDER) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = RESIDENT_SCHEDULES[id].name;
      option.selected = id === scheduleOf(r);
      select.append(option);
    }
    select.addEventListener('change', () => this.cb.onSchedule(index, select.value as ResidentScheduleId));
    schedule.append(select);
    const plan = RESIDENT_SCHEDULES[scheduleOf(r)];
    const timeline = document.createElement('small');
    timeline.className = 'dim rm-timeline';
    timeline.textContent = `Сон ${slots([plan.sleep])} · еда ${slots(plan.meals)} · работа ${slots(plan.work)}`;

    const jobs = document.createElement('div');
    jobs.className = 'rm-jobs';
    for (const order of RESIDENT_ORDERS) {
      const button = document.createElement('button');
      button.textContent = RESIDENT_ORDER[order];
      button.disabled = r.hunt !== undefined || (order === 'отдых' ? r.rest : !r.rest && r.answer === order);
      button.addEventListener('click', () => this.cb.onWork(index, order));
      jobs.append(button);
    }

    const hunt = document.createElement('button');
    hunt.className = r.hunt === undefined ? 'rm-hunt' : 'rm-recall';
    if (r.hunt !== undefined) {
      hunt.textContent = `Отозвать · без награды`;
      hunt.addEventListener('click', () => this.cb.onRecall(index));
    } else {
      const block = huntBlock(camp, index);
      hunt.textContent = `Отправить на охоту · ${formatDuration(HUNT_SECONDS)}`;
      hunt.disabled = block !== 'ok';
      hunt.title = block === 'locked'
        ? `Нужно поймать ${HUNT_UNLOCK_FOXES} лис`
        : block === 'roof' ? 'Сначала нужна крыша' : '';
      hunt.addEventListener('click', () => this.cb.onHunt(index));
    }

    row.append(identity, schedule, timeline, jobs, hunt);
    return row;
  }
}
