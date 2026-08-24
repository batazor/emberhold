import {
  cloudBillingCheckout,
  cloudBillingEquip,
  cloudBillingStatus,
} from '../core/cloud';
import type { BillingState } from '../core/cloud';
import {
  CLAN_CAMP_PACK,
  PERSONAL_CAMP_PACK,
  clanCampIconUrl,
  personalCampIconUrl,
} from '../core/cosmetics';
import type { ClanCampIcon, PersonalCampIcon } from '../core/cosmetics';
import { play } from '../core/audio';
import { gameMessage, setGameAttribute, setGameText } from '../i18n/game';
import { gameMessages } from '../i18n/gameMessages';

const EMBER = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M12 1.8c1.1 4.1-2.7 5.4-.6 8.2 1.2-1.2 1.8-2.7 1.7-4.4 3.2 2.4 5.1 5 5.1 8.4A6.2 6.2 0 0 1 5.8 14c0-2.8 1.5-5.2 4.5-7.4-.3 2.1.2 3.6 1.1 4.4C8.8 6.8 13.2 5.2 12 1.8Zm0 10.2c-1.8 1.4-2.7 2.8-2.7 4.2a2.7 2.7 0 1 0 5.4 0c0-1.2-.6-2.3-1.8-3.4 0 1-.3 1.8-.9 2.5.2-1.4-.2-2.5 0-3.3Z"/>
</svg>`;

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

export interface StorePanelCallbacks {
  onState(state: BillingState): void;
}

export class StorePanel {
  private readonly button: HTMLButtonElement;
  private readonly overlay: HTMLElement;
  private readonly personalStatus: HTMLElement;
  private readonly clanStatus: HTMLElement;
  private readonly personalBuy: HTMLButtonElement;
  private readonly clanBuy: HTMLButtonElement;
  private state: BillingState | null = null;
  private busy = false;

  constructor(parent: HTMLElement, private readonly cb: StorePanelCallbacks) {
    this.button = document.createElement('button');
    this.button.id = 'store-open';
    this.button.type = 'button';
    setGameAttribute(this.button, 'aria-label', gameMessages.storeOpen);
    this.button.innerHTML = EMBER;
    parent.appendChild(this.button);

    this.overlay = document.createElement('div');
    this.overlay.id = 'store';
    this.overlay.innerHTML = `
      <div class="panel">
        <h2></h2>
        <p class="store-lead"></p>
        <section class="store-product" data-product="personal">
          <div class="store-product-head"><div><h3></h3><p></p></div><b>$2.99</b></div>
          <div class="cosmetic-choices" data-choices="player"></div>
          <p class="store-status"></p>
          <button type="button" data-buy="${PERSONAL_CAMP_PACK}"></button>
        </section>
        <section class="store-product" data-product="clan">
          <div class="store-product-head"><div><h3></h3><p></p></div><b>$4.99</b></div>
          <div class="cosmetic-choices" data-choices="clan"></div>
          <p class="store-status"></p>
          <button type="button" data-buy="${CLAN_CAMP_PACK}"></button>
        </section>
        <p class="store-sandbox"></p>
        <div class="acts"><button type="button" class="ghost" data-act="close"></button></div>
      </div>`;
    parent.appendChild(this.overlay);

    this.personalStatus = this.overlay.querySelector('[data-product="personal"] .store-status') as HTMLElement;
    this.clanStatus = this.overlay.querySelector('[data-product="clan"] .store-status') as HTMLElement;
    this.personalBuy = this.overlay.querySelector(`[data-buy="${PERSONAL_CAMP_PACK}"]`) as HTMLButtonElement;
    this.clanBuy = this.overlay.querySelector(`[data-buy="${CLAN_CAMP_PACK}"]`) as HTMLButtonElement;

    setGameText(this.overlay.querySelector('h2') as HTMLElement, gameMessages.storeTitle);
    setGameText(this.overlay.querySelector('.store-lead') as HTMLElement, gameMessage(
      'Знаки меняют только силуэт лагеря на глобальной карте.',
      'Marks only change a camp’s silhouette on the global map.',
    ));
    setGameText(this.overlay.querySelector('[data-product="personal"] h3') as HTMLElement,
      gameMessage('Знаки личного лагеря I', 'Personal Camp Marks I'));
    setGameText(this.overlay.querySelector('[data-product="personal"] .store-product-head p') as HTMLElement,
      gameMessage('Две иконки навсегда принадлежат аккаунту.', 'Two icons permanently owned by your account.'));
    setGameText(this.overlay.querySelector('[data-product="clan"] h3') as HTMLElement,
      gameMessage('Знаки клана I', 'Clan Camp Marks I'));
    setGameText(this.overlay.querySelector('[data-product="clan"] .store-product-head p') as HTMLElement,
      gameMessage('Покупка навсегда поступает в имущество текущего клана.',
        'The purchase permanently becomes property of your current clan.'));
    setGameText(this.overlay.querySelector('.store-sandbox') as HTMLElement,
      gameMessage('Stripe Sandbox · реальные деньги не списываются', 'Stripe Sandbox · no real money is charged'));
    setGameText(this.overlay.querySelector('[data-act="close"]') as HTMLButtonElement, gameMessages.storeClose);

    this.addChoices('player', ['default', 'watchfire', 'horned_tent']);
    this.addChoices('clan', ['default', 'banner_tower', 'council_totem']);

    this.button.addEventListener('click', () => this.open());
    this.overlay.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (event.target === this.overlay) this.close();
      if (!(target instanceof HTMLButtonElement)) return;
      if (target.dataset.act === 'close') this.close();
      else if (target.dataset.buy !== undefined) void this.checkout(target.dataset.buy);
      else if (target.dataset.owner !== undefined && target.dataset.icon !== undefined) {
        void this.equip(target.dataset.owner as 'player' | 'clan', target.dataset.icon);
      }
    });

    const params = new URLSearchParams(location.search);
    const returnedSku = params.get('sku');
    if (params.get('checkout') === 'success') {
      params.delete('checkout');
      params.delete('sku');
      const query = params.toString();
      history.replaceState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`);
      this.overlay.classList.add('on');
      setGameText(this.personalStatus, gameMessages.storeProcessing);
      setGameText(this.clanStatus, gameMessages.storeProcessing);
      void this.waitForEntitlement(returnedSku);
    } else void this.refresh();
  }

  private addChoices(owner: 'player' | 'clan', icons: readonly string[]): void {
    const host = this.overlay.querySelector(`[data-choices="${owner}"]`) as HTMLElement;
    for (const raw of icons) {
      const icon = raw as PersonalCampIcon | ClanCampIcon;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cosmetic-choice';
      button.dataset.owner = owner;
      button.dataset.icon = icon;
      const image = document.createElement('img');
      image.src = owner === 'player'
        ? personalCampIconUrl(icon as PersonalCampIcon)
        : clanCampIconUrl(icon as ClanCampIcon);
      image.alt = '';
      const label = document.createElement('span');
      setGameText(label, owner === 'player'
        ? PERSONAL_NAMES[icon as PersonalCampIcon]
        : CLAN_NAMES[icon as ClanCampIcon]);
      button.append(image, label);
      host.appendChild(button);
    }
  }

  async refresh(): Promise<void> {
    const state = await cloudBillingStatus();
    this.state = state;
    if (state !== null) this.cb.onState(state);
    this.render();
  }

  private open(): void {
    this.overlay.classList.add('on');
    void this.refresh();
  }

  private close(): void {
    this.overlay.classList.remove('on');
  }

  private render(): void {
    const state = this.state;
    const signedIn = state !== null;
    this.button.classList.toggle('owned', state?.personal.owned === true || state?.clan?.owned === true);

    this.personalBuy.disabled = this.busy || !signedIn || state?.personal.owned === true;
    setGameText(this.personalBuy, state?.personal.owned === true ? gameMessages.storeOwned : gameMessages.storeBuy);
    setGameText(this.personalStatus, !signedIn ? gameMessages.storeSignIn
      : state.personal.owned ? gameMessage('Набор принадлежит вам. Выберите активный знак.',
        'You own this pack. Choose the active mark.')
        : gameMessage('Личная покупка останется на вашем аккаунте.',
          'A personal purchase remains on your account.'));

    const clan = state?.clan ?? null;
    this.clanBuy.disabled = this.busy || !signedIn || clan === null || clan.owned;
    setGameText(this.clanBuy, clan?.owned === true ? gameMessages.storeOwned : gameMessages.storeBuy);
    setGameText(this.clanStatus, !signedIn ? gameMessages.storeSignIn
      : clan === null ? gameMessage('Сначала создайте клан.', 'Create a clan first.')
        : clan.owned ? gameMessage('Набор принадлежит клану «{clan}».', 'This pack belongs to clan “{clan}”.')
          : gameMessage('Покупка станет имуществом клана «{clan}», а не игрока.',
            'The purchase becomes property of clan “{clan}”, not the player.'),
    clan === null ? undefined : { clan: clan.name });

    for (const button of this.overlay.querySelectorAll<HTMLButtonElement>('.cosmetic-choice')) {
      const owner = button.dataset.owner;
      const icon = button.dataset.icon ?? 'default';
      const isDefault = icon === 'default';
      const equipped = owner === 'player' ? state?.personal.equipped : clan?.equipped;
      const owns = owner === 'player' ? state?.personal.owned === true : clan?.owned === true;
      const canClanEquip = clan !== null && (clan.role === 'leader' || clan.role === 'officer');
      button.disabled = this.busy || !signedIn || (!isDefault && !owns) || (owner === 'clan' && !canClanEquip);
      button.classList.toggle('selected', equipped === icon);
      button.setAttribute('aria-pressed', String(equipped === icon));
    }
  }

  private async checkout(sku: string): Promise<void> {
    if (this.busy || (sku !== PERSONAL_CAMP_PACK && sku !== CLAN_CAMP_PACK)) return;
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

  private async equip(owner: 'player' | 'clan', icon: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.render();
    const state = await cloudBillingEquip(owner, icon as PersonalCampIcon | ClanCampIcon);
    this.busy = false;
    if (state === null) play('deny');
    else {
      this.state = state;
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
          this.render();
          play('build');
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    setGameText(this.personalStatus, gameMessages.storePending);
    setGameText(this.clanStatus, gameMessages.storePending);
  }
}
