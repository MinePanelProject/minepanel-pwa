export class OriginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginValidationError';
  }
}

const isIpv4Address = (hostname: string): boolean => {
  const parts = hostname.split('.');

  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  );
};

const isLocalHostname = (hostname: string): boolean => {
  return (
    hostname.endsWith('.') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  );
};

const isLiteralIpAddress = (hostname: string): boolean => {
  return isIpv4Address(hostname) || hostname.startsWith('[') || hostname.includes(':');
};

export const validatePanelOrigin = (input: string, allowLocalhost = import.meta.env.DEV): string => {
  if (input.length === 0 || input !== input.trim()) {
    throw new OriginValidationError('Enter a complete HTTPS panel origin without surrounding spaces.');
  }

  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new OriginValidationError('Enter a valid panel origin, such as https://panel.example.com.');
  }

  if (url.username || url.password) {
    throw new OriginValidationError('Panel origins cannot include credentials.');
  }

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new OriginValidationError('Enter only the panel origin; paths, queries, and fragments are not allowed.');
  }

  const isExactLocalhost = url.hostname === 'localhost';
  const allowsLocalhost = allowLocalhost && isExactLocalhost && ['http:', 'https:'].includes(url.protocol);

  if (allowsLocalhost) {
    return url.origin;
  }

  if (url.protocol !== 'https:') {
    throw new OriginValidationError('Production panel origins must use HTTPS.');
  }

  if (isLocalHostname(url.hostname) || isLiteralIpAddress(url.hostname)) {
    throw new OriginValidationError('Use a browser-trusted public HTTPS hostname for a hosted panel.');
  }

  return url.origin;
};
