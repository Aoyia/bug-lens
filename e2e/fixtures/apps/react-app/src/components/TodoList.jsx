import React, { useState } from "react";
import { TodoItem } from "./TodoItem.jsx";

export function TodoList({ initialTodos }) {
  const [listFilter, setListFilter] = useState("all");
  const [listSecretToken, setListSecretToken] = useState(
    "react18-list-secret-token-333"
  );
  const [todos, setTodos] = useState(
    initialTodos || [
      {
        id: 301,
        title: "React 18 Hooks Unpacking",
        completed: false,
        secretToken: "react18-todo-token-xxx-111",
        authPassword: "react18-todo-pwd-yyy-222",
      },
      {
        id: 302,
        title: "Verify _debugSource Source & Line",
        completed: true,
        secretToken: "react18-todo-token-zzz-333",
        authPassword: "react18-todo-pwd-www-444",
      },
    ]
  );

  const handleToggle = (id) => {
    setTodos((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  return (
    <div className="todo-list-container">
      <div className="todo-list-toolbar">
        <h3>React 18 Items ({todos.length})</h3>
        <span className="admin-badge">List Token: {listSecretToken}</span>
      </div>
      <div className="todo-list">
        {todos.map((item) => (
          <TodoItem
            key={item.id}
            id={item.id}
            title={item.title}
            completed={item.completed}
            secretToken={item.secretToken}
            authPassword={item.authPassword}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}
