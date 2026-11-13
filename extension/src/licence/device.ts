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

/** A signed device request body. The counter only ever grows, so the server can refuse a replayed request. */
export function signedRequest(d: DeviceIdentity, userId: string, nowMs: number): { body: string; signature: string; device: DeviceIdentity } {
  const counter = Math.max(nowMs, d.counter + 1);
  const body = JSON.stringify({ user_id: userId, device_id: d.id, counter });
  const key = createPrivateKey({ key: Buffer.from(d.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const signature = sign(null, Buffer.from(body), key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { body, signature, device: { ...d, counter } };
}
