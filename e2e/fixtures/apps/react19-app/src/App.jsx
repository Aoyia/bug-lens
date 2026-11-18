import React, { useState } from "react";
import { TodoList } from "./components/TodoList.jsx";

export function App() {
  const [appTitle] = useState("React 19 Todo Application");
  const [systemSecret] = useState("react19-system-secret-root-999");

  return (
    <div className="app-container" data-testid="app-root">
      <header className="header">
        <h1 data-testid="app-title">{appTitle}</h1>
        <p className="subtitle">Root Secret: {systemSecret}</p>
      </header>
      <main>
        <TodoList />
      </main>
    </div>
  );
}
