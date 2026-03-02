// routes/staff.routes.js
const express  = require("express");
const bcrypt   = require("bcrypt");
const jwt      = require("jsonwebtoken");
const pool     = require("../db/db");
const auth     = require("../middleware/auth.middleware");
const logAudit = require("../utils/auditLogger");
const router   = express.Router();

const uid = req => req.user.id;

// ================================================================
//  CUSTOM MIDDLEWARE — checks REAL role, not activeRole
//  This fixes the issue where role(["staff"]) fails when
//  activeRole is "student" after a role switch
// ================================================================
const staffOnly = (req, res, next) => {
  const realRole = (req.user.role || "").toLowerCase();
  if (realRole === "admin" || realRole === "staff" || realRole === "director") {
    return next();
  }
  return res.status(403).json({ message: "Staff access required" });
};

// ================================================================
//  ROLE SWITCH
// ================================================================
router.post("/switch-role", auth, staffOnly, async (req, res) => {
  const { newRole } = req.body;
  if (!["staff", "student"].includes(newRole))
    return res.status(400).json({ message: "Invalid role" });

  const token = jwt.sign(
    { id: req.user.id, role: req.user.role, activeRole: newRole },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );
  res.json({ message: `Switched to ${newRole}`, token });
});

// ================================================================
//  STUDENT MANAGEMENT — all staff have full CRUD on ALL students
// ================================================================

// POST /staff/students
router.post("/students", auth, staffOnly, async (req, res) => {
  const username   = rawUsername?.trim();
  const name       = rawName?.trim();
  const rollno     = rawRollno?.trim();
  const reg_number = req.body.reg_number?.trim() || null;
  if (!username || !password || !name || !rollno || !department || !batch) {
    return res.status(400).json({
      message: "username, password, name, rollno, department, batch are required"
    });
  }

  try {
    const dupUser = await pool.query(
      "SELECT id FROM users WHERE username = $1", [username]
    );
    if (dupUser.rows.length)
      return res.status(409).json({ message: "Username already exists" });

    const dupRoll = await pool.query(
      "SELECT id FROM users WHERE rollno = $1", [rollno]
    );
    if (dupRoll.rows.length)
      return res.status(409).json({ message: "Roll number already registered" });

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
         (username, password, role, name, rollno, reg_number,
          department, batch, batch_year, email, phone,
          gender, dob, blood_group, address, created_by)
       VALUES ($1,$2,'student',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, username, name, rollno, reg_number,
                 department, batch, email, phone, status`,
      [
        username, hash, name, rollno, reg_number || null,
        department, batch, batch_year || null,
        email || null, phone || null, gender || null,
        dob || null, blood_group || null, address || null,
        uid(req)
      ]
    );

    await logAudit({
      actorId: uid(req), actorRole: req.user.role,
      action: "CREATE", targetRole: "student",
      description: `Staff created student ${name} (Roll: ${rollno})`
    });

    res.status(201).json({
      message: "Student created successfully",
      student: result.rows[0]
    });
  } catch (err) {
    console.error("Create student:", err.message);
    res.status(500).json({ message: "Error creating student" });
  }
});

// GET /staff/students — ALL students visible to all staff
router.get("/students", auth, staffOnly, async (req, res) => {
  try {
    const { dept, batch, status, search } = req.query;
    const params = [];
    const where  = ["role = 'student'"];

    if (dept)   { params.push(dept);   where.push(`department = $${params.length}`); }
    if (batch)  { params.push(batch);  where.push(`batch = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (search) {
      params.push(`%${search}%`);
      where.push(`(
        COALESCE(name, '') ILIKE $${params.length} OR
        COALESCE(rollno, '') ILIKE $${params.length} OR
        username ILIKE $${params.length} OR
        COALESCE(reg_number, '') ILIKE $${params.length} OR
        COALESCE(department, '') ILIKE $${params.length}
      )`);
    }

    const result = await pool.query(
      `SELECT id, username, name, rollno, reg_number,
              department, batch, batch_year, email, phone,
              gender, blood_group, status, created_at, created_by
       FROM users
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(name, username) ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get students:", err.message);
    res.status(500).json({ message: "Error fetching students" });
  }
});

// GET /staff/students/:id
router.get("/students/:id", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, name, rollno, reg_number, department, batch,
              batch_year, email, phone, gender, dob, blood_group, address,
              status, created_at, created_by
       FROM users WHERE id = $1 AND role = 'student'`,
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ message: "Student not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error fetching student" });
  }
});

