import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type AppState, type SoundItem } from '../shared/types';

/**
 * เก็บข้อมูลเป็นไฟล์ JSON ไฟล์เดียวใน userData
 * (Windows: %APPDATA%/mini-soundpad, macOS: ~/Library/Application Support/mini-soundpad)
 *
 * ทำไมไม่ใช้ localStorage: localStorage อยู่ฝั่ง renderer ซึ่ง main process
 * ต้องใช้ข้อมูลนี้ตอนลงทะเบียน global hotkey ก่อนหน้าต่างจะเปิดเสร็จด้วย
 * เก็บไว้ฝั่ง main จึงตรงกว่า และผู้ใช้เปิดไฟล์ไปแก้เอง/แบ็กอัพได้
 */

function filePath(): string {
  return path.join(app.getPath('userData'), 'soundpad.json');
}

function sanitizeSound(raw: unknown): SoundItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.filePath !== 'string') return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : path.basename(r.filePath),
    filePath: r.filePath,
    hotkey: typeof r.hotkey === 'string' && r.hotkey.length > 0 ? r.hotkey : null,
    volume: typeof r.volume === 'number' ? Math.min(1, Math.max(0, r.volume)) : 1,
  };
}

export function loadState(): AppState {
  try {
    const text = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const sounds = Array.isArray(parsed.sounds)
      ? parsed.sounds.map(sanitizeSound).filter((s): s is SoundItem => s !== null)
      : [];
    // merge กับค่า default เผื่อเวอร์ชันใหม่เพิ่มฟิลด์ ไฟล์เก่าจะได้ไม่พัง
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings as object | undefined) };
    return { sounds, settings };
  } catch {
    return { sounds: [], settings: { ...DEFAULT_SETTINGS } };
  }
}

export function saveState(state: AppState): void {
  const target = filePath();
  const tmp = `${target}.tmp`;
  // เขียนไฟล์ชั่วคราวแล้วค่อย rename — ถ้าไฟดับกลางทางไฟล์เดิมจะไม่พัง
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

export function configPath(): string {
  return filePath();
}
