import React from "react";

export function ElButton({ children, onClick, testId, className = "" }) {
  return (
    <button
      type="button"
      className={`el-button ${className}`.trim()}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="el-button__inner">{children}</span>
    </button>
  );
}
