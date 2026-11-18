import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ElButton } from "./ElButton.jsx";
import { TodoItem } from "./TodoItem.jsx";

export function TodoList({ initialTodos }) {
  const [listFilter, setListFilter] = useState("all");
  const [listSecretToken, setListSecretToken] = useState(
    "react18-list-secret-token-333"
  );
  const [portalOpen, setPortalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
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

  const handleAsyncSave = () => {
    setSaveStatus("saving");
    setTimeout(() => {
      setSaveStatus("Saved OK (settled)");
    }, 420);
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
      <div
        className="ui-wrapper-sandbox"
        style={{
          marginTop: "16px",
          paddingTop: "12px",
          borderTop: "1px dashed #cbd5e1",
        }}
      >
        <div
          className="sandbox-actions"
          style={{ display: "flex", gap: "8px", alignItems: "center" }}
        >
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
            style={{
              position: "fixed",
              right: "24px",
              bottom: "24px",
              background: "#fff",
              border: "2px solid #2563eb",
              borderRadius: "8px",
              padding: "14px 18px",
              zIndex: 9999,
            }}
          >
            <div data-testid="portal-title">
              React 18 Body Portal Overlay (filter={listFilter})
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
