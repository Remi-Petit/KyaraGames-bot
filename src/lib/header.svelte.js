/**
 * Ce que la page publie à l'intention de la barre de navigation.
 *
 * Le compte Kyara sélectionné est un état *client* du dashboard (les puces de
 * compte ne changent pas d'URL) : le layout ne peut donc pas le charger
 * lui-même, il le lit ici.
 */
export const headerAccount = $state({
	/** @type {{ pseudo?: string, chakra?: number, discord?: { avatar?: string } } | null} */
	account: null,
	/** @type {{ label: string, tone: string } | null} */
	status: null
});
