<script>
	import favicon from '#lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app">
	{@render children()}
</div>

<style>
	:global(:root) {
		--bg: #08070c;
		--panel: #12101a;
		--panel-2: #16131f;
		--line: #262133;
		--text: #e9e6f2;
		--muted: #8b849c;
		--gold: #f5c518;
		--green: #34d399;
		--amber: #fbbf24;
		--red: #f87171;
		--blue: #60a5fa;
		--violet: #a78bfa;
		--pink: #f472b6;
		--mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		background: var(--bg);
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		color: var(--text);
		background:
			radial-gradient(900px 500px at 15% -10%, rgba(245, 197, 24, 0.09), transparent 60%),
			radial-gradient(800px 500px at 90% 0%, rgba(167, 139, 250, 0.08), transparent 55%),
			var(--bg);
		-webkit-font-smoothing: antialiased;
	}

	:global(button) {
		font: inherit;
		cursor: pointer;
	}

	:global(input) {
		font: inherit;
	}

	:global(a) {
		color: var(--gold);
	}

	.app {
		min-height: 100vh;
	}
</style>
