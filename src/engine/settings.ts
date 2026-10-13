export type CloudSetting = 'fancy' | 'fast' | 'off';

export interface Settings {
  fov: number;
  viewBobbing: boolean;
  clouds: CloudSetting;
}

/** In-memory camera preferences; M18b owns UI and persistence. FOV is in degrees. */
export const settings: Settings = { fov: 70, viewBobbing: true, clouds: 'fancy' };
