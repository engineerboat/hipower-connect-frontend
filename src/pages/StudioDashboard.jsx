import { useEffect, useState, useRef, useMemo } from "react";
import { socket } from "../socket";

export default function StudioDashboard() {


 // 👇 ADD THESE HERE (top of component, before state)

  const getInitialRoute = () => {
    return localStorage.getItem("studio_output_route") || null;
  };

  const getInitialSolo = () => {
    return localStorage.getItem("studio_solo_mode") === "true";
  };

  const getInitialOnAir = () => {
    return localStorage.getItem("studio_on_air") || null;
  };


  // =========================
  // CORE STATE
  // =========================
  const [connected, setConnected] = useState(false);
  const [reporters, setReporters] = useState({});

  const [selectedReporter, setSelectedReporter] = useState(null);

  const [masterMute, setMasterMute] = useState(false);

    const [soloMode, setSoloMode] = useState(() =>
    localStorage.getItem("studio_solo_mode") === "true"
    );

    const [onAirId, setOnAirId] = useState(() =>
    localStorage.getItem("studio_on_air")
    );

    const [outputRoute, setOutputRoute] = useState(() =>
    localStorage.getItem("studio_output_route")
    );

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const meterSmoothRef = useRef(0);

  const peerRef = useRef(null);

  const audioElementRef = useRef(null);

  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);

  const [gain, setGain] = useState(100);
  const [muted, setMuted] = useState(false);

  const [devices, setDevices] = useState([]);
  const [outputDevice, setOutputDevice] = useState("");

  const [audioTick, setAudioTick] = useState(0);

  // =========================
    // JOIN STUDIO ROOM
    // =========================
    useEffect(() => {

    socket.emit("join-studio");

    }, []);

    useEffect(() => {
    localStorage.setItem("studio_solo_mode", soloMode);
    }, [soloMode]);

    useEffect(() => {
        if (onAirId)
            localStorage.setItem("studio_on_air", onAirId);
        else
            localStorage.removeItem("studio_on_air");
        }, [onAirId]);

    useEffect(() => {
        if (outputRoute)
            localStorage.setItem("studio_output_route", outputRoute);
        else
            localStorage.removeItem("studio_output_route");
        }, [outputRoute]);

  // =========================
  // SOCKET CORE
  // =========================
  useEffect(() => {

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onAudioStatus = (data) => {

  if (!data?.code) return;

  const id = data.code;

  setReporters(prev => {

    const existing = prev[id] || {};

    return {
      ...prev,

      [id]: {
        ...existing,

        id,
        code: id,
        name: data.name || existing.name || id,

        level: data.level ?? 0,

        transmitting: !!data.transmitting,

        connected: true,

        lastSeen: Date.now()
      }
    };
  });
};

    const onStudioCommand = (cmd) => {
      if (!cmd?.type) return;

      switch (cmd.type) {

        case "MUTE_ALL":
            setMasterMute(true);
            break;

        case "UNMUTE_ALL":
            setMasterMute(false);
            break;

        case "SOLO":
            setSoloMode(true);
            setOnAirId(cmd.target);
            break;

        case "SOLO_OFF":
            setSoloMode(false);
            setOnAirId(null);
            break;

        case "ROUTE_OUTPUT":
            setOutputRoute(cmd.target);
            break;

        case "PANIC_CUT":
            setMasterMute(true);
            setSoloMode(false);
            setOnAirId(null);
            break;
        }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("audio-status", onAudioStatus);
    socket.on("studio-command", onStudioCommand);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("audio-status", onAudioStatus);
      socket.off("studio-command", onStudioCommand);
    };

  }, []);

  // =========================
