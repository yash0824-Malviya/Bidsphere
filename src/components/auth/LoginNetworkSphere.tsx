import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const RADIUS = 2.15;
const NODE_COUNT = 72;
const CONNECT_DIST = 1.05;
const PULSE_COUNT = 12;

function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(1 - y * y, 0));
    const theta = golden * i;
    pts.push(
      new THREE.Vector3(
        Math.cos(theta) * r * radius,
        y * radius,
        Math.sin(theta) * r * radius
      )
    );
  }
  return pts;
}

function buildEdges(points: THREE.Vector3[]): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[i].distanceTo(points[j]) < CONNECT_DIST) {
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

function NetworkSphereScene() {
  const groupRef = useRef<THREE.Group>(null);
  const pulseRefs = useRef<THREE.Mesh[]>([]);
  const lineMatRef = useRef<THREE.LineBasicMaterial>(null);

  const { nodes, linePositions, pulseRoutes } = useMemo(() => {
    const nodeList = fibonacciSphere(NODE_COUNT, RADIUS);
    const edgeList = buildEdges(nodeList);
    const positions = new Float32Array(edgeList.length * 6);
    edgeList.forEach(([a, b], i) => {
      const va = nodeList[a];
      const vb = nodeList[b];
      positions[i * 6] = va.x;
      positions[i * 6 + 1] = va.y;
      positions[i * 6 + 2] = va.z;
      positions[i * 6 + 3] = vb.x;
      positions[i * 6 + 4] = vb.y;
      positions[i * 6 + 5] = vb.z;
    });
    const routes = edgeList
      .filter((_, i) => i % Math.max(1, Math.floor(edgeList.length / PULSE_COUNT)) === 0)
      .slice(0, PULSE_COUNT)
      .map(([a, b]) => ({ a: nodeList[a].clone(), b: nodeList[b].clone() }));
    return {
      nodes: nodeList,
      linePositions: positions,
      pulseRoutes: routes,
    };
  }, []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.12;
      groupRef.current.rotation.x = Math.sin(t * 0.15) * 0.08 + 0.12;
      groupRef.current.position.y = Math.sin(t * 0.45) * 0.12;
    }
    pulseRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const route = pulseRoutes[i % pulseRoutes.length];
      if (!route) return;
      const phase = (t * 0.22 + i * 0.35) % 1;
      mesh.position.lerpVectors(route.a, route.b, phase);
      const scale = 0.7 + Math.sin(t * 2 + i) * 0.25;
      mesh.scale.setScalar(scale);
    });
    // Soft network-line breathing
    if (lineMatRef.current) {
      lineMatRef.current.opacity = 0.2 + Math.sin(t * 0.6) * 0.08;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[RADIUS * 1.02, 48, 48]} />
        <meshBasicMaterial
          color="#0ea5e9"
          transparent
          opacity={0.04}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh>
        <icosahedronGeometry args={[RADIUS * 1.001, 3]} />
        <meshBasicMaterial
          color="#38bdf8"
          wireframe
          transparent
          opacity={0.07}
        />
      </mesh>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          ref={lineMatRef}
          color="#38bdf8"
          transparent
          opacity={0.24}
        />
      </lineSegments>

      {nodes.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.035 + (i % 5) * 0.004, 10, 10]} />
          <meshStandardMaterial
            color="#7dd3fc"
            emissive="#0ea5e9"
            emissiveIntensity={0.55 + (i % 3) * 0.15}
            metalness={0.2}
            roughness={0.35}
          />
        </mesh>
      ))}

      {pulseRoutes.map((_, i) => (
        <mesh
          key={`pulse-${i}`}
          ref={(el) => {
            if (el) pulseRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.85} />
        </mesh>
      ))}

      <mesh>
        <sphereGeometry args={[RADIUS * 1.18, 32, 32]} />
        <meshBasicMaterial
          color="#0c4a6e"
          transparent
          opacity={0.03}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function StaticNetworkSphere() {
  const groupRef = useRef<THREE.Group>(null);
  const { nodes, linePositions } = useMemo(() => {
    const nodeList = fibonacciSphere(NODE_COUNT, RADIUS);
    const edgeList = buildEdges(nodeList);
    const positions = new Float32Array(edgeList.length * 6);
    edgeList.forEach(([a, b], i) => {
      const va = nodeList[a];
      const vb = nodeList[b];
      positions[i * 6] = va.x;
      positions[i * 6 + 1] = va.y;
      positions[i * 6 + 2] = va.z;
      positions[i * 6 + 3] = vb.x;
      positions[i * 6 + 4] = vb.y;
      positions[i * 6 + 5] = vb.z;
    });
    return { nodes: nodeList, linePositions: positions };
  }, []);

  return (
    <group ref={groupRef} rotation={[0.12, 0.4, 0]}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.24} />
      </lineSegments>
      {nodes.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshStandardMaterial
            color="#7dd3fc"
            emissive="#0ea5e9"
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}
    </group>
  );
}

export default function LoginNetworkSphere() {
  const reduced = prefersReducedMotion();

  return (
    <Canvas
      className="login-hero-canvas"
      camera={{ position: [0, 0, 9.4], fov: 40 }}
      dpr={[1, 1.75]}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.85} />
      <pointLight position={[6, 4, 6]} intensity={1.4} color="#38bdf8" />
      <pointLight position={[-5, -3, 4]} intensity={0.7} color="#0284c7" />
      <pointLight position={[0, -4, 2]} intensity={0.35} color="#0ea5e9" />
      {reduced ? <StaticNetworkSphere /> : <NetworkSphereScene />}
    </Canvas>
  );
}
