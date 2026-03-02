const express = require('express');
const router = express.Router();
const pool = require('../db/db');

// ─────────────────────────────────────────────
// PERFORMANCE
// Units for athletic: m, kg, sec, min
// For team games: performance_text + rating
// ─────────────────────────────────────────────

// POST /performance
// Enter/update performance for a student in a session
router.post('/', async (req, res) => {
  const {
    session_id, program_id, student_id,
    metric_value, metric_unit,   // for athletics
    performance_text,             // for team games / general
    rating,                       // 1-10
    recorded_by
  } = req.body;

  if (!session_id || !program_id || !student_id || !recorded_by) {
    return res.status(400).json({ error: 'session_id, program_id, student_id, recorded_by are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO performance
         (session_id, program_id, student_id, metric_value, metric_unit, performance_text, rating, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (session_id, student_id)
       DO UPDATE SET
         metric_value = EXCLUDED.metric_value,
         metric_unit = EXCLUDED.metric_unit,
         performance_text = EXCLUDED.performance_text,
         rating = EXCLUDED.rating,
         recorded_by = EXCLUDED.recorded_by
       RETURNING *`,
      [session_id, program_id, student_id, metric_value, metric_unit, performance_text, rating, recorded_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /performance/session/:sessionId/bulk
// Enter performance for all students in a session at once
// Body: { recorded_by, records: [{student_id, metric_value, metric_unit, performance_text, rating}] }
router.post('/session/:sessionId/bulk', async (req, res) => {
  const { sessionId } = req.params;
  const { records, recorded_by } = req.body;

  if (!records || !Array.isArray(records) || !recorded_by) {
    return res.status(400).json({ error: 'records[] and recorded_by are required' });
  }

  // Get program_id from session
  const sess = await pool.query('SELECT program_id FROM training_sessions WHERE id=$1', [sessionId]);
  if (!sess.rows.length) return res.status(404).json({ error: 'Session not found' });
  const program_id = sess.rows[0].program_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of records) {
      await client.query(
        `INSERT INTO performance
           (session_id, program_id, student_id, metric_value, metric_unit, performance_text, rating, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (session_id, student_id)
         DO UPDATE SET
           metric_value = EXCLUDED.metric_value,
           metric_unit = EXCLUDED.metric_unit,
           performance_text = EXCLUDED.performance_text,
           rating = EXCLUDED.rating,
           recorded_by = EXCLUDED.recorded_by`,
        [sessionId, program_id, r.student_id, r.metric_value, r.metric_unit, r.performance_text, r.rating, recorded_by]
      );
    }
    await client.query('COMMIT');
    res.json({ message: `Performance recorded for ${records.length} students` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /performance/session/:sessionId
// All performance entries for a session
router.get('/session/:sessionId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.username, u.department, u.batch, r.username AS recorded_by_name
       FROM performance p
       JOIN users u ON p.student_id = u.id
       LEFT JOIN users r ON p.recorded_by = r.id
       WHERE p.session_id = $1
       ORDER BY u.username`,
      [req.params.sessionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /performance/program/:programId
// All performance across all sessions grouped by student
router.get('/program/:programId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id AS student_id, u.username, u.department, u.batch,
         ts.session_date,
         p.metric_value, p.metric_unit, p.performance_text, p.rating
       FROM training_sessions ts
       LEFT JOIN performance p ON p.session_id = ts.id
       LEFT JOIN users u ON p.student_id = u.id
       WHERE ts.program_id = $1
       ORDER BY u.username, ts.session_date`,
      [req.params.programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /performance/student/:studentId/program/:programId
// One student's full performance history in a program
router.get('/student/:studentId/program/:programId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ts.session_date, p.metric_value, p.metric_unit,
              p.performance_text, p.rating, r.username AS recorded_by_name
       FROM training_sessions ts
       LEFT JOIN performance p ON p.session_id = ts.id AND p.student_id = $1
       LEFT JOIN users r ON p.recorded_by = r.id
       WHERE ts.program_id = $2
       ORDER BY ts.session_date`,
      [req.params.studentId, req.params.programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /performance/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM performance WHERE id=$1', [req.params.id]);
    res.json({ message: 'Performance record deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
