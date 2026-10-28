<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import DemoShowcase from './DemoShowcase.vue';
import HeroTerminal from './HeroTerminal.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <HeroTerminal />
    </template>
    <template #home-hero-after>
      <DemoShowcase />
    </template>
  </Layout>
</template>
