import React, { createContext, useContext } from 'react';
import { useIoTData } from '../hooks/useIoTData';
import type { IoTState } from '../hooks/useIoTData';
import { EMPTY_SENSOR } from '../types/iot';

const defaultState: IoTState = {
  sensors: EMPTY_SENSOR,
  history: [],
  status: 'disconnected',
  lastUpdated: null,
  sendCommand: () => {},
  wsUrl: '',
};

const IoTContext = createContext<IoTState>(defaultState);

export const IoTProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const iot = useIoTData();
  return <IoTContext.Provider value={iot}>{children}</IoTContext.Provider>;
};

export const useIoT = () => useContext(IoTContext);
