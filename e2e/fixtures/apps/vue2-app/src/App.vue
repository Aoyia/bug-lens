<template>
  <div class="app-container" data-testid="app-root">
    <header class="header">
      <h1 data-testid="app-title">{{ appTitle }}</h1>
      <p class="subtitle">System Code: {{ systemSecret }}</p>
    </header>
    <main>
      <TodoList />
    </main>
  </div>
</template>

<script>
import TodoList from "./components/TodoList.vue";

export default {
  name: "App",
  components: {
    TodoList,
  },
  data() {
    return {
      appTitle: "Vue 2 Todo Application",
      systemSecret: "vue2-super-secret-app-key-888",
      userToken: "user-token-vue2-root-777",
    };
  },
};
</script>
