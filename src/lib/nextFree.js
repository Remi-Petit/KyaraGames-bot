/**
 * Compte à rebours avant la prochaine régénération de booster.
 *
 * `nextFreeAt` vient de Kyara et n'est rafraîchi qu'à chaque relevé `/api/me`.
 * Une fois l'échéance passée, la réserve continue de monter toute seule : la
 * date reste donc dans le passé et le compte à rebours afficherait
 * « maintenant » indéfiniment. On fait rouler l'ancre de `regenMs` en
 * `regenMs` pour retomber sur la *prochaine* régénération réelle.
 *
 * @param {string | null | undefined} nextFreeAt Date ISO du relevé
 * @param {number | null | undefined} regenMs Durée d'une régénération
 * @param {number} free Réserve projetée à l'instant `now`
 * @param {number} cap Plafond de la réserve
 * @param {number} [now]
 * @returns {number | null} ms restantes, ou `null` si plus rien n'est attendu
 */
export function nextFreeInMs(nextFreeAt, regenMs, free, cap, now = Date.now()) {
	const anchor = nextFreeAt ? Date.parse(nextFreeAt) : NaN;
	if (!Number.isFinite(anchor)) return null;
	// Réserve pleine : la régénération est perdue, il n'y a plus d'échéance.
	if (free >= cap) return null;
	if (!regenMs || now < anchor) return anchor - now;

	const ticks = Math.floor((now - anchor) / regenMs) + 1;
	return anchor + ticks * regenMs - now;
}
