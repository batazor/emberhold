export interface GameMessage {
  readonly id: string;
  readonly message: string;
  readonly translation?: string;
}

const message = (id: string, source: string, translation: string): GameMessage => ({
  id,
  message: source,
  translation,
});

/**
 * Explicit game UI catalog. Russian is the source locale; English lives here
 * so the generated Lingui catalog and the runtime descriptor cannot drift.
 */
export const gameMessages = {
  startPlay: message('game.start.play', 'Играть', 'Play'),

  achievementTitle: message('game.achievement.title', 'Награды', 'Achievements'),
  achievementEarned: message('game.achievement.earned', 'Получено · день {day}', 'Earned · day {day}'),
  achievementSuggested: message('game.achievement.suggested', 'Ориентир · день {day}', 'Suggested · day {day}'),
  achievementToast: message('game.achievement.toast', 'Награда получена', 'Achievement earned'),
  achievementLead: message(
    'game.achievement.lead',
    'Три первых знака отмечают не время в игре, а освоенные части её главной петли.',
    'The first three marks celebrate parts of the core loop you have learned, not time spent in game.',
  ),
  achievementFirstCampTitle: message('game.achievement.firstCamp.title', 'Здесь будет дом', 'A Home Will Stand Here'),
  achievementFirstCampDescription: message(
    'game.achievement.firstCamp.description',
    'Первый костёр зажжён, и у вашей летописи появилось место на карте.',
    'The first fire is lit, and your chronicle has found its place on the map.',
  ),
  achievementFirstCampGoal: message(
    'game.achievement.firstCamp.goal',
    'Разбейте лагерь на поляне.',
    'Establish a camp in the glade.',
  ),
  achievementFirstReturnTitle: message('game.achievement.firstReturn.title', 'Главное — вернуться', 'The Return Matters'),
  achievementFirstReturnDescription: message(
    'game.achievement.firstReturn.description',
    'Первая находка добралась до лагеря. Риск имеет смысл, только если есть путь домой.',
    'Your first find made it back to camp. Risk only matters when there is a way home.',
  ),
  achievementFirstReturnGoal: message(
    'game.achievement.firstReturn.goal',
    'Вернитесь из вылазки хотя бы с одной находкой.',
    'Return from an expedition with at least one find.',
  ),
  achievementFirstShelterTitle: message('game.achievement.firstShelter.title', 'Место у огня', 'A Place by the Fire'),
  achievementFirstShelterDescription: message(
    'game.achievement.firstShelter.description',
    'Лагерь стал больше одного героя: теперь здесь есть место и для другого человека.',
    'The camp is more than one hero now: someone else has a place here too.',
  ),
  achievementFirstShelterGoal: message(
    'game.achievement.firstShelter.goal',
    'Дайте первому жителю место под крышей.',
    'Give your first resident a roof.',
  ),

  authSignInTitle: message('game.auth.signIn.title', 'Вход', 'Sign in'),
  authSignInLead: message(
    'game.auth.signIn.lead',
    'Лагерь хранится за аккаунтом — ссылка придёт на почту',
    'Your camp is tied to your account — we’ll email you a link',
  ),
  authSignInSubmit: message('game.auth.signIn.submit', 'Прислать ссылку', 'Send me a link'),
  authSignInSwap: message('game.auth.signIn.swap', 'У меня нет аккаунта', 'I don’t have an account'),
  authSignUpTitle: message('game.auth.signUp.title', 'Регистрация', 'Create account'),
  authSignUpLead: message(
    'game.auth.signUp.lead',
    'Аккаунт сохранит лагерь между устройствами',
    'An account keeps your camp across devices',
  ),
  authSignUpSubmit: message('game.auth.signUp.submit', 'Завести аккаунт', 'Create account'),
  authSignUpSwap: message('game.auth.signUp.swap', 'У меня есть аккаунт', 'I have an account'),
  authEmail: message('game.auth.email', 'Почта', 'Email'),
  authSending: message('game.auth.sending', 'Письмо собирается…', 'Preparing the email…'),
  authSent: message('game.auth.sent', 'Ссылка отправлена — откройте письмо', 'Link sent — check your email'),

  visitCampAction: message('game.visitCamp.action', 'Посетить лагерь', 'Visit camp'),
  visitCampMode: message('game.visitCamp.mode', 'режим просмотра', 'view only'),
  visitCampUnnamed: message('game.visitCamp.unnamed', 'Лагерь без имени', 'Unnamed camp'),
  visitCampSummary: message(
    'game.visitCamp.summary',
    'Жильё ур. {level} · народу {folk} · здесь нельзя ничего менять',
    'Housing lvl {level} · {folk} people · nothing can be changed here',
  ),
  visitCampLike: message('game.visitCamp.like', '♡ Нравится · {likes}', '♡ Like · {likes}'),
  visitCampLiked: message('game.visitCamp.liked', '♥ Вам нравится · {likes}', '♥ Liked · {likes}'),
  visitCampLikeFailed: message(
    'game.visitCamp.likeFailed',
    'Не удалось сохранить лайк — проверьте вход и сеть',
    'Could not save the like — check your sign-in and connection',
  ),
  visitCampBack: message('game.visitCamp.back', 'Вернуться на карту', 'Back to map'),

  clanPanelTitle: message('game.clan.panel.title', 'Свой клан', 'Your clan'),
  clanPanelLead: message(
    'game.clan.panel.lead',
    'Имя, под которым лагерь стоит в таблице.',
    'The name your camp uses in the standings.',
  ),
  clanPanelName: message('game.clan.panel.name', 'Имя клана', 'Clan name'),
  clanPanelFound: message('game.clan.panel.found', 'Основать', 'Found clan'),
  clanPanelJoin: message('game.clan.panel.join', 'Вступить в чужой', 'Join another clan'),
  clanPanelClose: message('game.clan.panel.close', 'Закрыть', 'Close'),
  clanPanelExistingTitle: message('game.clan.panel.existingTitle', 'Клан «{name}»', 'Clan “{name}”'),
  clanPanelInviteLead: message(
    'game.clan.panel.inviteLead',
    'Позовите друга: ссылка откроет игру и покажет ваш клан.',
    'Invite a friend: the link opens the game and shows your clan.',
  ),
  clanPanelInvite: message('game.clan.panel.invite', 'Пригласить в клан', 'Invite to clan'),
  clanInviteTitle: message('game.clan.invite.title', 'Приглашение в клан', 'Clan invitation'),
  clanInviteSummary: message(
    'game.clan.invite.summary',
    '«{name}» · участников: {members}',
    '“{name}” · members: {members}',
  ),
  clanInviteAccept: message('game.clan.invite.accept', 'Вступить', 'Join'),
  clanInviteAcceptAgain: message('game.clan.invite.acceptAgain', 'Открыть свой клан', 'Open your clan'),
  clanInviteConflict: message(
    'game.clan.invite.conflict',
    'Вы уже состоите в другом клане.',
    'You already belong to another clan.',
  ),
  clanInviteInvalid: message(
    'game.clan.invite.invalid',
    'Приглашение недействительно или уже истекло.',
    'This invitation is invalid or has expired.',
  ),
  clanInviteLater: message('game.clan.invite.later', 'Не сейчас', 'Not now'),
  clanInviteCreateFailed: message(
    'game.clan.invite.createFailed',
    'Не удалось создать приглашение — проверьте вход и сеть',
    'Could not create an invitation — check your sign-in and connection',
  ),
  clanInviteShareFailed: message(
    'game.clan.invite.shareFailed',
    'Не удалось отправить ссылку',
    'Could not share the link',
  ),
  clanInviteCopied: message(
    'game.clan.invite.copied',
    'Ссылка приглашения скопирована',
    'Invitation link copied',
  ),
  clanInviteChooseRecipient: message(
    'game.clan.invite.chooseRecipient',
    'Выберите, кому отправить приглашение',
    'Choose who to send the invitation to',
  ),
  clanInviteJoinFailed: message(
    'game.clan.invite.joinFailed',
    'Не удалось вступить в клан',
    'Could not join the clan',
  ),
  clanInviteJoined: message('game.clan.invite.joined', 'Вы в клане «{name}»', 'You joined “{name}”'),
  clanPanelJoinReason: message(
    'game.clan.panel.joinReason',
    'Не к кому: на карте фракции мира, а они не набирают',
    'There is no one to join: the map shows world factions, and they do not recruit',
  ),
  clanNameEmpty: message('game.clan.name.empty', 'Клану нужно имя', 'The clan needs a name'),
  clanNameShort: message(
    'game.clan.name.short',
    'Коротко: хотя бы {min} буквы',
    'Too short: use at least {min} characters',
  ),
  clanNameLong: message(
    'game.clan.name.long',
    'Длинно: не больше {max} знаков',
    'Too long: use no more than {max} characters',
  ),
  clanNameWorld: message('game.clan.name.world', 'Так зовут фракцию мира', 'A world faction already uses that name'),

  clanBuildTitle: message('game.clan.build.title', 'Стройка клана', 'Clan construction'),
  clanBuildHint: message('game.clan.build.hint', 'Выберите здание, затем место 2×2', 'Choose a building, then a 2×2 site'),
  clanBuildHall: message(
    'game.clan.build.hall',
    'Клановый штаб · Д {wood} · К {stone} · Ж {iron}',
    'Clan headquarters · W {wood} · S {stone} · I {iron}',
  ),
  clanBuildStore: message(
    'game.clan.build.store',
    'Клановый склад · Д {wood} · К {stone} · Ж {iron}',
    'Clan storehouse · W {wood} · S {stone} · I {iron}',
  ),
  clanBuildWorkshop: message(
    'game.clan.build.workshop',
    'Клановая мастерская · Д {wood} · К {stone} · Ж {iron}',
    'Clan workshop · W {wood} · S {stone} · I {iron}',
  ),
  clanBuildResources: message(
    'game.clan.build.resources',
    'Склад: дерево {wood} · камень {stone} · железо {iron}',
    'Stockpile: wood {wood} · stone {stone} · iron {iron}',
  ),
  clanBuildBuilt: message('game.clan.build.built', 'Уже построено', 'Already built'),
  clanBuildCurrent: message('game.clan.build.current', 'Сейчас строится', 'Under construction'),
  clanBuildFinishCurrent: message(
    'game.clan.build.finishCurrent',
    'Сначала закончите текущую стройку',
    'Finish the current construction first',
  ),
  clanBuildLeaderOnly: message('game.clan.build.leaderOnly', 'Строить может глава', 'Only the clan leader can build'),
  clanBuildResourcesMissing: message(
    'game.clan.build.resourcesMissing',
    'На складе клана не хватает ресурсов',
    'The clan stockpile does not have enough resources',
  ),
  clanBuildNone: message('game.clan.build.none', 'Сейчас стройки нет', 'No construction in progress'),
  clanBuildHallProgress: message(
    'game.clan.build.hallProgress',
    'Клановый штаб: {done} / {total} мин работы',
    'Clan headquarters: {done} / {total} min of work',
  ),
  clanBuildStoreProgress: message(
    'game.clan.build.storeProgress',
    'Клановый склад: {done} / {total} мин работы',
    'Clan storehouse: {done} / {total} min of work',
  ),
  clanBuildWorkshopProgress: message(
    'game.clan.build.workshopProgress',
    'Клановая мастерская: {done} / {total} мин работы',
    'Clan workshop: {done} / {total} min of work',
  ),
  clanBuildWorkers: message('game.clan.build.workers', 'Рабочие на стройке', 'Construction workers'),
  clanBuildWorkerAssigned: message('game.clan.build.workerAssigned', '{name} · строит', '{name} · building'),
  clanBuildWorkerCamp: message('game.clan.build.workerCamp', '{name} · в личном лагере', '{name} · in personal camp'),
  clanBuildWorkerHunting: message('game.clan.build.workerHunting', 'Житель сейчас на охоте', 'This resident is hunting'),
  clanBuildStartFirst: message('game.clan.build.startFirst', 'Сначала начните стройку', 'Start construction first'),
  clanBuildNoResidents: message(
    'game.clan.build.noResidents',
    'В личном лагере пока нет жителей',
    'There are no residents in your personal camp yet',
  ),
  clanBuildPlaceLeader: message(
    'game.clan.build.placeLeader',
    'Размещать здания может только глава клана',
    'Only the clan leader can place buildings',
  ),

  settingsOpen: message('game.settings.open', 'Настройки', 'Settings'),
  settingsTitle: message('game.settings.title', 'Настройки', 'Settings'),
  settingsLanguage: message('game.settings.language', 'Язык', 'Language'),
  settingsMaster: message('game.settings.master', 'Громкость', 'Volume'),
  settingsCombat: message('game.settings.combat', 'Бой', 'Combat'),
  settingsInterface: message('game.settings.interface', 'Интерфейс', 'Interface'),
  settingsAmbient: message('game.settings.ambient', 'Амбиент', 'Ambient'),
  settingsAmbientNote: message(
    'game.settings.ambientNote',
    'Амбиент глушится отдельно: пульс провианта идёт по шине боя и останется слышен.',
    'Ambient sound is muted separately: the provisions pulse uses the combat channel and remains audible.',
  ),
  settingsEraseWarning: message(
    'game.settings.eraseWarning',
    'Лагерь, отряд и запасы будут стёрты.',
    'Your camp, party, and supplies will be erased.',
  ),
  settingsErase: message('game.settings.erase', 'Стереть и начать заново', 'Erase and start over'),
  settingsCancel: message('game.settings.cancel', 'Отмена', 'Cancel'),
  settingsChronicle: message('game.settings.chronicle', 'Летопись', 'Chronicle'),
  settingsNewGame: message('game.settings.newGame', 'Новая игра', 'New game'),
  settingsClose: message('game.settings.close', 'Закрыть', 'Close'),

  storeOpen: message('game.store.open', 'Платный контент', 'Paid content'),
  storeTitle: message('game.store.title', 'Платный контент', 'Paid content'),
  storeFounderTitle: message('game.store.founder.title', 'Набор основателя', 'Founder Pack'),
  storeFounderLead: message(
    'game.store.founder.lead',
    'Постоянная огненная эмблема аккаунта. На баланс игры не влияет.',
    'A permanent ember emblem for your account. It does not affect game balance.',
  ),
  storeBuy: message('game.store.buy', 'Купить тестовой картой', 'Buy with a test card'),
  storeOwned: message('game.store.owned', 'Уже получено', 'Already owned'),
  storeClose: message('game.store.close', 'Закрыть', 'Close'),
  storeSandboxNote: message(
    'game.store.sandboxNote',
    'Песочница Stripe: настоящих списаний нет.',
    'Stripe sandbox: no real charge is made.',
  ),
  storeGranted: message(
    'game.store.granted',
    'Эмблема выдана этому аккаунту.',
    'The emblem is unlocked for this account.',
  ),
  storeSignIn: message('game.store.signIn', 'Сначала войдите в аккаунт.', 'Sign in to your account first.'),
  storeOpening: message('game.store.opening', 'Открываем Stripe Checkout…', 'Opening Stripe Checkout…'),
  storeProcessing: message('game.store.processing', 'Платёж принят, ждём выдачу…', 'Payment received, granting access…'),
  storePending: message(
    'game.store.pending',
    'Stripe ещё обрабатывает платёж. Откройте магазин чуть позже.',
    'Stripe is still processing the payment. Open the store again shortly.',
  ),
  storeFailed: message(
    'game.store.failed',
    'Не удалось начать покупку — проверьте вход и сеть.',
    'Could not start checkout — check your sign-in and connection.',
  ),
} as const satisfies Record<string, GameMessage>;
