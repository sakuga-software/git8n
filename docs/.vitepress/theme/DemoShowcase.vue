<script setup lang="ts">
import { withBase } from 'vitepress';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

/** The `type` of every message between this page and the demo. `packages/web/app/demo/install.ts` holds the same value. */
const DEMO_MESSAGE = 'i18n-editor-demo';

const TYPE_MS = 28;
const PAUSE_MS = 500;
const PING_MS = 500;
/** How long the page asks the demo. The `load` event of the frame starts it again. */
const PING_FOR_MS = 30_000;
const ANSWER_MS = 5000;

interface Line {
  kind: 'command' | 'output' | 'note';
  text: string;
}

// The file itself: a server of static files answers it, the server of the site in development too.
const demoUrl = withBase('/demo/index.html');
const frame = ref<HTMLIFrameElement | null>(null);
const screen = ref<HTMLElement | null>(null);
const ready = ref(false);
const failed = ref(false);
const running = ref(false);
const lines = ref<Line[]>([]);
/** The last finished line, for a screen reader. The screen itself changes on each typed letter. */
const announced = ref('');

let answers: ((data: Record<string, unknown>) => void) | null = null;
let ping: ReturnType<typeof setInterval> | undefined;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));

const onMessage = (event: MessageEvent) => {
  const data = event.data as Record<string, unknown> | null;

  if (event.origin !== window.location.origin || data?.type !== DEMO_MESSAGE) return;
  if (data.event === 'ready') {
    ready.value = true;
    failed.value = false;
    clearInterval(ping);
  } else answers?.(data);
};

const send = (action: string) =>
  frame.value?.contentWindow?.postMessage({ type: DEMO_MESSAGE, action }, window.location.origin);

/**
 * Asks the demo until it says it is ready.
 *
 * The server renders the frame, so the demo can load before this page listens. Its first `ready` is then lost.
 */
const waitForDemo = () => {
  clearInterval(ping);
  failed.value = false;
  send('ping');

  const until = Date.now() + PING_FOR_MS;

  ping = setInterval(() => {
    if (Date.now() <= until) return send('ping');

    clearInterval(ping);
    failed.value = !ready.value && demoHasLoaded();
  }, PING_MS);
};

/** A lazy frame that is not in view yet holds `about:blank`. Its silence is not a failure. */
const demoHasLoaded = () => {
  try {
    return frame.value?.contentWindow?.location.pathname.includes('/demo/') ?? false;
  } catch {
    return false;
  }
};

/** Sends an action to the demo, and waits for its answer. A demo that does not answer rejects after `ANSWER_MS`. */
const ask = (action: string) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The demo did not answer.')), ANSWER_MS);

    answers = (data) => {
      clearTimeout(timer);
      resolve(data);
    };
    send(action);
  });

const print = async (line: Line) => {
  lines.value.push(line);
  announced.value = line.text;
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
  announced.value = command;
};

async function runAgent() {
  if (running.value || !ready.value) return;

  running.value = true;
  lines.value = [];

  try {
    await playAgent();
  } catch {
    await print({ kind: 'note', text: 'The demo did not answer. Reload the page to start again.' });
  } finally {
    running.value = false;
  }
}

async function playAgent() {
  await type('i18n_keys({ repository: "acme/shop", language: "de", state: "missing" })');
  await wait(PAUSE_MS);

  const missing = ((await ask('missing')).keys ?? []) as Array<{ file: string; key: string }>;
  const ids = missing.map((row) => `${row.file}:${row.key}`);
  const width = Math.max(0, ...ids.map((id) => id.length));

  for (const id of ids) await print({ kind: 'output', text: `${id.padEnd(width)}  missing` });
  await print({ kind: 'note', text: `${ids.length} keys missing. The agent translates them.` });

  if (missing.length > 0) {
    await wait(PAUSE_MS * 2);
    await type(`i18n_propose({ repository: "acme/shop", language: "de", values: [${ids.length} texts] })`);
    await wait(PAUSE_MS);

    const proposal = (await ask('apply')).proposal as { keys: number; commit: string; branch: string } | null;

    await print({
      kind: 'note',
      text: proposal
        ? `One commit ${proposal.commit.slice(0, 7)} on ${proposal.branch}: ${proposal.keys} keys proposed. A reviewer publishes them.`
        : 'Nothing to propose.',
    });
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage);
  waitForDemo();
});
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage);
  clearInterval(ping);
});
</script>

