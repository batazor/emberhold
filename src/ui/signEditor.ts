import { SIGN_TEXT_MAX, cleanSignText } from '../sim/signposts';
import { gameMessage, setGameAttribute, setGameText } from '../i18n/game';

/** Небольшой игровой диалог надписи — без системного prompt и его разного UX. */
export class SignEditor {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private done: ((text: string | null) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'sign-editor';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'sign-editor-title');

    const panel = document.createElement('section');
    panel.className = 'panel sign-editor-panel';
    const title = document.createElement('h2');
    title.id = 'sign-editor-title';
    setGameText(title, gameMessage('Надпись на указателе', 'Signpost text'));
    const note = document.createElement('p');
    note.className = 'dim';
    setGameText(note, gameMessage('Одна короткая строка — она появится на указателе в локации', 'Keep it short—the words will appear on the signpost here'));
    this.input = document.createElement('input');
    this.input.className = 'card';
    this.input.maxLength = SIGN_TEXT_MAX;
    setGameAttribute(this.input, 'placeholder', gameMessage('Например: К огороду', 'For example: To the garden'));
    setGameAttribute(this.input, 'aria-label', gameMessage('Текст указателя', 'Signpost text'));
    this.count = document.createElement('span');
    this.count.className = 'dim sign-editor-count';
    this.input.addEventListener('input', () => this.paintCount());

    const actions = document.createElement('div');
    actions.className = 'row sign-editor-actions';
    const cancel = document.createElement('button');
    cancel.className = 'ghost';
    setGameText(cancel, gameMessage('Отмена', 'Cancel'));
    cancel.addEventListener('click', () => this.close(null));
    const save = document.createElement('button');
    setGameText(save, gameMessage('Сохранить', 'Save'));
    save.addEventListener('click', () => {
      const text = cleanSignText(this.input.value);
      if (text.length > 0) this.close(text);
      else this.input.focus();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save.click();
      if (e.key === 'Escape') cancel.click();
    });
    actions.append(cancel, save);
    panel.append(title, note, this.input, this.count, actions);
    this.root.appendChild(panel);
    parent.appendChild(this.root);
  }

  open(value: string, done: (text: string | null) => void): void {
    if (this.done !== null) this.close(null);
    this.done = done;
    this.input.value = value;
    this.root.hidden = false;
    this.paintCount();
    this.input.focus();
    this.input.select();
  }

  private paintCount(): void {
    this.count.textContent = `${this.input.value.length} / ${SIGN_TEXT_MAX}`;
  }

  private close(value: string | null): void {
    this.root.hidden = true;
    const done = this.done;
    this.done = null;
    done?.(value);
  }
}
