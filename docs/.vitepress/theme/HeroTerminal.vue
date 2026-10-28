<script setup lang="ts">
/** A session of the CLI, as `i18n-editor` prints it (packages/mcp/src/cli/run.ts). */
const session: Array<{ kind: 'command' | 'output' | 'comment' | 'note'; text: string }> = [
  { kind: 'command', text: 'i18n-editor login --api https://i18n.example.com' },
  { kind: 'output', text: 'Open https://i18n.example.com/device and enter the code WDJB-MJHT' },
  { kind: 'output', text: 'Signed in to https://i18n.example.com as Ada <ada@example.com>.' },
  { kind: 'command', text: 'i18n-editor keys --repo acme/shop --missing --lang de --limit 3' },
  { kind: 'output', text: 'common:actions.search     missing' },
  { kind: 'output', text: 'checkout:address.title    missing' },
  { kind: 'output', text: 'account:orders.empty      missing' },
  { kind: 'note', text: '1–3 of 13' },
  { kind: 'comment', text: '# The agent writes the German texts to batch.json.' },
  { kind: 'command', text: 'i18n-editor apply --lang de batch.json' },
  { kind: 'note', text: 'Proposed 13 key(s) in de as da3e073 on i18n/de. A reviewer publishes them.' },
];
</script>

<template>
  <figure class="hero-terminal">
    <figcaption class="hero-terminal-bar">
      <span class="hero-terminal-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>An agent, with the CLI</span>
    </figcaption>
    <pre
      class="hero-terminal-screen"
    ><template v-for="(line, index) in session" :key="index"><span v-if="line.kind === 'command'" class="prompt">$ </span><span :class="line.kind">{{ line.text }}</span>
</template></pre>
    <a class="hero-terminal-link" href="#demo-title">Run it against the editor below</a>
  </figure>
</template>

<style scoped>
.hero-terminal {
  margin: 0;
  width: 100%;
  max-width: 560px;
  border: 1px solid #2b2e36;
  border-radius: 12px;
  background: #15171c;
  color: #e3e5ea;
  overflow: hidden;
  text-align: left;
}

.hero-terminal-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #2b2e36;
  font-size: 13px;
  color: #a7adb8;
}

.hero-terminal-dots {
  display: flex;
  gap: 6px;
}

.hero-terminal-dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3a3e48;
}

.hero-terminal-screen {
  margin: 0;
  padding: 14px 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.7;
}

.prompt {
  color: #7fb2ff;
}

.command {
  color: #fff;
}

.output {
  color: #c8ccd4;
}

.comment {
  color: #7d8494;
}

.note {
  color: #9be3b3;
}

.hero-terminal-link {
  display: block;
  padding: 10px 16px;
  border-top: 1px solid #2b2e36;
  font-size: 13px;
  font-weight: 500;
  color: #7fb2ff;
  text-decoration: none;
}

.hero-terminal-link:hover {
  color: #fff;
}

@media (max-width: 767px) {
  .hero-terminal-link {
    display: none;
  }
}
</style>
