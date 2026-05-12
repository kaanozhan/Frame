/**
 * App root — routing + auth context
 */

import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TaskList } from './components/TaskList';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TaskList />} />
        <Route path="/dashboard" element={<TaskList />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}

function Login() {
  return (
    <div className="login">
      <h1>TaskFlow</h1>
      <a href="/auth/google/start" className="btn-google">
        Sign in with Google
      </a>
    </div>
  );
}
