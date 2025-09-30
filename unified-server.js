const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const https = require("https");

const app = express();

// Configure CORS
const isDevelopment = process.env.NODE_ENV !== 'production';

// Simple CORS - allow all origins for development/testing
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'public')));

// Add OPTIONS handler for preflight requests
app.options('*', cors());

// PostgreSQL Connection
const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT || 5432),
  max: 200,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Validate required environment variables
if (!process.env.PGUSER || !process.env.PGDATABASE || !process.env.PGPASSWORD) {
  console.error('❌ Missing required environment variables: PGUSER, PGDATABASE, PGPASSWORD');
  console.error('Please check your .env file');
  process.exit(1);
}

// Database connection error handling
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test database connection on startup
async function testDbConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('Please ensure PostgreSQL is running and credentials are correct');
  }
}

testDbConnection();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('❌ Missing required environment variable: JWT_SECRET');
  console.error('Please add JWT_SECRET to your .env file');
  process.exit(1);
}


// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

io.on("connection", (socket) => {
  socket.on("authenticate", (token) => {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const room = `user-${payload.userId}`;
      socket.join(room);
      socket.emit("authenticated", { ok: true });
    } catch (_e) {
      socket.emit("auth_error", { error: "Invalid token" });
    }
  });
});

// Ensure table exists and migrate schema (idempotent)
async function initDb() {
  try {
    // Test database connection first
    const connectionTest = await pool.query('SELECT NOW() as current_time');

    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        reset_token TEXT,
        reset_token_expires TIMESTAMP WITH TIME ZONE
      );
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);

    // Add new columns if missing
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'own'`);
    await pool.query(`UPDATE tasks SET category='own' WHERE category IS NULL`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_time TIME`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'work'`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS important BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to TEXT`);

    // Learning progress table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS learning_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        topic TEXT,
        skill_level TEXT DEFAULT 'beginner',
        hours_spent INTEGER DEFAULT 0,
        last_practiced TIMESTAMP WITH TIME ZONE,
        progress_percentage INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Notes table (for Learning and Working notes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('learning', 'working')),
        title TEXT NOT NULL,
        content TEXT,
        tags TEXT[],
        attachments JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Add attachments column if it doesn't exist (migration)
    await pool.query(`
      ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    `);

    // Files table (for file uploads in notes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
        note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // PR Management table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        frontend_status TEXT CHECK (frontend_status IN ('pending', 'in_progress', 'completed', 'none')) DEFAULT 'none',
        backend_status TEXT CHECK (backend_status IN ('pending', 'in_progress', 'completed', 'none')) DEFAULT 'none',
        frontend_link TEXT,
        backend_link TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Add frontend_link and backend_link columns if they don't exist (for existing databases)
    try {
      await pool.query(`
        ALTER TABLE prs
        ADD COLUMN IF NOT EXISTS frontend_link TEXT,
        ADD COLUMN IF NOT EXISTS backend_link TEXT;
      `);
    } catch (err) {
      // Columns might already exist, ignore error
      console.log('PR table columns already exist or error adding:', err.message);
    }


    // Daily goals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'personal',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        date DATE NOT NULL,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Study sessions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS study_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        subject TEXT NOT NULL,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE,
        duration_minutes INTEGER,
        focus_rating INTEGER CHECK (focus_rating >= 1 AND focus_rating <= 5) DEFAULT 3,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // User profile extensions
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`);

  } catch (error) {
    console.error('❌ DATABASE CONNECTION FAILED!');
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Solution: Make sure PostgreSQL server is running');
    } else if (error.code === '28P01') {
      console.error('💡 Solution: Check username and password in .env file');
    } else if (error.code === '3D000') {
      console.error('💡 Solution: Create the database or check PGDATABASE in .env');
    }
    console.error('');
  }
}

initDb();

// Auth helpers
function authOptional(req, _res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { id: payload.userId, username: payload.username };
    } catch (_e) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

function authRequired(req, res, next) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized", message: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: "Invalid token", message: "Token payload is invalid" });
    }
    req.user = { id: payload.userId, username: payload.username };
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Token expired", message: "Please login again" });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: "Invalid token", message: "Token is malformed" });
    } else {
      console.error(`❌ Auth Required: Unexpected error for ${req.method} ${req.path}:`, error);
      return res.status(401).json({ error: "Invalid token", message: "Token verification failed" });
    }
  }
}

// Serve the React frontend at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Auth endpoints
app.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    if (String(username).length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, is_verified) VALUES ($1, $2, TRUE) RETURNING id, username`,
      [username, hash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      success: true,
      message: "Registration successful",
      token,
      user
    });
  } catch (err) {
    const msg = String(err.message || "");
    if (msg.includes("duplicate key") && msg.includes("users_username_key")) {
      return res.status(409).json({ error: "Username already exists" });
    }
    console.error("POST /auth/register error:", err);
    res.status(500).json({ error: "Failed to register" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "username and password are required" });

    const result = await pool.query(`SELECT id, username, password_hash FROM users WHERE username=$1`, [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error("POST /auth/login error:", err);
    res.status(500).json({ error: "Failed to login" });
  }
});

