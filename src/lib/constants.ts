import { CharacterPreset, MovieState } from "../types/cinema";

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
    icon: "👩",
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
    icon: "👱‍♀️",
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
    icon: "🏃‍♀️",
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
    icon: "🧘‍♀️",
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
    icon: "💃",
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
    icon: "💁‍♀️",
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
    icon: "👨",
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
    icon: "🧑",
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
    icon: "🏃‍♂️",
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
    icon: "🚴‍♂️",
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
    icon: "🚶‍♂️",
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
    icon: "🕺",
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
    icon: "🤵",
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

export const EMOTE_DURATIONS: Record<string, number> = {
  cheer: 2200,
  clap: 2200,
  wave: 1800,
  laugh: 3000,
  talk: 3500,
  turn_360: 3600
};

