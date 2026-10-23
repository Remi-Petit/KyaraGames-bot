<script>
	import { onMount } from 'svelte';
	import { nextFreeInMs } from '#lib/nextFree.js';
	import { headerAccount } from '#lib/header.svelte.js';

	let { data } = $props();

	let raw = $state(data.snapshot);
	let now = $state(data.snapshot.now ?? Date.now());
	let acctId = $state(data.snapshot.selected?.id ?? null);
	let pending = $state(null);
	let flash = $state(null);
	let dirty = $state(false);
	let adding = $state(false);
	let me = $state(data.me);
	let streamState = $state('connecting');
	let settings = $state({ ...(data.snapshot.selected?.settings ?? {}) });
	let tokenInput = $state('');
	let tokenVisible = $state(false);
	let tokenBusy = $state(false);

	// Vue aplatie : les sections du dashboard continuent de lire snap.account / snap.bot / ...
	const snap = $derived({
		meta: raw.meta,
		accounts: raw.accounts,
		maxAccounts: raw.maxAccounts,
		...(raw.selected ?? {})
	});

	const RARITY = {
		C: { label: 'Commune', color: '#8b93a7' },
		U: { label: 'Peu commune', color: '#4ade80' },
		R: { label: 'Rare', color: '#60a5fa' },
		E: { label: 'Épique', color: '#a78bfa' },
		L: { label: 'Légendaire', color: '#fbbf24' },
		M: { label: 'Mythique', color: '#f472b6' }
	};
	const ORDER = ['C', 'U', 'R', 'E', 'L', 'M'];

	async function refresh() {
		try {
			const query = acctId ? `?account=${encodeURIComponent(acctId)}` : '';
			const res = await fetch('/api/state' + query, { cache: 'no-store' });
			if (res.ok) {
				raw = await res.json();
				if (raw.selected?.id) acctId = raw.selected.id;
			}
		} catch {
			/* hors ligne : on garde le dernier état */
		}
	}

	async function selectAccount(id) {
		if (id === acctId) return;
		acctId = id;
		dirty = false;
		adding = false;
		tokenInput = '';
		flash = null;
		await refresh();
	}

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 1000);
		// Filet de sécurité : si le flux tombe (proxy, veille…), on repolle doucement.
		const poll = setInterval(refresh, 20_000);
		return () => {
			clearInterval(poll);
			clearInterval(tick);
		};
	});

	// Un flux SSE par compte sélectionné : le serveur pousse l'état dès qu'il change.
	$effect(() => {
		const query = acctId ? `?account=${encodeURIComponent(acctId)}` : '';
		const source = new EventSource('/api/stream' + query);

		source.onopen = () => (streamState = 'live');
		source.onmessage = (event) => {
			streamState = 'live';
			try {
				const next = JSON.parse(event.data);
				raw = next;
				if (!acctId && next.selected?.id) acctId = next.selected.id;
			} catch {
				/* trame illisible : ignorée */
			}
		};
		source.onerror = () => {
			streamState = 'offline';
		};

		return () => source.close();
	});

	$effect(() => {
		if (!dirty && snap.settings) Object.assign(settings, { ...snap.settings });
	});

	const freePacks = $derived(snap.account?.freePacks ?? 0);
	const cap = $derived(snap.account?.freePacksMax ?? snap.meta?.freePacksMax ?? 10);
	const checkedAgoMs = $derived(snap.checkedAt ? Math.max(0, now - Date.parse(snap.checkedAt)) : null);
	// La réserve se régénère seule entre deux relevés : on projette depuis nextFreeAt
	// (l'ancre exacte donnée par Kyara), pas depuis l'heure du relevé.
	const estFree = $derived(
		(() => {
			const regen = snap.meta?.regenMs;
			const nextAt = snap.account?.nextFreeAt ? Date.parse(snap.account.nextFreeAt) : null;
			if (!regen || !Number.isFinite(nextAt) || now < nextAt) return freePacks;
			return Math.min(cap, freePacks + 1 + Math.floor((now - nextAt) / regen));
		})()
	);
	const pctEst = $derived(cap > 0 ? Math.min(100, (estFree / cap) * 100) : 0);
	// `nextFreeAt` est figé au dernier relevé : `nextFreeInMs` le fait rouler
	// d'une régénération à l'autre, sinon l'échéance reste « maintenant ».
	const nextFreeMs = $derived(
		nextFreeInMs(snap.account?.nextFreeAt ?? null, snap.meta?.regenMs ?? null, estFree, cap, now)
	);
	const nextRunMs = $derived(snap.bot?.nextRunAt ? Date.parse(snap.bot.nextRunAt) - now : null);
	// Pack du jour : dernier constat du bot (`/me/packs`), valable pour le jour indiqué.
	const daily = $derived(snap.daily ?? null);
	const dailyFresh = $derived(Boolean(daily) && daily.day === new Date(now).toISOString().slice(0, 10));
	const dailyLabel = $derived(
		snap.settings?.dailyPack === false
			? 'désactivé'
			: !dailyFresh
				? '—'
				: (daily?.left ?? 0) > 0
					? 'disponible'
					: 'pris'
	);
	const status = $derived(
		snap.tokenInvalid
			? { label: 'Clé à renouveler', tone: 'danger' }
			: !snap.tokenSet
				? { label: 'Non connecté', tone: 'muted' }
				: snap.bot.busy
					? { label: 'En cours…', tone: 'busy' }
					: snap.bot.running
						? { label: 'En marche', tone: 'ok' }
						: { label: 'En pause', tone: 'warn' }
	);
	const totalCards = $derived(ORDER.reduce((sum, r) => sum + (snap.stats?.byRarity?.[r] ?? 0), 0));
	const freeTypes = $derived(snap.meta?.freeTypes ?? []);

	// Le compte sélectionné est un état client : la barre de navigation s'y abonne.
	$effect(() => {
		headerAccount.account = snap.account ?? null;
		headerAccount.status = status;
	});

	function fmtDur(ms) {
		if (ms == null || !Number.isFinite(ms)) return '—';
		if (ms <= 0) return 'maintenant';
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		if (h >= 1) return `${h} h ${String(m % 60).padStart(2, '0')}`;
		if (m >= 1) return `${m} min ${String(s % 60).padStart(2, '0')}`;
		return `${s} s`;
	}
	function fmtTime(iso) {
		if (!iso) return '—';
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}
	function fmtDateTime(iso) {
		if (!iso) return 'jamais';
		return new Date(iso).toLocaleString('fr-FR', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function send(path, body, method = 'POST') {
		const res = await fetch(path, {
			method,
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(payload.message ?? payload.error ?? `Erreur ${res.status}`);
		return payload;
	}

	async function act(action) {
		pending = action;
		flash = null;
		try {
			raw = await send('/api/control', { action, accountId: snap.id });
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			pending = null;
		}
	}

	async function saveSettings() {
		pending = 'settings';
		flash = null;
		try {
			raw = await send('/api/control', {
				action: 'settings',
				accountId: snap.id,
				settings: { ...settings }
			});
			dirty = false;
			flash = { type: 'ok', text: 'Réglages enregistrés.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			pending = null;
		}
	}

	async function saveToken(event) {
		event?.preventDefault();
		if (!tokenInput.trim()) return;
		tokenBusy = true;
		flash = null;
		try {
			const next = await send('/api/token', { token: tokenInput.trim() });
			raw = next;
			if (next.selected?.id) acctId = next.selected.id;
			tokenInput = '';
			adding = false;
			dirty = false;
			flash = { type: 'ok', text: 'Clé enregistrée, le bot repart.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			tokenBusy = false;
		}
	}

	async function clearToken() {
		const name = snap.pseudo ?? 'ce compte';
		if (!confirm(`Supprimer ${name} ? Sa clé sera oubliée et son bot arrêté.`)) return;
		tokenBusy = true;
		try {
			raw = await send('/api/token', { accountId: snap.id }, 'DELETE');
			acctId = raw.selected?.id ?? null;
			flash = { type: 'ok', text: 'Compte supprimé.' };
		} catch (e) {
			flash = { type: 'error', text: e.message };
		} finally {
			tokenBusy = false;
		}
	}

	function isTypeOn(id) {
		return !settings.types || settings.types.includes(id);
	}

	function toggleType(id) {
		const all = freeTypes.map((t) => t.id);
		let list = settings.types ? [...settings.types] : [...all];
		list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
		settings.types = list.length && list.length < all.length ? list : null;
		dirty = true;
	}
</script>

<svelte:head><title>Kyara — Bot</title></svelte:head>

<div class="wrap">
	{#if flash}
		<div class="flash {flash.type}">{flash.text}</div>
	{/if}

	{#if raw.accounts.length}
		<div class="accounts">
			{#each raw.accounts as a (a.id)}
				<button
					type="button"
					class="chip"
					class:active={a.id === raw.selected?.id}
					onclick={() => selectAccount(a.id)}
					title={a.pseudo ?? a.id}
				>
					{#if a.avatar}
						<img src={a.avatar} alt="" />
					{:else}
						<span class="chip-fallback">{(a.pseudo ?? '?')[0]}</span>
					{/if}
					<span class="chip-body">
						<strong>{a.pseudo ?? 'Compte'}</strong>
						<span class="chip-meta">
							{a.freePacks}/{a.freePacksMax}
							{#if a.tokenInvalid}· clé invalide{:else if !a.running}· pause{:else if a.busy}· en cours{/if}
							{#if me?.role === 'admin' && a.owner && a.owner !== me.username}· {a.owner}{/if}
						</span>
					</span>
				</button>
			{/each}

			{#if raw.accounts.length < raw.maxAccounts}
				<button type="button" class="chip add" onclick={() => (adding = !adding)}>
					+ Compte
				</button>
			{/if}
		</div>
	{/if}

	{#if adding}
		<section class="panel add-panel">
			<div class="panel-head">
				<h2>Ajouter un compte</h2>
				<button
					class="link"
					onclick={() => {
						adding = false;
						tokenInput = '';
					}}
				>
					Annuler
				</button>
			</div>
			<p class="note">
				Connecte-toi sur kyara.games avec l'autre compte Discord, puis colle sa clé :
				<code>copy(localStorage.getItem('kyara_token'))</code>
			</p>
			<form class="token-form" onsubmit={saveToken}>
				<input
					type={tokenVisible ? 'text' : 'password'}
					bind:value={tokenInput}
					placeholder="Clé du compte à ajouter"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
					{tokenVisible ? 'Masquer' : 'Voir'}
				</button>
				<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
					{tokenBusy ? 'Vérification…' : 'Ajouter'}
				</button>
			</form>
		</section>
	{/if}

	{#if !snap.tokenSet}
		<section class="onboard panel">
			<h2>Connecter ton compte</h2>
			<p class="lead">
				Le bot n'a pas besoin de ton mot de passe Discord : il utilise la clé de session que Kyara
				émet après ta connexion. Elle reste chiffrée sur cette machine.
			</p>
			<ol>
				<li>
					Ouvre <a href="https://kyara.games" target="_blank" rel="noreferrer">kyara.games</a> et
					connecte-toi avec Discord (comme d'habitude).
				</li>
				<li>Ouvre la console du navigateur (<kbd>F12</kbd> → onglet <em>Console</em>).</li>
				<li>Colle cette ligne, elle copie la clé dans le presse-papier :</li>
			</ol>
			<pre>copy(localStorage.getItem('kyara_token'))</pre>
			<form class="token-form" onsubmit={saveToken}>
				<input
					type={tokenVisible ? 'text' : 'password'}
					bind:value={tokenInput}
					placeholder="Colle la clé ici (64 caractères)"
					autocomplete="off"
					spellcheck="false"
				/>
				<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
					{tokenVisible ? 'Masquer' : 'Voir'}
				</button>
				<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
					{tokenBusy ? 'Vérification…' : 'Connecter'}
				</button>
			</form>
		</section>
	{:else}
		<div class="grid-main">
			<section class="panel gauge-card">
				<div class="panel-head">
					<h2>Réserve</h2>
					<div class="head-actions">
						<span class="live {streamState}">{streamState === 'live' ? 'temps réel' : 'reconnexion…'}</span>
						<button class="link" onclick={() => act('sync')} disabled={pending !== null}>
							{pending === 'sync' ? 'Relevé…' : 'Synchroniser'}
						</button>
					</div>
				</div>

				<div class="gauge">
					<div class="gauge-value" class:approx={estFree !== freePacks}>
						{estFree}<small>/{cap}</small>
					</div>
					<div class="bar"><div class="fill" style="width: {pctEst}%"></div></div>
					<p class="stale">
						{#if checkedAgoMs == null}
							Jamais relevé
						{:else}
							Relevé il y a {fmtDur(checkedAgoMs)}{#if estFree !== freePacks}<span class="est">
								· ≈ estimé</span
							>{/if}
						{/if}
					</p>
				</div>

				<div class="rows">
					<div class="row">
						<span>Prochain booster</span>
						<strong class:soon={nextFreeMs != null && nextFreeMs < 60_000}>
							{nextFreeMs != null ? fmtDur(nextFreeMs) : estFree >= cap ? 'réserve pleine' : '—'}
						</strong>
					</div>
					<div class="row">
						<span>Pack du jour</span>
						<strong
							class:soon={dailyFresh && (daily?.left ?? 0) > 0}
							title={daily ? `Relevé : ${fmtDateTime(daily.checkedAt)}` : undefined}
						>
							{dailyLabel}
						</strong>
					</div>
					<div class="row">
						<span>Prochain passage</span>
						<strong>{nextRunMs != null ? fmtDur(nextRunMs) : '—'}</strong>
					</div>
					<div class="row">
						<span>Dernier passage</span>
						<strong>{fmtDateTime(snap.bot.lastRunAt)}</strong>
					</div>
				</div>

				{#if snap.bot.lastError}
					<p class="err">{snap.bot.lastError}</p>
				{/if}
			</section>

			<section class="panel controls">
				<div class="panel-head">
					<h2>Contrôle</h2>
				</div>

				<div class="buttons">
					<button class="primary" onclick={() => act('run')} disabled={pending !== null}>
						{pending === 'run' ? 'Ouverture…' : 'Ouvrir maintenant'}
					</button>
					{#if snap.bot.running}
						<button class="ghost" onclick={() => act('pause')} disabled={pending !== null}>
							Pause
						</button>
					{:else}
						<button class="ghost" onclick={() => act('resume')} disabled={pending !== null}>
							Reprendre
						</button>
					{/if}
				</div>

				<p class="note">
					Cycle toutes les <strong>{snap.settings.pollMinutes} min</strong> au maximum, et plus tôt si la
					réserve approche du plafond (pour ne rien perdre).
				</p>

				<div class="mini-grid">
					<div class="mini">
						<span>Ouverts</span>
						<strong>{snap.stats.opened}</strong>
					</div>
					<div class="mini">
						<span>Cartes</span>
						<strong>{totalCards}</strong>
					</div>
					<div class="mini">
						<span>Pity</span>
						<strong>{snap.account?.pity ?? 0}</strong>
					</div>
					<div class="mini">
						<span>Golden dans</span>
						<strong>{snap.account?.goldenIn ?? '—'}</strong>
					</div>
				</div>
			</section>

			<section class="panel rarities">
				<div class="panel-head">
					<h2>Raretés obtenues</h2>
				</div>
				<div class="rarity-grid">
					{#each ORDER as r (r)}
						{@const info = RARITY[r]}
						{@const n = snap.stats.byRarity?.[r] ?? 0}
						<div class="rarity" style="--c: {info.color}">
							<div class="rarity-letter">{r}</div>
							<div class="rarity-name">{info.label}</div>
							<div class="rarity-count">{n}</div>
							<div class="rarity-bar">
								<div style="width: {totalCards ? (n / totalCards) * 100 : 0}%"></div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		</div>

		<div class="grid-lower">
			<section class="panel history">
				<div class="panel-head">
					<h2>Derniers boosters</h2>
					<span class="tag">{snap.opens.length}</span>
				</div>

				{#if snap.opens.length === 0}
					<p class="empty">Rien encore. Lance un passage manuel pour tester.</p>
				{:else}
					<ul>
						{#each snap.opens as entry, idx (entry.at + entry.packId + idx)}
							{@const best = entry.best ? RARITY[entry.best] : null}
							<li style="--c: {best?.color ?? '#3a3448'}">
								<div class="open-top">
									<span class="pack">{entry.packName}</span>
									<span class="time">{fmtTime(entry.at)}</span>
								</div>
								<div class="cards">
									{#each entry.cards as card, i (i)}
										<span
											class="card-chip"
											style="--c: {RARITY[card.rarity]?.color ?? '#8b849c'}"
											title={RARITY[card.rarity]?.label ?? ''}
										>
											{card.name}
										</span>
									{:else}
										<span class="empty">aucune carte</span>
									{/each}
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="panel logs">
				<div class="panel-head">
					<h2>Journal</h2>
					<button class="link" onclick={() => act('clear-logs')} disabled={pending !== null}>
						Vider
					</button>
				</div>
				<ul>
					{#each snap.logs as line, i (line.at + i)}
						<li class={line.level}>
							<span class="t">{fmtTime(line.at)}</span>
							<span class="m">{line.message}</span>
						</li>
					{:else}
						<li class="empty">Aucun événement.</li>
					{/each}
				</ul>
			</section>
		</div>

		<div class="grid-settings">
			<section class="panel">
				<div class="panel-head">
					<h2>Réglages</h2>
					{#if dirty}<span class="tag warn">non enregistré</span>{/if}
				</div>

				<div class="fields">
					<label>
						<span>Intervalle max (minutes)</span>
						<input
							type="number"
							min="5"
							max="1440"
							bind:value={settings.pollMinutes}
							oninput={() => (dirty = true)}
						/>
					</label>
					<label>
						<span>Boosters max par passage</span>
						<input
							type="number"
							min="1"
							max="10"
							bind:value={settings.maxPerRun}
							oninput={() => (dirty = true)}
						/>
					</label>
				</div>

				<div class="switches">
					<label class="switch">
						<input
							type="checkbox"
							bind:checked={settings.dailyPack}
							onchange={() => (dirty = true)}
						/>
						<span>Ouvrir aussi le pack du jour</span>
					</label>
					<label class="switch">
						<input type="checkbox" bind:checked={settings.smart} onchange={() => (dirty = true)} />
						<span>Réveil anticipé près du plafond</span>
					</label>
					<label class="switch">
						<input
							type="checkbox"
							bind:checked={settings.humanDelay}
							onchange={() => (dirty = true)}
						/>
						<span>Délai humain entre deux ouvertures</span>
					</label>
				</div>

				<h3>Types de boosters</h3>
				<div class="types">
					{#each freeTypes as type (type.id)}
						<label class="type" class:on={isTypeOn(type.id)}>
							<input type="checkbox" checked={isTypeOn(type.id)} onchange={() => toggleType(type.id)} />
							<span class="kanji">{type.kanji ?? '·'}</span>
							<span>{type.name}</span>
						</label>
					{:else}
						<p class="empty">Liste des boosters pas encore chargée.</p>
					{/each}
				</div>

				<button class="primary" onclick={saveSettings} disabled={pending !== null}>
					{pending === 'settings' ? 'Enregistrement…' : 'Enregistrer'}
				</button>
			</section>

			<section class="panel">
				<div class="panel-head">
					<h2>Clé Kyara</h2>
					{#if snap.tokenSet}<span class="tag ok">enregistrée</span>{/if}
				</div>

				<p class="note">
					{snap.tokenSet
						? `Clé chiffrée localement, ajoutée le ${fmtDateTime(snap.tokenSetAt)}.`
						: 'Aucune clé enregistrée.'}
					{#if snap.tokenInvalid}<strong class="danger">
							Elle est refusée par Kyara : recolle-en une.</strong
						>{/if}
				</p>

				<form class="token-form" onsubmit={saveToken}>
					<input
						type={tokenVisible ? 'text' : 'password'}
						bind:value={tokenInput}
						placeholder="Nouvelle clé (localStorage.kyara_token)"
						autocomplete="off"
						spellcheck="false"
					/>
					<button class="ghost" type="button" onclick={() => (tokenVisible = !tokenVisible)}>
						{tokenVisible ? 'Masquer' : 'Voir'}
					</button>
					<button class="primary" type="submit" disabled={tokenBusy || !tokenInput.trim()}>
						{tokenBusy ? '…' : 'Remplacer'}
					</button>
				</form>

				{#if snap.tokenSet}
					<button class="link danger" onclick={clearToken} disabled={tokenBusy}>
						Supprimer ce compte
					</button>
				{/if}

				<p class="note small">
					La clé se récupère sur kyara.games, connecté :
					<code>copy(localStorage.getItem('kyara_token'))</code>
				</p>
			</section>
		</div>
	{/if}

	<footer>
		<span>Kyara Bot · non-officiel</span>
		<span>Les actions passent par l'API du site avec ta propre session.</span>
	</footer>
</div>

<style>
	.grid-main {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.rarities {
		grid-column: 1 / -1;
	}

	.gauge-value {
		font-family: var(--mono);
		font-size: 54px;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.gauge-value small {
		font-size: 20px;
		color: var(--muted);
		font-weight: 500;
	}
	.gauge-value.approx {
		color: #f0d67a;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.live {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
	}
	.live.live {
		color: var(--green);
		border-color: rgba(52, 211, 153, 0.35);
	}
	.live.offline {
		color: var(--amber);
		border-color: rgba(251, 191, 36, 0.35);
	}
	.stale {
		margin: 0 0 16px;
		font-size: 11.5px;
		color: var(--muted);
	}
	.est {
		color: #f0d67a;
	}
	.bar {
		margin: 14px 0 18px;
		height: 9px;
		border-radius: 999px;
		background: #1d1929;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: linear-gradient(90deg, #b08d0c, var(--gold));
		transition: width 0.5s ease;
	}

	.buttons {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.mini-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 18px;
	}
	.mini {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 10px;
		display: grid;
		gap: 3px;
	}
	.mini span {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.mini strong {
		font-family: var(--mono);
		font-size: 17px;
	}

	.rarity-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 10px;
	}
	.rarity {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px;
		position: relative;
		overflow: hidden;
	}
	.rarity::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 3px;
		background: var(--c);
	}
	.rarity-letter {
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 700;
		color: var(--c);
	}
	.rarity-name {
		font-size: 11px;
		color: var(--muted);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rarity-count {
		font-family: var(--mono);
		font-size: 22px;
		font-weight: 700;
		margin-top: 6px;
	}
	.rarity-bar {
		height: 4px;
		background: #1d1929;
		border-radius: 999px;
		overflow: hidden;
		margin-top: 8px;
	}
	.rarity-bar div {
		height: 100%;
		background: var(--c);
	}

	.grid-lower {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}

	.history ul,
	.logs ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
		max-height: 420px;
		overflow-y: auto;
	}
	.history li {
		background: #0e0c15;
		border: 1px solid var(--line);
		border-left: 3px solid var(--c);
		border-radius: 12px;
		padding: 10px 12px;
	}
	.open-top {
		display: flex;
		justify-content: space-between;
		font-size: 12px;
		margin-bottom: 7px;
	}
	.pack {
		font-weight: 700;
	}
	.time {
		color: var(--muted);
		font-family: var(--mono);
	}
	.cards {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.card-chip {
		font-size: 11px;
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		color: var(--c);
		background: color-mix(in srgb, var(--c) 10%, transparent);
	}

	.logs li {
		display: flex;
		gap: 9px;
		font-size: 12px;
		line-height: 1.45;
		padding: 6px 0;
		border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
	}
	.logs .t {
		color: var(--muted);
		font-family: var(--mono);
		flex: 0 0 auto;
	}
	.logs .m {
		min-width: 0;
		word-break: break-word;
	}
	.logs li.error .m {
		color: #fca5a5;
	}
	.logs li.warn .m {
		color: #fcd34d;
	}
	.logs li.success .m {
		color: #86efac;
		font-weight: 600;
	}

	.grid-settings {
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 16px;
		margin-top: 16px;
	}

	.fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.fields label {
		display: grid;
		gap: 6px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}
	.fields input {
		background: #0c0a12;
		border: 1px solid var(--line);
		border-radius: 9px;
		padding: 9px 11px;
		color: var(--text);
		font-family: var(--mono);
	}

	.switches {
		display: grid;
		gap: 8px;
		margin-top: 16px;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 13px;
	}
	.switch input,
	.type input {
		accent-color: var(--gold);
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
	}
	.type {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		padding: 6px 11px;
		border-radius: 999px;
		border: 1px solid var(--line);
		color: var(--muted);
		cursor: pointer;
		user-select: none;
	}
	.type.on {
		color: var(--text);
		border-color: rgba(245, 197, 24, 0.4);
		background: rgba(245, 197, 24, 0.07);
	}
	.type input {
		display: none;
	}
	.kanji {
		font-size: 13px;
		opacity: 0.85;
	}

	.onboard {
		max-width: 680px;
		margin: 0 auto;
	}
	.onboard h2 {
		font-size: 20px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--text);
		margin-bottom: 10px;
	}
	.lead {
		color: var(--muted);
		font-size: 13.5px;
		line-height: 1.6;
	}
	.onboard ol {
		color: var(--muted);
		font-size: 13px;
		line-height: 1.8;
		padding-left: 18px;
	}
	.accounts {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		padding: 6px 14px 6px 6px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--text);
		text-align: left;
	}
	.chip img,
	.chip-fallback {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		object-fit: cover;
		background: #2a2436;
		display: grid;
		place-items: center;
		font-weight: 700;
		font-size: 13px;
	}
	.chip-body {
		display: grid;
		line-height: 1.15;
	}
	.chip-body strong {
		font-size: 12.5px;
	}
	.chip-meta {
		font-size: 11px;
		color: var(--muted);
	}
	.chip.active {
		border-color: rgba(245, 197, 24, 0.55);
		background: rgba(245, 197, 24, 0.08);
	}
	.chip.add {
		padding: 9px 14px;
		color: var(--muted);
		font-size: 12.5px;
		font-weight: 600;
		border-style: dashed;
	}
	.chip.add:hover {
		color: var(--gold);
		border-color: rgba(245, 197, 24, 0.45);
	}

	.add-panel {
		margin-bottom: 16px;
		border-color: rgba(245, 197, 24, 0.25);
	}

	@media (max-width: 900px) {
		.grid-main,
		.grid-lower,
		.grid-settings {
			grid-template-columns: 1fr;
		}
		.rarities {
			grid-column: auto;
		}
		.rarity-grid {
			grid-template-columns: repeat(3, 1fr);
		}
		.mini-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
