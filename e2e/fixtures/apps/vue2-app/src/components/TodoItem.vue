<template>
  <div
    class="todo-item"
    :class="{ completed: completed }"
    :data-id="id"
    data-testid="todo-item"
  >
    <div class="todo-item-header">
      <span class="todo-title" data-testid="todo-title">{{ title }}</span>
      <span class="todo-status"
        >({{ completed ? "Completed" : "Pending" }})</span
      >
    </div>
    <div class="todo-item-meta">
      <span class="item-notes">{{ internalNotes }}</span>
      <span class="item-clicks">Clicks: {{ clickCount }}</span>
    </div>
    <div class="todo-item-actions">
      <button
        class="toggle-btn"
        data-testid="toggle-btn"
        @click="onClickToggle"
      >
        {{ completed ? "Mark Pending" : "Mark Done" }}
      </button>
      <button
        class="increment-btn"
        data-testid="increment-btn"
        @click="incrementClick"
      >
        Count++
      </button>
    </div>
  </div>
</template>

<script>
export default {
  name: "TodoItem",
  props: {
    id: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    secretToken: {
      type: String,
      default: "default-secret-token-vue2",
    },
    authPassword: {
      type: String,
      default: "default-auth-password-vue2",
    },
  },
  data() {
    return {
      clickCount: 0,
      internalNotes: "Internal private notes for Vue 2 item",
      itemApiKey: "vue2-item-api-key-sensitive-12345",
      itemPassword: "vue2-item-password-super-secret-67890",
    };
  },
  methods: {
    onClickToggle() {
      this.clickCount += 1;
      this.$emit("toggle", this.id);
    },
    incrementClick() {
      this.clickCount += 1;
    },
  },
};
</script>
