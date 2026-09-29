const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const db = new sqlite3.Database('./messenger.db');

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  email_or_phone TEXT UNIQUE,
  password_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER,
  receiver_id INTEGER,
  text TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// --- API РЕГИСТРАЦИЯ ---
app.post('/api/register', async (req, res) => {
  const { username, emailOrPhone, password } = req.body;
  if (!username || !emailOrPhone || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (username, email_or_phone, password_hash) VALUES (?, ?, ?)',
      [username, emailOrPhone, hash],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Это имя или почта уже заняты' });
          }
          return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        res.json({ success: true, userId: this.lastID, username });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// --- API ВХОД ---
app.post('/api/login', async (req, res) => {
  const { emailOrPhone, password } = req.body;
  if (!emailOrPhone || !password) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  db.get(
    'SELECT * FROM users WHERE email_or_phone = ?',
    [emailOrPhone],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }
      res.json({ success: true, userId: user.id, username: user.username });
    }
  );
});

// --- API СПИСОК КОНТАКТОВ ---
app.get('/api/contacts', (req, res) => {
  db.all('SELECT id, username FROM users ORDER BY username', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка базы данных' });
    res.json(rows);
  });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
  socket.on('identify', (userId) => {
    socket.userId = userId;
  });

  socket.on('loadHistory', ({ userId, targetUserId }) => {
    let query, params;
    if (!targetUserId) {
      query = `SELECT m.*, u.username as sender_name
               FROM messages m JOIN users u ON m.sender_id = u.id
               WHERE m.receiver_id IS NULL
               ORDER BY m.id DESC LIMIT 50`;
      params = [];
    } else {
      query = `SELECT m.*, u.username as sender_name
               FROM messages m JOIN users u ON m.sender_id = u.id
               WHERE (m.sender_id = ? AND m.receiver_id = ?)
                  OR (m.sender_id = ? AND m.receiver_id = ?)
               ORDER BY m.id DESC LIMIT 50`;
      params = [userId, targetUserId, targetUserId, userId];
    }
    db.all(query, params, (err, rows) => {
      if (!err) socket.emit('historyLoaded', rows ? rows.reverse() : []);
    });
  });

  socket.on('sendMessage', ({ senderId, receiverId, text }) => {
    const query = receiverId
      ? 'INSERT INTO messages (sender_id, receiver_id, text) VALUES (?, ?, ?)'
      : 'INSERT INTO messages (sender_id, text) VALUES (?, ?)';
    const params = receiverId ? [senderId, receiverId, text] : [senderId, text];

    db.run(query, params, function () {
      db.get(
        'SELECT u.username as sender_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?',
        [this.lastID],
        (err, row) => {
          const newMsg = {
            id: this.lastID,
            senderId,
            receiverId,
            text,
            senderName: row ? row.sender_name : 'Unknown',
            timestamp: new Date().toISOString(),
          };
          if (receiverId) {
            for (let id in io.sockets.sockets) {
              const s = io.sockets.sockets[id];
              if (s.userId === senderId || s.userId === receiverId) {
                s.emit('newMessage', newMsg);
              }
            }
          } else {
            io.emit('newMessage', newMsg);
          }
        }
      );
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
