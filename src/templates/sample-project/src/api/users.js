/**
 * User + team membership endpoints
 *
 * GET  /api/users/me                 Current user profile
 * GET  /api/users/:id/teams          Teams the user belongs to
 * POST /api/users/:id/teams/:teamId  Add user to a team (admin only)
 */

const express = require('express');
const { query } = require('../db/client');
const { requireAuth } = require('../auth/session');

const router = express.Router();

router.use(requireAuth);

router.get('/me', (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name
  });
});

router.get('/:id/teams', async (req, res) => {
  if (req.params.id !== req.user.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { rows } = await query(
    `
    SELECT t.id, t.name, tm.role
    FROM teams t
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = $1
    ORDER BY t.name
    `,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
