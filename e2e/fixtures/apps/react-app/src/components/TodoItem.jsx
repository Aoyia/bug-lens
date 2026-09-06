import React, { useState } from "react";

export function TodoItem({
  id,
  title,
  completed = false,
  secretToken = "default-secret-token-react18",
  authPassword = "default-auth-password-react18",
  onToggle,
}) {
  const [clickCount, setClickCount] = useState(0);
  const [internalNotes, setInternalNotes] = useState(
    "Internal notes for React item"
  );
  const [sensitiveToken, setSensitiveToken] = useState(
    "react18-item-token-secret-777"
  );
  const [sensitivePassword, setSensitivePassword] = useState(
    "react18-item-password-secret-888"
  );

  const handleToggle = () => {
    setClickCount((prev) => prev + 1);
    onToggle?.(id);
  };

  const handleIncrement = () => {
    setClickCount((prev) => prev + 1);
  };

  return (
    <div
      className={`todo-item ${completed ? "completed" : ""}`}
      data-id={id}
      data-testid="todo-item"
    >
      <div className="todo-item-header">
        <span className="todo-title" data-testid="todo-title">
          {title}
        </span>
        <span className="todo-status">
          ({completed ? "Completed" : "Pending"})
        </span>
      </div>
      <div className="todo-item-meta">
        <span className="item-notes">{internalNotes}</span>
        <span className="item-clicks">Clicks: {clickCount}</span>
      </div>
      <div className="todo-item-actions">
        <button
          className="toggle-btn"
          data-testid="toggle-btn"
          onClick={handleToggle}
        >
          {completed ? "Mark Pending" : "Mark Done"}
        </button>
        <button
          className="increment-btn"
          data-testid="increment-btn"
          onClick={handleIncrement}
        >
          Count++
        </button>
      </div>
    </div>
  );
}
