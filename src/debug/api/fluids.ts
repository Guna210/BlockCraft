import { api } from './core';
import { fluidAnimation } from '../../render/fluid-animation';
api.setFluidAnimationPaused = (paused) => fluidAnimation.setPaused(paused, performance.now());
api.getFluidAnimation = () => fluidAnimation.snapshot();
