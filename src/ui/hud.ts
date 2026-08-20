import { HERO_WOUNDS, TIER_NAME, TIER_RISK } from '../sim/config';
import { CONSUMABLES } from '../sim/consumables';
import { atRisk, backSteps } from '../sim/raid';
import type { RaidState } from '../sim/raid';

/**
 * §6: UI — DOM поверх канваса, не внутри сцены.
 * §11.2: ставка показывается числом «12 из 19», а не процентом.
 * §11.3: здоровье — раны, а не полоска.
 */
export interface HudCallbacks {
  onRotate(steps: number): void;
  onZoom(delta: number): void;
  onEvacuate(): void;
  onNight(value: number): void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly food: HTMLElement;
  private readonly foodBar: HTMLElement;
  private readonly back: HTMLElement;
  private readonly backBar: HTMLElement;
  private readonly bag: HTMLElement;
  private readonly bagBar: HTMLElement;
  private readonly wounds: HTMLElement;
  private readonly woundsNum: HTMLElement;
  private readonly risk: HTMLElement;
  private readonly tier: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly slots: HTMLElement;
  private slotsKey = '';
  private readonly stats: HTMLElement;
  private hintTimer = 0;

  constructor(parent: HTMLElement, private readonly cb: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="panel top">
        <div class="stats">
          <span class="lbl">Провиант</span>
          <div class="bar"><i id="h-food-bar"></i></div>
          <span class="num" id="h-food">0</span>

          <span class="lbl">Раны</span>
          <div class="bar segmented" id="h-wounds"></div>
          <span class="num" id="h-wounds-num">0</span>

          <span class="lbl">Рюкзак</span>
          <div class="bar"><i id="h-bag-bar"></i></div>
          <span class="num" id="h-bag">0 / 0</span>

          <span class="lbl">Путь назад</span>
          <div class="bar back"><i id="h-back-bar"></i></div>
          <span class="num" id="h-back">0 ш.</span>
        </div>
        <div class="risk"><span id="h-risk"></span> · <span id="h-tier"></span></div>
      </div>
      <div class="bottom">
        <div id="h-slots" class="raid-slots"></div>
        <div id="h-hint" class="hint"></div>
        <div class="panel night">
          <span class="lbl">Ночь</span><input id="h-night" type="range" min="0" max="100" value="100">
        </div>
        <div class="ctl">
          <button data-act="rot-l">⟲</button>
          <button data-act="rot-r">⟳</button>
          <button data-act="zoom-in">＋</button>
          <button data-act="zoom-out">－</button>
          <button data-act="evac">К эвакуации</button>
        </div>
      </div>`;
    parent.appendChild(this.root);

    this.food = this.q('h-food');
    this.foodBar = this.q('h-food-bar');
    this.back = this.q('h-back');
    this.backBar = this.q('h-back-bar');
    this.bag = this.q('h-bag');
    this.bagBar = this.q('h-bag-bar');
    this.wounds = this.q('h-wounds');
    this.woundsNum = this.q('h-wounds-num');
    this.wounds.innerHTML = Array.from({ length: HERO_WOUNDS }, () => '<i></i>').join('');
    this.risk = this.q('h-risk');
    this.tier = this.q('h-tier');
    this.hint = this.q('h-hint');
    this.slots = this.q('h-slots');
    this.stats = document.createElement('div');
    this.stats.id = 'stats';
    // В потоке над подсказкой, а не поверх панели: панель меняет высоту
    // от длины строк, и абсолютно позиционированный счётчик её перекрывал.
    this.root.querySelector('.bottom')?.prepend(this.stats);

    this.root.addEventListener('click', (e) => {
      const el = e.target;
      if (!(el instanceof HTMLButtonElement)) return;
      switch (el.dataset['act']) {
        case 'rot-l': this.cb.onRotate(-1); break;
        case 'rot-r': this.cb.onRotate(1); break;
        case 'zoom-in': this.cb.onZoom(-4); break;
        case 'zoom-out': this.cb.onZoom(4); break;
        case 'evac': this.cb.onEvacuate(); break;
      }
    });

    this.q('h-night').addEventListener('input', (e) => {
      this.cb.onNight(Number((e.target as HTMLInputElement).value) / 100);
    });
  }

  private q(id: string): HTMLElement {
    const el = this.root.querySelector(`#${id}`);
    if (el === null) throw new Error(`HUD: нет элемента #${id}`);
    return el as HTMLElement;
  }

  sync(state: RaidState, dt: number): void {
    const tier = state.loc.tier;
    const foodMax = state.foodMax;
    const food = Math.max(0, state.food);

    this.foodBar.style.width = `${Math.min(100, (food / foodMax) * 100)}%`;
    this.foodBar.className = food <= 10 ? 'bad' : food <= 25 ? 'warn' : 'good';
    this.food.textContent = String(Math.ceil(food));

    // Раны — сегменты, а не сплошная полоса: §11.3 требует, чтобы каждая
    // потеря читалась мгновенно, а не как сдвиг шкалы.
    const segments = this.wounds.children;
    for (let i = 0; i < segments.length; i++) {
      (segments[i] as HTMLElement).className = i < state.hero.wounds ? 'on' : '';
    }
    this.woundsNum.textContent = `${state.hero.wounds} / ${HERO_WOUNDS}`;
    this.woundsNum.className = `num${state.hero.wounds <= 1 ? ' bad' : ''}`;

    this.bagBar.style.width = `${(state.bagTotal / state.capacity) * 100}%`;
    this.bag.textContent = `${state.bagTotal} / ${state.capacity}`;

    // Путь назад показан долей провианта, которая на него уйдёт: полоса
    // отвечает на вопрос «хватит ли», а число — на «сколько шагов».
    const back = backSteps(state);
    const needed = food > 0 ? Math.min(1, back / food) : 1;
    this.backBar.style.width = `${needed * 100}%`;
    this.backBar.className = needed > 0.9 ? 'bad' : needed > 0.6 ? 'warn' : 'dimbar';
    this.back.textContent = `${back} ш.`;

    this.risk.innerHTML = `Под угрозой <b>${atRisk(state)}</b> из ${state.bagTotal}`;
    this.tier.textContent = `${TIER_NAME[tier]} · ставка ${Math.round(TIER_RISK[tier] * 100)}%`;
    this.tier.className = tier >= 3 ? 'bad' : tier === 2 ? 'warn' : 'dim';

    // §21: слоты молчат. Пока расходник цел, слот тусклый; счётчиков,
    // кулдаунов и подсказок нет — всё мигающее отнимает внимание у двух
    // полос, ради которых панель существует.
    const key = `${state.consumables.join(',')}|${state.fired.join(',')}`;
    if (key !== this.slotsKey) {
      this.slotsKey = key;
      this.slots.innerHTML = '';
      for (const id of state.consumables) {
        const el = document.createElement('span');
        el.className = 'raid-slot';
        el.textContent = CONSUMABLES[id].name;
        this.slots.appendChild(el);
      }
      for (const id of state.fired) {
        const el = document.createElement('span');
        el.className = 'raid-slot spent';
        el.textContent = CONSUMABLES[id].name;
        this.slots.appendChild(el);
      }
    }

    if (state.events.length > 0) {
      this.hint.textContent = state.events[state.events.length - 1]!;
      this.hintTimer = 2.5;
    } else if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.textContent = '';
    }
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    this.stats.style.visibility = visible ? 'visible' : 'hidden';
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }
}
