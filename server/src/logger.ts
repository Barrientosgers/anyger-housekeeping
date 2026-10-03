import pino from 'pino';

// Logs carry event data only. Redaction is a safety net: request bodies and
// personal fields are never passed to the logger in the first place.
export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.clientName',
        '*.clientPhone',
        '*.address',
        '*.notes',
        '*.email',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
