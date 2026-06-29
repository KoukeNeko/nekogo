import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleSignin,
  isSuccessResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { API_BASE_URL } from '../api/contentApi';
import { GOOGLE_WEB_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../constants/authConfig';

/**
 * 登入「邏輯」（與 UI 分離）：取得 provider 的 id token → 交後端換自家 session。
 * 後端驗章後回傳 { sessionToken, user }；任何身分宣稱都由後端重新驗證，App 不自行信任。
 */

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface SessionResult {
  sessionToken: string;
  user: AuthUser;
}

// 提供者取消登入時，signIn* 回傳 null（非錯誤）。
const APPLE_CANCELED = 'ERR_REQUEST_CANCELED';

let googleConfigured = false;

/** 設定 GoogleSignin（冪等）。在 AuthProvider 掛載時呼叫一次。 */
export const configureGoogleSignIn = (): void => {
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    offlineAccess: false,
  });
  googleConfigured = true;
};

// 把 provider id token 交給後端換 session。後端驗證失敗會回非 2xx。
const exchangeWithBackend = async (path: string, body: object): Promise<SessionResult> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`サインインに失敗しました（${response.status}）`);
  }
  return (await response.json()) as SessionResult;
};

/**
 * Apple 登入（僅 iOS）。產生防重放 nonce（raw 給後端、SHA-256 給 Apple），
 * 取 identityToken 交後端驗證。使用者取消回 null。
 */
export const signInWithApple = async (): Promise<SessionResult | null> => {
  if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
    throw new Error('この端末では Apple サインインを利用できません');
  }
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce, // 傳「雜湊後」nonce 給 Apple；raw 送後端比對
    });
    if (!credential.identityToken) {
      throw new Error('Apple の identityToken を取得できませんでした');
    }
    // email / fullName 只在首次授權回傳，後續為 null → 一併送上，後端首登落地保存。
    return await exchangeWithBackend('/api/auth/apple', {
      token: credential.identityToken,
      nonce: rawNonce,
      email: credential.email ?? '',
      fullName: {
        givenName: credential.fullName?.givenName ?? '',
        familyName: credential.fullName?.familyName ?? '',
      },
    });
  } catch (error) {
    if ((error as { code?: string })?.code === APPLE_CANCELED) {
      return null; // 使用者取消，不視為錯誤
    }
    throw error;
  }
};

/**
 * Google 登入。取 idToken 交後端驗證（aud 須等於 Web client id）。使用者取消回 null。
 */
export const signInWithGoogle = async (): Promise<SessionResult | null> => {
  configureGoogleSignIn();
  await GoogleSignin.hasPlayServices(); // iOS 無作用，Android 必要
  try {
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      return null; // 取消 / 無可用憑證
    }
    const idToken = response.data.idToken;
    if (!idToken) {
      throw new Error('Google の idToken を取得できませんでした（webClientId 未設定の可能性）');
    }
    return await exchangeWithBackend('/api/auth/google', { token: idToken });
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
      return null;
    }
    throw error;
  }
};

/** 登出 Google（清掉原生 SDK 的快取憑證）；失敗不致命。 */
export const signOutGoogle = async (): Promise<void> => {
  try {
    await GoogleSignin.signOut();
  } catch {
    // 未曾以 Google 登入 / SDK 未設定時忽略
  }
};
