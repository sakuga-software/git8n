<script setup lang="ts">
import { withBase } from 'vitepress';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/** The `type` of every message between this page and the demo. `packages/web/app/demo/install.ts` holds the same value. */
const DEMO_MESSAGE = 'i18n-editor-demo';

const TYPE_MS = 28;
const PAUSE_MS = 500;

interface Line {
  kind: 'command' | 'output' | 'note';
  text: string;
}

// The file itself: a server of static files answers it, the server of the site in development too.
const demoUrl = withBase('/demo/index.html');
const frame = ref<HTMLIFrameElement | null>(null);
const screen = ref<HTMLElement | null>(null);
const ready = ref(false);
const running = ref(false);
const lines = ref<Line[]>([]);

let answers: ((data: Record<string, unknown>) => void) | null = null;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));

const onMessage = (event: MessageEvent) => {
  const data = event.data as Record<string, unknown> | null;

  if (event.origin !== window.location.origin || data?.type !== DEMO_MESSAGE) return;
  if (data.event === 'ready') ready.value = true;
  else answers?.(data);
};

/** Sends an action to the demo, and waits for its answer. */
const ask = (action: string) =>
  new Promise<Record<string, unknown>>((resolve) => {
    answers = resolve;
    frame.value?.contentWindow?.postMessage({ type: DEMO_MESSAGE, action }, window.location.origin);
  });

const print = async (line: Line) => {
  lines.value.push(line);
  await nextTick();
  screen.value?.scrollTo({ top: screen.value.scrollHeight });
};

const type = async (command: string) => {
  if (reducedMotion()) return print({ kind: 'command', text: command });

  const line: Line = { kind: 'command', text: '' };

  lines.value.push(line);
  for (const letter of command) {
    line.text += letter;
    lines.value = [...lines.value];
    await wait(TYPE_MS);
  }
};

async function runAgent() {
  if (running.value || !ready.value) return;

  running.value = true;
  lines.value = [];

  await type('i18n-editor keys --missing --lang de');
  await wait(PAUSE_MS);

  // The lines that `i18n-editor` prints (packages/mcp/src/cli/run.ts).
  const missing = ((await ask('missing')).keys ?? []) as Array<{ file: string; key: string }>;
  const ids = missing.map((row) => `${row.file}:${row.key}`);
  const width = Math.max(0, ...ids.map((id) => id.length));

  for (const id of ids) await print({ kind: 'output', text: `${id.padEnd(width)}  missing` });
  await print({ kind: 'note', text: `${ids.length === 0 ? 0 : 1}–${ids.length} of ${ids.length}` });

  if (missing.length > 0) {
    await wait(PAUSE_MS * 2);
    await type('i18n-editor apply --lang de batch.json');
    await wait(PAUSE_MS);

    const proposal = (await ask('apply')).proposal as { keys: number; commit: string; branch: string } | null;

    await print({
      kind: 'note',
      text: proposal
        ? `Proposed ${proposal.keys} key(s) in de as ${proposal.commit.slice(0, 7)} on ${proposal.branch}. A reviewer publishes them.`
        : 'Nothing to propose.',
    });
  }

  running.value = false;
}

onMounted(() => window.addEventListener('message', onMessage));
onBeforeUnmount(() => window.removeEventListener('message', onMessage));
</script>

<template>
  <section class="demo" aria-labelledby="demo-title">
    <div class="demo-head">
      <h2 id="demo-title">Try the editor</h2>
      <p>
        This is the real editor, with a repository in your browser. Translate a key, propose it, then publish it as a
        reviewer. Nothing goes to GitHub, and a reload starts again.
      </p>
      <a class="demo-full" :href="demoUrl" target="_blank" rel="noopener">Open in full screen</a>
    </div>

    <div class="demo-wide">
      <iframe
        ref="frame"
        class="demo-frame"
        :src="demoUrl"
        title="Demo of the editor"
        loading="lazy"
        @load="ready = true"
      />

      <div class="agent">
        <div class="agent-bar">
          <span>An agent, with the CLI</span>
          <button type="button" :disabled="!ready || running" @click="runAgent">
            {{ running ? 'Running…' : lines.length > 0 ? 'Run again' : 'Run the agent' }}
          </button>
        </div>
        <pre
          ref="screen"
          class="agent-screen"
          aria-live="polite"
        ><template v-if="lines.length === 0"><span class="agent-note">The agent lists the German keys that are missing, and proposes them as one batch. The batch then waits in the editor, under « Proposées ».</span></template><template v-for="(line, index) in lines" :key="index"><span v-if="line.kind === 'command'" class="agent-prompt">$ </span><span :class="`agent-${line.kind}`">{{ line.text }}</span>
</template></pre>
      </div>
    </div>

    <div class="demo-narrow">
      <img
        :src="withBase('/demo-preview.png')"
        alt="The editor: the German keys of the repository acme/shop, with the ones still to translate"
      />
      <a class="demo-full" :href="demoUrl">Open the demo</a>
    </div>
  </section>
</template>

<style scoped>
/* Wider than the text of the page: the editor needs its side panel and three columns. */
.demo {
  margin: 0 auto;
  max-width: 1328px;
  padding: 32px 24px 0;
}

@media (min-width: 640px) {
  .demo {
    padding: 48px 32px 0;
  }
}

.demo-head h2 {
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
}

.demo-head p {
  margin: 8px 0 12px;
  max-width: 640px;
  color: var(--vp-c-text-2);
}

.demo-full {
  display: inline-block;
  margin-bottom: 16px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.demo-frame {
  display: block;
  width: 100%;
  height: 680px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #fff;
}

.agent {
  margin-top: 16px;
  border-radius: 12px;
  background: #15171c;
  color: #e3e5ea;
  overflow: hidden;
}

.agent-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #2b2e36;
  font-size: 13px;
  color: #a7adb8;
}

.agent-bar button {
  padding: 4px 12px;
  border-radius: 6px;
  background: #2f5bd3;
  color: #fff;
  font-weight: 500;
}

.agent-bar button:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-screen {
  margin: 0;
  height: 188px;
  padding: 12px 16px;
  overflow: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.agent-prompt {
  color: #7fb2ff;
}

.agent-command {
  color: #fff;
}

.agent-output {
  color: #c8ccd4;
}

.agent-note {
  color: #9be3b3;
}

.demo-narrow {
  display: none;
}

.demo-narrow img {
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  margin-bottom: 12px;
}

@media (max-width: 767px) {
  .demo-wide {
    display: none;
  }

  .demo-full {
    display: none;
  }

  .demo-narrow {
    display: block;
  }

  .demo-narrow .demo-full {
    display: inline-block;
  }
}
</style>
