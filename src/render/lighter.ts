/** 長いライター（着火具）の仮モデルと出し入れの動き */
import * as THREE from 'three';

export class LighterRig {
  group: THREE.Group;
  private target = new THREE.Vector3();
  private from = new THREE.Vector3();
  private t = 0;
  private state: 'hidden' | 'in' | 'hold' | 'out' = 'hidden';
  /** 炎の出る先端（ワールド） */
  tip = new THREE.Vector3();
  flameOn = false;

  constructor() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.55, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0x9a2a22, roughness: 0.5, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.32, metalness: 0.9 });
    // 軸は +X 方向へ伸び、先端がローカル原点
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.004, 0.24, 12), steel);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.x = 0.12;
    const tipRing = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.008, 12), steel);
    tipRing.rotation.z = Math.PI / 2;
    tipRing.position.x = 0.004;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.03, 12), body);
    neck.rotation.z = Math.PI / 2;
    neck.position.x = 0.252;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.024, 0.026), body);
    handle.position.set(0.325, -0.006, 0);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.018), red);
    trigger.position.set(0.28, -0.022, 0);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.028), body);
    grip.position.set(0.36, -0.028, 0);
    grip.rotation.z = -0.3;
    for (const m of [nozzle, tipRing, neck, handle, trigger, grip]) {
      m.castShadow = true;
      g.add(m);
    }
    g.visible = false;
    this.group = g;
  }

  show(tip: THREE.Vector3): void {
    this.target.copy(tip);
    this.from.copy(tip).add(new THREE.Vector3(0.28, 0.18, 0.42));
    if (this.state === 'hidden') {
      this.group.position.copy(this.from);
      this.t = 0;
    }
    this.state = 'in';
    this.group.visible = true;
  }

  hide(): void {
    if (this.state === 'hidden' || this.state === 'out') return;
    this.state = 'out';
    this.t = 0;
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.state === 'hidden') {
      this.flameOn = false;
      return;
    }
    const speed = reducedMotion ? 4 : 2;
    this.t = Math.min(1, this.t + dt * speed);
    const e = 1 - Math.pow(1 - this.t, 3);
    if (this.state === 'in') {
      this.group.position.lerpVectors(this.from, this.target, e);
      if (this.t >= 1) this.state = 'hold';
      this.flameOn = this.t > 0.85;
    } else if (this.state === 'hold') {
      this.group.position.copy(this.target);
      this.flameOn = true;
    } else if (this.state === 'out') {
      this.group.position.lerpVectors(this.target, this.from, e);
      this.flameOn = false;
      if (this.t >= 1) {
        this.state = 'hidden';
        this.group.visible = false;
      }
    }
    // 先端から手前右下へ向ける
    const dir = new THREE.Vector3(0.62, 0.3, 0.72).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.group.quaternion.copy(q);
    this.tip.copy(this.group.position);
  }

  get active(): boolean {
    return this.state !== 'hidden';
  }
}
