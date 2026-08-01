import { useEffect, useRef, useState, useCallback } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { io } from 'socket.io-client';
import './App.css';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// Convert public Google Drive share link → streamable URL
function getDriveStreamUrl(input) {
  if (!input) return null;

  // Already a direct uc link
  if (input.includes('drive.google.com/uc')) {
    return input.includes('confirm=') ? input : input + (input.includes('?') ? '&' : '?') + 'confirm=t';
  }

  // Extract file ID
  const match =
    input.match(/\/d\/([a-zA-Z0-9_-]{10,})/) ||
    input.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) ||
    input.match(/([a-zA-Z0-9_-]{25,})/); // fallback for raw ID

  if (!match) return null;

  const id = match[1];
  return `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;
}

export default function App() {
  const [status, setStatus] = useState('Connecting to Discord...');
  const [auth, setAuth] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [inputUrl, setInputUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);
  const socketRef = useRef(null);
  const discordSdkRef = useRef(null);
  const isApplyingRemoteState = useRef(false);
  const lastEmittedTime = useRef(0);

  // ---------- Discord SDK + Auth ----------
  useEffect(() => {
    async function setup() {
      try {
        const discordSdk = new DiscordSDK(CLIENT_ID);
        discordSdkRef.current = discordSdk;

        await discordSdk.ready();
        setStatus('Authorizing...');

        const { code } = await discordSdk.commands.authorize({
          client_id: CLIENT_ID,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify'],
        });

        // Exchange code for access token via our backend
        const tokenRes = await fetch(`${SERVER_URL}/api/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        const { access_token } = await tokenRes.json();

        if (!access_token) {
          throw new Error('Failed to get access token');
        }

        const authResult = await discordSdk.commands.authenticate({
          access_token,
        });

        setAuth(authResult);
        setStatus('Connected');

        // Connect to Socket.io
        const instanceId = discordSdk.instanceId;
        const socket = io(SERVER_URL, {
          transports: ['websocket', 'polling'],
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('join', {
            instanceId,
            userId: authResult.user.id,
          });
        });

        socket.on('state', (state) => {
          applyRemoteState(state);
        });

        socket.on('connect_error', (err) => {
          console.error('Socket error', err);
          setError('Could not connect to sync server');
        });
      } catch (err) {
        console.error(err);
        setStatus('Failed to connect');
        setError(err.message || 'Something went wrong');
      }
    }

    setup();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  // ---------- Apply remote state ----------
  const applyRemoteState = useCallback((state) => {
    isApplyingRemoteState.current = true;

    if (state.videoUrl !== videoUrl) {
      setVideoUrl(state.videoUrl);
    }

    setIsPlaying(state.isPlaying);

    const video = videoRef.current;
    if (video && state.videoUrl) {
      // Only seek if difference is significant
      if (Math.abs(video.currentTime - state.currentTime) > 1.2) {
        video.currentTime = state.currentTime;
      }

      if (state.isPlaying && video.paused) {
        video.play().catch(() => {});
      } else if (!state.isPlaying && !video.paused) {
        video.pause();
      }
    }

    // Small delay so local events don't immediately re-broadcast
    setTimeout(() => {
      isApplyingRemoteState.current = false;
    }, 300);
  }, [videoUrl]);

  // ---------- Local video event handlers ----------
  const emitPlaybackUpdate = useCallback(() => {
    if (isApplyingRemoteState.current || !socketRef.current || !discordSdkRef.current || !auth) return;

    const video = videoRef.current;
    if (!video) return;

    const now = Date.now();
    // Throttle time updates a bit
    if (Math.abs(video.currentTime - lastEmittedTime.current) < 0.8 && video.paused === !isPlaying) {
      return;
    }
    lastEmittedTime.current = video.currentTime;

    socketRef.current.emit('updatePlayback', {
      instanceId: discordSdkRef.current.instanceId,
      isPlaying: !video.paused,
      currentTime: video.currentTime,
      userId: auth.user.id,
    });
  }, [auth, isPlaying]);

  const handlePlay = () => {
    setIsPlaying(true);
    emitPlaybackUpdate();
  };

  const handlePause = () => {
    setIsPlaying(false);
    emitPlaybackUpdate();
  };

  const handleSeeked = () => {
    emitPlaybackUpdate();
  };

  // ---------- Set new video ----------
  const handleSetVideo = (e) => {
    e.preventDefault();
    if (!inputUrl.trim() || !socketRef.current || !discordSdkRef.current || !auth) return;

    const streamUrl = getDriveStreamUrl(inputUrl.trim());
    if (!streamUrl) {
      setError('Could not parse Google Drive link. Make sure it is a public share link.');
      return;
    }

    setError(null);
    setVideoUrl(streamUrl);
    setInputUrl('');

    socketRef.current.emit('setVideo', {
      instanceId: discordSdkRef.current.instanceId,
      videoUrl: streamUrl,
      userId: auth.user.id,
    });
  };

  // ---------- Render ----------
  if (!auth) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>{status}</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">▶ Google Drive Together</div>
        <div className="user">
          {auth.user.username}
        </div>
      </header>

      <main className="main">
        {!videoUrl ? (
          <div className="empty-state">
            <h2>Paste a public Google Drive video link</h2>
            <p>Make sure the file is set to “Anyone with the link can view”</p>

            <form onSubmit={handleSetVideo} className="url-form">
              <input
                type="text"
                placeholder="https://drive.google.com/file/d/..."
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
              />
              <button type="submit">Load Video</button>
            </form>

            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <div className="player-container">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              onPlay={handlePlay}
              onPause={handlePause}
              onSeeked={handleSeeked}
              className="video"
            />

            <div className="controls-bar">
              <form onSubmit={handleSetVideo} className="url-form small">
                <input
                  type="text"
                  placeholder="Change video (paste new Google Drive link)"
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                />
                <button type="submit">Change</button>
              </form>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        <span>Synced for everyone in this Activity</span>
      </footer>
    </div>
  );
}
