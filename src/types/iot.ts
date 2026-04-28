// ============================================================
// IoT Data Types — matches hardware JSON payload exactly
// ============================================================

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SensorPayload {
  gas: number | null; // MQ-2
  temp: number | null; // DHT11
  humidity: number | null; // DHT11
  distance: number | null; // HC-SR04
  vibration: number | null; // MPU6050
  water: number | null;
  flame: boolean | null; // Flame Sensor
  motion: boolean | null; // PIR Sensor
  battery: number | null; // 18650 Cells
  speed: number | null;
  rssi: number | null;
  cpu: number | null; // RPi4 Load
  lat: number | null; // NEO-6M
  lng: number | null; // NEO-6M
  dropKit: 'locked' | 'dropped' | null; // Servo Status
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
    | 'DROP_KIT'
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
  flame: boolean | null;
  motion: boolean | null;
}

export const EMPTY_SENSOR: SensorPayload = {
  gas: null, temp: null, humidity: null,
  distance: null, vibration: null, water: null,
  flame: null, motion: null, dropKit: null,
  battery: null, speed: null, rssi: null, cpu: null,
  lat: null, lng: null, status: null, ts: null,
};
