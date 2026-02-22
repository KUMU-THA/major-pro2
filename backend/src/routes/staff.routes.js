const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const logAudit = require("../utils/auditLogger");
const { Parser } = require("json2csv");
const router = express.Router();
//CREATE STUDENT
router.post(
  "/create-student",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { username, password, department, batch } = req.body;

    if (!username || !password || !department || !batch) {
      return res.status(400).json({ message: "All fields are required" });
    }

    try {
      const hash = await bcrypt.hash(password, 10);

      await pool.query(
        `INSERT INTO users (username, password, role, department, batch, created_by)
         VALUES ($1, $2, 'student', $3, $4, $5)`,
        [username, hash, department, batch, req.user.id]
      );
      await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "CREATE",
        targetUserId: null,
        targetRole: "student",
        description: `Staff created student ${username}`
      });


      res.json({ message: "Student created successfully" });
    } catch (err) {
      res.status(500).json({ message: "Error creating student" });
    }
  }
);

router.get("/students", authMiddleware, roleMiddleware(["staff"]), async (req, res) => {
  try {

    const result = await pool.query(
      `SELECT id, username, department, batch
       FROM users
       WHERE role = 'student'`
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ message: "Error fetching students" });
  }
});

// UPDATE STUDENT
router.put(
  "/update-student",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { username, password, department } = req.body;

    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE users SET password=$1 WHERE username=$2 AND role='student'",
        [hash, username]
      );
    }

    if (department) {
      await pool.query(
        "UPDATE users SET department=$1 WHERE username=$2 AND role='student'",
        [department, username]
      );
    }

    res.json({ message: "Student updated successfully" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "UPDATE",
        targetRole: "student",
        description: `Staff updated student ${username}`,
      });
  }
);
//DELETE STUDENT
router.delete(
  "/delete-student/:id",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const result = await pool.query(
      `DELETE FROM users
       WHERE id = $1 AND role = 'student' AND created_by = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ message: "Not allowed" });
    }

    res.json({ message: "Student deleted" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "DELETE",
        targetRole: "student",
        description: `Staff deleted student ${req.params.id}`,
      });
  }
);

// =====================================================
// GET ALL REGISTERED STUDENTS (FOR STAFF DASHBOARD TABLE)
// =====================================================
router.get(
  "/event-registrations",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          er.id AS registration_id,
          u.username,
          u.department,
          u.batch,
          e.title AS event_name,
          er.registered_at
        FROM event_registrations er
        JOIN users u ON er.student_id = u.id
        JOIN events e ON er.event_id = e.id
        ORDER BY er.registered_at DESC
        `
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Error fetching registrations" });
    }
  }
);
// GET registered students for events (created by director)
router.get(
  "/event-registrations/:eventId",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    try {
      const { eventId } = req.params;

      const result = await pool.query(
        `
        SELECT 
          er.id AS registration_id,
          u.id AS student_id,
          u.username,
          u.department,
          u.batch,
          e.title AS event_name,
          er.registered_at
        FROM event_registrations er
        JOIN users u ON er.student_id = u.id
        JOIN events e ON er.event_id = e.id
        WHERE er.event_id = $1
        ORDER BY er.registered_at DESC
        `,
        [eventId]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("Error fetching registered students:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

//POST TRAINING SCHEDULE
// ================= CREATE TRAINING =================
router.post(
  "/training-schedule",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { event_id, student_id, training_date, start_time, end_time, location, remarks } = req.body;

    if (!event_id || !student_id || !training_date || !start_time || !end_time) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    try {
      await pool.query(
        `
        INSERT INTO training_schedules
        (event_id, student_id, training_date, start_time, end_time, location, remarks, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [event_id, student_id, training_date, start_time, end_time, location, remarks, req.user.id]
      );

      res.json({ message: "Training created successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create training" });
    }
  }
);

// ================= GET TRAINING SCHEDULES =================
router.get(
  "/training-schedule/:eventId",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { eventId } = req.params;

    try {
      const result = await pool.query(
        `
        SELECT ts.id, ts.student_id, u.username, ts.training_date, ts.start_time, ts.end_time, ts.location, ts.remarks
        FROM training_schedules ts
        JOIN users u ON ts.student_id = u.id
        WHERE ts.event_id = $1
        ORDER BY ts.training_date DESC
        `,
        [eventId]
      );

      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch training schedules" });
    }
  }
);

// ================= UPDATE TRAINING =================
router.put(
  "/training-schedule/:id",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { id } = req.params;
    const { event_id, student_id, training_date, start_time, end_time, location, remarks } = req.body;

    if (!event_id || !student_id || !training_date || !start_time || !end_time) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    try {
      await pool.query(
        `
        UPDATE training_schedules
        SET event_id=$1, student_id=$2, training_date=$3, start_time=$4, end_time=$5, location=$6, remarks=$7
        WHERE id=$8
        `,
        [event_id, student_id, training_date, start_time, end_time, location, remarks, id]
      );

      res.json({ message: "Training updated successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to update training" });
    }
  }
);

// ================= DELETE TRAINING =================
router.delete(
  "/training-schedule/:id",
  authMiddleware,
  roleMiddleware(["staff"]),
  async (req, res) => {
    const { id } = req.params;

    try {
      await pool.query(`DELETE FROM training_schedules WHERE id=$1`, [id]);
      res.json({ message: "Training deleted successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to delete training" });
    }
  }
);




// ================= ATTENDANCE =================

// Create / Update attendance for a student in a training
router.post("/training/:trainingId/attendance", async (req, res) => {
  const { trainingId } = req.params;
  const { student_id, present, remarks } = req.body;

  try {
    // Check if attendance already exists
    const existing = await pool.query(
      "SELECT * FROM attendance WHERE training_id=$1 AND student_id=$2",
      [trainingId, student_id]
    );

    let attendanceRow;

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        "UPDATE attendance SET present=$1, remarks=$2 WHERE training_id=$3 AND student_id=$4 RETURNING *",
        [present, remarks, trainingId, student_id]
      );
      attendanceRow = updated.rows[0];
    } else {
      const inserted = await pool.query(
        "INSERT INTO attendance (training_id, student_id, present, remarks) VALUES ($1,$2,$3,$4) RETURNING *",
        [trainingId, student_id, present, remarks]
      );
      attendanceRow = inserted.rows[0];
    }

    // Fetch student info
    const student = await pool.query(
      "SELECT username, department, batch FROM users WHERE id=$1",
      [student_id]
    );

    res.json({
      message: existing.rows.length > 0 ? "Attendance updated" : "Attendance recorded",
      data: {
        ...attendanceRow,
        student_name: student.rows[0]?.username || null,
        department: student.rows[0]?.department || null,
        batch: student.rows[0]?.batch || null
      }
    });

  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ message: "Error recording attendance", error: err.message });
  }
});

// GET attendance for a training
router.get("/training/:trainingId/attendance", async (req, res) => {
  const { trainingId } = req.params;

  try {
    const result = await pool.query(
      `SELECT a.*, u.username AS student_name, u.department, u.batch
       FROM attendance a
       LEFT JOIN users u ON a.student_id = u.id
       WHERE a.training_id = $1
       ORDER BY u.username`,
      [trainingId]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ message: "Error fetching attendance", error: err.message });
  }
});
// ================= PERFORMANCE =================

// ===== RECORD / UPDATE PERFORMANCE =====
// ===== RECORD / UPDATE PERFORMANCE (with student name) =====
router.post("/training/:trainingId/performance", async (req, res) => {
  const { trainingId } = req.params;
  const { student_id, score, comments } = req.body;

  try {
    // Check if performance already exists
    const existing = await pool.query(
      "SELECT * FROM performance WHERE training_id=$1 AND student_id=$2",
      [trainingId, student_id]
    );

    let performanceRow;

    if (existing.rows.length > 0) {
      const updated = await pool.query(
        "UPDATE performance SET score=$1, comments=$2 WHERE training_id=$3 AND student_id=$4 RETURNING *",
        [score, comments, trainingId, student_id]
      );
      performanceRow = updated.rows[0];
    } else {
      const inserted = await pool.query(
        "INSERT INTO performance (training_id, student_id, score, comments) VALUES ($1,$2,$3,$4) RETURNING *",
        [trainingId, student_id, score, comments]
      );
      performanceRow = inserted.rows[0];
    }

    // Fetch student name and info
    const student = await pool.query(
      "SELECT username, department, batch FROM users WHERE id=$1",
      [student_id]
    );

    res.json({
      message: existing.rows.length > 0 ? "Performance updated" : "Performance recorded",
      data: {
        ...performanceRow,
        student_name: student.rows[0]?.username || null,
        department: student.rows[0]?.department || null,
        batch: student.rows[0]?.batch || null
      }
    });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ message: "Error recording performance", error: err.message });
  }
});
// ===== GET PERFORMANCE FOR A TRAINING =====
// ===== GET PERFORMANCE FOR A TRAINING =====
router.get("/training/:trainingId/performance", async (req, res) => {
  const { trainingId } = req.params;

  try {
    const result = await pool.query(
      `SELECT p.*, 
              u.username AS student_name, 
              u.department, 
              u.batch
       FROM performance p
       LEFT JOIN users u ON p.student_id = u.id
       WHERE p.training_id = $1
       ORDER BY p.score DESC`,
      [trainingId]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ message: "Error fetching performance", error: err.message });
  }
});

// ===== GET BEST PERFORMERS =====
router.get("/training/:trainingId/performance/best", async (req, res) => {
  const { trainingId } = req.params;
  try {
    const result = await pool.query(
      `SELECT p.*, 
              u.username AS student_name, 
              u.department, 
              u.batch
       FROM performance p
       LEFT JOIN users u ON p.student_id = u.id
       WHERE p.training_id = $1
       ORDER BY p.score DESC
       LIMIT 5`, // top 5 performers
      [trainingId]
    );
    res.json(result.rows || []);
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ message: "Error fetching best performers", error: err.message });
  }
});

module.exports = router;