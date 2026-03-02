// routes/achievements.routes.js
// Full achievement CRUD with media upload (multer)
//
// HOW YOUR MIDDLEWARE WORKS:
//   req.user.role       = real DB role  (admin / director / staff / student)
//   req.user.activeRole = current acting role (same as role unless switched)
//   roleMiddleware([...]) checks activeRole, BUT admin always passes regardless
//
// ACCESS RULES:
//   admin                        → full CRUD (bypassed by roleMiddleware automatically)
//   director / staff (activeRole)→ full CRUD
//   student                      → GET read-only only (no roleMiddleware needed, blocked manually)

const express = require("express");
const pool = require("../db/db");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// ─── Helper: is this user a staff-level actor? ────────────────────────────────
// Checks BOTH role and activeRole so a staff user who hasn't switched still works
const isStaffActor = (req) =>
  req.user.role === "admin" ||
  ["director", "staff"].includes(req.user.activeRole) ||
  ["director", "staff"].includes(req.user.role);

// ─── Multer Setup ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, "../uploads/achievements");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|webm/;
  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (allowed.test(ext)) cb(null, true);
  else cb(new Error("Only image and video files are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max per file
});

// ─── Helper: build full achievement SELECT with student info ──────────────────
// isStudent = true  → mask other students' personal data
// targetStudentId   → the logged-in student's own user id
function buildAchievementQuery(isStudent, targetStudentId) {
  // For staff/admin: return full student personal info
  // For student role: return personal info only for own record, mask others
  const personalFields = isStudent
    ? `
      u.id                                      AS student_id,
      u.name,
      u.department,
      COALESCE(u.batch, u.batch_year, '')      AS batch,
      -- show rollno/reg only for own records, mask for others
      CASE WHEN u.id = ${targetStudentId}
           THEN u.rollno    ELSE '—' END        AS rollno,
      CASE WHEN u.id = ${targetStudentId}
           THEN u.reg_number ELSE '—' END       AS reg_number,
      -- always hide personal contact for other students
      CASE WHEN u.id = ${targetStudentId}
           THEN u.phone  ELSE NULL END          AS phone,
      CASE WHEN u.id = ${targetStudentId}
           THEN u.email  ELSE NULL END          AS email,
      CASE WHEN u.id = ${targetStudentId}
           THEN u.gender ELSE NULL END          AS gender,
      CASE WHEN u.id = ${targetStudentId}
           THEN u.blood_group ELSE NULL END     AS blood_group,
      CASE WHEN u.id = ${targetStudentId}
           THEN u.photo_url ELSE NULL END       AS photo_url`
    : `
      u.id            AS student_id,
      u.name,
      u.rollno,
      u.reg_number,
      u.department,
      COALESCE(u.batch, u.batch_year, '') AS batch,
      u.phone,
      u.email,
      u.gender,
      u.blood_group,
      u.photo_url`;

  return `
    SELECT
      a.id, a.type, a.level, a.sport, a.eventname,
      a.position, a.achievementdate, a.venue,
      a.description, a.cashprize, a.certificate,
      a.status, a.created_at, a.updated_at,
      a.createdby,
      cb.name   AS createdby_name,
      ${personalFields},
      -- aggregate media as JSON array
      COALESCE(
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id',         m.id,
            'media_type', m.media_type,
            'file_name',  m.file_name,
            'file_path',  m.file_path
          ) ORDER BY m.uploaded_at
        ) FILTER (WHERE m.id IS NOT NULL),
        '[]'
      ) AS media
    FROM achievements a
    JOIN users u  ON a.student_id = u.id
    LEFT JOIN users cb ON a.createdby = cb.id
    LEFT JOIN achievement_media m ON m.achievement_id = a.id
  `;
}

