// 解决 Three.js 示例模块找不到类型定义的问题
declare module 'three/examples/jsm/postprocessing/EffectComposer' {
  import { WebGLRenderer } from 'three';
  import { Pass } from 'three/examples/jsm/postprocessing/Pass';
  export class EffectComposer {
    constructor(renderer: WebGLRenderer);
    addPass(pass: any): void;
    render(deltaTime?: number): void;
    setSize(width: number, height: number): void;
  }
}

declare module 'three/examples/jsm/postprocessing/RenderPass' {
  import { Scene, Camera } from 'three';
  export class RenderPass {
    constructor(scene: Scene, camera: Camera);
  }
}

declare module 'three/examples/jsm/postprocessing/UnrealBloomPass' {
  import { Vector2 } from 'three';
  export class UnrealBloomPass {
    constructor(resolution: Vector2, strength: number, radius: number, threshold: number);
    strength: number;
    radius: number;
    threshold: number;
  }
}

declare module 'three/examples/jsm/environments/RoomEnvironment' {
  import { Scene } from 'three';
  export class RoomEnvironment extends Scene {
    constructor();
  }
}