// WEBRTC AUDIO RECEIVER
// =========================
useEffect(() => {

  socket.on(
    "webrtc-offer",
    async ({
      offer,
      reporterId
    }) => {

      console.log(
        "Incoming audio stream:",
        reporterId
      );

      const peer =
        new RTCPeerConnection({

          iceServers: [
            {
              urls:
                "stun:stun.l.google.com:19302"
            }
          ]

        });

      peerRef.current = peer;

peer.ontrack = (event) => {
  console.log("TRACK RECEIVED");

  const stream = event.streams[0];

  const ctx = audioContextRef.current;
  const masterGain = gainNodeRef.current;

  // =========================
  // FALLBACK MODE (NO AUDIO CONTEXT)
  // =========================
  if (!ctx || !masterGain) {
    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.play().catch(console.warn);
    return;
  }

  // =========================
  // STABLE CHANNEL KEY (IMPORTANT FIX)
  // =========================
  const trackId =
    stream.id ||
    stream.getAudioTracks?.()?.[0]?.id;

  if (!trackId) {
    console.warn("No track ID found");
    return;
  }

  // =========================
  // INIT STORAGE
  // =========================
  if (!sourceNodeRef.current) {
    sourceNodeRef.current = {};
  }

  // =========================
  // PREVENT DUPLICATES
  // =========================
  if (sourceNodeRef.current[trackId]) {
    console.log("Duplicate stream ignored:", trackId);
    return;
  }

  // =========================
  // CREATE AUDIO CHAIN
  // =========================
  const source = ctx.createMediaStreamSource(stream);

const channelGain = ctx.createGain();
channelGain.gain.value = 1;

// 🎯 NEW: PER TRACK ANALYSER (THIS IS THE REAL FIX)
const trackAnalyser = ctx.createAnalyser();
trackAnalyser.fftSize = 1024;

// safety limiter
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -10;
limiter.ratio.value = 6;
limiter.knee.value = 20;
limiter.attack.value = 0.003;
limiter.release.value = 0.25;

// AUDIO CHAIN (CORRECT ORDER)
source
  .connect(channelGain)
  .connect(trackAnalyser)
  .connect(limiter)
  .connect(gainNodeRef.current.preGain);

  // =========================
  // STORE CHANNEL
  // =========================
 sourceNodeRef.current[trackId] = {
   source,
   gain: channelGain,
   analyser: trackAnalyser,
   limiter,
   stream
 };

  // =========================
  // AUDIO ROUTING
  // =========================
    source
    .connect(channelGain)
    .connect(limiter)
    .connect(gainNodeRef.current.preGain) // this is now masterBus (OK)

  console.log("Audio channel added:", trackId);
};

      // =========================
      // SEND ICE BACK
      // =========================
      peer.onicecandidate =
        (event) => {

          if (event.candidate) {

            socket.emit(
              "ice-candidate",
              {
                target:
                  reporterId,

                candidate:
                  event.candidate
              }
            );

          }

        };

      // =========================
      // APPLY OFFER
      // =========================
      await peer.setRemoteDescription(
        new RTCSessionDescription(
          offer
        )
      );

      // =========================
      // CREATE ANSWER
      // =========================
      const answer =
        await peer.createAnswer();

      await peer.setLocalDescription(
        answer
      );

      // =========================
      // SEND ANSWER
      // =========================
      socket.emit(
        "webrtc-answer",
        {
          reporterId,
          answer
        }
      );

    }
  );

  return () => {

    socket.off(
      "webrtc-offer"
    );

  };

}, []);

useEffect(() => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  let unlocked = false;

  const unlockAudio = async () => {
    if (unlocked) return;

    try {
      let ctx = audioContextRef.current;

      // =========================
      // CREATE CONTEXT IF MISSING
      // =========================
      if (!ctx) {
        ctx = new AudioContext();
        audioContextRef.current = ctx;
      }

      // =========================
      // RESUME CONTEXT
      // =========================
      if (ctx.state !== "running") {
        await ctx.resume();
      }

      // =========================
      // iOS / Safari HARD UNLOCK TRICK
      // =========================
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);

      // =========================
      // MARK UNLOCKED
      // =========================
      unlocked = true;

      console.log("🔓 AUDIO SYSTEM FULLY UNLOCKED");

      // optional: emit event for system readiness
      socket.emit?.("audio-unlocked");

    } catch (err) {
      console.warn("Audio unlock failed:", err);
    }
  };

  // =========================
  // MULTI-TRIGGER UNLOCK (REAL-WORLD SAFE)
  // =========================
  const events = ["click", "touchstart", "keydown", "pointerdown"];

  events.forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { once: true });
  });

  return () => {
    events.forEach((evt) => {
      window.removeEventListener(evt, unlockAudio);
    });
  };
}, []);

useEffect(() => {
  const channels = sourceNodeRef.current;
  if (!channels) return;

  for (const id in channels) {
    const ch = channels[id];
    if (!ch?.gain) continue;

    const isSolo = soloMode && onAirId === id;
    const isRoute = outputRoute && outputRoute === id;

    let active = false;

    // priority system (clean override chain)
    if (masterMute) {
    active = false;

    } else if (soloMode && onAirId) {
    active = id === onAirId;

    } else if (outputRoute) {
    active = id === outputRoute;

    } else {
    active = true;
    }

    ch.gain.gain.value = active ? 1 : 0;
  }
}, [soloMode, onAirId, outputRoute, masterMute, reporters]);

