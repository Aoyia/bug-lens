<template>
  <div class="todo-list-container">
    <div class="todo-list-toolbar">
      <h3>Items ({{ todos.length }})</h3>
      <span class="admin-badge">Admin Key: {{ adminKey }}</span>
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
    <ElDialog
      :visible="portalOpen"
      :title="`Vue 2 Body Portal Overlay (filter=${listFilter})`"
      @close="portalOpen = false"
    />
  </div>
</template>

<script>
import ElButton from "./ElButton.vue";
import ElDialog from "./ElDialog.vue";
import TodoItem from "./TodoItem.vue";

export default {
  name: "TodoList",
  components: {
    ElButton,
    ElDialog,
    TodoItem,
  },
  props: {
    initialTodos: {
      type: Array,
      default: () => [
        {
          id: 101,
          title: "Vue 2 Audit Checklist",
          completed: false,
          secretToken: "vue2-list-token-abc-111",
          authPassword: "vue2-list-pwd-xyz-222",
        },
        {
          id: 102,
          title: "Verify $data and $props",
          completed: true,
          secretToken: "vue2-list-token-def-333",
          authPassword: "vue2-list-pwd-uvw-444",
        },
      ],
    },
  },
  data() {
    return {
      listFilter: "all",
      adminKey: "secret-admin-key-vue2-list-999",
      portalOpen: false,
      saveStatus: "idle",
      todos: this.initialTodos.slice(),
    };
  },
  methods: {
    toggleTodo(id) {
      const item = this.todos.find((t) => t.id === id);
      if (item) {
        item.completed = !item.completed;
      }
    },
    triggerAsyncSave() {
      this.saveStatus = "saving";
      setTimeout(() => {
        this.saveStatus = "Saved OK (settled)";
      }, 420);
    },
  },
};
</script>
