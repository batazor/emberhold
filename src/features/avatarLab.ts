/**
 * `?avatars` — живая матрица генератора лиц.
 *
 * Веер проверяет размер и жест на настоящем экране игры, но показывает только
 * тех людей, которые сейчас есть в отряде и лагере. Здесь другой вопрос:
 * различаются ли все виды и все жребии рядом друг с другом. Строка — вид,
 * столбец — сид; кнопки двигают окно, не меняя сам генератор.
 */
import { AVATAR_LOOKS, avatarSvg, avatarTraits } from '../ui/avatar';
import { HERO_CLASSES } from '../sim/heroes';
import type { HeroClassId } from '../sim/heroes';

const PAGE = 8;

const heroLook = (look: string): look is HeroClassId =>
  look === 'knight' || look === 'archer' || look === 'rogue';

/** Стенд русский: показывает каноническое игровое имя, а не технический id модели. */
const lookName = (look: string): string => heroLook(look) ? HERO_CLASSES[look].name : look;

const CSS = `
#settings-open { display: none !important; }
#avatar-lab { position: fixed; inset: 0; z-index: 20; overflow: auto;
  color: #e8e2d4; background: #171511;
  font: 12px/1.35 ui-sans-serif, system-ui, sans-serif; }
#avatar-lab * { box-sizing: border-box; }
#avatar-lab header { position: sticky; top: 0; z-index: 1; display: flex;
  align-items: center; gap: 8px; padding: 10px 14px; background: rgba(23,21,17,.96);
  border-bottom: 1px solid #4f4638; }
#avatar-lab h1 { margin: 0 auto 0 0; font-size: 15px; font-weight: 650; }
#avatar-lab button { min-width: 38px; padding: 6px 10px; border: 1px solid #685a46;
  border-radius: 7px; color: inherit; background: #30291f; font: inherit; cursor: pointer; }
#avatar-lab output { min-width: 86px; text-align: center; color: #cbbd9d;
  font-variant-numeric: tabular-nums; }
#avatar-grid { display: grid; grid-template-columns: repeat(8, minmax(92px, 1fr));
  gap: 1px; padding: 1px; background: #3b342a; }
.avatar-card { min-width: 0; padding: 10px 6px 8px; text-align: center; background: #211e19; }
.avatar-card h2 { height: 17px; margin: 0 0 6px; overflow: hidden; color: #d8cdb6;
  font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.avatar-card svg { display: block; width: 72px; height: 72px; margin: 0 auto 7px;
  filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); image-rendering: auto; }
.avatar-card b { display: block; margin-bottom: 2px; color: #9f927c; font-size: 10px;
  font-weight: 500; font-variant-numeric: tabular-nums; }
.avatar-card small { display: block; overflow: hidden; color: #6f6658; font-size: 9px;
  text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 760px) {
  #avatar-grid { grid-template-columns: repeat(4, minmax(80px, 1fr)); }
  .avatar-card svg { width: 60px; height: 60px; }
}
`;

export function installAvatarLab(): void {
  const root = document.createElement('section');
  root.id = 'avatar-lab';
  const style = document.createElement('style');
  style.textContent = CSS;
  const header = document.createElement('header');
  header.innerHTML = `
    <h1>SVG-аватары · все виды и жребии</h1>
    <button type="button" data-step="-8">−8</button>
    <output></output>
    <button type="button" data-step="8">+8</button>`;
  const grid = document.createElement('div');
  grid.id = 'avatar-grid';
  root.append(style, header, grid);
  document.body.append(root);

  let firstSeed = 0;

  const render = (): void => {
    const cards: string[] = [];
    for (const look of AVATAR_LOOKS) {
      for (let i = 0; i < PAGE; i++) {
        const seed = firstSeed + i;
        const t = avatarTraits(look, seed);
        cards.push(
          `<article class="avatar-card">` +
            `<h2 translate="no">${lookName(look)}</h2>` +
            avatarSvg(look, seed) +
            `<b>seed ${seed}</b>` +
            `<small>лицо ${t.face} · глаза ${t.eyes} · нос ${t.nose} · акцент ${t.accent}</small>` +
          `</article>`,
        );
      }
    }
    grid.innerHTML = cards.join('');
    const output = header.querySelector('output');
    if (output !== null) output.textContent = `${firstSeed}–${firstSeed + PAGE - 1}`;
  };

  header.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-step]');
    if (button === null) return;
    firstSeed = Math.max(0, firstSeed + Number(button.dataset['step']));
    render();
  });

  render();
}
