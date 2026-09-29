import { Camera } from '../../render/camera';

let activeCamera: Camera | null = null;

export function setActiveCamera(camera: Camera | null) {
  activeCamera = camera;
}

export function look(yaw: number, pitch: number): void {
  if (activeCamera) {
    activeCamera.yaw = yaw;
    activeCamera.pitch = pitch;
    activeCamera.updateView();
  }
}
