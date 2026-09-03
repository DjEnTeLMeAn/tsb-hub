const cryptoApi = () => globalThis.crypto;
const subtle = () => cryptoApi().subtle;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function base64urlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export function base64urlDecode(value) {
  if (typeof value !== 'string' || value.length > 16384 || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid base64url');
  if (value.length % 4 === 1) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded); const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  if (base64urlEncode(out) !== value) throw new Error('non-canonical base64url');
  return out;
}
export async function sha256(input) { return new Uint8Array(await subtle().digest('SHA-256', typeof input === 'string' ? new TextEncoder().encode(input) : input)); }
export async function hmacSha256(key, input) {
  const k = typeof CryptoKey !== 'undefined' && key instanceof CryptoKey ? key : await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return new Uint8Array(await subtle().sign('HMAC', k, typeof input === 'string' ? new TextEncoder().encode(input) : input));
}
export async function verifyHmacSha256(key, input, signature) {
  const k = typeof CryptoKey !== 'undefined' && key instanceof CryptoKey ? key : await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return subtle().verify('HMAC', k, signature, typeof input === 'string' ? new TextEncoder().encode(input) : input);
}
export { FORBIDDEN };
