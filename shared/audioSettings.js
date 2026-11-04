import { BUILTIN_BGM } from "./builtinBgm.js";
export const DEFAULT_AUDIO = Object.freeze({
  effectsEnabled: true,
  effectsVolume: 0.9,
  bgmEnabled: false,
  bgmVolume: 0.25,
  bgm: BUILTIN_BGM,
});
export const audioState = (state) => ({ ...DEFAULT_AUDIO, ...state.audio });
