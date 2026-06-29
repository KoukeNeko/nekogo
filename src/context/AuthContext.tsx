import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { AuthUser, SessionResult } from '../services/auth';
import { AUTH_ENABLED, SESSION_TOKEN_KEY, USER_KEY } from '../constants/authConfig';

/**
 * 身分狀態（guest 優先 + 可關閉）。
 *
 * AUTH_ENABLED 關閉時（預設）：直接進入 guest，**完全不載入**任何原生模組
 * （expo-secure-store / google-signin / apple-authentication），因此 App 可在「未設定憑證」或
 * 「尚未重建含這些原生模組的 build」的情況下正常使用——先把其他功能做完，之後再開登入/同步。
 *
 * 啟用時：才動態載入上述模組（require），讀回/寫入 session（iOS Keychain，
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY）。規則：signIn / signOut 一律不觸碰本機 cards / revlog。
 */

// 僅在 AUTH_ENABLED 時才執行的動態載入（含原生模組）；型別用 typeof import 取得、執行期才真正 require。
const loadSecureStore = () => require('expo-secure-store') as typeof import('expo-secure-store');
const loadAuthService = () => require('../services/auth') as typeof import('../services/auth');

const AUTH_DISABLED_MESSAGE = 'ログイン機能は準備中です';

type AuthStatus = 'loading' | 'guest' | 'authed';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** 登入功能是否啟用；UI 可據此停用/隱藏登入入口。 */
  authEnabled: boolean;
  /** 回傳是否成功登入（false = 使用者取消）；未啟用時拋出「準備中」。 */
  signInWithApple: () => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  // 開機：未啟用 → 直接 guest（不碰原生模組）；啟用 → 動態載入並讀回既有 session。
  useEffect(() => {
    if (!AUTH_ENABLED) {
      setStatus('guest');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        loadAuthService().configureGoogleSignIn();
      } catch (error) {
        console.warn('Google Sign-In 設定失敗（稍後可重試）:', error);
      }
      try {
        const SecureStore = loadSecureStore();
        const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
        const rawUser = await SecureStore.getItemAsync(USER_KEY);
        if (cancelled) return;
        if (token && rawUser) {
          setUser(JSON.parse(rawUser) as AuthUser);
          setStatus('authed');
        } else {
          setStatus('guest');
        }
      } catch (error) {
        console.warn('讀取登入狀態失敗，以訪客繼續:', error);
        if (!cancelled) setStatus('guest');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (result: SessionResult): Promise<void> => {
    const SecureStore = loadSecureStore();
    const options: import('expo-secure-store').SecureStoreOptions = {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, result.sessionToken, options);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(result.user), options);
    setUser(result.user);
    setStatus('authed');
  };

  const signInWithApple = async (): Promise<boolean> => {
    if (!AUTH_ENABLED) throw new Error(AUTH_DISABLED_MESSAGE);
    const result = await loadAuthService().signInWithApple();
    if (!result) return false;
    await persist(result);
    return true;
  };

  const signInWithGoogle = async (): Promise<boolean> => {
    if (!AUTH_ENABLED) throw new Error(AUTH_DISABLED_MESSAGE);
    const result = await loadAuthService().signInWithGoogle();
    if (!result) return false;
    await persist(result);
    return true;
  };

  // 登出：清除 Keychain 的 session（不可動 cards / revlog → 保留本機 FSRS 進度）。
  const signOut = async (): Promise<void> => {
    if (!AUTH_ENABLED) return;
    const SecureStore = loadSecureStore();
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    await loadAuthService().signOutGoogle();
    setUser(null);
    setStatus('guest');
  };

  return (
    <AuthContext.Provider
      value={{ status, user, authEnabled: AUTH_ENABLED, signInWithApple, signInWithGoogle, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
