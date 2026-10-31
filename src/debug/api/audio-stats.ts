import { sound } from '../../audio/service';
import { api } from './core';

api.getAudioStats = () => sound.getAudioStats();
