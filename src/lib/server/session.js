import { DASHBOARD_PASSWORD } from './config.js';
import { sessionSecret, sign, safeEqual } from './crypto.js';

export const COOKIE = 'kyara_session';
const VALUE = 'ok';

export function authRequired() {
	return Boolean(DASHBOARD_PASSWORD);
}

export function makeCookieValue() {
	const secret = sessionSecret(DASHBOARD_PASSWORD);
	return `${VALUE}.${sign(VALUE, secret)}`;
}

export function isValidCookie(value) {
	if (!authRequired()) return true;
	if (!value) return false;
	const secret = sessionSecret(DASHBOARD_PASSWORD);
	const [v, sig] = String(value).split('.');
	if (!v || !sig) return false;
	return safeEqual(v, VALUE) && safeEqual(sig, sign(VALUE, secret));
}

export function checkPassword(candidate) {
	if (!authRequired()) return true;
	return safeEqual(candidate ?? '', DASHBOARD_PASSWORD);
}
