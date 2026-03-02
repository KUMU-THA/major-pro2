const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");

const router = express.Router();

/* ===========================
   LOGIN ROUTE
=========================== */
router.post("/login", async (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password;
  // 1️⃣ Validate input
  if (!username || !password) {
    return res.status(400).json({
      message: "Username and password required",
    });
  }

  try {
    // 2️⃣ Find user
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    const user = result.rows[0];

    // 3️⃣ Check account status
    if (user.status && user.status !== "active") {
      return res.status(403).json({ message: `Account is ${user.status}. Please contact admin.` });
    }

    // 4️⃣ Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials",
      });
    }

    // 5️⃣ Create JWT token
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        activeRole: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 6️⃣ Send response
    return res.json({
      message: "Login Successful",
      token,
    });

  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
});

/* ===========================
   GET LOGGED-IN USER PROFILE
=========================== */
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, role, department, batch
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error("Profile Fetch Error:", err);
    return res.status(500).json({
      message: "Error fetching profile",
    });
  }
});

module.exports = router;