import { cloudBillingCheckout, cloudBillingEquip, cloudBillingStatus } from '../core/cloud';
import type { BillingState } from '../core/cloud';
import {
  CLAN_CAMP_PACK,
  COSMETIC_CATEGORIES,
  categoriesOf,
  categoryOf,
  cosmeticCollectionAction,
  cosmeticPreviewUrl,
  type CosmeticCategory,
  type CosmeticKind,
  type CosmeticOwner,
  type CosmeticValue,
} from '../core/cosmetics';
import { play } from '../core/audio';
import { gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';
import { openPlatformCheckout, platformKind, platformPrice } from '../core/platform';

const VALUE_NAMES: Readonly<Record<string, ReturnType<typeof gameMessage>>> = {
  default: gameMessage('Обычная палатка', 'Standard tent'),
  watchfire: gameMessage('Дозорный костёр', 'Watchfire'),
  horned_tent: gameMessage('Рогатый шатёр', 'Horned tent'),
  banner_tower: gameMessage('Башня знамени', 'Banner tower'),
  council_totem: gameMessage('Тотем совета', 'Council totem'),
  standard: gameMessage('Обычное пламя', 'Standard flame'),
  ghostfire: gameMessage('Призрачный огонь', 'Ghostfire'),
  witchfire: gameMessage('Ведьмин огонь', 'Witchfire'),
  none: gameMessage('Без набора', 'No set'),
  wayfarer: gameMessage('Стоянка путника', 'Wayfarer camp'),
  sentinel: gameMessage('Дозорный двор', 'Sentinel yard'),
  plain: gameMessage('Без герба', 'No heraldry'),
  raven: gameMessage('Чёрный знак', 'Black sigil'),
  sun: gameMessage('Золотой знак', 'Golden sigil'),
};

const CATEGORY_NAMES: Readonly<Record<CosmeticKind, ReturnType<typeof gameMessage>>> = {
  'personal-icon': gameMessage('Знак', 'Mark'),
  'clan-icon': gameMessage('Знак', 'Mark'),
  fire: gameMessage('Костёр', 'Fire'),
  decor: gameMessage('Декор', 'Decor'),
  heraldry: gameMessage('Геральдика', 'Heraldry'),
};

const equippedOf = (state: BillingState | null, kind: CosmeticKind): CosmeticValue => {
  if (kind === 'personal-icon') return state?.personal.equipped ?? 'default';
  if (kind === 'fire') return state?.personal.fire ?? 'standard';
  if (kind === 'decor') return state?.personal.decor ?? 'none';
  if (kind === 'clan-icon') return state?.clan?.equipped ?? 'default';
  return state?.clan?.heraldry ?? 'plain';
};

const owned = (state: BillingState | null, kind: CosmeticKind): boolean => {
  if (kind === 'personal-icon') return state?.personal.owned === true;
  if (kind === 'fire') return state?.personal.fireOwned === true;
  if (kind === 'decor') return state?.personal.decorOwned === true;
  if (kind === 'clan-icon') return state?.clan?.owned === true;
  return state?.clan?.heraldryOwned === true;
};

const categoryBySku = (sku: string | null): CosmeticCategory | undefined =>
  COSMETIC_CATEGORIES.find((category) => category.sku === sku);

export interface StorePanelCallbacks { onState(state: BillingState): void; }

/** Contextual collection: selecting previews; only the primary button mutates. */
export class StorePanel {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly lead: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly preview: HTMLImageElement;
  private readonly previewName: HTMLElement;
  private readonly previewState: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly ownership: HTMLElement;
  private readonly status: HTMLElement;
  private readonly primary: HTMLButtonElement;
  private state: BillingState | null = null;
  private owner: CosmeticOwner = 'player';
  private kind: CosmeticKind = 'personal-icon';
  private selected: CosmeticValue = 'default';
  private newPack: string | null = null;
  private busy = false;

  constructor(parent: HTMLElement, private readonly cb: StorePanelCallbacks) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'store';
    this.overlay.innerHTML = `<div class="panel"><h2></h2><p class="store-lead"></p>
      <nav class="cosmetic-tabs" aria-label=""></nav>
      <section class="cosmetic-preview"><img alt=""><div><h3></h3><p></p></div></section>
      <div class="cosmetic-choices"></div><p class="store-ownership"></p>
      <p class="store-status" aria-live="polite"></p><div class="acts">
      <button type="button" data-act="primary"></button><button type="button" class="ghost" data-act="close"></button></div>
      <p class="store-sandbox"></p></div>`;
    parent.appendChild(this.overlay);
    this.title = this.overlay.querySelector('h2') as HTMLElement;
    this.lead = this.overlay.querySelector('.store-lead') as HTMLElement;
    this.tabs = this.overlay.querySelector('.cosmetic-tabs') as HTMLElement;
    this.preview = this.overlay.querySelector('.cosmetic-preview img') as HTMLImageElement;
    this.previewName = this.overlay.querySelector('.cosmetic-preview h3') as HTMLElement;
    this.previewState = this.overlay.querySelector('.cosmetic-preview p') as HTMLElement;
    this.choices = this.overlay.querySelector('.cosmetic-choices') as HTMLElement;
    this.ownership = this.overlay.querySelector('.store-ownership') as HTMLElement;
    this.status = this.overlay.querySelector('.store-status') as HTMLElement;
    this.primary = this.overlay.querySelector('[data-act="primary"]') as HTMLButtonElement;
    setGameText(this.overlay.querySelector('[data-act="close"]') as HTMLButtonElement, gameMessages.storeClose);
    const sandbox = this.overlay.querySelector('.store-sandbox') as HTMLElement;
    if (platformKind() === 'telegram') sandbox.hidden = true;
    else setGameText(sandbox,
      gameMessage('Stripe Sandbox · реальные деньги не списываются', 'Stripe Sandbox · no real money is charged'));
    setGameAttribute(this.overlay, 'aria-label', gameMessage('Оформление лагеря', 'Camp appearance'));
    setGameAttribute(this.tabs, 'aria-label', gameMessage('Раздел оформления', 'Appearance category'));

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) return this.close();
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.act === 'close') this.close();
      else if (target.dataset.act === 'primary') void this.primaryAction();
      else if (target.dataset.kind !== undefined) this.selectKind(target.dataset.kind as CosmeticKind);
      else if (target.dataset.value !== undefined) {
        this.selected = target.dataset.value as CosmeticValue;
        this.render();
      }
    });

    const params = new URLSearchParams(location.search);
    const returnedSku = params.get('sku');
    if (params.get('checkout') === 'success') {
      params.delete('checkout'); params.delete('sku');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`);
      const category = categoryBySku(returnedSku) ?? categoryOf(returnedSku === CLAN_CAMP_PACK ? 'clan-icon' : 'personal-icon');
      this.owner = category.owner;
      this.kind = category.kind;
      this.selected = category.values[1] ?? category.values[0]!;
      this.newPack = returnedSku;
      this.rebuild();
      this.overlay.classList.add('on');
      setGameText(this.status, gameMessages.storeProcessing);
      void this.waitForEntitlement(returnedSku);
    } else void this.refresh();
  }

  open(owner: CosmeticOwner): void {
    this.owner = owner;
    const allowed = categoriesOf(owner);
    if (!allowed.some((category) => category.kind === this.kind)) this.kind = allowed[0]!.kind;
    this.selected = equippedOf(this.state, this.kind);
    this.newPack = null;
    this.rebuild();
    this.overlay.classList.add('on');
    this.render();
    void this.refresh();
  }

  private close(): void { this.overlay.classList.remove('on'); this.newPack = null; }

  private selectKind(kind: CosmeticKind): void {
    const category = categoryOf(kind);
    if (category.owner !== this.owner) return;
    this.kind = kind;
    this.selected = equippedOf(this.state, kind);
    this.newPack = null;
    this.rebuild();
    this.render();
  }

  private rebuild(): void {
    this.tabs.replaceChildren();
    for (const category of categoriesOf(this.owner)) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ghost'; button.dataset.kind = category.kind;
      button.setAttribute('aria-pressed', String(category.kind === this.kind));
      setGameText(button, CATEGORY_NAMES[category.kind]);
      this.tabs.appendChild(button);
    }
    this.choices.replaceChildren();
    for (const value of categoryOf(this.kind).values) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'cosmetic-choice'; button.dataset.value = value;
      const image = document.createElement('img'); image.src = cosmeticPreviewUrl(this.kind, value); image.alt = '';
      if (this.kind !== 'personal-icon' && this.kind !== 'clan-icon') image.dataset.colored = 'true';
      const copy = document.createElement('span'); const name = document.createElement('b');
      setGameText(name, VALUE_NAMES[value]);
      const badge = document.createElement('i'); copy.append(name, badge); button.append(image, copy);
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
        this.selected = equippedOf(state, this.kind);
      }
    }
    this.render();
  }

  private render(): void {
    const category = categoryOf(this.kind);
    const clan = this.state?.clan ?? null;
    const hasPack = owned(this.state, this.kind);
    const equipped = equippedOf(this.state, this.kind);
    const available = this.selected === category.values[0] || hasPack;
    const canEquip = this.owner === 'player' || clan?.role === 'leader' || clan?.role === 'officer';
    const action = cosmeticCollectionAction({
      signedIn: this.state !== null,
      clanExists: this.owner === 'player' || clan !== null,
      available,
      equipped: this.selected === equipped,
      canEquip,
    });
    setGameText(this.title, this.owner === 'player'
      ? gameMessage('Оформление лагеря', 'Camp appearance') : gameMessage('Оформление клана', 'Clan appearance'));
    setGameText(this.lead, this.owner === 'player'
      ? gameMessage('Примерьте знак, огонь или набор двора. Ни одна покупка не применяется автоматически.',
        'Preview a mark, fire, or yard set. Purchases are never equipped automatically.')
      : gameMessage('Общие знаки и геральдика принадлежат клану. Выбор подтверждается отдельно.',
        'Shared marks and heraldry belong to the clan. Equipping is confirmed separately.'));
    this.preview.src = cosmeticPreviewUrl(this.kind, this.selected);
    this.preview.dataset.colored = String(this.kind !== 'personal-icon' && this.kind !== 'clan-icon');
    setGameText(this.previewName, VALUE_NAMES[this.selected]);
    setGameText(this.previewState, action === 'equipped'
      ? gameMessage('Используется сейчас', 'Currently equipped') : available
        ? gameMessage('Доступен в коллекции', 'Available in collection')
        : gameMessage('Закрытый предмет · предпросмотр', 'Locked item · preview'));
    setGameText(this.ownership, this.owner === 'player'
      ? gameMessage('Полученные наборы навсегда остаются на вашем аккаунте.',
        'Unlocked sets remain permanently on your account.')
      : clan === null ? gameMessage('Чтобы собирать общее оформление, сначала создайте клан.',
        'Create a clan before collecting shared appearance.')
        : gameMessage('Этот набор станет имуществом клана «{clan}», а не отдельного игрока.',
          'This set belongs to clan “{clan}”, not to an individual player.'),
    clan === null ? undefined : { clan: clan.name });

    for (const button of this.choices.querySelectorAll<HTMLButtonElement>('.cosmetic-choice')) {
      const value = button.dataset.value as CosmeticValue;
      const itemAvailable = value === category.values[0] || hasPack;
      const badge = button.querySelector('i') as HTMLElement;
      button.disabled = this.busy;
      button.classList.toggle('selected', value === this.selected);
      button.classList.toggle('equipped', value === equipped);
      button.classList.toggle('locked', !itemAvailable);
      button.classList.toggle('new', this.newPack === category.sku && value !== category.values[0] && itemAvailable);
      button.setAttribute('aria-pressed', String(value === this.selected));
      setGameText(badge, value === equipped ? gameMessage('Используется', 'Equipped')
        : this.newPack === category.sku && value !== category.values[0] && itemAvailable
          ? gameMessage('Новое', 'New') : itemAvailable ? gameMessage('Доступен', 'Available')
            : gameMessage('Закрыт', 'Locked'));
    }
    for (const tab of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      tab.classList.toggle('selected', tab.dataset.kind === this.kind);
      tab.setAttribute('aria-pressed', String(tab.dataset.kind === this.kind));
    }
    this.primary.dataset.action = action;
    this.primary.disabled = this.busy || ['sign-in', 'create-clan', 'equipped', 'role'].includes(action);
    setGameText(this.primary, action === 'sign-in' ? gameMessages.storeSignIn
      : action === 'create-clan' ? gameMessage('Сначала создайте клан', 'Create a clan first')
        : action === 'equipped' ? gameMessage('Используется', 'Equipped')
          : action === 'role' ? gameMessage('Применить может глава или офицер', 'A leader or officer can equip it')
            : action === 'obtain' ? gameMessage('Получить набор за {price}', 'Unlock pack for {price}')
              : gameMessage('Применить', 'Equip'),
    action === 'obtain' ? { price: platformPrice(category.price, category.stars) } : undefined);
    if (this.busy) setGameText(this.status, action === 'obtain' ? gameMessages.storeOpening
      : gameMessage('Применяем выбранное оформление…', 'Equipping the selected appearance…'));
    else if (this.newPack === category.sku && hasPack) setGameText(this.status, gameMessage(
      'Набор добавлен в коллекцию. Текущее оформление не изменено — выберите и примените его сами.',
      'The set was added to the collection. Current appearance was not changed—choose and equip it yourself.'));
    else setGameText(this.status, action === 'obtain'
      ? gameMessage('Откроются оба варианта набора. Их можно примерить до получения.',
        'Both variants in the pack will unlock. You can preview them first.')
      : gameMessage('Нажатие по карточке меняет только предпросмотр.',
        'Selecting a card only changes the preview.'));
  }

  private async primaryAction(): Promise<void> {
    if (this.primary.dataset.action === 'obtain') await this.checkout();
    else if (this.primary.dataset.action === 'equip') await this.equip();
  }

  private async checkout(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.render();
    const state = await cloudBillingCheckout(categoryOf(this.kind).sku);
    if (state?.url === undefined) {
      this.busy = false; this.state = state; this.render(); play('deny'); return;
    }
    const result = await openPlatformCheckout(state.url);
    if (result === 'redirected') return;
    if (result === 'paid' || result === 'pending') {
      this.newPack = categoryOf(this.kind).sku;
      setGameText(this.status, gameMessages.storeProcessing);
      await this.waitForEntitlement(this.newPack);
      return;
    }
    this.busy = false;
    this.render();
    if (result === 'failed') play('deny');
  }

  private async equip(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.render();
    const state = await cloudBillingEquip(this.owner, this.kind, this.selected);
    this.busy = false;
    if (state === null) play('deny');
    else { this.state = state; this.newPack = null; this.cb.onState(state); play('build'); }
    this.render();
  }

  private async waitForEntitlement(sku: string | null): Promise<void> {
    const category = categoryBySku(sku);
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await cloudBillingStatus();
      if (state !== null) {
        this.state = state; this.cb.onState(state);
        if (category !== undefined && owned(state, category.kind)) {
          this.busy = false; this.render(); play('build'); return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    this.busy = false; setGameText(this.status, gameMessages.storePending);
  }
}
