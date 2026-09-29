const socket = io();
let currentUserId = null;
let currentTargetId = null;

// --- ВХОД ---
async function doLogin() {
  const emailOrPhone = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errDiv = document.getElementById('auth-error');
  errDiv.textContent = '';

  if (!emailOrPhone || !password) {
    errDiv.textContent = 'Заполните поля входа';
    return;
  }
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrPhone, password }),
    });
    const data = await res.json();
    if (!res.ok) { errDiv.textContent = data.error; return; }
    enterChat(data.userId, data.username);
  } catch (e) {
    errDiv.textContent = 'Сервер недоступен';
  }
}

// --- РЕГИСТРАЦИЯ ---
async function doRegister() {
  const username = document.getElementById('reg-username').value.trim();
  const emailOrPhone = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value.trim();
  const errDiv = document.getElementById('auth-error');
  errDiv.textContent = '';

  if (!username || !emailOrPhone || !password) {
    errDiv.textContent = 'Заполните все поля регистрации';
    return;
  }
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, emailOrPhone, password }),
    });
    const data = await res.json();
    if (!res.ok) { errDiv.textContent = data.error; return; }
    enterChat(data.userId, data.username);
  } catch (e) {
    errDiv.textContent = 'Сервер недоступен';
  }
}

// --- ВХОД В ЧАТ ---
function enterChat(userId, username) {
  currentUserId = userId;
  socket.emit('identify', currentUserId);
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('chat-app').style.display = 'flex';
  loadContacts();
  openChat(null, 'Общий чат');
}

// --- ЗАГРУЗКА КОНТАКТОВ ---
async function loadContacts() {
  try {
    const res = await fetch('/api/contacts');
    const contacts = await res.json();
    const list = document.getElementById('chat-list');
    // Оставляем "Общий чат", остальное очищаем
    list.innerHTML = `
      <div class="chat-item active" onclick="openChat(null,'Общий чат')">
        <div class="avatar">G</div>
        <div class="info"><strong>Общий чат</strong><small>Все пользователи</small></div>
      </div>`;
    contacts.forEach(c => {
      if (c.id === currentUserId) return;
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.onclick = () => openChat(c.id, c.username);
      div.innerHTML = `
        <div class="avatar">${c.username[0].toUpperCase()}</div>
        <div class="info"><strong>${c.username}</strong><small>В сети</small></div>`;
      list.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

// --- ОТКРЫТИЕ ЧАТА ---
function openChat(targetId, title) {
  currentTargetId = targetId;
  document.getElementById('current-chat-title').innerText = title;
  document.getElementById('messages').innerHTML = '';
  // Подсветка активного чата
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  event && event.currentTarget && event.currentTarget.classList.add('active');
  socket.emit('loadHistory', { userId: currentUserId, targetUserId: targetId });
}

socket.on('historyLoaded', (msgs) => {
  msgs.forEach(addMessage);
  scrollToBottom();
});

socket.on('newMessage', (msg) => {
  const isGlobal = msg.receiverId === null && currentTargetId === null;
  const isPrivate = msg.receiverId !== null && (
    (msg.senderId === currentUserId && msg.receiverId === currentTargetId) ||
    (msg.receiverId === currentUserId && msg.senderId === currentTargetId)
  );
  if (isGlobal || isPrivate) {
    addMessage(msg);
    scrollToBottom();
  }
});

// --- ОТПРАВКА ---
function sendMessage(e) {
  e.preventDefault();
  const text = document.getElementById('message-input').value.trim();
  if (!text || !currentUserId) return;
  socket.emit('sendMessage', {
    senderId: currentUserId,
    receiverId: currentTargetId,
    text,
  });
  document.getElementById('message-input').value = '';
}

function addMessage(msg) {
  const div = document.createElement('div');
  div.className = msg.senderId === currentUserId ? 'msg msg-mine' : 'msg';
  div.innerHTML = `<strong>${escapeHtml(msg.senderName || 'Unknown')}:</strong> ${escapeHtml(msg.text)}`;
  document.getElementById('messages').appendChild(div);
}

function scrollToBottom() {
  const m = document.getElementById('messages');
  m.scrollTop = m.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
