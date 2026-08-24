/**
 * Прибор защиты: показывает урон, число переживаемых ударов и
 * мёртвые ступени щита. Это замер, а не unit-тест: числа баланса
 * можно менять, но мёртвый апгрейд обязан стать виден.
 *
 * Запуск: npm run protection
 */
import { HERO_HP } from '../src/sim/balance';
import { ENEMY_STATS } from '../src/sim/enemies';
import { CLASS_ORDER, HERO_CLASSES } from '../src/sim/heroes';
import { shieldDefense } from '../src/sim/gear';
import { protectionOf } from '../src/sim/protection';
import type { EnemyKind } from '../src/sim/types';

const num = (x: number): string => Number.isInteger(x) ? String(x) : x.toFixed(1);
const kinds = ['minion', 'warrior', 'mage', 'guard', 'minotaur', 'stone-golem'] as EnemyKind[];

console.log('Защита: урон при попадании / под Блоком / ударов до падения\n');

let dead = 0;
for (const cls of CLASS_ORDER) {
  if (HERO_CLASSES[cls].ranged) continue;
  const hero = HERO_CLASSES[cls];
  const hp = HERO_HP + hero.hp;
  console.log(`══ ${hero.name}: HP ${hp}, базовая Защита ${hero.base.defense} ══`);
  for (const kind of kinds) {
    const enemy = ENEMY_STATS[kind];
    const cells: string[] = [];
    let previousHits = 0;
    for (let level = 0; level <= 5; level++) {
      const defense = hero.base.defense + shieldDefense(level);
      const hit = protectionOf(enemy.attack, defense);
      const guarded = protectionOf(enemy.attack, defense, { guarding: true });
      const hits = Math.ceil(hp / hit.dealt);
      if (level > 0 && hits === previousHits) dead += 1;
      cells.push(`ур${level} ${num(hit.dealt)}/${num(guarded.dealt)}/${hits}`);
      previousHits = hits;
    }
    console.log(`  ${enemy.name.padEnd(15)} ${cells.join(' · ')}`);
  }
  console.log('');
}

console.log(dead === 0
  ? '✓ Каждая ступень щита меняет число переживаемых ударов.'
  : `⚠ Мёртвых пар «ступень щита × противник»: ${dead}.\n` +
    '  Это не автоматический провал: Заслон ещё покупает отталкивание.');
