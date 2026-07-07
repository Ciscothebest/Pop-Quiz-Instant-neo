process.env.UV_THREADPOOL_SIZE = 128;
require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const fs = require('fs');
const cluster = require('cluster');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);
const randomBytes = promisify(crypto.randomBytes);

// Crear la carpeta de uploads para desacoplar el almacenamiento de SQLite
let uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn("Advertencia: No se pudo crear o acceder a UPLOADS_DIR (" + uploadsDir + "):", e.message);
  console.warn("Usando ruta local de fallback para uploads.");
  uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// Criptografía: PBKDF2 Hashing para contraseñas seguras (asíncronas para no bloquear el bucle de eventos)
async function hashPassword(password) {
  const saltBytes = await randomBytes(16);
  const salt = saltBytes.toString('hex');
  const hashBytes = await pbkdf2(password, salt, 1000, 64, 'sha512');
  return `${salt}:${hashBytes.toString('hex')}`;
}

async function verifyPassword(password, storedPassword) {
  if (!storedPassword.includes(':')) {
    // Fallback de retrocompatibilidad para contraseñas antiguas en texto plano
    return password === storedPassword;
  }
  const [salt, originalHash] = storedPassword.split(':');
  const hashBytes = await pbkdf2(password, salt, 1000, 64, 'sha512');
  return hashBytes.toString('hex') === originalHash;
}

