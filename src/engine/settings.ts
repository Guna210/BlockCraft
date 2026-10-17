export type CloudSetting = 'fancy' | 'fast' | 'off';

export type LeavesSetting = 'fancy' | 'fast';

export interface Settings {
  fov: number;
  viewBobbing: boolean;
  clouds: CloudSetting;
  /** 'fast' draws leaves as opaque cubes without waving; changing it remeshes (see WorldManager.setLeaves). */
  leaves: LeavesSetting;
}

/** In-memory camera preferences; M18b owns UI and persistence. FOV is in degrees. */
export const settings: Settings = { fov: 70, viewBobbing: true, clouds: 'fancy', leaves: 'fancy' };
