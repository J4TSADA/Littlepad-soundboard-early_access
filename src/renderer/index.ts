import { AudioEngine } from './audio';
import { accelaratorFromEvent, formatAccelerator, isRiskyAccelerator } from './hotkey';
import { DEFAULT_SETTINGS, type AppState, type SoundItem } from '../shared/types';

const engine = new AudioEngine();
let state: AppState = { sounds: [], settings: { ...DEFAULT_SETTINGS } };
let connected = false;
/** id ของเสียงที่กำลังรอให้ผู้ใช้กดปุ่มเพื่อตั้งคีย์ลัด ('__stopAll' = ปุ่มหยุดทั้งหมด) */
let listeningFor: string | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`ไม่พบ element #${id}`);
  return el as T;
};

const ui = {
  status: $<HTMLSpanElement>('status'),
  connect: $<HTMLButtonElement>('connect'),
  cableHelp: $<HTMLButtonElement>('cable-help'),
  deviceVirtual: $<HTMLSelectElement>('device-virtual'),
  deviceMonitor: $<HTMLSelectElement>('device-monitor'),
  deviceMic: $<HTMLSelectElement>('device-mic'),
  micPassthrough: $<HTMLInputElement>('mic-passthrough'),
  monitorEnabled: $<HTMLInputElement>('monitor-enabled'),
  masterVolume: $<HTMLInputElement>('master-volume'),
  masterValue: $<HTMLElement>('master-value'),
  micVolume: $<HTMLInputElement>('mic-volume'),
  micValue: $<HTMLElement>('mic-value'),
  addSound: $<HTMLButtonElement>('add-sound'),
  soundList: $<HTMLUListElement>('sound-list'),
  soundCount: $<HTMLElement>('sound-count'),
  emptyState: $<HTMLParagraphElement>('empty-state'),
  hotkeysEnabled: $<HTMLInputElement>('hotkeys-enabled'),
  stopAllHotkey: $<HTMLButtonElement>('stop-all-hotkey'),
  meterMic: $<HTMLElement>('meter-mic'),
  meterPad: $<HTMLElement>('meter-pad'),
  dropVeil: $<HTMLDivElement>('drop-veil'),
  toast: $<HTMLDivElement>('toast'),
  rowTemplate: document.getElementById('sound-row') as HTMLTemplateElement,
};

/* ------------------------------------------------------------------ */
/* ข้อความแจ้งเตือน                                                    */
/* ------------------------------------------------------------------ */

let toastTimer: number | undefined;
function toast(message: string): void {
  ui.toast.textContent = message;
  ui.toast.dataset.visible = 'true';
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    ui.toast.dataset.visible = 'false';
  }, 4000);
}

/* ------------------------------------------------------------------ */
/* บันทึกสถานะ                                                         */
/* ------------------------------------------------------------------ */

let saveTimer: number | undefined;

/**
 * หน่วงการบันทึกไว้เล็กน้อย เพราะการลาก slider ยิง event รัวมาก
 * ถ้าเขียนไฟล์ + ลงทะเบียนคีย์ลัดใหม่ทุก event จะกระตุกทันที
 */
function persist(immediate = false): void {
  window.clearTimeout(saveTimer);
  const run = async (): Promise<void> => {
    const report = await window.api.saveState(state);
    if (report.failed.length > 0) {
      toast(
        `ตั้งคีย์ ${report.failed.map(formatAccelerator).join(', ')} ไม่สำเร็จ — น่าจะมีโปรแกรมอื่นจองไว้อยู่`,
      );
    }
  };
  if (immediate) void run();
  else saveTimer = window.setTimeout(() => void run(), 250);
}

/* ------------------------------------------------------------------ */
/* อุปกรณ์เสียง                                                        */
/* ------------------------------------------------------------------ */

const VIRTUAL_HINTS = ['cable', 'vb-audio', 'blackhole', 'voicemeeter', 'virtual', 'loopback'];

