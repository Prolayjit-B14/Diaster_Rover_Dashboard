import { useState, useEffect, useRef, useCallback } from 'react';
import type { SensorPayload, CommandPayload, ChartPoint } from '../types/iot';
import { EMPTY_SENSOR } from '../types/iot';

export type { SensorPayload, CommandPayload, ChartPoint };
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const WS_URL: string = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:8765';
const HISTORY_LIMIT = 60;
const RECONNECT_DELAY_MS = 3000;

export interface IoTState {
  sensors: SensorPayload;
  history: ChartPoint[];
  status: ConnectionStatus;
  lastUpdated: Date | null;
  sendCommand: (cmd: CommandPayload) => void;
  wsUrl: string;
}

export function useIoTData(): IoTState {
  const [sensors, setSensors] = useState<SensorPayload>(EMPTY_SENSOR);
  const [history, setHistory] = useState<ChartPoint[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus('connected');
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;
        try {
          const payload = JSON.parse(event.data as string) as SensorPayload;
          setSensors(payload);
          setLastUpdated(new Date());
          setHistory(prev => {
            const point: ChartPoint = {
              ts: payload.ts ?? new Date().toISOString(),
              gas: payload.gas,
              temp: payload.temp,
              humidity: payload.humidity,
              distance: payload.distance,
              vibration: payload.vibration,
            };
            const next = [...prev, point];
            return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
          });
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus('error');
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setStatus('disconnected');
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    } catch {
      setStatus('error');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: CommandPayload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  return { sensors, history, status, lastUpdated, sendCommand, wsUrl: WS_URL };
}