if (cluster.isPrimary || cluster.isMaster) {
  console.log(`Proceso principal ${process.pid} corriendo.`);

  // 1. Inicializar base de datos y correr migraciones e índices en el proceso master
  let dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'examenes.db');
  try {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Advertencia: No se pudo crear el directorio para la base de datos (" + dbPath + "):", e.message);
    dbPath = path.join(__dirname, 'examenes.db');
  }
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error al abrir la base de datos SQLite en master:', err);
      process.exit(1);
    }
  });

  db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL;');

    db.run(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        username TEXT
      )
    `, (err) => {
      if (!err) {
        db.run(`ALTER TABLE groups ADD COLUMN active INTEGER NOT NULL DEFAULT 1`, (alterErr) => {});
        db.run(`ALTER TABLE groups ADD COLUMN username TEXT`, (alterErr) => {});
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        date TEXT NOT NULL,
        questions TEXT NOT NULL,
        answers TEXT NOT NULL,
        correct_count INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        group_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        username TEXT,
        FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL
      )
    `, (err) => {
      if (!err) {
        db.run(`ALTER TABLE exams ADD COLUMN active INTEGER NOT NULL DEFAULT 1`, (alterErr) => {});
        db.run(`ALTER TABLE exams ADD COLUMN username TEXT`, (alterErr) => {});
        db.run(`ALTER TABLE exams ADD COLUMN difficulty TEXT`, (alterErr) => {});
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        size_label TEXT NOT NULL,
        original_data TEXT NOT NULL DEFAULT '',
        media_type TEXT NOT NULL DEFAULT 'text/plain',
        pdf_images TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        username TEXT,
        group_id TEXT
      )
    `, (err) => {
      if (!err) {
        db.run(`ALTER TABLE files ADD COLUMN original_data TEXT NOT NULL DEFAULT ''`, (alterErr) => {});
        db.run(`ALTER TABLE files ADD COLUMN media_type TEXT NOT NULL DEFAULT 'text/plain'`, (alterErr) => {});
        db.run(`ALTER TABLE files ADD COLUMN pdf_images TEXT NOT NULL DEFAULT '[]'`, (alterErr) => {});
        db.run(`ALTER TABLE files ADD COLUMN active INTEGER NOT NULL DEFAULT 1`, (alterErr) => {});
        db.run(`ALTER TABLE files ADD COLUMN username TEXT`, (alterErr) => {});
        db.run(`ALTER TABLE files ADD COLUMN group_id TEXT`, (alterErr) => {});
      }
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_groups_username_active ON groups(username, active);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_exams_username_active_date ON exams(username, active, date DESC);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_files_username_active ON files(username, active);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_exams_group_id ON exams(group_id);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_files_group_id ON files(group_id);`);

    db.close((closeErr) => {
      if (closeErr) console.error('Error al cerrar DB en master:', closeErr);
      const numCPUs = require('os').cpus().length;
      const workersCount = parseInt(process.env.WEB_CONCURRENCY) || Math.min(numCPUs, 4);
      console.log(`Master: Iniciando ${workersCount} procesos trabajadores...`);
      for (let i = 0; i < workersCount; i++) {
        cluster.fork();
      }
    });
  });

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Proceso trabajador ${worker.process.pid} se detuvo. Iniciando uno nuevo...`);
    cluster.fork();
  });
} else {
  // Los procesos trabajadores (Workers) corren la aplicación Express
  const app = express();
  const PORT = process.env.PORT || 3000;

// Initialize SQLite database
let dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'examenes.db');
try {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
} catch (e) {
  console.warn("Advertencia: No se pudo crear el directorio para la base de datos en worker (" + dbPath + "):", e.message);
  dbPath = path.join(__dirname, 'examenes.db');
}
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(`Error al abrir la base de datos SQLite en worker ${process.pid}:`, err);
  } else {
    // Optimizar SQLite para concurrencia masiva en workers
    db.serialize(() => {
      db.run('PRAGMA journal_mode = WAL;');
      db.run('PRAGMA busy_timeout = 10000;'); // 10 segundos de timeout para aguantar picos
      db.run('PRAGMA synchronous = NORMAL;');
      db.run('PRAGMA cache_size = -64000;'); // 64MB de caché
      db.run('PRAGMA temp_store = MEMORY;'); // Tablas temporales en RAM
      db.run('PRAGMA mmap_size = 268435456;'); // Memory-mapped I/O (256MB)
    });
  }
});

// Database promise helpers
const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Enable CORS for cross-origin requests (e.g. Netlify frontend to Render backend)
const cors = require('cors');
app.use(cors());

// Middleware to parse JSON bodies (with size limits for large files/text contents)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from the frontend directory
app.use(express.static(path.join(__dirname, '../frontend')));

// --- REST Endpoints for SQLite ---

// Auth Endpoints
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (cleanUser.length < 3) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
  }

  try {
    const existing = await dbGet('SELECT username FROM users WHERE username = ?', [cleanUser]);
    if (existing) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado.' });
    }

    const securePass = await hashPassword(password);
    await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [cleanUser, securePass]);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor al registrar usuario: ' + err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos.' });
  }

  const cleanUser = username.trim().toLowerCase();
  try {
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [cleanUser]);
    if (!user) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    // Auto-migrate legacy plaintext passwords to PBKDF2 hashed format
    if (!user.password.includes(':')) {
      const securePass = await hashPassword(password);
      await dbRun('UPDATE users SET password = ? WHERE username = ?', [securePass, cleanUser]);
    }

    res.json({ success: true, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor al iniciar sesión: ' + err.message });
  }
});


// Authentication Middleware to isolate data by user
const requireAuth = (req, res, next) => {
  const username = req.headers['x-username'];
  if (!username) {
    return res.status(401).json({ error: 'No autorizado. Se requiere iniciar sesión.' });
  }
  req.username = username.trim().toLowerCase();
  next();
};

app.use('/api/groups', requireAuth);
app.use('/api/exams', requireAuth);
app.use('/api/files', requireAuth);


// Groups CRUD (Soft Delete supported)
app.get('/api/groups', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM groups WHERE active = 1 AND username = ?', [req.username]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener grupos: ' + err.message });
  }
});

app.post('/api/groups', async (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'Faltan ID o nombre del grupo.' });
  }
  try {
    await dbRun('INSERT INTO groups (id, name, active, username) VALUES (?, ?, 1, ?)', [id, name, req.username]);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar grupo: ' + err.message });
  }
});

app.put('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Falta el nombre del grupo.' });
  }
  try {
    await dbRun('UPDATE groups SET name = ? WHERE id = ? AND username = ? AND active = 1', [name, id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar grupo: ' + err.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Soft Delete: update active status to 0 instead of running physical delete
    await dbRun('UPDATE groups SET active = 0 WHERE id = ? AND username = ?', [id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar grupo: ' + err.message });
  }
});

// Exams CRUD (Soft Delete supported)
app.get('/api/exams', async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM exams WHERE active = 1 AND username = ? ORDER BY date DESC', [req.username]);
    const formatted = rows.map(r => ({
      id: r.id,
      topic: r.topic,
      date: r.date,
      questions: JSON.parse(r.questions),
      answers: JSON.parse(r.answers),
      result: {
        correctCount: r.correct_count,
        total: r.total_questions,
        pct: r.total_questions ? r.correct_count / r.total_questions : 0,
        passed: r.passed === 1
      },
      groupId: r.group_id,
      difficulty: r.difficulty || 'normal'
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener exámenes: ' + err.message });
  }
});

app.post('/api/exams', async (req, res) => {
  const { id, topic, date, questions, answers, result, groupId, difficulty } = req.body;
  if (!id || !topic || !questions || !answers || !result) {
    return res.status(400).json({ error: 'Faltan datos requeridos para registrar el examen.' });
  }
  try {
    await dbRun(`
      INSERT INTO exams (id, topic, date, questions, answers, correct_count, total_questions, passed, group_id, active, username, difficulty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id,
      topic,
      date,
      JSON.stringify(questions),
      JSON.stringify(answers),
      result.correctCount,
      result.total,
      result.passed ? 1 : 0,
      groupId || null,
      req.username,
      difficulty || 'normal'
    ]);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar el examen: ' + err.message });
  }
});