function looksVirtual(label: string): boolean {
  const lower = label.toLowerCase();
  return VIRTUAL_HINTS.some((hint) => lower.includes(hint));
}

function fill(select: HTMLSelectElement, devices: MediaDeviceInfo[], selectedId: string | null): void {
  select.textContent = '';
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `อุปกรณ์ ${device.deviceId.slice(0, 6)}`;
    select.append(option);
  }
  if (selectedId && devices.some((d) => d.deviceId === selectedId)) select.value = selectedId;
}

async function refreshDevices(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const inputs = devices.filter((d) => d.kind === 'audioinput');

  // เดาให้ครั้งแรก: ปลายทางที่ Discord ฟัง = อุปกรณ์ที่ชื่อดูเหมือนสายเสมือน
  // ส่วนหูฟังเรา = อะไรก็ได้ที่ไม่ใช่สายเสมือน
  const guessVirtual = outputs.find((d) => looksVirtual(d.label))?.deviceId ?? null;
  const guessMonitor = outputs.find((d) => !looksVirtual(d.label))?.deviceId ?? null;

  state.settings.virtualDeviceId ??= guessVirtual;
  state.settings.monitorDeviceId ??= guessMonitor;
  state.settings.micDeviceId ??= inputs.find((d) => !looksVirtual(d.label))?.deviceId ?? null;

  fill(ui.deviceVirtual, outputs, state.settings.virtualDeviceId);
  fill(ui.deviceMonitor, outputs, state.settings.monitorDeviceId);
  fill(ui.deviceMic, inputs, state.settings.micDeviceId);

  if (!guessVirtual) {
    toast('ยังไม่เจออุปกรณ์ที่ดูเหมือนสายเสียงเสมือน — ติดตั้ง VB-Cable หรือ BlackHole ก่อนนะ');
  }
}

/* ------------------------------------------------------------------ */
/* ต่อสาย                                                              */
/* ------------------------------------------------------------------ */

async function applyRouting(): Promise<void> {
  const { settings } = state;
  await engine.setOutputDevice(settings.virtualDeviceId);
  await engine.setMonitorDevice(settings.monitorDeviceId);
  engine.setMasterVolume(settings.masterVolume);
  engine.setMonitorEnabled(settings.monitorEnabled);

  if (settings.micPassthrough) {
    await engine.enableMic(settings.micDeviceId, settings.micVolume);
  } else {
    await engine.disableMic();
  }
  setNode('mic', settings.micPassthrough);
}

async function connect(): Promise<void> {
  try {
    await AudioEngine.unlockDeviceLabels();
    await engine.start();
    await refreshDevices();
    await applyRouting();

    connected = true;
    ui.connect.dataset.connected = 'true';
    ui.connect.textContent = 'เชื่อมต่อแล้ว — กดเพื่อต่อใหม่';
    ui.status.dataset.state = 'live';
    ui.status.textContent = 'พร้อมใช้งาน';
    setNode('cable', true);
    setNode('app', true);
    persist(true);
  } catch (error) {
    ui.status.dataset.state = 'error';
    ui.status.textContent = 'เชื่อมต่อไม่ได้';
    toast(`เชื่อมต่อไม่สำเร็จ: ${(error as Error).message}`);
  }
}

function setNode(node: string, on: boolean): void {
  const el = document.querySelector<HTMLElement>(`.chain-nodes li[data-node="${node}"]`);
  if (el) el.dataset.on = String(on);
}

/* ------------------------------------------------------------------ */
/* รายการเสียง                                                         */
/* ------------------------------------------------------------------ */

