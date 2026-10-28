<script setup lang="ts">
const description =
  'The flow of an agent: it reads the missing keys of the repository through MCP, proposes them as one commit on ' +
  'the branch i18n/de, a reviewer reads the batch in the editor, then publishes it to the base branch.';
</script>

<template>
  <figure class="flow" role="img" :aria-label="description">
    <div class="flow-grid" aria-hidden="true">
      <div class="node step-0">
        <svg viewBox="0 0 24 24"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></svg>
        <strong class="mono">acme/shop · main</strong>
        <span>The locale files. The source of truth.</span>
      </div>

      <div class="edge edge-right step-1">
        <code>i18n_keys</code>
        <i class="line" />
      </div>

      <div class="node step-2">
        <svg viewBox="0 0 24 24">
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2M20 14h2M15 13v2M9 13v2" />
        </svg>
        <strong>An agent · MCP</strong>
        <span>Reads the 13 missing German keys, and translates them.</span>
      </div>

      <div class="edge edge-up step-7">
        <i class="line" />
        <code>publish</code>
      </div>

      <p class="flow-center">Each step is a commit in your repository.</p>

      <div class="edge edge-down step-3">
        <i class="line" />
        <code>i18n_propose</code>
      </div>

      <div class="node step-6">
        <svg viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="m16 11 2 2 4-4" />
        </svg>
        <strong>A reviewer · the editor</strong>
        <span>Reads the batch, then publishes it by commit or by pull request.</span>
      </div>

      <div class="edge edge-left step-5">
        <code>review</code>
        <i class="line" />
      </div>

      <div class="node step-4">
        <svg viewBox="0 0 24 24">
          <path d="M6 3v12" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <strong class="mono">i18n/de</strong>
        <span>One commit: 13 keys proposed, nothing published.</span>
      </div>
    </div>
    <p class="flow-note" aria-hidden="true">Each step is a commit in your repository.</p>
  </figure>
</template>

<style scoped>
.flow {
  --flow-gap: 10px;
  --flow-edge: 88px;
  margin: 0;
  width: 100%;
  max-width: 560px;
  text-align: left;
}

.flow-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--flow-edge) minmax(0, 1fr);
  grid-template-rows: auto 72px auto;
}

.node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition:
    border-color 0.3s,
    background-color 0.3s;
}

.node svg {
  margin-bottom: 4px;
  width: 20px;
  height: 20px;
  fill: none;
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.node strong {
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--vp-c-text-1);
}

.node strong.mono {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}

.node span {
  font-size: 13px;
  line-height: 19px;
  color: var(--vp-c-text-2);
}

.edge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--vp-c-text-3);
  transition: color 0.3s;
}

.edge code {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: inherit;
}

.edge-right,
.edge-left {
  flex-direction: column;
  padding: 0 var(--flow-gap);
}

.edge-up,
.edge-down {
  position: relative;
  padding: var(--flow-gap) 0;
}

/* The line stays under the middle of the node. The name of the call sits beside it. */
.edge-up code,
.edge-down code {
  position: absolute;
  top: 50%;
  left: calc(50% + 8px);
  transform: translateY(-50%);
}

.edge-down code {
  right: calc(50% + 8px);
  left: auto;
}

.line {
  position: relative;
  background: currentColor;
}

.edge-right .line,
.edge-left .line {
  width: 100%;
  height: 1.5px;
}

.edge-up .line,
.edge-down .line {
  width: 1.5px;
  height: 100%;
}

.line::after {
  content: '';
  position: absolute;
  border: 5px solid transparent;
}

.edge-right .line::after {
  right: -2px;
  top: 50%;
  border-left: 7px solid currentColor;
  border-right-width: 0;
  transform: translateY(-50%);
}

.edge-left .line::after {
  left: -2px;
  top: 50%;
  border-right: 7px solid currentColor;
  border-left-width: 0;
  transform: translateY(-50%);
}

.edge-down .line::after {
  bottom: -2px;
  left: 50%;
  border-top: 7px solid currentColor;
  border-bottom-width: 0;
  transform: translateX(-50%);
}

.edge-up .line::after {
  top: -2px;
  left: 50%;
  border-bottom: 7px solid currentColor;
  border-top-width: 0;
  transform: translateX(-50%);
}

.flow-center {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 11.5px;
  line-height: 15px;
  text-align: center;
  color: var(--vp-c-text-3);
}

/* The steps light up one after the other: node, edge, node, … in eight seconds. */
@media (prefers-reduced-motion: no-preference) {
  .node {
    animation: flow-node 8s infinite;
  }

  .edge {
    animation: flow-edge 8s infinite;
  }

  .step-1 {
    animation-delay: 1s;
  }

  .step-2 {
    animation-delay: 2s;
  }

  .step-3 {
    animation-delay: 3s;
  }

  .step-4 {
    animation-delay: 4s;
  }

  .step-5 {
    animation-delay: 5s;
  }

  .step-6 {
    animation-delay: 6s;
  }

  .step-7 {
    animation-delay: 7s;
  }
}

@keyframes flow-node {
  0%,
  20% {
    border-color: var(--vp-c-brand-1);
    background-color: var(--vp-c-brand-soft);
  }

  30%,
  100% {
    border-color: var(--vp-c-divider);
    background-color: var(--vp-c-bg-soft);
  }
}

@keyframes flow-edge {
  0%,
  15% {
    color: var(--vp-c-brand-1);
  }

  22%,
  100% {
    color: var(--vp-c-text-3);
  }
}

.flow-note {
  display: none;
}

@media (max-width: 639px) {
  .flow-center {
    visibility: hidden;
  }

  .flow-note {
    display: block;
    margin: 12px 0 0;
    font-size: 12px;
    text-align: center;
    color: var(--vp-c-text-3);
  }

  .flow {
    --flow-gap: 6px;
    --flow-edge: 76px;
  }

  .node {
    padding: 10px 12px;
  }

  .node strong,
  .node strong.mono,
  .node span {
    font-size: 12px;
    line-height: 17px;
  }

  .edge code,
  .flow-center {
    font-size: 10.5px;
  }
}
</style>
