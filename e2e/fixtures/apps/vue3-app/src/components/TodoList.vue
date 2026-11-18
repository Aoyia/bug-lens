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
    <div
      class="ui-wrapper-sandbox"
      style="
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px dashed #cbd5e1;
      "
    >
      <div style="display: flex; gap: 8px; align-items: center">
        <ElButton test-id="el-wrapper-btn" @click="triggerAsyncSave">
          Save Draft
        </ElButton>
        <ElButton test-id="open-portal-btn" @click="portalOpen = !portalOpen">
          Open Portal
        </ElButton>
        <span data-testid="async-result">{{ saveStatus }}</span>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="portalOpen"
        role="dialog"
        aria-modal="true"
        class="el-dialog portal-dialog"
        data-testid="portal-dialog"
        style="
          position: fixed;
          right: 24px;
          bottom: 24px;
          background: #fff;
          border: 2px solid #2563eb;
          border-radius: 8px;
          padding: 14px 18px;
          z-index: 9999;
        "
      >
        <div data-testid="portal-title">
          Vue 3 Teleport Body Overlay (count={{ todos.length }})
        </div>
        <button
          type="button"
          data-testid="close-portal-btn"
          @click="portalOpen = false"
        >
          Close
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref } from "vue";
import ElButton from "./ElButton.vue";
import TodoItem from "./TodoItem.vue";

const listSecretToken = ref("vue3-list-secret-token-555");
const portalOpen = ref(false);
const saveStatus = ref("idle");

function triggerAsyncSave() {
  saveStatus.value = "saving";
  setTimeout(() => {
    saveStatus.value = "Saved OK (settled)";
  }, 420);
}
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
