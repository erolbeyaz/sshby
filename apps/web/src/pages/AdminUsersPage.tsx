import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircleIcon, LoaderIcon } from 'lucide-react';
import { useState } from 'react';
import type { PublicUser, RegistrationSettings, UserRole } from '@sshby/shared';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { localeTag, useApiError, useI18n } from '@/lib/i18n';
import { useDocumentTitle } from '@/lib/use-document-title';

export function AdminUsersPage() {
  const { lang, t } = useI18n();
  const apiError = useApiError();
  const currentUser = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle('Users');

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<PublicUser[]>('/users'),
  });

  const registrationQuery = useQuery({
    queryKey: ['settings', 'registration'],
    queryFn: () => apiFetch<RegistrationSettings>('/settings/registration'),
  });

  function handleError(err: unknown) {
    setError(apiError(err));
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
      <p className="eyebrow">{t('admin.eyebrow')}</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{t('adminUsers.title')}</h1>

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
        <h2 className="eyebrow mb-4">{t('adminUsers.registrationPolicy')}</h2>
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
              {t('adminUsers.registrationOpen')}
              <span className="mt-0.5 block text-fg-dim">{t('adminUsers.registrationHint')}</span>
            </span>
          </label>
        ) : (
          <p className="font-mono text-[13px] text-fg-dim">{t('common.loading')}</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow mb-4">{t('adminUsers.accounts')}</h2>

        {usersQuery.isPending && (
          <p className="flex items-center gap-2 font-mono text-[13px] text-fg-dim">
            <LoaderIcon size={14} className="animate-spin" aria-hidden="true" />
            {t('common.loading')}
          </p>
        )}

        {usersQuery.data && (
          <div className="overflow-x-auto rounded-panel border border-line">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line bg-surface-2">
                <tr className="eyebrow">
                  <th className="px-4 py-2.5 font-medium">{t('adminUsers.colUser')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('adminUsers.colRole')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('adminUsers.colLastLogin')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('adminUsers.colStatus')}</th>
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
                          {isSelf && (
                            <span className="ml-2 text-[11px] text-fg-dim">
                              {t('adminUsers.you')}
                            </span>
                          )}
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
                          <option value="user">{t('adminUsers.roleUser')}</option>
                          <option value="admin">{t('adminUsers.roleAdmin')}</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-fg-dim">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleString(localeTag(lang))
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
                          {user.isActive ? t('adminUsers.deactivate') : t('adminUsers.activate')}
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
