'use client';
// WebGL backdrop for the hero: orbital rings, a particle field and the floating TrustCode mark in 3D.
// Loaded lazily (next/dynamic, no SSR) and only when WebGL is available and motion is allowed.
import { Canvas, useFrame } from '@react-three/fiber';
import { Float } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const CYAN = '#38E1FF';
const BLUE = '#5B8CFF';
const PURPLE = '#A97CFF';
const TEAL = '#4FD1B5';

function Ring({ radius, tube, color, tilt, speed, opacity }: { radius: number; tube: number; color: string; tilt: [number, number, number]; speed: number; opacity: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.z += dt * speed; });
  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, tube, 16, 220]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Small deterministic PRNG (mulberry32), so the particle field is stable across renders. */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function Particles({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const a = new Float32Array(count * 3);
    const rand = rng(7);
    for (let i = 0; i < count; i++) {
      const r = 2.2 + rand() * 3.2, t = rand() * Math.PI * 2, y = (rand() - 0.5) * 3.2;
      a.set([Math.cos(t) * r, y, Math.sin(t) * r - 1.5], i * 3);
    }
    return a;
  }, [count]);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.025; });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
      <pointsMaterial size={0.025} color={CYAN} transparent opacity={0.7} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

/** The mark as tubes: two corner brackets (selection frame) and a check whose long stroke fades in segments. */
function Mark3D() {
  const parts = useMemo(() => {
    const v = (x: number, y: number) => new THREE.Vector3(x / 24 - 1, 1 - y / 24, 0);   // 48-unit SVG space -> [-1, 1]
    const path = (pts: [number, number][]) => { const c = new THREE.CurvePath<THREE.Vector3>(); for (let i = 0; i < pts.length - 1; i++) c.add(new THREE.LineCurve3(v(...pts[i]), v(...pts[i + 1]))); return c; };
    return [
      { curve: path([[6, 17], [6, 8], [8, 6], [17, 6]]), color: PURPLE, r: 0.08, o: 1 },
      { curve: path([[42, 31], [42, 40], [40, 42], [31, 42]]), color: PURPLE, r: 0.08, o: 1 },
      { curve: path([[14, 25], [21, 32], [27.3, 24.35]]), color: TEAL, r: 0.095, o: 1 },
      { curve: path([[29.2, 21.9], [31.5, 19.1]]), color: TEAL, r: 0.095, o: 0.55 },
      { curve: path([[33.4, 16.8], [35, 14.85]]), color: TEAL, r: 0.095, o: 0.28 },
    ];
  }, []);
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i}>
          <tubeGeometry args={[p.curve, 48, p.r, 12, false]} />
          <meshStandardMaterial color={p.color} emissive={p.color} emissiveIntensity={1.6} transparent opacity={p.o} roughness={0.3} metalness={0.2} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Rig() {
  // Gentle parallax that follows the pointer.
  useFrame(({ camera, pointer }) => {
    camera.position.x += (pointer.x * 0.35 - camera.position.x) * 0.04;
    camera.position.y += (pointer.y * 0.2 - camera.position.y) * 0.04;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function HeroScene() {
  const wrap = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    setSmall(window.matchMedia('(max-width: 768px)').matches);   // eslint-disable-line react-hooks/set-state-in-effect
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100px' });
    if (wrap.current) io.observe(wrap.current);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={wrap} className="absolute inset-0" aria-hidden="true">
      <Canvas frameloop={visible ? 'always' : 'never'} dpr={[1, small ? 1.25 : 1.75]} camera={{ position: [0, 0, 6], fov: 45 }}
              gl={{ antialias: !small, alpha: true, powerPreference: 'high-performance' }}>
        <ambientLight intensity={0.35} />
        <pointLight position={[-3, 2, 3]} color={CYAN} intensity={30} />
        <pointLight position={[3, -1, 2]} color={PURPLE} intensity={30} />
        <pointLight position={[0, 3, -2]} color={BLUE} intensity={20} />
        <group position={[0.4, 0, -1]}>
          <Ring radius={2.9} tube={0.012} color={CYAN} tilt={[1.25, 0.25, 0]} speed={0.12} opacity={0.9} />
          <Ring radius={3.4} tube={0.008} color={PURPLE} tilt={[1.1, -0.35, 0.4]} speed={-0.08} opacity={0.75} />
          <Ring radius={2.4} tube={0.006} color={BLUE} tilt={[1.4, 0.6, 0.2]} speed={0.18} opacity={0.6} />
        </group>
        <Particles count={small ? 180 : 600} />
        <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.8}>
          <group position={small ? [-1.45, 1.45, 0.8] : [-1.8, 1.05, 1.2]} scale={small ? 0.34 : 0.5} rotation={[0.08, 0.28, -0.04]}><Mark3D /></group>
        </Float>
        <Rig />
      </Canvas>
    </div>
  );
}
