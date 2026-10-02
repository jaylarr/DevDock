import { create } from 'zustand';
import type { Snapshot } from '../shared/contracts';

interface Store {
  snapshot?: Snapshot; selected?: string; filter: string; search: string;
  setSnapshot(snapshot: Snapshot): void; select(id?: string): void; setFilter(filter: string): void; setSearch(search: string): void;
}
export const useStore = create<Store>((set) => ({
  filter: 'all', search: '',
  setSnapshot: (snapshot) => set({ snapshot }), select: (selected) => set({ selected }),
  setFilter: (filter) => set({ filter }), setSearch: (search) => set({ search }),
}));
