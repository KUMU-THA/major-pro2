const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {

    // Admin has full access always
    if (req.user.role === "admin") {
      return next();
    }

    // Check active role
    if (!allowedRoles.includes(req.user.activeRole)) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
};

module.exports = roleMiddleware;
