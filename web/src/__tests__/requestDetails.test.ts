import { describe, expect, it } from 'vitest';
import { formatAddress, isValidPhone } from '../requestDetails';

describe('formatAddress', () => {
  it('joins street, unit, city and ZIP, skipping what is missing', () => {
    expect(
      formatAddress({ address: '77 Sample Rd', unit: 'Apt 4', city: 'Springfield', zip: '90210' }),
    ).toBe('77 Sample Rd, Apt 4, Springfield 90210');
    expect(formatAddress({ address: null, unit: null, city: 'Springfield', zip: '90210' })).toBe(
      'Springfield 90210',
    );
  });

  it('still shows requests made before city and ZIP existed', () => {
    expect(formatAddress({ address: '1 Old St, Town', unit: null, city: null, zip: null })).toBe(
      '1 Old St, Town',
    );
  });
});

describe('isValidPhone', () => {
  it('accepts 10 digits in any common format, with or without a leading 1', () => {
    for (const ok of ['5550100199', '(555) 010-0199', '555.010.0199', '+1 555 010 0199'])
      expect(isValidPhone(ok)).toBe(true);
  });

  it('rejects numbers that are too short, too long, or start with 0 or 1', () => {
    for (const bad of ['', '555-0199', '555010019', '(055) 010-0199', '(155) 010-0199'])
      expect(isValidPhone(bad)).toBe(false);
  });
});
