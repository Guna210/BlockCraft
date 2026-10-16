import { api } from './core';
import { setWeather, type WeatherState } from '../../world/weather';

/**
 * Sets the weather state ('clear' | 'rain' | 'thunder') per Decision 1.
 */
export function setWeatherDebug(state: WeatherState): void {
  setWeather(state);
}

api.setWeather = setWeatherDebug;
