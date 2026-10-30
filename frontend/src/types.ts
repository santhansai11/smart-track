export type Profile = {
  id: string;
  full_name: string;
  role: "ROOT" | "STUDENT";
  active: boolean;
};
export type RouteVersion = {
  id: string;
  route_id: string;
  version: number;
  coordinates: [number, number][];
  length_m: number;
  tolerance_m: number;
};
export type Route = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  version: RouteVersion;
};
export type Competition = {
  id: string;
  room_id: string;
  room_name: string;
  status: "LOCKED" | "RUNNING" | "FINALIZING" | "COMPLETED";
  started_at: string | null;
  published_at: string | null;
  finalize_after: string | null;
  created_at: string;
};
export type Room = {
  id: string;
  name: string;
  description: string;
  capacity: number;
  visibility: string;
  locked: boolean;
  joined: boolean;
  route_name: string;
  member_count: number;
  route_version_id: string;
};
export type RoomDetail = Room & {
  route: RouteVersion;
  competitions: Competition[];
};
export type RunSession = {
  id: string;
  participant_id: string;
  last_seq: number;
  distance_m: number;
  partial_m: number;
  lap_count: number;
  active_ms: number;
  tracking: boolean;
  created_at: string;
  status?: string;
  competition_id?: string;
  room_name?: string;
};
export type Participant = {
  id: string;
  user_id: string;
  status: string;
  full_name: string;
  rank: number | null;
  laps: number;
  distance_m: number;
  partial_m: number;
  active_ms: number;
  recoveries: number;
  session_id: string | null;
};
export type CompetitionDetail = Competition & {
  route: RouteVersion;
  participant: Participant | null;
  session: RunSession | null;
};
export type Recovery = {
  id: string;
  reason: string;
  status: string;
  full_name: string;
  room_name: string;
  competition_id: string;
  created_at: string;
  decision_reason: string | null;
};
export type Lap = {
  id: string;
  number: number;
  active_ms: number;
  finished_at: string;
};
export type Point = {
  seq: number;
  captured_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  speed_mps: number | null;
  heading: number | null;
};
export type Stats = {
  runs: number;
  distance_m: number;
  laps: number;
  users?: number;
  rooms?: number;
  live?: number;
  completed?: number;
  active_users?: number;
  routes?: number;
};
