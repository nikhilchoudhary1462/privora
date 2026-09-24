import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeStudioModelProps {
  className?: string;
  badgeText?: string;
}

export const ThreeStudioModel: React.FC<ThreeStudioModelProps> = ({
  className = 'w-full h-64 sm:h-72',
  badgeText = 'Zero-Knowledge On-Device Core'
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth || 320;
    const height = parent?.clientHeight || 260;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();

    // Balanced 4-point studio lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(4, 6, 5);
    scene.add(dirLight);

    const pointLight1 = new THREE.PointLight(0x9C8DD4, 3.5, 15);
    pointLight1.position.set(-3.5, 3, 4);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x4ADE80, 2.0, 12);
    pointLight2.position.set(3, -2, 3);
    scene.add(pointLight2);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0.1, 5.2);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    // 1. Central Cryptographic Gem (Icosahedron with rich physical clearcoat)
    const coreGeo = new THREE.IcosahedronGeometry(0.85, 1);
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x9C8DD4,
      emissive: 0x2A1B4E,
      emissiveIntensity: 0.35,
      metalness: 0.2,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.95,
      depthWrite: true,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    rootGroup.add(coreMesh);

    // Inner wireframe lattice for high-tech aesthetic
    const innerWireGeo = new THREE.IcosahedronGeometry(0.86, 1);
    const innerWireMat = new THREE.MeshBasicMaterial({
      color: 0xE2D9FF,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    const innerWire = new THREE.Mesh(innerWireGeo, innerWireMat);
    rootGroup.add(innerWire);

    // 2. Primary Outer Orbit Ring (Tilted 55 deg)
    const ring1Geo = new THREE.TorusGeometry(1.45, 0.022, 16, 128);
    const ring1Mat = new THREE.MeshStandardMaterial({
      color: 0x9C8DD4,
      metalness: 0.8,
      roughness: 0.2,
    });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.rotation.x = Math.PI / 3;
    ring1.rotation.y = Math.PI / 6;
    rootGroup.add(ring1);

    // 3. Secondary Orbit Ring (Perpendicular tilt)
    const ring2Geo = new THREE.TorusGeometry(1.58, 0.018, 16, 128);
    const ring2Mat = new THREE.MeshStandardMaterial({
      color: 0x4ADE80,
      metalness: 0.7,
      roughness: 0.25,
      transparent: true,
      opacity: 0.85,
    });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.rotation.x = -Math.PI / 4;
    ring2.rotation.y = Math.PI / 4;
    rootGroup.add(ring2);

    // 4. Orbiting Security Nodes (Spheres)
    const sphereMat1 = new THREE.MeshStandardMaterial({
      color: 0x4ADE80,
      emissive: 0x16A34A,
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.2,
    });
    const sphereMat2 = new THREE.MeshStandardMaterial({
      color: 0x9C8DD4,
      emissive: 0x5D4B9B,
      emissiveIntensity: 0.6,
      metalness: 0.5,
      roughness: 0.2,
    });

    const sphere1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), sphereMat1);
    const sphere2 = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 16), sphereMat2);
    const sphere3 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 16), sphereMat1);
    rootGroup.add(sphere1);
    rootGroup.add(sphere2);
    rootGroup.add(sphere3);

    // Mouse interactive tilt
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };

    window.addEventListener('mousemove', handleMouseMove);

    // Responsive Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      if (!canvas || !parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    if (parent) resizeObserver.observe(parent);

    // Animation Loop
    let animId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Smooth mouse tilt tracking
      targetX += (mouseX * 0.4 - targetX) * 0.05;
      targetY += (mouseY * 0.4 - targetY) * 0.05;

      rootGroup.rotation.y = elapsed * 0.35 + targetX;
      rootGroup.rotation.x = Math.sin(elapsed * 0.25) * 0.15 + targetY;

      // Individual component rotations
      coreMesh.rotation.y = elapsed * 0.4;
      coreMesh.rotation.z = Math.sin(elapsed * 0.3) * 0.2;
      innerWire.rotation.y = -elapsed * 0.3;

      ring1.rotation.z = elapsed * 0.5;
      ring2.rotation.z = -elapsed * 0.4;

      // Orbiting spheres
      sphere1.position.set(
        Math.cos(elapsed * 1.2) * 1.45,
        Math.sin(elapsed * 1.2) * 0.6,
        Math.sin(elapsed * 1.2) * 1.45 * 0.8
      );

      sphere2.position.set(
        Math.cos(elapsed * 0.9 + 2) * 1.58,
        Math.sin(elapsed * 0.9 + 2) * 1.1,
        Math.sin(elapsed * 0.9 + 2) * 1.58 * 0.7
      );

      sphere3.position.set(
        Math.sin(elapsed * 1.5) * 1.25,
        Math.cos(elapsed * 1.5) * 0.75,
        Math.cos(elapsed * 1.5) * 1.25
      );

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      if (parent) resizeObserver.unobserve(parent);
      renderer.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      innerWireGeo.dispose();
      innerWireMat.dispose();
      ring1Geo.dispose();
      ring1Mat.dispose();
      ring2Geo.dispose();
      ring2Mat.dispose();
      sphereMat1.dispose();
      sphereMat2.dispose();
    };
  }, []);

  return (
    <div className={`relative flex items-center justify-center select-none ${className}`}>
      <canvas ref={canvasRef} className="w-full h-full block" />
      {badgeText && (
        <div className="absolute bottom-2 px-3 py-1 rounded-full bg-white/80 backdrop-blur-md border border-black/5 text-[#212529] text-[10px] font-mono font-semibold shadow-minimal flex items-center gap-1.5 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-[#4ADE80] animate-pulse" />
          <span>{badgeText}</span>
        </div>
      )}
    </div>
  );
};
