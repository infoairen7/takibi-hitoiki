import { createContext } from 'react';
import type { GameController } from '../game/controller';

export const Ctl = createContext<GameController | null>(null);
