/**
 * ชนิดข้อมูลกลาง ใช้ร่วมกันทั้งฝั่ง main (Node) และ renderer (เบราว์เซอร์)
 * การมีไฟล์เดียวแบบนี้ทำให้ถ้าเราแก้ชื่อฟิลด์ผิด TypeScript จะฟ้องทั้งสองฝั่งทันที
 */

/** เสียง 1 ชิ้นใน soundpad */
export interface SoundItem {
  id: string;
  /** ชื่อที่โชว์บนปุ่ม */
  name: string;
  /** พาธไฟล์เสียงจริงบนเครื่อง (เราไม่ก็อปไฟล์ ใช้อ้างอิงเอา) */
  filePath: string;
  /** รูปแบบ Electron accelerator เช่น "C", "Control+Shift+1", "num1" — null = ยังไม่ตั้ง */
  hotkey: string | null;
  /** ระดับเสียงเฉพาะตัว 0..1 */
  volume: number;
}

/** โหมดเวลากดซ้ำระหว่างที่เสียงเดิมยังเล่นอยู่ */
export type RetriggerMode = 'restart' | 'overlap' | 'ignore';

export interface Settings {
  /** ระดับเสียงรวมของ soundpad 0..1 */
  masterVolume: number;

  /** อุปกรณ์ปลายทางที่ Discord ฟังอยู่ (ปกติคือ CABLE Input / BlackHole) */
  virtualDeviceId: string | null;
  /** หูฟังของเราเอง ใช้ฟังเสียงที่กำลังเล่น */
  monitorDeviceId: string | null;
  /** ไมค์ตัวจริง */
  micDeviceId: string | null;

  /** ได้ยินเสียง soundpad ในหูฟังตัวเองไหม */
  monitorEnabled: boolean;
  /** ส่งเสียงไมค์จริงเข้า virtual cable ด้วย เพื่อให้เพื่อนได้ยินทั้งเสียงพูดและเสียงเอฟเฟกต์ */
  micPassthrough: boolean;
  micVolume: number;

  /** สวิตช์ใหญ่ปิด/เปิดคีย์ลัดทั้งหมด */
  hotkeysEnabled: boolean;
  /** คีย์หยุดเสียงทั้งหมดทันที */
  stopAllHotkey: string | null;

  retriggerMode: RetriggerMode;
}

export interface AppState {
  sounds: SoundItem[];
  settings: Settings;
}

/** ผลลัพธ์ตอนลงทะเบียนคีย์ลัด — คีย์ไหนชนกับโปรแกรมอื่นจะกลับมาในนี้ */
export interface HotkeyReport {
  failed: string[];
}

export interface PickedFile {
  name: string;
  filePath: string;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  virtualDeviceId: null,
  monitorDeviceId: null,
  micDeviceId: null,
  monitorEnabled: true,
  micPassthrough: true,
  micVolume: 1,
  hotkeysEnabled: true,
  stopAllHotkey: 'F9',
  retriggerMode: 'restart',
};
