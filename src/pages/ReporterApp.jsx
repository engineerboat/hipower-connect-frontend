import { useState, useEffect, useRef } from "react";
import { socket } from "../socket";

export default function ReporterApp() {
  const [socketConnected, setSocketConnected] = useState(false);
  const [audioConnected, setAudioConnected] = useState(false);
  const [connected, setConnected] = useState(false);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [gain, setGain] = useState(100);
  const [muted, setMuted] = useState(false);
  const [outputs, setOutputs] = useState([]);
  const [selectedOutput, setSelectedOutput] = useState("");
  const [monitoring, setMonitoring] = useState(false);
  const [reporterCode, setReporterCode] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [isRegistered, setIsRegistered] = useState(false);
  const [leftVU, setLeftVU] = useState(0);
  const [rightVU, setRightVU] = useState(0);
  const [agcEnabled, setAgcEnabled] = useState(true);
  const [location, setLocation] = useState(null);
  const [transmitting, setTransmitting] = useState(
    localStorage.getItem("transmitting") === "true"
  );
  const [bass, setBass] = useState(0);
  const [mid, setMid] = useState(0);
  const [treble, setTreble] = useState(0);
  const [highPass, setHighPass] = useState(80);
  const [lowPass, setLowPass] = useState(18000);

  const statusIntervalRef = useRef(null);
  const levelRef = useRef(0);
  const transmittingRef = useRef(false);
  const startingRef = useRef(false);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const agcGainRef = useRef(null);
  const pttGainRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const bassRef = useRef(null);
  const midRef = useRef(null);
  const trebleRef = useRef(null);
  const highPassRef = useRef(null);
  const lowPassRef = useRef(null);
  const animationRef = useRef(null);
  const compressorRef = useRef(null);
  const userGainRef = useRef(null);
  const audioElementRef = useRef(null);
  const noiseGateRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const analyserLRef = useRef(null);
  const analyserRRef = useRef(null);
  const peerRef = useRef(null);

  // Refs so socket callbacks always read current values without stale closures
  const reporterCodeRef = useRef("");
  const reporterNameRef = useRef("");

  // =========================
  // LOAD DEVICES
  // =========================
  const loadDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const allDevices = await navigator.mediaDevices.enumerateDevices();

      const inputs = allDevices.filter(d => d.kind === "audioinput");
      setDevices(inputs);

      const outputsList = allDevices.filter(d => d.kind === "audiooutput");
      setOutputs(outputsList);

      if (outputsList.length && !selectedOutput) {
        setSelectedOutput(outputsList[0].deviceId);
      }

      const savedMic = localStorage.getItem("selectedMic");
      if (savedMic && inputs.some(d => d.deviceId === savedMic)) {
        setSelectedDevice(savedMic);
      } else if (inputs.length) {
        setSelectedDevice(inputs[0].deviceId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // =========================
  // DISCONNECT AUDIO
  // =========================
  const disconnectAudio = async () => {
    const ctx = audioContextRef.current;
    if (ctx) {
      try {
        if (ctx.state !== "closed") await ctx.close();
      } catch (err) {
        console.warn("AudioContext close failed:", err);
      }
    }
    audioContextRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    analyserRef.current = null;
    analyserLRef.current = null;
    analyserRRef.current = null;

    setSocketConnected(false);
    setAudioConnected(false);
    setLevel(0);
  };

  // =========================
  // RECORDING CONTROLS
  // =========================
  const startRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "recording") return;
    recordedChunksRef.current = [];
    try {
      recorder.start(1000);
      console.log("⏺ RECORDING STARTED");
    } catch (err) {
      console.error("MediaRecorder start failed:", err);
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.stop();
    console.log("⏹ RECORDING STOPPED");
  };

  const downloadRecording = () => {
    const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${Date.now()}.webm`;
    a.click();
  };

  // =========================
  // START AUDIO
  // =========================
  const startAudio = async (forceDevice = selectedDevice) => {
    console.log("🔥 startAudio CALLED", forceDevice);

    if (startingRef.current) return;
    startingRef.current = true;

    try {
      // --- TEARDOWN ---
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        try {
          if (audioContextRef.current.state !== "closed") {
            await audioContextRef.current.close();
          }
        } catch (e) {
          console.warn("AudioContext close ignored:", e);
        }
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      analyserLRef.current = null;
      analyserRRef.current = null;
      agcGainRef.current = null;
      pttGainRef.current = null;
      compressorRef.current = null;
      noiseGateRef.current = null;

      // --- MIC STREAM ---
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: forceDevice ? { exact: forceDevice } : undefined }
      });
      streamRef.current = stream;

      // --- AUDIO CONTEXT ---
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx();
      await audioContext.resume();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const splitter = audioContext.createChannelSplitter(2);

      // --- ANALYSERS ---
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const analyserL = audioContext.createAnalyser();
      const analyserR = audioContext.createAnalyser();
      analyserLRef.current = analyserL;
      analyserRRef.current = analyserR;

      // --- DSP CHAIN ---
      const gate = audioContext.createDynamicsCompressor();
      gate.threshold.value = -50;
      gate.knee.value = 0;
      gate.ratio.value = 20;
      gate.attack.value = 0.001;
      gate.release.value = 0.1;
      noiseGateRef.current = gate;

      const agcGain = audioContext.createGain();
      agcGain.gain.value = 1;
      agcGainRef.current = agcGain;

      const userGain = audioContext.createGain();
      userGain.gain.value = gain / 100;
      userGainRef.current = userGain;

      const pttGain = audioContext.createGain();
      const savedTx = localStorage.getItem("transmitting") === "true";
      pttGain.gain.value = savedTx ? gain / 100 : 0;
      if (savedTx) setTransmitting(true);
      pttGainRef.current = pttGain;

      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      compressorRef.current = compressor;

      // --- FILTERS ---
      const hp = audioContext.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = highPassRef.current?.frequency?.value || 80;
      highPassRef.current = hp;

      const bassFilter = audioContext.createBiquadFilter();
      bassFilter.type = "lowshelf";
      bassFilter.frequency.value = 200;
      bassFilter.gain.value = bassRef.current?.gain?.value || 0;
      bassRef.current = bassFilter;

      const midFilter = audioContext.createBiquadFilter();
      midFilter.type = "peaking";
      midFilter.frequency.value = 1000;
      midFilter.gain.value = midRef.current?.gain?.value || 0;
      midRef.current = midFilter;

      const trebleFilter = audioContext.createBiquadFilter();
      trebleFilter.type = "highshelf";
      trebleFilter.frequency.value = 5000;
      trebleFilter.gain.value = trebleRef.current?.gain?.value || 0;
      trebleRef.current = trebleFilter;

      const lp = audioContext.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = lowPassRef.current?.frequency?.value || 18000;
      lowPassRef.current = lp;

      // --- ROUTING ---
      source.connect(gate).connect(splitter);
      splitter.connect(agcGain);
      agcGain.connect(userGain);
      userGain.connect(pttGain);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);

      pttGain
        .connect(hp)
        .connect(bassFilter)
        .connect(midFilter)
        .connect(trebleFilter)
        .connect(lp)
        .connect(compressor)
        .connect(analyser);

      const liveDestination = audioContext.createMediaStreamDestination();
      compressor.connect(liveDestination);

      const destination = audioContext.createMediaStreamDestination();
      compressor.connect(destination);

      if (audioElementRef.current) {
        audioElementRef.current.srcObject = liveDestination.stream;
      }

      // --- WEBRTC ---
      if (peerRef.current) {
        try { peerRef.current.close(); } catch {}
        peerRef.current = null;
      }

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      });
      peerRef.current = peer;

      destination.stream.getTracks().forEach(track => {
        console.log("🎤 SENDING TRACK:", track.kind, track.enabled, track.readyState);
        peer.addTrack(track, destination.stream);
      });

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", { candidate: event.candidate });
        }
      };

      peer.onconnectionstatechange = () => {
        console.log("WEBRTC STATE:", peer.connectionState);
      };

      peer.oniceconnectionstatechange = () => {
        console.log("ICE STATE:", peer.iceConnectionState);
      };

      const offer = await peer.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await peer.setLocalDescription(offer);
      socket.emit("webrtc-offer", { offer });
      console.log("📡 WEBRTC OFFER SENT");

      // --- MEDIA RECORDER ---
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(destination.stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onerror = (err) => console.error("RECORDER ERROR:", err);

      // --- LOCAL MONITORING ---
      if (monitoring) {
        compressor.connect(audioContext.destination);
      }

      // --- METER LOOP ---
      let agcLastGain = agcGainRef.current?.gain.value || 1;

      const updateMeter = () => {
        const currentAnalyser = analyserRef.current;
        if (!currentAnalyser) return;

        const freqBins = currentAnalyser.frequencyBinCount;
        const fftSize = currentAnalyser.fftSize;

        const frequencyData = new Uint8Array(freqBins);
        const timeData = new Uint8Array(fftSize);

        currentAnalyser.getByteFrequencyData(frequencyData);
        currentAnalyser.getByteTimeDomainData(timeData);

        // RMS level
        let sumSquares = 0;
        for (let i = 0; i < freqBins; i++) {
          const v = frequencyData[i] / 255;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / freqBins);
        const normalizedLevel = Math.min(100, Math.round(rms * 140));

        // UI throttle
        updateMeter._tick = (updateMeter._tick || 0) + 1;
        if (updateMeter._tick % 3 === 0) {
          levelRef.current = normalizedLevel;
          setLevel(normalizedLevel);
        }

        // AGC
        if (agcEnabled && agcGainRef.current) {
          if (normalizedLevel < 40) agcLastGain += 0.0015;
          if (normalizedLevel > 160) agcLastGain -= 0.0015;
          agcLastGain = Math.max(0.1, Math.min(agcLastGain, 3));
          agcGainRef.current.gain.value = agcLastGain;
        }

        // Stereo VU
        const L = analyserLRef.current;
        const R = analyserRRef.current;
        if (L && R) {
          const lData = new Uint8Array(L.frequencyBinCount);
          const rData = new Uint8Array(R.frequencyBinCount);
          L.getByteFrequencyData(lData);
          R.getByteFrequencyData(rData);

          let lSum = 0, rSum = 0;
          for (let i = 0; i < lData.length; i++) {
            lSum += lData[i];
            rSum += rData[i];
          }

          if (updateMeter._tick % 3 === 0) {
            setLeftVU(Math.min(100, (lSum / lData.length / 255) * 100));
            setRightVU(Math.min(100, (rSum / rData.length / 255) * 100));
          }
        } else {
          if (updateMeter._tick % 3 === 0) {
            setLeftVU(normalizedLevel);
            setRightVU(normalizedLevel);
          }
        }

        // Waveform
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.beginPath();
          const sliceWidth = canvas.width / timeData.length;
          let x = 0;
          for (let i = 0; i < timeData.length; i++) {
            const v = timeData[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.strokeStyle = transmittingRef.current ? "#ff3b30" : "#22c55e";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (audioContextRef.current?.state !== "closed") {
          animationRef.current = requestAnimationFrame(updateMeter);
        }
      };

      animationRef.current = requestAnimationFrame(updateMeter);
      setAudioConnected(true);

    } catch (err) {
      console.error("startAudio failed:", err);
    } finally {
      startingRef.current = false;
    }
  };

  // =========================
  // EFFECTS
  // =========================

  useEffect(() => { loadDevices(); }, []);

  useEffect(() => {
    if (!selectedDevice) return;
    startAudio(selectedDevice);
  }, [selectedDevice]);

  useEffect(() => {
    if (devices.length > 0 && localStorage.getItem("autoConnect") === "true") {
      startAudio();
    }
  }, [devices]);

  useEffect(() => {
    if (!audioContextRef.current || !compressorRef.current) return;
    try {
      compressorRef.current.disconnect(audioContextRef.current.destination);
    } catch {}
    if (monitoring) {
      compressorRef.current.connect(audioContextRef.current.destination);
    }
  }, [monitoring]);

  useEffect(() => {
    const el = audioElementRef.current;
    if (!el || !selectedOutput) return;
    if (typeof el.setSinkId === "function") {
      el.setSinkId(selectedOutput).catch(console.warn);
    }
  }, [selectedOutput]);

  // Push-to-talk (spacebar)
  useEffect(() => {
    const down = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      if (muted) return;
      setTransmitting(true);
      transmittingRef.current = true;
      if (pttGainRef.current) {
        pttGainRef.current.gain.cancelScheduledValues(
          audioContextRef.current?.currentTime || 0
        );
        pttGainRef.current.gain.setTargetAtTime(
          gain / 100,
          audioContextRef.current?.currentTime || 0,
          0.01
        );
      }
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      setTransmitting(false);
      transmittingRef.current = false;
      if (pttGainRef.current) {
        pttGainRef.current.gain.cancelScheduledValues(
          audioContextRef.current?.currentTime || 0
        );
        pttGainRef.current.gain.setTargetAtTime(
          0,
          audioContextRef.current?.currentTime || 0,
          0.01
        );
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [gain, muted]);

  useEffect(() => {
    console.log("STARTING SOCKET CONNECTION");
    socket.connect();
    socket.on("connect", () => console.log("SOCKET CONNECTED", socket.id));
    socket.on("disconnect", (reason) => console.log("SOCKET DISCONNECTED", reason));
    socket.on("connect_error", (err) => console.log("SOCKET ERROR", err.message));
  }, []);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(pos => {
      const gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(gps);
      socket.emit("gps-location", gps);
    });
  }, []);

  useEffect(() => {
    const offline = () => setConnected(false);
    const online = async () => {
      if (!connected) {
        await startAudio();
        setAudioConnected(true);
      }
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [connected]);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const code = reporterCodeRef.current;
      const name = reporterNameRef.current;
      console.log("REGISTERING REPORTER", code);
      if (code && name) {
        socket.emit("register-reporter", { code, name: name || "Reporter" });
        setIsRegistered(true);
      }
    };
    const onDisconnect = () => {
      setAudioConnected(false);
      setIsRegistered(false);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []); // safe: reads via refs, not stale closure

  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { transmittingRef.current = transmitting; }, [transmitting]);
  useEffect(() => { reporterCodeRef.current = reporterCode; }, [reporterCode]);
  useEffect(() => { reporterNameRef.current = reporterName; }, [reporterName]);

  useEffect(() => {
    if (!connected || !audioConnected || !reporterCodeRef.current) return;
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    statusIntervalRef.current = setInterval(() => {
      socket.emit("audio-status", {
        code: reporterCodeRef.current,
        name: reporterNameRef.current || "Reporter",
        connected: true,
        level: levelRef.current,
        transmitting: transmittingRef.current,
        timestamp: Date.now()
      });
    }, 250);
    return () => {
      if (statusIntervalRef.current) {
        clearInterval(statusIntervalRef.current);
        statusIntervalRef.current = null;
      }
    };
  }, [connected, audioConnected, reporterCode]);

  useEffect(() => {
    const saved = localStorage.getItem("isRegistered");
    const code = localStorage.getItem("reporterCode");
    const name = localStorage.getItem("reporterName");
    if (saved === "true" && code) {
      setReporterCode(code);
      setReporterName(name || "");
      setIsRegistered(true);
      socket.emit("register-reporter", { code, name: name || "Reporter" });
    }
  }, []);

  useEffect(() => {
    socket.on("webrtc-answer", async ({ answer }) => {
      if (!peerRef.current) return;
      await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    });
    return () => { socket.off("webrtc-answer"); };
  }, []);

  useEffect(() => {
    socket.on("ice-candidate", async ({ candidate }) => {
      if (!peerRef.current) return;
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error(err);
      }
    });
    return () => { socket.off("ice-candidate"); };
  }, []);

  useEffect(() => {
    console.log("REPORTER APP MOUNTED");
    console.log("SOCKET OBJECT:", socket);
  }, []);

  // =========================
  // LOGIN SCREEN
  // =========================
  if (!isRegistered) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        <div className="bg-zinc-900 p-8 rounded-2xl w-[350px] space-y-4">
          <h2 className="text-xl font-bold">Reporter Login</h2>
          <input
            placeholder="Reporter Name"
            className="w-full p-3 rounded bg-zinc-800"
            value={reporterName}
            onChange={(e) => setReporterName(e.target.value)}
          />
          <input
            placeholder="Enter Code (e.g ABC123)"
            className="w-full p-3 rounded bg-zinc-800"
            value={reporterCode}
            onChange={(e) => setReporterCode(e.target.value.toUpperCase())}
          />
          <button
            className="w-full bg-green-600 py-3 rounded font-bold"
            onClick={() => {
              if (!reporterCode) return;
              socket.emit("register-reporter", { code: reporterCode, name: reporterName });
              setIsRegistered(true);
              localStorage.setItem("reporterCode", reporterCode);
              localStorage.setItem("reporterName", reporterName);
              localStorage.setItem("isRegistered", "true");
            }}
          >
            Enter Studio
          </button>
        </div>
      </div>
    );
  }

  // =========================
  // MAIN UI
  // =========================
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-black to-zinc-900 text-white">
      <audio ref={audioElementRef} autoPlay style={{ display: "none" }} />

      {/* Header */}
      <div className="border-b border-zinc-800 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="/logo.png" alt="HI-Power" className="w-12 h-12 rounded-xl object-cover bg-zinc-800" />
            <div>
              <h1 className="font-bold text-xl">HI-Power Connect</h1>
              <p className="text-zinc-400 text-sm">Reporter Broadcast Console</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className={`px-4 py-2 rounded-full text-xs font-semibold border ${
              connected
                ? "bg-green-500/10 border-green-500 text-green-400"
                : "bg-red-500/10 border-red-500 text-red-400"
            }`}>
              {connected ? "● LIVE SYSTEM" : "● OFFLINE"}
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${audioConnected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
              <span className="text-xs text-zinc-300">{audioConnected ? "Mic Active" : "Mic Off"}</span>
            </div>
            <div className="text-xs text-zinc-400 max-w-[160px] truncate">
              🎤 {devices.find(d => d.deviceId === selectedDevice)?.label || "No Mic Selected"}
            </div>
            <div className="w-24 h-2 bg-zinc-800 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-150"
                style={{ width: `${level}%`, background: "linear-gradient(90deg,#22c55e,#eab308,#ef4444)" }}
              />
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${transmitting ? "bg-red-500 animate-pulse" : "bg-zinc-600"}`} />
              <span className="text-xs text-zinc-400">{transmitting ? "ON AIR" : "STANDBY"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Left Panel */}
          <div className="lg:col-span-2 space-y-6">

            {/* Audio Meter */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <div className="flex justify-between mb-3">
                <span className="text-zinc-400">AUDIO INPUT LEVEL</span>
                <span className="font-bold">{level}%</span>
              </div>
              <div className="h-5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-150"
                  style={{ width: `${level}%`, background: "linear-gradient(90deg,#00ff88,#ffd500,#ff3b30)" }}
                />
              </div>
              <div className="mt-8">
                <canvas
                  ref={canvasRef}
                  width={1200}
                  height={250}
                  className="w-full h-44 rounded-2xl bg-black border border-zinc-800"
                />
              </div>
              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-1">LEFT</div>
                  <div className="h-4 bg-zinc-800 rounded">
                    <div className="h-full bg-green-500" style={{ width: `${leftVU}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-1">RIGHT</div>
                  <div className="h-4 bg-zinc-800 rounded">
                    <div className="h-full bg-green-500" style={{ width: `${rightVU}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Broadcast Controls */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h2 className="text-xl font-semibold mb-5">Broadcast Controls</h2>
              <div className="grid md:grid-cols-2 gap-4">

                <button
                  onClick={async () => {
                    if (connected) return;
                    await startAudio();
                    localStorage.setItem("autoConnect", "true");
                  }}
                  className="py-4 rounded-2xl font-bold text-black bg-gradient-to-r from-green-400 to-green-600 hover:scale-[1.02] transition"
                >
                  CONNECT & GO LIVE
                </button>

                <button
                  onClick={disconnectAudio}
                  className="py-4 rounded-2xl font-bold bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition"
                >
                  DISCONNECT
                </button>

                <button
                  onClick={() => {
                    const nextMuted = !muted;
                    setMuted(nextMuted);
                    if (pttGainRef.current) {
                      pttGainRef.current.gain.cancelScheduledValues(
                        audioContextRef.current?.currentTime || 0
                      );
                      if (nextMuted) {
                        pttGainRef.current.gain.setTargetAtTime(
                          0, audioContextRef.current?.currentTime || 0, 0.01
                        );
                      } else if (transmittingRef.current) {
                        pttGainRef.current.gain.setTargetAtTime(
                          gain / 100, audioContextRef.current?.currentTime || 0, 0.01
                        );
                      }
                    }
                  }}
                  className={`py-4 rounded-2xl font-bold transition-all duration-200 border ${
                    muted
                      ? "bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-lg shadow-red-500/30"
                      : "bg-yellow-600 hover:bg-yellow-500 border-yellow-400 text-black"
                  }`}
                >
                  {muted ? "🔇 MUTED" : "🔊 LIVE AUDIO"}
                </button>

                <button
                  onClick={() => setMonitoring(!monitoring)}
                  className="py-4 rounded-2xl font-bold bg-blue-600 hover:bg-blue-500"
                >
                  {monitoring ? "MONITOR ON" : "MONITOR OFF"}
                </button>

                <button
                  onClick={() => {
                    if (muted) return;
                    const next = !transmitting;
                    setTransmitting(next);
                    transmittingRef.current = next;
                    localStorage.setItem("transmitting", next);
                    if (pttGainRef.current) {
                      pttGainRef.current.gain.cancelScheduledValues(
                        audioContextRef.current?.currentTime || 0
                      );
                      pttGainRef.current.gain.setTargetAtTime(
                        next ? gain / 100 : 0,
                        audioContextRef.current?.currentTime || 0,
                        0.01
                      );
                    }
                  }}
                  className={`py-8 rounded-2xl font-bold text-xl transition-all ${
                    transmitting ? "bg-red-500 animate-pulse" : "bg-red-700"
                  }`}
                >
                  {transmitting ? "🔴 TRANSMITTING" : "🎙 CLICK TO TALK"}
                </button>

                <button
                  onClick={startRecording}
                  disabled={!connected}
                  className="py-4 px-6 rounded-2xl font-bold bg-red-600 hover:bg-red-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ⏺ RECORD
                </button>

                <button
                  onClick={stopRecording}
                  disabled={!connected}
                  className="py-4 px-6 rounded-2xl font-bold bg-yellow-600 hover:bg-yellow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ⏹ STOP
                </button>

                <button
                  onClick={downloadRecording}
                  disabled={!connected}
                  className="py-4 px-6 rounded-2xl font-bold bg-green-600 hover:bg-green-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ⬇ DOWNLOAD
                </button>

              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-6">

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-4">Microphone Source</h3>
              <select
                value={selectedDevice}
                onChange={(e) => {
                  setSelectedDevice(e.target.value);
                  localStorage.setItem("selectedMic", e.target.value);
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3"
              >
                {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || "Microphone"}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-4">Output Device</h3>
              <select
                value={selectedOutput}
                onChange={(e) => setSelectedOutput(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3"
              >
                {outputs.map(output => (
                  <option key={output.deviceId} value={output.deviceId}>
                    {output.label || "Output"}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-4">Input Gain</h3>
              <input
                type="range"
                disabled={agcEnabled}
                min="0"
                max="200"
                value={gain}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setGain(value);
                  if (userGainRef.current) {
                    userGainRef.current.gain.value = value / 100;
                  }
                }}
                className="w-full"
              />
              <div className="mt-2 text-sm text-zinc-400">{gain}%</div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-6">Audio Processor</h3>
              <div className="space-y-5">

                <div className="flex items-center justify-between">
                  <span>Automatic Gain Control</span>
                  <button
                    onClick={() => setAgcEnabled(!agcEnabled)}
                    className={`px-4 py-2 rounded-xl ${agcEnabled ? "bg-green-600" : "bg-zinc-700"}`}
                  >
                    {agcEnabled ? "ON" : "OFF"}
                  </button>
                </div>

                <div>
                  <label>Bass ({bass} dB)</label>
                  <input type="range" min="-15" max="15" value={bass}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setBass(value);
                      if (bassRef.current) bassRef.current.gain.value = value;
                    }}
                    className="w-full"
                  />
                </div>

                <div>
                  <label>Mid ({mid} dB)</label>
                  <input type="range" min="-15" max="15" value={mid}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setMid(value);
                      if (midRef.current) midRef.current.gain.value = value;
                    }}
                    className="w-full"
                  />
                </div>

                <div>
                  <label>Treble ({treble} dB)</label>
                  <input type="range" min="-15" max="15" value={treble}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setTreble(value);
                      if (trebleRef.current) trebleRef.current.gain.value = value;
                    }}
                    className="w-full"
                  />
                </div>

                <div>
                  <label>High Pass ({highPass} Hz)</label>
                  <input type="range" min="20" max="300" value={highPass}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setHighPass(value);
                      if (highPassRef.current) highPassRef.current.frequency.value = value;
                    }}
                    className="w-full"
                  />
                </div>

                <div>
                  <label>Low Pass ({lowPass} Hz)</label>
                  <input type="range" min="1000" max="20000" value={lowPass}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setLowPass(value);
                      if (lowPassRef.current) lowPassRef.current.frequency.value = value;
                    }}
                    className="w-full"
                  />
                </div>

              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-4">Connection Status</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Network</span>
                  <span>Excellent</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Latency</span>
                  <span>23 ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Audio Codec</span>
                  <span>Opus</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Bitrate</span>
                  <span>128 kbps</span>
                </div>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold mb-4">GPS Location</h3>
                {location ? (
                  <div className="space-y-2 text-sm">
                    <div>Latitude: {location.lat}</div>
                    <div>Longitude: {location.lng}</div>
                  </div>
                ) : (
                  <div className="text-sm text-zinc-400">Acquiring GPS...</div>
                )}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
              <h3 className="font-semibold mb-4">Reporter Notes</h3>
              <textarea
                rows={6}
                placeholder="Write live notes here..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 resize-none"
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
