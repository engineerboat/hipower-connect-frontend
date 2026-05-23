import { io } from "socket.io-client";

// =========================
// VITE ENV FIX
// =========================
const SERVER_URL =
  import.meta.env.VITE_SOCKET_URL ||
  "https://hipower-connect-backend.onrender.com";

// =========================
// SOCKET INSTANCE
// =========================
export const socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  forceNew: false
});

// =========================
// DEBUG LOGGING
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
