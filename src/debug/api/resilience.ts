import { sound } from '../../audio/service';
import { getSubtitles } from '../../audio/subtitles';
import { injectFault } from '../../engine/fault-injection';
import { api } from './core';

api.getSubtitles = getSubtitles;
api.injectFault = injectFault;
api.playSound = (id, pos) => sound.play(id, pos ? { pos } : {});
