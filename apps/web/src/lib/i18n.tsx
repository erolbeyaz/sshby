import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiRequestError } from './api';
import { en } from './locales/en';
import { tr } from './locales/tr';

/**
 * Arayüz dili.
 *
 * Hazır bir i18n kütüphanesi yerine bu küçük katman yazıldı: ihtiyacımız iki
 * dil, düz anahtarlar ve basit değişken yerleştirmeden ibaret. react-i18next
 * bunun için birkaç yüz kilobayt, kendi yükleyici/namespace modeli ve
 * çalışma zamanında sessizce eksik anahtar davranışı getiriyordu.
 *
 * Buradaki yaklaşım eksik çeviriyi **derleme hatası** yapar: `en` sözlüğü
 * `tr`nin anahtar kümesiyle tiplenmiş durumda, bir anahtar eklenip
 * çevrilmezse `pnpm typecheck` düşer.
 */

export type Lang = 'tr' | 'en';

/** Türkçe sözlük anahtar kümesinin tek doğruluk kaynağı olur. */
export type TranslationKey = keyof typeof tr;

const DICTIONARIES: Record<Lang, Record<TranslationKey, string>> = { tr, en };

const STORAGE_KEY = 'sshby.lang';

/**
 * Kullanıcı seçim yapmadıysa tarayıcının diline uyulur. Seçim yapıldığı anda
 * kaydedilir ve bir daha tarayıcıya bakılmaz — kullanıcının açık tercihi,
 * tarayıcı ayarından her zaman önceliklidir.
 */
function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'tr' || saved === 'en') return saved;
  } catch {
    // Gizli sekmede localStorage erişimi hata verebiliyor; dil seçimi
    // uygulamayı açılmaz hâle getirecek kadar kritik değil.
  }
  return navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export type TranslateFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    /**
     * `<html lang>` ekran okuyucuların doğru sesletim kurallarını seçmesi ve
     * tarayıcının yazım denetimi için gerekli; sırf görsel bir ayar değil.
     */
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Kaydedilemezse dil yalnızca bu oturumda geçerli olur.
    }
  }, []);

  const t = useCallback<TranslateFn>(
    (key, vars) => {
      const template = DICTIONARIES[lang][key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      );
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n, I18nProvider içinde çağrılmalı');
  return value;
}

/** Yalnızca çeviri işlevine ihtiyaç duyan bileşenler için kısayol. */
export function useT(): TranslateFn {
  return useI18n().t;
}

/** `toLocaleDateString` gibi tarayıcı biçimlendiricileri için etiket. */
export function localeTag(lang: Lang): string {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}

function isTranslationKey(key: string): key is TranslationKey {
  return key in tr;
}

/**
 * API hatasını kullanıcının diline çevirir.
 *
 * Sunucu her hatada sabit bir `code` gönderiyor (`credential_name_taken`
 * gibi); metni burada seçmek, dil değiştiğinde hata mesajının da değişmesini
 * sağlıyor. Sunucuya ikinci bir çeviri katmanı eklemek yerine bu yol seçildi:
 * kodlar zaten sözleşmenin parçası ve tek çeviri kaynağı arayüzde kalıyor.
 *
 * Tanınmayan bir kodda sunucunun kendi mesajına düşülür — yeni bir hata
 * eklendiğinde kullanıcı boş ekran değil, en azından Türkçe bir açıklama görür.
 */
export function useApiError(): (err: unknown, fallback?: TranslationKey) => string {
  const { t } = useI18n();

  return useCallback(
    (err: unknown, fallback: TranslationKey = 'common.unexpectedError') => {
      if (!(err instanceof ApiRequestError)) return t(fallback);
      const key = `error.${err.code}`;
      if (isTranslationKey(key)) return t(key);
      return err.message || t(fallback);
    },
    [t],
  );
}
