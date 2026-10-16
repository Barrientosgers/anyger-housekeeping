import type { TFunction } from 'i18next';
import type { BookingRequest } from './api';

/** "77 Sample Rd, Apt 4, Springfield 90210". Old requests only have the single address line. */
export function formatAddress(
  r: Pick<BookingRequest, 'address' | 'unit' | 'city' | 'zip'>,
): string {
  const cityZip = [r.city, r.zip].filter(Boolean).join(' ');
  return [r.address, r.unit, cityZip].filter(Boolean).join(', ');
}

/** "Casa" / "Oficina" / ... or '' for old requests that never asked. */
export function cleaningTypeLabel(t: TFunction, r: Pick<BookingRequest, 'cleaningType'>): string {
  return r.cleaningType ? t(`book.type_${r.cleaningType}`) : '';
}

/** A move-in or move-out clean, or '' for ordinary ones. */
export function moveLabel(t: TFunction, r: Pick<BookingRequest, 'moveType'>): string {
  return r.moveType === 'none' ? '' : t(`book.freq_${r.moveType}`);
}

/** The same rule the server applies: 10 digits, or 11 with a leading 1 (US numbers). */
export function isValidPhone(raw: string): boolean {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 && d[0] !== '0' && d[0] !== '1';
}
