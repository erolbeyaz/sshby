import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConfigExportRequest,
  ConfigImportRequest,
  ConfigImportResult,
  ConfigPackage,
  CreateCredentialRequest,
  CreateFolderRequest,
  CredentialSummary,
  Folder,
  Host,
  HostInput,
  Inventory,
  MoveNodeRequest,
  UpdateCredentialRequest,
  UpdateFolderRequest,
} from '@sshby/shared';
import { apiFetch } from './api';

export const inventoryKey = ['inventory'] as const;
export const credentialsKey = ['credentials'] as const;

export function useInventory() {
  return useQuery({
    queryKey: inventoryKey,
    queryFn: () => apiFetch<Inventory>('/inventory'),
  });
}

export function useCredentials() {
  return useQuery({
    queryKey: credentialsKey,
    queryFn: () => apiFetch<CredentialSummary[]>('/credentials'),
  });
}

/** Envanteri değiştiren her mutasyondan sonra ağacı tazelemek için ortak yardımcı. */
function useInventoryMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKey });
      /**
       * Kasa listesi her kaydın kaç sunucuda kullanıldığını gösteriyor; sunucu
       * eklemek, silmek ya da kimlik bilgisini değiştirmek bu sayıyı
       * etkilediği için kasa da tazelenmeli.
       */
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
    },
  });
}

export function useCreateFolder() {
  return useInventoryMutation((body: CreateFolderRequest) =>
    apiFetch<Folder>('/folders', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateFolder() {
  return useInventoryMutation(({ id, ...body }: UpdateFolderRequest & { id: string }) =>
    apiFetch<Folder>(`/folders/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export function useDeleteFolder() {
  return useInventoryMutation((id: string) =>
    apiFetch<void>(`/folders/${id}`, { method: 'DELETE' }),
  );
}

export function useCreateHost() {
  return useInventoryMutation((body: HostInput) =>
    apiFetch<Host>('/hosts', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateHost() {
  return useInventoryMutation(({ id, ...body }: Partial<HostInput> & { id: string }) =>
    apiFetch<Host>(`/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  );
}

export function useCloneHost() {
  return useInventoryMutation((id: string) =>
    apiFetch<Host>(`/hosts/${id}/clone`, { method: 'POST' }),
  );
}

export function useDeleteHost() {
  return useInventoryMutation((id: string) => apiFetch<void>(`/hosts/${id}`, { method: 'DELETE' }));
}

export function useMoveNode() {
  return useInventoryMutation((body: MoveNodeRequest) =>
    apiFetch<{ ok: boolean }>('/inventory/move', { method: 'POST', body: JSON.stringify(body) }),
  );
}

function useCredentialMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
      // Sunucu kartları credential adını gösteriyor; o da tazelenmeli.
      void queryClient.invalidateQueries({ queryKey: inventoryKey });
    },
  });
}

export function useCreateCredential() {
  return useCredentialMutation((body: CreateCredentialRequest) =>
    apiFetch<CredentialSummary>('/credentials', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export function useUpdateCredential() {
  return useCredentialMutation(({ id, ...body }: UpdateCredentialRequest & { id: string }) =>
    apiFetch<CredentialSummary>(`/credentials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  );
}

export function useDeleteCredential() {
  return useCredentialMutation((id: string) =>
    apiFetch<void>(`/credentials/${id}`, { method: 'DELETE' }),
  );
}

// ------------------------------------------------ yapılandırma dışa/içe aktarma

/**
 * Dışa aktarma bir mutasyon olarak modellendi: sunucu durumu okumasına rağmen
 * önbelleğe alınmamalı. Paket parolası isteğin parçası ve üretilen dosya
 * kullanıcının açık talebiyle, tam o anda oluşmalı.
 */
export function useExportConfig() {
  return useMutation({
    mutationFn: (body: ConfigExportRequest) =>
      apiFetch<ConfigPackage>('/config/export', { method: 'POST', body: JSON.stringify(body) }),
  });
}

export function useImportConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ConfigImportRequest) =>
      apiFetch<ConfigImportResult>('/config/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inventoryKey });
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
    },
  });
}