app.get("/auth/verify", authRequired, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// Change password endpoint
app.post("/auth/change-password", authRequired, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }

    // Get current user
    const userResult = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    await pool.query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hashedNewPassword, req.user.id]);

    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    console.error("POST /auth/change-password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// Task endpoints
app.get("/tasks", authOptional, async (req, res) => {
  try {
    const { status, priority, category, type, project_id, important, q, sort = 'id', order = 'asc' } = req.query;
    const where = [];
    const values = [];
    let idx = 1;

    if (req.user) {
      where.push(`user_id = $${idx++}`);
      values.push(req.user.id);
    }

    if (status) {
      where.push(`status = $${idx++}`);
      values.push(status);
    }
    if (priority) {
      where.push(`priority = $${idx++}`);
      values.push(priority);
    }
    if (category) {
      where.push(`category = $${idx++}`);
      values.push(category);
    }
    if (type) {
      where.push(`type = $${idx++}`);
      values.push(type);
    }
    if (project_id) {
      where.push(`project_id = $${idx++}`);
      values.push(project_id);
    }
    if (important !== undefined) {
      const val = String(important).toLowerCase();
      if (val === 'true' || val === '1') {
        where.push(`important = TRUE`);
      } else if (val === 'false' || val === '0') {
        where.push(`important = FALSE`);
      }
    }
    if (q) {
      where.push(`(title ILIKE $${idx} OR COALESCE(description,'') ILIKE $${idx})`);
      values.push(`%${q}%`);
      idx++;
    }

    const allowedSort = new Set(["id", "title", "status", "priority", "category", "type", "due_date", "due_time", "project_id", "created_at", "updated_at"]);
    const sortBy = allowedSort.has(String(sort)) ? String(sort) : "id";
    const sortOrder = String(order).toLowerCase() === "desc" ? "DESC" : "ASC";

    const query = `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${sortBy} ${sortOrder}`;
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error("GET /tasks error:", err);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

app.post("/tasks", authRequired, async (req, res) => {
  try {
    const { title, status, description, priority, due_date, due_time, category, type, project_id, important, assigned_to } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const st = status ?? 'pending';
    const pr = priority ?? 'medium';
    const cat = category ?? 'own';
    const ty = type ?? 'work';

    const result = await pool.query(
      `INSERT INTO tasks (title, status, description, priority, due_date, due_time, category, type, project_id, important, assigned_to, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [title.trim(), st, description ?? null, pr, due_date ?? null, due_time ?? null, cat, ty, project_id ?? null, Boolean(important), assigned_to ?? null, req.user.id]
    );

    const task = result.rows[0];
    io.to(`user-${req.user.id}`).emit("task_created", task);
    res.json(task);
  } catch (err) {
    console.error("POST /tasks error:", err);
    res.status(500).json({ error: "Failed to create task" });
  }
});

app.put("/tasks/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, title, description, priority, due_date, due_time, category, type, project_id, important, assigned_to } = req.body;

    if (status === undefined && title === undefined && description === undefined && priority === undefined && due_date === undefined && due_time === undefined && category === undefined && type === undefined && project_id === undefined && important === undefined && assigned_to === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) {
      fields.push(`title=$${idx++}`);
      values.push(title);
    }
    if (status !== undefined) {
      fields.push(`status=$${idx++}`);
      values.push(status);
    }
    if (description !== undefined) {
      fields.push(`description=$${idx++}`);
      values.push(description);
    }
    if (priority !== undefined) {
      fields.push(`priority=$${idx++}`);
      values.push(priority);
    }
    if (due_date !== undefined) {
      fields.push(`due_date=$${idx++}`);
      values.push(due_date);
    }
    if (due_time !== undefined) {
      fields.push(`due_time=$${idx++}`);
      values.push(due_time);
    }
    if (category !== undefined) {
      fields.push(`category=$${idx++}`);
      values.push(category);
    }
    if (type !== undefined) {
      fields.push(`type=$${idx++}`);
      values.push(type);
    }
    if (project_id !== undefined) {
      fields.push(`project_id=$${idx++}`);
      values.push(project_id);
    }
    if (important !== undefined) {
      fields.push(`important=$${idx++}`);
      values.push(Boolean(important));
    }
    if (assigned_to !== undefined) {
      fields.push(`assigned_to=$${idx++}`);
      values.push(assigned_to);
    }
    fields.push(`updated_at=NOW()`);

    values.push(id);
    values.push(req.user.id);
    const query = `UPDATE tasks SET ${fields.join(", ")} WHERE id=$${idx++} AND user_id=$${idx} RETURNING *`;
    const result = await pool.query(query, values);

    if (!result.rowCount) return res.status(404).json({ error: "Task not found" });
    const updated = result.rows[0];
    io.to(`user-${req.user.id}`).emit("task_updated", updated);
    res.json(updated);
  } catch (err) {
    console.error("PUT /tasks/:id error:", err);
    res.status(500).json({ error: "Failed to update task" });
  }
});

app.delete("/tasks/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Task not found" });
    io.to(`user-${req.user.id}`).emit("task_deleted", { id: Number(id) });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /tasks/:id error:", err);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

// Bulk task actions
app.post("/tasks/clear-completed", authRequired, async (req, res) => {
  try {
    await pool.query("DELETE FROM tasks WHERE status='done' AND user_id=$1", [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /tasks/clear-completed error:", err);
    res.status(500).json({ error: "Failed to clear completed" });
  }
});

app.post("/tasks/mark-all-done", authRequired, async (req, res) => {
  try {
    await pool.query("UPDATE tasks SET status='done', updated_at=NOW() WHERE status<>'done' AND user_id=$1", [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /tasks/mark-all-done error:", err);
    res.status(500).json({ error: "Failed to mark all done" });
  }
});

// Learning Progress API
app.get("/learning/progress", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM learning_progress WHERE user_id=$1 ORDER BY last_practiced DESC NULLS LAST",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /learning/progress error:", err);
    res.status(500).json({ error: "Failed to fetch learning progress" });
  }
});

app.post("/learning/progress", authRequired, async (req, res) => {
  try {
    const { subject, topic, skill_level, hours_spent, progress_percentage, notes } = req.body;
    if (!subject) return res.status(400).json({ error: "subject is required" });

    const result = await pool.query(
      `INSERT INTO learning_progress (user_id, subject, topic, skill_level, hours_spent, progress_percentage, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [req.user.id, subject, topic, skill_level, hours_spent, progress_percentage, notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /learning/progress error:", err);
    res.status(500).json({ error: "Failed to save learning progress" });
  }
});

app.put("/learning/progress/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, topic, skill_level, hours_spent, progress_percentage, notes } = req.body;

    const result = await pool.query(
      `UPDATE learning_progress SET
        subject=$1, topic=$2, skill_level=$3, hours_spent=$4,
        progress_percentage=$5, notes=$6, updated_at=NOW(), last_practiced=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [subject, topic, skill_level, hours_spent, progress_percentage, notes, id, req.user.id]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Learning progress not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /learning/progress/:id error:", err);
    res.status(500).json({ error: "Failed to update learning progress" });
  }
});

app.delete("/learning/progress/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM learning_progress WHERE id=$1 AND user_id=$2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Learning progress not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /learning/progress/:id error:", err);
    res.status(500).json({ error: "Failed to delete learning progress" });
  }
});

// File upload endpoint for notes
app.post("/notes/:id/files", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { filename, fileData, fileSize, mimeType } = req.body;

    if (!filename || !fileData) {
      return res.status(400).json({ error: "Filename and file data are required" });
    }

    // Verify note ownership
    const noteCheck = await pool.query("SELECT id FROM notes WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!noteCheck.rows.length) {
      return res.status(404).json({ error: "Note not found" });
    }

    // Store file info in database (in a real app, you'd save the file to storage)
    const result = await pool.query(
      "INSERT INTO files (note_id, user_id, filename, original_name, file_path, file_size, mime_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [id, req.user.id, filename, filename, fileData, fileSize, mimeType]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /notes/:id/files error:", err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// Get files for a note
app.get("/notes/:id/files", authRequired, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify note ownership
    const noteCheck = await pool.query("SELECT id FROM notes WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!noteCheck.rows.length) {
      return res.status(404).json({ error: "Note not found" });
    }

    const result = await pool.query(
      "SELECT id, filename, original_name, file_size, mime_type, created_at FROM files WHERE note_id = $1 AND user_id = $2 ORDER BY created_at DESC",
      [id, req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /notes/:id/files error:", err);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

// Delete file
app.delete("/files/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM files WHERE id = $1 AND user_id = $2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "File not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /files/:id error:", err);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// Notes API
app.get("/notes", authRequired, async (req, res) => {
  try {
    const { type } = req.query;
    let query = "SELECT * FROM notes WHERE user_id = $1";
    let values = [req.user.id];

    if (type) {
      query += " AND type = $2";
      values.push(type);
    }

    query += " ORDER BY updated_at DESC";
    const result = await pool.query(query, values);

    // Parse attachments from JSON for each note
    const notesWithAttachments = result.rows.map(note => ({
      ...note,
      attachments: note.attachments ? (typeof note.attachments === 'string' ? JSON.parse(note.attachments) : note.attachments) : []
    }));

    res.json(notesWithAttachments);
  } catch (err) {
    console.error("GET /notes error:", err);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

app.post("/notes", authRequired, async (req, res) => {
  try {
    const { type, title, content, tags, attachments } = req.body;
    if (!type || !title || !['learning', 'working'].includes(type)) {
      return res.status(400).json({ error: "Valid type and title are required" });
    }

    const result = await pool.query(
      "INSERT INTO notes (user_id, type, title, content, tags, attachments) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [req.user.id, type, title, content || '', tags || [], JSON.stringify(attachments || [])]
    );

    // Parse attachments in response
    const note = result.rows[0];
    note.attachments = note.attachments ? (typeof note.attachments === 'string' ? JSON.parse(note.attachments) : note.attachments) : [];
    res.json(note);
  } catch (err) {
    console.error("POST /notes error:", err);
    res.status(500).json({ error: "Failed to create note" });
  }
});

app.put("/notes/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, tags, attachments } = req.body;

    const result = await pool.query(
      "UPDATE notes SET title=$1, content=$2, tags=$3, attachments=$4, updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *",
      [title, content, tags, JSON.stringify(attachments || []), id, req.user.id]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Note not found" });

    // Parse attachments in response
    const note = result.rows[0];
    note.attachments = note.attachments ? (typeof note.attachments === 'string' ? JSON.parse(note.attachments) : note.attachments) : [];
    res.json(note);
  } catch (err) {
    console.error("PUT /notes/:id error:", err);
    res.status(500).json({ error: "Failed to update note" });
  }
});

app.delete("/notes/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM notes WHERE id=$1 AND user_id=$2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Note not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /notes/:id error:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// PR Management API
app.get("/prs", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM prs WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /prs error:", err);
    res.status(500).json({ error: "Failed to fetch PRs" });
  }
});

app.post("/prs", authRequired, async (req, res) => {
  try {
    const { title, frontend_status, backend_status, frontend_link, backend_link } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required" });

    const result = await pool.query(
      "INSERT INTO prs (user_id, title, frontend_status, backend_status, frontend_link, backend_link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [
        req.user.id,
        title,
        frontend_status || 'none',
        backend_status || 'none',
        frontend_link || null,
        backend_link || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("POST /prs error:", err);
    res.status(500).json({ error: "Failed to create PR" });
  }
});

app.put("/prs/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, frontend_status, backend_status, frontend_link, backend_link } = req.body;

    const result = await pool.query(
      "UPDATE prs SET title=$1, frontend_status=$2, backend_status=$3, frontend_link=$4, backend_link=$5, updated_at=NOW() WHERE id=$6 AND user_id=$7 RETURNING *",
      [title, frontend_status, backend_status, frontend_link || null, backend_link || null, id, req.user.id]
    );

    if (!result.rowCount) return res.status(404).json({ error: "PR not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /prs/:id error:", err);
    res.status(500).json({ error: "Failed to update PR" });
  }
});

app.delete("/prs/:id", authRequired, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM prs WHERE id=$1 AND user_id=$2", [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: "PR not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /prs/:id error:", err);
    res.status(500).json({ error: "Failed to delete PR" });
  }
});

// PR Download endpoint
app.get("/prs/download", authRequired, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM prs WHERE user_id = $1", [req.user.id]);
    if (result.rows.length < 10) {
      return res.status(400).json({ error: "Minimum 10 PRs required for download" });
    }

    // Create CSV content
    let csvContent = "Title,Frontend PR,Backend PR\n";
    result.rows.forEach(pr => {
      const frontendStatus = pr.frontend_status !== 'none' ? pr.frontend_status : '';
      const backendStatus = pr.backend_status !== 'none' ? pr.backend_status : '';
      csvContent += `"${pr.title}","${frontendStatus}","${backendStatus}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="prs-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    console.error("GET /prs/download error:", err);
    res.status(500).json({ error: "Failed to download PRs" });
  }
});


// Profile Management
app.get("/profile", authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, phone, email, full_name, profile_photo, is_verified FROM users WHERE id = $1",
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

app.put("/profile", authRequired, async (req, res) => {
  try {
    const { full_name, email, profile_photo } = req.body;
    const result = await pool.query(
      "UPDATE users SET full_name = $1, email = $2, profile_photo = $3 WHERE id = $4 RETURNING id, username, phone, email, full_name, profile_photo, is_verified",
      [full_name, email, profile_photo, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("PUT /profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Reset Password
app.post("/auth/reset-password", async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) {
      return res.status(400).json({ error: "Username and new password are required" });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Find user by username
    const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update password
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE username = $2", [hash, username]);

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("POST /auth/reset-password error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// Test endpoint to check database connection
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      success: true,
      timestamp: result.rows[0].now,
      message: "Database connection successful"
    });
  } catch (error) {
    console.error("Database test error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simple network test endpoint for Android debugging
app.get("/test-network", (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  console.log(`📱 Network test request from: ${clientIP}`);
  res.json({
    success: true,
    message: "Network connection successful!",
    server: "http://192.168.1.2:3001",
    clientIP: clientIP,
    timestamp: new Date().toISOString()
  });
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Projects endpoint
app.get("/projects", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // For now, return an empty array since projects table doesn't exist
    // In the future, you could create a projects table and return real projects
    res.json([]);
  } catch (error) {
    console.error("Projects error:", error);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// Time logs endpoint
app.post("/time-logs", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { day, category, minutes } = req.body;

    // Create time_logs table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        day DATE NOT NULL,
        category VARCHAR(50) NOT NULL,
        minutes INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert time log
    const result = await pool.query(
      "INSERT INTO time_logs (user_id, day, category, minutes) VALUES ($1, $2, $3, $4) RETURNING *",
      [userId, day, category, minutes]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Time logs error:", error);
    res.status(500).json({ error: "Failed to create time log" });
  }
});

// Time sessions endpoints for TimeTracker component
app.get("/time-sessions", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;

    // Create time_sessions table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL DEFAULT 'work',
        description TEXT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get all time sessions for user
    const result = await pool.query(
      "SELECT * FROM time_sessions WHERE user_id = $1 ORDER BY start_time DESC",
      [userId]
    );

    // Format the response to match frontend expectations
    const sessions = result.rows.map(session => ({
      id: session.id,
      type: session.type,
      description: session.description,
      startTime: session.start_time,
      endTime: session.end_time,
      duration: session.duration,
      createdAt: session.created_at
    }));

    res.json(sessions);
  } catch (error) {
    console.error("Get time sessions error:", error);
    res.status(500).json({ error: "Failed to fetch time sessions" });
  }
});

app.post("/time-sessions", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, description, startTime, endTime, duration } = req.body;

    // Validate required fields
    if (!description || !startTime || !endTime || !duration) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Create time_sessions table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS time_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL DEFAULT 'work',
        description TEXT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert new time session
    const result = await pool.query(
      "INSERT INTO time_sessions (user_id, type, description, start_time, end_time, duration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [userId, type || 'work', description, startTime, endTime, duration]
    );

    // Format the response to match frontend expectations
    const session = {
      id: result.rows[0].id,
      type: result.rows[0].type,
      description: result.rows[0].description,
      startTime: result.rows[0].start_time,
      endTime: result.rows[0].end_time,
      duration: result.rows[0].duration,
      createdAt: result.rows[0].created_at
    };

    res.status(201).json(session);
  } catch (error) {
    console.error("Create time session error:", error);
    res.status(500).json({ error: "Failed to create time session" });
  }
});

// Dashboard overview endpoint
app.get("/dashboard/overview", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get today's tasks with new workflow statuses
    const tasksToday = await pool.query(
      "SELECT status, COUNT(*) as count FROM tasks WHERE user_id = $1 AND DATE(created_at) = $2 GROUP BY status",
      [userId, today]
    );

    const taskStats = {
      total: 0,
      learning: 0,
      working: 0,
      testing: 0,
      completed: 0,
      // Legacy support
      done: 0,
      pending: 0
    };

    tasksToday.rows.forEach(row => {
      const count = parseInt(row.count);
      taskStats.total += count;

      // New workflow statuses
      if (row.status === 'learning') taskStats.learning = count;
      if (row.status === 'working') taskStats.working = count;
      if (row.status === 'testing') taskStats.testing = count;
      if (row.status === 'completed') taskStats.completed = count;

      // Legacy status mapping for backward compatibility
      if (row.status === 'completed' || row.status === 'done') taskStats.done += count;
      if (row.status === 'learning' || row.status === 'pending') taskStats.pending += count;
    });

    taskStats.goalPercent = taskStats.total > 0 ? Math.round((taskStats.completed / taskStats.total) * 100) : 0;

    // Get projects count
    const projects = await pool.query(
      "SELECT type, COUNT(*) as count FROM tasks WHERE user_id = $1 AND status NOT IN ('done', 'completed') GROUP BY type",
      [userId]
    );
    const projectStats = { office: 0, personal: 0 };
    projects.rows.forEach(row => {
      if (row.type === 'work') projectStats.office = parseInt(row.count);
      if (row.type === 'learning') projectStats.personal = parseInt(row.count);
    });

    // Get overdue tasks
    const overdue = await pool.query(
      "SELECT COUNT(*) as count FROM tasks WHERE user_id = $1 AND status NOT IN ('done', 'completed') AND due_date < $2",
      [userId, today]
    );

    // Get time logs for today
    const timeLogs = await pool.query(
      "SELECT category, SUM(minutes) as minutes FROM time_logs WHERE user_id = $1 AND day = $2 GROUP BY category",
      [userId, today]
    );
    const timeStats = { workMinutes: 0, learningMinutes: 0 };
    timeLogs.rows.forEach(row => {
      if (row.category === 'work') timeStats.workMinutes = parseInt(row.minutes) || 0;
      if (row.category === 'learning') timeStats.learningMinutes = parseInt(row.minutes) || 0;
    });

    // Get task lists
    const workTasks = await pool.query(
      "SELECT * FROM tasks WHERE user_id = $1 AND type = 'work' AND status NOT IN ('done', 'completed') ORDER BY created_at DESC LIMIT 10",
      [userId]
    );
    const learningTasks = await pool.query(
      "SELECT * FROM tasks WHERE user_id = $1 AND type = 'learning' AND status NOT IN ('done', 'completed') ORDER BY created_at DESC LIMIT 10",
      [userId]
    );

    res.json({
      tasksToday: taskStats,
      projects: projectStats,
      overdue: parseInt(overdue.rows[0].count) || 0,
      time: timeStats,
      lists: {
        work: workTasks.rows,
        learning: learningTasks.rows
      }
    });
  } catch (error) {
    console.error("Dashboard overview error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

// Daily Goals endpoints
app.get("/daily-goals", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const date = req.query.date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      "SELECT * FROM daily_goals WHERE user_id = $1 AND date = $2 ORDER BY created_at DESC",
      [userId, date]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Daily goals fetch error:", error);
    res.status(500).json({ error: "Failed to fetch daily goals" });
  }
});

app.post("/daily-goals", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, category, priority, date } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: "Title and date are required" });
    }

    const result = await pool.query(
      `INSERT INTO daily_goals (user_id, title, description, category, priority, date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, title, description || '', category || 'personal', priority || 'medium', date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Daily goals create error:", error);
    res.status(500).json({ error: "Failed to create daily goal" });
  }
});

app.put("/daily-goals/:id", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;
    const { status, title, description, category, priority } = req.body;

    // If changing to completed, set completed_at timestamp
    const completedAt = status === 'completed' ? 'NOW()' : 'NULL';

    const result = await pool.query(
      `UPDATE daily_goals
       SET status = COALESCE($3, status),
           title = COALESCE($4, title),
           description = COALESCE($5, description),
           category = COALESCE($6, category),
           priority = COALESCE($7, priority),
           completed_at = ${status === 'completed' ? 'NOW()' : status === 'pending' ? 'NULL' : 'completed_at'},
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [goalId, userId, status, title, description, category, priority]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Daily goal not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Daily goals update error:", error);
    res.status(500).json({ error: "Failed to update daily goal" });
  }
});

app.delete("/daily-goals/:id", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const goalId = req.params.id;

    const result = await pool.query(
      "DELETE FROM daily_goals WHERE id = $1 AND user_id = $2 RETURNING *",
      [goalId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Daily goal not found" });
    }

    res.json({ message: "Daily goal deleted successfully" });
  } catch (error) {
    console.error("Daily goals delete error:", error);
    res.status(500).json({ error: "Failed to delete daily goal" });
  }
});

// Study Sessions endpoints
app.get("/study-sessions", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const date = req.query.date;

    let query = "SELECT * FROM study_sessions WHERE user_id = $1";
    let params = [userId];

    if (date) {
      query += " AND DATE(start_time) = $2";
      params.push(date);
    }

    query += " ORDER BY start_time DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Study sessions fetch error:", error);
    res.status(500).json({ error: "Failed to fetch study sessions" });
  }
});

app.post("/study-sessions", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const { subject, start_time, end_time, duration, focus_rating, notes } = req.body;

    if (!subject || !start_time) {
      return res.status(400).json({ error: "Subject and start time are required" });
    }

    // Calculate duration if not provided but end_time is available
    let calculatedDuration = duration;
    if (!duration && end_time) {
      const startTime = new Date(start_time);
      const endTime = new Date(end_time);
      calculatedDuration = Math.round((endTime - startTime) / (1000 * 60));
    }

    const result = await pool.query(
      `INSERT INTO study_sessions (user_id, subject, start_time, end_time, duration_minutes, focus_rating, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, subject, start_time, end_time || null, calculatedDuration || null, focus_rating || 3, notes || '']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Study sessions create error:", error);
    res.status(500).json({ error: "Failed to create study session" });
  }
});

app.put("/study-sessions/:id", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.params.id;
    const { subject, start_time, end_time, duration_minutes, focus_rating, notes } = req.body;

    const result = await pool.query(
      `UPDATE study_sessions
       SET subject = COALESCE($3, subject),
           start_time = COALESCE($4, start_time),
           end_time = COALESCE($5, end_time),
           duration_minutes = COALESCE($6, duration_minutes),
           focus_rating = COALESCE($7, focus_rating),
           notes = COALESCE($8, notes),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [sessionId, userId, subject, start_time, end_time, duration_minutes, focus_rating, notes]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Study session not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Study sessions update error:", error);
    res.status(500).json({ error: "Failed to update study session" });
  }
});

app.delete("/study-sessions/:id", authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    const sessionId = req.params.id;

    const result = await pool.query(
      "DELETE FROM study_sessions WHERE id = $1 AND user_id = $2 RETURNING *",
      [sessionId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Study session not found" });
    }

    res.json({ message: "Study session deleted successfully" });
  } catch (error) {
    console.error("Study sessions delete error:", error);
    res.status(500).json({ error: "Failed to delete study session" });
  }
});

