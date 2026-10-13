/**
 * Funny thought bubbles for creatures.
 * Occasionally shows short phrases above their heads.
 */
import type { Creatures } from './creatures';

export const THOUGHTS: readonly string[] = [
  'Если бы я уехал в другую страну, я бы изменил мир!',
  'Не хватает библиотек...',
  'Плохое правительство!',
  'А что если сделать переворот?',
  'Хочу больше хлеба и зрелищ',
  'Почему у соседа дом лучше?',
  'Мечтаю о космическом корабле',
  'Надо бы изучить Библию получше',
  'Кто украл мою рыбу?!',
  'Давайте заключим союз... или войну?',
  'Эти эльфы слишком высокие',
  'Дварфы опять пьют всё пиво',
  'Хочу построить красивый дом',
  'Пора изобретать новое оружие',
  'Правительство ничего не делает!',
  'А давайте выберем нового короля?',
  'Скучно. Нужна революция',
  'Почему нет нормальных дорог?',
  'Мечтаю о машине, а не о телеге',
  'Надо больше знаний!',
];

export interface Thought {
  creatureId: number;
  text: string;
  until: number; // tick when it expires
}

const active: Thought[] = [];
let nextCheck = 0;

/** Occasionally assign a random thought to a random creature. */
export function updateThoughts(creatures: Creatures, tick: number, rng: { next(): number }): void {
  // Remove expired
  for (let i = active.length - 1; i >= 0; i--) {
    if (tick >= active[i].until) active.splice(i, 1);
  }
  if (tick < nextCheck) return;
  nextCheck = tick + 80 + Math.floor(rng.next() * 120);

  if (creatures.count === 0 || active.length >= 6) return;
  const idx = Math.floor(rng.next() * creatures.count);
  const id = creatures.id[idx];
  if (active.some(t => t.creatureId === id)) return;

  const text = THOUGHTS[Math.floor(rng.next() * THOUGHTS.length)];
  active.push({ creatureId: id, text, until: tick + 180 + Math.floor(rng.next() * 120) });
}

export function getThoughts(): readonly Thought[] {
  return active;
}
