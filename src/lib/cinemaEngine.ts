import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  AudioSpatialMode,
  CameraMode,
  CharacterPreset,
  ScreenFrameMode,
  SeatData,
  UserData,
  Vector3Like
} from "../types/cinema";
import {
  ALLOWED_ACTIONS,
  AVATAR_PALETTE,
  CHARACTER_PRESETS,
  DEFAULT_CHARACTER,
  EMOTE_DURATIONS
} from "./constants";

export interface EngineCallbacks {
  onSeatClicked?: (seatIndex: number) => void;
  onSeatHover?: (info: { visible: boolean; text: string; x: number; y: number } | null) => void;
  onLocalMovement?: (pos: Vector3Like, rot: number, pitch: number, yaw: number, action: string) => void;
  onCameraModeChanged?: (mode: CameraMode) => void;
  onStandUp?: () => void;
  onEmoteTriggered?: (action: string) => void;
}

export class CinemaSpatialAudio {
  private ctx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private pannerNode: PannerNode | null = null;
  private bassNode: BiquadFilterNode | null = null;
  private dialogNode: BiquadFilterNode | null = null;
  private presenceNode: BiquadFilterNode | null = null;
  private convolverNode: ConvolverNode | null = null;

  // Dolby Atmos 3D Surround & Height Virtualization
  private atmosSurroundDelayL: DelayNode | null = null;
  private atmosSurroundDelayR: DelayNode | null = null;
  private atmosSurroundGain: GainNode | null = null;
  private atmosHeightFilter: BiquadFilterNode | null = null;
  private atmosHeightGain: GainNode | null = null;

  // Theatrical Auditorium Echo & Wall Reflection Network
  private echoDampFilter: BiquadFilterNode | null = null;
  private echoDelayLeft: DelayNode | null = null;
  private echoDelayRight: DelayNode | null = null;
  private echoDelayRear: DelayNode | null = null;
  private echoFeedback: GainNode | null = null;
  private echoGain: GainNode | null = null;

  // Master Busses
  private wetGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  private mode: AudioSpatialMode = "atmos";
  private isEnabled: boolean = true;
  private videoEl: HTMLVideoElement | null = null;

  constructor() {}

  public init(video: HTMLVideoElement) {
    if (this.videoEl === video && this.ctx) return;
    this.videoEl = video;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }

