"use strict";
(() => {
  // src/renderer/audio.ts
  var AudioEngine = class {
    ctx;
    masterGain;
    monitorGain;
    micGain;
    /** ลิมิตเตอร์กันเสียงแตก — คุมเฉพาะสายแพด ไมค์ไม่เกี่ยว */
    limiter;
    virtualDest;
    monitorDest;
    virtualEl;
    monitorEl;
    soundpadMeter;
    micMeter;
    meterBuffer = new Float32Array(512);
    /** cache ของเสียงที่ decode แล้ว key = sound.id */
    buffers = /* @__PURE__ */ new Map();
    /** source + gain ที่กำลังเล่นอยู่ แยกตามเสียง เพื่อสั่งหยุด/รีสตาร์ตได้ */
    playing = /* @__PURE__ */ new Map();
    micStream = null;
    micSource = null;
    constructor() {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.masterGain = this.ctx.createGain();
      this.monitorGain = this.ctx.createGain();
      this.micGain = this.ctx.createGain();
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 8;
      this.limiter.attack.value = 5e-3;
      this.limiter.release.value = 0.15;
      this.virtualDest = this.ctx.createMediaStreamDestination();
      this.monitorDest = this.ctx.createMediaStreamDestination();
      this.soundpadMeter = this.ctx.createAnalyser();
      this.micMeter = this.ctx.createAnalyser();
      this.soundpadMeter.fftSize = 512;
      this.micMeter.fftSize = 512;
      this.masterGain.connect(this.soundpadMeter);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.virtualDest);
      this.masterGain.connect(this.monitorGain);
      this.monitorGain.connect(this.monitorDest);
      this.micGain.connect(this.micMeter);
      this.micGain.connect(this.virtualDest);
      this.virtualEl = new Audio();
      this.virtualEl.srcObject = this.virtualDest.stream;
      this.monitorEl = new Audio();
      this.monitorEl.srcObject = this.monitorDest.stream;
    }
    /** ต้องเรียกจากการคลิกของผู้ใช้ครั้งแรก ไม่งั้นนโยบาย autoplay จะบล็อก */
    async start() {
      await this.ctx.resume();
      await this.virtualEl.play();
      await this.monitorEl.play();
    }
    get sampleRate() {
      return this.ctx.sampleRate;
    }
    /**
     * ขอสิทธิ์ไมค์ 1 ครั้ง — นอกจากใช้ส่งเสียงพูดแล้ว ยังเป็นเงื่อนไขที่ทำให้
     * enumerateDevices() คืน "ชื่อ" อุปกรณ์มาให้ ถ้าไม่ขอ เราจะเห็นแต่ id เปล่า ๆ
     * เลือก CABLE Input ไม่ถูกแน่นอน
     */
    static async unlockDeviceLabels() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
    async setOutputDevice(deviceId) {
      if (!deviceId || typeof this.virtualEl.setSinkId !== "function") return;
      await this.virtualEl.setSinkId(deviceId);
    }
    async setMonitorDevice(deviceId) {
      if (!deviceId || typeof this.monitorEl.setSinkId !== "function") return;
      await this.monitorEl.setSinkId(deviceId);
    }
    setMasterVolume(value) {
      this.rampTo(this.masterGain, value);
    }
    setMonitorEnabled(enabled) {
      this.rampTo(this.monitorGain, enabled ? 1 : 0);
    }
    setMicVolume(value) {
      this.rampTo(this.micGain, value);
    }
    /** เลี่ยง .value = x ตรง ๆ เพราะเกนกระโดดทันทีจะได้ยินเสียง "แปะ" */
    rampTo(node, value) {
      const now = this.ctx.currentTime;
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(Math.max(0, Math.min(1.5, value)), now + 0.02);
    }
    async enableMic(deviceId, volume) {
      await this.disableMic();
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : void 0,
          // ปิดการประมวลผลของเบราว์เซอร์ทิ้ง ปล่อยให้ Discord จัดการเอง
          // ถ้าเปิด echoCancellation ไว้ มันจะมองเสียง soundpad เป็นเสียงสะท้อนแล้วหักออก
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.micGain);
      this.setMicVolume(volume);
    }
    async disableMic() {
      this.micSource?.disconnect();
      this.micSource = null;
      this.micStream?.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    hasBuffer(soundId) {
      return this.buffers.has(soundId);
    }
    /**
     * decode ล่วงหน้าแล้วเก็บไว้ในแรม
     * ไฟล์ mp3 30 วินาทีกินราว 5 MB ตอน decode แล้ว ซึ่งรับได้
     * ผลตอบแทนคือกดปุ่มแล้วเสียงออกทันที ไม่ต้องรอ decode ตอนกด
     */
    async load(soundId, filePath) {
      const cached = this.buffers.get(soundId);
      if (cached) return cached;
      const bytes = await window.api.readSound(filePath);
      if (!bytes) throw new Error("\u0E2D\u0E48\u0E32\u0E19\u0E44\u0E1F\u0E25\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u2014 \u0E44\u0E1F\u0E25\u0E4C\u0E2D\u0E32\u0E08\u0E16\u0E39\u0E01\u0E22\u0E49\u0E32\u0E22\u0E2B\u0E23\u0E37\u0E2D\u0E25\u0E1A\u0E44\u0E1B\u0E41\u0E25\u0E49\u0E27");
      const arrayBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
      const buffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(soundId, buffer);
      return buffer;
    }
    async play(soundId, filePath, volume, mode) {
      const running = this.playing.get(soundId);
      if (running && running.size > 0) {
        if (mode === "ignore") return;
        if (mode === "restart") this.stop(soundId);
      }
      const buffer = await this.load(soundId, filePath);
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gain).connect(this.masterGain);
      const entry = { source, gain };
      const set = this.playing.get(soundId) ?? /* @__PURE__ */ new Set();
      set.add(entry);
      this.playing.set(soundId, set);
      source.onended = () => {
        set.delete(entry);
        gain.disconnect();
        source.disconnect();
      };
      source.start();
    }
    /**
     * หยุดแบบ fade 15ms แทนการตัดกลางคลื่นทันที
     * การตัดคลื่นเสียงกลางลูก (ไม่ที่ศูนย์) จะได้ยินเป็นเสียง "แป๊ะ" ทุกครั้ง
     * ยิ่งกดรัวในโหมด restart ยิ่งแป๊ะถี่ — fade สั้น ๆ แก้ได้หมดโดยหูแทบไม่รู้สึกถึงดีเลย์
     */
    stop(soundId) {
      const set = this.playing.get(soundId);
      if (!set) return;
      const now = this.ctx.currentTime;
      for (const { source, gain } of set) {
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.linearRampToValueAtTime(0, now + 0.015);
          source.stop(now + 0.02);
        } catch {
        }
      }
      set.clear();
    }
    stopAll() {
      for (const soundId of this.playing.keys()) this.stop(soundId);
    }
    isPlaying(soundId) {
      return (this.playing.get(soundId)?.size ?? 0) > 0;
    }
    forget(soundId) {
      this.stop(soundId);
      this.buffers.delete(soundId);
      this.playing.delete(soundId);
    }
    /** ค่า RMS 0..1 ของทั้งสองสาย ใช้ขับแถบไฟบนหน้าจอ */
    readLevels() {
      return {
        soundpad: this.rms(this.soundpadMeter),
        mic: this.rms(this.micMeter)
      };
    }
    rms(analyser) {
      analyser.getFloatTimeDomainData(this.meterBuffer);
      let sum = 0;
      for (let i = 0; i < this.meterBuffer.length; i += 1) {
        const sample = this.meterBuffer[i] ?? 0;
        sum += sample * sample;
      }
      return Math.min(1, Math.sqrt(sum / this.meterBuffer.length) * 3);
    }
  };

  // src/renderer/hotkey.ts
  var MODIFIER_CODES = /* @__PURE__ */ new Set([
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight"
  ]);
  var NAMED_KEYS = {
    Space: "Space",
    Enter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`"
  };
  function baseKeyFromCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
    if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
    if (code === "NumpadAdd") return "numadd";
    if (code === "NumpadSubtract") return "numsub";
    if (code === "NumpadMultiply") return "nummult";
    if (code === "NumpadDivide") return "numdiv";
    if (code === "NumpadDecimal") return "numdec";
    return NAMED_KEYS[code] ?? null;
  }
  function accelaratorFromEvent(event) {
    if (MODIFIER_CODES.has(event.code)) return null;
    const base = baseKeyFromCode(event.code);
    if (!base) return null;
    const parts = [];
    if (event.ctrlKey) parts.push("Control");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");
    parts.push(base);
    return parts.join("+");
  }
  function formatAccelerator(accelerator) {
    if (!accelerator) return "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E15\u0E31\u0E49\u0E07";
    const isMac = navigator.userAgent.includes("Mac OS X");
    return accelerator.split("+").map((part) => {
      if (part === "Control") return isMac ? "\u2303" : "Ctrl";
      if (part === "Alt") return isMac ? "\u2325" : "Alt";
      if (part === "Shift") return isMac ? "\u21E7" : "Shift";
      if (part === "Super") return isMac ? "\u2318" : "Win";
      if (part === "Return") return "Enter";
      if (part.startsWith("num")) return `Num ${part.slice(3)}`;
      return part;
    }).join(isMac ? "" : " + ");
  }
  function isRiskyAccelerator(accelerator) {
    const parts = accelerator.split("+");
    if (parts.length > 1) return false;
    const single = parts[0] ?? "";
    return !/^(F\d+|num)/.test(single);
  }

  // src/shared/types.ts
  var DEFAULT_SETTINGS = {
    masterVolume: 0.8,
    virtualDeviceId: null,
    monitorDeviceId: null,
    micDeviceId: null,
    monitorEnabled: true,
    micPassthrough: true,
    micVolume: 1,
    hotkeysEnabled: true,
    stopAllHotkey: "F9",
    retriggerMode: "restart"
  };

  // src/renderer/index.ts
  var engine = new AudioEngine();
  var state = { sounds: [], settings: { ...DEFAULT_SETTINGS } };
  var connected = false;
  var listeningFor = null;
  var $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`\u0E44\u0E21\u0E48\u0E1E\u0E1A element #${id}`);
    return el;
  };
  var ui = {
    status: $("status"),
    connect: $("connect"),
    cableHelp: $("cable-help"),
    deviceVirtual: $("device-virtual"),
    deviceMonitor: $("device-monitor"),
    deviceMic: $("device-mic"),
    micPassthrough: $("mic-passthrough"),
    monitorEnabled: $("monitor-enabled"),
    masterVolume: $("master-volume"),
    masterValue: $("master-value"),
    micVolume: $("mic-volume"),
    micValue: $("mic-value"),
    addSound: $("add-sound"),
    soundList: $("sound-list"),
    soundCount: $("sound-count"),
    emptyState: $("empty-state"),
    hotkeysEnabled: $("hotkeys-enabled"),
    stopAllHotkey: $("stop-all-hotkey"),
    meterMic: $("meter-mic"),
    meterPad: $("meter-pad"),
    dropVeil: $("drop-veil"),
    toast: $("toast"),
    rowTemplate: document.getElementById("sound-row")
  };
  var toastTimer;
  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.dataset.visible = "true";
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      ui.toast.dataset.visible = "false";
    }, 4e3);
  }
  var saveTimer;
  function persist(immediate = false) {
    window.clearTimeout(saveTimer);
    const run = async () => {
      const report = await window.api.saveState(state);
      if (report.failed.length > 0) {
        toast(
          `\u0E15\u0E31\u0E49\u0E07\u0E04\u0E35\u0E22\u0E4C ${report.failed.map(formatAccelerator).join(", ")} \u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08 \u2014 \u0E19\u0E48\u0E32\u0E08\u0E30\u0E21\u0E35\u0E42\u0E1B\u0E23\u0E41\u0E01\u0E23\u0E21\u0E2D\u0E37\u0E48\u0E19\u0E08\u0E2D\u0E07\u0E44\u0E27\u0E49\u0E2D\u0E22\u0E39\u0E48`
        );
      }
    };
    if (immediate) void run();
    else saveTimer = window.setTimeout(() => void run(), 250);
  }
  var VIRTUAL_HINTS = ["cable", "vb-audio", "blackhole", "voicemeeter", "virtual", "loopback"];
  function looksVirtual(label) {
    const lower = label.toLowerCase();
    return VIRTUAL_HINTS.some((hint) => lower.includes(hint));
  }
  function fill(select, devices, selectedId) {
    select.textContent = "";
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C ${device.deviceId.slice(0, 6)}`;
      select.append(option);
    }
    if (selectedId && devices.some((d) => d.deviceId === selectedId)) select.value = selectedId;
  }
  async function refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((d) => d.kind === "audiooutput");
    const inputs = devices.filter((d) => d.kind === "audioinput");
    const guessVirtual = outputs.find((d) => looksVirtual(d.label))?.deviceId ?? null;
    const guessMonitor = outputs.find((d) => !looksVirtual(d.label))?.deviceId ?? null;
    state.settings.virtualDeviceId ??= guessVirtual;
    state.settings.monitorDeviceId ??= guessMonitor;
    state.settings.micDeviceId ??= inputs.find((d) => !looksVirtual(d.label))?.deviceId ?? null;
    fill(ui.deviceVirtual, outputs, state.settings.virtualDeviceId);
    fill(ui.deviceMonitor, outputs, state.settings.monitorDeviceId);
    fill(ui.deviceMic, inputs, state.settings.micDeviceId);
    if (!guessVirtual) {
      toast("\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E40\u0E08\u0E2D\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C\u0E17\u0E35\u0E48\u0E14\u0E39\u0E40\u0E2B\u0E21\u0E37\u0E2D\u0E19\u0E2A\u0E32\u0E22\u0E40\u0E2A\u0E35\u0E22\u0E07\u0E40\u0E2A\u0E21\u0E37\u0E2D\u0E19 \u2014 \u0E15\u0E34\u0E14\u0E15\u0E31\u0E49\u0E07 VB-Cable \u0E2B\u0E23\u0E37\u0E2D BlackHole \u0E01\u0E48\u0E2D\u0E19\u0E19\u0E30");
    }
  }
  async function applyRouting() {
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
    setNode("mic", settings.micPassthrough);
  }
  async function connect() {
    try {
      await AudioEngine.unlockDeviceLabels();
      await engine.start();
      await refreshDevices();
      await applyRouting();
      connected = true;
      ui.connect.dataset.connected = "true";
      ui.connect.textContent = "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E41\u0E25\u0E49\u0E27 \u2014 \u0E01\u0E14\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E15\u0E48\u0E2D\u0E43\u0E2B\u0E21\u0E48";
      ui.status.dataset.state = "live";
      ui.status.textContent = "\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19";
      setNode("cable", true);
      setNode("app", true);
      persist(true);
    } catch (error) {
      ui.status.dataset.state = "error";
      ui.status.textContent = "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49";
      toast(`\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08: ${error.message}`);
    }
  }
  function setNode(node, on) {
    const el = document.querySelector(`.chain-nodes li[data-node="${node}"]`);
    if (el) el.dataset.on = String(on);
  }
  function renderSounds() {
    ui.soundList.textContent = "";
    ui.soundCount.textContent = String(state.sounds.length);
    ui.emptyState.hidden = state.sounds.length > 0;
    for (const sound of state.sounds) {
      const fragment = ui.rowTemplate.content.cloneNode(true);
      const row = fragment.querySelector(".sound");
      const play = fragment.querySelector(".play");
      const name = fragment.querySelector(".name");
      const volume = fragment.querySelector(".volume");
      const hotkey = fragment.querySelector(".hotkey");
      const remove = fragment.querySelector(".remove");
      if (!row || !play || !name || !volume || !hotkey || !remove) continue;
      row.dataset.id = sound.id;
      name.value = sound.name;
      name.title = sound.filePath;
      volume.value = String(Math.round(sound.volume * 100));
      paintHotkey(hotkey, sound.hotkey);
      play.addEventListener("click", () => void trigger(sound.id));
      name.addEventListener("change", () => {
        sound.name = name.value.trim() || sound.name;
        name.value = sound.name;
        persist();
      });
      volume.addEventListener("input", () => {
        sound.volume = Number(volume.value) / 100;
        persist();
      });
      hotkey.addEventListener("click", () => startListening(sound.id, hotkey));
      remove.addEventListener("click", () => {
        engine.forget(sound.id);
        state.sounds = state.sounds.filter((s) => s.id !== sound.id);
        renderSounds();
        persist(true);
      });
      ui.soundList.append(fragment);
    }
  }
  function paintHotkey(button, accelerator) {
    button.textContent = formatAccelerator(accelerator);
    button.dataset.set = String(Boolean(accelerator));
    button.dataset.risky = String(Boolean(accelerator && isRiskyAccelerator(accelerator)));
    button.title = accelerator ? "\u0E04\u0E25\u0E34\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E1B\u0E25\u0E35\u0E48\u0E22\u0E19\u0E1B\u0E38\u0E48\u0E21 / \u0E04\u0E25\u0E34\u0E01\u0E02\u0E27\u0E32\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E25\u0E49\u0E32\u0E07" : "\u0E04\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27\u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21\u0E17\u0E35\u0E48\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23";
  }
  async function trigger(soundId) {
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
      toast(`\u0E40\u0E25\u0E48\u0E19 "${sound.name}" \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49: ${error.message}`);
    }
  }
  function markPlaying() {
    for (const row of ui.soundList.querySelectorAll(".sound")) {
      row.dataset.playing = String(engine.isPlaying(row.dataset.id ?? ""));
    }
  }
  function startListening(target, button) {
    listeningFor = target;
    button.dataset.listening = "true";
    button.textContent = "\u0E01\u0E14\u0E1B\u0E38\u0E48\u0E21\u2026";
  }
  function stopListening() {
    listeningFor = null;
    const stop = state.settings.stopAllHotkey;
    ui.stopAllHotkey.dataset.listening = "false";
    paintHotkey(ui.stopAllHotkey, stop);
    for (const row of ui.soundList.querySelectorAll(".sound")) {
      const button = row.querySelector(".hotkey");
      const sound = state.sounds.find((s) => s.id === row.dataset.id);
      if (button && sound) {
        button.dataset.listening = "false";
        paintHotkey(button, sound.hotkey);
      }
    }
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (!listeningFor) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        stopListening();
        return;
      }
      const accelerator = accelaratorFromEvent(event);
      if (!accelerator) return;
      const clash = state.sounds.find((s) => s.hotkey === accelerator && s.id !== listeningFor);
      if (clash) {
        toast(`\u0E1B\u0E38\u0E48\u0E21\u0E19\u0E35\u0E49\u0E43\u0E0A\u0E49\u0E01\u0E31\u0E1A "${clash.name}" \u0E2D\u0E22\u0E39\u0E48\u0E41\u0E25\u0E49\u0E27`);
        stopListening();
        return;
      }
      if (listeningFor === "__stopAll") {
        state.settings.stopAllHotkey = accelerator;
      } else {
        const sound = state.sounds.find((s) => s.id === listeningFor);
        if (sound) sound.hotkey = accelerator;
      }
      if (isRiskyAccelerator(accelerator)) {
        toast(
          `\u0E15\u0E31\u0E49\u0E07 ${formatAccelerator(accelerator)} \u0E41\u0E25\u0E49\u0E27 \u2014 \u0E1B\u0E38\u0E48\u0E21\u0E40\u0E14\u0E35\u0E48\u0E22\u0E27\u0E08\u0E30\u0E16\u0E39\u0E01\u0E22\u0E36\u0E14\u0E17\u0E31\u0E49\u0E07\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07 \u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E15\u0E31\u0E27\u0E19\u0E35\u0E49\u0E43\u0E19\u0E41\u0E0A\u0E17\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E08\u0E19\u0E01\u0E27\u0E48\u0E32\u0E08\u0E30\u0E1B\u0E34\u0E14\u0E2A\u0E27\u0E34\u0E15\u0E0A\u0E4C\u0E04\u0E35\u0E22\u0E4C\u0E25\u0E31\u0E14`
        );
      }
      stopListening();
      persist(true);
    },
    true
  );
  window.addEventListener("contextmenu", (event) => {
    const button = event.target.closest(".hotkey");
    if (!button) return;
    event.preventDefault();
    if (button === ui.stopAllHotkey) {
      state.settings.stopAllHotkey = null;
      paintHotkey(ui.stopAllHotkey, null);
    } else {
      const id = button.closest(".sound")?.dataset.id;
      const sound = state.sounds.find((s) => s.id === id);
      if (sound) {
        sound.hotkey = null;
        paintHotkey(button, null);
      }
    }
    persist(true);
  });
  function addFiles(files) {
    let added = 0;
    for (const file of files) {
      if (state.sounds.some((s) => s.filePath === file.filePath)) continue;
      state.sounds.push({
        id: crypto.randomUUID(),
        name: file.name,
        filePath: file.filePath,
        hotkey: null,
        volume: 1
      });
      added += 1;
    }
    if (added === 0) return;
    renderSounds();
    persist(true);
    void preloadAll();
  }
  async function preloadAll() {
    for (const sound of state.sounds) {
      if (engine.hasBuffer(sound.id)) continue;
      try {
        await engine.load(sound.id, sound.filePath);
      } catch {
        toast(`\u0E42\u0E2B\u0E25\u0E14 "${sound.name}" \u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 \u2014 \u0E44\u0E1F\u0E25\u0E4C\u0E2D\u0E32\u0E08\u0E16\u0E39\u0E01\u0E22\u0E49\u0E32\u0E22\u0E44\u0E1B\u0E41\u0E25\u0E49\u0E27`);
      }
    }
  }
  function bindControls() {
    ui.connect.addEventListener("click", () => void connect());
    ui.cableHelp.addEventListener("click", () => {
      const url = navigator.userAgent.includes("Mac OS X") ? "https://existential.audio/blackhole/" : "https://vb-audio.com/Cable/";
      void window.api.openExternal(url);
    });
    ui.deviceVirtual.addEventListener("change", () => {
      state.settings.virtualDeviceId = ui.deviceVirtual.value;
      void engine.setOutputDevice(ui.deviceVirtual.value);
      persist();
    });
    ui.deviceMonitor.addEventListener("change", () => {
      state.settings.monitorDeviceId = ui.deviceMonitor.value;
      void engine.setMonitorDevice(ui.deviceMonitor.value);
      persist();
    });
    ui.deviceMic.addEventListener("change", () => {
      state.settings.micDeviceId = ui.deviceMic.value;
      if (connected && state.settings.micPassthrough) {
        void engine.enableMic(ui.deviceMic.value, state.settings.micVolume);
      }
      persist();
    });
    ui.micPassthrough.addEventListener("change", () => {
      state.settings.micPassthrough = ui.micPassthrough.checked;
      if (connected) void applyRouting();
      setNode("mic", ui.micPassthrough.checked);
      persist();
    });
    ui.monitorEnabled.addEventListener("change", () => {
      state.settings.monitorEnabled = ui.monitorEnabled.checked;
      engine.setMonitorEnabled(ui.monitorEnabled.checked);
      persist();
    });
    ui.masterVolume.addEventListener("input", () => {
      const value = Number(ui.masterVolume.value) / 100;
      state.settings.masterVolume = value;
      engine.setMasterVolume(value);
      ui.masterValue.textContent = `${ui.masterVolume.value}%`;
      persist();
    });
    ui.micVolume.addEventListener("input", () => {
      const value = Number(ui.micVolume.value) / 100;
      state.settings.micVolume = value;
      engine.setMicVolume(value);
      ui.micValue.textContent = `${ui.micVolume.value}%`;
      persist();
    });
    ui.hotkeysEnabled.addEventListener("change", () => {
      state.settings.hotkeysEnabled = ui.hotkeysEnabled.checked;
      persist(true);
      toast(ui.hotkeysEnabled.checked ? "\u0E04\u0E35\u0E22\u0E4C\u0E25\u0E31\u0E14\u0E17\u0E33\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27" : "\u0E1B\u0E34\u0E14\u0E04\u0E35\u0E22\u0E4C\u0E25\u0E31\u0E14\u0E0A\u0E31\u0E48\u0E27\u0E04\u0E23\u0E32\u0E27 \u2014 \u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E41\u0E0A\u0E17\u0E44\u0E14\u0E49\u0E15\u0E32\u0E21\u0E1B\u0E01\u0E15\u0E34");
    });
    ui.stopAllHotkey.addEventListener("click", () => startListening("__stopAll", ui.stopAllHotkey));
    ui.addSound.addEventListener("click", async () => {
      addFiles(await window.api.pickSounds());
    });
    let dragDepth = 0;
    window.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      ui.dropVeil.dataset.visible = "true";
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("dragleave", () => {
      dragDepth -= 1;
      if (dragDepth <= 0) ui.dropVeil.dataset.visible = "false";
    });
    window.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      ui.dropVeil.dataset.visible = "false";
      const files = Array.from(event.dataTransfer?.files ?? []).map((file) => ({
        name: file.name.replace(/\.[^.]+$/, ""),
        filePath: window.api.getPathForFile(file)
      }));
      addFiles(files.filter((f) => f.filePath));
    });
  }
  window.api.onHotkeyPlay((soundId) => void trigger(soundId));
  window.api.onHotkeyStopAll(() => {
    engine.stopAll();
    markPlaying();
  });
  function meterLoop() {
    const levels = engine.readLevels();
    ui.meterMic.style.width = `${levels.mic * 100}%`;
    ui.meterPad.style.width = `${levels.soundpad * 100}%`;
    setNode("pad", levels.soundpad > 0.01);
    requestAnimationFrame(meterLoop);
  }
  async function boot() {
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
    navigator.mediaDevices.addEventListener("devicechange", () => void refreshDevices());
  }
  void boot();
})();
