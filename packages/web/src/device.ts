/** 设备 id：首次访问生成 UUID 存 localStorage，用于区分家庭成员/设备的观看进度 */

const KEY = 'fv-device-id';

export function getDeviceId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDeviceName(): string {
  return localStorage.getItem(`${KEY}-name`) || '';
}

export function setDeviceName(name: string): void {
  localStorage.setItem(`${KEY}-name`, name);
}
