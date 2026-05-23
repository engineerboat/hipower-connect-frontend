import { io } from "socket.io-client";

// =========================
// AUTO ENV BACKEND SWITCH
// =========================
const SERVER_URL =
  process.env.REACT_APP_SOCKET_URL ||
  "https://hipower-connect-backend.onrender.com";

// =========================
// SOCKET INSTANCE (SINGLETON SAFE)
// =========================
export const socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,

  // IMPORTANT for mobile stability
  forceNew: false
});

// =========================
// DEBUG LOGGING (OPTIONAL BUT USEFUL)
// =========================
socket.on("connect", () => {
  console.log("🟢 SOCKET CONNECTED:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("🔴 SOCKET DISCONNECTED:", reason);
});

socket.on("connect_error", (err) => {
  console.log("⚠️ SOCKET ERROR:", err.message);
});
