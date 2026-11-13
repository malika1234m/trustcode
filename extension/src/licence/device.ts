// Device identity (pure -> unit-testable). Each installation gets a random id and its own Ed25519 key pair. The id is
// not derived from hardware (privacy, and hardware changes never lock anyone out); the private key never leaves this
// device's keychain and proves the device to the server when the licence is refreshed.
import { createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'crypto';

export interface DeviceIdentity { id: string; publicKey: string; privateKey: string; counter: number }

export function newDevice(): DeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  return { id: randomBytes(16).toString('hex'), publicKey: x, privateKey: (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64'), counter: 0 };
}

export function validDevice(d: any): d is DeviceIdentity {
  return d && /^[a-f0-9]{32}$/.test(d.id) && /^[A-Za-z0-9_-]{43}$/.test(d.publicKey) && typeof d.privateKey === 'string' && Number.isInteger(d.counter);
}

const b64u = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const privateKey = (d: DeviceIdentity) => createPrivateKey({ key: Buffer.from(d.privateKey, 'base64'), format: 'der', type: 'pkcs8' });

/**
 * A signed device request body. The counter only ever grows, so the server can refuse a replayed request.
 * `extra` carries what the device believes (licence id, revocation version) and the integrity signals (version, build).
 */
export function signedRequest(d: DeviceIdentity, userId: string, nowMs: number, extra: Record<string, unknown> = {}): { body: string; signature: string; device: DeviceIdentity } {
  const counter = Math.max(nowMs, d.counter + 1);
  const body = JSON.stringify({ ...extra, user_id: userId, device_id: d.id, counter });
  return { body, signature: b64u(sign(null, Buffer.from(body), privateKey(d))), device: { ...d, counter } };
}

/**
 * Proof for a server feature (server analysis): the request comes from a device that holds an activated key.
 * "<device id>.<unix seconds>.<signature of 'tcdev1.<user id>.<device id>.<unix seconds>'>"; the server accepts it for
 * a few minutes around its own time and checks that the device is still active for the account.
 */
export function deviceProof(d: DeviceIdentity, userId: string, serverNowMs: number): string {
  const t = Math.floor(serverNowMs / 1000);
  return `${d.id}.${t}.${b64u(sign(null, Buffer.from(`tcdev1.${userId}.${d.id}.${t}`), privateKey(d)))}`;
}
