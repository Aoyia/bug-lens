import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ElButton } from "./ElButton.jsx";
import { TodoItem } from "./TodoItem.jsx";

export function TodoList({ initialTodos }) {
  const [listFilter] = useState("all");
  const [listSecretToken] = useState("react19-list-secret-token-333");
  const [portalOpen, setPortalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [todos, setTodos] = useState(
    initialTodos || [
      {
        id: 401,
        title: "React 19 Hooks Unpacking",
        completed: false,
        secretToken: "react19-todo-token-xxx-111",
        authPassword: "react19-todo-pwd-yyy-222",
      },
      {
        id: 402,
        title: "Verify Parent Penetration & Portal",
        completed: true,
        secretToken: "react19-todo-token-zzz-333",
        authPassword: "react19-todo-pwd-www-444",
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

  const handleAsyncSave = () => {
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("Saved OK (settled)");
    }, 420);
  };

  return (
    <div className="todo-list-container" data-filter={listFilter}>
      <div className="todo-list-toolbar">
        <h3>React 19 Items ({todos.length})</h3>
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
      <div className="ui-wrapper-sandbox">
        <div className="sandbox-actions">
          <ElButton testId="el-wrapper-btn" onClick={handleAsyncSave}>
            Save Draft
          </ElButton>
          <ElButton
            testId="open-portal-btn"
            onClick={() => setPortalOpen((prev) => !prev)}
          >
            Open Portal
          </ElButton>
          <span data-testid="async-result">{saveStatus}</span>
        </div>
      </div>
      {portalOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            className="el-dialog portal-dialog"
            data-testid="portal-dialog"
          >
            <div data-testid="portal-title">
              React 19 Body Portal Overlay (filter={listFilter})
            </div>
            <button
              type="button"
              data-testid="close-portal-btn"
              onClick={() => setPortalOpen(false)}
            >
              Close
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
