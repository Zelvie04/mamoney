import { createContext, useContext } from 'react';
import type { Category, Me, Tx } from './api';

export interface AppCtx {
  me: Me | null;
  categories: Category[];
  /** Увеличивается после любых изменений данных — экраны перезагружаются */
  version: number;
  refresh: () => void;
  openAdd: () => void;
  openEdit: (tx: Tx) => void;
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
