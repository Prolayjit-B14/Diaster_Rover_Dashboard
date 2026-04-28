// ============================================================
// IoT Data Types — matches hardware JSON payload exactly
// ============================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SensorPayload {
  gas: number | null;
  temp: number | null;
  humidity: number | null;
  distance: number | null;
  vibration: number | null;
  water: number | null;
  battery: number | null;
  speed: number | null;
  rssi: number | null;
  cpu: number | null;
  lat: number | null;
  lng: number | null;
  status: 'nominal' | 'warning' | 'critical' | 'offline' | null;
  ts: string | null;
}

export interface CommandPayload {
  cmd:
    | 'MOVE'
    | 'STOP'
    | 'LED_ON'
    | 'LED_OFF'
    | 'BUZZER_ON'
    | 'BUZZER_OFF'
    | 'BEACON_ON'
    | 'BEACON_OFF'
    | 'SOS';
  dir?: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT';
  speed?: number;
}

export interface ChartPoint {
  ts: string;
  gas: number | null;
  temp: number | null;
  humidity: number | null;
  distance: number | null;
  vibration: number | null;
}

export const EMPTY_SENSOR: SensorPayload = {
  gas: null, temp: null, humidity: null,
  distance: null, vibration: null, water: null,
  battery: null, speed: null, rssi: null, cpu: null,
  lat: null, lng: null, status: null, ts: null,
};
