import React, { useState } from "react";
import { TodoList } from "./components/TodoList.jsx";

export function App() {
  const [appTitle, setAppTitle] = useState("React 18 Todo Application");
  const [systemSecret, setSystemSecret] = useState(
    "react18-system-secret-root-999"
  );
  const [authAdmin, setAuthAdmin] = useState({
    user: "admin",
    password: "react18-admin-pwd-root-888",
  });

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
