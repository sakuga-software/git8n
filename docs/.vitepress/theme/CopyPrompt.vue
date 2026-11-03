<script setup lang="ts">
import { withBase } from 'vitepress';
import { computed, onBeforeUnmount, ref } from 'vue';

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

const promptPath = withBase('/agent-prompt.md');
const state = ref<CopyState>('idle');

const label = computed(
  () =>
    ({
      idle: 'Copy the setup prompt',
      copying: 'Copying…',
      copied: 'Copied',
      failed: 'Copy failed',
    })[state.value],
);

let reset: ReturnType<typeof setTimeout> | undefined;

const show = (next: CopyState) => {
  state.value = next;
  clearTimeout(reset);
  if (next === 'copied' || next === 'failed') reset = setTimeout(() => (state.value = 'idle'), 2500);
};

const copy = async () => {
  show('copying');
  try {
    const response = await fetch(promptPath);

    if (!response.ok) throw new Error(String(response.status));
    await navigator.clipboard.writeText(await response.text());
    show('copied');
  } catch {
    show('failed');
  }
};

onBeforeUnmount(() => clearTimeout(reset));
</script>

<template>
  <div class="copy-prompt">
    <button type="button" class="copy" :data-state="state" :disabled="state === 'copying'" @click="copy">
      {{ label }}
    </button>
    <a :href="promptPath" target="_blank" rel="noopener">Read the prompt</a>
    <p class="visually-hidden" aria-live="polite">{{ state === 'copied' || state === 'failed' ? label : '' }}</p>
  </div>
</template>

<style scoped>
.copy-prompt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin: 1rem 0;
}

.copy {
  padding: 0.375rem 0.875rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.5rem;
  color: var(--vp-button-brand-text);
  background: var(--vp-button-brand-bg);
  transition: background-color 0.15s;
}

.copy:hover:not(:disabled) {
  background: var(--vp-button-brand-hover-bg);
}

.copy[data-state='failed'],
.copy[data-state='failed']:hover:not(:disabled) {
  background: var(--vp-c-danger-1);
}

.copy:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
