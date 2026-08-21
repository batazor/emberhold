import { TIER_NAME, TIER_RISK } from '../sim/config';
import { CONSUMABLES } from '../sim/consumables';
import { SKILLS } from '../sim/heroes';
import { atRisk, backLeft } from '../sim/raid';
import type { RaidState } from '../sim/raid';
import type { Reveal } from '../sim/onboarding';

/**
 * §6: UI — DOM поверх канваса, не внутри сцены.
 * §11.2: ставка показывается числом «12 из 19», а не процентом.
 * §11.3: здоровье — полоса очков; правило «раны, а не полоска» отменено там же.
 */
export interface HudCallbacks {
  onRotate(steps: number): void;
  onZoom(delta: number): void;
  onEvacuate(): void;
  onNight(value: number): void;
  /** Отладка, не механика: плотность травы в травинках на клетку. */
  onGrass(perTile: number): void;
  /** §11.7 — умение, раз за вылазку. Одна кнопка: вторую руку она не занимает. */
  onSkill(): void;
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
  private readonly skill: HTMLButtonElement;
  private hintTimer = 0;
  /** Подсказка онбординга. Живёт, пока кадр не сменится, — в отличие от
   *  реплик вылазки, которые гаснут через пару секунд. */
  private sticky = '';

  constructor(parent: HTMLElement, private readonly cb: HudCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="panel top">
        <div class="stats">
          <span class="lbl" data-row="food">Провиант</span>
          <div class="bar" data-row="food"><i id="h-food-bar"></i></div>
          <span class="num" id="h-food" data-row="food">0</span>

          <span class="lbl" data-row="wounds">Здоровье</span>
          <div class="bar" id="h-wounds" data-row="wounds"><i></i></div>
          <span class="num" id="h-wounds-num" data-row="wounds">0</span>

          <span class="lbl" data-row="bag">Рюкзак</span>
          <div class="bar" data-row="bag"><i id="h-bag-bar"></i></div>
          <span class="num" id="h-bag" data-row="bag">0 / 0</span>

          <span class="lbl" data-row="back">Путь назад</span>
          <div class="bar back" data-row="back"><i id="h-back-bar"></i></div>
          <span class="num" id="h-back" data-row="back">0 ш.</span>
        </div>
        <div class="risk" data-row="risk"><span id="h-risk"></span> · <span id="h-tier"></span></div>
      </div>
      <div class="bottom">
        <div id="h-slots" class="raid-slots"></div>
        <div id="h-hint" class="hint"></div>
        <div class="panel night" data-row="controls">
          <span class="lbl">Ночь</span><input id="h-night" type="range" min="0" max="100" value="100">
          <span class="lbl">Трава</span><input id="h-grass" type="range" min="0" max="64" value="24">
        </div>
        <div class="ctl">
          <button data-act="rot-l" data-row="controls">⟲</button>
          <button data-act="rot-r" data-row="controls">⟳</button>
          <button data-act="zoom-in" data-row="controls">＋</button>
          <button data-act="zoom-out" data-row="controls">－</button>
          <button data-act="skill" id="h-skill" data-row="controls">Умение</button>
          <button data-act="evac" data-row="evac">Домой</button>
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
    this.skill = this.q('h-skill') as HTMLButtonElement;
    this.risk = this.q('h-risk');
    this.tier = this.q('h-tier');
    this.hint = this.q('h-hint');
    this.slots = this.q('h-slots');
    this.stats = document.createElement('div');
    this.stats.id = 'stats';
    // Счётчик кадров — часть отладочного управления: в первой вылазке
    // на экране только то, что игрок обязан прочитать.
    this.stats.dataset['row'] = 'controls';
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
        case 'skill': this.cb.onSkill(); break;
      }
    });

    this.q('h-night').addEventListener('input', (e) => {
      this.cb.onNight(Number((e.target as HTMLInputElement).value) / 100);
    });

    this.q('h-grass').addEventListener('input', (e) => {
      this.cb.onGrass(Number((e.target as HTMLInputElement).value));
    });
  }

  private q(id: string): HTMLElement {
    const el = this.root.querySelector(`#${id}`);
    if (el === null) throw new Error(`HUD: нет элемента #${id}`);
    return el as HTMLElement;
  }

  sync(state: RaidState, dt: number): void {
    const tier = state.loc.tier;

    // Кнопка не исчезает после применения, а гаснет: исчезнувшая читается
    // как поломка, а гаснущая — как «уже потратил» (§11.7 — отката нет).
    const skill = SKILLS[state.loadout.skill];
    this.skill.disabled = state.skillUsed || state.status !== 'running';
    this.skill.textContent =
      state.skillLeft > 0
        ? `${skill.name} · ${state.skillLeft.toFixed(0)} с`
        : state.skillUsed
          ? `${skill.name} · использовано`
          : `${skill.name} · 1/1`;
    const foodMax = state.foodMax;
    const food = Math.max(0, state.food);

    // Тревога считается долей, а не штуками. При Кухне ур. 1 (запас 50) это
    // те же пороги 10 и 25, на которых полоса калибровалась, но в прологе
    // запаса всего двадцать — и абсолютные пороги красили полосу тревожной
    // с первого кадра, ещё до того, как игрок сделал шаг.
    const left = food / foodMax;
    this.foodBar.style.width = `${Math.min(100, left * 100)}%`;
    this.foodBar.className = left <= 0.2 ? 'bad' : left <= 0.5 ? 'warn' : 'good';
    this.food.textContent = String(Math.ceil(food));

    // §11.3 — здоровье полосой. Сегментами оно было, пока считалось целыми
    // ранами; на шкале сегмент перестал что-либо значить, а полоса читается
    // тем же взглядом, что и провиант рядом.
    const hp = Math.max(0, state.hero.hp);
    const hpMax = Math.max(1, state.hero.hpMax);
    (this.wounds.firstElementChild as HTMLElement).style.width = `${(hp / hpMax) * 100}%`;
    this.woundsNum.textContent = `${Math.ceil(hp)} / ${hpMax}`;
    // Красным — четверть: та же граница, на которой срабатывает повязка (§21.2),
    // чтобы «плохо» на экране и «плохо» в правилах значили одно.
    this.woundsNum.className = `num${hp <= hpMax / 4 ? ' bad' : ''}`;

    this.bagBar.style.width = `${(state.bagTotal / state.capacity) * 100}%`;
    this.bag.textContent = `${state.bagTotal} / ${state.capacity}`;

    // Путь назад показан долей провианта, которая на него уйдёт: полоса
    // отвечает на вопрос «хватит ли», а число — на «сколько шагов».
    // §11.7 «Тропа» — строка показывает то, во что дорога обходится сейчас,
    // а не сырое расстояние: игрок обязан видеть, за что потратил умение.
    const back = backLeft(state);
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
    // §14.3 — колчан живёт здесь, а не пятой полосой сверху. Верхняя панель
    // держит четыре строки из §11, и пятая превратила бы её в приборную
    // доску; нижняя же означает ровно то же самое — «что я взял с собой,
    // и оно тратится само». Сегментами, а не числом: §11.2 требует, чтобы
    // игрок считал штуки, а здоровье с §11.3 считается полосой и такой
    // поддержки больше не даёт.
    const key = `${state.consumables.join(',')}|${state.fired.join(',')}|${state.arrows}/${state.arrowsMax}`;
    if (key !== this.slotsKey) {
      this.slotsKey = key;
      this.slots.innerHTML = '';
      if (state.arrowsMax > 0) {
        const quiver = document.createElement('span');
        quiver.className = 'raid-slot quiver';
        quiver.innerHTML =
          Array.from({ length: state.arrowsMax }, (_, i) =>
            i < state.arrows ? '<i></i>' : '<i class="spent"></i>').join('');
        this.slots.appendChild(quiver);
      }
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
      if (this.hintTimer <= 0) this.hint.textContent = this.sticky;
    }
  }

  /**
   * Что из панели показано (`onboarding.html`). Полосы не гаснут по ходу
   * онбординга, только зажигаются, поэтому метод вызывается на смене кадра,
   * а не каждый тик.
   */
  setReveal(r: Reveal): void {
    const show = (key: keyof Reveal): void => {
      for (const el of this.root.querySelectorAll(`[data-row="${key}"]`)) {
        (el as HTMLElement).style.display = r[key] ? '' : 'none';
      }
    };
    for (const key of ['food', 'wounds', 'bag', 'back', 'risk', 'evac', 'controls'] as const) {
      show(key);
    }
  }

  /** Единственная строка обучения. Пустая строка снимает подсказку. */
  setHint(text: string): void {
    this.sticky = text;
    if (this.hintTimer <= 0) this.hint.textContent = text;
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'flex' : 'none';
    this.stats.style.visibility = visible ? 'visible' : 'hidden';
  }

  setGrass(perTile: number): void {
    (this.q('h-grass') as HTMLInputElement).value = String(perTile);
  }

  setStats(text: string): void {
    this.stats.textContent = text;
  }
}