// =========================
// RECEIVE ICE
// =========================
useEffect(() => {

  socket.on(
    "ice-candidate",
    async ({ candidate }) => {

      if (!peerRef.current)
        return;

      try {

        await peerRef.current
          .addIceCandidate(
            new RTCIceCandidate(
              candidate
            )
          );

      } catch (err) {

        console.error(
          "ICE ERROR:",
          err
        );

      }

    }
  );

  return () => {

    socket.off(
      "ice-candidate"
    );

  };

}, []);

  // =========================
  // CLEAN DEAD REPORTERS
  // =========================
  useEffect(() => {
    const interval = setInterval(() => {

      const now = Date.now();

      setReporters(prev => {
        const next = { ...prev };
        let changed = false;

        for (const id in next) {
          if (now - next[id].lastSeen > 6000) {
            delete next[id];
            changed = true;
          }
        }

        return changed ? next : prev;
      });

    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // =========================
  // LIST
  // =========================
  const reporterList = useMemo(
    () => Object.values(reporters),
    [reporters]
  );

  // =========================
  // ACTIVE SOURCE LOGIC (UPGRADED PRIORITY ENGINE)
  // =========================
  const fallbackActive = useMemo(() => {
    if (!reporterList.length) return null;

    return reporterList.reduce((best, r) => {
      const bestLevel = best?.level || 0;
      const rLevel = r?.level || 0;
      return rLevel > bestLevel ? r : best;
    }, reporterList[0]);

  }, [reporterList]);

  const activeReporter = useMemo(() => {

    // 1. SOLO OVERRIDE
    if (soloMode && onAirId && reporters[onAirId]) {
      return reporters[onAirId];
    }

    // 2. MANUAL ROUTE OVERRIDE (NEW FEATURE)
    if (outputRoute && reporters[outputRoute]) {
      return reporters[outputRoute];
    }

    // 3. AUTO MIX
    return fallbackActive;

  }, [soloMode, onAirId, outputRoute, reporters, fallbackActive]);

  const masterLevel = useMemo(() => {
  if (masterMute) return 0;

  const channels = sourceNodeRef.current;
  if (!channels) return 0;

  let sum = 0;
  let count = 0;

  for (const id in channels) {
    const ch = channels[id];

    if (!ch?.gain) continue;

    const level = reporters[id]?.level || 0;

    const gainValue = ch.gain.gain.value;

    sum += level * gainValue;
    count++;
  }

  return count ? sum / count : 0;
}, [reporters, soloMode, onAirId, outputRoute, masterMute]);

  // =========================
  // SYSTEM STATS
  // =========================
  const systemState = useMemo(() => {
    const list = reporterList;

    return {
      count: list.length,
      maxLevel: list.length
        ? Math.max(...list.map(r => r.level || 0))
        : 0,
      avgLevel: list.length
        ? list.reduce((a, b) => a + (b.level || 0), 0) / list.length
        : 0
    };

  }, [reporterList]);

  // =========================
  // CANVAS ENGINE
  // =========================
  useEffect(() => {

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const draw = () => {

      meterSmoothRef.current +=
        (masterLevel - meterSmoothRef.current) * 0.12;

      const level = meterSmoothRef.current;

      ctx.fillStyle = "#050505";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // grid
      ctx.strokeStyle = "#1a1a1a";
      for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * (canvas.height / 10));
        ctx.lineTo(canvas.width, i * (canvas.height / 10));
        ctx.stroke();
      }

      // meter
      const width = (level / 100) * canvas.width;

      ctx.fillStyle =
        level > 85 ? "#ef4444" :
        level > 60 ? "#facc15" :
        "#22c55e";

      ctx.fillRect(0, 0, width, canvas.height);

      // label
      if (activeReporter?.id) {
        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.fillText(
          `ON AIR: ${activeReporter?.name || activeReporter?.code}`,
          10,
          20
        );
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(rafRef.current);

  }, []);

useEffect(() => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();

  // =========================
  // AUTOPLAY UNLOCK (SAFE START)
  // =========================
  const unlock = () => ctx.resume();
  window.addEventListener("click", unlock, { once: true });

  // =========================
  // 🎛 CORE AUDIO BUSSES
  // =========================
  const preGain = ctx.createGain();
  const programGain = ctx.createGain();
  const cueGain = ctx.createGain();

  preGain.gain.value = 1;
  programGain.gain.value = 1;
  cueGain.gain.value = 0; // IMPORTANT: cue is OFF by default

  // =========================
  // 🔴 BROADCAST LIMITER
  // =========================
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 24;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;

  // =========================
  // 📡 OUTPUT DESTINATION
  // =========================
  const destination = ctx.createMediaStreamDestination();

  // =========================
  // AUDIO FLOW (CORRECT BROADCAST ARCHITECTURE)
  // =========================

  // MAIN PROGRAM PATH
  preGain
    .connect(programGain)
    .connect(limiter)
    .connect(analyser)
    .connect(destination);

  // speakers (program output)
  limiter.connect(ctx.destination);

  // cue monitor (isolated preview path)
  preGain.connect(cueGain);
  cueGain.connect(ctx.destination);

  // =========================
  // STORE REFS (CLEAN + USABLE)
  // =========================
  audioContextRef.current = ctx;

  gainNodeRef.current = {
    preGain,
    programGain,
    limiter,
    cueGain,
    destination
  };

  // =========================
  // STREAM OUTPUT (for WebRTC / broadcast)
  // =========================
  const streamAudio = new Audio();
  streamAudio.autoplay = true;
  streamAudio.srcObject = destination.stream;

  audioElementRef.current = streamAudio;

  // DO NOT append to DOM in production (prevents echo bugs)

  return () => {
    window.removeEventListener("click", unlock);
    ctx.close();
  };
}, []);

useEffect(() => {
  const loadDevices = async () => {
    const list = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = list.filter(d => d.kind === "audiooutput");
    setDevices(audioOutputs);
  };

  loadDevices();
  navigator.mediaDevices.addEventListener("devicechange", loadDevices);

  return () => {
    navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
  };
}, []);

// =========================
// STUDIO COMMANDS (UPGRADED)
// =========================

const muteAll = () => {
  setMasterMute(true);

  socket.emit("studio-command", {
    type: "MUTE_ALL"
  });
};

const unmuteAll = () => {
  setMasterMute(false);

  socket.emit("studio-command", {
    type: "UNMUTE_ALL"
  });
};

const solo = (code) => {
  setSelectedReporter(code);
  setSoloMode(true);
  setOnAirId(code);

  socket.emit("studio-command", {
    type: "SOLO",
    target: code
  });
};

const clearSolo = () => {
  setSoloMode(false);
  setOnAirId(null);

  socket.emit("studio-command", {
    type: "SOLO_OFF"
  });
};

const panicCut = () => {
  setMasterMute(true);
  setSoloMode(false);
  setOnAirId(null);
  setOutputRoute(null);

  socket.emit("studio-command", {
    type: "PANIC_CUT"
  });
};

// =========================
// OUTPUT DEVICE ROUTING (UPGRADED)
// =========================
const changeOutputDevice = async (deviceId) => {
  if (!audioElementRef.current) return;

  try {
    await audioElementRef.current.setSinkId(deviceId);
    setOutputDevice(deviceId);

    console.log("Output device switched:", deviceId);
  } catch (err) {
    console.warn("Output device switch failed:", err);
  }
};

 // =========================
// UI
// =========================
return (
  <div className="min-h-screen bg-black text-white p-6">

    {/* HEADER */}
    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">


      <div>

        <h1 className="text-3xl font-bold tracking-tight">
          🎛 Studio Control Room
        </h1>

        <div className="text-sm text-zinc-400 mt-1">
          Reporters: {systemState.count} •
          Avg: {systemState.avgLevel.toFixed(1)}% •
          Peak: {systemState.maxLevel.toFixed(0)}%
        </div>

        <div className="text-xs text-blue-300 mt-2">
          Output Routed To: {outputRoute || "AUTO MIX"}
        </div>

      </div>

      <div
        className={`px-4 py-2 rounded-xl font-semibold shadow-lg ${
          connected
            ? "bg-green-600"
            : "bg-red-600"
        }`}
      >
        {connected ? "LIVE" : "OFFLINE"}
      </div>

    </div>

    {/* GRID */}
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

      {/* SOURCES */}
      <div className="bg-zinc-900 p-4 rounded-2xl border border-zinc-800 shadow-lg">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-4">

          <div>

            <h2 className="text-lg font-bold text-white">
              Sources
            </h2>

            <p className="text-xs text-zinc-400">
              Connected reporters & live routing
            </p>

          </div>

          {soloMode && (
            <button
              type="button"
              onClick={clearSolo}
              className="text-xs px-3 py-1 rounded bg-red-500 hover:bg-red-600 transition"
            >
              Exit SOLO
            </button>
          )}

        </div>

        {/* EMPTY STATE */}
        {reporterList.length === 0 && (
          <div className="bg-zinc-800 rounded-xl p-4 text-center text-zinc-400 text-sm">
            No reporters connected
          </div>
        )}

        {/* REPORTERS */}
        <div className="space-y-3">

          {reporterList.map((r) => {

            const isActive =
            (soloMode && onAirId === r.code) ||
            (!soloMode && outputRoute === r.code);
            const isOnline = r.connected;
            const isTransmitting = r.transmitting;
            const level = Math.round(r.level || 0);

            return (

              <div
                key={r.code}
                onClick={() => solo(r.code)}
                className={`rounded-xl p-4 cursor-pointer border transition-all duration-200 select-none ${
                  isActive
                    ? "bg-green-600 border-green-400 shadow-lg shadow-green-900/30"
                    : "bg-zinc-800 border-zinc-700 hover:bg-zinc-700"
                }`}
              >

                {/* TOP */}
                <div className="flex items-start justify-between gap-3">

                  <div className="min-w-0">

                    <div className="font-semibold text-white truncate">
                      {r.name || r.code}
                    </div>

                    <div className="text-[11px] text-zinc-300 mt-1">
                      ID: {r.code}
                    </div>

                  </div>

                  <div className="text-right">

                    <div className="text-sm font-bold text-white">
                      {level}%
                    </div>

                    <div className="text-[10px] text-zinc-300">
                      LEVEL
                    </div>

                  </div>

                </div>

                {/* AUDIO BAR */}
                <div className="mt-3 h-2 bg-black/40 rounded overflow-hidden">

                  <div
                    className={`h-full transition-all duration-100 ${
                      level > 80
                        ? "bg-red-500"
                        : level > 50
                        ? "bg-yellow-400"
                        : "bg-green-400"
                    }`}
                    style={{
                      width: `${Math.min(level, 100)}%`
                    }}
                  />

                </div>

                {/* CONTROLS */}
                <div className="flex items-center justify-between mt-4 gap-2">

                  {/* ROUTE BUTTON */}
                  <button
                    type="button"
                    onClick={(e) => {
                    e.stopPropagation();

                    setOutputRoute(r.code);

                    socket.emit("studio-command", {
                        type: "ROUTE_OUTPUT",
                        target: r.code
                    });
                    }}
                    className={`text-[11px] px-3 py-1.5 rounded-lg transition font-medium ${
                      outputRoute === r.code
                        ? "bg-blue-500 hover:bg-blue-600"
                        : "bg-zinc-700 hover:bg-zinc-600"
                    }`}
                  >
                    {outputRoute === r.code
                      ? "ROUTED"
                      : "ROUTE"}
                  </button>

                  {/* ON AIR */}
                  {isActive && (
                    <div className="text-[10px] px-2 py-1 rounded bg-black/30 text-white">
                      ON AIR
                    </div>
                  )}

                </div>

                {/* STATUS */}
                <div className="grid grid-cols-3 gap-2 mt-4 text-[10px]">

                  <div className="bg-black/20 rounded p-2 text-center">

                    <div className="text-zinc-400">
                      STATUS
                    </div>

                    <div className={isOnline ? "text-green-300" : "text-red-300"}>
                      {isOnline ? "ONLINE" : "OFFLINE"}
                    </div>

                  </div>

                  <div className="bg-black/20 rounded p-2 text-center">

                    <div className="text-zinc-400">
                      TX
                    </div>

                    <div className={isTransmitting ? "text-green-300" : "text-yellow-300"}>
                      {isTransmitting ? "LIVE" : "IDLE"}
                    </div>

                  </div>

                  <div className="bg-black/20 rounded p-2 text-center">

                    <div className="text-zinc-400">
                      OUTPUT
                    </div>

                    <div className={isActive ? "text-green-300" : "text-zinc-300"}>
                      {isActive ? "MASTER" : "STBY"}
                    </div>

                  </div>

                </div>

              </div>
            );
          })}

        </div>

      </div>

      {/* MASTER */}
      <div className="lg:col-span-3 bg-zinc-900 p-6 rounded-2xl border border-zinc-800 shadow-lg">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-6">

          <div>

            <h2 className="text-xl font-bold text-white">
              Master Output
            </h2>

            <p className="text-xs text-zinc-400 mt-1">
              Live mixed program feed
            </p>

          </div>

          <div className="flex items-center gap-2">

            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />

            <span className="text-xs text-red-400 font-semibold">
              LIVE
            </span>

          </div>

        </div>

        {/* MASTER GAIN CONTROL */}
        <div className="mt-4 bg-zinc-800 p-4 rounded-xl border border-zinc-700">

        <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-zinc-400">
            MASTER GAIN
            </div>

            <div className="text-xs text-zinc-400">
            {gain}%
            </div>
        </div>

        <input
            type="range"
            min="0"
            max="200"
            value={gain}
            onChange={(e) => {
            const value = Number(e.target.value);

            setGain(value);

            if (gainNodeRef.current) {
                // broadcast-safe gain curve
                gainNodeRef.current.programGain.gain.value = Math.min(
                Math.pow(value / 100, 1.4),
                2
                );
            }
            }}
            className="w-full accent-red-500"
        />

        <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
            <span>0</span>
            <span>100</span>
            <span>200</span>
        </div>
        </div>

        <button
            type="button"
            onClick={() => {
                setMuted((m) => {
                const next = !m;

                if (gainNodeRef.current) {
                    gainNodeRef.current.programGain.gain.value = next ? 0 : gain / 100;
                }

                return next;
                });
            }}
            className={`px-4 py-2 rounded-xl font-semibold transition ${
                muted ? "bg-gray-600" : "bg-red-600 hover:bg-red-700"
            }`}
            >
            {muted ? "UNMUTE MASTER" : "MUTE MASTER"}
            </button>

            {/* OUTPUT DEVICE SELECTOR */}
            <div className="mt-4 bg-zinc-800 p-4 rounded-xl border border-zinc-700">

            <div className="text-xs text-zinc-400 mb-2">
                OUTPUT DEVICE
            </div>

            <select
                value={outputDevice}
                onChange={(e) => changeOutputDevice(e.target.value)}
                className="w-full bg-black text-white p-2 rounded"
            >
                <option value="">Default Output</option>

                {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Audio Device ${d.deviceId.slice(0, 5)}`}
                </option>
                ))}
            </select>

            </div>

        {/* WAVEFORM */}
        <div className="bg-black rounded-2xl p-3 border border-zinc-800">

          <canvas
            ref={canvasRef}
            width={900}
            height={200}
            className="w-full rounded"
          />

        </div>

        {/* CONTROLS */}
        <div className="flex flex-wrap gap-3 mt-5">

          <button
            type="button"
            onClick={muteAll}
            className="bg-red-600 hover:bg-red-700 transition px-4 py-2 rounded-xl font-semibold"
          >
            MUTE ALL
          </button>

          <button
            type="button"
            onClick={unmuteAll}
            className="bg-green-600 hover:bg-green-700 transition px-4 py-2 rounded-xl font-semibold"
          >
            UNMUTE
          </button>

          <button
            type="button"
            onClick={panicCut}
            className="bg-yellow-500 hover:bg-yellow-600 transition px-4 py-2 rounded-xl font-semibold text-black"
          >
            PANIC CUT
          </button>

        </div>

        {/* STATS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">

          <div className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">

            <div className="text-xs text-zinc-400">
              ACTIVE SOURCE
            </div>

            <div className="mt-1 font-bold text-white">
              {activeReporter?.name || activeReporter?.code || "NONE"}
            </div>

          </div>

          <div className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">

            <div className="text-xs text-zinc-400">
              MIX MODE
            </div>

            <div className="mt-1 font-bold text-white">
              {soloMode ? "SOLO MODE" : "AUTO MIX"}
            </div>

          </div>

          <div className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">

            <div className="text-xs text-zinc-400">
              MASTER LEVEL
            </div>

            <div className="mt-1 font-bold text-white">
              {Math.round(masterLevel || 0)}%
            </div>

          </div>

        </div>

      </div>

    </div>

  </div>
);
}
