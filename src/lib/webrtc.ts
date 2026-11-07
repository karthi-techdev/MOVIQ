import { ICE_SERVERS } from "./constants";
import { socketClient } from "./socketClient";

export interface VoiceCallbacks {
  onSpeakingChange?: (isSpeaking: boolean) => void;
  onVoiceStateChange?: (inVoice: boolean, isMuted: boolean) => void;
  onError?: (err: string) => void;
}

export class VoiceManager {
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: NodeJS.Timeout | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private audioContainer: HTMLElement | null = null;

  public inVoice: boolean = false;
  public isMuted: boolean = true;
  public isSpeaking: boolean = false;
  private callbacks: VoiceCallbacks;

  constructor(callbacks: VoiceCallbacks = {}) {
    this.callbacks = callbacks;
    this.setupSocketListeners();
  }

  public setAudioContainer(container: HTMLElement) {
    this.audioContainer = container;
  }

  private setupSocketListeners() {
    socketClient.on("voice-peers", async (msg: { peers: string[] }) => {
      if (!this.inVoice || !this.localStream) return;
      for (const peerId of msg.peers) {
        await this.createPeerConnection(peerId, true);
      }
    });

    socketClient.on("voice-peer-joined", async (msg: { userId: string }) => {
      if (!this.inVoice || !this.localStream) return;
      await this.createPeerConnection(msg.userId, false);
    });

    socketClient.on("voice-peer-left", (msg: { userId: string }) => {
      this.closePeer(msg.userId);
    });

    socketClient.on("webrtc-offer", async (msg: { from: string; offer: RTCSessionDescriptionInit }) => {
      if (!this.inVoice || !this.localStream) return;
      let peer = this.peers.get(msg.from);
      if (!peer) {
        peer = await this.createPeerConnection(msg.from, false);
      }
      try {
        await peer.setRemoteDescription(new RTCSessionDescription(msg.offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socketClient.send({
          type: "webrtc-answer",
          target: msg.from,
          answer
        });
      } catch (err) {
        console.error("WebRTC offer error:", err);
      }
    });

    socketClient.on("webrtc-answer", async (msg: { from: string; answer: RTCSessionDescriptionInit }) => {
      const peer = this.peers.get(msg.from);
      if (peer) {
        try {
          await peer.setRemoteDescription(new RTCSessionDescription(msg.answer));
        } catch (err) {
          console.error("WebRTC answer error:", err);
        }
      }
    });

    socketClient.on("webrtc-ice", async (msg: { from: string; candidate: RTCIceCandidateInit }) => {
      const peer = this.peers.get(msg.from);
      if (peer && msg.candidate) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (err) {
          console.error("WebRTC candidate error:", err);
        }
      }
    });
  }

  public async joinVoice(): Promise<void> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.inVoice = true;
      this.isMuted = false;
      this.updateTrackState();

      this.setupVAD(this.localStream);
      socketClient.send({ type: "voice-join" });

      if (this.callbacks.onVoiceStateChange) {
        this.callbacks.onVoiceStateChange(this.inVoice, this.isMuted);
      }
    } catch (err: any) {
      this.inVoice = false;
      if (this.callbacks.onError) {
        this.callbacks.onError(err.message || "Microphone access denied.");
      }
      throw err;
    }
  }

  public leaveVoice() {
    if (!this.inVoice) return;
    this.inVoice = false;
    this.isMuted = true;
    this.isSpeaking = false;

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.peers.forEach((peer) => peer.close());
    this.peers.clear();

    if (this.audioContainer) {
      this.audioContainer.innerHTML = "";
    }

    socketClient.send({ type: "voice-leave" });

    if (this.callbacks.onVoiceStateChange) {
      this.callbacks.onVoiceStateChange(this.inVoice, this.isMuted);
    }
    if (this.callbacks.onSpeakingChange) {
      this.callbacks.onSpeakingChange(false);
    }
  }

  public toggleMute(): boolean {
    if (!this.inVoice) return true;
    this.isMuted = !this.isMuted;
    this.updateTrackState();

    socketClient.send({
      type: "voice-state",
      muted: this.isMuted,
      speaking: false
    });

    if (this.callbacks.onVoiceStateChange) {
      this.callbacks.onVoiceStateChange(this.inVoice, this.isMuted);
    }
    return this.isMuted;
  }

  private updateTrackState() {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    }
  }

  private setupVAD(stream: MediaStream) {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      let speakingFrames = 0;

      this.vadInterval = setInterval(() => {
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.broadcastSpeaking(false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        if (avg > 18) {
          speakingFrames = Math.min(speakingFrames + 1, 10);
        } else {
          speakingFrames = Math.max(speakingFrames - 1, 0);
        }

        const nowSpeaking = speakingFrames >= 3;
        if (nowSpeaking !== this.isSpeaking) {
          this.isSpeaking = nowSpeaking;
          this.broadcastSpeaking(nowSpeaking);
        }
      }, 100);
    } catch (e) {
      console.warn("Could not setup VAD:", e);
    }
  }

  private broadcastSpeaking(speaking: boolean) {
    socketClient.send({
      type: "speaking",
      speaking
    });
    if (this.callbacks.onSpeakingChange) {
      this.callbacks.onSpeakingChange(speaking);
    }
  }

  private async createPeerConnection(peerId: string, isInitiator: boolean): Promise<RTCPeerConnection> {
    this.closePeer(peerId);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(peerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketClient.send({
          type: "webrtc-ice",
          target: peerId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      let audioEl = document.getElementById(`audio-peer-${peerId}`) as HTMLAudioElement | null;
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.id = `audio-peer-${peerId}`;
        audioEl.autoplay = true;
        if (this.audioContainer) {
          this.audioContainer.appendChild(audioEl);
        } else {
          document.body.appendChild(audioEl);
        }
      }
      audioEl.srcObject = event.streams[0];
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketClient.send({
          type: "webrtc-offer",
          target: peerId,
          offer
        });
      } catch (err) {
        console.error("Create offer error:", err);
      }
    }

    return pc;
  }

  private closePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
    }
    const audioEl = document.getElementById(`audio-peer-${peerId}`);
    if (audioEl && audioEl.parentNode) {
      audioEl.parentNode.removeChild(audioEl);
    }
  }
}
