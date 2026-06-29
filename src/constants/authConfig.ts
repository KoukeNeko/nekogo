/**
 * Google OAuth client ID（在 Google Cloud Console 建立後填入，或用 EXPO_PUBLIC_* 環境變數覆蓋）。
 *
 * - Web client ID：App（GoogleSignin 的 webClientId，決定後端可驗的 idToken aud）與後端
 *   （GOOGLE_WEB_CLIENT_ID）共用同一個值。
 * - iOS client ID：GoogleSignin 的 iosClientId。
 *
 * 這兩個皆為「公開的 client ID」（非密鑰），可進版控；client secret 絕不放這裡。
 * 未填時 Google 登入無法取得有效 idToken（Apple 登入不受影響）。
 */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

/** Google 登入是否已設定（webClientId 為取得後端可驗 idToken 的必要值）。 */
export const isGoogleConfigured = (): boolean => GOOGLE_WEB_CLIENT_ID.length > 0;

/**
 * 登入功能總開關（預設關閉 → guest-only）。
 * 關閉時 AuthContext 完全不載入原生模組（expo-secure-store / google-signin / apple-authentication），
 * 因此 App 在「未設定憑證」或「未重建含這些原生模組的版本」時仍可正常以訪客執行。
 * 設好 Google Web client id，或顯式設 EXPO_PUBLIC_AUTH_ENABLED=true 時自動開啟。
 */
export const AUTH_ENABLED =
  (process.env.EXPO_PUBLIC_AUTH_ENABLED ?? '').toLowerCase() === 'true' || isGoogleConfigured();

/** session token / user 存於 Keychain 的鍵（與原生模組無關，放此處供各模組共用而不觸發原生載入）。 */
export const SESSION_TOKEN_KEY = 'kioku.session_token';
export const USER_KEY = 'kioku.user';
