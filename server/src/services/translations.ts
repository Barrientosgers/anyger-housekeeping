import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Logger } from '../logger.js';
import { getAppointment } from './appointments.js';
import { getRequest } from './requests.js';
import { detectLanguage } from './translate/detect.js';
import type { Lang, Translator, TranslateFailure } from './translate/types.js';
import { countUsage } from './usage.js';

export const CACHE_RETENTION_DAYS = 30;

export type NoteEntity = 'request' | 'appointment';

/**
 * Translating is a convenience, never a requirement: every outcome here is a normal answer (the
 * caller always still has the original note), and nothing in this file throws on a provider problem.
 */
export type TranslationOutcome =
  | { status: 'disabled' | 'empty' | 'same_language' | 'unknown_language' }
  | {
      status: 'translated';
      sourceLang: Lang;
      targetLang: Lang;
      original: string;
      translation: string;
      cached: boolean;
    }
  | { status: 'unavailable'; reason: TranslateFailure | 'limit' };

interface Deps {
  pool: pg.Pool;
  translator: Translator | null;
  dailyLimit: number;
  logger: Logger;
}

const hashOf = (from: Lang, to: Lang, text: string) =>
  createHash('sha256').update(`${from}:${to}:${text}`).digest('hex');

async function translatedToday(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT coalesce(sum(count), 0)::int AS n FROM usage_counters
     WHERE event = 'translations_performed'
       AND day = (now() AT TIME ZONE 'America/Los_Angeles')::date`,
  );
  return rows[0]?.n ?? 0;
}

/** Returns null when the entity does not exist. The text always comes from the database. */
export async function translateNote(
  deps: Deps,
  entity: NoteEntity,
  id: string,
  target: Lang,
): Promise<TranslationOutcome | null> {
  const { pool, translator, logger } = deps;

  // Read the note from our own database: callers can never submit arbitrary text, so this cannot
  // be used as a free general-purpose translation service.
  let text: string | null;
  let hint: Lang | null = null;
  if (entity === 'request') {
    const r = await getRequest(pool, id);
    if (!r) return null;
    text = r.notes;
    hint = r.lang; // the language the client used the form in
  } else {
    const a = await getAppointment(pool, id);
    if (!a) return null;
    text = a.notes;
  }

  if (!translator) return { status: 'disabled' };
  if (!text?.trim()) return { status: 'empty' };

  const detected = detectLanguage(text);
  const source = detected === 'unknown' ? hint : detected;
  if (!source) return { status: 'unknown_language' };
  if (source === target) return { status: 'same_language' };

  const key = hashOf(source, target, text);
  const cached = await pool.query<{ translated_text: string }>(
    'SELECT translated_text FROM translation_cache WHERE source_hash = $1',
    [key],
  );
  if (cached.rows[0]) {
    return {
      status: 'translated',
      sourceLang: source,
      targetLang: target,
      original: text,
      translation: cached.rows[0].translated_text,
      cached: true,
    };
  }

  try {
    if ((await translatedToday(pool)) >= deps.dailyLimit) {
      logger.warn('translation skipped: daily limit reached');
      return { status: 'unavailable', reason: 'limit' };
    }
    const result = await translator.translate(text, source, target);
    if (!result.ok) {
      await countUsage(pool, 'translations_failed');
      logger.warn({ provider: translator.name, reason: result.reason }, 'translation failed');
      return { status: 'unavailable', reason: result.reason };
    }
    await pool.query(
      `INSERT INTO translation_cache (source_hash, source_lang, target_lang, translated_text, provider)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_hash) DO NOTHING`,
      [key, source, target, result.text, translator.name],
    );
    await countUsage(pool, 'translations_performed');
    logger.info({ provider: translator.name, from: source, to: target }, 'translation done');
    return {
      status: 'translated',
      sourceLang: source,
      targetLang: target,
      original: text,
      translation: result.text,
      cached: false,
    };
  } catch (err) {
    logger.error({ errName: (err as Error).name }, 'translation error');
    return { status: 'unavailable', reason: 'network' };
  }
}

/** Delete cached translations older than 30 days so copies of notes do not accumulate. */
export async function purgeOldTranslations(pool: pg.Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM translation_cache WHERE created_at < now() - make_interval(days => $1)`,
    [CACHE_RETENTION_DAYS],
  );
  return rowCount ?? 0;
}
