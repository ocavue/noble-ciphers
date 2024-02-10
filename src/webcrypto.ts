// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
// node.js versions earlier than v19 don't declare it in global scope.
// For node.js, package.js on#exports field mapping rewrites import
// from `crypto` to `cryptoNode`, which imports native module.
// Makes the utils un-importable in browsers without a bundler.
// Once node.js 18 is deprecated, we can just drop the import.
//
// Use full path so that Node.js can rewrite it to `cryptoNode.js`.
// @ts-ignore: `tsc` doesn't understand `@noble/ciphers/crypto` is a valid import.
import { randomBytes, getWebcryptoSubtle } from '@noble/ciphers/crypto';
import { Cipher, concatBytes } from './utils.js';
import { number } from './_assert.js';
import { AsyncCipher } from './utils.js';
import { bytes as abytes } from './_assert.js';

/**
 * Secure PRNG. Uses `crypto.getRandomValues`, which defers to OS.
 */
export { randomBytes, getWebcryptoSubtle };

type RemoveNonceInner<T extends any[], Ret> = ((...args: T) => Ret) extends (
  arg0: any,
  arg1: any,
  ...rest: infer R
) => any
  ? (key: Uint8Array, ...args: R) => Ret
  : never;

type RemoveNonce<T extends (...args: any) => any> = RemoveNonceInner<Parameters<T>, ReturnType<T>>;
type CipherWithNonce = ((key: Uint8Array, nonce: Uint8Array, ...args: any[]) => Cipher) & {
  nonceLength: number;
};

// Uses CSPRG for nonce, nonce injected in ciphertext
export function managedNonce<T extends CipherWithNonce>(fn: T): RemoveNonce<T> {
  number(fn.nonceLength);
  return ((key: Uint8Array, ...args: any[]): any => ({
    encrypt: (plaintext: Uint8Array, ...argsEnc: any[]) => {
      const { nonceLength } = fn;
      const nonce = randomBytes(nonceLength);
      const ciphertext = (fn(key, nonce, ...args).encrypt as any)(plaintext, ...argsEnc);
      const out = concatBytes(nonce, ciphertext);
      ciphertext.fill(0);
      return out;
    },
    decrypt: (ciphertext: Uint8Array, ...argsDec: any[]) => {
      const { nonceLength } = fn;
      const nonce = ciphertext.subarray(0, nonceLength);
      const data = ciphertext.subarray(nonceLength);
      return (fn(key, nonce, ...args).decrypt as any)(data, ...argsDec);
    },
  })) as RemoveNonce<T>;
}

// Overridable
export const utils = {
  async encrypt(key: Uint8Array, keyParams: any, cryptParams: any, plaintext: Uint8Array) {
    const cr = getWebcryptoSubtle();
    const iKey = await cr.importKey('raw', key, keyParams, true, ['encrypt']);
    const ciphertext = await cr.encrypt(cryptParams, iKey, plaintext);
    return new Uint8Array(ciphertext);
  },
  async decrypt(key: Uint8Array, keyParams: any, cryptParams: any, ciphertext: Uint8Array) {
    const cr = getWebcryptoSubtle();
    const iKey = await cr.importKey('raw', key, keyParams, true, ['decrypt']);
    const plaintext = await cr.decrypt(cryptParams, iKey, ciphertext);
    return new Uint8Array(plaintext);
  },
};

const enum BlockMode {
  CBC = 'AES-CBC',
  CTR = 'AES-CTR',
  GCM = 'AES-GCM',
}

function getCryptParams(algo: BlockMode, nonce: Uint8Array, AAD?: Uint8Array) {
  if (algo === BlockMode.CBC) return { name: BlockMode.CBC, iv: nonce };
  if (algo === BlockMode.CTR) return { name: BlockMode.CTR, counter: nonce, length: 64 };
  if (algo === BlockMode.GCM) return { name: BlockMode.GCM, iv: nonce, additionalData: AAD };
  throw new Error('unknown aes block mode');
}

function generate(algo: BlockMode) {
  return (key: Uint8Array, nonce: Uint8Array, AAD?: Uint8Array): AsyncCipher => {
    abytes(key);
    abytes(nonce);
    // const keyLength = key.length;
    const keyParams = { name: algo, length: key.length * 8 };
    const cryptParams = getCryptParams(algo, nonce, AAD);
    return {
      // keyLength,
      encrypt(plaintext: Uint8Array) {
        abytes(plaintext);
        return utils.encrypt(key, keyParams, cryptParams, plaintext);
      },
      decrypt(ciphertext: Uint8Array) {
        abytes(ciphertext);
        return utils.decrypt(key, keyParams, cryptParams, ciphertext);
      },
    };
  };
}

export const cbc = generate(BlockMode.CBC);
export const ctr = generate(BlockMode.CTR);
export const gcm = generate(BlockMode.GCM);

// // Type tests
// import { siv, gcm, ctr, ecb, cbc } from '../aes.js';
// import { xsalsa20poly1305 } from '../salsa.js';
// import { chacha20poly1305, xchacha20poly1305 } from '../chacha.js';

// const wsiv = managedNonce(siv);
// const wgcm = managedNonce(gcm);
// const wctr = managedNonce(ctr);
// const wcbc = managedNonce(cbc);
// const wsalsapoly = managedNonce(xsalsa20poly1305);
// const wchacha = managedNonce(chacha20poly1305);
// const wxchacha = managedNonce(xchacha20poly1305);

// // should fail
// const wcbc2 = managedNonce(managedNonce(cbc));
// const wecb = managedNonce(ecb);