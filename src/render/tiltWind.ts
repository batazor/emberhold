/**
 * Ветер от наклона устройства. Телефон наклонили — поле легло в ту сторону.
 *
 * Отдаётся направление в экранных осях, а не в мировых: наклон вправо
 * обязан класть траву вправо на экране, а мировая сторона зависит от
 * поворота камеры (её игрок крутит клавишами Q и E). Перевод в мир делает
 * риг, который азимут и хранит.
 *
 * Ноль — не горизонт, а то, как телефон держали в первый замер. Иначе
 * человек, читающий экран под привычным углом в тридцать градусов, получил
 * бы ураган на ровном месте и никогда не увидел бы тихого поля.
 * Подкручивать этот ноль со временем нарочно не стал: наклон — это
 * направление ветра, а ветер, который сам собой стихает, пока держишь
 * телефон наклонённым, читался бы поломкой, а не решением.
 *
 * Три и DOM тут не нужны — значит, проверяется в Node (tiltWind.rules.ts).
 */

export interface Tilt {
  /** Вправо по экрану. */
  readonly x: number;
  /** От себя, вглубь экрана. */
  readonly y: number;
  /** 0..1 — сила ветра от угла. */
  readonly strength: number;
}

/** Градусов наклона, ниже которых это дрожь руки, а не жест. */
const DEADZONE = 3;

/** Градусов, на которых ветер полон. Дальше сильнее не становится. */
const FULL_ANGLE = 26;

/** Насколько быстро ветер догоняет наклон (1/с): рука дёргается, поле — нет. */
const SMOOTH = 5;

/** Ниже этой силы ветра нет вовсе. */
const SILENT = 0.02;

export class TiltWind implements Tilt {
  x = 0;
  y = 0;
  strength = 0;

  /** Ноль отсчёта: как держали в первый замер. null — замеров ещё не было. */
  private zeroBeta: number | null = null;
  private zeroGamma = 0;
  /** Куда наклонён телефон сейчас, в градусах от нуля отсчёта. */
  private rawX = 0;
  private rawY = 0;
  private live = false;

  /**
   * Замер гироскопа. beta — наклон от себя, gamma — вбок, оба в градусах;
   * null приходит от браузера, когда датчика нет.
   */
  feed(beta: number | null, gamma: number | null): void {
    if (beta === null || gamma === null) return;
    if (this.zeroBeta === null) {
      this.zeroBeta = beta;
      this.zeroGamma = gamma;
    }
    this.rawX = gamma - this.zeroGamma;
    this.rawY = beta - this.zeroBeta;
    this.live = true;
  }

  /** Датчик замолчал (вкладка ушла в фон, разрешение отозвали). */
  stop(): void {
    this.live = false;
    this.rawX = 0;
    this.rawY = 0;
  }

  /** Раз в кадр. dt — секунды. */
  step(dt: number): void {
    if (dt <= 0) return;

    let goalX = 0;
    let goalY = 0;
    if (this.live) {
      const angle = Math.hypot(this.rawX, this.rawY);
      if (angle > DEADZONE) {
        // Мёртвая зона вычитается, а не отсекается: иначе на её краю ветер
        // включался бы скачком с четверти силы.
        const force = Math.min(1, (angle - DEADZONE) / (FULL_ANGLE - DEADZONE));
        goalX = (this.rawX / angle) * force;
        goalY = (this.rawY / angle) * force;
      }
    }

    const k = Math.min(1, dt * SMOOTH);
    this.x += (goalX - this.x) * k;
    this.y += (goalY - this.y) * k;
    this.strength = Math.min(1, Math.hypot(this.x, this.y));
  }

  /** Ветер от наклона или null, если телефон держат ровно (или его нет). */
  get tilt(): Tilt | null {
    return this.strength < SILENT ? null : this;
  }
}
