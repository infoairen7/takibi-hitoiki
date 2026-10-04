import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GameController } from './game/controller';
import './styles/ui.css';
import './styles/game.css';

declare global {
  interface Window {
    GYARUBI_BACKDROP?: string;
  }
}

const backdrop = window.GYARUBI_BACKDROP ?? './assets/backdrop_forest_dusk_provisional.jpg';
const controller = new GameController();

// claude.ai の公開ページで新しい版が届いたとき、今の火をそのまま引き継ぐ
type Hot = { snapshot?: (fn: () => unknown) => void; ready?: (start: (data: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
function start(data: unknown): void {
  const session = (data as { session?: unknown } | null)?.session;
  if (session) controller.setHotRestore(session);
  createRoot(document.getElementById('root')!).render(<App controller={controller} backdropUrl={backdrop} />);
}
try {
  hot?.snapshot?.(() => ({ session: controller.hotSnapshot() }));
} catch {
  /* viewer外では何もしない */
}
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
