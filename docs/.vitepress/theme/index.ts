import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import CopyPrompt from './CopyPrompt.vue';
import Layout from './Layout.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp: ({ app }) => {
    app.component('CopyPrompt', CopyPrompt);
  },
} satisfies Theme;
