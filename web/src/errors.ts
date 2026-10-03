import type { TFunction } from 'i18next';
import { ApiError } from './api';

export function errorMessage(t: TFunction, err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'generic';
  return t(`errors.${code}`, { defaultValue: t('errors.generic') });
}
