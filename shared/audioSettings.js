export const DEFAULT_AUDIO = Object.freeze({
  effectsEnabled: true,
  effectsVolume: 0.65,
  bgmEnabled: false,
  bgmVolume: 0.25,
  bgm: null,
});
export const audioState = (state) => ({ ...DEFAULT_AUDIO, ...state.audio });