// PUT /staff/students/:id — any staff can update any student
router.put("/students/:id", auth, staffOnly, async (req, res) => {
  const {
    name, rollno, reg_number, department, batch, batch_year,
    email, phone, gender, dob, blood_group, address, status, password
  } = req.body;
  try {
    const sets   = [];
    const params = [];
    const push   = (col, val) => {
      if (val !== undefined && val !== null) {
        params.push(val); sets.push(`${col} = $${params.length}`);
      }
    };
    push("name",        name);
    push("rollno",      rollno);
    push("reg_number",  reg_number);
    push("department",  department);
    push("batch",       batch);
    push("batch_year",  batch_year);
    push("email",       email);
    push("phone",       phone);
    push("gender",      gender);
    push("blood_group", blood_group);
    push("address",     address);
    push("status",      status);
    if (dob !== undefined) { params.push(dob || null); sets.push(`dob = $${params.length}`); }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash); sets.push(`password = $${params.length}`);
    }

    if (!sets.length)
      return res.status(400).json({ message: "Nothing to update" });

    params.push(req.params.id);
    await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $${params.length} AND role = 'student'`,
      params
    );

    await logAudit({
      actorId: uid(req), actorRole: req.user.role,
      action: "UPDATE", targetRole: "student",
      description: `Staff updated student id ${req.params.id}`
    });
    res.json({ message: "Student updated successfully" });
  } catch (err) {
    console.error("Update student:", err.message);
    res.status(500).json({ message: "Error updating student" });
  }
});

// DELETE /staff/students/:id — any staff can delete any student
router.delete("/students/:id", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 AND role = 'student' RETURNING id, COALESCE(name, username) AS name",
      [req.params.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ message: "Student not found" });

    await logAudit({
      actorId: uid(req), actorRole: req.user.role,
      action: "DELETE", targetRole: "student",
      description: `Staff deleted student ${result.rows[0].name}`
    });
    res.json({ message: "Student deleted" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting student" });
  }
});

// ================================================================
//  EVENTS  (read-only for staff)
// ================================================================

router.get("/events", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.title, e.event_type, e.event_date,
              e.last_registration_date, e.status,
              COUNT(er.id) AS registered_count
       FROM events e
       LEFT JOIN event_registrations er ON er.event_id = e.id
       WHERE e.status = 'approved'
       GROUP BY e.id
       ORDER BY e.event_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error fetching events" });
  }
});

router.get("/events/:eventId/registrations", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno,
              u.reg_number, u.department, u.batch, u.phone, u.email,
              er.registered_at
       FROM event_registrations er
       JOIN users u ON er.student_id = u.id
       WHERE er.event_id = $1
       ORDER BY u.name`,
      [req.params.eventId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error fetching registrations" });
  }
});

// ================================================================
//  TRAINING PROGRAMS
// ================================================================