function renderSounds(): void {
  ui.soundList.textContent = '';
  ui.soundCount.textContent = String(state.sounds.length);
  ui.emptyState.hidden = state.sounds.length > 0;

  for (const sound of state.sounds) {
    const fragment = ui.rowTemplate.content.cloneNode(true) as DocumentFragment;
    const row = fragment.querySelector<HTMLLIElement>('.sound');
    const play = fragment.querySelector<HTMLButtonElement>('.play');
    const name = fragment.querySelector<HTMLInputElement>('.name');
    const volume = fragment.querySelector<HTMLInputElement>('.volume');
    const hotkey = fragment.querySelector<HTMLButtonElement>('.hotkey');
    const remove = fragment.querySelector<HTMLButtonElement>('.remove');
    if (!row || !play || !name || !volume || !hotkey || !remove) continue;

    row.dataset.id = sound.id;
    name.value = sound.name;
    name.title = sound.filePath;
    volume.value = String(Math.round(sound.volume * 100));
    paintHotkey(hotkey, sound.hotkey);

    play.addEventListener('click', () => void trigger(sound.id));
    name.addEventListener('change', () => {
      sound.name = name.value.trim() || sound.name;
      name.value = sound.name;
      persist();
    });
    volume.addEventListener('input', () => {
      sound.volume = Number(volume.value) / 100;
      persist();
    });
    hotkey.addEventListener('click', () => startListening(sound.id, hotkey));
    remove.addEventListener('click', () => {
      engine.forget(sound.id);
      state.sounds = state.sounds.filter((s) => s.id !== sound.id);
      renderSounds();
      persist(true);
    });

    ui.soundList.append(fragment);
  }
}

function paintHotkey(button: HTMLButtonElement, accelerator: string | null): void {
  button.textContent = formatAccelerator(accelerator);
  button.dataset.set = String(Boolean(accelerator));
  button.dataset.risky = String(Boolean(accelerator && isRiskyAccelerator(accelerator)));
  button.title = accelerator
    ? 'คลิกเพื่อเปลี่ยนปุ่ม / คลิกขวาเพื่อล้าง'
    : 'คลิกแล้วกดปุ่มที่ต้องการ';
}

async function trigger(soundId: string): Promise<void> {
  const sound = state.sounds.find((s) => s.id === soundId);
  if (!sound) return;
  if (!connected) {
    await connect();
    if (!connected) return;
  }
  try {
    await engine.play(soundId, sound.filePath, sound.volume, state.settings.retriggerMode);
    markPlaying();
  } catch (error) {
    toast(`เล่น "${sound.name}" ไม่ได้: ${(error as Error).message}`);
  }
}

function markPlaying(): void {
  for (const row of ui.soundList.querySelectorAll<HTMLLIElement>('.sound')) {
    row.dataset.playing = String(engine.isPlaying(row.dataset.id ?? ''));
  }
}

/* ------------------------------------------------------------------ */
/* ตั้งคีย์ลัด                                                          */
/* ------------------------------------------------------------------ */

function startListening(target: string, button: HTMLButtonElement): void {
  listeningFor = target;
  button.dataset.listening = 'true';
  button.textContent = 'กดปุ่ม…';
}

function stopListening(): void {
  listeningFor = null;
  const stop = state.settings.stopAllHotkey;
  ui.stopAllHotkey.dataset.listening = 'false';
  paintHotkey(ui.stopAllHotkey, stop);
  for (const row of ui.soundList.querySelectorAll<HTMLLIElement>('.sound')) {
    const button = row.querySelector<HTMLButtonElement>('.hotkey');
    const sound = state.sounds.find((s) => s.id === row.dataset.id);
    if (button && sound) {
      button.dataset.listening = 'false';
      paintHotkey(button, sound.hotkey);
    }
  }
}

/**
 * ดักที่ระดับ window ในช่วง capture เพื่อกินปุ่มก่อน element อื่น
 * จะได้ตั้งปุ่มอย่าง Tab หรือ Space ได้โดยไม่ไปเลื่อนโฟกัส/เลื่อนหน้า
 */