<template>
  <section class="demo" aria-labelledby="demo-title">
    <div class="demo-head">
      <h2 id="demo-title">Try the editor</h2>
      <p>
        This is the real editor, with a repository <code>acme/shop</code> in your browser. Nothing goes to GitHub, and a
        reload starts again. The editor speaks French: the words in «&nbsp;» are the ones you see in it.
      </p>
      <ol class="demo-steps">
        <li>
          <strong>Translate and propose.</strong>
          Under «&nbsp;Manquantes&nbsp;», type a German text for a key, then click «&nbsp;Proposer&nbsp;».
        </li>
        <li>
          <strong>Review and publish.</strong>
          You are also a reviewer. Under «&nbsp;Proposées&nbsp;», tick the key, then click «&nbsp;Publier&nbsp;».
        </li>
        <li>
          <strong>Let an agent propose.</strong>
          Run the agent under the editor. Its batch then waits under «&nbsp;Proposées&nbsp;».
        </li>
      </ol>
      <a class="demo-full" :href="demoUrl" target="_blank" rel="noopener">Open in full screen</a>
    </div>

    <div class="demo-wide">
      <iframe
        ref="frame"
        class="demo-frame"
        :src="demoUrl"
        title="Demo of the editor"
        loading="lazy"
        @load="waitForDemo"
      />

      <div class="agent">
        <div class="agent-bar">
          <span>An agent, through MCP</span>
          <button type="button" :disabled="!ready || running" @click="runAgent">
            {{ running ? 'Running…' : lines.length > 0 ? 'Run again' : 'Run the agent' }}
          </button>
        </div>
        <pre
          ref="screen"
          class="agent-screen"
        ><template v-if="lines.length === 0"><span v-if="failed" class="agent-note">The demo did not load. <a :href="demoUrl" target="_blank" rel="noopener">Open it in full screen</a>, or reload the page.</span><span v-else-if="!ready" class="agent-output">Loading the demo…</span><span v-else class="agent-note">The agent lists the German keys that are missing, and proposes them as one batch.</span></template><template v-for="(line, index) in lines" :key="index"><span v-if="line.kind === 'command'" class="agent-prompt">→ </span><span :class="`agent-${line.kind}`">{{ line.text }}</span>
</template></pre>
        <p class="sr-only" aria-live="polite">{{ announced }}</p>
      </div>
    </div>

    <div class="demo-narrow">
      <img
        :src="withBase('/demo-preview.png')"
        alt="The editor: the German keys of the repository acme/shop, with the ones still to translate"
      />
      <a class="demo-open" :href="demoUrl">Open the demo</a>
      <p>The editor needs a wide screen. Open it on a computer for the best view.</p>
    </div>
  </section>
</template>

<style scoped>
/* The same width and side padding as the hero and the features. The editor needs its side panel and three columns. */
.demo {
  margin: 0 auto;
  max-width: 1280px;
  padding: 48px 24px 64px;
}

@media (min-width: 640px) {
  .demo {
    padding: 64px 48px 80px;
  }
}

@media (min-width: 960px) {
  .demo {
    padding: 64px 64px 96px;
  }
}

.demo-head h2 {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 40px;
}

.demo-head p {
  margin: 12px 0 0;
  max-width: 680px;
  color: var(--vp-c-text-2);
}

.demo-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 24px 0 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}

.demo-steps li {
  margin: 0;
  padding: 16px 20px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  font-size: 14px;
  line-height: 22px;
  color: var(--vp-c-text-2);
  counter-increment: step;
}

.demo-steps li::before {
  content: counter(step);
  display: grid;
  place-items: center;
  margin-bottom: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--vp-c-brand-soft);
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.demo-steps strong {
  display: block;
  color: var(--vp-c-text-1);
}

.demo-full {
  display: inline-block;
  margin: 16px 0;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.demo-frame {
  display: block;
  width: 100%;
  height: min(680px, calc(100vh - 120px));
  min-height: 520px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #fff;
}

.agent {
  margin-top: 16px;
  border: 1px solid #2b2e36;
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
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text);
  font-weight: 500;
}

.agent-bar button:not(:disabled):hover {
  background: var(--vp-button-brand-hover-bg);
}

.agent-bar button:disabled {
  opacity: 0.5;
  cursor: default;
}

.agent-screen {
  margin: 0;
  height: 240px;
  padding: 12px 16px;
  overflow: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.agent-screen a {
  color: #7fb2ff;
  text-decoration: underline;
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.demo-narrow {
  display: none;
}

.demo-narrow img {
  width: 100%;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.demo-open {
  display: block;
  margin-top: 16px;
  padding: 10px 20px;
  border-radius: 20px;
  background: var(--vp-button-brand-bg);
  text-align: center;
  font-weight: 600;
  color: var(--vp-button-brand-text);
}

.demo-narrow p {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
  text-align: center;
}

@media (max-width: 767px) {
  .demo-steps {
    grid-template-columns: minmax(0, 1fr);
  }

  .demo-wide,
  .demo-full {
    display: none;
  }

  .demo-narrow {
    display: block;
    margin-top: 24px;
  }
}
</style>
