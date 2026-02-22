CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role VARCHAR(20) NOT NULL,
  department VARCHAR(50),
  batch VARCHAR(20),
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO users (username, password, role)
VALUES (
  'admin',
  '$2b$10$HlPviwlgevqKR3MY1TRhD..60B05NCk0kpIF3l.PfNvFkFkulhGri',
  'admin'
);
SELECT * FROM users;

SELECT username, role, department, batch, created_by FROM users;
ALTER TABLE users
ADD CONSTRAINT unique_username UNIQUE (username);


CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER NOT NULL,        -- who did the action
  actor_role VARCHAR(20) NOT NULL,  -- admin/director/staff
  action VARCHAR(50) NOT NULL,      -- CREATE / UPDATE / DELETE
  target_user_id INTEGER,           -- on whom
  target_role VARCHAR(20),          -- student/staff/director
  description TEXT,                 -- readable message
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

SELECT * FROM audit_logs;
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  description TEXT,
  event_type VARCHAR(20) CHECK (event_type IN ('internal','external')),
  event_date DATE,
  created_by INT,
  creator_role VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE event_registrations (
  id SERIAL PRIMARY KEY,
  event_id INT REFERENCES events(id) ON DELETE CASCADE,
  student_id INT REFERENCES users(id),
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, student_id)
);
SELECT * FROM events;
SELECT id, title, status FROM events;
ALTER TABLE events
ADD COLUMN status VARCHAR(20) DEFAULT 'approved';
SELECT * FROM events;
ALTER TABLE event_registrations
ADD COLUMN registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;


SELECT id, username, role, created_by
FROM users
WHERE role = 'staff';

ALTER TABLE events
ADD COLUMN last_registration_date DATE;
ALTER TABLE events
ALTER COLUMN last_registration_date SET NOT NULL;

ALTER TABLE events
ALTER COLUMN last_registration_date DROP NOT NULL;

UPDATE events
SET last_registration_date = event_date
WHERE last_registration_date IS NULL;

ALTER TABLE events
ALTER COLUMN last_registration_date SET NOT NULL;

SELECT id, title, event_date, last_registration_date
FROM events;


CREATE TABLE training_schedules (
  id SERIAL PRIMARY KEY,

  event_id INT REFERENCES events(id) ON DELETE CASCADE,
  student_id INT REFERENCES users(id) ON DELETE CASCADE,

  training_date DATE NOT NULL,
  training_time TIME NOT NULL,
  location VARCHAR(100),

  remarks TEXT,

  created_by INT REFERENCES users(id),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
SELECT * FROM event_registrations;

SELECT 
    er.id AS registration_id,
    u.id AS student_id,
    u.username,
    u.department,
    u.batch,
    er.registered_at
FROM event_registrations er
JOIN users u ON er.student_id = u.id
WHERE er.event_id = 1
ORDER BY er.registered_at DESC;

SELECT id, username, role, created_by
FROM users
WHERE role='student';
 SELECT * FROM training_schedules;


 ALTER TABLE training_schedules
DROP COLUMN training_time;

ALTER TABLE training_schedules
ADD COLUMN start_time TIME;

ALTER TABLE training_schedules
ADD COLUMN end_time TIME;


SELECT 
  ts.id,
  u.username,
  e.title AS event_name,
  ts.training_date,
  ts.start_time,
  ts.end_time,
  ts.location,
  ts.remarks
FROM training_schedules ts
JOIN users u ON ts.student_id = u.id
JOIN events e ON ts.event_id = e.id
ORDER BY ts.training_date DESC

ALTER TABLE training_schedules
ADD COLUMN start_time TIME,
ADD COLUMN end_time TIME;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'training_schedules';


UPDATE training_schedules
SET start_time = '10:00',
    end_time = '12:00'
WHERE start_time IS NULL OR end_time IS NULL;

DROP TABLE training_schedules;

CREATE TABLE training_schedules (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    student_id INTEGER NOT NULL REFERENCES users(id),
    training_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location VARCHAR(255),
    remarks TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Attendance Table
CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    training_id INT REFERENCES training_schedules(id) ON DELETE CASCADE,
    student_id INT REFERENCES users(id) ON DELETE CASCADE,  -- use users table
    present BOOLEAN DEFAULT TRUE,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

SELECT * FROM attendance;
SELECT * FROM training_schedules WHERE id = 1;
INSERT INTO attendance (training_id, student_id, present, remarks)
VALUES (1, 15, true, 'On time');

-- Performance Table
CREATE TABLE performance (
    id SERIAL PRIMARY KEY,
    training_id INT REFERENCES training_schedules(id) ON DELETE CASCADE,
    student_id INT REFERENCES users(id) ON DELETE CASCADE,   -- use users table
    score NUMERIC,               -- e.g., 0-100
    comments TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

SELECT a.*, s.username, s.department, s.batch 
      FROM attendance a
      LEFT JOIN students s ON a.student_id = s.student_id
      WHERE a.training_id = $1
      ORDER BY s.username

drop table achievements;
CREATE TABLE achievements (
  id SERIAL PRIMARY KEY,
  rollno VARCHAR(50) NOT NULL,
  studentname VARCHAR(100) NOT NULL,
  department VARCHAR(50),
  batch VARCHAR(20),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  eventname VARCHAR(200),
  position VARCHAR(50),
  achievementdate DATE NOT NULL,
  createdby INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);


INSERT INTO achievements 
(rollno, studentname, department, batch, title, description, eventname, position, achievementdate, createdby)
VALUES

('21CSE001', 'Arun Kumar', 'CSE', '2021-2025',
 '100m Sprint Winner',
 'Won first place in 100m sprint with excellent performance',
 'Inter College Athletics Meet',
 '1st Place',
 '2025-09-12',
 22),

('21ECE015', 'Priya Sharma', 'ECE', '2021-2025',
 'Badminton Champion',
 'Won women singles badminton championship',
 'University Sports Fest',
 'Champion',
 '2025-08-25',
 18);

 SELECT * FROM achievements;