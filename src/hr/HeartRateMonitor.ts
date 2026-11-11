import { Emitter } from '../trainer/Trainer';
import { CHAR_HEART_RATE_MEASUREMENT, decodeHeartRate, SERVICE_HEART_RATE } from './codec';

export type HrStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** A reading older than this is treated as missing (sensor off, out of range). */
const STALE_MS = 5000;

/** A standard Bluetooth heart-rate source: chest strap, or a watch in heart-rate broadcast mode. */
export class HeartRateMonitor {
  status: HrStatus = 'disconnected';
  deviceName?: string;

  private statuses = new Emitter<HrStatus>();
  private readings = new Emitter<number>();
  private device: BluetoothDevice | null = null;
  private char: BluetoothRemoteGATTCharacteristic | null = null;
  private lastBpm: number | undefined;
  private lastAt = 0;
  private wantConnected = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Latest BPM, or undefined if there is none or it has gone stale. */
  current(now = performance.now()): number | undefined {
    return this.lastBpm !== undefined && now - this.lastAt <= STALE_MS ? this.lastBpm : undefined;
  }

  onStatus(cb: (s: HrStatus) => void) {
    return this.statuses.on(cb);
  }
  onReading(cb: (bpm: number) => void) {
    return this.readings.on(cb);
  }

  /** Must run inside a click handler: `requestDevice` needs a user gesture. */
  async connect() {
    this.wantConnected = true;
    try {
      if (!this.device) {
        this.device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [SERVICE_HEART_RATE] }],
        });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      }
      await this.establish();
    } catch (e) {
      this.wantConnected = false;
      this.setStatus('disconnected');
      throw e;
    }
  }

  disconnect() {
    this.wantConnected = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.char?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.device?.gatt?.disconnect();
    this.lastBpm = undefined;
    this.setStatus('disconnected');
  }

  private async establish() {
    const device = this.device!;
    if (this.status !== 'reconnecting') this.setStatus('connecting');
    this.deviceName = device.name;
    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(SERVICE_HEART_RATE);
    this.char?.removeEventListener('characteristicvaluechanged', this.onValue);
    this.char = await svc.getCharacteristic(CHAR_HEART_RATE_MEASUREMENT);
    this.char.addEventListener('characteristicvaluechanged', this.onValue);
    await this.char.startNotifications();
    this.setStatus('connected');
  }

  private onValue = (ev: Event) => {
    const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
    const r = dv && decodeHeartRate(dv);
    // Many straps send 0 bpm, or flag no contact, while not being worn.
    if (!r || r.bpm <= 0 || r.contact === false) return;
    this.lastBpm = r.bpm;
    this.lastAt = performance.now();
    this.readings.emit(r.bpm);
  };

  private onDisconnected = () => {
    if (!this.wantConnected) return this.setStatus('disconnected');
    this.setStatus('reconnecting');
    this.retry(0);
  };

  private retry(attempt: number) {
    const delay = Math.min(15000, 1000 * 2 ** attempt);
    this.timer = setTimeout(async () => {
      if (!this.wantConnected) return;
      try {
        await this.establish();
      } catch {
        if (this.wantConnected) this.retry(attempt + 1);
      }
    }, delay);
  }

  private setStatus(s: HrStatus) {
    this.status = s;
    this.statuses.emit(s);
  }
}
