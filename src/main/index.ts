import { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { configPath, loadState, saveState } from './store';
import { DEFAULT_SETTINGS, type AppState, type HotkeyReport, type PickedFile } from '../shared/types';

let win: BrowserWindow | null = null;

// ค่าเริ่มต้นชั่วคราว — โหลดของจริงใน app.whenReady เพราะ app.getPath()
// ใช้ไม่ได้ก่อน ready
let state: AppState = { sounds: [], settings: { ...DEFAULT_SETTINGS } };

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'webm'];

function createWindow(): void {
  win = new BrowserWindow({
    width: 480,
    height: 700,
    minWidth: 420,
    minHeight: 520,
    title: 'Littlepad',
    backgroundColor: '#101219',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win?.show());
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // กันลิงก์ภายนอกเปิดทับหน้าต่างแอป
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * ลงทะเบียนคีย์ลัดใหม่ทั้งชุดทุกครั้งที่ state เปลี่ยน
 *
 * globalShortcut = คีย์ระดับระบบ กดได้แม้แอปไม่ได้โฟกัส ซึ่งจำเป็นมาก
 * เพราะตอนใช้งานจริงเราจะโฟกัสอยู่ที่ Discord หรือเกม ไม่ใช่ที่แอปนี้
 *
 * ข้อแลกเปลี่ยน: คีย์ที่จองไว้จะถูก "ยึด" ทั้งระบบ ถ้าจอง C ไว้
 * เราจะพิมพ์ตัว c ในช่องแชทไม่ได้เลย จึงต้องมีสวิตช์ hotkeysEnabled
 */
function registerHotkeys(): HotkeyReport {
  globalShortcut.unregisterAll();
  const failed: string[] = [];
  if (!state.settings.hotkeysEnabled) return { failed };

  const bind = (accelerator: string, action: () => void): void => {
    try {
      if (!globalShortcut.register(accelerator, action)) failed.push(accelerator);
    } catch {
      failed.push(accelerator);
    }
  };

  for (const sound of state.sounds) {
    if (!sound.hotkey) continue;
    bind(sound.hotkey, () => win?.webContents.send('hotkey:play', sound.id));
  }

  if (state.settings.stopAllHotkey) {
    bind(state.settings.stopAllHotkey, () => win?.webContents.send('hotkey:stop-all'));
  }

  return { failed };
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => state);

  ipcMain.handle('state:save', (_event, next: AppState): HotkeyReport => {
    state = next;
    saveState(state);
    return registerHotkeys();
  });

  ipcMain.handle('sounds:pick', async (): Promise<PickedFile[]> => {
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: 'เลือกไฟล์เสียง',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'ไฟล์เสียง', extensions: AUDIO_EXTENSIONS }],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => ({
      filePath,
      name: path.basename(filePath, path.extname(filePath)),
    }));
  });

  /**
   * renderer อ่านไฟล์เองไม่ได้ (ปิด nodeIntegration ไว้เพื่อความปลอดภัย)
   * จึงให้ main อ่านแล้วส่ง bytes กลับไป decode เป็น AudioBuffer
   */
  ipcMain.handle('sound:read', async (_event, filePath: string): Promise<Uint8Array | null> => {
    if (typeof filePath !== 'string') return null;
    if (!AUDIO_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) return null;
    try {
      const buffer = await fs.readFile(filePath);
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:open-external', async (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) await shell.openExternal(url);
  });

  ipcMain.handle('app:open-config-folder', () => {
    shell.showItemInFolder(configPath());
  });
}

// อนุญาตให้เปิดได้แค่หน้าต่างเดียว กันคีย์ลัดชนกันเอง
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    state = loadState();
    registerIpc();
    createWindow();
    registerHotkeys();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
