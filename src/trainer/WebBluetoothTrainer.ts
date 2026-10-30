import {
  decodeFeature,
  decodeIndoorBikeData,
  decodePowerRange,
  decodeResistanceRange,
  encodeRequestControl,
  encodeSimParams,
  encodeStart,
  encodeTargetPower,
  encodeTargetResistance,
  mergeSample,
  type IndoorBikeData,
} from '../ftms/codec';
import {
  CHAR_CONTROL_POINT,
  CHAR_FEATURE,
  CHAR_INDOOR_BIKE_DATA,
  CHAR_MACHINE_STATUS,
  CHAR_POWER_RANGE,
  CHAR_RESISTANCE_RANGE,
  RESULT,
  RESULT_NAMES,
  SERVICE_CYCLING_POWER,
  SERVICE_DEVICE_INFO,
  SERVICE_FTMS,
} from '../ftms/constants';
import { ControlQueue } from '../ftms/controlQueue';
import { backoffDelayMs } from './reconnect';
import {
  DEFAULT_CRR,
  DEFAULT_CW,
  Emitter,
  type LogEntry,
  type SimParamsOpts,
  type Trainer,
  type TrainerInfo,
  type TrainerSample,
  type TrainerStatus,
} from './Trainer';

export class WebBluetoothTrainer implements Trainer {
  status: TrainerStatus = 'disconnected';
  info: TrainerInfo = {};

