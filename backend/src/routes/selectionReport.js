const express = require('express');
const router = express.Router();
const pool = require('../db');

// ─────────────────────────────────────────────
// SELECTION REPORT
// Who performed well + perfect attendance → best for competition
// ─────────────────────────────────────────────

// GET /selection/program/:programId
// Main selection report: attendance % + avg performance rating + avg metric
router.get('/program/:programId', async (req, res) => {
  const { programId } = req.params;

  // Thresholds (can pass as query params)
  const minAttendance = parseFloat(req.query.min_attendance ?? 75); // default 75%
  const minRating = parseFloat(req.query.min_rating ?? 0);

  try {
    // 1. Attendance summary
    const attendance = await pool.query(
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
         ) AS attendance_percentage,
         BOOL_AND(COALESCE(a.present, FALSE)) AS zero_absence
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       JOIN training_sessions ts ON ts.program_id = tp.program_id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = tp.student_id
       WHERE tp.program_id = $1
       GROUP BY u.id, u.username, u.department, u.batch`,
      [programId]
    );

    // 2. Performance summary
    const perf = await pool.query(
      `SELECT
         p.student_id,
         ROUND(AVG(p.rating), 2) AS avg_rating,
         AVG(p.metric_value) AS avg_metric,
         MAX(p.metric_value) AS best_metric,
         MIN(p.metric_value) AS worst_metric,
         MAX(p.metric_unit) AS metric_unit,
         COUNT(p.id) AS sessions_with_performance,
         STRING_AGG(p.performance_text, ' | ' ORDER BY ts.session_date) AS performance_notes
       FROM performance p
       JOIN training_sessions ts ON p.session_id = ts.id
       WHERE p.program_id = $1
       GROUP BY p.student_id`,
      [programId]
    );

    // 3. Merge data
    const perfMap = {};
    for (const p of perf.rows) {
      perfMap[p.student_id] = p;
    }

    const report = attendance.rows.map(a => {
      const p = perfMap[a.student_id] || {};
      const score = computeSelectionScore(
        parseFloat(a.attendance_percentage ?? 0),
        parseFloat(p.avg_rating ?? 0)
      );
      return {
        student_id: a.student_id,
        username: a.username,
        department: a.department,
        batch: a.batch,
        // Attendance
        total_sessions: parseInt(a.total_sessions),
        present_count: parseInt(a.present_count),
        absent_count: parseInt(a.absent_count),
        attendance_percentage: parseFloat(a.attendance_percentage ?? 0),
        zero_absence: a.zero_absence,
        // Performance
        avg_rating: p.avg_rating ? parseFloat(p.avg_rating) : null,
        avg_metric: p.avg_metric ? parseFloat(p.avg_metric) : null,
        best_metric: p.best_metric ? parseFloat(p.best_metric) : null,
        metric_unit: p.metric_unit ?? null,
        sessions_with_performance: p.sessions_with_performance ? parseInt(p.sessions_with_performance) : 0,
        performance_notes: p.performance_notes ?? null,
        // Selection score (weighted)
        selection_score: score,
        // Recommendation
        recommended: a.attendance_percentage >= minAttendance && (p.avg_rating === null || parseFloat(p.avg_rating) >= minRating)
      };
    });

    // Sort: recommended first, then by selection_score desc
    report.sort((a, b) => {
      if (b.recommended !== a.recommended) return b.recommended - a.recommended;
      return b.selection_score - a.selection_score;
    });

    // Perfect attendance group
    const perfectAttendance = report.filter(r => r.zero_absence);
    const recommended = report.filter(r => r.recommended);
    const notRecommended = report.filter(r => !r.recommended);

    res.json({
      program_id: parseInt(programId),
      thresholds: { min_attendance: minAttendance, min_rating: minRating },
      summary: {
        total_students: report.length,
        recommended_count: recommended.length,
        perfect_attendance_count: perfectAttendance.length
      },
      recommended,
      not_recommended: notRecommended,
      perfect_attendance: perfectAttendance
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: weighted selection score
// 60% attendance + 40% performance rating (out of 100)
function computeSelectionScore(attendancePct, avgRating) {
  const attScore = (attendancePct / 100) * 60;     // max 60
  const perfScore = (avgRating / 10) * 40;          // max 40
  return Math.round((attScore + perfScore) * 100) / 100;
}

// GET /selection/program/:programId/student/:studentId
// Detailed report for a single student
router.get('/program/:programId/student/:studentId', async (req, res) => {
  const { programId, studentId } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         ts.id AS session_id,
         ts.session_date,
         ts.location,
         COALESCE(a.present, NULL) AS present,
         a.remarks AS attendance_remarks,
         p.metric_value,
         p.metric_unit,
         p.performance_text,
         p.rating
       FROM training_sessions ts
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = $2
       LEFT JOIN performance p ON p.session_id = ts.id AND p.student_id = $2
       WHERE ts.program_id = $1
       ORDER BY ts.session_date`,
      [programId, studentId]
    );

    const student = await pool.query(
      `SELECT id, username, department, batch FROM users WHERE id = $1`,
      [studentId]
    );

    // Compute totals
    const sessions = result.rows;
    const totalSessions = sessions.length;
    const presentCount = sessions.filter(s => s.present === true).length;
    const ratings = sessions.filter(s => s.rating !== null).map(s => s.rating);
    const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null;

    res.json({
      student: student.rows[0],
      total_sessions: totalSessions,
      present_count: presentCount,
      absent_count: totalSessions - presentCount,
      attendance_percentage: totalSessions ? ((presentCount / totalSessions) * 100).toFixed(2) : 0,
      avg_rating: avgRating,
      session_details: sessions
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /selection/event/:eventId
// Quick overview across all training programs for an event
router.get('/event/:eventId', async (req, res) => {
  const { eventId } = req.params;
  try {
    const programs = await pool.query(
      `SELECT id, title FROM training_programs WHERE event_id = $1`,
      [eventId]
    );
    res.json({
      event_id: parseInt(eventId),
      programs: programs.rows,
      hint: `Use /selection/program/:programId to get detailed selection report per program`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
