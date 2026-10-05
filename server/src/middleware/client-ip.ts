import { isIP } from 'node:net';
import type { RequestHandler } from 'express';

/**
 * Work out who the visitor really is, for rate limiting only (the address is never stored or logged).
 *
 * Behind Render the app sits behind Cloudflare, so `req.ip` is a Cloudflare edge server that changes
 * between requests: limits keyed on it are leaky and unfair. Cloudflare puts the true visitor
 * address in `CF-Connecting-IP` and overwrites any forged copy, so with TRUST_CLOUDFLARE_IP=true we
 * use it. It stays OFF by default because on any host without Cloudflare in front, that header
 * would be attacker-controlled. Only a syntactically valid address is ever accepted.
 */
export function clientIp(trustCloudflare: boolean): RequestHandler {
  return (req, _res, next) => {
    let ip = req.ip;
    if (trustCloudflare) {
      const header = req.get('cf-connecting-ip')?.trim();
      if (header && isIP(header)) ip = header;
    }
    req.clientIp = ip;
    next();
  };
}
