<template>
  <div
    class="todo-item"
    :class="{ completed: props.completed }"
    :data-id="props.id"
    data-testid="todo-item"
  >
    <div class="todo-item-header">
      <span class="todo-title" data-testid="todo-title">{{ props.title }}</span>
      <span class="todo-status"
        >({{ props.completed ? "Completed" : "Pending" }})</span
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
        {{ props.completed ? "Mark Pending" : "Mark Done" }}
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

<script setup>
import { ref, reactive } from "vue";

const props = defineProps({
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
    default: "default-secret-token-vue3",
  },
  authPassword: {
    type: String,
    default: "default-auth-password-vue3",
  },
});

const emit = defineEmits(["toggle"]);

const clickCount = ref(0);
const internalNotes = ref("Internal notes for Vue 3 item");
const sensitiveConfig = reactive({
  apiKey: "vue3-item-api-key-secret-999",
  token: "vue3-item-token-secret-888",
  password: "vue3-item-password-secret-777",
});

function onClickToggle() {
  clickCount.value += 1;
  emit("toggle", props.id);
}

function incrementClick() {
  clickCount.value += 1;
}
</script>
