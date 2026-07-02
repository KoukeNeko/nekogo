import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { setContentLanguage } from '../api/contentApi';
import {
  TranslationLanguage,
  getTranslationLanguage,
  setTranslationLanguage as persistTranslationLanguage,
} from '../db/repositories/uiSettingsRepository';

// Stroke animation speed constants in milliseconds
export enum StrokeSpeed {
  Slow = 1000,
  Normal = 500,
  Fast = 250,
}

interface SettingsContextType {
  strokeSpeed: StrokeSpeed;
  setStrokeSpeed: (speed: StrokeSpeed) => void;
  /** 翻譯顯示語言：'zh' 繁中優先（缺譯退回英文）、'en' 英文原文。 */
  translationLanguage: TranslationLanguage;
  setTranslationLanguage: (language: TranslationLanguage) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [strokeSpeed, setStrokeSpeed] = useState<StrokeSpeed>(StrokeSpeed.Normal);
  const [translationLanguage, setTranslationLanguageState] = useState<TranslationLanguage>('zh');

  // 開機載入持久化的語言偏好，並同步給內容層（contentApi 依此組 SQL）。
  useEffect(() => {
    const stored = getTranslationLanguage();
    setTranslationLanguageState(stored);
    setContentLanguage(stored);
  }, []);

  const setTranslationLanguage = (language: TranslationLanguage) => {
    setTranslationLanguageState(language);
    setContentLanguage(language);
    try {
      persistTranslationLanguage(language);
    } catch (error) {
      console.error('儲存翻譯語言設定失敗', error);
    }
  };

  return (
    <SettingsContext.Provider value={{ strokeSpeed, setStrokeSpeed, translationLanguage, setTranslationLanguage }}>
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
