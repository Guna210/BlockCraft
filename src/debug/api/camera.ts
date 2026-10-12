import { WorldManager } from '../../world/world-manager';
import { Camera } from '../../render/camera';

let activeCamera: Camera | null = null;

export function setActiveCamera(camera: Camera | null) {
  activeCamera = camera;
}

export function look(yaw: number, pitch: number): void {
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch))
    throw new Error('Look angles must be finite');
  const controller = WorldManager.getInstance().playerController;
  if (controller?.player && activeCamera === controller.camera) {
    controller.look(yaw, pitch);
    return;
  }
  if (activeCamera) {
    activeCamera.yaw = yaw;
    activeCamera.pitch = pitch;
    activeCamera.updateView();
  }
}
