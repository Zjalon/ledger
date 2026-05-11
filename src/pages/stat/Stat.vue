<template>
    <div class="stat-page">
        <div class="stat-atmosphere" aria-hidden="true">
            <div class="stat-atmosphere__orb stat-atmosphere__orb--a" />
            <div class="stat-atmosphere__orb stat-atmosphere__orb--b" />
            <div class="stat-atmosphere__grain" />
        </div>
        <div class="stat-inner">
            <van-empty description="暂无数据" />
        </div>
    </div>
</template>

<style scoped>
.stat-page {
    flex: 1;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: var(--ledger-paper);
    font-family: var(--ledger-font-ui);
    color: var(--ledger-ink);
}

.stat-atmosphere {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
}

.stat-atmosphere__orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(48px);
    opacity: 0.4;
}

.stat-atmosphere__orb--a {
    width: min(80vw, 360px);
    height: min(80vw, 360px);
    top: -12%;
    left: -20%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-accent-rgb), 0.22) 0%,
        transparent 72%
    );
}

.stat-atmosphere__orb--b {
    width: min(60vw, 280px);
    height: min(60vw, 280px);
    bottom: 25%;
    right: -18%;
    background: radial-gradient(
        circle,
        rgba(var(--ledger-warm-rgb), 0.08) 0%,
        transparent 70%
    );
}

.stat-atmosphere__grain {
    position: absolute;
    inset: 0;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.stat-inner {
    position: relative;
    z-index: 1;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
    overflow-y: auto;
}

.stat-inner :deep(.van-empty__description) {
    color: var(--ledger-ink-muted);
    font-weight: 500;
    letter-spacing: 0.02em;
}
</style>