window.addEventListener(
  'keydown',
  (event) => {
    if (!listeningFor) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.code === 'Escape') {
      stopListening();
      return;
    }

    const accelerator = accelaratorFromEvent(event);
    if (!accelerator) return;

    const clash = state.sounds.find((s) => s.hotkey === accelerator && s.id !== listeningFor);
    if (clash) {
      toast(`ปุ่มนี้ใช้กับ "${clash.name}" อยู่แล้ว`);
      stopListening();
      return;
    }

    if (listeningFor === '__stopAll') {
      state.settings.stopAllHotkey = accelerator;
    } else {
      const sound = state.sounds.find((s) => s.id === listeningFor);
      if (sound) sound.hotkey = accelerator;
    }

    if (isRiskyAccelerator(accelerator)) {
      toast(
        `ตั้ง ${formatAccelerator(accelerator)} แล้ว — ปุ่มเดี่ยวจะถูกยึดทั้งเครื่อง พิมพ์ตัวนี้ในแชทไม่ได้จนกว่าจะปิดสวิตช์คีย์ลัด`,
      );
    }
    stopListening();
    persist(true);
  },
  true,
);

/** คลิกขวาที่ปุ่มคีย์ลัด = ล้างค่า */
window.addEventListener('contextmenu', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.hotkey');
  if (!button) return;
  event.preventDefault();
  if (button === ui.stopAllHotkey) {
    state.settings.stopAllHotkey = null;
    paintHotkey(ui.stopAllHotkey, null);
  } else {
    const id = button.closest<HTMLLIElement>('.sound')?.dataset.id;
    const sound = state.sounds.find((s) => s.id === id);
    if (sound) {
      sound.hotkey = null;
      paintHotkey(button, null);
    }
  }
  persist(true);
});

/* ------------------------------------------------------------------ */
/* เพิ่มเสียง                                                          */
/* ------------------------------------------------------------------ */

function addFiles(files: { name: string; filePath: string }[]): void {
  let added = 0;
  for (const file of files) {
    if (state.sounds.some((s) => s.filePath === file.filePath)) continue;
    state.sounds.push({
      id: crypto.randomUUID(),
      name: file.name,
      filePath: file.filePath,
      hotkey: null,
      volume: 1,
    });
    added += 1;
  }
  if (added === 0) return;
  renderSounds();
  persist(true);
  void preloadAll();
}

