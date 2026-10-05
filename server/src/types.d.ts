import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** The visitor's address as resolved by middleware/client-ip.ts. Used only to key rate limits. */
      clientIp?: string;
    }
  }
}
