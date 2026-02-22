const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const logAudit = require("../utils/auditLogger");
const { Parser } = require("json2csv");

const router = express.Router();
const jwt = require("jsonwebtoken");

router.post(
  "/switch-role",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {

    const { newRole } = req.body;

    if (!["admin", "director", "staff"].includes(newRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const token = jwt.sign(
      {
        id: req.user.id,
        role: "admin",       // stays admin forever
        activeRole: newRole
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: `Switched to ${newRole}`,
      token
    });
  }
);

/* =====================================================
   CREATE DIRECTOR
===================================================== */
router.post(
  "/create-director",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }

    try {
      const hash = await bcrypt.hash(password, 10);

      await pool.query(
        `INSERT INTO users (username, password, role, created_by)
         VALUES ($1, $2, 'director', $3)`,
        [username, hash, req.user.id]
      );
      res.json({ message: "Director created successfully" });
      await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "CREATE",
        targetRole: "director",
        description: `Admin created director ${username}`,
      });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ message: "Username already exists" });
      }
      res.status(500).json({ message: "Error creating director" });
    }
  }
);

/* =====================================================
   UPDATE DIRECTOR PASSWORD
===================================================== */
router.put(
  "/update-director-password",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res.status(400).json({ message: "Username and password required" });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `UPDATE users
       SET password = $1
       WHERE username = $2 AND role = 'director'`,
      [hash, username]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Director not found" });
    }

    res.json({ message: "Director password updated" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "UPDATE",
        targetRole: "director",
        description: `Admin updated director ${username}`,
      });
  }
);

/* =====================================================
   GET ALL USERS (Admin)
===================================================== */
router.get(
  "/users",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, username, role FROM users`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching users" });
    }
  }
);

/* =====================================================
   DELETE DIRECTOR
===================================================== */
router.delete(
  "/delete-director/:id",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND role = 'director'`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Director not found" });
    }

    res.json({ message: "Director deleted successfully" });
    await logAudit({
        actorId: req.user.id,
        actorRole: req.user.role,
        action: "DELETE",
        targetRole: "director",
        description: `Admin deleted director ${req.params.id}`,
      });
  }
);

/* =====================================================
   AUDIT LOGS
===================================================== */
router.get(
  "/audit-logs",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT actor_role, action, description, created_at
         FROM audit_logs
         ORDER BY created_at DESC`
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching audit logs" });
    }
  }
);
router.get(
  "/audit-logs/export",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT 
          actor_id,
          actor_role,
          action,
          target_user_id,
          target_role,
          description,
          created_at
         FROM audit_logs
         ORDER BY created_at DESC`
      );

      const fields = [
        "actor_id",
        "actor_role",
        "action",
        "target_user_id",
        "target_role",
        "description",
        "created_at"
      ];

      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(result.rows);

      res.header("Content-Type", "text/csv");
      res.attachment("audit_logs.csv");
      res.send(csv);

    } catch (err) {
      res.status(500).json({ message: "CSV export failed" });
    }
  }
);
router.get(
  "/audit-logs",
  authMiddleware,
  roleMiddleware(["admin"]),
  async (req, res) => {
    const { role, from, to } = req.query;

    let query = `
      SELECT actor_role, action, description, created_at
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];
    let index = 1;

    // Filter by role
    if (role) {
      query += ` AND actor_role = $${index++}`;
      params.push(role);
    }

    // Filter by start date
    if (from) {
      query += ` AND created_at >= $${index++}`;
      params.push(from);
    }

    // Filter by end date
    if (to) {
      query += ` AND created_at <= $${index++}`;
      params.push(to + " 23:59:59");
    }

    query += " ORDER BY created_at DESC";

    try {
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Error fetching audit logs" });
    }
  }
);

module.exports = router;