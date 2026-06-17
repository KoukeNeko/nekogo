import React, { createContext, useContext, useState, ReactNode } from 'react';

// Stroke animation speed constants in milliseconds
export enum StrokeSpeed {
  Slow = 1000,
  Normal = 500,
  Fast = 250,
}

interface SettingsContextType {
  strokeSpeed: StrokeSpeed;
  setStrokeSpeed: (speed: StrokeSpeed) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [strokeSpeed, setStrokeSpeed] = useState<StrokeSpeed>(StrokeSpeed.Normal);

  return (
    <SettingsContext.Provider value={{ strokeSpeed, setStrokeSpeed }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