/** โหลด + decode ไว้ล่วงหน้าทั้งหมด เพื่อให้กดปุ่มแล้วเสียงออกทันที */
async function preloadAll(): Promise<void> {
  for (const sound of state.sounds) {
    if (engine.hasBuffer(sound.id)) continue;
    try {
      await engine.load(sound.id, sound.filePath);
    } catch {
      toast(`โหลด "${sound.name}" ไม่ได้ — ไฟล์อาจถูกย้ายไปแล้ว`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ผูก event ของแผงตั้งค่า                                              */
/* ------------------------------------------------------------------ */

function bindControls(): void {
  ui.connect.addEventListener('click', () => void connect());

  ui.cableHelp.addEventListener('click', () => {
    const url = navigator.userAgent.includes('Mac OS X')
      ? 'https://existential.audio/blackhole/'
      : 'https://vb-audio.com/Cable/';
    void window.api.openExternal(url);
  });

  ui.deviceVirtual.addEventListener('change', () => {
    state.settings.virtualDeviceId = ui.deviceVirtual.value;
    void engine.setOutputDevice(ui.deviceVirtual.value);
    persist();
  });

  ui.deviceMonitor.addEventListener('change', () => {
    state.settings.monitorDeviceId = ui.deviceMonitor.value;
    void engine.setMonitorDevice(ui.deviceMonitor.value);
    persist();
  });

  ui.deviceMic.addEventListener('change', () => {
    state.settings.micDeviceId = ui.deviceMic.value;
    if (connected && state.settings.micPassthrough) {
      void engine.enableMic(ui.deviceMic.value, state.settings.micVolume);
    }
    persist();
  });

  ui.micPassthrough.addEventListener('change', () => {
    state.settings.micPassthrough = ui.micPassthrough.checked;
    if (connected) void applyRouting();
    setNode('mic', ui.micPassthrough.checked);
    persist();
  });

  ui.monitorEnabled.addEventListener('change', () => {
    state.settings.monitorEnabled = ui.monitorEnabled.checked;
    engine.setMonitorEnabled(ui.monitorEnabled.checked);
    persist();
  });

  ui.masterVolume.addEventListener('input', () => {
    const value = Number(ui.masterVolume.value) / 100;
    state.settings.masterVolume = value;
    engine.setMasterVolume(value);
    ui.masterValue.textContent = `${ui.masterVolume.value}%`;
    persist();
  });

  ui.micVolume.addEventListener('input', () => {
    const value = Number(ui.micVolume.value) / 100;
    state.settings.micVolume = value;
    engine.setMicVolume(value);
    ui.micValue.textContent = `${ui.micVolume.value}%`;
    persist();
  });

  ui.hotkeysEnabled.addEventListener('change', () => {
    state.settings.hotkeysEnabled = ui.hotkeysEnabled.checked;
    persist(true);
    toast(ui.hotkeysEnabled.checked ? 'คีย์ลัดทำงานแล้ว' : 'ปิดคีย์ลัดชั่วคราว — พิมพ์แชทได้ตามปกติ');
  });

  ui.stopAllHotkey.addEventListener('click', () => startListening('__stopAll', ui.stopAllHotkey));

  ui.addSound.addEventListener('click', async () => {
    addFiles(await window.api.pickSounds());
  });

  // ลากไฟล์มาวาง
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    ui.dropVeil.dataset.visible = 'true';
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth -= 1;
    if (dragDepth <= 0) ui.dropVeil.dataset.visible = 'false';
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    ui.dropVeil.dataset.visible = 'false';
    const files = Array.from(event.dataTransfer?.files ?? []).map((file) => ({
      name: file.name.replace(/\.[^.]+$/, ''),
      filePath: window.api.getPathForFile(file),
    }));
    addFiles(files.filter((f) => f.filePath));
  });
}

/* ------------------------------------------------------------------ */
/* คีย์ลัดจาก main process                                             */
/* ------------------------------------------------------------------ */

window.api.onHotkeyPlay((soundId) => void trigger(soundId));
window.api.onHotkeyStopAll(() => {
  engine.stopAll();
  markPlaying();
});

/* ------------------------------------------------------------------ */
/* ลูปวาดมิเตอร์                                                       */
/* ------------------------------------------------------------------ */

function meterLoop(): void {
  const levels = engine.readLevels();
  ui.meterMic.style.width = `${levels.mic * 100}%`;
  ui.meterPad.style.width = `${levels.soundpad * 100}%`;
  setNode('pad', levels.soundpad > 0.01);
  requestAnimationFrame(meterLoop);
}

/* ------------------------------------------------------------------ */
/* เริ่มทำงาน                                                          */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  state = await window.api.getState();

  ui.micPassthrough.checked = state.settings.micPassthrough;
  ui.monitorEnabled.checked = state.settings.monitorEnabled;
  ui.hotkeysEnabled.checked = state.settings.hotkeysEnabled;
  ui.masterVolume.value = String(Math.round(state.settings.masterVolume * 100));
  ui.masterValue.textContent = `${ui.masterVolume.value}%`;
  ui.micVolume.value = String(Math.round(state.settings.micVolume * 100));
  ui.micValue.textContent = `${ui.micVolume.value}%`;
  paintHotkey(ui.stopAllHotkey, state.settings.stopAllHotkey);

  renderSounds();
  bindControls();
  meterLoop();
  window.setInterval(markPlaying, 200);

  // อุปกรณ์เสียบ/ถอดกลางทาง ให้รีเฟรชรายการเอง
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices());
}

void boot();
