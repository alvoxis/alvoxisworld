/**
 * NPC dialogue system.
 */
export interface DialogueLine {
  text: string;
  options?: { text: string; next?: number }[];
}

export interface DialogueTree {
  id: string;
  lines: DialogueLine[];
}

const DIALOGUES: DialogueTree[] = [
  {
    id: 'greeting',
    lines: [
      { text: 'Приветствую, путник!', options: [{ text: 'Кто ты?', next: 1 }, { text: 'Прощай' }] },
      { text: 'Я житель этой земли. Здесь мы строим и торгуем.', options: [{ text: 'Понятно' }] },
    ],
  },
  {
    id: 'trade',
    lines: [
      { text: 'Хочешь торговать?', options: [{ text: 'Да', next: 1 }, { text: 'Нет' }] },
      { text: 'У меня есть еда и инструменты.', options: [{ text: 'Покажи' }, { text: 'Позже' }] },
    ],
  },
  {
    id: 'warning',
    lines: [
      { text: 'Будь осторожен! В лесу водятся хищники.', options: [{ text: 'Спасибо' }] },
    ],
  },
];

export function getDialogue(id: string): DialogueTree | null {
  return DIALOGUES.find(d => d.id === id) || null;
}

export function getRandomDialogue(): DialogueTree {
  return DIALOGUES[Math.floor(Math.random() * DIALOGUES.length)];
}

export const DIALOGUE_IDS = DIALOGUES.map(d => d.id);
