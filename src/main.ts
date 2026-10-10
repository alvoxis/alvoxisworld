import './styles.css';
import { Game } from './game/game';
import { Hud } from './ui/hud';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const game = new Game(canvas);
new Hud(game);
game.start();

// Exposed for debugging from the browser console.
(window as unknown as { alvoxis: Game }).alvoxis = game;
