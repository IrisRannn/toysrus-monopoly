export const EVENT_ROOM_CODE = "261219";
// Keep existing links and saved player identities for both rooms usable.
export const LEGACY_ROOM_CODE = "261218";
export const PREVIEW_ROOM_CODE = EVENT_ROOM_CODE;
export const playerEntryPath = (code) => code === LEGACY_ROOM_CODE ? "/player-classic" : "/player";
