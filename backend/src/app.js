const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const directorRoutes = require("./routes/director.routes");
const staffRoutes = require("./routes/staff.routes");
const studentRoutes = require("./routes/student.routes");
const achievementRoutes = require("./routes/achievement.routes");


const app = express();



app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/director", directorRoutes);
app.use("/staff", staffRoutes);
app.use("/student", studentRoutes);
app.use("/achievement", achievementRoutes);
app.use("/achievements", achievementRoutes);
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});

module.exports = app;

