/**
 * Знакомство у прогалины (`sim/settler.ts`).
 *
 * **Не окно.** Панель стоит внизу, как приглашение разбить лагерь (§16.1)
 * и как лавка торговца (§13.5), и по той же причине: разговор случается
 * там, где игрок стоит, а не на отдельном экране поверх него. Кнопки
 * «закрыть» нет — отойти можно в любой момент, и разговор гаснет сам.
 *
 * **Реплика — одна строка и не длиннее.** Раскадровка запрещает окна
 * с «Понятно» на всём обучении, и абзац с кнопкой — то же окно, только
 * без рамки. Кадров четыре, тапов столько же.
 *
 * **Поле открывается заполненным.** Это единственная клавиатура в игре,
 * и появляться она обязана уже с ответом: кто не хочет печатать, принимает
 * подставленное имя тапом и не печатает ни буквы. Форма от этого не
 * возникает — возникает согласие.
 */
import type { CastleGuest, GuestMeet } from '../sim/castleGuest';
import { termLine } from '../sim/castleGuest';
import type { GuestOrigin, GuestSeek, GuestTerm } from '../sim/castleGuest';
import { MAX_NAME, SELF_ANSWERS, giftLine, giftOf } from '../sim/settler';
import type { MeetState, SelfAnswer, Settler } from '../sim/settler';

import type { HireBlock, WoodsmanPost, WoodsmanTalk } from '../sim/woodsman';
import { avatarSvg } from './avatar';
import { gameMessage, gameText, setGameText, type GameMessageValues } from '../i18n/game';
import type { GameMessage } from '../i18n/gameMessages';
import type { CampState } from '../sim/camp';
import type { SupplyRoute } from '../sim/roadStory';
import { bridgeDecisionBlock } from '../sim/roadBridge';

const selfCopy: Record<SelfAnswer, { label: GameMessage; hint: GameMessage }> = {
  строим: {
    label: gameMessage('Строим лагерь', 'We are building a camp'),
    hint: gameMessage('Под крышей гость будет рубить дерево и пополнять кладовую', 'With shelter, the guest will gather wood for storage'),
  },
  ходим: {
    label: gameMessage('Ходим в вылазки', 'We go on raids'),
    hint: gameMessage('Под крышей гость будет добывать камень и пополнять кладовую', 'With shelter, the guest will gather stone for storage'),
  },
};

const guestFromCopy: Record<GuestOrigin, GameMessage> = {
  хутор: gameMessage('— С хутора за лесом. Хутора больше нет, вот и скитаюсь.', '— From the farmstead beyond the woods. It is gone now, so I wander.'),
  застава: gameMessage('— Со сторожевой заставы. Смена кончилась, а возвращаться некуда.', '— From the watch post. My shift ended, but I have nowhere to return.'),
  обоз: gameMessage('— Шёл с обозом. Обоз ушёл дальше, а я остался.', '— I traveled with a caravan. It moved on; I stayed behind.'),
  берег: gameMessage('— С берега за холмами. Вода поднялась выше крыши.', '— From the shore beyond the hills. The water rose above our roof.'),
};
const guestSeekCopy: Record<GuestSeek, GameMessage> = {
  дело: gameMessage('— Ищу место, где строят. Руки помнят дерево.', '— I seek a place where people build. My hands know timber.'),
  дорога: gameMessage('— Ищу спуск под землю. Камень — работа мне знакомая.', '— I seek a way underground. I know how to work stone.'),
};
const guestTermCopy: Record<GuestTerm, GameMessage> = {
  даром: gameMessage('— Ничего не возьму. Место у огня — и по рукам.', '— I ask for nothing. A place by the fire, and we have a deal.'),
  долг: gameMessage('— Я задолжал страже. Погасишь долг камнем — пойду.', '— I owe the guard. Pay my debt in stone, and I will come.'),
  родня: gameMessage('— Родным надо собраться в дорогу. Дашь дерева — я с тобой.', '— My family needs supplies for the road. Give them timber, and I am with you.'),
  изба: gameMessage('— Хватит с меня палаток. Встанет изба — перееду.', '— I have had enough of tents. Build a house and I will move in.'),
};

export interface MeetPanelCallbacks {
  /** Игрок принял имя — своё или подставленное. */
  onName(name: string): void;
  onAnswer(answer: SelfAnswer): void;
  /** Кадр без выбора: игрок просто идёт дальше по разговору. */
  onAdvance(): void;
  onInvite(): void;
  /** Выживший у пропавшего обоза — отдельная глава, но та же панель места. */
  onRoadInvite?(): void;
  /** Кто будет содержать старый мост после разговора с артелью. */
  onBridgeDecision?(route: SupplyRoute): void;
}

