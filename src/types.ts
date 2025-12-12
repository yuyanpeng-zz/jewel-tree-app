import * as THREE from 'three';

export interface LogicData {
  gold: InstanceData[];
  silver: InstanceData[];
  gem: InstanceData[];
  emerald: InstanceData[];
  dust: DustData[];
  star?: THREE.Mesh;
}

export interface InstanceData {
  treePos: THREE.Vector3;
  scatterPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  scale: number;
  velocity: THREE.Vector3;
  rotSpeed: { x: number; y: number };
}

export interface DustData {
  currentPos: THREE.Vector3;
  baseY: number;
  speed: number;
}

// 修复: 使用 const object 替代 enum，解决 'erasableSyntaxOnly' 错误
export const AppState = {
  TREE: 'tree',
  SCATTER: 'scatter',
  ZOOM: 'zoom'
} as const;

// 导出由常量生成的类型
export type AppState = (typeof AppState)[keyof typeof AppState];

export interface HandPosition {
  x: number;
  y: number;
}