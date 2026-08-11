import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircleIcon, LoaderIcon } from 'lucide-react';
import { useState } from 'react';
import type { PublicUser, RegistrationSettings, UserRole } from '@sshby/shared';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

export function AdminUsersPage() {
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<PublicUser[]>('/users'),
  });

  const registrationQuery = useQuery({
    queryKey: ['settings', 'registration'],
    queryFn: () => apiFetch<RegistrationSettings>('/settings/registration'),
  });

  function handleError(err: unknown) {
    setError(err instanceof ApiRequestError ? err.message : 'Beklenmeyen bir hata oluştu.');
  }

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      apiFetch<PublicUser>(`/users/${id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: handleError,
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiFetch<PublicUser>(`/users/${id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: handleError,
  });

  const registrationMutation = useMutation({
    mutationFn: (next: RegistrationSettings) =>
      apiFetch<RegistrationSettings>('/settings/registration', {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['settings', 'registration'] });
    },
    onError: handleError,
  });

  const registration = registrationQuery.data;

  return (
    <div className="mx-auto max-w-4xl px-8 py-12">
      <p className="eyebrow">Yönetim</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Kullanıcılar</h1>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <AlertCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="panel mt-8 p-5">
        <h2 className="eyebrow mb-4">Kayıt politikası</h2>
        {registration ? (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[#10B981]"
              checked={registration.open}
              disabled={registrationMutation.isPending}
              onChange={(e) =>
                registrationMutation.mutate({ ...registration, open: e.target.checked })
              }
            />
            <span className="text-[13px] leading-snug">
              Yeni kayıt alımı açık
              <span className="mt-0.5 block text-fg-dim">
                Kapatıldığında kimse kendi hesabını oluşturamaz; kullanıcıları buradan siz
                yönetirsiniz.
              </span>
            </span>
          </label>
        ) : (
          <p className="font-mono text-[13px] text-fg-dim">yükleniyor…</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow mb-4">Hesaplar</h2>

        {usersQuery.isPending && (
          <p className="flex items-center gap-2 font-mono text-[13px] text-fg-dim">
            <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
            yükleniyor…
          </p>
        )}

        {usersQuery.data && (
          <div className="overflow-x-auto rounded-panel border border-line">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line bg-surface-2">
                <tr className="eyebrow">
                  <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
                  <th className="px-4 py-2.5 font-medium">Rol</th>
                  <th className="px-4 py-2.5 font-medium">Son giriş</th>
                  <th className="px-4 py-2.5 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.map((user) => {
                  const isSelf = user.id === currentUser?.id;
                  return (
                    <tr key={user.id} className="border-b border-line last:border-b-0 bg-surface">
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {user.displayName}
                          {isSelf && <span className="ml-2 text-[11px] text-fg-dim">(siz)</span>}
                        </div>
                        <div className="font-mono text-[11.5px] text-fg-dim">{user.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="input py-1 text-[12.5px]"
                          value={user.role}
                          disabled={roleMutation.isPending}
                          onChange={(e) =>
                            roleMutation.mutate({ id: user.id, role: e.target.value as UserRole })
                          }
                        >
                          <option value="user">kullanıcı</option>
                          <option value="admin">yönetici</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-fg-dim">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString('tr-TR')
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="btn py-1 text-[12.5px]"
                          disabled={activeMutation.isPending}
                          onClick={() =>
                            activeMutation.mutate({ id: user.id, isActive: !user.isActive })
                          }
                        >
                          {user.isActive ? 'Pasife al' : 'Etkinleştir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
