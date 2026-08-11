import { create } from 'zustand';
import type {
  AuthResponse,
  BootstrapInfo,
  LoginRequest,
  PublicUser,
  RegisterRequest,
} from '@sshby/shared';
import { apiFetch, ApiRequestError, setAccessToken, setRefreshHandler } from './api';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  bootstrap: BootstrapInfo | null;
  init: () => Promise<void>;
  refreshBootstrap: () => Promise<void>;
  login: (body: LoginRequest) => Promise<void>;
  register: (body: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Access token yenileme zamanlayıcısı. Token'ı süresi dolmadan biraz önce
 * tazeliyoruz; böylece kullanıcı çalışırken 401 görmüyor ve açık WebSocket
 * terminalleri kopmuyor.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_MARGIN_SECONDS = 60;

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  function applySession(response: AuthResponse): void {
    setAccessToken(response.accessToken);
    set({ status: 'authenticated', user: response.user });

    clearRefreshTimer();
    const delayMs = Math.max(response.expiresInSeconds - REFRESH_MARGIN_SECONDS, 30) * 1000;
    refreshTimer = setTimeout(() => void refreshSession(), delayMs);
  }

  function clearSession(): void {
    clearRefreshTimer();
    setAccessToken(null);
    set({ status: 'anonymous', user: null });
  }

  async function refreshSession(): Promise<boolean> {
    try {
      const response = await apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' });
      applySession(response);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  // apiFetch 401 aldığında bu işlevi çağırır.
  setRefreshHandler(refreshSession);

  return {
    status: 'loading',
    user: null,
    bootstrap: null,

    async init() {
      // Bootstrap her hâlükârda gerekli (kayıt açık mı, ilk çalıştırma mı).
      try {
        const bootstrap = await apiFetch<BootstrapInfo>('/bootstrap');
        set({ bootstrap });
      } catch {
        // API'ye ulaşılamıyorsa giriş ekranı yine de gösterilir; hata orada belli olur.
      }

      // Tarayıcıda refresh cookie'si varsa oturumu sessizce geri getir.
      const restored = await refreshSession();
      if (!restored) set({ status: 'anonymous' });
    },

    async refreshBootstrap() {
      const bootstrap = await apiFetch<BootstrapInfo>('/bootstrap');
      set({ bootstrap });
    },

    async login(body) {
      const response = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      applySession(response);
    },

    async register(body) {
      const response = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      applySession(response);
      // İlk kullanıcı kaydolduktan sonra "firstRun" artık geçerli değil.
      void get().refreshBootstrap();
    },

    async logout() {
      try {
        await apiFetch<void>('/auth/logout', { method: 'POST' });
      } catch (err) {
        // Sunucu tarafı zaten kapanmış olabilir; yerel oturumu her hâlükârda temizle.
        if (!(err instanceof ApiRequestError)) throw err;
      }
      clearSession();
    },
  };
});
