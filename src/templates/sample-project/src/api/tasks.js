/**
 * Task CRUD endpoints
 *
 * GET    /api/tasks         List tasks for the current user's team(s)
 * POST   /api/tasks         Create a task
 * PATCH  /api/tasks/:id     Update status / assignee / title
 * DELETE /api/tasks/:id     Delete a task (creator or team admin only)
 */

const express = require('express');
const { query } = require('../db/client');
const { requireAuth } = require('../auth/session');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const { rows } = await query(
    `
    SELECT t.*
    FROM tasks t
    JOIN team_members tm ON tm.team_id = t.team_id
    WHERE tm.user_id = $1
    ORDER BY t.updated_at DESC
    `,
    [req.user.id]
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { team_id, title, description, assigned_to_user_id } = req.body;
  const { rows } = await query(
    `
    INSERT INTO tasks (team_id, title, description, assigned_to_user_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [team_id, title, description, assigned_to_user_id || null]
  );
  res.status(201).json(rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { status, assigned_to_user_id, title } = req.body;
  const { rows } = await query(
    `
    UPDATE tasks
    SET status              = COALESCE($2, status),
        assigned_to_user_id = COALESCE($3, assigned_to_user_id),
        title               = COALESCE($4, title),
        updated_at          = now()
    WHERE id = $1
    RETURNING *
    `,
    [req.params.id, status, assigned_to_user_id, title]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
