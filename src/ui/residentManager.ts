import type { CampState } from '../sim/camp';
import {
  HUNT_SECONDS,
  HUNT_UNLOCK_FOXES,
  RESIDENT_ORDERS,
  RESIDENT_SCHEDULE_ORDER,
  RESIDENT_SCHEDULES,
  foxesCaught,
  hasRoof,
  huntBlock,
  residentLook,
  residentPhaseAt,
  scheduleOf,
} from '../sim/residents';
import type { ResidentOrder, ResidentScheduleId } from '../sim/residents';
import { avatarSvg } from './avatar';
import { gameDuration, gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import { residentJobMessage, residentOrderMessage, residentScheduleMessage } from '../i18n/gameData';
import residentsEmptyArt from '../../assets/ui/residents-empty.jpg?url';

export interface ResidentManagerCallbacks {
  onWork(index: number, order: ResidentOrder): void;
  onSchedule(index: number, schedule: ResidentScheduleId): void;
  onHunt(index: number): void;
  onRecall(index: number): void;
}

const time = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
const slots = (list: readonly (readonly [number, number])[]): string =>
  list.map(([from, to]) => `${time(from)}–${time(to)}`).join(', ');

type ResidentIcon = 'clock' | 'orders' | 'hunt' | 'строим' | 'ходим' | 'кормим' | 'отдых';

const residentIcon = (icon: ResidentIcon): string => {
  const body: Record<ResidentIcon, string> = {
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    orders: '<path d="M5 5h14v14H5zM8 9h8M8 13h5"/><path d="M8 3v4M16 3v4"/>',
    hunt: '<path d="M5 18L18 5M13 5h5v5"/><path d="M5 13v5h5"/>',
    строим: '<path d="M4 8h16v5H4zM6 13v5M18 13v5"/><path d="M8 8l8-4"/>',
    ходим: '<path d="M4 17l5-9 4 5 3-4 4 8z"/>',
    кормим: '<path d="M5 10h14v2a7 7 0 0 1-14 0z"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/>',
    отдых: '<path d="M5 7v11M5 13h14v5M8 13V9h6a4 4 0 0 1 4 4"/>',
  };
  return `<svg class="rm-icon" viewBox="0 0 24 24" aria-hidden="true">${body[icon]}</svg>`;
};

const inHours = (hour: number, ranges: readonly (readonly [number, number])[]): boolean =>
  ranges.some(([from, to]) => from <= to ? hour >= from && hour < to : hour >= from || hour < to);

/** Полноэкранный диспетчер жителей: один список отвечает на «кто, где и когда». */
export class ResidentManager {
  private readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressValue: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly list: HTMLElement;
  private camp: CampState | null = null;
  private now = 0;
  private paintedAt = -1;

  constructor(parent: HTMLElement, private readonly cb: ResidentManagerCallbacks) {
    this.root = document.createElement('section');
    this.root.id = 'resident-manager';
    this.root.innerHTML = `
      <div class="panel rm-page">
        <div class="rm-head"><span><small id="rm-kicker"></small><b id="rm-title"></b></span>
          <button id="rm-close"></button></div>
        <div class="rm-overview">
          <section class="rm-unlock card">
            <span class="rm-summary-icon">${residentIcon('hunt')}</span>
            <span class="rm-unlock-copy"><small id="rm-hunt-label"></small><strong id="rm-progress-value"></strong></span>
            <span class="rm-track"><i id="rm-progress-fill"></i></span>
            <small id="rm-progress"></small>
          </section>
          <section class="rm-rule card">
            <span class="rm-summary-icon">${residentIcon('clock')}</span>
            <span><b id="rm-schedule-title"></b><small id="rm-schedule-copy"></small></span>
          </section>
          <section class="rm-rule card">
            <span class="rm-summary-icon">${residentIcon('orders')}</span>
            <span><b id="rm-orders-title"></b><small id="rm-orders-copy"></small></span>
          </section>
        </div>
        <div id="rm-list" class="rm-list"></div>
      </div>`;
    setGameText(this.root.querySelector('#rm-kicker')!, gameMessage('Управление лагерем', 'Camp management'));
    setGameText(this.root.querySelector('#rm-title')!, gameMessage('Жители и задания', 'Residents and assignments'));
    setGameText(this.root.querySelector('#rm-hunt-label')!, gameMessage('Охота', 'Hunting'));
    setGameText(this.root.querySelector('#rm-schedule-title')!, gameMessage('Расписание', 'Schedule'));
    setGameText(this.root.querySelector('#rm-schedule-copy')!, gameMessage('Сон и еда идут автоматически', 'Sleep and meals run automatically'));
    setGameText(this.root.querySelector('#rm-orders-title')!, gameMessage('Приказы', 'Orders'));
    setGameText(this.root.querySelector('#rm-orders-copy')!, gameMessage('Добыча идёт только в часы работы', 'Gathering happens only during work hours'));
    const close = this.root.querySelector<HTMLButtonElement>('#rm-close')!;
    setGameText(close, gameMessage('Закрыть', 'Close'));
    setGameAttribute(close, 'aria-label', gameMessage('Закрыть', 'Close'));
    this.progress = this.root.querySelector('#rm-progress')!;
    this.progressValue = this.root.querySelector('#rm-progress-value')!;
    this.progressFill = this.root.querySelector('#rm-progress-fill')!;
    this.list = this.root.querySelector('#rm-list')!;
    close.addEventListener('click', () => this.hide());
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
    const shown = Math.min(caught, HUNT_UNLOCK_FOXES);
    this.progressValue.textContent = `${shown}/${HUNT_UNLOCK_FOXES}`;
    this.progressFill.style.width = `${(shown / HUNT_UNLOCK_FOXES) * 100}%`;
    this.progress.closest('.rm-unlock')?.classList.toggle('unlocked', caught >= HUNT_UNLOCK_FOXES);
    if (caught >= HUNT_UNLOCK_FOXES) {
      setGameText(this.progress, gameMessage('Открыто · поручение на {time}', 'Unlocked · {time} assignment'), {
        time: gameDuration(HUNT_SECONDS),
      });
    } else {
      setGameText(this.progress, gameMessage('Осталось поймать {count}', 'Catch {count} more'), {
        count: HUNT_UNLOCK_FOXES - shown,
      });
    }
    if (camp.residents.length === 0) {
      const empty = document.createElement('section');
      empty.className = 'rm-empty card';
      const art = document.createElement('img');
      art.src = residentsEmptyArt;
      art.alt = '';
      const copy = document.createElement('div');
      copy.className = 'rm-empty-copy';
      const kicker = document.createElement('small');
      setGameText(kicker, gameMessage('Свободные места', 'Open positions'));
      const title = document.createElement('b');
      setGameText(title, gameMessage('В лагере пока нет поселенцев', 'No residents have joined the camp yet'));
      const lead = document.createElement('p');
      setGameText(lead, gameMessage('Встречайте путников и приглашайте их к костру.', 'Meet travelers and invite them to the campfire.'));
      const roles = document.createElement('div');
      roles.className = 'rm-empty-roles';
      for (const order of RESIDENT_ORDERS.slice(0, 3)) {
        const role = document.createElement('span');
        role.innerHTML = residentIcon(order);
        const label = document.createElement('small');
        setGameText(label, residentOrderMessage[order]);
        role.append(label);
        roles.append(role);
      }
      copy.append(kicker, title, lead, roles);
      empty.append(art, copy);
      this.list.replaceChildren(empty);
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
    face.innerHTML = avatarSvg(residentLook(r), r.seed);
    const who = document.createElement('span');
    const roofed = hasRoof(camp, index);
    who.innerHTML = `<b></b><small class="${hasRoof(camp, index) ? 'good' : 'dim'}"></small>`;
    who.querySelector('b')!.textContent = window.EmberholdLanguage?.translate(r.name) ?? r.name;
    const state = who.querySelector('small')!;
    if (!roofed) {
      setGameText(state, gameMessage('без крыши', 'without shelter'));
    } else if (r.hunt !== undefined) {
      setGameText(state, gameMessage('на охоте · {time}', 'hunting · {time}'), {
        time: gameDuration(Math.max(0, r.hunt.endsAt - this.now)),
      });
    } else if (r.rest) {
      setGameText(state, gameMessage('отдыхает по приказу', 'resting by order'));
    } else {
      const phase = residentPhaseAt(r, this.now);
      if (phase === 'работа') setGameText(state, residentJobMessage[r.answer]);
      else if (phase === 'сон') setGameText(state, gameMessage('спит', 'sleeping'));
      else if (phase === 'еда') setGameText(state, gameMessage('ест', 'eating'));
      else setGameText(state, gameMessage('свободное время', 'off duty'));
    }
    identity.append(face, who);

    const schedule = document.createElement('label');
    schedule.className = 'rm-schedule';
    const scheduleLabel = document.createElement('span');
    setGameText(scheduleLabel, gameMessage('Расписание', 'Schedule'));
    schedule.append(scheduleLabel, ' ');
    const select = document.createElement('select');
    select.className = 'chip';
    for (const id of RESIDENT_SCHEDULE_ORDER) {
      const option = document.createElement('option');
      option.value = id;
      setGameText(option, residentScheduleMessage[id]);
      option.selected = id === scheduleOf(r);
      select.append(option);
    }
    select.addEventListener('change', () => this.cb.onSchedule(index, select.value as ResidentScheduleId));
    schedule.append(select);
    const plan = RESIDENT_SCHEDULES[scheduleOf(r)];
    const timeline = document.createElement('div');
    timeline.className = 'rm-timeline';
    const daybar = document.createElement('span');
    daybar.className = 'rm-daybar';
    for (let hour = 0; hour < 24; hour += 1) {
      const cell = document.createElement('i');
      cell.className = inHours(hour, [plan.sleep])
        ? 'sleep'
        : inHours(hour, plan.meals)
          ? 'meal'
          : inHours(hour, plan.work)
            ? 'work'
            : 'free';
      daybar.append(cell);
    }
    const legend = document.createElement('span');
    legend.className = 'rm-legend';
    const legendParts = [
      ['sleep', gameMessage('Сон {time}', 'Sleep {time}'), slots([plan.sleep])],
      ['meal', gameMessage('Еда {time}', 'Meals {time}'), slots(plan.meals)],
      ['work', gameMessage('Работа {time}', 'Work {time}'), slots(plan.work)],
    ] as const;
    for (const [kind, message, value] of legendParts) {
      const part = document.createElement('small');
      part.className = kind;
      setGameText(part, message, { time: value });
      legend.append(part);
    }
    timeline.append(daybar, legend);

    const jobs = document.createElement('div');
    jobs.className = 'rm-jobs';
    for (const order of RESIDENT_ORDERS) {
      const button = document.createElement('button');
      button.innerHTML = residentIcon(order);
      const buttonLabel = document.createElement('span');
      setGameText(buttonLabel, residentOrderMessage[order]);
      button.append(buttonLabel);
      button.disabled = r.hunt !== undefined || (order === 'отдых' ? r.rest : !r.rest && r.answer === order);
      button.addEventListener('click', () => this.cb.onWork(index, order));
      jobs.append(button);
    }

    const hunt = document.createElement('button');
    hunt.className = r.hunt === undefined ? 'rm-hunt' : 'rm-recall';
    hunt.innerHTML = residentIcon('hunt');
    const huntLabel = document.createElement('span');
    hunt.append(huntLabel);
    if (r.hunt !== undefined) {
      setGameText(huntLabel, gameMessage('Отозвать · без добычи', 'Recall · no reward'));
      hunt.addEventListener('click', () => this.cb.onRecall(index));
    } else {
      const block = huntBlock(camp, index);
      setGameText(huntLabel, gameMessage('Отправить на охоту · {time}', 'Send on a hunt · {time}'), {
        time: gameDuration(HUNT_SECONDS),
      });
      hunt.disabled = block !== 'ok';
      if (block === 'locked') {
        setGameAttribute(hunt, 'title', gameMessage('Сначала поймайте {count} лис', 'Catch {count} foxes first'), {
          count: HUNT_UNLOCK_FOXES,
        });
      } else if (block === 'roof') {
        setGameAttribute(hunt, 'title', gameMessage('Сначала нужна крыша', 'Shelter is required first'));
      }
      hunt.addEventListener('click', () => this.cb.onHunt(index));
    }

    row.append(identity, schedule, timeline, jobs, hunt);
    return row;
  }
}
