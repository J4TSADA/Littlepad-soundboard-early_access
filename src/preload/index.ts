import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppState, HotkeyReport, PickedFile } from '../shared/types';

/**
 * ช่องทางเดียวที่ renderer คุยกับระบบได้
 *
 * เราเปิด contextIsolation + ปิด nodeIntegration ไว้ แปลว่าหน้าเว็บ
 * แตะ fs / child_process ไม่ได้เลย ต้องผ่านฟังก์ชันในนี้เท่านั้น
 * ถ้าวันหลังใส่ฟีเจอร์โหลดเสียงจากเน็ต จะได้ไม่กลายเป็นช่องโหว่
 */
const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  saveState: (state: AppState): Promise<HotkeyReport> => ipcRenderer.invoke('state:save', state),
  pickSounds: (): Promise<PickedFile[]> => ipcRenderer.invoke('sounds:pick'),
  readSound: (filePath: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('sound:read', filePath),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
  openConfigFolder: (): Promise<void> => ipcRenderer.invoke('app:open-config-folder'),

  /** หาพาธจริงของไฟล์ที่ลากมาวาง (Electron ถอด File.path ออกไปแล้ว) */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  onHotkeyPlay: (callback: (soundId: string) => void): void => {
    ipcRenderer.on('hotkey:play', (_event, soundId: string) => callback(soundId));
  },
  onHotkeyStopAll: (callback: () => void): void => {
    ipcRenderer.on('hotkey:stop-all', () => callback());
  },
};

contextBridge.exposeInMainWorld('api', api);

export type SoundpadApi = typeof api;
