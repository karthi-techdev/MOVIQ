export type VideoQuality = "auto" | "1080p" | "720p" | "480p" | "360p";
export type ScreenFrameMode = "fit" | "stretch" | "fill" | "16:9" | "21:9" | "2.35:1" | "2.39:1";
export type AudioSpatialMode = "atmos" | "hall" | "stereo";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface UserData {
  id: string;
  username: string;
  characterType: string;
  headPitch: number;
  headYaw: number;
  action: string;
  position: Vector3Like;
  rotation: number;
  seated: boolean;
  seatIndex: number | null;
  seatIndexLabel?: number | null;
  speaking: boolean;
  muted: boolean;
  inVoice: boolean;
  avatarColor?: number;
  colorIndex?: number;
  joinedAt: number;
}

export interface MovieState {
  url: string;
  title: string;
  playing: boolean;
  time: number;
  volume: number;
  updatedAt: number;
  serverTime?: number;
}

export interface RoomSummary {
  id: string;
  name: string;
  public: boolean;
  users: number;
  maxUsers: number;
  playing: boolean;
  movie: {
    title: string;
    url: string;
    playing: boolean;
  };
  createdAt: number;
}

export interface RoomDetail {
  id: string;
  name: string;
  hostId: string;
  movie: MovieState;
  users: UserData[];
  seats: Record<number, string>;
}

export interface CharacterPreset {
  name: string;
  icon: string;
  url: string;
  modelScale: number;
  targetHeight: number;
  seatYOffset: number;
  seatZOffset: number;
  armatureType: "Mixamo" | "Standard";
  animMap: Record<string, string>;
}

export type CameraMode = "FPP" | "TPP";

export interface ChatMessage {
  id: string;
  userId?: string;
  username?: string;
  text: string;
  system?: boolean;
  timestamp: number;
}

export interface SeatData {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  z: number;
  occupantId: string | null;
  occupiedBy?: string | null;
  group?: any;
  fabricMeshes?: any[];
}

