import type { SoundpadApi } from '../preload/index';

declare global {
  interface Window {
    api: SoundpadApi;
  }
}

export {};
