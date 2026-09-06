<template>
  <div class="app-container" data-testid="app-root">
    <header class="header">
      <h1 data-testid="app-title">{{ appTitle }}</h1>
      <p class="subtitle">Root Secret: {{ systemSecret }}</p>
    </header>
    <main>
      <TodoList />
    </main>
  </div>
</template>

<script setup>
import { ref, reactive } from "vue";
import TodoList from "./components/TodoList.vue";

const appTitle = ref("Vue 3 Todo Application");
const systemSecret = ref("vue3-system-secret-root-999");
const appStats = reactive({
  totalViews: 42,
  adminPassword: "vue3-admin-pass-root-888",
});
</script>
