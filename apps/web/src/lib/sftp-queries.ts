import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SftpListResponse } from '@sshby/shared';
import { ApiRequestError, apiFetch, getAccessToken } from './api';

/** Ham `fetch`/XHR çağrıları için yetki başlığı; apiFetch bunu kendisi ekler. */
const authHeader = (): string | null => {
  const token = getAccessToken();
  return token ? `Bearer ${token}` : null;
};

/**
 * Dizin içeriği önbelleği sunucu + yol + kip üçlüsüne göre.
 *
 * Kip anahtarın parçası: sudo ile ve sudo olmadan aynı dizinin içeriği
 * farklı olabilir (yetkisiz kullanıcı bazı girdileri hiç göremez), bu yüzden
 * ikisi aynı önbellek gözünü paylaşmamalı.
 */
export const sftpListKey = (hostId: string, path: string | null, sudo: boolean) =>
  ['sftp', hostId, sudo ? 'sudo' : 'normal', path ?? '~'] as const;

export function useSftpList(hostId: string | null, path: string | null, sudo = false) {
  return useQuery({
    queryKey: sftpListKey(hostId ?? '', path, sudo),
    enabled: Boolean(hostId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (sudo) params.set('sudo', '1');
      const query = params.toString();
      return apiFetch<SftpListResponse>(`/sftp/${hostId}/list${query ? `?${query}` : ''}`);
    },
    // Dosya sistemi bizim dışımızda da değişir; odak dönünce tazele.
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    /**
     * Bağlantı hataları yeniden denenir, yetki/bulunamadı hataları denenmez.
     *
     * Dosya paneli terminalin SSH bağlantısını ödünç alıyor; terminal
     * kapatıldığında bağlantı ölüyor ve bir sonraki istek başarısız oluyordu.
     * Sunucu yeni bir bağlantı kuruyor ama react-query hatayı önbelleğe alıp
     * pes ettiği için panel boş kalıyordu. Yeniden deneme, kullanıcının
     * yenile düğmesine basmasına gerek bırakmıyor.
     */
    retry: (failureCount, error) => {
      const code = error instanceof ApiRequestError ? error.code : null;
      if (code === 'permission_denied' || code === 'not_found' || code === 'sudo_password_required') {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: 400,
  });
}

function useSftpMutation<TVars, TData>(hostId: string, fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sftp', hostId] }),
  });
}

export function useMkdir(hostId: string, sudo: boolean) {
  return useSftpMutation(hostId, (path: string) =>
    apiFetch<{ path: string }>(`/sftp/${hostId}/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path, sudo }),
    }),
  );
}

export function useRename(hostId: string, sudo: boolean) {
  return useSftpMutation(hostId, (vars: { from: string; to: string }) =>
    apiFetch<{ path: string }>(`/sftp/${hostId}/rename`, {
      method: 'POST',
      body: JSON.stringify({ ...vars, sudo }),
    }),
  );
}

export function useChmod(hostId: string, sudo: boolean) {
  return useSftpMutation(hostId, (vars: { path: string; mode: string }) =>
    apiFetch<{ path: string }>(`/sftp/${hostId}/chmod`, {
      method: 'POST',
      body: JSON.stringify({ ...vars, sudo }),
    }),
  );
}

export function useDeleteEntry(hostId: string, sudo: boolean) {
  return useSftpMutation(hostId, (vars: { path: string; directory: boolean }) =>
    apiFetch<void>(`/sftp/${hostId}/delete`, {
      method: 'POST',
      body: JSON.stringify({ ...vars, sudo }),
    }),
  );
}

/** Sudo parolasini dogrular ve sunucu tarafinda oturum belegine alir. */
export async function enableSudo(hostId: string, password: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/sftp/${hostId}/sudo`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function disableSudo(hostId: string): Promise<void> {
  await apiFetch<void>(`/sftp/${hostId}/sudo`, { method: 'DELETE' });
}

/**
 * Yükleme `apiFetch` kullanmıyor: gövde ham `File` nesnesi olarak gidiyor ki
 * tarayıcı dosyayı belleğe toplamadan akıtabilsin. İlerleme bildirimi için
 * XHR gerekiyor — fetch'in yükleme ilerlemesi yok.
 */
export function uploadFile(
  hostId: string,
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
  sudo = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sftp/${hostId}/upload?path=${encodeURIComponent(path)}${sudo ? '&sudo=1' : ''}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const auth = authHeader();
    if (auth) xhr.setRequestHeader('Authorization', auth);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error(JSON.parse(xhr.responseText).error.message));
      } catch {
        reject(new Error(`Yükleme başarısız (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Yükleme sırasında ağ hatası.'));
    xhr.send(file);
  });
}

/**
 * İndirme, tarayıcının kendi indirme akışını kullanır. `fetch` ile blob'a
 * alıp indirmek büyük dosyayı belleğe toplardı; bunun yerine yetkilendirilmiş
 * bir istek atıp yanıtı akış hâlinde diske bırakıyoruz.
 */
export async function downloadFile(
  hostId: string,
  path: string,
  name: string,
  sudo = false,
): Promise<void> {
  const response = await fetch(
    `/api/sftp/${hostId}/download?path=${encodeURIComponent(path)}${sudo ? '&sudo=1' : ''}`,
    { headers: authHeader() ? { Authorization: authHeader() as string } : {} },
  );

  if (!response.ok) {
    const text = await response.text();
    try {
      throw new Error(JSON.parse(text).error.message);
    } catch {
      throw new Error(`İndirme başarısız (HTTP ${response.status}).`);
    }
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