// Demo user creation endpoint (for development/testing)
app.post("/admin/create-demo-user", async (req, res) => {
  try {
    const passwordHash = await bcrypt.hash("Mukesh9944", 10);

    const result = await pool.query(`
      INSERT INTO users (username, password_hash, phone)
      VALUES ($1, $2, $3)
      ON CONFLICT (username)
      DO UPDATE SET password_hash = EXCLUDED.password_hash, phone = EXCLUDED.phone
      RETURNING id, username;
    `, ["murugan@symatic.com", passwordHash, "9944567890"]);

    res.json({
      success: true,
      message: "Demo user created/updated successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Demo user creation error:", error);
    res.status(500).json({ error: "Failed to create demo user" });
  }
});

// Catch-all handler for React Router (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Start server
const PORT = Number(process.env.PORT || 3001);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎉 TASKFLOW PRO RUNNING ON http://localhost:${PORT}`);
  console.log(`📱 Mobile Access: http://192.168.1.2:${PORT}`);
  console.log(`🏠 Frontend: http://localhost:${PORT}/`);
  console.log(`🔧 API: http://localhost:${PORT}/api/...`);
  console.log(`🏥 Health: http://localhost:${PORT}/test-db`);
  console.log(`✅ Database: Connected to PostgreSQL`);
  console.log(`🌐 Ready for professional productivity management!`);
});