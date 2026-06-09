import { Game } from './game/Game';

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
const startScreen = document.getElementById('startScreen')!;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const loadingMsg = document.getElementById('loadingMsg')!;

const game = new Game(canvas);
let ready = false;

startBtn.addEventListener('click', async () => {
  if (ready) return;
  startBtn.disabled = true;
  try {
    await game.init((msg) => { loadingMsg.textContent = msg; });
    ready = true;
    startScreen.classList.add('hidden');
    game.start();
  } catch (err) {
    loadingMsg.textContent = `Failed to start: ${err instanceof Error ? err.message : err}`;
    startBtn.disabled = false;
    console.error(err);
  }
});