app.put('/api/exams/:id/group', async (req, res) => {
  const { id } = req.params;
  const { groupId } = req.body;
  try {
    await dbRun('UPDATE exams SET group_id = ? WHERE id = ? AND username = ? AND active = 1', [groupId || null, id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar grupo del examen: ' + err.message });
  }
});

app.put('/api/files/:id/group', async (req, res) => {
  const { id } = req.params;
  const { groupId } = req.body;
  try {
    await dbRun('UPDATE files SET group_id = ? WHERE id = ? AND username = ? AND active = 1', [groupId || null, id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar grupo del archivo: ' + err.message });
  }
});

app.delete('/api/exams', async (req, res) => {
  const { groupId } = req.query;
  try {
    if (groupId === 'ungrouped') {
      // Clear only exams without any group
      await dbRun('UPDATE exams SET active = 0 WHERE username = ? AND (group_id IS NULL OR group_id = "")', [req.username]);
    } else if (groupId) {
      // Clear only exams belonging to the specified group
      await dbRun('UPDATE exams SET active = 0 WHERE username = ? AND group_id = ?', [req.username, groupId]);
    } else {
      // Clear all exams
      await dbRun('UPDATE exams SET active = 0 WHERE username = ?', [req.username]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al limpiar historial de exámenes: ' + err.message });
  }
});

app.delete('/api/exams/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Soft Delete: update active status of a single exam to 0
    await dbRun('UPDATE exams SET active = 0 WHERE id = ? AND username = ?', [id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar examen del historial: ' + err.message });
  }
});

// Files (Library) CRUD (Soft Delete supported, optimized with disk offloading)
app.get('/api/files', async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, name, content, size_label, media_type, pdf_images, group_id FROM files WHERE active = 1 AND username = ?', [req.username]);
    
    // Leer el contenido de disco asíncronamente en paralelo
    const mapped = await Promise.all(rows.map(async (r) => {
      let content = r.content;
      // Retrocompatibilidad: Si el campo apunta a un archivo .dat en disco
      if (content && content.endsWith('_content.dat')) {
        try {
          content = await fs.promises.readFile(path.join(uploadsDir, content), 'utf8');
        } catch (err) {
          console.error(`Error al leer archivo de disco ${r.content}:`, err);
          content = '';
        }
      }
      return {
        id: r.id,
        name: r.name,
        content: content,
        sizeLabel: r.size_label,
        mediaType: r.media_type,
        pdfImages: JSON.parse(r.pdf_images || '[]'),
        groupId: r.group_id
      };
    }));
    
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener archivos: ' + err.message });
  }
});

app.get('/api/files/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const row = await dbGet('SELECT * FROM files WHERE id = ? AND username = ? AND active = 1', [id, req.username]);
    if (!row) {
      return res.status(404).json({ error: 'Archivo no encontrado.' });
    }
    
    let content = row.content;
    if (content && content.endsWith('_content.dat')) {
      try {
        content = await fs.promises.readFile(path.join(uploadsDir, content), 'utf8');
      } catch (err) {
        console.error(`Error al leer archivo de disco ${row.content}:`, err);
        content = '';
      }
    }
    
    let originalData = row.original_data;
    if (originalData && originalData.endsWith('_orig.dat')) {
      try {
        originalData = await fs.promises.readFile(path.join(uploadsDir, originalData), 'utf8');
      } catch (err) {
        console.error(`Error al leer originalData de disco ${row.original_data}:`, err);
        originalData = '';
      }
    }

    const file = {
      id: row.id,
      name: row.name,
      content: content,
      size_label: row.size_label,
      original_data: originalData,
      media_type: row.media_type,
      pdfImages: JSON.parse(row.pdf_images || '[]'),
      active: row.active,
      groupId: row.group_id
    };
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el archivo: ' + err.message });
  }
});

app.post('/api/files', async (req, res) => {
  const { id, name, content, sizeLabel, originalData, mediaType, pdfImages, groupId } = req.body;
  if (!id || !name || content === undefined || content === null || !sizeLabel || originalData === undefined || originalData === null || !mediaType) {
    return res.status(400).json({ error: 'Faltan datos obligatorios para guardar el archivo.' });
  }
  
  try {
    // Verificar si ya existe un archivo activo con el mismo nombre para este usuario
    const existing = await dbGet('SELECT id FROM files WHERE name = ? AND active = 1 AND username = ?', [name, req.username]);
    if (existing) {
      return res.status(409).json({ error: `El archivo "${name}" ya existe en la biblioteca.` });
    }

    // Definir nombres de archivo
    const contentFilename = `${id}_content.dat`;
    const originalDataFilename = `${id}_orig.dat`;
    
    // Escribir contenido asíncronamente en el disco
    await Promise.all([
      fs.promises.writeFile(path.join(uploadsDir, contentFilename), content, 'utf8'),
      fs.promises.writeFile(path.join(uploadsDir, originalDataFilename), originalData, 'utf8')
    ]);

    // Insertar sólo los nombres de archivos de referencia en SQLite (escritura ultra-rápida)
    await dbRun(`
      INSERT INTO files (id, name, content, size_label, original_data, media_type, pdf_images, active, username, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [
      id,
      name,
      contentFilename,
      sizeLabel,
      originalDataFilename,
      mediaType,
      JSON.stringify(pdfImages || []),
      req.username,
      groupId || null
    ]);
    
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al guardar archivo en el servidor: ' + err.message });
  }
});

app.delete('/api/files', async (req, res) => {
  const { groupId } = req.query;
  try {
    if (groupId) {
      // Disassociate files from this group, but keep them active in the library
      await dbRun('UPDATE files SET group_id = NULL WHERE username = ? AND group_id = ?', [req.username, groupId]);
    } else {
      // Soft-delete all files from the library completely
      await dbRun('UPDATE files SET active = 0 WHERE username = ?', [req.username]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar archivos de la biblioteca: ' + err.message });
  }
});

app.delete('/api/files/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Soft Delete: update active status to 0 instead of running physical delete
    await dbRun('UPDATE files SET active = 0 WHERE id = ? AND username = ?', [id, req.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al desactivar archivo de la biblioteca: ' + err.message });
  }
});

// Image Search Scraper endpoint using DuckDuckGo
app.get('/api/image-search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ error: 'Falta la consulta de búsqueda.' });
  }

  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      }
    });
    const html = await response.text();
    
    const vqdRegex = /vqd=['"]([^'"]+)['"]/;
    const match = html.match(vqdRegex);
    if (!match) {
      return res.status(500).json({ error: 'No se pudo obtener el token de búsqueda.' });
    }
    const vqd = match[1];

    const imagesUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`;
    const imagesResponse = await fetch(imagesUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Referer': 'https://duckduckgo.com/'
      }
    });
    const data = await imagesResponse.json();
    
    if (data.results && data.results.length > 0) {
      // Return top 5 image URLs to try loading in fallback order
      const urls = data.results.slice(0, 5).map(r => r.image);
      return res.json({ images: urls });
    }
    
    res.json({ images: [] });
  } catch (err) {
    console.error('Error en búsqueda de imágenes:', err);
    res.status(500).json({ error: 'Error en búsqueda de imágenes: ' + err.message });
  }
});

// API endpoint to proxy DeepSeek requests
app.post('/api/generate', async (req, res) => {
  const authHeader = req.headers['authorization'];
  let apiKey = process.env.DEEPSEEK_API_KEY;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const clientKey = authHeader.substring(7).trim();
    if (clientKey) {
      apiKey = clientKey;
    }
  }

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'No se encontró la clave de API de DeepSeek. Por favor configúrala en el archivo .env.' 
    });
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error de DeepSeek API:', data);
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Error del servidor al conectar con DeepSeek:', error);
    res.status(500).json({ 
      error: 'Error de servidor interno al comunicarse con DeepSeek: ' + error.message 
    });
  }
});

// For any other routes, serve index.html from frontend directory
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Servidor local corriendo en http://localhost:${PORT} (Proceso trabajador ${process.pid})`);
  });
}
