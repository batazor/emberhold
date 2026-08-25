import {
  cloudBillingCheckout,
  cloudBillingEquip,
  cloudBillingStatus,
} from '../core/cloud';
import type { BillingState } from '../core/cloud';
import {
  CLAN_CAMP_ICONS,
  CLAN_CAMP_PACK,
  PERSONAL_CAMP_ICONS,
  PERSONAL_CAMP_PACK,
  clanCampIconUrl,
  cosmeticCollectionAction,
  personalCampIconUrl,
} from '../core/cosmetics';
import type { ClanCampIcon, PersonalCampIcon } from '../core/cosmetics';
import { play } from '../core/audio';
import { gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';

type CosmeticOwner = 'player' | 'clan';
type CosmeticIcon = PersonalCampIcon | ClanCampIcon;

const PERSONAL_NAMES: Readonly<Record<PersonalCampIcon, ReturnType<typeof gameMessage>>> = {
  default: gameMessage('Обычная палатка', 'Standard tent'),
  watchfire: gameMessage('Дозорный костёр', 'Watchfire'),
  horned_tent: gameMessage('Рогатый шатёр', 'Horned tent'),
};

const CLAN_NAMES: Readonly<Record<ClanCampIcon, ReturnType<typeof gameMessage>>> = {
  default: gameMessage('Обычная палатка', 'Standard tent'),
  banner_tower: gameMessage('Башня знамени', 'Banner tower'),
  council_totem: gameMessage('Тотем совета', 'Council totem'),
};

const iconName = (owner: CosmeticOwner, icon: CosmeticIcon) => owner === 'player'
  ? PERSONAL_NAMES[icon as PersonalCampIcon]
  : CLAN_NAMES[icon as ClanCampIcon];

const iconUrl = (owner: CosmeticOwner, icon: CosmeticIcon): string => owner === 'player'
  ? personalCampIconUrl(icon)
  : clanCampIconUrl(icon);

const iconsOf = (owner: CosmeticOwner): readonly CosmeticIcon[] => owner === 'player'
  ? PERSONAL_CAMP_ICONS
  : CLAN_CAMP_ICONS;

const packOf = (owner: CosmeticOwner): string => owner === 'player'
  ? PERSONAL_CAMP_PACK
  : CLAN_CAMP_PACK;

export interface StorePanelCallbacks {
  onState(state: BillingState): void;
}

/**
 * Коллекция знаков открывается из карточки лагеря на карте. Нажатие по знаку
 * только меняет предпросмотр; серверный выбор происходит единственной
 * отдельной кнопкой «Установить». Так получение предмета и изменение мира
 * не могут случиться одним неосторожным тапом.
 */
export class StorePanel {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly preview: HTMLImageElement;
  private readonly previewName: HTMLElement;
  private readonly previewState: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly ownership: HTMLElement;
  private readonly status: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private state: BillingState | null = null;
  private owner: CosmeticOwner = 'player';
  private selected: CosmeticIcon = 'default';
  private newPack: string | null = null;
  private busy = false;

  constructor(parent: HTMLElement, private readonly cb: StorePanelCallbacks) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'store';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2></h2>
        <p class="store-lead"></p>
        <section class="cosmetic-preview">
          <img alt="">
          <div><h3></h3><p></p></div>
        </section>
        <div class="cosmetic-choices"></div>
        <p class="store-ownership"></p>
        <p class="store-status" aria-live="polite"></p>
        <div class="acts">
          <button type="button" data-act="primary"></button>
          <button type="button" class="ghost" data-act="close"></button>
        </div>
        <p class="store-sandbox"></p>
      </div>`;
    parent.appendChild(this.overlay);

    this.title = this.overlay.querySelector('h2') as HTMLElement;
    this.lead = this.overlay.querySelector('.store-lead') as HTMLElement;
    this.preview = this.overlay.querySelector('.cosmetic-preview img') as HTMLImageElement;
    this.previewName = this.overlay.querySelector('.cosmetic-preview h3') as HTMLElement;
    this.previewState = this.overlay.querySelector('.cosmetic-preview p') as HTMLElement;
    this.choices = this.overlay.querySelector('.cosmetic-choices') as HTMLElement;
    this.ownership = this.overlay.querySelector('.store-ownership') as HTMLElement;
    this.status = this.overlay.querySelector('.store-status') as HTMLElement;
    this.primary = this.overlay.querySelector('[data-act="primary"]') as HTMLButtonElement;

    setGameText(this.overlay.querySelector('[data-act="close"]') as HTMLButtonElement, gameMessages.storeClose);
    setGameText(this.overlay.querySelector('.store-sandbox') as HTMLElement,
      gameMessage('Stripe Sandbox · реальные деньги не списываются', 'Stripe Sandbox · no real money is charged'));
    setGameAttribute(this.overlay, 'aria-label', gameMessage('Оформление лагеря', 'Camp appearance'));

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.close();
        return;
      }
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.act === 'close') this.close();
      else if (target.dataset.act === 'primary') void this.primaryAction();
      else if (target.dataset.icon !== undefined) {
        this.selected = target.dataset.icon as CosmeticIcon;
        this.render();
      }
    });

    const params = new URLSearchParams(location.search);
    const returnedSku = params.get('sku');
    if (params.get('checkout') === 'success') {
      params.delete('checkout');
      params.delete('sku');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`);
      this.owner = returnedSku === CLAN_CAMP_PACK ? 'clan' : 'player';
      this.selected = this.owner === 'clan' ? 'banner_tower' : 'watchfire';
      this.newPack = returnedSku;
      this.rebuildChoices();
      this.overlay.classList.add('on');
      setGameText(this.status, gameMessages.storeProcessing);
      void this.waitForEntitlement(returnedSku);
    } else void this.refresh();
  }

  /** Открыть ровно ту коллекцию, из карточки какого лагеря пришёл игрок. */
  open(owner: CosmeticOwner): void {
    this.owner = owner;
    this.selected = owner === 'player'
      ? this.state?.personal.equipped ?? 'default'
      : this.state?.clan?.equipped ?? 'default';
    this.newPack = null;
    this.rebuildChoices();
    this.overlay.classList.add('on');
    this.render();
    void this.refresh();
  }

  private close(): void {
    this.overlay.classList.remove('on');
    this.newPack = null;
  }

  private rebuildChoices(): void {
    this.choices.replaceChildren();
    for (const icon of iconsOf(this.owner)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cosmetic-choice';
      button.dataset.icon = icon;
      const image = document.createElement('img');
      image.src = iconUrl(this.owner, icon);
      image.alt = '';
      const copy = document.createElement('span');
      const name = document.createElement('b');
      setGameText(name, iconName(this.owner, icon));
      const badge = document.createElement('i');
      copy.append(name, badge);
      button.append(image, copy);
      this.choices.appendChild(button);
    }
  }

  async refresh(): Promise<void> {
    const hadState = this.state !== null;
    const state = await cloudBillingStatus();
    this.state = state;
    if (state !== null) {
      this.cb.onState(state);
      if (!hadState && this.overlay.classList.contains('on') && this.newPack === null) {
        this.selected = this.owner === 'player'
          ? state.personal.equipped
          : state.clan?.equipped ?? 'default';
      }
    }
    this.render();
  }

  private render(): void {
    const state = this.state;
    const clan = state?.clan ?? null;
    const signedIn = state !== null;
    const owns = this.owner === 'player' ? state?.personal.owned === true : clan?.owned === true;
    const equipped: CosmeticIcon = this.owner === 'player'
      ? state?.personal.equipped ?? 'default'
      : clan?.equipped ?? 'default';
    const available = this.selected === 'default' || owns;
    const canEquip = this.owner === 'player'
      || clan?.role === 'leader'
      || clan?.role === 'officer';
    const action = cosmeticCollectionAction({
      signedIn,
      clanExists: this.owner === 'player' || clan !== null,
      available,
      equipped: this.selected === equipped,
      canEquip,
    });

    setGameText(this.title, this.owner === 'player'
      ? gameMessage('Знаки лагеря', 'Camp marks')
      : gameMessage('Знаки клана', 'Clan marks'));
    setGameText(this.lead, this.owner === 'player'
      ? gameMessage('Выберите знак, примерьте его и установите отдельным действием.',
        'Choose a mark, preview it, then equip it with a separate action.')
      : gameMessage('Общий знак виден на глобальной карте рядом с лагерем клана.',
        'The shared mark appears beside the clan camp on the global map.'));

    this.preview.src = iconUrl(this.owner, this.selected);
    setGameText(this.previewName, iconName(this.owner, this.selected));
    setGameText(this.previewState, action === 'equipped'
      ? gameMessage('Используется сейчас', 'Currently equipped')
      : available
        ? gameMessage('Доступен в коллекции', 'Available in collection')
        : gameMessage('Закрытый знак · предпросмотр', 'Locked mark · preview'));

    setGameText(this.ownership, this.owner === 'player'
      ? gameMessage('Полученные знаки навсегда остаются на вашем аккаунте.',
        'Unlocked marks remain permanently on your account.')
      : clan === null
        ? gameMessage('Чтобы собирать общие знаки, сначала создайте клан.',
          'Create a clan before collecting shared marks.')
        : gameMessage('Все полученные здесь знаки принадлежат клану «{clan}», а не отдельному игроку.',
          'Every mark unlocked here belongs to clan “{clan}”, not to an individual player.'),
    clan === null ? undefined : { clan: clan.name });

    for (const button of this.choices.querySelectorAll<HTMLButtonElement>('.cosmetic-choice')) {
      const icon = button.dataset.icon as CosmeticIcon;
      const iconAvailable = icon === 'default' || owns;
      const badge = button.querySelector('i') as HTMLElement;
      button.disabled = this.busy;
      button.classList.toggle('selected', icon === this.selected);
      button.classList.toggle('equipped', icon === equipped);
      button.classList.toggle('locked', !iconAvailable);
      button.classList.toggle('new', this.newPack === packOf(this.owner) && icon !== 'default' && iconAvailable);
      button.setAttribute('aria-pressed', String(icon === this.selected));
      setGameText(badge, icon === equipped
        ? gameMessage('Используется', 'Equipped')
        : this.newPack === packOf(this.owner) && icon !== 'default' && iconAvailable
          ? gameMessage('Новое', 'New')
          : iconAvailable
            ? gameMessage('Доступен', 'Available')
            : gameMessage('Закрыт', 'Locked'));
    }

    this.primary.dataset.action = action;
    this.primary.disabled = this.busy || action === 'sign-in' || action === 'create-clan'
      || action === 'equipped' || action === 'role';
    setGameText(this.primary, action === 'sign-in' ? gameMessages.storeSignIn
      : action === 'create-clan' ? gameMessage('Сначала создайте клан', 'Create a clan first')
        : action === 'equipped' ? gameMessage('Используется', 'Equipped')
          : action === 'role' ? gameMessage('Установить может глава или офицер', 'A leader or officer can equip it')
            : action === 'obtain' ? this.owner === 'player'
              ? gameMessage('Получить набор за $2.99', 'Unlock pack for $2.99')
              : gameMessage('Передать набор клану за $4.99', 'Unlock pack for clan for $4.99')
              : gameMessage('Установить', 'Equip'));

    if (this.busy) setGameText(this.status, action === 'obtain'
      ? gameMessages.storeOpening
      : gameMessage('Устанавливаем выбранный знак…', 'Equipping the selected mark…'));
    else if (this.newPack === packOf(this.owner) && owns) setGameText(this.status, gameMessage(
      'Набор добавлен в коллекцию. Текущий знак не изменён — выберите и установите его сами.',
      'The pack was added to the collection. Your current mark was not changed—choose and equip it yourself.',
    ));
    else setGameText(this.status, action === 'obtain'
      ? gameMessage('Откроются оба закрытых знака набора. Их можно примерить до получения.',
        'Both locked marks in the pack will unlock. You can preview them before purchase.')
      : gameMessage('Нажатие по карточке меняет только предпросмотр.',
        'Selecting a card only changes the preview.'));
  }

  private async primaryAction(): Promise<void> {
    const action = this.primary.dataset.action;
    if (action === 'obtain') await this.checkout();
    else if (action === 'equip') await this.equip();
  }

  private async checkout(): Promise<void> {
    if (this.busy) return;
    const sku = packOf(this.owner);
    this.busy = true;
    this.render();
    const state = await cloudBillingCheckout(sku);
    if (state?.url === undefined) {
      this.busy = false;
      this.state = state;
      this.render();
      play('deny');
      return;
    }
    location.assign(state.url);
  }

  private async equip(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const state = await cloudBillingEquip(this.owner, this.selected);
    this.busy = false;
    if (state === null) play('deny');
    else {
      this.state = state;
      this.newPack = null;
      this.cb.onState(state);
      play('build');
    }
    this.render();
  }

  private async waitForEntitlement(sku: string | null): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await cloudBillingStatus();
      if (state !== null) {
        this.state = state;
        this.cb.onState(state);
        const granted = sku === PERSONAL_CAMP_PACK ? state.personal.owned
          : sku === CLAN_CAMP_PACK ? state.clan?.owned === true
            : state.personal.owned || state.clan?.owned === true;
        if (granted) {
          this.busy = false;
          this.render();
          play('build');
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    this.busy = false;
    setGameText(this.status, gameMessages.storePending);
  }
}
