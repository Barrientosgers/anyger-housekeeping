import type { TFunction } from 'i18next';
import type { Freq } from './api';
import { formatWeekdayLong, ordinalOf } from './dates';

/** "Cada semana", "Cada mes, el segundo martes", ... `date` supplies the weekday and, for new
 * series, the ordinal; existing series pass the ordinal the server computed. */
export function repeatLabel(
  t: TFunction,
  freq: Freq,
  date: string,
  lang: string,
  ordinal?: number | null,
): string {
  if (freq === 'monthly') {
    return t('form.repeat_monthly', {
      ordinal: t(`ordinal.${ordinal ?? ordinalOf(date)}`),
      weekday: formatWeekdayLong(date, lang),
    });
  }
  return t(`form.repeat_${freq}`);
}
