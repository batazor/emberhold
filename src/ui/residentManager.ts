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
        <div class="rm-head"><span><b id="rm-title"></b><small id="rm-progress"></small></span>
          <button id="rm-close"></button></div>
        <p class="dim rm-help" id="rm-help"></p>
        <div id="rm-list" class="rm-list"></div>
      </div>`;
    setGameText(this.root.querySelector('#rm-title')!, gameMessage('Жители и задания', 'Residents and assignments'));
    const close = this.root.querySelector<HTMLButtonElement>('#rm-close')!;
    setGameText(close, gameMessage('Закрыть', 'Close'));
    setGameAttribute(close, 'aria-label', gameMessage('Закрыть', 'Close'));
    setGameText(this.root.querySelector('#rm-help')!, gameMessage(
      'Сон и еда идут по расписанию. Жители работают только в отведённые часы. Охота — отдельное поручение на {time}; если отозвать жителя раньше, добычи не будет.',
      'Sleep and meals follow the schedule. Residents work only during their assigned hours. Hunting is a separate {time} assignment; recalling a resident early forfeits the reward.',
    ), { time: gameDuration(HUNT_SECONDS) });
    this.progress = this.root.querySelector('#rm-progress')!;
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
    if (caught >= HUNT_UNLOCK_FOXES) {
      setGameText(this.progress, gameMessage('Охота открыта · поймано лис: {count}', 'Hunting unlocked · foxes caught: {count}'), {
        count: caught,
      });
    } else {
      setGameText(this.progress, gameMessage('Охота откроется после {needed} лис · {count}/{needed}', 'Hunting unlocks after {needed} foxes · {count}/{needed}'), {
        count: caught,
        needed: HUNT_UNLOCK_FOXES,
      });
    }
    if (camp.residents.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'dim';
      setGameText(empty, gameMessage('В лагере пока нет поселенцев', 'No residents have joined the camp yet'));
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
    const timeline = document.createElement('small');
    timeline.className = 'dim rm-timeline';
    setGameText(timeline, gameMessage('Сон {sleep} · еда {meals} · работа {work}', 'Sleep {sleep} · meals {meals} · work {work}'), {
      sleep: slots([plan.sleep]),
      meals: slots(plan.meals),
      work: slots(plan.work),
    });

    const jobs = document.createElement('div');
    jobs.className = 'rm-jobs';
    for (const order of RESIDENT_ORDERS) {
      const button = document.createElement('button');
      setGameText(button, residentOrderMessage[order]);
      button.disabled = r.hunt !== undefined || (order === 'отдых' ? r.rest : !r.rest && r.answer === order);
      button.addEventListener('click', () => this.cb.onWork(index, order));
      jobs.append(button);
    }

    const hunt = document.createElement('button');
    hunt.className = r.hunt === undefined ? 'rm-hunt' : 'rm-recall';
    if (r.hunt !== undefined) {
      setGameText(hunt, gameMessage('Отозвать · без добычи', 'Recall · no reward'));
      hunt.addEventListener('click', () => this.cb.onRecall(index));
    } else {
      const block = huntBlock(camp, index);
      setGameText(hunt, gameMessage('Отправить на охоту · {time}', 'Send on a hunt · {time}'), {
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