  private samples = new Emitter<TrainerSample>();
  private statuses = new Emitter<TrainerStatus>();
  private logs = new Emitter<LogEntry>();
  private device: BluetoothDevice | null = null;
  private queue: ControlQueue | null = null;
  private chars: BluetoothRemoteGATTCharacteristic[] = [];
  private latest: IndoorBikeData = {};
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Must run inside a click handler: `requestDevice` needs a user gesture. */
  async connect() {
    this.wantConnected = true;
    try {
      if (!this.device) {
        this.device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [SERVICE_FTMS] }],
          optionalServices: [SERVICE_CYCLING_POWER, SERVICE_DEVICE_INFO],
        });
        this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
      }
      await this.establish();
    } catch (e) {
      this.wantConnected = false;
      this.setStatus('disconnected');
      this.log('error', `connect failed: ${(e as Error).message}`);
      throw e;
    }
  }

  async disconnect() {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.queue?.abort('disconnected');
    this.device?.gatt?.disconnect();
    this.setStatus('disconnected');
  }

  async setGrade(gradePct: number, o: SimParamsOpts = {}) {
    await this.command(
      encodeSimParams({
        windSpeed_ms: 0,
        grade_pct: gradePct,
        crr: o.crr ?? DEFAULT_CRR,
        cw: o.cw ?? DEFAULT_CW,
      }),
    );
  }

  async setTargetPower(watts: number) {
    await this.command(encodeTargetPower(watts));
  }

  async setResistance(level: number) {
    await this.command(encodeTargetResistance(level));
  }

  onSample(cb: (s: TrainerSample) => void) {
    return this.samples.on(cb);
  }
  onStatus(cb: (s: TrainerStatus) => void) {
    return this.statuses.on(cb);
  }
  onLog(cb: (e: LogEntry) => void) {
    return this.logs.on(cb);
  }

  private async command(data: Uint8Array) {
    if (!this.queue || this.status !== 'controlling')
      throw new Error('Trainer is not under control');
    const r = await this.queue.send(data);
    if (r.result !== RESULT.SUCCESS) {
      throw new Error(`Trainer rejected command: ${RESULT_NAMES[r.result] ?? r.result}`);
    }
  }

  /** Full connect sequence; also used after a dropout since control is lost on disconnect. */
  private async establish() {
    const device = this.device!;
    this.setStatus(this.status === 'reconnecting' ? 'reconnecting' : 'connecting');
    this.latest = {};
    this.info = { deviceName: device.name };

    const server = await device.gatt!.connect();
    const svc = await server.getPrimaryService(SERVICE_FTMS);

    // Feature and ranges are informational; a failed read must not abort the connection.
    const tryRead = async <T>(
      uuid: number,
      decode: (dv: DataView) => T,
    ): Promise<T | undefined> => {
      try {
        return decode(await (await svc.getCharacteristic(uuid)).readValue());
      } catch (e) {
        this.log('info', `read 0x${uuid.toString(16)} failed: ${(e as Error).message}`);
      }
    };
    this.info.feature = await tryRead(CHAR_FEATURE, decodeFeature);
    this.info.powerRange = await tryRead(CHAR_POWER_RANGE, decodePowerRange);
    this.info.resistanceRange = await tryRead(CHAR_RESISTANCE_RANGE, decodeResistanceRange);
    this.log('info', `trainer info: ${JSON.stringify(this.info)}`);

    for (const c of this.chars) c.removeEventListener('characteristicvaluechanged', this.onValue);
    this.chars = [];

    const cp = await svc.getCharacteristic(CHAR_CONTROL_POINT);
    this.queue = new ControlQueue(
      (d) => cp.writeValueWithResponse(d as BufferSource),
      (e) => this.logs.emit(e),
    );
    await this.listen(cp);

    try {
      await this.listen(await svc.getCharacteristic(CHAR_MACHINE_STATUS));
    } catch (e) {
      this.log('info', `machine status unavailable: ${(e as Error).message}`);
    }
    await this.listen(await svc.getCharacteristic(CHAR_INDOOR_BIKE_DATA));
    this.setStatus('connected');

    await this.expectOk(encodeRequestControl());
    await this.expectOk(encodeStart());
    this.setStatus('controlling');
  }

  private async expectOk(data: Uint8Array) {
    const r = await this.queue!.send(data);
    if (r.result !== RESULT.SUCCESS) {
      throw new Error(`opcode 0x${data[0].toString(16)}: ${RESULT_NAMES[r.result] ?? r.result}`);
    }
  }

  private async listen(c: BluetoothRemoteGATTCharacteristic) {
    c.addEventListener('characteristicvaluechanged', this.onValue);
    await c.startNotifications();
    this.chars.push(c);
  }

  private onValue = (ev: Event) => {
    const c = ev.target as BluetoothRemoteGATTCharacteristic;
    const dv = c.value;
    if (!dv) return;
    const uuid = c.uuid;
    if (uuid === uuid16(CHAR_INDOOR_BIKE_DATA)) {
      this.latest = mergeSample(this.latest, decodeIndoorBikeData(dv));
      this.samples.emit({ ...this.latest, t: performance.now() });
    } else if (uuid === uuid16(CHAR_CONTROL_POINT)) {
      this.queue?.handleIndication(dv);
    } else if (uuid === uuid16(CHAR_MACHINE_STATUS)) {
      this.log(
        'rx',
        `machine status: ${[...new Uint8Array(dv.buffer)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
      );
    }
  };

  private onDisconnected = () => {
    this.queue?.abort('disconnected');
    this.log('info', 'gatt server disconnected');
    if (!this.wantConnected) {
      this.setStatus('disconnected');
      return;
    }
    this.setStatus('reconnecting');
    this.scheduleReconnect(0);
  };

  private scheduleReconnect(attempt: number) {
    const delay = backoffDelayMs(attempt);
    this.log('info', `reconnect attempt ${attempt + 1} in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(async () => {
      if (!this.wantConnected) return;
      try {
        await this.establish();
      } catch (e) {
        this.log('error', `reconnect failed: ${(e as Error).message}`);
        if (this.wantConnected) {
          this.setStatus('reconnecting');
          this.scheduleReconnect(attempt + 1);
        }
      }
    }, delay);
  }

  private setStatus(s: TrainerStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  private log(dir: LogEntry['dir'], text: string) {
    this.logs.emit({ dir, text });
  }
}

/** Full 128-bit form of a 16-bit assigned UUID, as reported by `characteristic.uuid`. */
function uuid16(n: number): string {
  return `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}
