const pool = require("../db/db");

const logAudit = async ({
  actorId,
  actorRole,
  action,
  targetUserId,
  targetRole,
  description
}) => {
  try {
    await pool.query(
      `INSERT INTO audit_logs
       (actor_id, actor_role, action, target_user_id, target_role, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorId, actorRole, action, targetUserId, targetRole, description]
    );
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};

module.exports = logAudit;
