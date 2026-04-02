// src/webgl/constants.js
export const TILE_SIZE = 8;

// Number of floats per tile instance in the instance buffer
export const FLOATS_PER_INSTANCE = 16;

// Byte offsets into each instance's data (in float units, multiply by 4 for bytes)
export const I_POS_X      = 0;
export const I_POS_Y      = 1;
export const I_UV_X       = 2;
export const I_UV_Y       = 3;
export const I_UV_W       = 4;
export const I_UV_H       = 5;
export const I_FLIP       = 6;
export const I_OPACITY    = 7;
export const I_CIRCULAR   = 8;
export const I_PHASE      = 9;
export const I_SPEED      = 10;
export const I_DIRECTION  = 11;
export const I_COLOR_R    = 12;
export const I_COLOR_G    = 13;
export const I_COLOR_B    = 14;
export const I_COLOR_A    = 15;
