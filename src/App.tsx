import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { LogicData, AppState, HandPosition } from './types';
import { Camera, RefreshCcw, Hand, Upload, Loader2, Info } from 'lucide-react';

const CONFIG = {
  goldCount: 500,
  silverCount: 500,
  gemCount: 350,
  emeraldCount: 350,
  dustCount: 1500,
  treeHeight: 70,
  maxRadius: 28
};

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // State
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Initializing 3D Engine...");
  const [started, setStarted] = useState(false);
  const [statusText, setStatusText] = useState("Waiting for camera...");
  const [currentState, setCurrentState] = useState<AppState>(AppState.TREE);
  const [statusColor, setStatusColor] = useState("#ffd700");
  const [photoCount, setPhotoCount] = useState(0);

  // Refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const mainGroupRef = useRef<THREE.Group | null>(null);
  const dustSystemRef = useRef<THREE.Points | null>(null);
  const logicDataRef = useRef<LogicData>({ gold: [], silver: [], gem: [], emerald: [], dust: [] });
  const photoMeshesRef = useRef<THREE.Mesh[]>([]);
  const stateRef = useRef<AppState>(AppState.TREE);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const zoomTargetIndexRef = useRef<number>(-1);
  const isHandPresentRef = useRef<boolean>(false);
  const handPosRef = useRef<HandPosition>({ x: 0.5, y: 0.5 });
  const lastHandPosRef = useRef<HandPosition>({ x: 0.5, y: 0.5 });
  const rotVelocityRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const timeRef = useRef<number>(0);
  const reqIdRef = useRef<number | null>(null);

  // Sync state
  useEffect(() => {
    stateRef.current = currentState;
  }, [currentState]);

  // --- Three.js Initialization ---
  const initThree = useCallback(() => {
    if (!mountRef.current) return;
    
    // If renderer exists, we just resize and return to support Strict Mode re-mounts
    if (rendererRef.current) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        rendererRef.current.setSize(w, h);
        if(composerRef.current) composerRef.current.setSize(w, h);
        if(cameraRef.current) {
            cameraRef.current.aspect = w / h;
            cameraRef.current.updateProjectionMatrix();
        }
        return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    camera.position.set(0, 0, 120);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambient);
    
    const mainLight = new THREE.SpotLight(0xffeebb, 100);
    mainLight.position.set(50, 80, 50);
    mainLight.angle = Math.PI / 6;
    mainLight.penumbra = 1;
    scene.add(mainLight);

    const rimLight = new THREE.PointLight(0x4488ff, 50);
    rimLight.position.set(-40, 20, 40);
    scene.add(rimLight);

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 1.5, 0.4, 0.85);
    bloom.threshold = 0.3;
    bloom.strength = 0.8;
    bloom.radius = 0.4;
    composer.addPass(bloom);
    composerRef.current = composer;

    // Objects Group
    const mainGroup = new THREE.Group();
    scene.add(mainGroup);
    mainGroupRef.current = mainGroup;

    createJewels(mainGroup);
    createDust(mainGroup);

    // Initial render
    composer.render();
  }, []);

  // Separate Resize Effect
  useEffect(() => {
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current || !composerRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      composerRef.current.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const createJewels = (group: THREE.Group) => {
    // Check if data already exists to prevent duplication on re-init
    if (logicDataRef.current.gold.length > 0) return;

    const mats = {
      gold: new THREE.MeshPhysicalMaterial({ color: 0xffb300, metalness: 1.0, roughness: 0.1, clearcoat: 1.0 }),
      silver: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.2, clearcoat: 1.0 }),
      gem: new THREE.MeshPhysicalMaterial({ color: 0xff0033, metalness: 0.1, roughness: 0.0, transmission: 0.6, thickness: 2.0, attenuationColor: new THREE.Color(0xff0000), attenuationDistance: 1.0 }),
      emerald: new THREE.MeshPhysicalMaterial({ color: 0x00aa44, metalness: 0.1, roughness: 0.0, transmission: 0.6, thickness: 2.0 })
    };

    const geos = {
      sphere: new THREE.SphereGeometry(0.6, 16, 16),
      box: new THREE.BoxGeometry(0.8, 0.8, 0.8),
      diamond: new THREE.OctahedronGeometry(0.7, 0),
      cone: new THREE.ConeGeometry(0.5, 1.2, 8)
    };

    createInstancedMesh(geos.sphere, mats.gold, CONFIG.goldCount, logicDataRef.current.gold, group);
    createInstancedMesh(geos.box, mats.silver, CONFIG.silverCount, logicDataRef.current.silver, group);
    createInstancedMesh(geos.diamond, mats.gem, CONFIG.gemCount, logicDataRef.current.gem, group);
    createInstancedMesh(geos.cone, mats.emerald, CONFIG.emeraldCount, logicDataRef.current.emerald, group);

    // Star
    const starGeo = new THREE.OctahedronGeometry(2.5, 0);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    const star = new THREE.Mesh(starGeo, starMat);
    const glow = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.3 }));
    star.add(glow);
    
    star.userData = { 
      treePos: new THREE.Vector3(0, CONFIG.treeHeight / 2 + 3, 0), 
      scatterPos: new THREE.Vector3(0, 60, 0) 
    };
    star.position.copy(star.userData.treePos);
    group.add(star);
    logicDataRef.current.star = star;
  };

  const createInstancedMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number, dataStore: any[], parent: THREE.Group) => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    parent.add(mesh);
    
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const h = (Math.random() - 0.5) * CONFIG.treeHeight;
      const progress = (h + CONFIG.treeHeight / 2) / CONFIG.treeHeight;
      const maxR = CONFIG.maxRadius * (1 - progress * 0.9);
      
      const r = Math.sqrt(Math.random()) * maxR;
      const theta = Math.random() * Math.PI * 2;
      
      const treePos = new THREE.Vector3(r * Math.cos(theta), h, r * Math.sin(theta));
      const scatterPos = new THREE.Vector3((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120);

      const item = {
        treePos,
        scatterPos,
        currentPos: treePos.clone(),
        scale: 0.5 + Math.random() * 1.0,
        velocity: new THREE.Vector3(0, 0, 0),
        rotSpeed: { x: Math.random() * 0.05, y: Math.random() * 0.05 }
      };
      dataStore.push(item);
      
      dummy.position.copy(treePos);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
  };

  const createDust = (group: THREE.Group) => {
    if (logicDataRef.current.dust.length > 0) return;

    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(CONFIG.dustCount * 3);
    for (let i = 0; i < CONFIG.dustCount; i++) {
      const x = (Math.random() - 0.5) * 100;
      const y = (Math.random() - 0.5) * 100;
      const z = (Math.random() - 0.5) * 100;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      logicDataRef.current.dust.push({ 
        currentPos: new THREE.Vector3(x, y, z), 
        baseY: y, 
        speed: Math.random() * 0.05 + 0.02 
      });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffaa, size: 0.4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
    const dustSystem = new THREE.Points(geo, mat);
    dustSystemRef.current = dustSystem;
    group.add(dustSystem);
  };

  // --- Animation Loop ---
  const animate = useCallback(() => {
    // Safety check: if renderer is gone (cleanup), stop loop
    if (!composerRef.current || !mainGroupRef.current || !rendererRef.current) return;

    timeRef.current += 0.01;
    const time = timeRef.current;
    const currentState = stateRef.current;
    const mainGroup = mainGroupRef.current;
    const logicData = logicDataRef.current;

    // 1. State Management & Rotation
    if (currentState === AppState.SCATTER) {
      if (isHandPresentRef.current) {
        const dx = handPosRef.current.x - lastHandPosRef.current.x;
        const dy = handPosRef.current.y - lastHandPosRef.current.y;
        rotVelocityRef.current.y += dx * 0.2;
        rotVelocityRef.current.x += dy * 0.2;
        lastHandPosRef.current.x = handPosRef.current.x;
        lastHandPosRef.current.y = handPosRef.current.y;
      }
      mainGroup.rotation.y += rotVelocityRef.current.y;
      mainGroup.rotation.x += rotVelocityRef.current.x;
      rotVelocityRef.current.x *= 0.95;
      rotVelocityRef.current.y *= 0.95;
    } else if (currentState === AppState.TREE) {
      mainGroup.rotation.y += 0.002;
      mainGroup.rotation.x *= 0.95;
    }

    // 2. Update Groups
    const updateMeshGroup = (meshIndex: number, data: any[]) => {
      const mesh = mainGroup.children[meshIndex] as THREE.InstancedMesh;
      if (!mesh?.isInstancedMesh) return;
      const dummy = new THREE.Object3D();

      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        let target = currentState === AppState.TREE ? item.treePos : item.scatterPos;
        if (currentState === AppState.ZOOM) target = item.scatterPos;

        item.currentPos.lerp(target, 0.06);
        if (currentState === AppState.SCATTER) item.currentPos.y += Math.sin(time + i) * 0.02;

        dummy.position.copy(item.currentPos);
        dummy.rotation.set(time * item.rotSpeed.x, time * item.rotSpeed.y, 0);
        
        let s = item.scale;
        if (currentState === AppState.ZOOM) s *= 0.5;
        dummy.scale.setScalar(s);
        
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    };

    updateMeshGroup(0, logicData.gold);
    updateMeshGroup(1, logicData.silver);
    updateMeshGroup(2, logicData.gem);
    updateMeshGroup(3, logicData.emerald);

    // 3. Update Dust
    if (dustSystemRef.current) {
      const positions = dustSystemRef.current.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < logicData.dust.length; i++) {
        const p = logicData.dust[i];
        if (currentState === AppState.TREE) {
          const angle = time * 0.2 + p.baseY;
          const r = 35;
          p.currentPos.x += (Math.cos(angle) * r - p.currentPos.x) * 0.02;
          p.currentPos.z += (Math.sin(angle) * r - p.currentPos.z) * 0.02;
          p.currentPos.y += 0.1;
          if (p.currentPos.y > 60) p.currentPos.y = -60;
        } else {
          p.currentPos.y += Math.sin(time + i) * 0.05;
        }
        positions[i * 3] = p.currentPos.x;
        positions[i * 3 + 1] = p.currentPos.y;
        positions[i * 3 + 2] = p.currentPos.z;
      }
      dustSystemRef.current.geometry.attributes.position.needsUpdate = true;
    }

    // 4. Update Photos
    photoMeshesRef.current.forEach((mesh, idx) => {
      let targetPos;
      let targetScale = 1.0;
      let lookAtCam = false;

      if (currentState === AppState.ZOOM && idx === zoomTargetIndexRef.current) {
        if (cameraRef.current) {
          const dist = 60;
          const v = new THREE.Vector3(0, 0, -dist);
          v.applyQuaternion(cameraRef.current.quaternion);
          v.add(cameraRef.current.position);
          targetPos = mainGroup.worldToLocal(v);
          targetScale = 5.0;
          lookAtCam = true;
        } else {
            targetPos = mesh.userData.scatterPos;
        }
      } else {
        targetPos = currentState === AppState.TREE ? mesh.userData.treePos : mesh.userData.scatterPos;
        if (currentState !== AppState.TREE) targetScale = 2.0;
      }
      
      if (!targetPos) targetPos = new THREE.Vector3();

      mesh.position.lerp(targetPos, 0.1);
      mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);

      if (lookAtCam || currentState !== AppState.TREE) {
        if (cameraRef.current) mesh.lookAt(cameraRef.current.position);
      } else {
        mesh.rotation.copy(mesh.userData.baseRot);
        mesh.rotation.y += 0.01;
      }
    });

    // 5. Update Star
    if (logicData.star) {
      const target = currentState === AppState.TREE ? logicData.star.userData.treePos : logicData.star.userData.scatterPos;
      logicData.star.position.lerp(target, 0.05);
      logicData.star.rotation.y += 0.02;
    }

    composerRef.current.render();
    reqIdRef.current = requestAnimationFrame(animate);
  }, []);

  // --- MediaPipe Initialization ---
  const initMediaPipe = async () => {
    if (!videoRef.current) throw new Error("Video element not found");

    // Match version with index.html (0.10.18) to avoid "Failed to fetch"
    const wasmUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
    
    setLoadingMsg("Downloading AI Model...");
    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    
    setLoadingMsg("Initializing Hand Tracker...");
    handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });

    setLoadingMsg("Requesting Camera Access...");
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 320, height: 240 } // Request low res for performance
    });
    
    videoRef.current.srcObject = stream;
    
    // Force play and wait
    await videoRef.current.play();

    return new Promise<void>((resolve) => {
        if (videoRef.current && videoRef.current.readyState >= 2) {
             predictWebcam();
             resolve();
        } else if (videoRef.current) {
            videoRef.current.onloadeddata = () => {
                predictWebcam();
                resolve();
            };
        } else {
            resolve();
        }
    });
  };

  const predictWebcam = () => {
    if (!videoRef.current || !handLandmarkerRef.current) return;
    
    // Safety check if component unmounted
    if (!rendererRef.current) return;

    const startTimeMs = performance.now();
    const result = handLandmarkerRef.current.detectForVideo(videoRef.current, startTimeMs);
    
    // Draw and Process
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (result.landmarks && result.landmarks.length > 0) {
          isHandPresentRef.current = true;
          const marks = result.landmarks[0];
          drawSkeleton(ctx, marks, canvas.width, canvas.height);
          handleGesture(marks);
        } else {
          isHandPresentRef.current = false;
        }
      }
    }
    requestAnimationFrame(predictWebcam);
  };

  const drawSkeleton = (ctx: CanvasRenderingContext2D, landmarks: NormalizedLandmark[], w: number, h: number) => {
    ctx.fillStyle = "#00ff00";
    ctx.strokeStyle = "rgba(0,255,0,0.5)";
    ctx.lineWidth = 2;
    for (let p of landmarks) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  };

  const handleGesture = (landmarks: NormalizedLandmark[]) => {
    handPosRef.current.x = landmarks[9].x; 
    handPosRef.current.y = landmarks[9].y;

    const isFist = isFingerFolded(landmarks, 8) && isFingerFolded(landmarks, 12) && isFingerFolded(landmarks, 16) && isFingerFolded(landmarks, 20);
    const pinchDist = Math.hypot(landmarks[8].x - landmarks[4].x, landmarks[8].y - landmarks[4].y);
    const isPinch = pinchDist < 0.05;

    const current = stateRef.current; 

    if (isPinch) {
      if (current === AppState.SCATTER && photoMeshesRef.current.length > 0) {
        selectClosestPhoto();
        setCurrentState(AppState.ZOOM);
        setStatusText("✋ Grabbing Photo");
        setStatusColor("#ffd700");
      }
    } else if (isFist) {
      setCurrentState(AppState.TREE);
      setStatusText("✊ Aggregated Form");
      setStatusColor("#00ffaa");
    } else {
      if (current === AppState.TREE || current === AppState.ZOOM) {
        setCurrentState(AppState.SCATTER);
        setStatusText("🖐 Nebula Scattered (Wave to Rotate)");
        setStatusColor("#ffffff");
        lastHandPosRef.current.x = handPosRef.current.x;
        lastHandPosRef.current.y = handPosRef.current.y;
      }
    }
  };

  const isFingerFolded = (landmarks: NormalizedLandmark[], tipIdx: number) => {
    const root = landmarks[0];
    const tip = landmarks[tipIdx];
    const mid = landmarks[tipIdx - 2];
    const distTip = Math.hypot(tip.x - root.x, tip.y - root.y);
    const distMid = Math.hypot(mid.x - root.x, mid.y - root.y);
    return distTip < distMid;
  };

  const selectClosestPhoto = () => {
    if (photoMeshesRef.current.length === 0) return;
    if (zoomTargetIndexRef.current === -1) zoomTargetIndexRef.current = 0;
    else zoomTargetIndexRef.current = (zoomTargetIndexRef.current + 1) % photoMeshesRef.current.length;
  };

  // --- Photo Handling ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
            const img = new Image();
            img.src = evt.target.result as string;
            img.onload = () => addPhoto(img);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const addPhoto = (img: HTMLImageElement) => {
    if (!mainGroupRef.current) return;

    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    
    const aspect = img.width / img.height;
    const h = 4;
    const w = h * aspect;
    
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.2), 
      new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1, roughness: 0.2 })
    );
    frame.position.z = -0.11;
    mesh.add(frame);

    const angle = Math.random() * Math.PI * 2;
    const rad = 15 + Math.random() * 10;
    const y = (Math.random() - 0.5) * 40;
    
    mesh.userData = {
      treePos: new THREE.Vector3(rad * Math.cos(angle), y, rad * Math.sin(angle)),
      scatterPos: new THREE.Vector3((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80),
      baseRot: new THREE.Euler(0, angle + Math.PI / 2, 0)
    };
    mesh.position.copy(mesh.userData.treePos);
    mesh.lookAt(0, mesh.position.y, 0);
    
    photoMeshesRef.current.push(mesh);
    mainGroupRef.current.add(mesh);
    setPhotoCount(prev => prev + 1);
    setCurrentState(AppState.TREE);
  };

  const startExperience = async () => {
    setLoading(true);
    // Explicitly resetting the start state to ensure re-entry is clean
    setStarted(false);
    
    try {
      await initMediaPipe();
      setLoading(false);
      setStarted(true);
      animate();
    } catch (err: any) {
      console.error(err);
      // Show full error in alert
      alert(`Initialization Failed: ${err.message || err}. Please ensure camera permissions are allowed and try reloading.`);
      setLoading(false);
      setLoadingMsg("Failed. Click to try again.");
    }
  };

  // Mount Effect
  useEffect(() => {
    initThree();
    // Initially false to show the Start button
    setLoading(false);
    
    return () => {
       if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
       // We DO NOT dispose renderer here to avoid Strict Mode issues
       // Instead we rely on initThree to check for existing renderer
    };
  }, [initThree]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden font-sans text-white">
      {/* Canvas Container */}
      <div ref={mountRef} className="absolute inset-0 z-0" />

      {/* Video Overlay (Camera) */}
      <div className={`absolute top-5 right-5 w-40 h-32 z-10 border border-amber-400/30 rounded-lg overflow-hidden bg-black/50 transition-opacity duration-1000 ${started ? 'opacity-100' : 'opacity-0'}`}>
        <video ref={videoRef} className="w-full h-full object-cover opacity-80 scale-x-[-1]" playsInline muted />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full scale-x-[-1]" width={320} height={240} />
      </div>

      {/* UI Layer */}
      <div className={`absolute top-10 left-10 z-20 pointer-events-none transition-opacity duration-500 ${started ? 'opacity-100' : 'opacity-0'}`}>
        <h1 className="text-4xl font-extralight tracking-[0.2em] uppercase mb-4 text-transparent bg-clip-text bg-gradient-to-br from-white via-yellow-400 to-white drop-shadow-[0_0_20px_rgba(255,215,0,0.3)]">
          Jewel Christmas
        </h1>
        
        <div 
          className="inline-block px-4 py-1.5 border border-white/20 rounded-full bg-black/60 backdrop-blur-sm mb-6 text-sm transition-colors duration-300"
          style={{ color: statusColor }}
        >
          {statusText}
        </div>

        <div className="bg-gradient-to-r from-neutral-900/90 to-neutral-900/40 p-5 border-l-2 border-yellow-400 rounded-r-lg max-w-xs text-sm text-gray-300 space-y-2 leading-relaxed">
           <div className="flex items-center gap-2"><Hand className="w-4 h-4 text-yellow-400" /> <span className="font-bold text-yellow-400">Fist</span> : Aggregate Tree</div>
           <div className="flex items-center gap-2"><RefreshCcw className="w-4 h-4 text-yellow-400" /> <span className="font-bold text-yellow-400">Open Hand</span> : Scatter & Rotate</div>
           <div className="flex items-center gap-2"><Camera className="w-4 h-4 text-yellow-400" /> <span className="font-bold text-yellow-400">Pinch</span> : Summon Photo</div>
        </div>

        <div className="mt-6 pointer-events-auto">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-white/10 hover:bg-yellow-400 hover:text-black border border-white/30 text-white px-6 py-2.5 text-xs uppercase tracking-widest transition-all duration-300 hover:shadow-[0_0_15px_#ffd700]"
          >
            <Upload className="w-3 h-3" /> Add Photo ({photoCount})
          </button>
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple 
            accept="image/*" 
            className="hidden" 
          />
        </div>
      </div>

      {/* Start Overlay */}
      {!started && (
        <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col justify-center items-center transition-opacity duration-700">
          <h1 className="text-6xl font-thin tracking-widest mb-8 text-yellow-500">JEWEL TREE</h1>
          
          <button 
            onClick={startExperience}
            disabled={loading}
            className="group relative px-10 py-4 border border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all duration-300 uppercase tracking-[0.2em] text-lg flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin" /> : "Start Experience"}
          </button>
          
          <div className="mt-6 text-gray-500 text-sm tracking-wide flex flex-col items-center gap-2">
             <p>{loading ? loadingMsg : "Ready to launch"}</p>
             <div className="flex items-center gap-1 text-xs text-gray-600"><Info className="w-3 h-3"/> Requires Camera Permission</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;