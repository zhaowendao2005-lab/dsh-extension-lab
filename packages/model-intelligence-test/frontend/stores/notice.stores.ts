import { createStore } from 'zustand/vanilla';
import type { Notice } from '../types';
export const createNoticeStore = () => createStore<Notice | null>(() => null);