      if (!this.sourceNode) {
        this.sourceNode = this.ctx.createMediaElementSource(video);

        // 1. Cinema Subwoofer LFE Punch (Lowshelf 75Hz +5.5dB)
        this.bassNode = this.ctx.createBiquadFilter();
        this.bassNode.type = "lowshelf";
        this.bassNode.frequency.value = 75;
        this.bassNode.gain.value = 5.5;

        // 2. Dialogue Clarity Enhancer (Peaking 2.8kHz +2.2dB)
        this.dialogNode = this.ctx.createBiquadFilter();
        this.dialogNode.type = "peaking";
        this.dialogNode.frequency.value = 2800;
        this.dialogNode.Q.value = 1.2;
        this.dialogNode.gain.value = 2.2;

        // 3. Acoustic Warmth & Chest Resonance (Peaking 220Hz +1.4dB)
        this.presenceNode = this.ctx.createBiquadFilter();
        this.presenceNode.type = "peaking";
        this.presenceNode.frequency.value = 220;
        this.presenceNode.Q.value = 0.9;
        this.presenceNode.gain.value = 1.4;

        // 4. 3D Positional Panner anchored at the Cinema Screen (0, 7.30, -18.2)
        this.pannerNode = this.ctx.createPanner();
        this.pannerNode.panningModel = "HRTF";
        this.pannerNode.distanceModel = "inverse";
        this.pannerNode.refDistance = 10;
        this.pannerNode.maxDistance = 80;
        this.pannerNode.rolloffFactor = 0.65;
        this.pannerNode.coneInnerAngle = 360;
        this.pannerNode.positionX.value = 0;
        this.pannerNode.positionY.value = 7.30;
        this.pannerNode.positionZ.value = -18.2;

        // 5. Dolby Atmos 3D Surround & Height Layer
        this.atmosSurroundDelayL = this.ctx.createDelay(0.1);
        this.atmosSurroundDelayL.delayTime.value = 0.014; // 14ms Haas decorrelation left
        this.atmosSurroundDelayR = this.ctx.createDelay(0.1);
        this.atmosSurroundDelayR.delayTime.value = 0.024; // 24ms Haas decorrelation right

        this.atmosSurroundGain = this.ctx.createGain();
        this.atmosSurroundGain.gain.value = 0.35;

        this.atmosHeightFilter = this.ctx.createBiquadFilter();
        this.atmosHeightFilter.type = "bandpass";
        this.atmosHeightFilter.frequency.value = 6500;
        this.atmosHeightFilter.Q.value = 0.8;

        this.atmosHeightGain = this.ctx.createGain();
        this.atmosHeightGain.gain.value = 0.25;

        // 6. Theatrical Echo & Multiplex Auditorium Wall Delay Network
        this.echoDampFilter = this.ctx.createBiquadFilter();
        this.echoDampFilter.type = "lowpass";
        this.echoDampFilter.frequency.value = 2800; // Natural velvet acoustic absorption

        this.echoDelayLeft = this.ctx.createDelay(0.5);
        this.echoDelayLeft.delayTime.value = 0.042; // 42ms left auditorium wall reflection

        this.echoDelayRight = this.ctx.createDelay(0.5);
        this.echoDelayRight.delayTime.value = 0.058; // 58ms right auditorium wall reflection

        this.echoDelayRear = this.ctx.createDelay(0.5);
        this.echoDelayRear.delayTime.value = 0.128; // 128ms rear projection booth echo bounce

        this.echoFeedback = this.ctx.createGain();
        this.echoFeedback.gain.value = 0.28;

        this.echoGain = this.ctx.createGain();
        this.echoGain.gain.value = 0.26;

        // 7. Multiplex Auditorium Acoustic Reverb
        this.convolverNode = this.ctx.createConvolver();
        this.convolverNode.buffer = this.createCinemaReverbImpulse(this.ctx);

        this.wetGain = this.ctx.createGain();
        this.wetGain.gain.value = 0.22;

        this.dryGain = this.ctx.createGain();
        this.dryGain.gain.value = 0.95;

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 1.0;

        // --- CONNECT AUDIO GRAPH ---
        // Input -> EQ chain -> 3D Screen Panner
        this.sourceNode.connect(this.bassNode);
        this.bassNode.connect(this.dialogNode);
        this.dialogNode.connect(this.presenceNode);
        this.presenceNode.connect(this.pannerNode);

        // Path A: Direct 3D Sound
        this.pannerNode.connect(this.dryGain);
        this.dryGain.connect(this.masterGain);

        // Path B: Dolby Atmos 3D Surround & Height
        this.pannerNode.connect(this.atmosSurroundDelayL);
        this.pannerNode.connect(this.atmosSurroundDelayR);
        this.atmosSurroundDelayL.connect(this.atmosSurroundGain);
        this.atmosSurroundDelayR.connect(this.atmosSurroundGain);
        this.atmosSurroundGain.connect(this.masterGain);

        this.pannerNode.connect(this.atmosHeightFilter);
        this.atmosHeightFilter.connect(this.atmosHeightGain);
        this.atmosHeightGain.connect(this.masterGain);

        // Path C: Theatrical Multiplex Hall Echoes
        this.pannerNode.connect(this.echoDampFilter);
        this.echoDampFilter.connect(this.echoDelayLeft);
        this.echoDampFilter.connect(this.echoDelayRight);
        this.echoDampFilter.connect(this.echoDelayRear);

        this.echoDelayLeft.connect(this.echoGain);
        this.echoDelayRight.connect(this.echoGain);
        this.echoDelayRear.connect(this.echoGain);

        // Feedback loop for deep rear echo decay
        this.echoDelayRear.connect(this.echoFeedback);
        this.echoFeedback.connect(this.echoDampFilter);

        this.echoGain.connect(this.masterGain);

        // Path D: Auditorium Velvet Convolution Reverb
        this.pannerNode.connect(this.convolverNode);
        this.convolverNode.connect(this.wetGain);
        this.wetGain.connect(this.masterGain);

        // Master Output to Speakers / Headphones
        this.masterGain.connect(this.ctx.destination);
      }
    } catch (e) {
      console.warn("Spatial audio notice:", e);
    }
  }

  // Generates synthetic 600-seat Dolby Atmos multiplex cinema hall impulse response
  private createCinemaReverbImpulse(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 1.15); // 1.15s auditorium acoustic decay
    const impulse = ctx.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    const predelay = Math.floor(rate * 0.024); // 24ms initial auditorium boundary reflection

    for (let i = 0; i < length; i++) {
      if (i < predelay) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const t = (i - predelay) / rate;
      // Exponential decay with simulated high-frequency velvet damping
      const decay = Math.exp(-t * 3.4);
      const hfDamp = Math.exp(-t * 2.2);
      left[i] = (Math.random() * 2 - 1) * decay * hfDamp;
      right[i] = (Math.random() * 2 - 1) * decay * hfDamp;
    }
    return impulse;
  }

  public updateListener(camera: THREE.Camera) {
    if (!this.ctx || !this.isEnabled || this.ctx.state !== "running") return;
    try {
      const pos = camera.position;
      const time = this.ctx.currentTime + 0.02;

      if (this.ctx.listener.positionX) {
        this.ctx.listener.positionX.setTargetAtTime(pos.x, time, 0.05);
        this.ctx.listener.positionY.setTargetAtTime(pos.y, time, 0.05);
        this.ctx.listener.positionZ.setTargetAtTime(pos.z, time, 0.05);
      } else {
        (this.ctx.listener as any).setPosition(pos.x, pos.y, pos.z);
      }

      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const up = camera.up;

      if (this.ctx.listener.forwardX) {
        this.ctx.listener.forwardX.setTargetAtTime(forward.x, time, 0.05);
        this.ctx.listener.forwardY.setTargetAtTime(forward.y, time, 0.05);
        this.ctx.listener.forwardZ.setTargetAtTime(forward.z, time, 0.05);
        this.ctx.listener.upX.setTargetAtTime(up.x, time, 0.05);
        this.ctx.listener.upY.setTargetAtTime(up.y, time, 0.05);
        this.ctx.listener.upZ.setTargetAtTime(up.z, time, 0.05);
      } else {
        (this.ctx.listener as any).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
      }
    } catch {}
  }

  public setAudioMode(mode: AudioSpatialMode) {
    this.mode = mode;
    this.applyAudioGains();
  }

  public getAudioMode(): AudioSpatialMode {
    return this.mode;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    this.mode = enabled ? "atmos" : "stereo";
    this.applyAudioGains();
  }

  public getEnabled(): boolean {
    return this.isEnabled && this.mode !== "stereo";
  }

  private applyAudioGains() {
    if (!this.ctx || !this.dryGain || !this.masterGain) return;

    if (this.mode === "atmos") {
      this.dryGain.gain.value = 0.95;
      if (this.bassNode) this.bassNode.gain.value = 5.5;
      if (this.dialogNode) this.dialogNode.gain.value = 2.2;
      if (this.presenceNode) this.presenceNode.gain.value = 1.4;
      if (this.atmosSurroundGain) this.atmosSurroundGain.gain.value = 0.35;
      if (this.atmosHeightGain) this.atmosHeightGain.gain.value = 0.25;
      if (this.echoGain) this.echoGain.gain.value = 0.26;
      if (this.wetGain) this.wetGain.gain.value = 0.22;
      if (this.pannerNode) this.pannerNode.rolloffFactor = 0.65;
    } else if (this.mode === "hall") {
      this.dryGain.gain.value = 0.82;
      if (this.bassNode) this.bassNode.gain.value = 6.0;
      if (this.dialogNode) this.dialogNode.gain.value = 1.8;
      if (this.presenceNode) this.presenceNode.gain.value = 1.6;
      if (this.atmosSurroundGain) this.atmosSurroundGain.gain.value = 0.40;
      if (this.atmosHeightGain) this.atmosHeightGain.gain.value = 0.30;
      if (this.echoGain) this.echoGain.gain.value = 0.52; // Pronounced theater echo!
      if (this.wetGain) this.wetGain.gain.value = 0.45; // Grand multiplex reverb!
      if (this.pannerNode) this.pannerNode.rolloffFactor = 0.75;
    } else {
      // Stereo bypass
      this.dryGain.gain.value = 1.0;
      if (this.bassNode) this.bassNode.gain.value = 0.0;
      if (this.dialogNode) this.dialogNode.gain.value = 0.0;
      if (this.presenceNode) this.presenceNode.gain.value = 0.0;
      if (this.atmosSurroundGain) this.atmosSurroundGain.gain.value = 0.0;
      if (this.atmosHeightGain) this.atmosHeightGain.gain.value = 0.0;
      if (this.echoGain) this.echoGain.gain.value = 0.0;
      if (this.wetGain) this.wetGain.gain.value = 0.0;
      if (this.pannerNode) this.pannerNode.rolloffFactor = 0.0;
    }
  }

  public resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  public destroy() {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export class CinemaEngine {
  private container: HTMLElement;
  private videoElement: HTMLVideoElement;
  private callbacks: EngineCallbacks;

  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  private clock: THREE.Clock;

  public cameraMode: CameraMode = "TPP";
  public cameraYaw: number = 0;
  public cameraPitch: number = 0.22;
  public cameraDistance: number = 1.30;
  public seatedTppDistance: number = 1.15;
  public fppFov: number = 56;
  public targetFppFov: number = 56;

  public localUserId: string = "";
  public currentSeatIndex: number | null = null;
  public position: THREE.Vector3 = new THREE.Vector3(-7.08, 0.68, -3.5);
  public rotation: number = 0;
  public verticalVelocity: number = 0;
  public isGrounded: boolean = true;
  public isJumping: boolean = false;
  public isRunning: boolean = false;
  public isSlouchWalk: boolean = false;
  public activeEmote: string | null = null;
  public emoteTimeout: any = null;

  public seats: SeatData[] = [];
  public seatHitboxes: THREE.Mesh[] = [];
  public avatars: Map<string, THREE.Group> = new Map();
  private seatOccupancy: Map<number, string> = new Map();

  private modelCache: Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>> = new Map();
  private gltfLoader: GLTFLoader = new GLTFLoader();

  public screenMesh: THREE.Mesh | null = null;
  public screenMaterial: THREE.MeshBasicMaterial | null = null;
  public screenShaderMaterial: THREE.ShaderMaterial | null = null;
  public screenLight: THREE.PointLight | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  public defaultScreenTexture: THREE.CanvasTexture | null = null;
  private videoAspect: number = 16 / 9;
  private frameMode: ScreenFrameMode = "2.35:1";
  private fitMode: "fit" | "fill" = "fit";
  public spatialAudio: CinemaSpatialAudio = new CinemaSpatialAudio();
  private lastVideoTime: number = -1;

  public isMobileDevice: boolean = false;

  private lastSentPos: THREE.Vector3 = new THREE.Vector3(9999, 9999, 9999);
  private lastSentRot: number = -9999;
  private lastSentPitch: number = -9999;
  private lastSentYaw: number = -9999;
  private lastSentAction: string = "";

  private activeKeys: Set<string> = new Set();
  private isPointerDown: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private hasDragged: boolean = false;
  private lastMoveSendTime: number = 0;
  public smoothedCameraTarget: THREE.Vector3 = new THREE.Vector3();
  private animationFrameId: number | null = null;
  private isDestroyed: boolean = false;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private mouseVec: THREE.Vector2 = new THREE.Vector2();
  private rowPlaqueTextureCache: Map<string, THREE.CanvasTexture> = new Map();

  constructor(container: HTMLElement, videoElement: HTMLVideoElement, callbacks: EngineCallbacks = {}) {
    this.container = container;
    this.videoElement = videoElement;
    this.callbacks = callbacks;

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        this.refreshRowPlaques();
      });
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408);
    this.scene.fog = new THREE.Fog(0x020408, 35, 95);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.05, 120);
    this.camera.position.set(this.position.x, this.position.y + 1.55, this.position.z + 2.0);

    this.isMobileDevice = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || ("ontouchstart" in window));

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.30;

    container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    // Build the complete 3D virtual cinema world
    this.buildAuditorium();
    this.setupScreen();
    this.buildSeats();
    this.setupLighting();
    this.spatialAudio.init(videoElement);

    this.bindEvents();
    this.animate = this.animate.bind(this);
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  // --- Procedural Multiplex Textures ---

  private createCeilingGridTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(canvas);

    ctx.fillStyle = "#070a14";
    ctx.fillRect(0, 0, 512, 512);

    const tileSize = 64;
    for (let x = 0; x < 512; x += tileSize) {
      for (let y = 0; y < 512; y += tileSize) {
        ctx.fillStyle = (x + y) % (tileSize * 2) === 0 ? "#090d1a" : "#070a14";
        ctx.fillRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
      }
    }

    ctx.strokeStyle = "#1b253e";
    ctx.lineWidth = 2.5;
    for (let i = 0; i <= 512; i += tileSize) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(14, 18);
    return texture;
  }

  private createCarpetTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(canvas);

    ctx.fillStyle = "#0c1224";
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = "rgba(45, 75, 135, 0.45)";
    for (let i = 0; i < 4000; i++) {
      const rx = Math.random() * 256;
      const ry = Math.random() * 256;
      ctx.fillRect(rx, ry, 1.5, 1.5);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(16, 24);
    return texture;
  }

  private createScreenStandbyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(canvas);

    // Authentic mild white theater projection screen material (clean, matte, neutral)
    const grad = ctx.createRadialGradient(960, 540, 120, 960, 540, 1150);
    grad.addColorStop(0, "#f8fafc"); // Mild pearl white in center
    grad.addColorStop(0.55, "#f1f5f9"); // Subtle soft cinema screen body
    grad.addColorStop(0.85, "#e2e8f0"); // Mild screen falloff toward edges
    grad.addColorStop(1.0, "#d8e0e9"); // Soft edge vignette before bezel
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1920, 1080);

    // Ultra-fine cinema projection screen micro-texture (acoustic matte screen fabric)
    ctx.fillStyle = "rgba(100, 116, 139, 0.02)";
    for (let y = 0; y < 1080; y += 4) {
      for (let x = 0; x < 1920; x += 4) {
        if ((x + y) % 8 === 0) {
          ctx.fillRect(x, y, 1.5, 1.5);
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    return texture;
  }

  // --- Auditorium Construction ---

  private buildAuditorium() {
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x101730,
      roughness: 0.85,
      metalness: 0.06
    });

    const carpetMat = new THREE.MeshStandardMaterial({
      map: this.createCarpetTexture(),
      roughness: 0.95,
      metalness: 0.02
    });

    const ceilingMat = new THREE.MeshStandardMaterial({
      map: this.createCeilingGridTexture(),
      roughness: 0.85,
      metalness: 0.1
    });

    // Main Auditorium Floor (Spans 44 x 54, extending well beneath and beyond all outer walls)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 54), carpetMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Suspended Grid Ceiling
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(44, 54), ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 15.0, 0);
    this.scene.add(ceiling);

    // Outer Enclosure Walls (Thick, seamless barriers that extend below floor and beyond edges)
    const addWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };

    addWall(36, 18.0, 1.2, 0, 8.0, -19.2); // Front Proscenium Wall (extra deep & wide, completely eliminates floor gaps)
    addWall(36, 18.0, 1.2, 0, 8.0, 19.2);  // Back Rear Wall
    addWall(1.2, 18.0, 44, -16.2, 8.0, 0); // Left Side Wall
    addWall(1.2, 18.0, 44, 16.2, 8.0, 0);  // Right Side Wall

    // Curved Multiplex Front Stage & Steps (Low Profile with Clean Accessible Stairs)
    this.buildCurvedStage();

    // Modern Slim Ceiling Tube Light Fixtures (Using /assets/theater/tube_light.glb)
    this.buildCeilingLights();

    // Signature Angular Neon Light Bars on Side Walls
    this.buildNeonLightBars();

    // Rear Projection Booth Window & Volumetric Cinema Projector Beam
    this.buildProjectionBooth();
  }

  private buildCurvedStage() {
    const stageTopMat = new THREE.MeshStandardMaterial({
      color: 0x10162a,
      roughness: 0.82,
      metalness: 0.12
    });

    const stageEdgeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.65,
      metalness: 0.20
    });

    const stepLedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const stepLedGlowMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    const stageGroup = new THREE.Group();

    // Low profile proscenium stage platform: width 33.0 penetrates side walls, depth 6.0 extends all the way into front wall
    const stageWidth = 33.0;
    const stageDepth = 6.0;
    const stageHeight = 0.18;
    const stageBase = new THREE.Mesh(new THREE.BoxGeometry(stageWidth, stageHeight, stageDepth), stageTopMat);
    stageBase.position.set(0, stageHeight / 2, -17.6);
    stageBase.receiveShadow = true;
    stageGroup.add(stageBase);

    // Front edge nosing trim for stage apron
    const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(stageWidth, 0.02, 0.08), stageEdgeMat);
    frontTrim.position.set(0, stageHeight, -14.6);
    stageGroup.add(frontTrim);

    // 2 Broad Curved Transition Steps Leading Down to Floor (R=34) with Glowing LED Treads
    // Step 2 (0.12m) is adjacent to stage (-14.15); Step 1 (0.06m) connects down to floor (-13.70)
    const stepConfigs = [
      { h: 0.12, zOffset: -14.15 },
      { h: 0.06, zOffset: -13.70 }
    ];
    const stepR = 34;

    stepConfigs.forEach((cfg) => {
      const h = cfg.h;
      const zOffset = cfg.zOffset;
      const curvePoints: THREE.Vector3[] = [];

      for (let i = 0; i <= 36; i++) {
        const u = (i / 36) * 2 - 1;
        const x = u * 15.2;
        const z = zOffset - (x * x) / (2 * stepR);
        curvePoints.push(new THREE.Vector3(x, h, z));
      }

      for (let i = 0; i < curvePoints.length - 1; i++) {
        const p1 = curvePoints[i];
        const p2 = curvePoints[i + 1];
        const mid = p1.clone().add(p2).multiplyScalar(0.5);
        const len = p1.distanceTo(p2);
        const angle = Math.atan2(p2.x - p1.x, p2.z - p1.z);

        const riserMesh = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, h, 0.52), stageTopMat);
        riserMesh.position.set(mid.x, h / 2, mid.z);
        riserMesh.rotation.y = angle - Math.PI / 2;
        riserMesh.receiveShadow = true;
        stageGroup.add(riserMesh);

        // Subtle glowing LED safety tread on step nosing
        const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.015, 0.03), stepLedMat);
        ledStrip.position.set(mid.x, h + 0.008, mid.z + 0.23);
        ledStrip.rotation.y = angle - Math.PI / 2;
        stageGroup.add(ledStrip);

        const ledGlow = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.04, 0.05), stepLedGlowMat);
        ledGlow.position.copy(ledStrip.position);
        ledGlow.rotation.y = angle - Math.PI / 2;
        stageGroup.add(ledGlow);
      }
    });

    this.scene.add(stageGroup);
  }

  private buildCeilingLights() {
    const ceilingLightGroup = new THREE.Group();
    const ceilingY = 14.97; // Flush against suspended ceiling plane at 15.0

    // 4 Rows along Z (matching reference photo: Left, Center, Right columns)
    const rowZs = [-12.0, -4.5, 3.5, 11.5];
    const colXs = [-8.5, 0.0, 8.5];

    // Load sleek 3D tube light model
    this.gltfLoader.load(
      "/assets/theater/tube_light.glb",
      (gltf) => {
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            if (mesh.name === "Object_4") {
              // Glowing white tube diffuser
              mesh.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
            } else {
              // Slim dark bracket
              mesh.material = new THREE.MeshStandardMaterial({
                color: 0x0f172a,
                roughness: 0.5,
                metalness: 0.8
              });
            }
          }
        });

        // 4 Rows of 3 columns (increased thickness by 40% in Y and Z, NO circular point light gradient hotspots)
        rowZs.forEach((z) => {
          colXs.forEach((x) => {
            const light = gltf.scene.clone(true);
            light.scale.set(4.7, 1.4, 1.4);
            light.position.set(x, ceilingY, z);
            ceilingLightGroup.add(light);
          });
        });

        // Rear continuous light bar across X above the projection booth (Z = 16.5, thickened by 40%)
        const rearBar = gltf.scene.clone(true);
        rearBar.scale.set(12.5, 1.4, 1.4);
        rearBar.position.set(0, ceilingY, 16.5);
        ceilingLightGroup.add(rearBar);
      },
      undefined,
      (err) => {
        console.warn("Could not load tube_light.glb:", err);
      }
    );

    this.scene.add(ceilingLightGroup);
  }

  private buildNeonLightBars() {
    const neonGroup = new THREE.Group();

    // Brilliant crisp pure white center core
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    // Sleek electric blue glow casing
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const createNeonBar = (p1: THREE.Vector3, p2: THREE.Vector3) => {
      const distance = p1.distanceTo(p2);
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      const dir = p2.clone().sub(p1).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

      const bar = new THREE.Group();

      // Outer electric blue glow casing (15% wider)
      const glowGeo = new THREE.CylinderGeometry(0.0518, 0.0518, distance, 12);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      bar.add(glow);

      // Pure white central luminous core (15% wider)
      const coreGeo = new THREE.CylinderGeometry(0.0207, 0.0207, distance, 12);
      const core = new THREE.Mesh(coreGeo, coreMat);
      bar.add(core);

      bar.position.copy(mid);
      bar.quaternion.copy(quat);
      neonGroup.add(bar);
    };

    const addJoint = (pos: THREE.Vector3) => {
      const jointGroup = new THREE.Group();
      jointGroup.position.copy(pos);

      const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.0552, 12, 12), glowMat);
      jointGroup.add(glowSphere);

      const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.023, 12, 12), coreMat);
      jointGroup.add(coreSphere);

      neonGroup.add(jointGroup);
    };

    // Positioned at X = +-15.52 (8cm in front of solid wall inner face at +-15.60)
    [-15.52, 15.52].forEach((xSide) => {
      const p0 = new THREE.Vector3(xSide, 0.4, -18.2);
      const p1 = new THREE.Vector3(xSide, 14.5, -18.2);
      const p2 = new THREE.Vector3(xSide, 14.0, -16.5);
      const p3 = new THREE.Vector3(xSide, 1.2, -7.0);
      const p4 = new THREE.Vector3(xSide, 14.0, 1.5);
      const p5 = new THREE.Vector3(xSide, 4.5, 9.5);
      const p6 = new THREE.Vector3(xSide, 14.0, 17.5);
      const p7 = new THREE.Vector3(xSide, 2.92, 18.8);
      const p8 = new THREE.Vector3(xSide, 14.5, 18.8);

      createNeonBar(p0, p1);
      createNeonBar(p2, p3);
      createNeonBar(p3, p4);
      createNeonBar(p4, p5);
      createNeonBar(p5, p6);
      createNeonBar(p7, p8);

      [p0, p1, p2, p3, p4, p5, p6, p7, p8].forEach((pt) => addJoint(pt));

      // Dynamic blue neon point lights along the side wall to illuminate the room
      [-14, -6, 2, 10, 17].forEach((zLight) => {
        const pl = new THREE.PointLight(0x3b82f6, 4.0, 24, 1.2);
        pl.position.set(xSide * 0.94, 6.5, zLight);
        neonGroup.add(pl);
      });
    });

    this.scene.add(neonGroup);
  }

  private buildProjectionBooth() {
    const boothGroup = new THREE.Group();

    // Clean transparent glass window material
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.75
    });

    // Sleek thin booth window outer frame flush on auditorium rear wall
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x070912,
      roughness: 0.8
    });
    const windowFrame = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.0, 0.06), frameMat);
    windowFrame.position.set(0, 11.0, 18.57);
    boothGroup.add(windowFrame);

    // Dual transparent glass window panes
    [-1.2, 1.2].forEach((xGlass) => {
      const glassPane = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 0.02), glassMat);
      glassPane.position.set(xGlass, 11.0, 18.54);
      boothGroup.add(glassPane);
    });

    // Intense glowing projector lens core and halo (thin, flush with glass)
    const lensCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lensGlowMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    const lensCore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 32), lensCoreMat);
    lensCore.rotation.x = Math.PI / 2;
    lensCore.position.set(0, 11.0, 18.52);
    boothGroup.add(lensCore);

    const lensHalo = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 32), lensGlowMat);
    lensHalo.rotation.x = Math.PI / 2;
    lensHalo.position.set(0, 11.0, 18.51);
    boothGroup.add(lensHalo);

    // Glowing projection booth interior light
    const boothLight = new THREE.PointLight(0xa5f3fc, 8.0, 35, 1.0);
    boothLight.position.set(0, 11.0, 18.42);
    boothGroup.add(boothLight);

    // Cinema projector light beam shining from booth directly onto the screen
    const projectorBeam = new THREE.SpotLight(0xcfd8ff, 12.0, 55, Math.PI / 9, 0.35, 0.8);
    projectorBeam.position.set(0, 11.0, 18.32);
    projectorBeam.target.position.set(0, 7.30, -18.2);
    boothGroup.add(projectorBeam);
    boothGroup.add(projectorBeam.target);

    this.scene.add(boothGroup);
  }

  // --- Massive Curved Multiplex IMAX Screen ---

  private setupScreen() {
    const screenWidth = 30.0;
    const screenHeight = 13.8;
    const curveRadius = 34.0;

    const screenGeo = new THREE.PlaneGeometry(screenWidth, screenHeight, 128, 32);
    const pos = screenGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const zOffset = (x * x) / (2 * curveRadius);
      pos.setZ(i, zOffset);
    }
    screenGeo.computeVertexNormals();

    this.defaultScreenTexture = this.createScreenStandbyTexture();

    // Precision Cinema Screen Shader with Aspect Ratio Fitting (Letterbox & Pillarbox)
    this.screenShaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.defaultScreenTexture },
        uRepeat: { value: new THREE.Vector2(1.0, 1.0) },
        uOffset: { value: new THREE.Vector2(0.0, 0.0) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #include <common>
        uniform sampler2D map;
        uniform vec2 uRepeat;
        uniform vec2 uOffset;
        varying vec2 vUv;
        void main() {
          vec2 uv = (vUv - uOffset) / uRepeat;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            gl_FragColor = vec4(0.012, 0.012, 0.02, 1.0); // Cinematic deep black pillarbox / letterbox
          } else {
            gl_FragColor = texture2D(map, uv);
          }
          #include <colorspace_fragment>
        }
      `
    });

    this.screenMesh = new THREE.Mesh(screenGeo, this.screenShaderMaterial);
    this.screenMesh.position.set(0, 7.30, -18.2);
    this.scene.add(this.screenMesh);

    // Ultra-thin Sleek Black Cinema Bezel Frame around the curved screen
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x05070c,
      roughness: 0.85,
      metalness: 0.2
    });

    // Thin bezel: 0.06m (6 cm) instead of 0.45m (45 cm)
    const frameThickness = 0.06;
    const frameGeo = new THREE.PlaneGeometry(
      screenWidth + frameThickness * 2,
      screenHeight + frameThickness * 2,
      128,
      32
    );
    const fPos = frameGeo.attributes.position;
    for (let i = 0; i < fPos.count; i++) {
      const x = fPos.getX(i);
      fPos.setZ(i, (x * x) / (2 * curveRadius));
    }
    frameGeo.computeVertexNormals();

    const frameMesh = new THREE.Mesh(frameGeo, borderMat);
    frameMesh.position.set(0, 7.30, -18.21);
    this.scene.add(frameMesh);

    // Dynamic projection bounce light casting natural neutral bounce onto stage and auditorium
    this.screenLight = new THREE.PointLight(0xf1f5f9, 2.5, 45, 0.8);
    this.screenLight.position.set(0, 7.30, -15.5);
    this.scene.add(this.screenLight);
  }

  public updateVideoAspectRatio(videoWidth: number, videoHeight: number) {
    if (!videoWidth || !videoHeight) return;
    this.videoAspect = videoWidth / videoHeight;
    this.applyAspectRatioFit();
  }

  public setFrameMode(mode: ScreenFrameMode) {
    this.frameMode = mode;
    this.fitMode = mode === "fill" ? "fill" : "fit";
    this.applyAspectRatioFit();
    if (this.videoTexture) {
      this.videoTexture.needsUpdate = true;
    }
  }

  public getFrameMode(): ScreenFrameMode {
    return this.frameMode;
  }

  public setFitMode(mode: "fit" | "fill") {
    this.setFrameMode(mode);
  }

  public getFitMode(): "fit" | "fill" {
    return this.frameMode === "fill" ? "fill" : "fit";
  }

  private applyAspectRatioFit() {
    if (!this.screenShaderMaterial) return;

    if (this.frameMode === "fill") {
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, 1.0);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, 0.0);
      return;
    }

    if (this.frameMode === "stretch") {
      // Zoom & stretch vertically to eliminate letterbox black bars
      // Crops ~14.5% top & bottom to completely eliminate encoded letterbox black bars
      const letterboxCropFactor = 0.71;
      const cropBar = (1.0 - letterboxCropFactor) / 2.0;
      const repeatY = 1.0 / letterboxCropFactor;
      const offsetY = -cropBar / letterboxCropFactor;
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, repeatY);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, offsetY);
      return;
    }

    if (this.frameMode === "2.39:1") {
      // Theatrical Anamorphic scope (2.39:1) embedded in 16:9 container -> hides black bars
      const cropFactor = (16.0 / 9.0) / 2.39; // ~0.7438
      const cropBar = (1.0 - cropFactor) / 2.0; // ~0.1281
      const repeatY = 1.0 / cropFactor; // ~1.3444
      const offsetY = -cropBar / cropFactor; // ~-0.1722
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, repeatY);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, offsetY);
      return;
    }

    if (this.frameMode === "2.35:1") {
      // CinemaScope (2.35:1) embedded in 16:9 container -> hides black bars
      const cropFactor = (16.0 / 9.0) / 2.35; // ~0.7565
      const cropBar = (1.0 - cropFactor) / 2.0; // ~0.1217
      const repeatY = 1.0 / cropFactor; // ~1.3218
      const offsetY = -cropBar / cropFactor; // ~-0.1609
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, repeatY);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, offsetY);
      return;
    }

    if (this.frameMode === "21:9") {
      // Ultrawide (21:9 / 2.333:1) embedded in 16:9 container -> hides black bars
      const cropFactor = 16.0 / 21.0; // ~0.7619
      const cropBar = (1.0 - cropFactor) / 2.0; // ~0.1190
      const repeatY = 1.0 / cropFactor; // ~1.3125
      const offsetY = -cropBar / cropFactor; // ~-0.1562
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, repeatY);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, offsetY);
      return;
    }

    const screenWidth = 30.0;
    const screenHeight = 13.8;
    const screenAspect = screenWidth / screenHeight; // ~2.1739

    let targetAspect = this.videoAspect || (16 / 9);
    if (this.frameMode === "16:9") {
      targetAspect = 16 / 9; // ~1.7778
    }

    let repeatX = 1.0;
    let repeatY = 1.0;
    let offsetX = 0.0;
    let offsetY = 0.0;

    if (targetAspect < screenAspect) {
      // Narrower than screen (16:9) -> fit full height, pillarbox horizontally
      repeatX = targetAspect / screenAspect;
      offsetX = (1.0 - repeatX) / 2.0;
      repeatY = 1.0;
      offsetY = 0.0;
    } else {
      // Wider than screen -> fit full width, letterbox vertically
      repeatX = 1.0;
      offsetX = 0.0;
      repeatY = screenAspect / targetAspect;
      offsetY = (1.0 - repeatY) / 2.0;
    }

    this.screenShaderMaterial.uniforms.uRepeat.value.set(repeatX, repeatY);
    this.screenShaderMaterial.uniforms.uOffset.value.set(offsetX, offsetY);
  }

  public showVideoTexture() {
    if (this.screenShaderMaterial && this.videoTexture) {
      this.screenShaderMaterial.uniforms.map.value = this.videoTexture;
      if (this.screenLight) {
        this.screenLight.color.setHex(0xe2e8f0);
        this.screenLight.intensity = 3.5;
      }
      if (this.videoElement && this.videoElement.videoWidth && this.videoElement.videoHeight) {
        this.updateVideoAspectRatio(this.videoElement.videoWidth, this.videoElement.videoHeight);
      } else {
        this.applyAspectRatioFit();
      }
      this.videoTexture.needsUpdate = true;
    }
  }

  public showStandbyTexture() {
    if (this.screenShaderMaterial && this.defaultScreenTexture) {
      this.screenShaderMaterial.uniforms.map.value = this.defaultScreenTexture;
      this.screenShaderMaterial.uniforms.uRepeat.value.set(1.0, 1.0);
      this.screenShaderMaterial.uniforms.uOffset.value.set(0.0, 0.0);
      if (this.screenLight) {
        this.screenLight.color.setHex(0xf1f5f9);
        this.screenLight.intensity = 2.0;
      }
    }
  }

  public setVideoSource(video: HTMLVideoElement) {
    this.videoElement = video;
    this.spatialAudio.init(video);
    this.spatialAudio.resume();
    if (this.videoTexture) {
      this.videoTexture.dispose();
    }
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.generateMipmaps = false;
    this.videoTexture.minFilter = THREE.LinearFilter;
    this.videoTexture.magFilter = THREE.LinearFilter;
    if (this.renderer && this.renderer.capabilities) {
      this.videoTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    }
    if (THREE.SRGBColorSpace) {
      this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    }

    const onMeta = () => {
      if (video.videoWidth && video.videoHeight) {
        this.updateVideoAspectRatio(video.videoWidth, video.videoHeight);
      }
    };
    video.addEventListener("loadedmetadata", onMeta);

    // Hardware-accelerated per-frame compositor sync for native 60fps/24fps playback
    const onVideoFrame = () => {
      if (this.videoTexture) {
        this.videoTexture.needsUpdate = true;
      }
      if ("requestVideoFrameCallback" in video) {
        (video as any).requestVideoFrameCallback(onVideoFrame);
      }
    };

    if ("requestVideoFrameCallback" in video) {
      (video as any).requestVideoFrameCallback(onVideoFrame);
    }

    video.addEventListener("play", () => {
      this.showVideoTexture();
      if ("requestVideoFrameCallback" in video) {
        (video as any).requestVideoFrameCallback(onVideoFrame);
      }
    });

    video.addEventListener("playing", () => {
      this.showVideoTexture();
      if ("requestVideoFrameCallback" in video) {
        (video as any).requestVideoFrameCallback(onVideoFrame);
      }
    });

    video.addEventListener("seeked", () => {
      if (this.videoTexture) {
        this.videoTexture.needsUpdate = true;
      }
      if ("requestVideoFrameCallback" in video) {
        (video as any).requestVideoFrameCallback(onVideoFrame);
      }
    });

    video.addEventListener("pause", () => {
      if (video.currentTime === 0) {
        this.showStandbyTexture();
      }
    });

    video.addEventListener("ended", () => {
      this.showStandbyTexture();
    });

    // Idle plain white screen until playback starts
    if (!video.paused && video.currentTime > 0) {
      this.showVideoTexture();
    } else {
      this.showStandbyTexture();
    }
  }

  // --- Cinematic Multiplex Lighting ---

  private setupLighting() {
    // Rich royal blue ambient fill
    const ambient = new THREE.HemisphereLight(0x3b82f6, 0x111c38, 1.6);
    this.scene.add(ambient);

    // Soft overhead downlight casting gentle shadows on seats
    const downlight = new THREE.DirectionalLight(0x93c5fd, 1.15);
    downlight.position.set(0, 14.0, 3.5);
    downlight.castShadow = true;
    downlight.shadow.mapSize.width = 1024;
    downlight.shadow.mapSize.height = 1024;
    this.scene.add(downlight);

    // Overhead blue bounce from the ceiling
    const ceilingBounce = new THREE.PointLight(0x3b82f6, 7.5, 45, 0.6);
    ceilingBounce.position.set(0, 12.0, 4.0);
    this.scene.add(ceilingBounce);
  }

  // --- Stadium Seating & Glowing Blue Stairways (18 Rows = 1,440 Seats Capacity) ---

  private buildSeats() {
    this.seats = [];
    this.seatHitboxes = [];

    const stadiumGroup = new THREE.Group();

    const riserPlatformMat = new THREE.MeshStandardMaterial({
      map: this.createCarpetTexture(),
      roughness: 0.95,
      metalness: 0.02
    });

    const stairLedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const stairLedGlowMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });

    const themeFabricMat = new THREE.MeshStandardMaterial({
      color: 0x1d3260, // Rich, luminous sapphire navy velvet
      roughness: 0.65,
      metalness: 0.08
    });

    const themeFrameMat = new THREE.MeshStandardMaterial({
      color: 0x0f1422, // Deep cinema polymer with subtle specular
      roughness: 0.55,
      metalness: 0.18
    });

    const rowCount = 18;
    const startZ = -7.0;
    const rowSpacing = 1.35;
    const tierHeight = 0.16;

    // 40 Twin Modules per row = 80 continuous seats per row (Total = 1,440 seats!)
    const moduleCols: { modX: number; colA: number; colB: number }[] = [];
    let colNum = 1;

    // Left section: 11 twin modules (cols 1-22)
    [-15.24, -14.52, -13.80, -13.08, -12.36, -11.64, -10.92, -10.20, -9.48, -8.76, -8.04].forEach((modX) => {
      moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
    });

    // Center section: 18 twin modules (cols 23-58)
    [-6.12, -5.40, -4.68, -3.96, -3.24, -2.52, -1.80, -1.08, -0.36, 0.36, 1.08, 1.80, 2.52, 3.24, 3.96, 4.68, 5.40, 6.12].forEach((modX) => {
      moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
    });

    // Right section: 11 twin modules (cols 59-80)
    [8.04, 8.76, 9.48, 10.20, 10.92, 11.64, 12.36, 13.08, 13.80, 14.52, 15.24].forEach((modX) => {
      moduleCols.push({ modX: Number(modX.toFixed(2)), colA: colNum++, colB: colNum++ });
    });

    // 1. Build Stadium Tier Risers, Front Entrance Steps & Glowing Blue Stairways
    for (let r = 0; r < rowCount; r++) {
      const rowZ = startZ + r * rowSpacing;
      const rowY = 0.20 + r * tierHeight;
      const riserDepth = rowSpacing + 0.02;
      const platZ = rowZ - 0.785;

      const leftPlat = new THREE.Mesh(new THREE.BoxGeometry(8.04, rowY, riserDepth), riserPlatformMat);
      leftPlat.position.set(-11.70, rowY / 2, platZ);
      leftPlat.receiveShadow = true;
      stadiumGroup.add(leftPlat);

      const centerPlat = new THREE.Mesh(new THREE.BoxGeometry(12.96, rowY, riserDepth), riserPlatformMat);
      centerPlat.position.set(0, rowY / 2, platZ);
      centerPlat.receiveShadow = true;
      stadiumGroup.add(centerPlat);

      const rightPlat = new THREE.Mesh(new THREE.BoxGeometry(8.04, rowY, riserDepth), riserPlatformMat);
      rightPlat.position.set(11.70, rowY / 2, platZ);
      rightPlat.receiveShadow = true;
      stadiumGroup.add(rightPlat);

      // Two Glowing Blue Stairways (Left at -7.08, Right at +7.08)
      [-7.08, 7.08].forEach((stairX) => {
        const stepWidth = 1.20;
        const stepD = rowSpacing / 2;
        for (let s = 0; s < 2; s++) {
          const stepY = (rowY - tierHeight) + (s + 1) * (tierHeight / 2);
          const stepZ = (platZ - stepD / 2) + s * stepD;

          const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, stepY, stepD), riserPlatformMat);
          stepMesh.position.set(stairX, stepY / 2, stepZ);
          stepMesh.receiveShadow = true;
          stadiumGroup.add(stepMesh);

          const noseTrim = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, 0.015, 0.05), themeFrameMat);
          noseTrim.position.set(stairX, stepY + 0.008, stepZ + stepD / 2 - 0.025);
          stadiumGroup.add(noseTrim);

          const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(stepWidth - 0.04, 0.02, 0.03), stairLedMat);
          ledStrip.position.set(stairX, stepY + 0.01, stepZ + stepD / 2);
          stadiumGroup.add(ledStrip);

          const ledHalo = new THREE.Mesh(new THREE.BoxGeometry(stepWidth, 0.05, 0.05), stairLedGlowMat);
          ledHalo.position.copy(ledStrip.position);
          stadiumGroup.add(ledHalo);
        }
      });
    }

    // Front entrance transition steps
    const frontSteps = [
      { z: -8.89, y: 0.07, d: 0.28 },
      { z: -8.61, y: 0.14, d: 0.28 }
    ];
    frontSteps.forEach((fs) => {
      const stepM = new THREE.Mesh(new THREE.BoxGeometry(32.0, fs.y, fs.d), riserPlatformMat);
      stepM.position.set(0, fs.y / 2, fs.z);
      stepM.receiveShadow = true;
      stadiumGroup.add(stepM);

      [-7.08, 7.08].forEach((ax) => {
        const led = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.02, 0.03), stairLedMat);
        led.position.set(ax, fs.y + 0.01, fs.z + fs.d / 2);
        stadiumGroup.add(led);
      });
    });

    // Top rear walkway platform - spans continuously from under row 18 platforms (Z=15.10) to back wall (Z=19.30)
    const topTierY = 0.20 + (rowCount - 1) * tierHeight;
    const rearWalkway = new THREE.Mesh(
      new THREE.BoxGeometry(33.0, topTierY, 4.2),
      riserPlatformMat
    );
    rearWalkway.position.set(0, topTierY / 2, 17.20);
    rearWalkway.receiveShadow = true;
    stadiumGroup.add(rearWalkway);

    // 2. Build Glowing Row Numbering & Alphabet Plaques along Aisle and Wall Ends
    for (let r = 0; r < rowCount; r++) {
      const rowZ = startZ + r * rowSpacing;
      const rowY = 0.20 + r * tierHeight;
      const rowLetter = String.fromCharCode(65 + r); // A through R
      const plaqueY = rowY + 0.16; // Aligned with the lower side panel of the end chair
      const plaqueZ = rowZ - 0.25; // Aligned with chair center depth

      // Plaque configurations: [x, normalX, rangeText]
      const plaqueConfigs: [number, number, string][] = [
        // Left Section - Aisle end (Seat 22 facing left walkway staircase at -7.08)
        [-7.67, 1, `${rowLetter} 1 - 22`],
        // Center Section - Left aisle end (Seat 23 facing left walkway staircase at -7.08)
        [-6.49, -1, `${rowLetter} 23 - 58`],
        // Center Section - Right aisle end (Seat 58 facing right walkway staircase at +7.08)
        [6.49, 1, `${rowLetter} 23 - 58`],
        // Right Section - Aisle end (Seat 59 facing right walkway staircase at +7.08)
        [7.67, -1, `${rowLetter} 59 - 80`],
        // Left Section - Outer wall end (Seat 1 facing outer left wall at -15.60)
        [-15.58, -1, `${rowLetter} 1 - 22`],
        // Right Section - Outer wall end (Seat 80 facing outer right wall at +15.60)
        [15.58, 1, `${rowLetter} 59 - 80`]
      ];

      plaqueConfigs.forEach(([px, normalX, rangeText]) => {
        const tex = this.getRowPlaqueTexture(rowLetter, rangeText);
        const plaqueMesh = this.createPlaqueMesh(px, plaqueY, plaqueZ, normalX, tex, themeFrameMat);
        stadiumGroup.add(plaqueMesh);
      });
    }

    // 3. Pre-create All 1,440 Seat Records & Raycast Hitboxes
    let seatIndex = 0;
    for (let r = 0; r < rowCount; r++) {
      const rowZ = startZ + r * rowSpacing;
      const rowY = 0.20 + r * tierHeight;
      const rowNumber = r + 1;

      moduleCols.forEach((colInfo) => {
        // Left Seat in twin module
        const leftX = colInfo.modX - 0.18;
        const hitboxLeft = new THREE.Mesh(
          new THREE.BoxGeometry(0.38, 1.10, 0.65),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hitboxLeft.position.set(leftX, rowY + 0.55, rowZ - 0.25);
        hitboxLeft.userData = { seatIndex, row: rowNumber, col: colInfo.colA, x: leftX, y: rowY, z: rowZ - 0.25 };
        stadiumGroup.add(hitboxLeft);
        this.seatHitboxes.push(hitboxLeft);

        this.seats.push({
          index: seatIndex,
          row: rowNumber,
          col: colInfo.colA,
          x: leftX,
          y: rowY,
          z: rowZ - 0.25,
          occupantId: null,
          occupiedBy: null,
          group: null,
          fabricMeshes: []
        });
        seatIndex++;

        // Right Seat in twin module
        const rightX = colInfo.modX + 0.18;
        const hitboxRight = new THREE.Mesh(
          new THREE.BoxGeometry(0.38, 1.10, 0.65),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hitboxRight.position.set(rightX, rowY + 0.55, rowZ - 0.25);
        hitboxRight.userData = { seatIndex, row: rowNumber, col: colInfo.colB, x: rightX, y: rowY, z: rowZ - 0.25 };
        stadiumGroup.add(hitboxRight);
        this.seatHitboxes.push(hitboxRight);

        this.seats.push({
          index: seatIndex,
          row: rowNumber,
          col: colInfo.colB,
          x: rightX,
          y: rowY,
          z: rowZ - 0.25,
          occupantId: null,
          occupiedBy: null,
          group: null,
          fabricMeshes: []
        });
        seatIndex++;
      });
    }

    this.scene.add(stadiumGroup);

    // 3. Load GLTF cinema_chair.glb and clone for all 1,440 seats
    this.gltfLoader.load(
      "/assets/theater/cinema_chair.glb",
      (gltf) => {
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const mat = mesh.material as THREE.Material | undefined;
            const matName = mat && mat.name ? mat.name.toLowerCase() : "";
            const isFabric = matName.includes("fabric") || matName.includes("denim") || matName.includes("brown") || matName.includes("cushion") || matName.includes("seat");
            if (isFabric) {
              mesh.material = themeFabricMat;
              mesh.userData.isFabric = true;
            } else {
              mesh.material = themeFrameMat;
            }
          }
        });

        const seatScale = 0.192;
        gltf.scene.scale.setScalar(seatScale);
        gltf.scene.updateMatrixWorld(true);

        // Calibrate seat cushion depth so front lip aligns with armrests and leaves clean clearance for character legs/shins
        const cushionNames = new Set(["Object_6", "Object_12", "Object_20", "Object_22"]);
        gltf.scene.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && cushionNames.has(child.name)) {
            const geo = (child as THREE.Mesh).geometry;
            const pos = geo.attributes.position;
            let minZ = Infinity;
            for (let i = 0; i < pos.count; i++) {
              const z = pos.getZ(i);
              if (z < minZ) minZ = z;
            }
            const factor = 0.68;
            for (let i = 0; i < pos.count; i++) {
              const z = pos.getZ(i);
              pos.setZ(i, minZ + (z - minZ) * factor);
            }
            pos.needsUpdate = true;
            geo.computeVertexNormals();
            geo.computeBoundingBox();
          }
        });
        gltf.scene.updateMatrixWorld(true);

        const rawBox = new THREE.Box3().setFromObject(gltf.scene);
        const center = rawBox.getCenter(new THREE.Vector3());

        const pivotGroup = new THREE.Group();
        gltf.scene.position.set(-center.x, -rawBox.min.y, -center.z);
        pivotGroup.add(gltf.scene);
        pivotGroup.rotation.y = Math.PI; // Face the screen (-Z)

        let currentSeatIdx = 0;
        for (let r = 0; r < rowCount; r++) {
          const rowZ = startZ + r * rowSpacing;
          const rowY = 0.20 + r * tierHeight;

          moduleCols.forEach((colInfo) => {
            const moduleClone = pivotGroup.clone(true);

            // Eliminate duplicate armrests between adjacent modules
            const isLastInBlock = colInfo.colB === 22 || colInfo.colB === 58 || colInfo.colB === 80;
            if (!isLastInBlock) {
              const toRemove: THREE.Object3D[] = [];
              moduleClone.traverse((child) => {
                if (child.name === "Object_8" || child.name === "Object_16") {
                  toRemove.push(child);
                }
              });
              toRemove.forEach((child) => {
                if (child.parent) child.parent.remove(child);
              });
            }

            moduleClone.position.set(colInfo.modX, rowY, rowZ - 0.25);
            stadiumGroup.add(moduleClone);
            moduleClone.updateMatrixWorld(true);

            // Separate fabric meshes
            const leftFabrics: THREE.Mesh[] = [];
            const rightFabrics: THREE.Mesh[] = [];

            moduleClone.traverse((child) => {
              if ((child as THREE.Mesh).isMesh && child.userData.isFabric) {
                const mesh = child as THREE.Mesh;
                mesh.material = themeFabricMat.clone();
                const childCenter = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
                if (childCenter.x < colInfo.modX) {
                  leftFabrics.push(mesh);
                } else {
                  rightFabrics.push(mesh);
                }
              }
            });

            if (this.seats[currentSeatIdx]) {
              this.seats[currentSeatIdx].group = moduleClone;
              this.seats[currentSeatIdx].fabricMeshes = leftFabrics;
            }
            currentSeatIdx++;

            if (this.seats[currentSeatIdx]) {
              this.seats[currentSeatIdx].group = moduleClone;
              this.seats[currentSeatIdx].fabricMeshes = rightFabrics;
            }
            currentSeatIdx++;
          });
        }
      },
      undefined,
      (err) => {
        console.warn("Could not load GLB theater seats:", err);
      }
    );
  }

  // --- Character & Avatar Management ---

  private loadCharacterModel(presetKey: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
    if (this.modelCache.has(presetKey)) {
      return this.modelCache.get(presetKey)!;
    }

    const preset = CHARACTER_PRESETS[presetKey] || CHARACTER_PRESETS[DEFAULT_CHARACTER];
    const promise = new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
      this.gltfLoader.load(
        preset.url,
        (gltf) => {
          resolve({
            scene: gltf.scene,
            animations: gltf.animations || []
          });
        },
        undefined,
        (err) => reject(err)
      );
    });

    this.modelCache.set(presetKey, promise);
    return promise;
  }

  public createAvatar(user: UserData) {
    if (this.avatars.has(user.id)) {
      this.removeAvatar(user.id);
    }

    const group = new THREE.Group();
    group.name = `avatar_${user.id}`;
    group.position.set(user.position.x, user.position.y, user.position.z);
    group.rotation.y = user.rotation;

    if (user.id === this.localUserId) {
      this.position.set(user.position.x, user.position.y, user.position.z);
      this.rotation = user.rotation;
    }

    const charType = user.characterType || DEFAULT_CHARACTER;
    const preset = CHARACTER_PRESETS[charType] || CHARACTER_PRESETS[DEFAULT_CHARACTER];

    const nameplate = this.createNameplateSprite(user.username, user.speaking, user.inVoice && !user.muted);
    nameplate.position.y = (preset.targetHeight || 0.70) + 0.15;

    // Local player's own nameplate is hidden from their own view in TPP
    if (user.id === this.localUserId) {
      nameplate.visible = false;
    }
    group.add(nameplate);

    group.userData = {
      userId: user.id,
      characterType: charType,
      targetPosition: group.position.clone(),
      targetRotation: group.rotation.y,
      targetHeadPitch: 0,
      targetHeadYaw: 0,
      currentHeadPitch: 0,
      currentHeadYaw: 0,
      nameplate,
      headBone: null,
      leftEyeBone: null,
      rightEyeBone: null,
      leftLegBone: null,
      rightLegBone: null,
      headMeshes: [],
      mixer: null,
      actions: {},
      currentActionName: null
    };

    group.visible = (user.id !== this.localUserId || this.cameraMode !== "FPP");
    this.scene.add(group);
    this.avatars.set(user.id, group);

    this.loadCharacterModel(charType)
      .then(({ scene, animations }) => {
        let model: THREE.Group;
        if (typeof SkeletonUtils !== "undefined" && SkeletonUtils.clone) {
          model = SkeletonUtils.clone(scene) as THREE.Group;
        } else {
          model = scene.clone(true) as THREE.Group;
        }

        const scale = preset.modelScale || 0.60;
        model.scale.setScalar(scale);
        model.updateMatrixWorld(true);

        const headMeshes: THREE.Mesh[] = [];
        let headBone: THREE.Bone | null = null;
        let leftEyeBone: THREE.Bone | null = null;
        let rightEyeBone: THREE.Bone | null = null;
        let leftLegBone: THREE.Bone | null = null;
        let rightLegBone: THREE.Bone | null = null;

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.name && (child.name.includes("Head") || child.name.includes("head") || child.name.includes("Face") || child.name.includes("Hair"))) {
              headMeshes.push(child as THREE.Mesh);
            }
          }
          if ((child as THREE.Bone).isBone) {
            const bone = child as THREE.Bone;
            if (!headBone && (bone.name === "Head" || bone.name.endsWith("Head") || bone.name.endsWith("head"))) {
              headBone = bone;
              headBone.userData.baseRotX = bone.rotation.x;
              headBone.userData.baseRotY = bone.rotation.y;
              headBone.userData.baseRotZ = bone.rotation.z;
            }
            if (!leftEyeBone && (bone.name === "LeftEye" || bone.name.endsWith("LeftEye") || bone.name.endsWith("Eye_L"))) {
              leftEyeBone = bone;
            }
            if (!rightEyeBone && (bone.name === "RightEye" || bone.name.endsWith("RightEye") || bone.name.endsWith("Eye_R"))) {
              rightEyeBone = bone;
            }
            if (bone.name === "LeftLeg" || bone.name.endsWith("LeftLeg") || bone.name.endsWith("Leg_L")) {
              leftLegBone = bone;
            }
            if (bone.name === "RightLeg" || bone.name.endsWith("RightLeg") || bone.name.endsWith("Leg_R")) {
              rightLegBone = bone;
            }
          }
        });

        model.updateMatrixWorld(true);
        const mBox = new THREE.Box3().setFromObject(model);
        model.position.y = -mBox.min.y;

        group.userData.headBone = headBone;
        group.userData.leftEyeBone = leftEyeBone;
        group.userData.rightEyeBone = rightEyeBone;
        group.userData.headMeshes = headMeshes;
        group.userData.leftLegBone = leftLegBone;
        group.userData.rightLegBone = rightLegBone;

        const mixer = new THREE.AnimationMixer(model);
        group.userData.mixer = mixer;

        const actions: Record<string, THREE.AnimationAction> = {};
        const loopOnceKeys = new Set([
          "jump", "cheer", "wave", "laugh", "talk",
          "turn_left_45", "turn_right_45", "turn_left_90", "turn_right_90", "turn_360",
          "sit_down", "stand_up", "standing", "clap", "sitting"
        ]);

        const seatedUpperEmotes = new Set(["cheer", "clap", "wave", "laugh", "talk"]);
        const lowerBodyBones = new Set([
          "Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End"
        ]);

        ALLOWED_ACTIONS.forEach((key) => {
          const clip = this.findActionClip(animations, preset.animMap, key);
          if (clip) {
            const action = mixer.clipAction(clip);
            if (loopOnceKeys.has(key)) {
              action.setLoop(THREE.LoopOnce, 1);
              action.clampWhenFinished = true;
            } else {
              action.setLoop(THREE.LoopRepeat, Infinity);
            }
            actions[key] = action;

            if (seatedUpperEmotes.has(key)) {
              const upperTracks = clip.tracks.filter((t) => {
                const bName = t.name.split(".")[0];
                return !lowerBodyBones.has(bName);
              });
              if (upperTracks.length > 0) {
                const seatedClip = new THREE.AnimationClip(`${key}_seated`, clip.duration, upperTracks);
                const seatedAction = mixer.clipAction(seatedClip);
                seatedAction.setLoop(THREE.LoopOnce, 1);
                seatedAction.clampWhenFinished = false;
                actions[`${key}_seated`] = seatedAction;
              }
            }
          }
        });

        group.userData.actions = actions;
        group.add(model);

        let currentSeatedIdx: number | null = null;
        for (const [sId, oId] of this.seatOccupancy.entries()) {
          if (oId === user.id) {
            currentSeatedIdx = sId;
            break;
          }
        }
        if (currentSeatedIdx === null && user.seated && user.seatIndex !== null) {
          currentSeatedIdx = user.seatIndex;
        }

        if (currentSeatedIdx !== null) {
          this.snapAvatarToSeat(user.id, currentSeatedIdx);
        } else {
          this.playAvatarAction(group, user.action || "idle", 0.0);
        }

        if (user.id === this.localUserId) {
          this.updateLocalAvatarVisibility();
        }
      })
      .catch((err) => {
        console.warn("Could not load character model:", err);
      });

    let currentSeatedIdx: number | null = null;
    for (const [sId, oId] of this.seatOccupancy.entries()) {
      if (oId === user.id) {
        currentSeatedIdx = sId;
        break;
      }
    }
    if (currentSeatedIdx === null && user.seated && user.seatIndex !== null) {
      currentSeatedIdx = user.seatIndex;
    }
    if (currentSeatedIdx !== null) {
      this.snapAvatarToSeat(user.id, currentSeatedIdx);
    }
  }

  private findActionClip(
    animations: THREE.AnimationClip[],
    animMap: Record<string, string>,
    key: string
  ): THREE.AnimationClip | null {
    if (!animations || animations.length === 0) return null;

    if (animMap && animMap[key]) {
      const explicitName = animMap[key].toLowerCase();
      const match = animations.find((a) => a.name.toLowerCase() === explicitName || a.name.toLowerCase().includes(explicitName));
      if (match) return match;
    }

    const keywordMap: Record<string, string[]> = {
      idle: ["idle"],
      walk: ["walk"],
      run: ["run", "sprint"],
      slouch_walk: ["slouch walk", "slouch", "walk"],
      jump: ["jump"],
      cheer: ["cheer", "clap"],
      wave: ["wave"],
      laugh: ["laugh"],
      talk: ["talk", "speak"],
      turn_left_45: ["turn left 45", "turn left"],
      turn_right_45: ["turn right 45", "turn right"],
      turn_left_90: ["turn left 90", "turn left"],
      turn_right_90: ["turn right 90", "turn right"],
      turn_360: ["full turn 360", "turn 360", "spin"],
      sit_down: ["sit down", "sit"],
      stand_up: ["stand up", "stand"],
      sitting: ["sit down (chair)", "sit down", "sit"],
      standing: ["stand up (chair)", "stand up", "stand"],
      clap: ["cheer", "clap"]
    };

    const candidates = keywordMap[key] || [key];
    for (const c of candidates) {
      const match = animations.find((a) => a.name.toLowerCase().includes(c.toLowerCase()));
      if (match) return match;
    }

    return animations[0] || null;
  }

  public playAvatarAction(avatar: THREE.Group, actionName: string, duration: number = 0.2) {
    if (!avatar || !avatar.userData || !ALLOWED_ACTIONS.has(actionName)) return;
    const actions = avatar.userData.actions as Record<string, THREE.AnimationAction> | undefined;
    if (!actions) return;

    const isSeated = avatar.userData.isSeated;

    if (isSeated) {
      if (actions[`${actionName}_seated`]) {
        const seatedAction = actions[`${actionName}_seated`];
        if (avatar.userData.activeSeatedEmote && actions[avatar.userData.activeSeatedEmote] && avatar.userData.activeSeatedEmote !== `${actionName}_seated`) {
          actions[avatar.userData.activeSeatedEmote].stop();
        }
        seatedAction.reset().fadeIn(duration).play();
        avatar.userData.activeSeatedEmote = `${actionName}_seated`;
        return;
      }
      if (actionName === "sitting") {
        const sitAct = actions.sitting || actions.sit_down;
        if (sitAct) {
          sitAct.setLoop(THREE.LoopOnce, 1);
          sitAct.clampWhenFinished = true;
          sitAct.reset();
          sitAct.time = sitAct.getClip().duration;
          sitAct.setEffectiveWeight(1);
          sitAct.play();
        }
        return;
      }
      // Locomotion or standing actions while seated are ignored until standUp is called
      return;
    }

    if (avatar.userData.currentActionName === actionName) return;

    if (avatar.userData.activeSeatedEmote && actions[avatar.userData.activeSeatedEmote]) {
      actions[avatar.userData.activeSeatedEmote].stop();
      avatar.userData.activeSeatedEmote = null;
    }

    const targetAction = actions[actionName] || actions["idle"];
    if (!targetAction) return;

    const prevActionName = avatar.userData.currentActionName;
    const prevAction = prevActionName ? actions[prevActionName] : null;

    if (prevAction && prevAction !== targetAction) {
      prevAction.fadeOut(duration);
    }

    targetAction.reset().fadeIn(duration).play();
    avatar.userData.currentActionName = actionName;
  }

  public snapAvatarToSeat(userId: string, seatIndex: number) {
    const seat = this.seats[seatIndex];
    const avatar = this.avatars.get(userId);
    if (!seat || !avatar) return;

    const charType = avatar.userData.characterType || DEFAULT_CHARACTER;
    const preset = CHARACTER_PRESETS[charType] || CHARACTER_PRESETS[DEFAULT_CHARACTER];

    const yOffset = (preset.seatYOffset !== undefined ? preset.seatYOffset : 0.065) + 0.028;
    const zOffset = preset.seatZOffset !== undefined ? preset.seatZOffset : -0.280;

    // Natural seating placement facing the cinema screen (-Z)
    avatar.position.set(seat.x, seat.y + yOffset, seat.z + zOffset);
    avatar.rotation.y = Math.PI;
    avatar.userData.targetPosition.copy(avatar.position);
    avatar.userData.targetRotation = Math.PI;
    avatar.userData.isSeated = true;
    avatar.userData.currentActionName = "sitting";

    if (userId === this.localUserId) {
      this.rotation = Math.PI;
      this.position.copy(avatar.position);
      this.currentSeatIndex = seatIndex;
      this.cameraYaw = 0;
      this.cameraPitch = 0.08;
    }

    const actions = avatar.userData.actions as Record<string, THREE.AnimationAction> | undefined;
    if (actions) {
      // Fade out any standing or locomotion actions
      Object.keys(actions).forEach((k) => {
        if (k !== "sitting" && k !== "sit_down" && !k.endsWith("_seated")) {
          actions[k].fadeOut(0.15);
        }
      });

      // Play the full Mixamo Sit Down clip clamped at duration
      const sitAct = actions.sitting || actions.sit_down;
      if (sitAct) {
        sitAct.setLoop(THREE.LoopOnce, 1);
        sitAct.clampWhenFinished = true;
        sitAct.reset();
        sitAct.time = sitAct.getClip().duration;
        sitAct.setEffectiveWeight(1);
        sitAct.play();
      }
    }

    const mixer = avatar.userData.mixer as THREE.AnimationMixer | null;
    if (mixer) {
      mixer.update(0);
    }

    if (avatar.userData.nameplate) {
      avatar.userData.nameplate.position.y = (preset.targetHeight || 0.70) + 0.15;
    }
  }

  public updateSeatOccupancy(seatId: number, occupantId: string | null) {
    const seat = this.seats[seatId];
    if (seat) {
      seat.occupantId = occupantId;
      seat.occupiedBy = occupantId;
      if (seat.fabricMeshes && seat.fabricMeshes.length > 0) {
        const targetColor = occupantId ? 0x2563eb : 0x1d3260;
        seat.fabricMeshes.forEach((mesh) => {
          if (mesh.material && (mesh.material as THREE.MeshStandardMaterial).color) {
            (mesh.material as THREE.MeshStandardMaterial).color.set(targetColor);
          }
        });
      }
    }

    if (occupantId) {
      this.seatOccupancy.set(seatId, occupantId);
      this.snapAvatarToSeat(occupantId, seatId);
    } else {
      const prevOccupant = this.seatOccupancy.get(seatId);
      this.seatOccupancy.delete(seatId);
      if (prevOccupant) {
        const prevAvatar = this.avatars.get(prevOccupant);
        if (prevAvatar) {
          prevAvatar.userData.isSeated = false;
          if (prevAvatar.userData.actions) {
            if (prevAvatar.userData.activeSeatedEmote) {
              const act = prevAvatar.userData.actions[prevAvatar.userData.activeSeatedEmote];
              if (act) act.stop();
              prevAvatar.userData.activeSeatedEmote = null;
            }
            const sitAct = prevAvatar.userData.actions.sitting || prevAvatar.userData.actions.sit_down;
            if (sitAct) sitAct.stop();
          }
          prevAvatar.userData.currentActionName = null;
          this.playAvatarAction(prevAvatar, "idle", 0.15);
        }
      }
    }

    if (occupantId === this.localUserId) {
      this.currentSeatIndex = seatId;
      this.snapAvatarToSeat(this.localUserId, seatId);
    } else if (this.currentSeatIndex === seatId && occupantId === null) {
      this.currentSeatIndex = null;
      const myAvatar = this.avatars.get(this.localUserId);
      if (myAvatar) {
        myAvatar.userData.isSeated = false;
        myAvatar.visible = this.cameraMode !== "FPP";
      }
      this.cameraPitch = 0.22;
    }
  }

  public standUp() {
    if (this.currentSeatIndex === null) return;
    const currentSeat = this.seats[this.currentSeatIndex];

    this.currentSeatIndex = null;
    if (this.emoteTimeout) {
      clearTimeout(this.emoteTimeout);
      this.emoteTimeout = null;
    }
    this.activeEmote = null;

    if (currentSeat) {
      this.position.set(currentSeat.x, currentSeat.y, currentSeat.z - 0.45);
      this.rotation = Math.PI;
      this.isGrounded = true;
      this.verticalVelocity = 0;
    }

    const myAvatar = this.avatars.get(this.localUserId);
    if (myAvatar) {
      myAvatar.userData.isSeated = false;
      if (myAvatar.userData.actions) {
        Object.keys(myAvatar.userData.actions).forEach((k) => {
          if (k.endsWith("_seated") || k === "sitting" || k === "sit_down") {
            myAvatar.userData.actions[k].stop();
          }
        });
        myAvatar.userData.activeSeatedEmote = null;
      }
      myAvatar.position.copy(this.position);
      myAvatar.rotation.y = this.rotation;
      myAvatar.userData.targetPosition.copy(this.position);
      if (myAvatar.userData.nameplate) {
        myAvatar.userData.nameplate.position.y = 0.88;
      }
      // Clear currentActionName so playAvatarAction does not early-return, then start idle
      myAvatar.userData.currentActionName = null;
      this.playAvatarAction(myAvatar, "idle", 0.15);
      this.updateLocalAvatarVisibility();
      this.broadcastLocalMovement("idle");
    }
  }

  public removeAvatar(userId: string) {
    const avatar = this.avatars.get(userId);
    if (avatar) {
      this.scene.remove(avatar);
      this.avatars.delete(userId);
    }
  }

  public updateRemoteAvatar(msg: {
    userId: string;
    position?: Vector3Like;
    rotation?: number;
    headPitch?: number;
    headYaw?: number;
    action?: string;
  }) {
    const avatar = this.avatars.get(msg.userId);
    if (!avatar || msg.userId === this.localUserId) return;

    let isSeated = false;
    for (const occupantId of this.seatOccupancy.values()) {
      if (occupantId === msg.userId) {
        isSeated = true;
        break;
      }
    }

    if (!isSeated) {
      if (msg.position) {
        avatar.userData.targetPosition.set(msg.position.x, msg.position.y, msg.position.z);
      }
      if (typeof msg.rotation === "number") {
        avatar.userData.targetRotation = msg.rotation;
      }
      if (msg.action) {
        avatar.userData.lastAction = msg.action;
        this.playAvatarAction(avatar, msg.action, 0.2);
      }
    }

    if (typeof msg.headPitch === "number") {
      avatar.userData.targetHeadPitch = msg.headPitch;
    }
    if (typeof msg.headYaw === "number") {
      avatar.userData.targetHeadYaw = msg.headYaw;
    }
  }

  public handleRemoteEmote(msg: { userId: string; action: string }) {
    const avatar = this.avatars.get(msg.userId);
    if (!avatar || msg.userId === this.localUserId) return;

    const action = msg.action;
    let seatIdx = -1;
    for (const [sId, oId] of this.seatOccupancy.entries()) {
      if (oId === msg.userId) {
        seatIdx = sId;
        break;
      }
    }

    const isSeated = seatIdx !== -1;
    if (isSeated && action === "turn_360") {
      return;
    }

    this.playAvatarAction(avatar, action, 0.15);
    const duration = EMOTE_DURATIONS[action] || 2200;

    setTimeout(() => {
      if (!this.avatars.has(msg.userId)) return;
      if (isSeated) {
        if (avatar.userData.activeSeatedEmote && avatar.userData.actions) {
          const act = avatar.userData.actions[avatar.userData.activeSeatedEmote];
          if (act) act.fadeOut(0.25);
          avatar.userData.activeSeatedEmote = null;
        }
        const actions = avatar.userData.actions as Record<string, THREE.AnimationAction> | undefined;
        if (actions) {
          const sitAct = actions.sitting || actions.sit_down;
          if (sitAct) {
            sitAct.setEffectiveWeight(1);
          }
        }
      } else {
        this.playAvatarAction(avatar, "idle", 0.2);
      }
    }, duration);
  }

  public triggerLocalEmote(actionName: string) {
    const myAvatar = this.avatars.get(this.localUserId);
    if (!myAvatar) return;

    const isSeated = this.currentSeatIndex !== null;
    if (isSeated && actionName === "turn_360") {
      return;
    }

    this.activeEmote = actionName;
    this.playAvatarAction(myAvatar, actionName, 0.15);
    const duration = EMOTE_DURATIONS[actionName] || 2200;

    if (this.emoteTimeout) clearTimeout(this.emoteTimeout);
    this.emoteTimeout = setTimeout(() => {
      this.activeEmote = null;
      if (this.currentSeatIndex !== null) {
        if (myAvatar.userData.activeSeatedEmote && myAvatar.userData.actions) {
          const act = myAvatar.userData.actions[myAvatar.userData.activeSeatedEmote];
          if (act) act.fadeOut(0.25);
          myAvatar.userData.activeSeatedEmote = null;
        }
        const actions = myAvatar.userData.actions as Record<string, THREE.AnimationAction> | undefined;
        if (actions) {
          const sitAct = actions.sitting || actions.sit_down;
          if (sitAct) {
            sitAct.setEffectiveWeight(1);
          }
        }
      } else {
        this.playAvatarAction(myAvatar, "idle", 0.2);
      }
    }, duration);
  }

  public updateNameplate(userId: string, isSpeaking: boolean, isMicOn: boolean) {
    const avatar = this.avatars.get(userId);
    if (!avatar || !avatar.userData.nameplate) return;

    const oldNameplate = avatar.userData.nameplate as THREE.Sprite;
    const username = oldNameplate.userData?.username || "Guest";

    avatar.remove(oldNameplate);
    oldNameplate.material.dispose();

    const newNameplate = this.createNameplateSprite(username, isSpeaking, isMicOn);
    newNameplate.position.copy(oldNameplate.position);
    if (userId === this.localUserId) {
      newNameplate.visible = false;
    }
    avatar.add(newNameplate);
    avatar.userData.nameplate = newNameplate;
  }

  private createNameplateSprite(username: string, isSpeaking: boolean, isMicOn: boolean): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return new THREE.Sprite();

    ctx.fillStyle = isSpeaking ? "rgba(34, 197, 94, 0.85)" : "rgba(15, 23, 42, 0.75)";
    ctx.roundRect(10, 10, 236, 44, 22);
    ctx.fill();

    ctx.strokeStyle = isSpeaking ? "#4ade80" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 2;
    ctx.roundRect(10, 10, 236, 44, 22);
    ctx.stroke();

    ctx.font = "bold 20px 'Satoshi', system-ui, sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const mic = isMicOn ? "" : " (Muted)";
    ctx.fillText(`${username}${mic}`, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.9, 0.225, 1);
    sprite.userData = { username };
    return sprite;
  }

  public updateLocalAvatarVisibility() {
    const myAvatar = this.avatars.get(this.localUserId);
    if (myAvatar) {
      myAvatar.visible = this.cameraMode !== "FPP";
    }
  }

  // --- Exact Ground Physics & Collision ---

  public getExactTheaterGround(x: number, z: number): number {
    if (z < -9.03) {
      // Curved Proscenium Stage & Steps below the screen
      const stepR = 34;
      const xCurve = (x * x) / (2 * stepR);
      const stageEdge = -14.6 - xCurve;
      if (z <= stageEdge) return 0.18; // Main stage apron
      if (z <= stageEdge + 0.45) return 0.12; // Step 2 (higher riser)
      if (z <= stageEdge + 0.90) return 0.06; // Step 1 (lower riser)
      return 0.0;
    }
    if (z < -8.47) {
      return z < -8.75 ? 0.07 : 0.14;
    }
    if (z >= 15.10) return 2.92;

    const isStairs = Math.abs(x - (-7.08)) <= 0.65 || Math.abs(x - 7.08) <= 0.65;
    const relZ = z - (-8.47);
    const r = Math.max(0, Math.min(17, Math.floor(relZ / 1.35)));
    const rowY = 0.20 + r * 0.16;

    if (isStairs) {
      const fraction = (relZ - r * 1.35) / 1.35;
      return (fraction < 0.5) ? (rowY - 0.08) : rowY;
    }
    return rowY;
  }

  public checkTheaterCollision(x: number, z: number, radius: number = 0.14): boolean {
    if (x - radius < -15.6 || x + radius > 15.6) return true;
    if (z - radius < -18.6 || z + radius > 18.4) return true;

    const startZ = -7.0;
    const rowSpacing = 1.35;
    const rowCount = 18;

    for (let r = 0; r < rowCount; r++) {
      const rowZ = startZ + r * rowSpacing;
      const chairZMin = rowZ - 0.42;
      const chairZMax = rowZ + 0.05;

      if (z + radius > chairZMin && z - radius < chairZMax) {
        if (x + radius > -15.65 && x - radius < -7.60) return true;
        if (x + radius > -6.55 && x - radius < 6.55) return true;
        if (x + radius > 7.60 && x - radius < 15.65) return true;
      }
    }

    return false;
  }

  // --- User Locomotion & Physics ---

  private updateLocalMovement(delta: number) {
    if (this.currentSeatIndex !== null) {
      const hasMoveKey = this.activeKeys.has("KeyW") || this.activeKeys.has("KeyS") ||
                         this.activeKeys.has("KeyA") || this.activeKeys.has("KeyD") ||
                         this.activeKeys.has("ArrowUp") || this.activeKeys.has("ArrowDown") ||
                         this.activeKeys.has("ArrowLeft") || this.activeKeys.has("ArrowRight") ||
                         this.activeKeys.has("Space");
      if (hasMoveKey) {
        this.standUp();
        if (this.callbacks.onStandUp) {
          this.callbacks.onStandUp();
        }
      } else {
        return;
      }
    }

    const myAvatar = this.avatars.get(this.localUserId);

    const moveDir = new THREE.Vector3();
    if (this.activeKeys.has("KeyW") || this.activeKeys.has("ArrowUp")) moveDir.z -= 1;
    if (this.activeKeys.has("KeyS") || this.activeKeys.has("ArrowDown")) moveDir.z += 1;
    if (this.activeKeys.has("KeyA") || this.activeKeys.has("ArrowLeft")) moveDir.x -= 1;
    if (this.activeKeys.has("KeyD") || this.activeKeys.has("ArrowRight")) moveDir.x += 1;

    const isMoving = moveDir.lengthSq() > 0;
    this.isRunning = isMoving && (this.activeKeys.has("ShiftLeft") || this.activeKeys.has("ShiftRight"));
    const isSlouch = isMoving && !this.isRunning && this.isSlouchWalk;

    const targetGroundY = this.getExactTheaterGround(this.position.x, this.position.z);

    if (this.activeKeys.has("Space") && this.isGrounded && !this.isJumping) {
      this.verticalVelocity = 4.2;
      this.isGrounded = false;
      this.isJumping = true;
      if (myAvatar) this.playAvatarAction(myAvatar, "jump", 0.1);
    }

    if (!this.isGrounded) {
      this.verticalVelocity -= 14.0 * delta;
      this.position.y += this.verticalVelocity * delta;
      if (this.position.y <= targetGroundY) {
        this.position.y = targetGroundY;
        this.verticalVelocity = 0;
        this.isGrounded = true;
        this.isJumping = false;
      }
    } else {
      if (Math.abs(this.position.y - targetGroundY) < 0.005) {
        this.position.y = targetGroundY;
      } else {
        this.position.y = THREE.MathUtils.damp(this.position.y, targetGroundY, 22.0, delta);
      }
    }

    if (isMoving) {
      if (this.activeEmote) {
        this.activeEmote = null;
        if (this.emoteTimeout) clearTimeout(this.emoteTimeout);
      }

      moveDir.normalize();
      moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraYaw);

      const speed = this.isRunning ? 2.52 : 1.32;
      const dx = moveDir.x * delta * speed;
      const dz = moveDir.z * delta * speed;

      const nextX = this.position.x + dx;
      const nextZ = this.position.z + dz;

      const currBlocked = this.checkTheaterCollision(this.position.x, this.position.z);
      if (!this.checkTheaterCollision(nextX, nextZ)) {
        this.position.x = nextX;
        this.position.z = nextZ;
      } else {
        let moved = false;
        if (!this.checkTheaterCollision(nextX, this.position.z)) {
          this.position.x = nextX;
          moved = true;
        }
        if (!this.checkTheaterCollision(this.position.x, nextZ)) {
          this.position.z = nextZ;
          moved = true;
        }
        if (!moved && currBlocked) {
          this.position.x = nextX;
          this.position.z = nextZ;
        }
      }

      this.rotation = Math.atan2(moveDir.x, moveDir.z);
    }

    if (this.cameraMode === "FPP" && this.currentSeatIndex === null) {
      if (!isMoving) {
        this.rotation = THREE.MathUtils.lerp(this.rotation, this.cameraYaw + Math.PI, 0.25);
      }
    }

    if (myAvatar) {
      myAvatar.position.copy(this.position);
      myAvatar.rotation.y = this.rotation;
      myAvatar.userData.targetPosition.copy(this.position);
    }

    let currentAction = "idle";
    if (this.activeEmote) {
      currentAction = this.activeEmote;
    } else if (!this.isGrounded || this.isJumping) {
      currentAction = "jump";
    } else if (isMoving) {
      currentAction = this.isRunning ? "run" : (isSlouch ? "slouch_walk" : "walk");
    } else {
      currentAction = "idle";
    }

    if (myAvatar) {
      this.playAvatarAction(myAvatar, currentAction, currentAction === "jump" ? 0.1 : 0.2);
    }

    this.broadcastLocalMovement(currentAction);
  }

  private broadcastLocalMovement(action: string = "idle") {
    const now = performance.now();
    const timeSinceLast = now - this.lastMoveSendTime;

    const myAvatar = this.avatars.get(this.localUserId);
    const headPitch = (myAvatar && myAvatar.userData.currentHeadPitch !== undefined)
      ? myAvatar.userData.currentHeadPitch
      : Math.max(-0.65, Math.min(0.65, this.cameraPitch));
    const headYaw = (myAvatar && myAvatar.userData.currentHeadYaw !== undefined)
      ? myAvatar.userData.currentHeadYaw
      : 0;

    const posDist = this.position.distanceTo(this.lastSentPos);
    const rotDiff = Math.abs(this.rotation - this.lastSentRot);
    const pitchDiff = Math.abs(headPitch - this.lastSentPitch);
    const yawDiff = Math.abs(headYaw - this.lastSentYaw);
    const actionChanged = action !== this.lastSentAction;

    const isMoving = action === "walk" || action === "run" || action === "slouch_walk" || action === "jump";

    // Strictly rate-limited and change-filtered to eliminate multiplayer packet lag and stops
    const shouldSend =
      actionChanged ||
      (isMoving && timeSinceLast >= 50 && posDist > 0.015) ||
      (!isMoving && timeSinceLast >= 75 && (rotDiff > 0.025 || pitchDiff > 0.04 || yawDiff > 0.04)) ||
      (timeSinceLast >= 1800);

    if (shouldSend) {
      this.lastMoveSendTime = now;
      this.lastSentPos.copy(this.position);
      this.lastSentRot = this.rotation;
      this.lastSentPitch = headPitch;
      this.lastSentYaw = headYaw;
      this.lastSentAction = action;

      if (this.callbacks.onLocalMovement) {
        this.callbacks.onLocalMovement(
          { x: this.position.x, y: this.position.y, z: this.position.z },
          this.rotation,
          headPitch,
          headYaw,
          action
        );
      }
    }
  }

  // --- Camera & Head Movement ---

  private updateCamera(delta: number) {
    if (!this.camera) return;

    if (this.cameraMode === "FPP") {
      this.fppFov = THREE.MathUtils.damp(this.fppFov, this.targetFppFov, 12.0, delta);
      if (Math.abs(this.camera.fov - this.fppFov) > 0.02) {
        this.camera.fov = this.fppFov;
        this.camera.updateProjectionMatrix();
      }
    } else {
      if (Math.abs(this.camera.fov - 56) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 56, 10.0, delta);
        this.camera.updateProjectionMatrix();
      }
    }

    const myAvatar = this.avatars.get(this.localUserId);
    let exactEyePos: THREE.Vector3 | null = null;

    if (myAvatar) {
      myAvatar.updateMatrixWorld(true);
      const lEye = myAvatar.userData.leftEyeBone as THREE.Bone | null;
      const rEye = myAvatar.userData.rightEyeBone as THREE.Bone | null;
      const hBone = myAvatar.userData.headBone as THREE.Bone | null;

      if (lEye && rEye) {
        const pL = new THREE.Vector3();
        const pR = new THREE.Vector3();
        lEye.getWorldPosition(pL);
        rEye.getWorldPosition(pR);
        exactEyePos = pL.add(pR).multiplyScalar(0.5);
      } else if (hBone) {
        exactEyePos = new THREE.Vector3();
        hBone.getWorldPosition(exactEyePos);
        exactEyePos.y += 0.02;
      }
    }

    const lookDir = new THREE.Vector3(
      -Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      -Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
    );

    if (this.currentSeatIndex !== null) {
      // Seated Camera
      const seat = this.seats[this.currentSeatIndex];
      if (seat) {
        if (this.cameraMode === "FPP") {
          const baseHeight = exactEyePos ? exactEyePos.y - seat.y : 0.54;
          const elevatedY = seat.y + baseHeight * 1.20;
          const eyePos = exactEyePos ? exactEyePos.clone() : new THREE.Vector3(seat.x, elevatedY, seat.z - 0.14);
          eyePos.y = elevatedY;
          eyePos.addScaledVector(lookDir, 0.04);

          this.camera.position.lerp(eyePos, 0.35);
          const targetLook = eyePos.clone().add(lookDir.clone().multiplyScalar(10));
          this.camera.lookAt(targetLook);
        } else {
          const seatCenter = new THREE.Vector3(seat.x, seat.y + 0.56, seat.z - 0.12);
          const dist = this.seatedTppDistance;
          const offset = new THREE.Vector3(
            Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
            Math.sin(this.cameraPitch) + 0.22,
            Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
          ).multiplyScalar(dist);
          const desiredPos = seatCenter.clone().add(offset);
          this.camera.position.lerp(desiredPos, 0.22);
          this.camera.lookAt(seatCenter);
        }
      }
    } else {
      // Standing Camera
      if (this.cameraMode === "FPP") {
        const baseHeight = exactEyePos ? exactEyePos.y - this.position.y : 0.65;
        const elevatedY = this.position.y + baseHeight * 1.20;
        const eyePos = exactEyePos
          ? exactEyePos.clone()
          : this.position.clone().add(new THREE.Vector3(0, elevatedY, 0));
        eyePos.y = elevatedY;
        eyePos.addScaledVector(lookDir, 0.04);

        this.camera.position.lerp(eyePos, 0.35);
        const targetLook = eyePos.clone().add(lookDir.clone().multiplyScalar(10));
        this.camera.lookAt(targetLook);
      } else {
        const rawTarget = this.position.clone().add(new THREE.Vector3(0, 0.58, 0));
        this.smoothedCameraTarget.x = rawTarget.x;
        this.smoothedCameraTarget.z = rawTarget.z;
        if (this.smoothedCameraTarget.y === 0) {
          this.smoothedCameraTarget.y = rawTarget.y;
        } else {
          this.smoothedCameraTarget.y = THREE.MathUtils.damp(this.smoothedCameraTarget.y, rawTarget.y, 14.0, delta);
        }

        const dist = this.cameraDistance;
        const offset = new THREE.Vector3(
          Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
          Math.sin(this.cameraPitch) + 0.22,
          Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch)
        ).multiplyScalar(dist);

        const desiredCameraPos = this.smoothedCameraTarget.clone().add(offset);
        this.camera.position.lerp(desiredCameraPos, 0.22);
        this.camera.lookAt(this.smoothedCameraTarget);
      }
    }
  }

  // --- Animation Loop ---

  private animate() {
    if (this.isDestroyed) return;
    this.animationFrameId = requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);

    this.updateLocalMovement(delta);
    this.updateCamera(delta);

    // 1. Advance skeletal animation mixers
    this.avatars.forEach((avatar) => {
      const mixer = avatar.userData.mixer as THREE.AnimationMixer | null;
      if (mixer) {
        mixer.update(delta);
      }
    });

    // 2. Realistic Head Movement Tracking
    const myAvatar = this.avatars.get(this.localUserId);
    if (myAvatar) {
      const shouldBeVisible = this.cameraMode !== "FPP";
      if (myAvatar.visible !== shouldBeVisible) {
        myAvatar.visible = shouldBeVisible;
      }

      const bone = myAvatar.userData.headBone as THREE.Bone | null;
      if (bone) {
        const lookDirX = -Math.sin(this.cameraYaw);
        const lookDirZ = -Math.cos(this.cameraYaw);
        const camAngle = Math.atan2(lookDirX, lookDirZ);
        const isSeated = this.currentSeatIndex !== null;
        const avatarAngle = isSeated ? Math.PI : this.rotation;
        const diff = Math.atan2(Math.sin(camAngle - avatarAngle), Math.cos(camAngle - avatarAngle));

        const maxHeadTurn = 75 * (Math.PI / 180);
        let targetYaw = 0;
        if (Math.abs(diff) <= Math.PI / 2) {
          targetYaw = Math.max(-maxHeadTurn, Math.min(maxHeadTurn, diff));
        } else {
          const factor = Math.max(0, (Math.PI - Math.abs(diff)) / (Math.PI / 2));
          targetYaw = Math.sign(diff) * maxHeadTurn * factor;
        }

        const targetPitch = Math.max(-0.65, Math.min(0.65, this.cameraPitch));

        if (myAvatar.userData.currentHeadYaw === undefined) myAvatar.userData.currentHeadYaw = 0;
        if (myAvatar.userData.currentHeadPitch === undefined) myAvatar.userData.currentHeadPitch = 0;

        myAvatar.userData.currentHeadYaw = THREE.MathUtils.damp(myAvatar.userData.currentHeadYaw, targetYaw, 4.5, delta);
        myAvatar.userData.currentHeadPitch = THREE.MathUtils.damp(myAvatar.userData.currentHeadPitch, targetPitch, 4.5, delta);

        const baseRotX = bone.userData.baseRotX !== undefined ? bone.userData.baseRotX : 0;
        const baseRotY = bone.userData.baseRotY !== undefined ? bone.userData.baseRotY : 0;

        bone.rotation.x = baseRotX - myAvatar.userData.currentHeadPitch;
        bone.rotation.y = baseRotY + myAvatar.userData.currentHeadYaw;
      }
    }

    // 3. Remote Avatars High-Precision Delta Damping & Head Tracking
    this.avatars.forEach((avatar, id) => {
      if (id !== this.localUserId) {
        const targetPos = avatar.userData.targetPosition as THREE.Vector3;
        const dist = avatar.position.distanceTo(targetPos);

        if (dist > 3.0) {
          avatar.position.copy(targetPos);
        } else if (dist > 0.005) {
          const isRunning = avatar.userData.lastAction === "run";
          const dampSpeed = isRunning ? 22.0 : 16.0;
          avatar.position.x = THREE.MathUtils.damp(avatar.position.x, targetPos.x, dampSpeed, delta);
          avatar.position.y = THREE.MathUtils.damp(avatar.position.y, targetPos.y, dampSpeed, delta);
          avatar.position.z = THREE.MathUtils.damp(avatar.position.z, targetPos.z, dampSpeed, delta);
        }

        const targetRot = (avatar.userData.targetRotation as number) || 0;
        let rotDiff = targetRot - avatar.rotation.y;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        avatar.rotation.y += rotDiff * (1 - Math.exp(-16.0 * delta));

        const bone = avatar.userData.headBone as THREE.Bone | null;
        if (bone) {
          const targetPitch = Math.max(-0.65, Math.min(0.65, (avatar.userData.targetHeadPitch as number) || 0));
          const targetYaw = Math.max(-1.31, Math.min(1.31, (avatar.userData.targetHeadYaw as number) || 0));

          if (avatar.userData.currentHeadYaw === undefined) avatar.userData.currentHeadYaw = 0;
          if (avatar.userData.currentHeadPitch === undefined) avatar.userData.currentHeadPitch = 0;

          avatar.userData.currentHeadYaw = THREE.MathUtils.damp(avatar.userData.currentHeadYaw, targetYaw, 5.0, delta);
          avatar.userData.currentHeadPitch = THREE.MathUtils.damp(avatar.userData.currentHeadPitch, targetPitch, 5.0, delta);

          const baseRotX = bone.userData.baseRotX !== undefined ? bone.userData.baseRotX : 0;
          const baseRotY = bone.userData.baseRotY !== undefined ? bone.userData.baseRotY : 0;

          bone.rotation.x = baseRotX - avatar.userData.currentHeadPitch;
          bone.rotation.y = baseRotY + avatar.userData.currentHeadYaw;
        }
      }
    });

    // Ultra-smooth native 60fps/120fps video frame upload to GPU on every render frame
    if (this.videoTexture && this.videoElement && !this.videoElement.paused && this.videoElement.readyState >= 2) {
      this.videoTexture.needsUpdate = true;
    }

    this.spatialAudio.updateListener(this.camera);

    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // --- Interaction & Event Binding ---

  public setVirtualKey(code: string, pressed: boolean) {
    if (pressed) {
      this.activeKeys.add(code);
    } else {
      this.activeKeys.delete(code);
    }
  }

  private bindEvents() {
    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    const dom = this.renderer.domElement;
    dom.style.touchAction = "none";
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("pointercancel", this.onPointerUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private onWindowResize = () => {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (["input", "textarea"].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
      return;
    }

    this.activeKeys.add(e.code);

    if (e.code === "KeyV") {
      this.toggleCameraMode();
    } else if (e.code === "KeyZ") {
      this.isSlouchWalk = !this.isSlouchWalk;
    } else if (e.code === "KeyC") {
      if (this.callbacks.onEmoteTriggered) {
        this.callbacks.onEmoteTriggered("clap");
      } else {
        this.triggerLocalEmote("clap");
      }
    } else if (e.code === "KeyG") {
      if (this.callbacks.onEmoteTriggered) {
        this.callbacks.onEmoteTriggered("wave");
      } else {
        this.triggerLocalEmote("wave");
      }
    } else if (e.code === "KeyL") {
      if (this.callbacks.onEmoteTriggered) {
        this.callbacks.onEmoteTriggered("laugh");
      } else {
        this.triggerLocalEmote("laugh");
      }
    } else if (e.code === "KeyT") {
      if (this.callbacks.onEmoteTriggered) {
        this.callbacks.onEmoteTriggered("talk");
      } else {
        this.triggerLocalEmote("talk");
      }
    } else if (e.code === "KeyR") {
      if (this.callbacks.onEmoteTriggered) {
        this.callbacks.onEmoteTriggered("turn_360");
      } else {
        this.triggerLocalEmote("turn_360");
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.activeKeys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent) => {
    this.spatialAudio.resume();
    if (e.button !== 0 && e.pointerType === "mouse") return;
    this.isPointerDown = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.hasDragged = false;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.renderer || !this.camera) return;

    if (this.isPointerDown) {
      const dist = Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY);
      if (dist > 5) {
        this.hasDragged = true;
        if (this.callbacks.onSeatHover) {
          this.callbacks.onSeatHover(null);
        }
      }

      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      this.cameraYaw -= dx * 0.004;
      this.cameraPitch = Math.max(-Math.PI / 2.6, Math.min(Math.PI / 2.4, this.cameraPitch - dy * 0.004));
      return;
    }

    // Hover detection over seats
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouseVec, this.camera);
    const hits = this.raycaster.intersectObjects(this.seatHitboxes, false);

    if (hits.length > 0) {
      const sIdx = hits[0].object.userData.seatIndex;
      const seat = this.seats[sIdx];
      if (seat) {
        document.body.style.cursor = "pointer";
        if (this.callbacks.onSeatHover) {
          this.callbacks.onSeatHover({
            visible: true,
            text: seat.occupantId
              ? `Row ${seat.row}, Seat ${seat.col} (Occupied)`
              : `Click to sit: Row ${seat.row}, Seat ${seat.col}`,
            x: e.clientX + 14,
            y: e.clientY - 24
          });
        }
        return;
      }
    }

    document.body.style.cursor = "default";
    if (this.callbacks.onSeatHover) {
      this.callbacks.onSeatHover(null);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    if (!this.hasDragged) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      this.raycaster.setFromCamera(this.mouseVec, this.camera);
      const hits = this.raycaster.intersectObjects(this.seatHitboxes, false);

      if (hits.length > 0) {
        const sIdx = hits[0].object.userData.seatIndex;
        if (sIdx !== this.currentSeatIndex) {
          const seat = this.seats[sIdx];
          if (seat && !seat.occupantId && this.callbacks.onSeatClicked) {
            this.callbacks.onSeatClicked(sIdx);
          }
        }
      }
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.cameraMode === "FPP") {
      this.targetFppFov = Math.max(30, Math.min(85, this.targetFppFov + (e.deltaY > 0 ? 3 : -3)));
    } else {
      if (this.currentSeatIndex !== null) {
        this.seatedTppDistance = Math.max(0.65, Math.min(2.4, this.seatedTppDistance + (e.deltaY > 0 ? 0.12 : -0.12)));
      } else {
        this.cameraDistance = Math.max(0.75, Math.min(3.2, this.cameraDistance + (e.deltaY > 0 ? 0.15 : -0.15)));
      }
    }
  };

  public toggleCameraMode(): CameraMode {
    this.cameraMode = this.cameraMode === "TPP" ? "FPP" : "TPP";
    this.updateLocalAvatarVisibility();
    if (this.callbacks.onCameraModeChanged) {
      this.callbacks.onCameraModeChanged(this.cameraMode);
    }
    return this.cameraMode;
  }

  // --- Illuminated Seat Row Numbering & Alphabet Plaques ---

  private getRowPlaqueTexture(rowLetter: string, seatRange: string): THREE.CanvasTexture {
    const key = `${rowLetter}_${seatRange}`;
    let texture = this.rowPlaqueTextureCache.get(key);
    if (!texture) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        this.drawRowPlaque(ctx, rowLetter, seatRange);
      }
      texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.rowPlaqueTextureCache.set(key, texture);
    }
    return texture;
  }

  private drawRowPlaque(ctx: CanvasRenderingContext2D, rowLetter: string, seatRange: string) {
    const w = 512;
    const h = 256;
    ctx.clearRect(0, 0, w, h);

    // 1. Deep cinema acrylic backing
    ctx.fillStyle = "#070c18";
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 24);
    ctx.fill();

    // 2. Mild blue backlight gradient (calibrated, no harsh glare)
    const glow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 220);
    glow.addColorStop(0, "rgba(56, 189, 248, 0.20)");
    glow.addColorStop(0.55, "rgba(30, 64, 175, 0.10)");
    glow.addColorStop(1, "rgba(7, 12, 24, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.roundRect(12, 12, w - 24, h - 24, 22);
    ctx.fill();

    // 3. Clean neon border (calibrated)
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 3.5;
    ctx.shadowColor = "rgba(56, 189, 248, 0.65)";
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.roundRect(14, 14, w - 28, h - 28, 20);
    ctx.stroke();

    // 4. Row Alphabet Header (e.g. ROW A) - 10% reduced brightness (#e2e8f0)
    ctx.shadowColor = "rgba(56, 189, 248, 0.68)";
    ctx.shadowBlur = 11;
    ctx.font = "bold 80px 'Satoshi', system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`ROW ${rowLetter}`, w / 2, 86);

    // 5. Mild illuminated horizontal accent line
    ctx.shadowBlur = 5;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 140, 140);
    ctx.lineTo(w / 2 + 140, 140);
    ctx.stroke();

    // 6. Seat Range with alphabet (e.g. A 1 - 22) - 10% reduced brightness (#7dd3fc)
    ctx.shadowColor = "rgba(125, 211, 252, 0.60)";
    ctx.shadowBlur = 8;
    ctx.font = "600 52px 'Satoshi', system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#7dd3fc";
    ctx.fillText(seatRange, w / 2, 192);
  }

  private refreshRowPlaques() {
    this.rowPlaqueTextureCache.forEach((texture, key) => {
      const [rowLetter, seatRange] = key.split("_");
      const canvas = texture.image as HTMLCanvasElement;
      if (canvas && canvas.getContext) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          this.drawRowPlaque(ctx, rowLetter, seatRange);
          texture.needsUpdate = true;
        }
      }
    });
  }

  private createPlaqueMesh(
    x: number,
    y: number,
    z: number,
    normalX: number,
    texture: THREE.CanvasTexture,
    frameMat: THREE.Material
  ): THREE.Group {
    const group = new THREE.Group();

    // Flush frame backing (no protruding glare quad)
    const frameGeo = new THREE.BoxGeometry(0.16, 0.088, 0.014);
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    group.add(frameMesh);

    // Front illuminated plaque display
    const signGeo = new THREE.PlaneGeometry(0.154, 0.082);
    const signMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.96,
      depthWrite: true
    });
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.z = 0.0075;
    group.add(signMesh);

    group.position.set(x, y, z);
    group.rotation.y = normalX > 0 ? Math.PI / 2 : -Math.PI / 2;

    return group;
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);

    const dom = this.renderer?.domElement;
    if (dom) {
      dom.removeEventListener("pointerdown", this.onPointerDown);
      dom.removeEventListener("pointermove", this.onPointerMove);
      window.removeEventListener("pointerup", this.onPointerUp);
      dom.removeEventListener("pointercancel", this.onPointerUp);
      dom.removeEventListener("wheel", this.onWheel);
      if (dom.parentElement) {
        dom.parentElement.removeChild(dom);
      }
    }

    this.rowPlaqueTextureCache.forEach((tex) => tex.dispose());
    this.rowPlaqueTextureCache.clear();

    this.spatialAudio.destroy();

    if (this.videoTexture) {
      this.videoTexture.dispose();
    }
    if (this.defaultScreenTexture) {
      this.defaultScreenTexture.dispose();
    }

    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
