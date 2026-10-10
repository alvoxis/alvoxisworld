import './styles.css';
import { Game } from './game/game';
import { Hud } from './ui/hud';
import { SettingsStore } from './game/settings';
import { initLang } from './i18n';
import { installErrorLog } from './app/diagnostics';

installErrorLog();
initLang(); // before anything is drawn: the saved language, else the browser's, else English
const canvas = document.getElementById('map') as HTMLCanvasElement;
const game = new Game(canvas);
new Hud(game, new SettingsStore());
game.start();

// Exposed for debugging from the browser console.
(window as unknown as { alvoxis: Game }).alvoxis = game;
