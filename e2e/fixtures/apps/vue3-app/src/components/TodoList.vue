<template>
  <div class="todo-list-container">
    <div class="todo-list-toolbar">
      <h3>Vue 3 Items ({{ todos.length }})</h3>
      <span class="admin-badge">List Token: {{ listSecretToken }}</span>
    </div>
    <div class="todo-list">
      <TodoItem
        v-for="item in todos"
        :key="item.id"
        :id="item.id"
        :title="item.title"
        :completed="item.completed"
        :secret-token="item.secretToken"
        :auth-password="item.authPassword"
        @toggle="toggleTodo"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from "vue";
import TodoItem from "./TodoItem.vue";

const listSecretToken = ref("vue3-list-secret-token-555");
const todos = ref([
  {
    id: 201,
    title: "Vue 3 Script Setup Test",
    completed: false,
    secretToken: "vue3-todo-token-aaa-111",
    authPassword: "vue3-todo-pwd-bbb-222",
  },
  {
    id: 202,
    title: "Verify setupState Unpacking",
    completed: true,
    secretToken: "vue3-todo-token-ccc-333",
    authPassword: "vue3-todo-pwd-ddd-444",
  },
]);

function toggleTodo(id) {
  const item = todos.value.find((t) => t.id === id);
  if (item) {
    item.completed = !item.completed;
  }
}
</script>
