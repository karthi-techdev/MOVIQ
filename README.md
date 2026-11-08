---
title: MOVIQ 3D Virtual Cinema
emoji: 🎥
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# MOVIQ — 3D Virtual Cinema

A Next.js and Three.js multiplayer virtual cinema. Users can create or join a theatre, occupy synchronized seats, chat, talk over WebRTC voice and watch host-controlled synchronized movies on an immersive curved 3D cinema screen.

## Requirements

- Node.js 18 or newer
- npm
- A modern desktop browser with WebGL2, WebRTC and HTML5 video support
- A direct browser-compatible video URL for movie playback
- HTTPS or localhost for reliable microphone access

## Installation

```bash
npm install
npm start
```

Open:

```text山姆 http://localhost:3000
```

The correct URL is:

```text
http://localhost:3000
```

Open multiple tabs or browser windows, create a theatre in one tab, and join its room ID from the others.

To allow other computers on your LAN to join, start the server normally and open:

```text老 http://YOUR_LOCAL_IP:3000
```

Replace `YOUR_LOCAL_IP` with the host computer's LAN address. Allow Node.js through the host firewall. Other devices must use the host machine's address rather than `localhost`.

You can specify another port:

```bash
PORT=8080 npm start
```

## Movie playback

1. The host opens the movie settings.
2. Paste a direct MP4/WebM URL.
3. Load the movie.
4. Click the page or press the playback control if the browser blocks autoplay.

The URL must be a browser-compatible media resource and must permit cross-origin use where required by `VideoTexture`. A YouTube/Vimeo watch-page URL is not an MP4/WebM media URL. Remote media must also permit cross-origin playback for `VideoTexture`.

Example test URL:

```text
https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4
```

Only the host can load, play, pause, seek, or change the shared movie. Playback events are distributed through the WebSocket server and late joiners receive the current playback state.

## Voice chat

1. Click the microphone/voice button.
2. Allow microphone access.
3. Speak; your avatar and participant entry show a speaking indicator.
4. Use the microphone button again to mute.

Voice uses WebRTC peer-to-peer connections. WebSocket messages exchange SDP offers, answers, and ICE candidates. Default STUN configuration is included. For restrictive NATs, configure a TURN server in `script.js`:

```js
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:turn.example.com:3478",
    username: "your-user",
    credential: "your-password"
  }
];
```

Never expose long-lived TURN credentials publicly. Production deployments should issue temporary TURN credentials from an authenticated backend endpoint.

## Controls

- `W A S D`: Move while standing
- Mouse drag: Rotate the third-person camera
- Mouse wheel: Zoom
- Click an unoccupied seat: Sit
- Stand button: Leave your seat
- `M`: Toggle microphone
- `Enter`: Send chat
- `H`: Hide/show cinema controls
- Host controls: load URL, play, pause, seek, volume

## Features

- Procedural cinema auditorium, seating, acoustic panels and cinematic lighting
- Unique 3D avatars and synchronized transforms
- Real seat occupancy and sit/stand interaction珍爱网
- Room creation, private room IDs and public theatre discovery
- Host migration on disconnect
- Public text chat and join/leave events
- WebRTC mesh voice with voice activity indication
- Mute state and voice join/leave controls
- MP4/WebM screen playback through `THREE.VideoTexture`
- Host-controlled play, pause, seek and volume synchronization
- Late-joiner movie state recovery
- Responsive glass-style cinema UI
- Automatic cleanup of disconnected users and empty rooms

## Files

```text
virtual-cinema/
├── index.html
├── styles.css
├── script.js
├── server.js
├── package.json
└── README.md
```

## Project structure

- `server.js`: room lifecycle, users, seats, chat, playback, and WebRTC signaling
- `script.js`: Three.js auditorium, avatars, controls, WebRTC peers, and networking
- `styles.css`: responsive cinema interface
- `index.html`: UI and screen video element

## Architecture

The WebSocket server is authoritative for:

- Room lifecycle and host assignment
- User joins/leaves and heartbeat
- Seat ownership
- Player transforms
- Chat fan-out
- Playback state and host commands
- WebRTC offer/answer/ICE relay

Media audio is peer-to-peer through WebRTC. The server does not process or relay microphone audio. Movie media is fetched directly by each browser from the configured movie URL.

## Autoplay and media limitations

Browsers usually block audible autoplay until the user interacts with the page. The client therefore presents a playback-enable action when necessary. The remote media host must support HTTPS, CORS, byte-range requests, and a browser-compatible codec. A web page URL, YouTube watch URL, or expired signed URL cannot be used as a direct `VideoTexture` source.

## Production notes

- Serve the application over HTTPS so microphone permissions and WebRTC work reliably on remote devices.
- Configure a TURN server for restrictive NATs.
- Replace the default demo movie URL with media you are licensed to stream.
- Keep the Node process behind TLS termination in production.
- Set `WS_URL`/`socketUrl` in the client when serving the frontend and WebSocket endpoint on different origins.
- `npm run dev` uses Node watch mode when available; `npm start` runs the standard server.