router.post("/training-programs", auth, staffOnly, async (req, res) => {
  const { event_id, title, from_date, to_date, start_time, end_time, location, description } = req.body;

  if (!event_id || !title || !from_date || !to_date || !start_time || !end_time)
    return res.status(400).json({
      message: "event_id, title, from_date, to_date, start_time, end_time are required"
    });

  if (new Date(to_date) < new Date(from_date))
    return res.status(400).json({ message: "to_date must be on or after from_date" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prog = await client.query(
      `INSERT INTO training_programs
         (event_id, title, from_date, to_date, start_time, end_time,
          location, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [event_id, title, from_date, to_date, start_time, end_time,
       location || null, description || null, uid(req)]
    );
    const program = prog.rows[0];

    const registered = await client.query(
      "SELECT student_id FROM event_registrations WHERE event_id = $1", [event_id]
    );
    for (const r of registered.rows) {
      await client.query(
        `INSERT INTO training_participants (program_id, student_id, added_by)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [program.id, r.student_id, uid(req)]
      );
    }
    await client.query("COMMIT");

    await logAudit({
      actorId: uid(req), actorRole: req.user.role,
      action: "CREATE", targetRole: "training",
      description: `Created training program "${title}" for event ${event_id}`
    });

    res.status(201).json({
      message: "Training program created",
      program,
      participants_added: registered.rows.length
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.get("/training-programs", auth, staffOnly, async (req, res) => {
  const { event_id } = req.query;
  try {
    const q = `
      SELECT tp.*,
             e.title AS event_title,
             u.name  AS created_by_name,
             COUNT(DISTINCT tpa.student_id) AS participant_count,
             COUNT(DISTINCT ts.id)          AS session_count
      FROM training_programs tp
      JOIN events e ON tp.event_id   = e.id
      JOIN users  u ON tp.created_by = u.id
      LEFT JOIN training_participants tpa ON tpa.program_id = tp.id
      LEFT JOIN training_sessions     ts  ON ts.program_id  = tp.id
      ${event_id ? "WHERE tp.event_id = $1" : ""}
      GROUP BY tp.id, e.title, u.name
      ORDER BY tp.from_date DESC`;
    const result = await pool.query(q, event_id ? [event_id] : []);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/training-programs/:id", auth, staffOnly, async (req, res) => {
  try {
    const prog = await pool.query(
      `SELECT tp.*, e.title AS event_title, u.name AS created_by_name
       FROM training_programs tp
       JOIN events e ON tp.event_id   = e.id
       JOIN users  u ON tp.created_by = u.id
       WHERE tp.id = $1`,
      [req.params.id]
    );
    if (!prog.rows.length)
      return res.status(404).json({ message: "Program not found" });

    const sessions = await pool.query(
      "SELECT * FROM training_sessions WHERE program_id = $1 ORDER BY session_date",
      [req.params.id]
    );
    const participants = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno,
              u.reg_number, u.department, u.batch, u.phone, u.email
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       WHERE tp.program_id = $1
       ORDER BY u.name`,
      [req.params.id]
    );
    res.json({ program: prog.rows[0], sessions: sessions.rows, participants: participants.rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/training-programs/:id", auth, staffOnly, async (req, res) => {
  const { title, from_date, to_date, start_time, end_time, location, description } = req.body;
  try {
    const result = await pool.query(
      `UPDATE training_programs
       SET title=$1, from_date=$2, to_date=$3,
           start_time=$4, end_time=$5, location=$6,
           description=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [title, from_date, to_date, start_time, end_time,
       location || null, description || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Program not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/training-programs/:id", auth, staffOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM training_programs WHERE id = $1", [req.params.id]);
    res.json({ message: "Program deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
//  SESSIONS
// ================================================================

router.post("/training-programs/:id/sessions", auth, staffOnly, async (req, res) => {
  const { session_date, start_time, end_time, location, notes } = req.body;
  if (!session_date || !start_time || !end_time)
    return res.status(400).json({ message: "session_date, start_time, end_time required" });
  try {
    const result = await pool.query(
      `INSERT INTO training_sessions (program_id, session_date, start_time, end_time, location, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, session_date, start_time, end_time, location || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/training-programs/:id/sessions/:sessionId", auth, staffOnly, async (req, res) => {
  const { session_date, start_time, end_time, location, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE training_sessions
       SET session_date=$1, start_time=$2, end_time=$3, location=$4, notes=$5
       WHERE id=$6 AND program_id=$7 RETURNING *`,
      [session_date, start_time, end_time, location || null, notes || null,
       req.params.sessionId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Session not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/training-programs/:id/sessions/:sessionId", auth, staffOnly, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM training_sessions WHERE id=$1 AND program_id=$2",
      [req.params.sessionId, req.params.id]
    );
    res.json({ message: "Session deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/training-programs/:id/participants", auth, staffOnly, async (req, res) => {
  const { student_id } = req.body;
  try {
    await pool.query(
      `INSERT INTO training_participants (program_id, student_id, added_by)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [req.params.id, student_id, uid(req)]
    );
    res.status(201).json({ message: "Participant added" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/training-programs/:id/participants/:studentId", auth, staffOnly, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM training_participants WHERE program_id=$1 AND student_id=$2",
      [req.params.id, req.params.studentId]
    );
    res.json({ message: "Participant removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
//  ATTENDANCE
// ================================================================

router.get("/attendance/session/:sessionId", auth, staffOnly, async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT ts.*, tp.title AS program_title, tp.id AS program_id,
              e.title AS event_title
       FROM training_sessions ts
       JOIN training_programs tp ON ts.program_id = tp.id
       JOIN events             e  ON tp.event_id   = e.id
       WHERE ts.id = $1`,
      [req.params.sessionId]
    );
    if (!session.rows.length)
      return res.status(404).json({ message: "Session not found" });

    const attendance = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno,
              u.department, u.batch,
              a.id AS attendance_id, a.present, a.remarks
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       LEFT JOIN attendance a
         ON a.session_id = $1 AND a.student_id = tp.student_id
       WHERE tp.program_id = $2
       ORDER BY u.name`,
      [req.params.sessionId, session.rows[0].program_id]
    );
    res.json({ session: session.rows[0], attendance: attendance.rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/attendance/session/:sessionId/bulk", auth, staffOnly, async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records))
    return res.status(400).json({ message: "records[] is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of records) {
      await client.query(
        `INSERT INTO attendance (session_id, student_id, present, remarks, marked_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, student_id) DO UPDATE
           SET present=$3, remarks=$4, marked_by=$5`,
        [req.params.sessionId, r.student_id, r.present ?? true, r.remarks || "", uid(req)]
      );
    }
    await client.query("COMMIT");
    res.json({ message: `Attendance saved for ${records.length} students` });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.get("/attendance/program/:programId/summary", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno,
              u.department, u.batch,
              COUNT(ts.id) AS total_sessions,
              COUNT(a.id) FILTER (WHERE a.present = TRUE)  AS present_count,
              COUNT(a.id) FILTER (WHERE a.present = FALSE) AS absent_count,
              ROUND(
                COUNT(a.id) FILTER (WHERE a.present = TRUE)::NUMERIC
                / NULLIF(COUNT(ts.id), 0) * 100
              , 2) AS attendance_percentage,
              BOOL_AND(COALESCE(a.present, FALSE)) AS zero_absence
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       JOIN training_sessions ts ON ts.program_id = tp.program_id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = tp.student_id
       WHERE tp.program_id = $1
       GROUP BY u.id, u.name, u.username, u.rollno, u.department, u.batch
       ORDER BY attendance_percentage DESC NULLS LAST`,
      [req.params.programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
//  PERFORMANCE
// ================================================================

router.post("/performance", auth, staffOnly, async (req, res) => {
  const { session_id, program_id, student_id, metric_value, metric_unit, performance_text, rating } = req.body;
  if (!session_id || !program_id || !student_id)
    return res.status(400).json({ message: "session_id, program_id, student_id required" });
  try {
    const result = await pool.query(
      `INSERT INTO performance
         (session_id, program_id, student_id,
          metric_value, metric_unit, performance_text, rating, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (session_id, student_id) DO UPDATE SET
         metric_value=$4, metric_unit=$5, performance_text=$6, rating=$7, recorded_by=$8
       RETURNING *`,
      [session_id, program_id, student_id,
       metric_value || null, metric_unit || null,
       performance_text || null, rating || null, uid(req)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/performance/session/:sessionId", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.username, u.rollno, u.department, u.batch
       FROM performance p
       JOIN users u ON p.student_id = u.id
       WHERE p.session_id = $1 ORDER BY u.name`,
      [req.params.sessionId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/performance/program/:programId", auth, staffOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno, u.department, u.batch,
              ts.session_date, p.metric_value, p.metric_unit, p.performance_text, p.rating
       FROM training_sessions ts
       LEFT JOIN performance p ON p.session_id = ts.id
       LEFT JOIN users u       ON p.student_id = u.id
       WHERE ts.program_id = $1
       ORDER BY u.name, ts.session_date`,
      [req.params.programId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete("/performance/:id", auth, staffOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM performance WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
//  SELECTION REPORT
// ================================================================

router.get("/selection/program/:programId", auth, staffOnly, async (req, res) => {
  const minAtt    = parseFloat(req.query.min_attendance ?? 75);
  const minRating = parseFloat(req.query.min_rating     ?? 0);
  try {
    const attRows = await pool.query(
      `SELECT u.id AS student_id, u.name, u.username, u.rollno, u.department, u.batch,
              COUNT(ts.id) AS total_sessions,
              COUNT(a.id) FILTER (WHERE a.present = TRUE)  AS present_count,
              COUNT(a.id) FILTER (WHERE a.present = FALSE) AS absent_count,
              ROUND(COUNT(a.id) FILTER (WHERE a.present = TRUE)::NUMERIC
                / NULLIF(COUNT(ts.id), 0) * 100, 2) AS attendance_percentage,
              BOOL_AND(COALESCE(a.present, FALSE)) AS zero_absence
       FROM training_participants tp
       JOIN users u ON tp.student_id = u.id
       JOIN training_sessions ts ON ts.program_id = tp.program_id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.student_id = tp.student_id
       WHERE tp.program_id = $1
       GROUP BY u.id, u.name, u.username, u.rollno, u.department, u.batch`,
      [req.params.programId]
    );

    const perfRows = await pool.query(
      `SELECT p.student_id,
              ROUND(AVG(p.rating), 2) AS avg_rating,
              AVG(p.metric_value)     AS avg_metric,
              MAX(p.metric_value)     AS best_metric,
              MAX(p.metric_unit)      AS metric_unit,
              COUNT(p.id)             AS perf_sessions
       FROM performance p WHERE p.program_id = $1
       GROUP BY p.student_id`,
      [req.params.programId]
    );

    const perfMap = {};
    perfRows.rows.forEach(p => { perfMap[p.student_id] = p; });

    const report = attRows.rows.map(a => {
      const p     = perfMap[a.student_id] || {};
      const att   = parseFloat(a.attendance_percentage ?? 0);
      const rat   = parseFloat(p.avg_rating ?? 0);
      const score = parseFloat(((att / 100) * 60 + (rat / 10) * 40).toFixed(2));
      return {
        student_id: a.student_id, name: a.name, username: a.username,
        rollno: a.rollno, department: a.department, batch: a.batch,
        total_sessions: parseInt(a.total_sessions),
        present_count:  parseInt(a.present_count),
        absent_count:   parseInt(a.absent_count),
        attendance_percentage: att,
        zero_absence:   a.zero_absence,
        avg_rating:     p.avg_rating  ? parseFloat(p.avg_rating)  : null,
        avg_metric:     p.avg_metric  ? parseFloat(p.avg_metric)  : null,
        best_metric:    p.best_metric ? parseFloat(p.best_metric) : null,
        metric_unit:    p.metric_unit ?? null,
        selection_score: score,
        recommended: att >= minAtt && (rat === 0 || rat >= minRating)
      };
    });
    report.sort((a, b) => b.selection_score - a.selection_score);

    res.json({
      program_id: parseInt(req.params.programId),
      thresholds: { min_attendance: minAtt, min_rating: minRating },
      summary: {
        total_students:           report.length,
        recommended_count:        report.filter(r => r.recommended).length,
        perfect_attendance_count: report.filter(r => r.zero_absence).length
      },
      recommended:       report.filter(r => r.recommended),
      not_recommended:   report.filter(r => !r.recommended),
      perfect_attendance: report.filter(r => r.zero_absence)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/selection/program/:programId/student/:studentId", auth, staffOnly, async (req, res) => {
  try {
    const student = await pool.query(
      "SELECT id, name, username, rollno, department, batch FROM users WHERE id = $1",
      [req.params.studentId]
    );
    const details = await pool.query(
      `SELECT ts.session_date, ts.start_time, ts.end_time, ts.location,
              a.present, a.remarks AS att_remarks,
              p.metric_value, p.metric_unit, p.performance_text, p.rating
       FROM training_sessions ts
       LEFT JOIN attendance  a ON a.session_id = ts.id AND a.student_id = $2
       LEFT JOIN performance p ON p.session_id = ts.id AND p.student_id = $2
       WHERE ts.program_id = $1
       ORDER BY ts.session_date`,
      [req.params.programId, req.params.studentId]
    );
    const sessions     = details.rows;
    const presentCount = sessions.filter(s => s.present === true).length;
    const ratings      = sessions.filter(s => s.rating).map(s => s.rating);
    const avgRating    = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null;

    res.json({
      student: student.rows[0],
      total_sessions: sessions.length,
      present_count:  presentCount,
      absent_count:   sessions.length - presentCount,
      attendance_percentage: sessions.length
        ? ((presentCount / sessions.length) * 100).toFixed(2) : "0.00",
      avg_rating: avgRating,
      session_details: sessions
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================================================
//  LEGACY ALIASES
// ================================================================
router.delete("/delete-student/:id", auth, staffOnly, async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id=$1 AND role='student'", [req.params.id]);
    res.json({ message: "Student deleted" });
  } catch {
    res.status(500).json({ message: "Error" });
  }
});

module.exports = router;