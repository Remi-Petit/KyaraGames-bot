import crypto from 'node:crypto';
import { DASHBOARD_PASSWORD } from './config.js';
import {
	sessionSecret,
	sign,
	safeEqual,
	hashPassword,
	verifyPassword,
	randomPassword
} from './crypto.js';
import { db, save } from './state.js';

export const COOKIE = 'kyara_session';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/**
 * 'open'   : aucun utilisateur et pas de DASHBOARD_PASSWORD → accès libre (localhost).
 * 'users'  : authentification individuelle (cookie signé par utilisateur).
 */
export function authMode() {
	return db.users.length === 0 && !DASHBOARD_PASSWORD ? 'open' : 'users';
}

function secret() {
	return sessionSecret(DASHBOARD_PASSWORD);
}

export function makeSessionCookie(user) {
	const exp = Date.now() + MAX_AGE_MS;
	const value = `${user.id}.${user.version}.${exp}`;
	return `${value}.${sign(value, secret())}`;
}

export function currentUser(cookieValue) {
	if (!cookieValue) return null;
	const parts = String(cookieValue).split('.');
	if (parts.length !== 4) return null;

	const [id, version, exp, sig] = parts;
	const expiresAt = Number(exp);
	if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

	const user = db.users.find((u) => u.id === id);
	if (!user || String(user.version) !== version) return null;
	if (!safeEqual(sig, sign(`${id}.${version}.${exp}`, secret()))) return null;
	return user;
}

/** Vue publique d'un utilisateur (jamais le hash). */
export function publicUser(user) {
	if (!user) return null;
	return {
		id: user.id,
		username: user.username,
		role: user.role,
		createdAt: user.createdAt,
		lastLoginAt: user.lastLoginAt
	};
}

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                        */
/* ------------------------------------------------------------------ */

export function findUserByName(username) {
	const needle = String(username ?? '').trim().toLowerCase();
	if (!needle) return null;
	return db.users.find((u) => u.username.toLowerCase() === needle) ?? null;
}

export function createUser({ username, password, role = 'member' }) {
	const name = String(username ?? '').trim();
	if (name.length < 3) throw new Error("Le nom d'utilisateur doit faire au moins 3 caractères.");
	if (name.length > 32) throw new Error("Le nom d'utilisateur est trop long.");
	if (findUserByName(name)) throw new Error('Ce nom est déjà utilisé.');

	const pass = password ?? randomPassword();
	if (String(pass).length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.');

	const { salt, hash } = hashPassword(pass);
	const user = {
		id: crypto.randomUUID(),
		username: name,
		salt,
		hash,
		// Le tout premier utilisateur est forcément administrateur.
		role: db.users.length === 0 || role === 'admin' ? 'admin' : 'member',
		createdAt: new Date().toISOString(),
		lastLoginAt: null,
		version: 1
	};

	db.users.push(user);
	save();
	return { user, password: pass };
}

export function setUserPassword(user, password) {
	const pass = password ?? randomPassword();
	if (String(pass).length < 8) throw new Error('Le mot de passe doit faire au moins 8 caractères.');
	const { salt, hash } = hashPassword(pass);
	user.salt = salt;
	user.hash = hash;
	// invalide les sessions ouvertes pour cet utilisateur
	user.version = (user.version ?? 1) + 1;
	save();
	return pass;
}

export function deleteUser(user) {
	db.users = db.users.filter((u) => u.id !== user.id);
	save();
}

export function countAccountsOf(userId) {
	return db.accounts.filter((a) => a.ownerId === userId).length;
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */

export function login(username, password) {
	// Amorçage : tant qu'aucun utilisateur n'existe, DASHBOARD_PASSWORD sert de
	// mot de passe administrateur et les comptes existants lui sont rattachés.
	if (db.users.length === 0) {
		if (!DASHBOARD_PASSWORD || !safeEqual(password ?? '', DASHBOARD_PASSWORD)) return null;
		const { user } = createUser({
			username: String(username ?? '').trim() || 'admin',
			password: DASHBOARD_PASSWORD,
			role: 'admin'
		});
		for (const account of db.accounts) {
			if (!account.ownerId) account.ownerId = user.id;
		}
		user.lastLoginAt = new Date().toISOString();
		save();
		return user;
	}

	const user = findUserByName(username);
	// Coût constant quand l'utilisateur n'existe pas (évite de révéler les noms).
	if (!user) {
		verifyPassword({ salt: 'z'.repeat(32), hash: '0'.repeat(128) }, password);
		return null;
	}
	if (!verifyPassword({ salt: user.salt, hash: user.hash }, password)) return null;

	user.lastLoginAt = new Date().toISOString();
	save();
	return user;
}

