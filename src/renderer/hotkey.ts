/**
 * แปลงปุ่มที่ผู้ใช้กดจริง ให้เป็นสตริง "accelerator" ที่ Electron เข้าใจ
 *
 * ใช้ event.code ไม่ใช่ event.key เพราะ code คือ "ตำแหน่งปุ่มบนคีย์บอร์ด"
 * ส่วน key คือ "ตัวอักษรที่ได้" ซึ่งเปลี่ยนตามภาษา — ถ้าสลับเป็นภาษาไทย
 * ปุ่มเดิมจะกลายเป็น "แ" แล้วคีย์ลัดจะพัง ใช้ code จึงกดได้ทุกภาษา
 */

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

function baseKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (code === 'NumpadAdd') return 'numadd';
  if (code === 'NumpadSubtract') return 'numsub';
  if (code === 'NumpadMultiply') return 'nummult';
  if (code === 'NumpadDivide') return 'numdiv';
  if (code === 'NumpadDecimal') return 'numdec';
  return NAMED_KEYS[code] ?? null;
}

export function accelaratorFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;
  const base = baseKeyFromCode(event.code);
  if (!base) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(base);
  return parts.join('+');
}

/** แปลงกลับให้อ่านง่ายบนหน้าจอ */
export function formatAccelerator(accelerator: string | null): string {
  if (!accelerator) return 'ยังไม่ตั้ง';
  const isMac = navigator.userAgent.includes('Mac OS X');
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'Control') return isMac ? '⌃' : 'Ctrl';
      if (part === 'Alt') return isMac ? '⌥' : 'Alt';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      if (part === 'Super') return isMac ? '⌘' : 'Win';
      if (part === 'Return') return 'Enter';
      if (part.startsWith('num')) return `Num ${part.slice(3)}`;
      return part;
    })
    .join(isMac ? '' : ' + ');
}

/**
 * คีย์เดี่ยวอย่าง C ใช้ได้ แต่จะยึดปุ่มนั้นทั้งระบบ พิมพ์ในแชทไม่ได้
 * เราไม่ห้าม (เพราะผู้ใช้ขอมาแบบนี้) แต่จะเตือนไว้ในหน้าจอ
 */
export function isRiskyAccelerator(accelerator: string): boolean {
  const parts = accelerator.split('+');
  if (parts.length > 1) return false;
  const single = parts[0] ?? '';
  return !/^(F\d+|num)/.test(single);
}
