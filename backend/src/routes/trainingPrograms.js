const express = require('express');
const router = express.Router();
const pool = require('../db/db'); // adjust path if needed

// ─────────────────────────────────────────────
// TRAINING PROGRAMS (event-level training plan)
// ─────────────────────────────────────────────

// POST /training-programs
// Create a training program for an event, auto-assign registered students
router.post('/', async (req, res) => {
  const {
    event_id, title, from_date, to_date,
    location, start_time, end_time, description,
    created_by
  } = req.body;

  if (!event_id || !title || !from_date || !to_date || !start_time || !end_time || !created_by) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create the program
    const prog = await client.query(
      `INSERT INTO training_programs
        (event_id, title, from_date, to_date, location, start_time, end_time, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [event_id, title, from_date, to_date, location, start_time, end_time, description, created_by]
    );
    const program = prog.rows[0];

    // 2. Auto-add all registered students for this event
    const registered = await client.query(
      `SELECT student_id FROM event_registrations WHERE event_id = $1`,
      [event_id]
    );

    if (registered.rows.length > 0) {
      const values = registered.rows
        .map((r, i) => `($1, $${i + 2}, $${registered.rows.length + 2})`)
        .join(', ');
      const params = [program.id, ...registered.rows.map(r => r.student_id), created_by];
      // rebuild properly
      const insertValues = registered.rows.map((r, i) => `($1, ${r.student_id}, $2)`).join(', ');
      await client.query(
        `INSERT INTO training_participants (program_id, student_id, added_by)
         VALUES ${registered.rows.map((r) => `($1, ${r.student_id}, $2)`).join(', ')}
         ON CONFLICT DO NOTHING`,
        [program.id, created_by]
      );
    }

    // 3. Auto-generate daily sessions (one per day from_date to to_date)
    const start = new Date(from_date);
    const end = new Date(to_date);
    const sessionDates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      sessionDates.push(new Date(d).toISOString().split('T')[0]);
    }

    for (const date of sessionDates) {
      await client.query(
        `INSERT INTO training_sessions (program_id, session_date, start_time, end_time, location)
         VALUES ($1, $2, $3, $4, $5)`,
        [program.id, date, start_time, end_time, location]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Training program created with sessions and participants',
      program,
      sessions_generated: sessionDates.length,
      participants_added: registered.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /training-programs
// Get all programs (optionally filter by event_id)
router.get('/', async (req, res) => {
  const { event_id } = req.query;
  try {
    const query = `
      SELECT tp.*, e.title AS event_title, u.username AS created_by_name,
             COUNT(DISTINCT tpa.student_id) AS participant_count,
             COUNT(DISTINCT ts.id) AS session_count
      FROM training_programs tp
      JOIN events e ON tp.event_id = e.id
      JOIN users u ON tp.created_by = u.id
      LEFT JOIN training_participants tpa ON tpa.program_id = tp.id
      LEFT JOIN training_sessions ts ON ts.program_id = tp.id
      ${event_id ? 'WHERE tp.event_id = $1' : ''}
      GROUP BY tp.id, e.title, u.username
      ORDER BY tp.from_date DESC
    `;
    const result = await pool.query(query, event_id ? [event_id] : []);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /training-programs/:id
router.get('/:id', async (req, res) => {
  try {
    const prog = await pool.query(
      `SELECT tp.*, e.title AS event_title, u.username AS created_by_name
       FROM training_programs tp
       JOIN events e ON tp.event_id = e.id
       JOIN users u ON tp.created_by = u.id
       WHERE tp.id = $1`,
      [req.params.id]
    );
    if (!prog.rows.length) return res.status(404).json({ error: 'Not found' });

    const sessions = await pool.query(
      `SELECT * FROM training_sessions WHERE program_id = $1 ORDER BY session_date`,
      [req.params.id]
    );
    const participants = await pool.query(
      `SELECT tp.student_id, u.username, u.department, u.batch
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       WHERE tp.program_id = $1
       ORDER BY u.username`,
      [req.params.id]
    );

    res.json({
      program: prog.rows[0],
      sessions: sessions.rows,
      participants: participants.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /training-programs/:id
router.put('/:id', async (req, res) => {
  const { title, from_date, to_date, location, start_time, end_time, description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE training_programs
       SET title=$1, from_date=$2, to_date=$3, location=$4,
           start_time=$5, end_time=$6, description=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [title, from_date, to_date, location, start_time, end_time, description, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /training-programs/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM training_programs WHERE id = $1', [req.params.id]);
    res.json({ message: 'Training program deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// PARTICIPANTS management within a program
// ─────────────────────────────────────────────

// POST /training-programs/:id/participants  - add a student manually
router.post('/:id/participants', async (req, res) => {
  const { student_id, added_by } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_participants (program_id, student_id, added_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
      [req.params.id, student_id, added_by]
    );
    res.status(201).json(result.rows[0] || { message: 'Already exists' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /training-programs/:id/participants/:studentId
router.delete('/:id/participants/:studentId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM training_participants WHERE program_id=$1 AND student_id=$2`,
      [req.params.id, req.params.studentId]
    );
    res.json({ message: 'Participant removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// SESSIONS management
// ─────────────────────────────────────────────

// POST /training-programs/:id/sessions  - add extra session
router.post('/:id/sessions', async (req, res) => {
  const { session_date, start_time, end_time, location, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO training_sessions (program_id, session_date, start_time, end_time, location, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, session_date, start_time, end_time, location, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /training-programs/:id/sessions/:sessionId
router.put('/:id/sessions/:sessionId', async (req, res) => {
  const { session_date, start_time, end_time, location, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE training_sessions
       SET session_date=$1, start_time=$2, end_time=$3, location=$4, notes=$5
       WHERE id=$6 AND program_id=$7 RETURNING *`,
      [session_date, start_time, end_time, location, notes, req.params.sessionId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /training-programs/:id/sessions/:sessionId
router.delete('/:id/sessions/:sessionId', async (req, res) => {
  try {
    await pool.query('DELETE FROM training_sessions WHERE id=$1 AND program_id=$2',
      [req.params.sessionId, req.params.id]);
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
