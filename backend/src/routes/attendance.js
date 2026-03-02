const express = require('express');
const router = express.Router();
const pool = require('../db/db');

// ─────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────

// GET /attendance/session/:sessionId
// Get attendance sheet for a session (auto-populate participants if not yet marked)
router.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  try {
    // Get all participants of this session's program
    const participants = await pool.query(
      `SELECT tp.student_id, u.username, u.department, u.batch,
              a.id AS attendance_id, a.present, a.remarks, a.marked_by
       FROM training_sessions ts
       JOIN training_participants tp ON tp.program_id = ts.program_id
       JOIN users u ON tp.student_id = u.id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = tp.student_id
       WHERE ts.id = $1
       ORDER BY u.username`,
      [sessionId]
    );

    // Session info
    const session = await pool.query(
      `SELECT ts.*, tp.title AS program_title, e.title AS event_title
       FROM training_sessions ts
       JOIN training_programs tp ON ts.program_id = tp.id
       JOIN events e ON tp.event_id = e.id
       WHERE ts.id = $1`,
      [sessionId]
    );

    res.json({
      session: session.rows[0],
      attendance: participants.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /attendance/session/:sessionId/bulk
// Mark attendance for all students at once (bulk submit)
// Body: { marked_by: 5, records: [{student_id: 10, present: true, remarks: ''}, ...] }
router.post('/session/:sessionId/bulk', async (req, res) => {
  const { sessionId } = req.params;
  const { records, marked_by } = req.body;

  if (!records || !Array.isArray(records) || !marked_by) {
    return res.status(400).json({ error: 'records[] and marked_by are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const r of records) {
      await client.query(
        `INSERT INTO attendance (session_id, student_id, present, remarks, marked_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, student_id)
         DO UPDATE SET present = EXCLUDED.present, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by`,
        [sessionId, r.student_id, r.present ?? true, r.remarks ?? '', marked_by]
      );
    }

    await client.query('COMMIT');
    res.json({ message: `Attendance marked for ${records.length} students` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /attendance/session/:sessionId/single
// Mark/update attendance for a single student
router.post('/session/:sessionId/single', async (req, res) => {
  const { sessionId } = req.params;
  const { student_id, present, remarks, marked_by } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO attendance (session_id, student_id, present, remarks, marked_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, student_id)
       DO UPDATE SET present = EXCLUDED.present, remarks = EXCLUDED.remarks, marked_by = EXCLUDED.marked_by
       RETURNING *`,
      [sessionId, student_id, present ?? true, remarks ?? '', marked_by]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /attendance/program/:programId/summary
// Attendance summary per student across all sessions
router.get('/program/:programId/summary', async (req, res) => {
  const { programId } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         u.id AS student_id,
         u.username,
         u.department,
         u.batch,
         COUNT(ts.id) AS total_sessions,
         COUNT(a.id) FILTER (WHERE a.present = TRUE) AS present_count,
         COUNT(a.id) FILTER (WHERE a.present = FALSE) AS absent_count,
         ROUND(
           COUNT(a.id) FILTER (WHERE a.present = TRUE)::NUMERIC /
           NULLIF(COUNT(ts.id), 0) * 100, 2
         ) AS attendance_percentage
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       JOIN training_sessions ts ON ts.program_id = tp.program_id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = tp.student_id
       WHERE tp.program_id = $1
       GROUP BY u.id, u.username, u.department, u.batch
       ORDER BY attendance_percentage DESC NULLS LAST`,
      [programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /attendance/student/:studentId/program/:programId
// Full attendance history of one student in a program
router.get('/student/:studentId/program/:programId', async (req, res) => {
  const { studentId, programId } = req.params;
  try {
    const result = await pool.query(
      `SELECT ts.session_date, ts.start_time, ts.end_time, ts.location,
              COALESCE(a.present, NULL) AS present,
              a.remarks,
              u.username AS marked_by_name
       FROM training_sessions ts
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = $1
       LEFT JOIN users u ON a.marked_by = u.id
       WHERE ts.program_id = $2
       ORDER BY ts.session_date`,
      [studentId, programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
