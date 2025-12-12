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

export enum AppState {
  TREE = 'tree',
  SCATTER = 'scatter',
  ZOOM = 'zoom'
}

export interface HandPosition {
  x: number;
  y: number;
}