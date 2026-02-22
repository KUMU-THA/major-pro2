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
        "SELECT id, title, description, event_type FROM events"
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

      // 🔹 Prevent duplicate registration
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
        `SELECT e.id, e.title, e.description, e.event_type
         FROM events e
         JOIN event_registrations r ON e.id = r.event_id
         WHERE r.student_id = $1`,
        [req.user.id]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err.message);
      res.status(500).json({ message: "Error fetching registered events" });
    }
  }
);

module.exports = router;
