// Blank index (-) in the CHAR_MAP
export const EN_BLANK_INDEX = 28;
// Character list for English
export const EN_CHARS = ' abcdefghijklmnopqrstuvwxyz\'';
// Character map for English. string as key and index as value
export const EN_CHAR_MAP: {[key: string]: number} = {};
export const EPSILON = 1e-5;
export const IS_NODE = typeof(window) === 'undefined';

// Initialize the EN_CHAR_MAP
for (let index = 0, len = EN_CHARS.length; index < len; index++) {
  EN_CHAR_MAP[EN_CHARS.charAt(index)] = index;
}