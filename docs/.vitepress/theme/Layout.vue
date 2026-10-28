<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import DemoShowcase from './DemoShowcase.vue';
import HeroFlow from './HeroFlow.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-image>
      <HeroFlow />
    </template>
    <template #home-hero-after>
      <DemoShowcase />
    </template>
  </Layout>
</template>