/** Почему лесника не нанять (`sim/woodsman.ts`): слова причины — в панели. */
const HIRE_REASON_MESSAGE = {
  coins: gameMessage('Монет на уговор не хватает', 'Not enough coins for the deal'),
} as const;

export class MeetPanel {
  private readonly root: HTMLElement;
  /**
   * Лицо собеседника (`ui/avatar.ts`). Выводится из сида поселенца — того же,
   * с которым он войдёт в лагерь и встанет в веер: человек ходит по игре
   * с одним лицом, иначе лицо ничего не значит.
   */
  private readonly face: HTMLElement;
  private readonly line: HTMLElement;
  private readonly field: HTMLInputElement;
  private readonly goods: HTMLElement;
  private readonly buttons: HTMLElement;

  constructor(parent: HTMLElement, private readonly cb: MeetPanelCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'meet';
    this.root.style.display = 'none';

    this.face = document.createElement('div');
    this.face.className = 'face';

    this.line = document.createElement('p');
    this.line.className = 'panel say';

    this.field = document.createElement('input');
    this.field.type = 'text';
    this.field.maxLength = MAX_NAME;
    this.field.autocomplete = 'off';
    this.field.spellcheck = false;
    this.field.style.display = 'none';
    // Enter принимает имя ровно так же, как кнопка: на клавиатуре телефона
    // «готово» стоит под большим пальцем, и заставлять после него целиться
    // в кнопку значило бы требовать два жеста там, где игрок сделал один.
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.cb.onName(this.field.value);
    });

    this.goods = document.createElement('p');
    this.goods.className = 'panel goods';
    this.goods.style.display = 'none';

    this.buttons = document.createElement('div');
    this.buttons.className = 'acts';

    this.root.append(this.face, this.line, this.field, this.goods, this.buttons);
    parent.appendChild(this.root);
  }

  /**
   * Перерисовать под шаг разговора. Панель не держит своего состояния:
   * шаг живёт в симуляции, а здесь остаётся то, что из него видно.
   */
  show(settler: Settler, state: MeetState): void {
    this.root.style.display = state.step === 'кончено' ? 'none' : 'flex';
    if (state.step === 'кончено') return;

    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'none';
    // Лицо рисуется на смену человека, а не на каждый кадр разговора:
    // разметка та же, и перекладывать её четыре раза подряд незачем.
    const face = `${settler.look}/${settler.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg(settler.look, settler.seed);
    }

    if (state.step === 'он') {
      setGameText(this.line, gameMessage('— Я {name}.', '— I’m {name}.'), { name: settler.name });
      this.act(gameMessage('Назваться', 'Introduce yourself'), () => this.cb.onAdvance());
      return;
    }

    if (state.step === 'ты') {
      setGameText(this.line, gameMessage('— А тебя как звать?', '— And what should I call you?'));
      this.field.style.display = 'block';
      // Значение ставится только на входе в кадр: перетирать его на каждой
      // перерисовке значило бы стирать то, что игрок печатает.
      if (this.field.dataset.step !== 'ты') {
        this.field.value = state.heroName;
        this.field.dataset.step = 'ты';
      }
      this.act(gameMessage('Так и звать', 'That’s right'), () => this.cb.onName(this.field.value));
      return;
    }

    if (state.step === 'вопрос') {
      this.field.dataset.step = '';
      setGameText(this.line, gameMessage('— {name}. А чем у вас в лагере промышляют?', '— {name}. What keeps your camp going?'), { name: state.heroName });
      for (const answer of SELF_ANSWERS) {
        this.act(selfCopy[answer].label, () => this.cb.onAnswer(answer), selfCopy[answer].hint);
      }
      return;
    }

    const gift = giftOf(state);
    setGameText(this.line, gift === null
      ? gameMessage('— Возьми, что есть.', '— Take what I have.')
      : gameMessage('— Возьми, что осталось.', '— Take what I had left.'));
    // Дар отдельной строкой, а не внутри реплики: это перечень с числами,
    // и в кавычках прямой речи он читался бы репликой, которую человек
    // произносит вслух.
    this.goods.textContent = gift === null ? '' : giftLine(gift);
    this.goods.style.display = gift === null ? 'none' : 'block';
    this.act(gameMessage('Позвать с собой', 'Invite along'), () => this.cb.onInvite());
  }

  /**
   * Разговор с гостем у стен замка (`sim/castleGuest.ts`). Панель та же —
   * разговор случается там, где игрок стоит, и по той же причине без кнопки
   * «закрыть»: отойти можно в любой момент. Кадра три, тапов столько же;
   * поля с именем нет — гость не спрашивает, как звать: он у чужих стен,
   * и зовут здесь его.
   */
  showGuest(guest: CastleGuest, state: GuestMeet): void {
    this.root.style.display = state.step === 'кончено' ? 'none' : 'flex';
    if (state.step === 'кончено') return;

    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'none';
    const face = `${guest.who.look}/${guest.who.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg(guest.who.look, guest.who.seed);
    }

    if (state.step === 'кто') {
      setGameText(this.line, gameMessage('— Я {name}. Жду у огня попутчиков.', '— I’m {name}. Waiting by the fire for someone headed my way.'), { name: guest.who.name });
      this.act(gameMessage('Спросить, откуда', 'Ask where they are from'), () => this.cb.onAdvance());
      return;
    }

    if (state.step === 'откуда') {
      setGameText(this.line, guestFromCopy[guest.origin]);
      this.act(gameMessage('Спросить, что ищет', 'Ask what they seek'), () => this.cb.onAdvance());
      return;
    }

    // Цену гость называет в ответ на приглашение (`GuestStep`): кнопка
    // «Позвать» открывает уговор, а не заключает его.
    if (state.step === 'дело') {
      setGameText(this.line, guestSeekCopy[guest.seek]);
      this.act(gameMessage('Позвать в лагерь', 'Invite to camp'), () => this.cb.onAdvance());
      return;
    }

    setGameText(this.line, guestTermCopy[guest.term]);
    // Цена отдельной строкой, как дар знакомства: перечень с числами
    // в кавычках прямой речи читался бы репликой.
    const cost = termLine(guest.term);
    this.goods.textContent = cost;
    this.goods.style.display = cost === '' ? 'none' : 'block';
    this.act(
      gameMessage('По рукам', 'Deal'),
      () => this.cb.onInvite(),
      gameMessage('Палатку и костёр заберёт с собой, место в лагере выберет сам', 'They will bring their tent and campfire and choose a place in camp'),
    );
  }

  /**
   * Выживший у обоза. Разговор намеренно один кадр: игрок уже умеет звать
   * людей в лагерь, а здесь важна причина — дорогу перекрыли люди минотавра.
   * Отдельная биография превратила бы находку в ещё одно знакомство вместо
   * продолжения хозяйственной проблемы.
   */
  showRoadSurvivor(who: Settler): void {
    this.root.style.display = 'flex';
    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'none';
    const face = `${who.look}/${who.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg(who.look, who.seed);
    }
    setGameText(this.line, gameMessage(
      '— Я {name}. Железо забрали у развилки. Сказали: дорога теперь принадлежит минотавру.',
      '— I’m {name}. They took the iron at the fork. Said the road belongs to the minotaur now.',
    ), { name: who.name });
    this.act(
      gameMessage('Идём в лагерь', 'Come to camp'),
      () => this.cb.onRoadInvite?.(),
      gameMessage('В лагере понадобится место под крышей', 'They will need shelter at camp'),
    );
  }

  /**
   * Бригадир у старой заставы. Три решения меняют хозяйство дороги, поэтому
   * цена названа на самих кнопках, а недоступный вариант гаснет заранее.
   */
  showBridgeCrew(who: Settler, camp: CampState): void {
    this.root.style.display = 'flex';
    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'block';
    const face = `${who.look}/${who.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg(who.look, who.seed);
    }
    setGameText(this.line, gameMessage(
      '— Бригадир {name}. Торговец перестал платить за мост, и недостающее артель удержала из обоза. Без досок переправа встанет.',
      '— Foreman {name}. The trader stopped paying for the bridge, so the crew held back the missing cargo. Without timber, the crossing will close.',
    ), { name: who.name });
    setGameText(this.goods, gameMessage(
      'В лагере: дерево {wood} · монеты {coins}',
      'In camp: wood {wood} · coins {coins}',
    ), { wood: camp.resources.wood, coins: camp.coins ?? 0 });

    const workBlock = bridgeDecisionBlock(camp, 'work');
    const work = this.act(
      gameMessage('Снабжать артель · 10 дерева', 'Supply the crew · 10 wood'),
      () => this.cb.onBridgeDecision?.('work'),
      workBlock === 'ok'
        ? gameMessage('Артель чинит мост, лагерь помогает материалами', 'The crew repairs the bridge; the camp provides materials')
        : gameMessage('Не хватает дерева', 'Not enough wood'),
    );
    work.disabled = workBlock !== 'ok';

    const tradeBlock = bridgeDecisionBlock(camp, 'trade');
    const trade = this.act(
      gameMessage('Признать дорожный сбор · 5 монет', 'Recognize the road toll · 5 coins'),
      () => this.cb.onBridgeDecision?.('trade'),
      tradeBlock === 'ok'
        ? gameMessage('Сбор становится платой за постоянное содержание', 'The toll becomes payment for regular upkeep')
        : gameMessage('Не хватает монет', 'Not enough coins'),
    );
    trade.disabled = tradeBlock !== 'ok';

    this.act(
      gameMessage('Поставить свою охрану', 'Station your own guards'),
      () => this.cb.onBridgeDecision?.('force'),
      gameMessage('Лагерь отвечает за порядок у переправы', 'The camp takes responsibility for security at the crossing'),
    );
  }

  /**
   * Наём лесника у стен замка (`sim/woodsman.ts`, §6.1.6.3). Панель та же,
   * что у знакомства и у гостя, и по той же причине без кнопки «закрыть»:
   * отойти можно в любой момент. Кадра два, тапов столько же.
   *
   * Лицо рисуется ремеслом, а не тем, с чем человек пришёл: у поста стоит
   * лесник, и в кружке он обязан быть лесником — тем же, каким войдёт
   * в лагерь (`residentLook`).
   */
  showWoodsman(post: WoodsmanPost, state: WoodsmanTalk, price: number, block: HireBlock): void {
    this.root.style.display = state.step === 'кончено' ? 'none' : 'flex';
    if (state.step === 'кончено') return;

    this.buttons.replaceChildren();
    this.field.style.display = 'none';
    this.goods.style.display = 'none';
    const face = `лесник/${post.who.seed}`;
    if (this.face.dataset['who'] !== face) {
      this.face.dataset['who'] = face;
      this.face.innerHTML = avatarSvg('лесник', post.who.seed);
    }

    if (state.step === 'кто') {
      setGameText(
        this.line,
        gameMessage('— Я {name}. Лес мой, топор мой.', '— I’m {name}. My forest, my axe.'),
        { name: post.who.name },
      );
      this.act(gameMessage('Спросить о цене', 'Ask about the price'), () => this.cb.onAdvance());
      return;
    }

    setGameText(this.line, gameMessage(
      '— Найми меня — буду валить для тебя лес. Кормить будешь ты.',
      '— Hire me and I will fell timber for you. You provide the food.',
    ));
    // Цена и то, чего не хватает, — одной строкой: игрок должен видеть
    // и сколько просят, и почему нельзя, а не гадать по погасшей кнопке.
    if (block === 'ok') {
      setGameText(this.goods, gameMessage('Плата за наём: {price} монет', 'Hiring fee: {price} coins'), { price });
    } else {
      setGameText(
        this.goods,
        gameMessage('Плата за наём: {price} монет · {reason}', 'Hiring fee: {price} coins · {reason}'),
        { price, reason: gameText(HIRE_REASON_MESSAGE[block]) },
      );
    }
    this.goods.style.display = 'block';
    const hire = this.act(
      gameMessage('Нанять', 'Hire'),
      () => this.cb.onInvite(),
      block === 'ok'
        ? gameMessage(
            'Рубит дерево вдвое быстрее; ест как все и работает, пока есть крыша',
            'Gathers wood twice as fast; eats like everyone else and works while sheltered',
          )
        : gameMessage('Монет не хватает — возвращайся с платой', 'Not enough coins — return when you can pay'),
    );
    // Кнопка гаснет, а не отказывает нажатием: цена названа рядом, и жать
    // на «нанять» с пустым кошельком незачем.
    hire.disabled = block !== 'ok';
  }

  /** Фокус в поле — отдельным вызовом: телефон открывает клавиатуру только
   *  по жесту игрока, и дёргать её на каждой перерисовке нельзя. */
  focusName(): void {
    this.field.focus();
    this.field.select();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.field.dataset.step = '';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  private act(
    label: GameMessage,
    onClick: () => void,
    hint?: GameMessage,
    values?: GameMessageValues,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    setGameText(button, label, values);
    // Пояснение внутри кнопки, а не рядом: выбор и его цена — одно касание.
    if (hint !== undefined) {
      const sub = document.createElement('small');
      setGameText(sub, hint, values);
      button.append(sub);
    }
    button.addEventListener('click', onClick);
    this.buttons.append(button);
    return button;
  }
}
