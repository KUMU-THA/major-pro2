const express = require("express");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");

const router = express.Router();

/* =========================
   1️⃣ VIEW ALL EVENTS
========================= */
router.get(
  "/events",
  authMiddleware,
  roleMiddleware(["student"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        // ✅ Added event_date and last_registration_date
        "SELECT id, title, description, event_type, event_date, last_registration_date FROM events"
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Error fetching events" });
    }
  }
);

/* =========================
   2️⃣ REGISTER FOR EVENT
========================= */
router.post(
  "/register/:eventId",
  authMiddleware,
  roleMiddleware(["student"]),
  async (req, res) => {
    try {
      const studentId = req.user.id;
      const eventId = req.params.eventId;

      // Prevent duplicate registration
      const check = await pool.query(
        "SELECT 1 FROM event_registrations WHERE student_id=$1 AND event_id=$2",
        [studentId, eventId]
      );

      if (check.rows.length > 0) {
        return res.status(400).json({ message: "Already registered" });
      }

      await pool.query(
        "INSERT INTO event_registrations (student_id, event_id) VALUES ($1,$2)",
        [studentId, eventId]
      );

      res.json({ message: "Registered successfully" });
    } catch (err) {
      console.error("REGISTER ERROR:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

/* =========================
   3️⃣ VIEW MY REGISTERED EVENTS
========================= */
router.get(
  "/my-events",
  authMiddleware,
  roleMiddleware(["student"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        // ✅ Added event_date, last_registration_date, and registered_at aliased as registered_on
        `SELECT
           e.id,
           e.title,
           e.description,
           e.event_type,
           e.event_date,
           e.last_registration_date,
           r.registered_at AS registered_on
         FROM events e
         JOIN event_registrations r ON e.id = r.event_id
         WHERE r.student_id = $1
         ORDER BY r.registered_at DESC`,
        [req.user.id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Error fetching registered events" });
    }
  }
);

/* =========================
   4️⃣ ALL TRAINING PROGRAMS FOR MY REGISTERED EVENTS
   GET /student/training
========================= */
router.get(
  "/training",
  authMiddleware,
  roleMiddleware(["student"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           tp.id                   AS program_id,
           tp.title                AS program_title,
           tp.from_date,
           tp.to_date,
           tp.start_time,
           tp.end_time,
           tp.location,
           tp.description,
           e.id                    AS event_id,
           e.title                 AS event_title,
           e.event_type,
           e.event_date,
           EXISTS (
             SELECT 1 FROM training_participants tpa
             WHERE tpa.program_id = tp.id AND tpa.student_id = $1
           ) AS is_participant,
           COUNT(DISTINCT ts.id)   AS session_count
         FROM event_registrations er
         JOIN events e             ON er.event_id  = e.id
         JOIN training_programs tp ON tp.event_id  = e.id
         LEFT JOIN training_sessions ts ON ts.program_id = tp.id
         WHERE er.student_id = $1
         GROUP BY tp.id, e.id
         ORDER BY tp.from_date DESC`,
        [req.user.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Student training list:", err.message);
      res.status(500).json({ message: "Error fetching training programs" });
    }
  }
);

/* =========================
   5️⃣ TRAINING PROGRAM DETAIL — sessions + my attendance + performance
   GET /student/training/:programId
========================= */
router.get(
  "/training/:programId",
  authMiddleware,
  roleMiddleware(["student"]),
  async (req, res) => {
    try {
      const studentId = req.user.id;
      const { programId } = req.params;

      // Gate: student must be registered for the event
      const access = await pool.query(
        `SELECT 1
         FROM training_programs tp
         JOIN event_registrations er ON er.event_id = tp.event_id
         WHERE tp.id = $1 AND er.student_id = $2`,
        [programId, studentId]
      );
      if (!access.rows.length)
        return res.status(403).json({ message: "Not registered for this program's event" });

      // Program header
      const prog = await pool.query(
        `SELECT tp.*, e.title AS event_title, e.event_type, e.event_date
         FROM training_programs tp
         JOIN events e ON tp.event_id = e.id
         WHERE tp.id = $1`,
        [programId]
      );

      // Sessions with MY attendance & performance
      const sessions = await pool.query(
        `SELECT
           ts.id              AS session_id,
           ts.session_date,
           ts.start_time,
           ts.end_time,
           ts.location,
           ts.notes,
           a.present,
           a.remarks          AS att_remarks,
           p.metric_value,
           p.metric_unit,
           p.performance_text,
           p.rating
         FROM training_sessions ts
         LEFT JOIN attendance  a ON a.session_id = ts.id AND a.student_id = $2
         LEFT JOIN performance p ON p.session_id = ts.id AND p.student_id = $2
         WHERE ts.program_id = $1
         ORDER BY ts.session_date ASC`,
        [programId, studentId]
      );

      const rows           = sessions.rows;
      const markedSessions = rows.filter(r => r.present !== null).length;
      const presentCount   = rows.filter(r => r.present === true).length;
      const ratings        = rows.filter(r => r.rating != null).map(r => parseFloat(r.rating));

      const isParticipant = await pool.query(
        `SELECT 1 FROM training_participants WHERE program_id=$1 AND student_id=$2`,
        [programId, studentId]
      );

      res.json({
        program:        prog.rows[0],
        is_participant: isParticipant.rows.length > 0,
        summary: {
          total_sessions:        rows.length,
          marked_sessions:       markedSessions,
          present_count:         presentCount,
          absent_count:          markedSessions - presentCount,
          attendance_percentage: markedSessions
            ? ((presentCount / markedSessions) * 100).toFixed(1) : null,
          avg_rating: ratings.length
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null,
        },
        sessions: rows,
      });
    } catch (err) {
      console.error("Student training detail:", err.message);
      res.status(500).json({ message: "Error fetching training detail" });
    }
  }
);
module.exports = router;
