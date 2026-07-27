import type { RetriggerMode } from '../shared/types';

/**
 * setSinkId เพิ่งถูกใส่เข้า lib.dom ไม่นานนี้ ประกาศแบบ optional ไว้เอง
 * โค้ดจะได้คอมไพล์ผ่านทั้ง TypeScript รุ่นเก่าและใหม่
 */
type SinkAudioElement = HTMLAudioElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

export interface EngineLevels {
  soundpad: number;
  mic: number;
}

/**
 * โครงสร้างสายสัญญาณ
 *
 *   ไฟล์เสียง ─▶ perSoundGain ─▶ masterGain ─┬─▶ limiter ─▶ virtualDest ─▶ <audio sinkId = CABLE Input> ─▶ Discord
 *   ไมค์จริง  ─▶ micGain ────────────────────┼───────────▶ virtualDest   (ตรง ไม่ผ่านลิมิตเตอร์ กัน pumping)
 *                                            └─▶ monitorGain ─▶ monitorDest ─▶ <audio sinkId = หูฟังเรา>
 *
 * จุดสำคัญ: micGain ต่อเข้า virtualDest อย่างเดียว ไม่ต่อเข้า monitorDest
 * ถ้าต่อเข้าหูฟังด้วยแล้วใช้ลำโพง เสียงจะวนกลับเข้าไมค์กลายเป็นหอน (feedback)
 *
 * ทำไมใช้ MediaStreamDestination + <audio> แทนการ setSinkId บน AudioContext ตรง ๆ:
 * setSinkId บน HTMLAudioElement รองรับมานาน เสถียรกว่า และทำให้เรายังได้
 * ความสามารถของ Web Audio (ผสมเสียงหลายชั้น, คุมเกน, หยุดกลางคัน) ครบ
 */
export class AudioEngine {
  private readonly ctx: AudioContext;
  private readonly masterGain: GainNode;
  private readonly monitorGain: GainNode;
  private readonly micGain: GainNode;
  /** ลิมิตเตอร์กันเสียงแตก — คุมเฉพาะสายแพด ไมค์ไม่เกี่ยว */
  private readonly limiter: DynamicsCompressorNode;
  private readonly virtualDest: MediaStreamAudioDestinationNode;
  private readonly monitorDest: MediaStreamAudioDestinationNode;
  private readonly virtualEl: SinkAudioElement;
  private readonly monitorEl: SinkAudioElement;
  private readonly soundpadMeter: AnalyserNode;
  private readonly micMeter: AnalyserNode;
  private readonly meterBuffer = new Float32Array(512);

