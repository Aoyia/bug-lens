<template>
  <section class="todoapp">
    <header class="header">
      <h1>todos</h1>
      <input
        class="new-todo"
        autofocus
        placeholder="What needs to be done?"
        v-model="newTodo"
        @keyup.enter="addTodo"
      />
    </header>
    <section class="main" v-show="todos.length">
      <input
        id="toggle-all"
        class="toggle-all"
        type="checkbox"
        :checked="remaining === 0"
        @change="toggleAll"
      />
      <label for="toggle-all">Mark all as complete</label>
      <ul class="todo-list">
        <li
          v-for="todo in filteredTodos"
          :key="todo.id"
          class="todo"
          :class="{ completed: todo.completed, editing: todo === editedTodo }"
        >
          <div class="view">
            <input
              class="toggle"
              type="checkbox"
              :checked="todo.completed"
              @change="toggleTodo(todo)"
            />
            <label @dblclick="editTodo(todo)">{{ todo.title }}</label>
            <button class="destroy" @click="removeTodo(todo)"></button>
          </div>
          <input
            v-if="todo === editedTodo"
            class="edit"
            type="text"
            v-model="todo.title"
            @vue:mounted="({ el }) => el.focus()"
            @blur="doneEdit(todo)"
            @keyup.enter="doneEdit(todo)"
            @keyup.escape="cancelEdit(todo)"
          />
        </li>
      </ul>
    </section>
    <footer class="footer" v-show="todos.length">
      <span class="todo-count">
        <strong>{{ remaining }}</strong>
        <span>{{ remaining === 1 ? " item" : " items" }} left</span>
      </span>
      <ul class="filters">
        <li>
          <a
            href="#/all"
            :class="{ selected: visibility === 'all' }"
            @click="visibility = 'all'"
            >All</a
          >
        </li>
        <li>
          <a
            href="#/active"
            :class="{ selected: visibility === 'active' }"
            @click="visibility = 'active'"
            >Active</a
          >
        </li>
        <li>
          <a
            href="#/completed"
            :class="{ selected: visibility === 'completed' }"
            @click="visibility = 'completed'"
            >Completed</a
          >
        </li>
      </ul>
    </footer>
  </section>
  <footer class="info">
    <p>Vue 3 Composition API Standard Benchmark</p>
    <p>
      Built for
      <a href="https://github.com/Aoyia/bug-lens">Bug Lens</a> Diagnostic
      Capture
    </p>
  </footer>
</template>

<script setup>
import { ref, computed } from "vue";

const todos = ref([
  { id: 1, title: "Install Bug Lens Extension in Chrome", completed: true },
  { id: 2, title: "Open Vue 3 TodoMVC Benchmark Page", completed: false },
  { id: 3, title: "Toggle check or delete this todo item", completed: false },
]);

const newTodo = ref("");
const editedTodo = ref(null);
const visibility = ref("all");

const remaining = computed(() => {
  return todos.value.filter((todo) => !todo.completed).length;
});

const filteredTodos = computed(() => {
  if (visibility.value === "active") {
    return todos.value.filter((t) => !t.completed);
  } else if (visibility.value === "completed") {
    return todos.value.filter((t) => t.completed);
  }
  return todos.value;
});

function addTodo() {
  const value = newTodo.value && newTodo.value.trim();
  if (!value) return;
  todos.value.push({
    id: Date.now(),
    title: value,
    completed: false,
  });
  newTodo.value = "";
}

// 💥 故意植入的标准 Vue 3 真实组件方法异常：读取 undefined 的 storeMeta 字段
function toggleTodo(todo) {
  console.log("[Vue3 TodoApp] Toggling item:", todo.id);

  // 💥 真实 Vue 3 崩溃点：未定义的深层对象引发 TypeError
  const timestamp = todo.storeMeta.lastUpdated.getTime();
  console.log("Last updated at:", timestamp);

  todo.completed = !todo.completed;
}

function removeTodo(todo) {
  console.warn("[Vue3 TodoApp] Deleting item:", todo.title);

  // 💥 发送 500 异步 Mock XHR 报错
  fetch("/api/v1/todos/" + todo.id, { method: "DELETE" }).catch((err) => {
    console.error("[Network Error] Sync failed:", err);
  });

  // 💥 同样的组件抛错
  const deletedAt = todo.storeMeta.deletedTimestamp.toString();
  console.log(deletedAt);

  todos.value.splice(todos.value.indexOf(todo), 1);
}

function editTodo(todo) {
  editedTodo.value = todo;
}

function doneEdit(todo) {
  if (!editedTodo.value) return;
  editedTodo.value = null;
  todo.title = todo.title.trim();
  if (!todo.title) removeTodo(todo);
}

function cancelEdit(todo) {
  editedTodo.value = null;
}

function toggleAll(e) {
  todos.value.forEach((todo) => {
    todo.completed = e.target.checked;
  });
}
</script>
