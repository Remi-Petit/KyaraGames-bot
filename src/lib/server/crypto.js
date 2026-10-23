import crypto from 'node:crypto';
import fs from 'node:fs';
import { dataFile } from './config.js';

let keyCache = null;

/** Key used to encrypt the Kyara token at rest (local file, gitignored). */
function localKey() {
	if (keyCache) return keyCache;
	const file = dataFile('key.bin');
	if (!fs.existsSync(file)) {
		fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 });
	}
	keyCache = fs.readFileSync(file);
	if (keyCache.length !== 32) throw new Error('clé locale invalide');
	return keyCache;
}

/** AES-256-GCM -> base64(iv | tag | ciphertext) */
export function seal(plain) {
	if (!plain) return null;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', localKey(), iv);
	const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function unseal(blob) {
	if (!blob) return null;
	try {
		const buf = Buffer.from(blob, 'base64');
		const iv = buf.subarray(0, 12);
		const tag = buf.subarray(12, 28);
		const enc = buf.subarray(28);
		const decipher = crypto.createDecipheriv('aes-256-gcm', localKey(), iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}

/** Stable secret for signing the dashboard session cookie. */
export function sessionSecret(password) {
	if (password) {
		return crypto.createHmac('sha256', password).update('kyara-dashboard-v1').digest();
	}
	const file = dataFile('session.key');
	if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 });
	return fs.readFileSync(file);
}

export function sign(value, secret) {
	return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a, b) {
	const ba = Buffer.from(String(a));
	const bb = Buffer.from(String(b));
	return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