  /** cache ของเสียงที่ decode แล้ว key = sound.id */
  private readonly buffers = new Map<string, AudioBuffer>();
  /** source + gain ที่กำลังเล่นอยู่ แยกตามเสียง เพื่อสั่งหยุด/รีสตาร์ตได้ */
  private readonly playing = new Map<string, Set<{ source: AudioBufferSourceNode; gain: GainNode }>>();

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  constructor() {
    // latencyHint 'interactive' บอก Chromium ให้เลือก buffer เล็กที่สุดเท่าที่ไหว
    // กดปุ่มแล้วเสียงออกเร็วขึ้นชัดเจน แลกกับ CPU นิดหน่อย
    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    this.masterGain = this.ctx.createGain();
    this.monitorGain = this.ctx.createGain();
    this.micGain = this.ctx.createGain();

    /**
     * ลิมิตเตอร์แบบเบามือ: เริ่มกดที่ -3dB ด้วย knee กว้าง กดแบบค่อยเป็นค่อยไป
     * จุดสำคัญคือมันคุมเฉพาะ "เสียงแพด" — เสียงไมค์วิ่งอีกสายไม่โดนกดด้วย
     * (เวอร์ชันก่อนต่อไมค์ผ่านตัวเดียวกัน ทำให้เสียงพูดโดนบีบตามจังหวะกดเสียง = pumping)
     */
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.005;
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
  async start(): Promise<void> {
    await this.ctx.resume();
    await this.virtualEl.play();
    await this.monitorEl.play();
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /**
   * ขอสิทธิ์ไมค์ 1 ครั้ง — นอกจากใช้ส่งเสียงพูดแล้ว ยังเป็นเงื่อนไขที่ทำให้
   * enumerateDevices() คืน "ชื่อ" อุปกรณ์มาให้ ถ้าไม่ขอ เราจะเห็นแต่ id เปล่า ๆ
   * เลือก CABLE Input ไม่ถูกแน่นอน
   */
  static async unlockDeviceLabels(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  }

  async setOutputDevice(deviceId: string | null): Promise<void> {
    if (!deviceId || typeof this.virtualEl.setSinkId !== 'function') return;
    await this.virtualEl.setSinkId(deviceId);
  }

  async setMonitorDevice(deviceId: string | null): Promise<void> {
    if (!deviceId || typeof this.monitorEl.setSinkId !== 'function') return;
    await this.monitorEl.setSinkId(deviceId);
  }

  setMasterVolume(value: number): void {
    this.rampTo(this.masterGain, value);
  }

  setMonitorEnabled(enabled: boolean): void {
    this.rampTo(this.monitorGain, enabled ? 1 : 0);
  }

  setMicVolume(value: number): void {
    this.rampTo(this.micGain, value);
  }

  /** เลี่ยง .value = x ตรง ๆ เพราะเกนกระโดดทันทีจะได้ยินเสียง "แปะ" */
  private rampTo(node: GainNode, value: number): void {
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(Math.max(0, Math.min(1.5, value)), now + 0.02);
  }

  async enableMic(deviceId: string | null, volume: number): Promise<void> {
    await this.disableMic();
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // ปิดการประมวลผลของเบราว์เซอร์ทิ้ง ปล่อยให้ Discord จัดการเอง
        // ถ้าเปิด echoCancellation ไว้ มันจะมองเสียง soundpad เป็นเสียงสะท้อนแล้วหักออก
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.micSource = this.ctx.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.micGain);
    this.setMicVolume(volume);
  }

  async disableMic(): Promise<void> {
    this.micSource?.disconnect();
    this.micSource = null;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
  }

  hasBuffer(soundId: string): boolean {
    return this.buffers.has(soundId);
  }

  /**
   * decode ล่วงหน้าแล้วเก็บไว้ในแรม
   * ไฟล์ mp3 30 วินาทีกินราว 5 MB ตอน decode แล้ว ซึ่งรับได้
   * ผลตอบแทนคือกดปุ่มแล้วเสียงออกทันที ไม่ต้องรอ decode ตอนกด
   */
  async load(soundId: string, filePath: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(soundId);
    if (cached) return cached;

    const bytes = await window.api.readSound(filePath);
    if (!bytes) throw new Error('อ่านไฟล์ไม่ได้ — ไฟล์อาจถูกย้ายหรือลบไปแล้ว');

    // decodeAudioData จะ "ยึด" ArrayBuffer ไปเลย จึง slice สำเนาออกมาก่อน
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const buffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.buffers.set(soundId, buffer);
    return buffer;
  }

  async play(
    soundId: string,
    filePath: string,
    volume: number,
    mode: RetriggerMode,
  ): Promise<void> {
    const running = this.playing.get(soundId);
    if (running && running.size > 0) {
      if (mode === 'ignore') return;
      if (mode === 'restart') this.stop(soundId);
    }

    const buffer = await this.load(soundId, filePath);
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    source.connect(gain).connect(this.masterGain);

    const entry = { source, gain };
    const set = this.playing.get(soundId) ?? new Set<{ source: AudioBufferSourceNode; gain: GainNode }>();
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
  stop(soundId: string): void {
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
        /* หยุดไปแล้ว */
      }
    }
    set.clear();
  }

  stopAll(): void {
    for (const soundId of this.playing.keys()) this.stop(soundId);
  }

  isPlaying(soundId: string): boolean {
    return (this.playing.get(soundId)?.size ?? 0) > 0;
  }

  forget(soundId: string): void {
    this.stop(soundId);
    this.buffers.delete(soundId);
    this.playing.delete(soundId);
  }

  /** ค่า RMS 0..1 ของทั้งสองสาย ใช้ขับแถบไฟบนหน้าจอ */
  readLevels(): EngineLevels {
    return {
      soundpad: this.rms(this.soundpadMeter),
      mic: this.rms(this.micMeter),
    };
  }

  private rms(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.meterBuffer);
    let sum = 0;
    for (let i = 0; i < this.meterBuffer.length; i += 1) {
      const sample = this.meterBuffer[i] ?? 0;
      sum += sample * sample;
    }
    return Math.min(1, Math.sqrt(sum / this.meterBuffer.length) * 3);
  }
}
