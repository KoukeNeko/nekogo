import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from './contentApi';
import { SESSION_TOKEN_KEY } from '../constants/authConfig';

/**
 * 帶 session 的受保護請求（與 contentApi 分離；內容端點維持公開不帶 token）。
 * 無 token 直接拋「未登入」；呼叫端應檢查 res.status === 401 並視為 session 失效（觸發登出）。
 */
export const authedFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  if (!token) {
    throw new Error('未登入');
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
};
