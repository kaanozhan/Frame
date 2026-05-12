/**
 * TaskList — renders the user's tasks with status filters
 */

import React, { useEffect, useState } from 'react';

const STATUSES = ['all', 'open', 'in_progress', 'done'];

export function TaskList() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data) => {
        setTasks(data);
        setLoading(false);
      });
  }, []);

  const visible = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  if (loading) return <div className="task-list-empty">Loading…</div>;

  return (
    <div className="task-list">
      <div className="task-list-filters">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={s === filter ? 'active' : ''}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <ul>
        {visible.map((t) => (
          <li key={t.id} className={`task task-${t.status}`}>
            <span className="task-title">{t.title}</span>
            <span className="task-status">{t.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
