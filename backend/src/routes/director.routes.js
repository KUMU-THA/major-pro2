const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const logAudit = require("../utils/auditLogger");
const { Parser } = require("json2csv");
const router = express.Router();



router.post(
  "/create-staff",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    try {
      const hash = await bcrypt.hash(password, 10);

      await pool.query(
        `INSERT INTO users (username, password, role, created_by)
         VALUES ($1, $2, 'staff', $3)`,
        [username, hash, req.user.id]
      );
      res.json({ message: "Staff created successfully" });
      await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "CREATE",
        targetUserId: null,
        targetRole: "staff",
        description: `Director created staff ${username}`
      });

    } catch (err) {
      res.status(500).json({ message: "Error creating staff" });
    }
  }
);
router.put(
  "/update-staff-password",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ message: "Username and password required" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      "UPDATE users SET password=$1 WHERE username=$2 AND role='staff'",
      [hash, username]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Staff not found" });
    }
    res.json({ message: "Staff password updated" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "UPDATE",
        targetRole: "staff",
        description: `Director updated staff ${username}`,
      });
  }
);


router.get(
  "/staff",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, username, department
         FROM users
         WHERE role = 'staff' AND created_by = $1`,
        [req.user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching staff" });
    }
  }
);
router.delete(
  "/delete-staff/:id",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {
    const result = await pool.query(
      `DELETE FROM users
       WHERE id = $1 AND role = 'staff' AND created_by = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ message: "Not allowed" });
    }

    res.json({ message: "Staff deleted" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "DELETE",
        targetRole: "staff",
        description: `Director deleted staff ${req.params.id}`,
      });
  }
);
router.post(
  "/events",
  authMiddleware,
  roleMiddleware(["staff", "director"]),
  async (req, res) => {
    try {
      const { 
        title, 
        description, 
        event_type, 
        event_date, 
        last_registration_date 
      } = req.body;

      await pool.query(
        `INSERT INTO events 
         (title, description, event_type, event_date, last_registration_date, created_by, creator_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          title,
          description,
          event_type,
          event_date,
          last_registration_date,
          req.user.id,
          req.user.role
        ]
      );

      res.json({ message: "Event created successfully" });

    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Server error" });
    }
  }
);


router.get(
  "/events",
  authMiddleware,
  roleMiddleware(["staff", "director"]),
  async (req, res) => {
    const result = await pool.query(
      `SELECT 
         id,
         title,
         description,
         event_type,
         event_date,
         last_registration_date,
         creator_role,
         status
       FROM events
       ORDER BY event_date DESC`
    );

    res.json(result.rows);
  }
);

// UPDATE EVENT
router.put(
  "/events/:id",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {

    const { title, description, event_type, event_date, last_registration_date } = req.body;

    const result = await pool.query(
      `
      UPDATE events
      SET
        title=$1,
        description=$2,
        event_type=$3,
        event_date=$4,
        last_registration_date=$5
      WHERE id=$6
      `,
      [
        title,
        description,
        event_type,
        event_date,
        last_registration_date,
        req.params.id
      ]
    );

    res.json({ message: "Event updated successfully" });

  }
);


// DELETE EVENT
router.delete(
  "/events/:id",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {

    await pool.query(
      "DELETE FROM events WHERE id=$1",
      [req.params.id]
    );

    res.json({ message: "Event deleted successfully" });

  }
);



module.exports = router;