import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import es from '../i18n/es.json';

const keys = (obj: object, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('translations', () => {
  it('Spanish and English have exactly the same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });
});
