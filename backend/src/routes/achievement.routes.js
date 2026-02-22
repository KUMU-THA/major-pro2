const express = require("express");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");

const router = express.Router();

// =========================
//   GET ALL ACHIEVEMENTS (all roles)
// =========================
router.get(
  "/",
  authMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM achievements ORDER BY achievementdate DESC"
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =========================
//   GET SINGLE ACHIEVEMENT (all roles)
// =========================
router.get(
  "/:id",
  authMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM achievements WHERE id = $1",
        [req.params.id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Achievement not found" });
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =========================
//   CREATE ACHIEVEMENT (staff, director only)
// =========================
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["staff", "director"]),
  async (req, res) => {
    try {
      const {
        rollno,
        studentname,
        department,
        batch,
        title,
        description,
        eventname,
        position,
        achievementdate,
      } = req.body;

      if (!rollno || !studentname || !title || !achievementdate) {
        return res.status(400).json({ message: "rollno, studentname, title, achievementdate are required" });
      }

      const result = await pool.query(
        `INSERT INTO achievements
          (rollno, studentname, department, batch, title, description, eventname, position, achievementdate, createdby)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [rollno, studentname, department, batch, title, description, eventname, position, achievementdate, req.user.id]
      );

      res.status(201).json({ message: "Achievement created", achievement: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =========================
//   UPDATE ACHIEVEMENT (staff, director only)
// =========================
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["staff", "director"]),
  async (req, res) => {
    try {
      const {
        rollno,
        studentname,
        department,
        batch,
        title,
        description,
        eventname,
        position,
        achievementdate,
      } = req.body;

      const check = await pool.query(
        "SELECT * FROM achievements WHERE id = $1",
        [req.params.id]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ message: "Achievement not found" });
      }

      const result = await pool.query(
        `UPDATE achievements SET
          rollno=$1, studentname=$2, department=$3, batch=$4,
          title=$5, description=$6, eventname=$7, position=$8, achievementdate=$9
         WHERE id=$10
         RETURNING *`,
        [rollno, studentname, department, batch, title, description, eventname, position, achievementdate, req.params.id]
      );

      res.json({ message: "Achievement updated", achievement: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// =========================
//   DELETE ACHIEVEMENT (staff, director only)
// =========================
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["staff", "director"]),
  async (req, res) => {
    try {
      const check = await pool.query(
        "SELECT * FROM achievements WHERE id = $1",
        [req.params.id]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ message: "Achievement not found" });
      }

      await pool.query("DELETE FROM achievements WHERE id=$1", [req.params.id]);
      res.json({ message: "Achievement deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;