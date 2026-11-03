<script setup lang="ts">
import { useData, withBase } from 'vitepress';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const { page } = useData();

/** The path that `writeRawPages` gives to the Markdown of this page. */
const rawPath = computed(() => withBase(`/raw/${page.value.relativePath}`));

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

const copyState = ref<CopyState>('idle');
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const toggle = ref<HTMLButtonElement | null>(null);

const copyLabel = computed(
  () =>
    ({
      idle: 'Copy page',
      copying: 'Copying…',
      copied: 'Copied',
      failed: 'Copy failed',
    })[copyState.value],
);

let reset: ReturnType<typeof setTimeout> | undefined;

const show = (state: CopyState) => {
  copyState.value = state;
  clearTimeout(reset);
  if (state === 'copied' || state === 'failed') reset = setTimeout(() => (copyState.value = 'idle'), 2500);
};

const copyPage = async () => {
  show('copying');
  try {
    const response = await fetch(rawPath.value);

    if (!response.ok) throw new Error(String(response.status));
    await navigator.clipboard.writeText(await response.text());
    show('copied');
  } catch {
    show('failed');
  }
};

const rawUrl = () => new URL(rawPath.value, window.location.origin).href;
const prompt = () => `Read ${rawUrl()} so I can ask questions about it.`;

const openIn = (target: 'claude' | 'chatgpt') => {
  const query = encodeURIComponent(prompt());
  const url = target === 'claude' ? `https://claude.ai/new?q=${query}` : `https://chatgpt.com/?q=${query}`;

  window.open(url, '_blank', 'noopener');
  close();
};

const close = (returnFocus = false) => {
  open.value = false;
  if (returnFocus) toggle.value?.focus();
};

const onDocumentClick = (event: MouseEvent) => {
  if (root.value && !root.value.contains(event.target as Node)) close();
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close(true);
};

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
  } else {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeydown);
  }
});

watch(
  () => page.value.relativePath,
  () => {
    close();
    show('idle');
  },
);

onBeforeUnmount(() => {
  clearTimeout(reset);
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="page-actions">
    <div class="group">
      <button
        type="button"
        class="action copy"
        :data-state="copyState"
        :disabled="copyState === 'copying'"
        @click="copyPage"
      >
        <svg v-if="copyState === 'copied'" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>
        <svg v-else aria-hidden="true" viewBox="0 0 24 24">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
        </svg>
        <span>{{ copyLabel }}</span>
      </button>
      <button
        ref="toggle"
        type="button"
        class="action toggle"
        aria-label="More actions for this page"
        aria-haspopup="true"
        :aria-expanded="open"
        aria-controls="page-actions-list"
        @click="open = !open"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>

    <ul v-show="open" id="page-actions-list" class="list">
      <li>
        <a :href="rawPath" target="_blank" rel="noopener" @click="close()">View as Markdown</a>
      </li>
      <li>
        <button type="button" @click="openIn('claude')">Open in Claude</button>
      </li>
      <li>
        <button type="button" @click="openIn('chatgpt')">Open in ChatGPT</button>
      </li>
    </ul>

    <p class="visually-hidden" aria-live="polite">
      {{ copyState === 'copied' || copyState === 'failed' ? copyLabel : '' }}
    </p>
  </div>
</template>

<style scoped>
.page-actions {
  position: relative;
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.group {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.5rem;
  color: var(--vp-c-text-2);
  transition:
    color 0.15s,
    background-color 0.15s;
}

.action:hover:not(:disabled) {
  color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
}

.copy {
  border-radius: 7px 0 0 7px;
}

.toggle {
  padding: 0.25rem 0.375rem;
  border-left: 1px solid var(--vp-c-divider);
  border-radius: 0 7px 7px 0;
}

.action.copy[data-state='copied'] {
  color: var(--vp-c-brand-1);
}

.action.copy[data-state='failed'] {
  color: var(--vp-c-danger-1);
}

.action:focus-visible,
.list a:focus-visible,
.list button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.list {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  z-index: 10;
  min-width: 11rem;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
  box-shadow: var(--vp-shadow-3);
}

.list li {
  margin: 0;
}

.list a,
.list button {
  display: block;
  width: 100%;
  padding: 0.375rem 0.625rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  text-align: left;
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.list a:hover,
.list button:hover {
  background: var(--vp-c-default-soft);
}

@media (prefers-reduced-motion: reduce) {
  .action {
    transition: none;
  }
}
</style>
