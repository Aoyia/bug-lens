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
  </div>
</template>

<script>
import TodoItem from "./TodoItem.vue";

export default {
  name: "TodoList",
  components: {
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
  },
};
</script>
