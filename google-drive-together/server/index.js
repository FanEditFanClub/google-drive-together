import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Allow embedding inside Discord client iframe
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.discord.com https://discord.com");
  next();
});

app.use(express.json());

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PORT = process.env.PORT || 3001;

// ---------- Root & Health check ----------
app.get('/', (req, res) => {
  res.send('Google Drive Together Backend is running!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- Discord OAuth token exchange ----------
app.post('/api/token', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Discord token error:', data);
      return res.status(response.status).json(data);
    }

    // Return the full token payload back to the Discord SDK frontend
    res.json(data);
  } catch (err) {
    console.error('Token exchange exception:', err);
    res.status(500).json({ error: 'Token exchange failed' });
  }
});

// ---------- In-memory room state ----------
const rooms = new Map();

function getOrCreateRoom(instanceId) {
  if (!rooms.has(instanceId)) {
    rooms.set(instanceId, {
      videoUrl: null,
      isPlaying: false,
      currentTime: 0,
      lastUpdated: Date.now(),
      controllerId: null,
    });
  }
  return rooms.get(instanceId);
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  let currentInstanceId = null;

  socket.on('join', ({ instanceId, userId }) => {
    if (currentInstanceId) {
      socket.leave(currentInstanceId);
    }

    currentInstanceId = instanceId;
    socket.join(instanceId);

    const room = getOrCreateRoom(instanceId);

    if (!room.controllerId) {
      room.controllerId = userId;
    }

    socket.emit('state', {
      ...room,
      currentTime: room.isPlaying
        ? room.currentTime + (Date.now() - room.lastUpdated) / 1000
        : room.currentTime,
    });

    console.log(`[${instanceId}] User ${userId} joined`);
  });

  socket.on('setVideo', ({ instanceId, videoUrl, userId }) => {
    const room = getOrCreateRoom(instanceId);
    room.videoUrl = videoUrl;
    room.isPlaying = false;
    room.currentTime = 0;
    room.lastUpdated = Date.now();
    room.controllerId = userId;

    io.to(instanceId).emit('state', room);
    console.log(`[${instanceId}] New video set by ${userId}`);
  });

  socket.on('updatePlayback', ({ instanceId, isPlaying, currentTime, userId }) => {
    const room = getOrCreateRoom(instanceId);

    room.isPlaying = isPlaying;
    room.currentTime = currentTime;
    room.lastUpdated = Date.now();
    room.controllerId = userId;

    socket.to(instanceId).emit('state', room);
  });

  socket.on('disconnect', () => {
    if (currentInstanceId) {
      console.log(`[${currentInstanceId}] A user disconnected`);
    }
  });
});

// Clean up empty rooms occasionally
setInterval(() => {
  for (const [id] of rooms.entries()) {
    const size = io.sockets.adapter.rooms.get(id)?.size || 0;
    if (size === 0) {
      rooms.delete(id);
    }
  }
}, 5 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`Google Drive Together server running on port ${PORT}`);
});
