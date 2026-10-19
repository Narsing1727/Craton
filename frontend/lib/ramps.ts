// The terrain colour map the server paints rasters and point clouds with (backend/src/render/ramps.ts), as legend stops. A backend test keeps
// this list identical to what the server draws.

export const TERRAIN_STOPS = ["#11c177", "#58d72b", "#bfe230", "#c1b128", "#875b18", "#926a41", "#b69c81", "#dbcdc0", "#ffffff"];

export const terrainGradient = `linear-gradient(to right, ${TERRAIN_STOPS.join(", ")})`;