// ─── GET /api/achievements ─────────────────────────────────────────────────────
// All roles: returns list (students see masked + approved-only data)
router.get("/", authMiddleware, async (req, res) => {
  try {
    // A user is treated as "student-level" only if they are NOT a staff actor
    const isStudent = !isStaffActor(req);
    const uid = req.user.id;

    const { type, department, level, position, search, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const conditions = ["a.status = 'approved'"]; // students only see approved
    const params = [];
    let pi = 1;

    // staff/admin/director see all statuses
    if (!isStudent) conditions.shift(); // remove approved-only filter

    if (type)       { conditions.push(`a.type = $${pi++}`);            params.push(type); }
    if (level)      { conditions.push(`a.level = $${pi++}`);           params.push(level); }
    if (position)   { conditions.push(`a.position = $${pi++}`);        params.push(position); }
    if (department) { conditions.push(`u.department = $${pi++}`);      params.push(department); }
    if (search) {
      conditions.push(`(
        u.name ILIKE $${pi} OR a.eventname ILIKE $${pi} OR
        a.sport ILIKE $${pi} OR u.rollno ILIKE $${pi} OR u.reg_number ILIKE $${pi}
      )`);
      params.push(`%${search}%`); pi++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const base = buildAchievementQuery(isStudent, uid);

    const dataQuery = `
      ${base}
      ${where}
      GROUP BY a.id, u.id, cb.name
      ORDER BY a.achievementdate DESC
      LIMIT $${pi++} OFFSET $${pi++}
    `;
    params.push(Number(limit), offset);

    // count query (no GROUP BY, no LIMIT)
    const countParams = params.slice(0, -2);
    const countQuery = `
      SELECT COUNT(DISTINCT a.id) AS total
      FROM achievements a
      JOIN users u ON a.student_id = u.id
      ${where}
    `;

    const [data, count] = await Promise.all([
      pool.query(dataQuery, params),
      pool.query(countQuery, countParams),
    ]);

    res.json({
      records: data.rows,
      total: Number(count.rows[0].total),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    console.error("GET /achievements error:", err);
    res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// ─── GET /api/achievements/stats ──────────────────────────────────────────────
// Summary stats — director / staff / admin only
// roleMiddleware checks activeRole; admin bypasses automatically
router.get(
  "/stats",
  authMiddleware,
  roleMiddleware(["director", "staff"]),   // activeRole must be director or staff (admin auto-passes)
  async (req, res) => {
    try {
      const [summary, byDept, byLevel, byYear, topStudents] = await Promise.all([
        pool.query(`
          SELECT
            COUNT(*)                                            AS total,
            COUNT(*) FILTER (WHERE position = 'Gold')          AS gold,
            COUNT(*) FILTER (WHERE position = 'Silver')        AS silver,
            COUNT(*) FILTER (WHERE position = 'Bronze')        AS bronze,
            COUNT(*) FILTER (WHERE type = 'external')          AS external_count,
            COUNT(*) FILTER (WHERE type = 'internal')          AS internal_count,
            COUNT(*) FILTER (WHERE status = 'pending')         AS pending_count,
            COALESCE(SUM(cashprize),0)                         AS total_cash_prize
          FROM achievements
        `),
        pool.query(`
          SELECT u.department, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.position='Gold')   AS gold,
            COUNT(*) FILTER (WHERE a.position='Silver') AS silver,
            COUNT(*) FILTER (WHERE a.position='Bronze') AS bronze
          FROM achievements a JOIN users u ON a.student_id = u.id
          WHERE a.status = 'approved'
          GROUP BY u.department ORDER BY total DESC
        `),
        pool.query(`
          SELECT level, COUNT(*) AS total
          FROM achievements WHERE status='approved'
          GROUP BY level ORDER BY total DESC
        `),
        pool.query(`
          SELECT COALESCE(u.batch, u.batch_year) AS academic_year,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.position='Gold')   AS gold,
            COUNT(*) FILTER (WHERE a.position='Silver') AS silver,
            COUNT(*) FILTER (WHERE a.position='Bronze') AS bronze
          FROM achievements a JOIN users u ON a.student_id = u.id
          WHERE a.status='approved' AND COALESCE(u.batch, u.batch_year) IS NOT NULL
          GROUP BY COALESCE(u.batch, u.batch_year) ORDER BY COALESCE(u.batch, u.batch_year)
        `),
        pool.query(`
          SELECT u.id, COALESCE(u.name, u.username) AS name, u.department, COALESCE(u.batch, u.batch_year, '') AS batch, u.photo_url,
            COUNT(*) AS total_achievements,
            COUNT(*) FILTER (WHERE a.position='Gold')   AS gold,
            COUNT(*) FILTER (WHERE a.position='Silver') AS silver,
            COUNT(*) FILTER (WHERE a.position='Bronze') AS bronze
          FROM achievements a JOIN users u ON a.student_id = u.id
          WHERE a.status='approved'
          GROUP BY u.id ORDER BY gold DESC, total_achievements DESC LIMIT 10
        `),
      ]);

      res.json({
        summary: summary.rows[0],
        byDepartment: byDept.rows,
        byLevel: byLevel.rows,
        yearTrend: byYear.rows,
        topPerformers: topStudents.rows,
      });
    } catch (err) {
      console.error("GET /achievements/stats error:", err);
      res.status(500).json({ message: "Server error", detail: err.message });
    }
  }
);

// ─── GET /api/achievements/my ─────────────────────────────────────────────────
// Returns the logged-in user's OWN achievements with full personal data.
// Any role can call this — staff viewing their own past student records etc.
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const uid = req.user.id;
    const result = await pool.query(`
      SELECT
        a.*,
        u.name, u.rollno, u.reg_number, u.department, COALESCE(u.batch, u.batch_year, '') AS batch,
        u.phone, u.email, u.gender, u.blood_group, u.photo_url,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT('id',m.id,'media_type',m.media_type,'file_name',m.file_name,'file_path',m.file_path)
            ORDER BY m.uploaded_at
          ) FILTER (WHERE m.id IS NOT NULL), '[]'
        ) AS media
      FROM achievements a
      JOIN users u ON a.student_id = u.id
      LEFT JOIN achievement_media m ON m.achievement_id = a.id
      WHERE a.student_id = $1
      GROUP BY a.id, u.id
      ORDER BY a.achievementdate DESC
    `, [uid]);

    const stats = {
      total:  result.rows.length,
      gold:   result.rows.filter(r => r.position === "Gold").length,
      silver: result.rows.filter(r => r.position === "Silver").length,
      bronze: result.rows.filter(r => r.position === "Bronze").length,
      pending: result.rows.filter(r => r.status === "pending").length,
      cash_earned: result.rows.reduce((s, r) => s + Number(r.cashprize || 0), 0),
    };

    res.json({ stats, achievements: result.rows });
  } catch (err) {
    console.error("GET /achievements/my error:", err);
    res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// ─── GET /api/achievements/students ──────────────────────────────────────────
// Search students for the add-record dropdown.
// ALL roles (admin/director/staff) see ALL students — no created_by restriction.
// Staff restriction is only on CRUD operations (edit/delete own records only).
router.get(
  "/students",
  authMiddleware,
  roleMiddleware(["director", "staff"]),
  async (req, res) => {
    try {
      const rawSearch = req.query.search || "";
      // Treat empty / % as "show all" — use a wildcard that always matches
      const searchParam = rawSearch === "" || rawSearch === "%" || rawSearch === "%25"
        ? "%"
        : `%${rawSearch}%`;

      // ALL staff/director/admin see ALL students (no created_by restriction)
      // Staff restriction applies to CRUD on records, not on who they can search
      const result = await pool.query(`
        SELECT
          u.id,
          COALESCE(u.name, u.username)        AS name,
          u.username,
          COALESCE(u.rollno, '')              AS rollno,
          COALESCE(u.reg_number, '')          AS reg_number,
          COALESCE(u.department, '')          AS department,
          COALESCE(u.batch, u.batch_year, '') AS batch,
          COALESCE(u.gender, '')              AS gender,
          COALESCE(u.blood_group, '')         AS blood_group,
          COALESCE(u.phone, '')               AS phone,
          COALESCE(u.email, '')               AS email,
          u.photo_url,
          u.status,
          COALESCE(c.name, c.username, '')    AS created_by_name
        FROM users u
        LEFT JOIN users c ON u.created_by = c.id
        WHERE u.role = 'student'
          AND (u.status IS NULL OR u.status NOT IN ('suspended'))
          AND (
            COALESCE(u.name, u.username, '') ILIKE $1 OR
            COALESCE(u.username, '')         ILIKE $1 OR
            COALESCE(u.rollno, '')           ILIKE $1 OR
            COALESCE(u.reg_number, '')       ILIKE $1 OR
            COALESCE(u.department, '')       ILIKE $1 OR
            COALESCE(u.batch, '')            ILIKE $1 OR
            COALESCE(u.batch_year, '')       ILIKE $1
          )
        ORDER BY COALESCE(u.name, u.username) ASC
        LIMIT 50
      `, [searchParam]);

      res.json(result.rows);
    } catch (err) {
      console.error("GET /achievements/students error:", err.message);
      res.status(500).json({ message: "Server error", detail: err.message });
    }
  }
);

// ─── GET /api/achievements/:id ────────────────────────────────────────────────
// All roles can view a single record; students get masked data for others
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const isStudent = !isStaffActor(req);
    const uid = req.user.id;
    const base = buildAchievementQuery(isStudent, uid);

    const result = await pool.query(
      `${base} WHERE a.id = $1 GROUP BY a.id, u.id, cb.name`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /achievements/:id error:", err);
    res.status(500).json({ message: "Server error", detail: err.message });
  }
});

// ─── POST /api/achievements ───────────────────────────────────────────────────
// Create achievement — director / staff only (admin auto-passes)
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["director", "staff"]),
  upload.array("media", 10),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {
        student_id, type, level, sport, eventname, position,
        achievementdate, venue, description, cashprize, certificate, status,
      } = req.body;

      if (!student_id || !eventname || !achievementdate || !type || !level || !position) {
        return res.status(400).json({ message: "student_id, eventname, achievementdate, type, level, position are required" });
      }

      // Validate student exists and is a student role
      const stuCheck = await client.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'student'",
        [student_id]
      );
      if (!stuCheck.rows.length) return res.status(400).json({ message: "Invalid student_id" });

      const ach = await client.query(`
        INSERT INTO achievements
          (student_id, type, level, sport, eventname, position,
           achievementdate, venue, description, cashprize, certificate, status, createdby)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
      `, [
        student_id, type, level, sport || null, eventname, position,
        achievementdate, venue || null, description || null,
        cashprize || 0, certificate === "true" || certificate === true,
        status || "pending", req.user.id,
      ]);

      const achId = ach.rows[0].id;

      // Insert media files
      if (req.files?.length) {
        for (const file of req.files) {
          const mediaType = file.mimetype.startsWith("video") ? "video" : "image";
          await client.query(`
            INSERT INTO achievement_media (achievement_id, media_type, file_name, file_path, mime_type, file_size, uploaded_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [achId, mediaType, file.originalname, `/uploads/achievements/${file.filename}`, file.mimetype, file.size, req.user.id]);
        }
      }

      await client.query("COMMIT");
      res.status(201).json({ message: "Achievement created", id: achId });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /achievements error:", err);
      res.status(500).json({ message: "Server error", detail: err.message });
    } finally {
      client.release();
    }
  }
);

// ─── PUT /api/achievements/:id ────────────────────────────────────────────────
// Update achievement — director / staff only (admin auto-passes)
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["director", "staff"]),
  upload.array("media", 10),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const {
        student_id, type, level, sport, eventname, position,
        achievementdate, venue, description, cashprize, certificate, status,
        remove_media_ids, // comma-separated IDs of media to delete
      } = req.body;

      // Fetch record and check ownership for staff
      const check = await client.query(
        "SELECT id, createdby FROM achievements WHERE id = $1",
        [req.params.id]
      );
      if (!check.rows.length) return res.status(404).json({ message: "Achievement not found" });

      // All staff/director/admin have full edit access

      await client.query(`
        UPDATE achievements SET
          student_id=$1, type=$2, level=$3, sport=$4, eventname=$5, position=$6,
          achievementdate=$7, venue=$8, description=$9, cashprize=$10,
          certificate=$11, status=$12
        WHERE id=$13
      `, [
        student_id, type, level, sport || null, eventname, position,
        achievementdate, venue || null, description || null,
        cashprize || 0, certificate === "true" || certificate === true,
        status || "pending", req.params.id,
      ]);

      // Remove selected media
      if (remove_media_ids) {
        const ids = String(remove_media_ids).split(",").map(Number).filter(Boolean);
        if (ids.length) {
          const toDelete = await client.query(
            "SELECT file_path FROM achievement_media WHERE id = ANY($1) AND achievement_id = $2",
            [ids, req.params.id]
          );
          toDelete.rows.forEach(row => {
            const abs = path.join(__dirname, "..", row.file_path);
            if (fs.existsSync(abs)) fs.unlinkSync(abs);
          });
          await client.query("DELETE FROM achievement_media WHERE id = ANY($1)", [ids]);
        }
      }

      // Add new media files
      if (req.files?.length) {
        for (const file of req.files) {
          const mediaType = file.mimetype.startsWith("video") ? "video" : "image";
          await client.query(`
            INSERT INTO achievement_media (achievement_id, media_type, file_name, file_path, mime_type, file_size, uploaded_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
          `, [req.params.id, mediaType, file.originalname, `/uploads/achievements/${file.filename}`, file.mimetype, file.size, req.user.id]);
        }
      }

      await client.query("COMMIT");
      res.json({ message: "Achievement updated" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("PUT /achievements/:id error:", err);
      res.status(500).json({ message: "Server error", detail: err.message });
    } finally {
      client.release();
    }
  }
);

// ─── PATCH /api/achievements/:id/status ──────────────────────────────────────
// Approve / reject — director only (admin auto-passes)
router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware(["director"]),
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!["approved", "rejected", "pending"].includes(status))
        return res.status(400).json({ message: "Invalid status" });

      const result = await pool.query(
        "UPDATE achievements SET status=$1 WHERE id=$2 RETURNING id",
        [status, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "Not found" });
      res.json({ message: `Status updated to ${status}` });
    } catch (err) {
      console.error("PATCH /achievements/:id/status error:", err);
      res.status(500).json({ message: "Server error", detail: err.message });
    }
  }
);

// ─── DELETE /api/achievements/:id ────────────────────────────────────────────
// Delete achievement — director / staff only (admin auto-passes)
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["director", "staff"]),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check record exists and staff ownership
      const ownCheck = await client.query(
        "SELECT id, createdby FROM achievements WHERE id = $1",
        [req.params.id]
      );
      if (!ownCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Achievement not found" });
      }

      // All staff/director/admin have full delete access

      // Delete media files from disk
      const media = await client.query(
        "SELECT file_path FROM achievement_media WHERE achievement_id = $1",
        [req.params.id]
      );
      media.rows.forEach(row => {
        const abs = path.join(__dirname, "..", row.file_path);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      });

      const del = await client.query(
        "DELETE FROM achievements WHERE id=$1 RETURNING id",
        [req.params.id]
      );
      if (!del.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Not found" });
      }

      await client.query("COMMIT");
      res.json({ message: "Achievement deleted" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("DELETE /achievements/:id error:", err);
      res.status(500).json({ message: "Server error", detail: err.message });
    } finally {
      client.release();
    }
  }
);

module.exports = router;