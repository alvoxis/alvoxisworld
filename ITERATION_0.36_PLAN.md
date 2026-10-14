# План итерации 0.36: интеграция modular parts

**Предыдущая итерация:** 0.35 (смержена в main, коммит aca63da)
**Цель:** полноценная интеграция `parts.ts` в основной рендер

## Что сделано в 0.35
- Исправлена формула масштаба: `SPRITE_ART_SIZE = 72` вместо жёсткой 8
- При s=64 px/tile существа ~0.24 клетки (цель 0.25) — подтверждено расчётом
- QA: typecheck + 10 тестов прошли
- Performance: спрайты кэшируются, критических проблем нет
- PR #1 смержен

## Задачи для 0.36

### 1. Единая точка сборки (game-architect + implementation-engineer)
- Создать `src/render/creature/assemble.ts`
- `assembleCreature(race, genome, frame)` использует `parts.ts`
- `smoothCreature` становится обёрткой

### 2. Детерминированные варианты (implementation-engineer)
- `appearanceSeed(creatureId)` из `core/rng.ts`
- Кэш по `species:seedBucket:frame`
- Один ID = один внешний вид после перезагрузки

### 3. Тесты (qa-reviewer)
- Снапшот-тест: default genome совпадает со старым рендером
- Тест детерминизма: один ID → один genome
- Проверка масштаба не сломалась

### 4. Производительность (performance-engineer)
- Замерить FPS до/после на 500+ существах
- Проверить аллокации в кадре

## Порядок
1. game-architect финализирует API assemble.ts
2. implementation-engineer реализует
3. qa-reviewer пишет тесты и проверяет
4. performance-engineer замеряет
5. grok-lead интегрирует и создаёт PR

## Ограничения
- Не менять игровые механики
- Не начинать генератор зданий
- Сохранить совместимость сохранений
