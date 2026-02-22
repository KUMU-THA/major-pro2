const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/db");
const jwt = require("jsonwebtoken");

const router = express.Router();
const authMiddleware = require("../middleware/auth.middleware");
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  // 1. check input
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password required" });
  }

  try {
    // 2. find user
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    // 3. compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 4. success
    // create token
    const token =jwt.sign(
        {
            id:user.id,
            role:user.role,
            activeRole: user.role,
        },
        process.env.JWT_SECRET,
        {expiresIn: "1h" }
    );
    //send response
    res.json({
        message: "Login Successful",
        token
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get(
  "/me",
  authMiddleware,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, username, role, department, batch
         FROM users WHERE id = $1`,
        [req.user.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Error fetching profile" });
    }
  }
);


module.exports = router;
