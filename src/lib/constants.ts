import { CharacterPreset, LightingState, MovieState, SideLightMode } from "../types/cinema";

export const SHARED_ANIM_MAP: Record<string, string> = {
  idle: "Idle",
  walk: "Walk",
  run: "Run",
  slouch_walk: "Slouch walk",
  jump: "Jump",
  cheer: "Cheer",
  wave: "Wave",
  laugh: "Laugh",
  talk: "Talk",
  turn_left_45: "Turn left 45°",
  turn_right_45: "Turn right 45°",
  turn_left_90: "Turn left 90°",
  turn_right_90: "Turn right 90°",
  turn_360: "Full turn 360°",
  sit_down: "Sit down (chair)",
  stand_up: "Stand up (chair)",
  sitting: "Sit down (chair)",
  standing: "Stand up (chair)",
  clap: "Cheer"
};

export const CHARACTER_PRESETS: Record<string, CharacterPreset> = {
  // --- Female Characters (6 models) ---
  character_406814: {
    name: "Female 1",
    icon: "F1",
    url: "/assets/characters/female/character_406814.glb",
    modelScale: 0.539,
    targetHeight: 0.67,
    seatYOffset: 0.076,
    seatZOffset: -0.271,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406815: {
    name: "Female 2",
    icon: "F2",
    url: "/assets/characters/female/character_406815.glb",
    modelScale: 0.447,
    targetHeight: 0.68,
    seatYOffset: 0.063,
    seatZOffset: -0.279,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406816: {
    name: "Female 3",
    icon: "F3",
    url: "/assets/characters/female/character_406816.glb",
    modelScale: 0.495,
    targetHeight: 0.67,
    seatYOffset: 0.069,
    seatZOffset: -0.277,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406817: {
    name: "Female 4",
    icon: "F4",
    url: "/assets/characters/female/character_406817.glb",
    modelScale: 0.519,
    targetHeight: 0.66,
    seatYOffset: 0.073,
    seatZOffset: -0.276,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406825: {
    name: "Female 5",
    icon: "F5",
    url: "/assets/characters/female/character_406825.glb",
    modelScale: 0.486,
    targetHeight: 0.68,
    seatYOffset: 0.076,
    seatZOffset: -0.270,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406826: {
    name: "Female 6",
    icon: "F6",
    url: "/assets/characters/female/character_406826.glb",
    modelScale: 0.483,
    targetHeight: 0.68,
    seatYOffset: 0.067,
    seatZOffset: -0.277,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },

  // --- Male Characters (7 models) ---
  character_406818: {
    name: "Male 1",
    icon: "M1",
    url: "/assets/characters/male/character_406818.glb",
    modelScale: 0.475,
    targetHeight: 0.71,
    seatYOffset: 0.069,
    seatZOffset: -0.280,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406819: {
    name: "Male 2",
    icon: "M2",
    url: "/assets/characters/male/character_406819.glb",
    modelScale: 0.471,
    targetHeight: 0.71,
    seatYOffset: 0.059,
    seatZOffset: -0.287,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406820: {
    name: "Male 3",
    icon: "M3",
    url: "/assets/characters/male/character_406820.glb",
    modelScale: 0.472,
    targetHeight: 0.71,
    seatYOffset: 0.054,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406821: {
    name: "Male 4",
    icon: "M4",
    url: "/assets/characters/male/character_406821.glb",
    modelScale: 0.477,
    targetHeight: 0.70,
    seatYOffset: 0.072,
    seatZOffset: -0.284,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406822: {
    name: "Male 5",
    icon: "M5",
    url: "/assets/characters/male/character_406822.glb",
    modelScale: 0.421,
    targetHeight: 0.73,
    seatYOffset: 0.044,
    seatZOffset: -0.293,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406823: {
    name: "Male 6",
    icon: "M6",
    url: "/assets/characters/male/character_406823.glb",
    modelScale: 0.423,
    targetHeight: 0.72,
    seatYOffset: 0.051,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  },
  character_406824: {
    name: "Male 7",
    icon: "M7",
    url: "/assets/characters/male/character_406824.glb",
    modelScale: 0.421,
    targetHeight: 0.72,
    seatYOffset: 0.052,
    seatZOffset: -0.290,
    armatureType: "Mixamo",
    animMap: SHARED_ANIM_MAP
  }
};

export const DEFAULT_CHARACTER = "character_406814";

export const ALLOWED_ACTIONS = new Set([
  "idle",
  "walk",
  "run",
  "slouch_walk",
  "jump",
  "cheer",
  "wave",
  "laugh",
  "talk",
  "turn_left_45",
  "turn_right_45",
  "turn_left_90",
  "turn_right_90",
  "turn_360",
  "sit_down",
  "stand_up",
  "sitting",
  "standing",
  "clap"
]);

export const AVATAR_PALETTE = [
  0x8170e8, 0x4c8edc, 0xb369b8, 0x3f9b91, 0xb87758, 0x6b7ac9, 0xa45f6d
];

export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export const DEFAULT_MOVIE: MovieState = {
  url: "/assets/movies/big_buck_bunny.mp4",
  title: "Big Buck Bunny — Cinema Premiere",
  playing: false,
  time: 0,
  volume: 0.8,
  updatedAt: Date.now()
};

export const DEFAULT_LIGHTING: LightingState = {
  ceiling: true,
  stairs: true,
  belowScreen: true,
  sideLights: "on"
};

export const EMOTE_DURATIONS: Record<string, number> = {
  cheer: 2200,
  clap: 2200,
  wave: 1800,
  laugh: 3000,
  talk: 3500,
  turn_360: 3600
};

export interface SideLightAnimationMeta {
  id: SideLightMode;
  name: string;
  badge: string;
  iconName: string;
  desc: string;
  color: string;
}

export const SIDE_LIGHT_ANIMATIONS: SideLightAnimationMeta[] = [
  {
    id: "hero_entry",
    name: "Hero Entry",
    badge: "EPIC ENTRY",
    iconName: "hero_entry",
    desc: "Gold & electric cyan fanfare strobe burst for grand hero entrances",
    color: "#f59e0b"
  },
  {
    id: "wave",
    name: "Travelling Wave",
    badge: "SMOOTH FLOW",
    iconName: "wave",
    desc: "Kinetic travelling sine-wave rolling from screen to rear booth",
    color: "#38bdf8"
  },
  {
    id: "pulse",
    name: "Cinematic Breathe",
    badge: "ATMOSPHERIC",
    iconName: "pulse",
    desc: "Slow, rhythmic deep breathing pulse with luminous volumetric glow",
    color: "#ec4899"
  },
  {
    id: "chase",
    name: "Laser Runner",
    badge: "HIGH SPEED",
    iconName: "chase",
    desc: "High-speed energy tracer racing along the zigzag wall bars",
    color: "#06b6d4"
  },
  {
    id: "strobe",
    name: "Action Strobe",
    badge: "ACTION / BEAT",
    iconName: "strobe",
    desc: "Rapid flashing multi-burst for intense action scenes and punch beats",
    color: "#ef4444"
  },
  {
    id: "rainbow",
    name: "Cyber Chroma",
    badge: "SPECTRUM",
    iconName: "rainbow",
    desc: "Dynamic spectrum cycling through cyan, purple, magenta, and gold",
    color: "#a855f7"
  },
  {
    id: "fire",
    name: "Inferno Ripple",
    badge: "FLAME",
    iconName: "fire",
    desc: "Organic flame flicker with burning amber, crimson, and gold hues",
    color: "#f97316"
  },
  {
    id: "ambilight_sync",
    name: "Movie Reactive",
    badge: "SYNCED",
    iconName: "ambilight_sync",
    desc: "Synchronizes side light colors and rhythm to the live movie screen",
    color: "#10b981"
  },
  {
    id: "on",
    name: "Solid Neon",
    badge: "STEADY",
    iconName: "on",
    desc: "Steady vibrant neon lighting without animation",
    color: "#60a5fa"
  },
  {
    id: "off",
    name: "Dark / Off",
    badge: "DARK",
    iconName: "off",
    desc: "Extinguished side wall neons",
    color: "#64748b"
  }
];

