/**
 * Redacts private or credential-like examples from upstream OpenAPI specs.
 */

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const USER_URL_PATTERN =
  /https:\/\/(?:apiqa|apidev)\.tal\.deere\.com\/platform\/users\/[A-Za-z0-9._~%-]+/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi;
const SENSITIVE_VALUE_LINE_PATTERN =
  /^(\s*(?:apiKey|clientKey|client_key|secret|token):\s*)(['"]?)([A-Za-z0-9+/=_.:-]{20,})(\2)(\s*(?:#.*)?)$/gim;
const CLIENT_KEY_EXAMPLE_PATTERN =
  /^(\s*example:\s*)(['"]?)(?:john)?deere-[0-9A-Za-z_-]{20,}(\2)(\s*(?:#.*)?)$/gim;
const OAUTH_PARAM_PATTERN =
  /\b(oauth_(?:consumer_key|nonce|signature|timestamp|token))=(\\?")?[^\\",\s<]+(\\?")?/gi;

function countIndent(line: string): number {
  let indent = 0;
  while (indent < line.length && line[indent] === ' ') {
    indent++;
  }
  return indent;
}

function removeInfoContactBlock(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];
  let inInfo = false;
  let infoIndent = -1;
  let skippingContactIndent: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = countIndent(line);

    if (skippingContactIndent !== null) {
      if (trimmed === '' || indent > skippingContactIndent) {
        continue;
      }
      skippingContactIndent = null;
    }

    if (trimmed !== '' && inInfo && indent <= infoIndent) {
      inInfo = false;
    }

    if (/^info:\s*(?:#.*)?$/.test(trimmed)) {
      inInfo = true;
      infoIndent = indent;
      output.push(line);
      continue;
    }

    if (inInfo && indent > infoIndent && /^contact:\s*(?:#.*)?$/.test(trimmed)) {
      skippingContactIndent = indent;
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

export function redactSensitiveText(content: string): string {
  return content
    .replace(/<redacted>|\[redacted\]/g, 'REDACTED')
    .replace(USER_URL_PATTERN, 'https://sandboxapi.deere.com/platform/users/USER')
    .replace(EMAIL_PATTERN, 'redacted@example.com')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer REDACTED')
    .replace(CLIENT_KEY_EXAMPLE_PATTERN, (_match, prefix, quote, closeQuote, suffix) => {
      return `${prefix}${quote}REDACTED${closeQuote}${suffix}`;
    })
    .replace(OAUTH_PARAM_PATTERN, (_match, name, open = '', close = '') => {
      return `${name}=${open}REDACTED${close}`;
    })
    .replace(SENSITIVE_VALUE_LINE_PATTERN, (_match, prefix, quote, _secret, closeQuote, suffix) => {
      return `${prefix}${quote}REDACTED${closeQuote}${suffix}`;
    });
}

export function redactSpecContent(content: string): string {
  return redactSensitiveText(removeInfoContactBlock(content));
}
