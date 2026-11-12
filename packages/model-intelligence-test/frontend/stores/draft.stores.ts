import { createStore } from 'zustand/vanilla';
import type { DraftState } from '../types';
export const emptyDraft = (): DraftState => ({ name: '', kind: 'fingerprint', selected: [], body: '', dirty: false, pickerOpen: false, query: '' });
export const createDraftStore = () => createStore<DraftState>(emptyDraft);
