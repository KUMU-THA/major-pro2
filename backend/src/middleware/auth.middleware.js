const jwt = require("jsonwebtoken");
//const decoded = jwt.verify(token, process.env.JWT_SECRET);
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info
    req.user = {
      id: decoded.id,
      role: decoded.role,             // real role (admin/staff/director)
      activeRole: decoded.activeRole, // current acting role
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

module.exports = authMiddleware;
