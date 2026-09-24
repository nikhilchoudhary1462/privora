import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { 
  ShieldCheck, 
  Cpu, 
  Lock, 
  Sparkles, 
  ArrowRight, 
  EyeOff, 
  FileText, 
  QrCode, 
  Fingerprint, 
  CheckCircle,
  Zap,
  Terminal,
  Layers,
  ChevronRight
} from 'lucide-react';

interface LandingPageProps {
  onLaunchApp: () => void;
  onNavigateTab: (tab: 'scan' | 'vault' | 'policy' | 'assistant' | 'p2p' | 'audit') => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onLaunchApp, onNavigateTab }) => {
  const heroCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiwCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctaCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [activeHiwStep, setActiveHiwStep] = useState<number>(0);

  // ─────────────────────────────────────────────────────────────
  // 1. TOP HERO 3D CANVAS (Fully Formed, Glossy Physical Torus Knot)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = heroCanvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth || 360;
    const height = parent?.clientHeight || 300;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    
    // Balanced lighting so all sides are illuminated
    const ambLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(4, 7, 5);
    scene.add(dirLight);

    const pointLight1 = new THREE.PointLight(0x9C8DD4, 3.5, 16);
    pointLight1.position.set(-3.5, 3, 4);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xE2D9FF, 2.0, 14);
    pointLight2.position.set(3.5, -2, 3);
    scene.add(pointLight2);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(0, 0.1, 5.8);

    const group = new THREE.Group();
    scene.add(group);

    // Thick, solid, fully formed Torus Knot with rich physical specular highlights
    const knotGeo = new THREE.TorusKnotGeometry(0.95, 0.32, 128, 32, 2, 3);
    const knotMat = new THREE.MeshPhysicalMaterial({
      color: 0x9C8DD4,
      emissive: 0x2A1B4E,
      emissiveIntensity: 0.2,
      metalness: 0.15,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.94,
      depthWrite: true,
    });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    group.add(knot);

    // Primary Outer orbit ring
    const ringGeo1 = new THREE.TorusGeometry(2.0, 0.035, 24, 120);
    const ringMat1 = new THREE.MeshPhysicalMaterial({
      color: 0xB8ACEC,
      metalness: 0.7,
      roughness: 0.1,
      transparent: true,
      opacity: 0.75,
      depthWrite: true,
    });
    const outerRing1 = new THREE.Mesh(ringGeo1, ringMat1);
    outerRing1.rotation.x = Math.PI / 3.2;
    outerRing1.rotation.z = 0.25;
    group.add(outerRing1);

    // Secondary Outer orbit ring at offset angle
    const ringGeo2 = new THREE.TorusGeometry(2.35, 0.02, 24, 120);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0xC4B8F0,
      transparent: true,
      opacity: 0.3,
    });
    const outerRing2 = new THREE.Mesh(ringGeo2, ringMat2);
    outerRing2.rotation.x = Math.PI / 2.2;
    outerRing2.rotation.y = 0.6;
    group.add(outerRing2);

    // Orbiting satellite spheres
    const dotMat = new THREE.MeshPhysicalMaterial({
      color: 0xE8E0FF,
      emissive: 0x9C8DD4,
      emissiveIntensity: 0.3,
      metalness: 0.5,
      roughness: 0.1,
      depthWrite: true,
    });
    const orbiters: { mesh: THREE.Mesh; offset: number; speed: number; dist: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 20), dotMat);
      group.add(s);
      orbiters.push({
        mesh: s,
        offset: (i * Math.PI) / 2,
        speed: 0.75 + i * 0.05,
        dist: 2.05 + (i % 2) * 0.3,
      });
    }

    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      group.rotation.y = t * 0.22;
      group.rotation.x = Math.sin(t * 0.3) * 0.12;
      group.position.y = Math.sin(t * 0.5) * 0.08;
      knot.rotation.z = t * 0.18;

      orbiters.forEach((o) => {
        o.mesh.position.set(
          Math.cos(t * o.speed + o.offset) * o.dist,
          Math.sin(t * (o.speed * 0.8) + o.offset) * 0.45,
          Math.sin(t * o.speed + o.offset) * o.dist
        );
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleMouseMove = (e: MouseEvent) => {
      const cx = (e.clientX / window.innerWidth - 0.5) * 0.35;
      group.rotation.y += (cx - group.rotation.y) * 0.05;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Resize observer to keep aspect ratio perfect
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const h = entry.contentRect.height;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    if (parent) resizeObserver.observe(parent);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      resizeObserver.disconnect();
      renderer.dispose();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // 2. HOW IT WORKS 3D CANVAS (Solid, Perfectly Formed 3 Steps)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = hiwCanvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth || 380;
    const height = parent?.clientHeight || 340;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(4, 7, 5);
    scene.add(dir);

    const pLight = new THREE.PointLight(0x9C8DD4, 3.0, 14);
    pLight.position.set(-2, 2, 4);
    scene.add(pLight);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 5.2);

    const group = new THREE.Group();
    scene.add(group);

    const createSolidStepMat = (active = false) =>
      new THREE.MeshPhysicalMaterial({
        color: 0x9C8DD4,
        emissive: 0x2A1B4E,
        emissiveIntensity: active ? 0.35 : 0.1,
        metalness: 0.15,
        roughness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: active ? 0.98 : 0.75,
        depthWrite: true,
      });

    // Step 1: Solid Chamfered Cube
    const g1 = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    const m1 = new THREE.Mesh(g1, createSolidStepMat(activeHiwStep === 0));
    m1.position.set(-1.45, 0, 0);
    group.add(m1);

    // Step 2: Solid Octahedron
    const g2 = new THREE.OctahedronGeometry(0.72, 0);
    const m2 = new THREE.Mesh(g2, createSolidStepMat(activeHiwStep === 1));
    m2.position.set(0, 0, 0);
    group.add(m2);

    // Step 3: Solid Icosahedron
    const g3 = new THREE.IcosahedronGeometry(0.72, 1);
    const m3 = new THREE.Mesh(g3, createSolidStepMat(activeHiwStep === 2));
    m3.position.set(1.45, 0, 0);
    group.add(m3);

    const shapes = [m1, m2, m3];

    // Connecting beam line
    const pts = [new THREE.Vector3(-1.45, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.45, 0, 0)];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0x9C8DD4, transparent: true, opacity: 0.4 })
    );
    group.add(line);

    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = t * 0.18;

      shapes.forEach((s, i) => {
        s.rotation.x = t * (0.28 + i * 0.08);
        s.rotation.z = t * (0.2 + i * 0.06);
        const isActive = i === activeHiwStep;
        s.scale.setScalar(isActive ? 1.14 + Math.sin(t * 2.5) * 0.04 : 0.95);
      });

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, [activeHiwStep]);

  // ─────────────────────────────────────────────────────────────
  // 3. CTA SECTION 3D CANVAS (Solid Glowing Icosahedron with Rings)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = ctaCanvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth || 360;
    const height = parent?.clientHeight || 280;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 1.8);
    dir.position.set(4, 7, 5);
    scene.add(dir);

    const pointLight = new THREE.PointLight(0x9C8DD4, 3.0, 14);
    pointLight.position.set(-3, 3, 3);
    scene.add(pointLight);

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(0, 0.2, 5.2);

    const group = new THREE.Group();
    scene.add(group);

    // Solid Icosahedron
    const icosa = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.95, 1),
      new THREE.MeshPhysicalMaterial({
        color: 0x9C8DD4,
        emissive: 0x2A1B4E,
        emissiveIntensity: 0.2,
        metalness: 0.15,
        roughness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        transparent: true,
        opacity: 0.95,
        depthWrite: true,
      })
    );
    group.add(icosa);

    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.035, 24, 100),
      new THREE.MeshPhysicalMaterial({
        color: 0xB8ACEC,
        metalness: 0.7,
        roughness: 0.1,
        transparent: true,
        opacity: 0.75,
        depthWrite: true,
      })
    );
    ring1.rotation.x = Math.PI / 2.5;
    ring1.rotation.z = 0.3;
    group.add(ring1);

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(1.85, 0.02, 24, 100),
      new THREE.MeshBasicMaterial({ color: 0xC4B8F0, transparent: true, opacity: 0.35 })
    );
    ring2.rotation.x = Math.PI / 3.5;
    ring2.rotation.y = 0.8;
    group.add(ring2);

    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = t * 0.26;
      group.rotation.x = Math.sin(t * 0.35) * 0.14;
      group.position.y = Math.sin(t * 0.6) * 0.08;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F1F3F5] text-[#212529] selection:bg-[#9C8DD4] selection:text-white font-sans overflow-x-hidden">
      
      {/* ── HERO SECTION ── */}
      <section className="relative min-h-[92vh] flex flex-col items-center justify-center pt-28 pb-16 px-6 bg-gradient-to-b from-[#F1F3F5] via-[#EEF0F8] to-[#FAF9F6] overflow-hidden">
        
        {/* Subtle grid pattern background */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage: `
              linear-gradient(rgba(156,141,212,.08) 1px, transparent 1px),
              linear-gradient(90deg, rgba(156,141,212,.08) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />

        {/* Ambient floating orbs */}
        <div className="absolute w-[500px] h-[500px] -top-24 -right-36 rounded-full pointer-events-none bg-radial from-[#9C8DD4]/15 to-transparent blur-3xl animate-orb" />
        <div className="absolute w-[360px] h-[360px] bottom-10 -left-20 rounded-full pointer-events-none bg-radial from-[#9C8DD4]/12 to-transparent blur-3xl animate-orb" style={{ animationDelay: '-4s' }} />

        {/* Eyebrow Tag */}
        <div className="font-mono text-[11px] text-[#9C8DD4] tracking-widest uppercase mb-4 flex items-center gap-2">
          <span className="opacity-40">—</span>
          <span>Zero-Knowledge On-Device Privacy Engine</span>
          <span className="opacity-40">—</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-light text-[#212529] tracking-tight text-center leading-none mb-3">
          Privacy by<br />
          <strong className="font-bold">mathematics</strong>
          <span className="text-[#E77A73]">.</span>
        </h1>

        {/* Hero Subtitle */}
        <p className="font-mono text-xs sm:text-sm text-[#757575] tracking-wide text-center max-w-xl mb-8">
          // On-Device AI Detection · Deterministic Verhoeff/Luhn Rules · Web Crypto AES-256
        </p>

        {/* 3D Canvas (Torus Knot at the Top) */}
        <div className="w-[340px] h-[280px] sm:w-[420px] sm:h-[320px] relative mb-8 flex items-center justify-center">
          <canvas ref={heroCanvasRef} className="block w-full h-full" />
          <div 
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-48 h-6 rounded-full blur-md pointer-events-none"
            style={{ background: 'radial-gradient(ellipse, rgba(156,141,212,.35) 0%, transparent 70%)' }}
          />
        </div>

        {/* Hero Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 z-10">
          <button
            onClick={onLaunchApp}
            className="bg-[#A99DD8] hover:bg-[#8A7BC7] text-white px-7 py-3 rounded-full font-semibold text-xs sm:text-sm shadow-minimal hover:shadow-purple-glow transition-all transform hover:-translate-y-0.5 flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            <span>Launch Privacy Studio</span>
          </button>

          <a
            href="#how"
            className="bg-transparent border border-black/10 hover:border-[#9C8DD4] text-[#757575] hover:text-[#9C8DD4] px-6 py-2.5 rounded-full font-medium text-xs sm:text-sm transition-all"
          >
            See how it works
          </a>
        </div>

        {/* Live Code Pill */}
        <div className="mt-8 font-mono text-[11px] text-[#757575] bg-white border border-black/5 px-5 py-2 rounded-full shadow-minimal flex items-center gap-2">
          <span className="text-[#9C8DD4] font-semibold">POST</span>
          <span>/upload</span>
          <span className="text-[#757575]">→</span>
          <span className="text-[#4ADE80] font-semibold">Intercepted & Encrypted (0 bytes leaked)</span>
          <span className="text-[#757575]">·</span>
          <span>AES-256-GCM ✓</span>
        </div>
      </section>

      {/* ── TICKER ── */}
      <div className="overflow-hidden border-y border-black/5 bg-[#FAF9F6] py-2.5">
        <div className="flex gap-0 whitespace-nowrap animate-ticker">
          {[
            'Zero Cloud',
            'WebAssembly (WASM)',
            'AES-256-GCM',
            'Verhoeff Checksum D5',
            'Luhn Algorithm Mod10',
            'WebAuthn Touch ID',
            'Serverless WebRTC P2P',
            'DPDP / GDPR Compliant',
            'In-Browser DistilBERT',
            'Zero Bytes Leaked',
            'Zero Cloud',
            'WebAssembly (WASM)',
            'AES-256-GCM',
            'Verhoeff Checksum D5',
            'Luhn Algorithm Mod10',
            'WebAuthn Touch ID',
            'Serverless WebRTC P2P',
            'DPDP / GDPR Compliant',
            'In-Browser DistilBERT',
            'Zero Bytes Leaked',
          ].map((item, i) => (
            <div
              key={i}
              className="font-mono text-[10px] text-[#757575] tracking-wider px-8 border-r border-black/5 uppercase flex items-center gap-2"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#9C8DD4]" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <section id="how" className="max-w-6xl mx-auto py-24 px-6">
        <div className="font-mono text-[10px] text-[#9C8DD4] tracking-widest uppercase mb-3">
          — Pipeline Architecture
        </div>
        <h2 className="text-3xl sm:text-5xl font-light text-[#212529] tracking-tight leading-tight mb-4">
          Three steps to<br />
          <strong className="font-bold">absolute local privacy</strong>
          <span className="text-[#E77A73]">.</span>
        </h2>
        <p className="text-xs sm:text-sm text-[#757575] max-w-lg mb-12">
          No data or keys leave the device. Detection, classification, and encryption execute strictly in your browser runtime.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Interactive Steps List */}
          <div className="flex flex-col gap-0 border-t border-black/5">
            {[
              {
                num: '01',
                title: 'Intercept & Deterministic Scan',
                desc: 'Client-side OCR (Tesseract.js), facial vision, and mathematical checksums (Verhoeff D5 for Indian Aadhaar, Luhn for credit cards) locate exact pixel bounding boxes.',
              },
              {
                num: '02',
                title: 'Hybrid AI Reasoning (Rules + On-Device Model)',
                desc: 'An authoritative compliance rule engine joins an on-device Small Transformer (DistilBERT via WebGPU) to classify document risk and assign surgical encryption actions.',
              },
              {
                num: '03',
                title: 'Native Web Crypto AES-256 Vaulting',
                desc: 'Generates per-file Data Encryption Keys (DEKs) wrapped under a master KEK. Sensitive slices or full files are encrypted into tamper-proof ciphertext with SHA-256 verification.',
              },
            ].map((step, idx) => {
              const isActive = activeHiwStep === idx;
              return (
                <div
                  key={step.num}
                  onClick={() => setActiveHiwStep(idx)}
                  className={`flex gap-5 py-6 border-b border-black/5 cursor-pointer transition-all ${
                    isActive ? 'bg-white/60 px-4 rounded-xl -mx-4' : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-mono text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-[#9C8DD4] text-white'
                        : 'bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 text-[#9C8DD4]'
                    }`}
                  >
                    {step.num}
                  </div>
                  <div>
                    <h3
                      className={`text-sm sm:text-base font-semibold mb-1 transition-colors ${
                        isActive ? 'text-[#9C8DD4]' : 'text-[#212529]'
                      }`}
                    >
                      {step.title}
                    </h3>
                    <p className="text-xs text-[#757575] leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 3D Visualizer Canvas */}
          <div className="w-full h-[340px] flex items-center justify-center bg-[#FAF9F6] rounded-2xl border border-black/5 shadow-minimal">
            <canvas ref={hiwCanvasRef} className="block w-full h-full" />
          </div>
        </div>
      </section>

      {/* ── STATS BAND ── */}
      <div className="bg-white border-y border-black/5 py-12 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div className="p-4 border-r border-black/5 last:border-none">
            <div className="text-4xl sm:text-5xl font-light text-[#212529] tracking-tight mb-1">
              0<span className="text-[#9C8DD4]">B</span>
            </div>
            <div className="font-mono text-[10px] text-[#757575] uppercase tracking-wider">Data Leaked Off-Device</div>
          </div>
          <div className="p-4 border-r border-black/5 last:border-none">
            <div className="text-4xl sm:text-5xl font-light text-[#212529] tracking-tight mb-1">
              100<span className="text-[#9C8DD4]">%</span>
            </div>
            <div className="font-mono text-[10px] text-[#757575] uppercase tracking-wider">On-Device Local AI</div>
          </div>
          <div className="p-4 border-r border-black/5 last:border-none">
            <div className="text-4xl sm:text-5xl font-light text-[#212529] tracking-tight mb-1">
              256<span className="text-[#9C8DD4]">-bit</span>
            </div>
            <div className="font-mono text-[10px] text-[#757575] uppercase tracking-wider">Web Crypto AES-GCM</div>
          </div>
          <div className="p-4">
            <div className="text-4xl sm:text-5xl font-light text-[#212529] tracking-tight mb-1">
              0<span className="text-[#9C8DD4]">s</span>
            </div>
            <div className="font-mono text-[10px] text-[#757575] uppercase tracking-wider">Server Latency</div>
          </div>
        </div>
      </div>

      {/* ── FEATURES GRID ── */}
      <section id="features" className="max-w-6xl mx-auto py-24 px-6">
        <div className="font-mono text-[10px] text-[#9C8DD4] tracking-widest uppercase mb-3">
          — Core Capabilities
        </div>
        <h2 className="text-3xl sm:text-5xl font-light text-[#212529] tracking-tight leading-tight mb-12">
          Engineered for<br />
          <strong className="font-bold">zero-compromise security</strong>
          <span className="text-[#E77A73]">.</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: '⚡',
              title: 'Mathematical Checksums',
              desc: 'Uses dihedral group D5 Verhoeff algorithm for Indian Aadhaar and Luhn Mod10 for payment cards to eliminate false positives.',
              tag: 'ZERO FALSE POSITIVES',
              tab: 'scan' as const,
            },
            {
              icon: '🤖',
              title: 'Hybrid AI Decision Engine',
              desc: 'Combines authoritative deterministic policy rules with an on-device DistilBERT neural model running via WebGPU / WASM.',
              tag: 'RULES_WIN ENSEMBLE',
              tab: 'policy' as const,
            },
            {
              icon: '🔒',
              title: 'Selective Region Encryption',
              desc: 'Encrypts only the sensitive bounding boxes (faces, ID numbers) into AES-GCM ciphertext while keeping surrounding document legible.',
              tag: 'LIVE BLUR PREVIEW',
              tab: 'scan' as const,
            },
            {
              icon: '📡',
              title: 'Zero-Server P2P Sharing',
              desc: 'Exchanges encrypted files direct browser-to-browser via WebRTC DataChannels using Vanilla ICE QR code signaling—no signaling server.',
              tag: 'AIR-GAPPED QR HANDSHAKE',
              tab: 'p2p' as const,
            },
            {
              icon: '👆',
              title: 'Biometric WebAuthn Unlock',
              desc: 'Hardware Touch ID, Face ID, and Windows Hello PRF key derivation protects master vault keys without storing plaintext passwords.',
              tag: 'HARDWARE SECURITY KEY',
              tab: 'vault' as const,
            },
            {
              icon: '🛡️',
              title: 'Manifest V3 Browser Shield',
              desc: 'Intercepts sensitive text pastes and document drag-and-drops on any website before underlying HTTP network sockets fire.',
              tag: 'PRE-UPLOAD INTERCEPTION',
              tab: 'audit' as const,
            },
          ].map((feat, idx) => (
            <div
              key={idx}
              onClick={() => onNavigateTab(feat.tab)}
              className="group bg-white rounded-2xl p-6 border border-black/5 shadow-minimal hover:shadow-minimal-hover transition-all transform hover:-translate-y-1 cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="w-10 h-10 rounded-xl bg-[#9C8DD4]/15 flex items-center justify-center text-lg mb-4">
                  {feat.icon}
                </div>
                <h3 className="text-sm sm:text-base font-bold text-[#212529] mb-2 group-hover:text-[#9C8DD4] transition-colors">
                  {feat.title}
                </h3>
                <p className="text-xs text-[#757575] leading-relaxed mb-4">{feat.desc}</p>
              </div>
              <div>
                <span className="font-mono text-[9px] text-[#9C8DD4] bg-[#9C8DD4]/10 border border-[#9C8DD4]/20 px-2.5 py-1 rounded-full uppercase tracking-wider inline-block">
                  {feat.tag}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CODE / DEVELOPER DEMO SECTION ── */}
      <section className="bg-[#FAF9F6] border-y border-black/5 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-[10px] text-[#9C8DD4] tracking-widest uppercase mb-3">
            — Developer Experience
          </div>
          <h2 className="text-3xl sm:text-5xl font-light text-[#212529] tracking-tight leading-tight mb-12">
            AI decides. <strong className="font-bold">Cryptography protects</strong>
            <span className="text-[#E77A73]">.</span>
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Syntax Highlighted Code Box */}
            <div className="bg-[#1E1E2E] rounded-2xl overflow-hidden shadow-2xl text-left font-mono text-xs leading-relaxed">
              <div className="bg-[#2A2A3E] px-4 py-3 flex items-center gap-2 border-b border-white/5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E77A73]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#F0C66A]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#4ADE80]" />
                <span className="text-white/30 text-[10px] ml-2">aegis-core-interceptor.ts</span>
              </div>
              <div className="p-5 text-[#CDD6F4] space-y-1">
                <div><span className="text-[#6C7086]">// 1. Intercept file before network socket</span></div>
                <div><span className="text-[#CBA6F7]">const</span> <span className="text-[#89B4FA]">result</span> = <span className="text-[#CBA6F7]">await</span> <span className="text-[#89B4FA]">MasterDetector</span>.<span className="text-[#89B4FA]">scan</span>(file);</div>
                <div>&nbsp;</div>
                <div><span className="text-[#6C7086]">// 2. Mathematical checksums (Zero Hallucinations)</span></div>
                <div><span className="text-[#CBA6F7]">const</span> <span className="text-[#89B4FA]">isValidAadhaar</span> = <span className="text-[#89B4FA]">validateVerhoeff</span>(result.<span className="text-[#FAB387]">aadhaar</span>);</div>
                <div>&nbsp;</div>
                <div><span className="text-[#6C7086]">// 3. Web Crypto AES-256-GCM Envelope Encryption</span></div>
                <div><span className="text-[#CBA6F7]">const</span> <span className="text-[#89B4FA]">dek</span> = <span className="text-[#CBA6F7]">await</span> crypto.<span className="text-[#89B4FA]">subtle</span>.<span className="text-[#89B4FA]">generateKey</span>(</div>
                <div>&nbsp;&nbsp;&#123; <span className="text-[#FAB387]">name</span>: <span className="text-[#A6E3A1]">'AES-GCM'</span>, <span className="text-[#FAB387]">length</span>: <span className="text-[#FAB387]">256</span> &#125;,</div>
                <div>&nbsp;&nbsp;<span className="text-[#FAB387]">true</span>, [<span className="text-[#A6E3A1]">'encrypt'</span>, <span className="text-[#A6E3A1]">'decrypt'</span>]</div>
                <div>);</div>
                <div>&nbsp;</div>
                <div><span className="text-[#6C7086]">// Output: 0 bytes leaves the device ✓</span></div>
                <div className="text-[#4ADE80] font-bold">&#47;&#47; SHA-256 Integrity Hash Verified</div>
              </div>
            </div>

            {/* Explanation Points */}
            <div className="flex flex-col gap-6">
              {[
                {
                  title: 'Pure Web Standards',
                  desc: 'All cryptographic primitives are invoked directly through window.crypto.subtle. No untrusted third-party math libraries or cloud key custodians.',
                },
                {
                  title: 'Hardware Biometric Keys',
                  desc: 'The master key is derived locally via the WebAuthn PRF extension or PBKDF2 with 100,000 SHA-256 iterations.',
                },
                {
                  title: 'Serverless P2P Channels',
                  desc: 'WebRTC data channels connect directly through QR codes. Even metadata like IP and timestamps stay off centralized signaling logs.',
                },
              ].map((pt, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-7 h-7 rounded-lg bg-[#9C8DD4]/15 border border-[#9C8DD4]/30 text-[#9C8DD4] font-mono text-xs flex items-center justify-center flex-shrink-0">
                    0{i + 1}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#212529] mb-1">{pt.title}</h4>
                    <p className="text-xs text-[#757575] leading-relaxed">{pt.desc}</p>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <button
                  onClick={onLaunchApp}
                  className="bg-[#A99DD8] hover:bg-[#8A7BC7] text-white px-6 py-2.5 rounded-full font-semibold text-xs transition-all shadow-minimal hover:shadow-purple-glow inline-flex items-center gap-2"
                >
                  <span>Open Privacy Studio →</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA SECTION WITH BOTTOM 3D MODEL ── */}
      <section className="max-w-6xl mx-auto py-24 px-6">
        <div className="bg-gradient-to-tr from-[#EEF0F8] via-[#FAF9F6] to-white rounded-3xl p-8 sm:p-14 border border-black/5 shadow-minimal grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          <div>
            <div className="font-mono text-[10px] text-[#9C8DD4] tracking-widest uppercase mb-3">
              — Ready for Hackathon Review
            </div>
            <h2 className="text-3xl sm:text-5xl font-light text-[#212529] tracking-tight leading-tight mb-4">
              Your private vault is<br />
              <strong className="font-bold">one click away</strong>
              <span className="text-[#E77A73]">.</span>
            </h2>
            <p className="text-xs sm:text-sm text-[#757575] leading-relaxed mb-8">
              No cloud accounts. No tracking. Drop any government ID, photo, code token, or PDF into the studio to test instant on-device redaction and encryption.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={onLaunchApp}
                className="bg-[#A99DD8] hover:bg-[#8A7BC7] text-white px-7 py-3 rounded-full font-semibold text-xs sm:text-sm shadow-minimal hover:shadow-purple-glow transition-all"
              >
                ⚡ Launch Studio — 100% Free
              </button>
              <button
                onClick={() => onNavigateTab('vault')}
                className="bg-transparent border border-black/10 hover:border-[#9C8DD4] text-[#757575] hover:text-[#9C8DD4] px-6 py-2.5 rounded-full font-medium text-xs sm:text-sm transition-all"
              >
                View Local Vault
              </button>
            </div>
          </div>

          <div className="w-full h-[280px] flex items-center justify-center">
            <canvas ref={ctaCanvasRef} className="block w-full h-full" />
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-black/5 bg-[#F1F3F5] py-8 px-6 text-xs text-[#757575]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#212529] text-sm">Privora<span className="text-[#E77A73]">.</span></span>
            <span className="font-mono text-[10px] bg-[#E2E1E6] text-[#757575] px-2 py-0.5 rounded-full">v2.2 beta</span>
          </div>

          <div className="flex gap-6 font-medium text-xs">
            <button onClick={() => onNavigateTab('scan')} className="hover:text-[#9C8DD4]">Scanner</button>
            <button onClick={() => onNavigateTab('vault')} className="hover:text-[#9C8DD4]">Vault</button>
            <button onClick={() => onNavigateTab('policy')} className="hover:text-[#9C8DD4]">Policy Studio</button>
            <button onClick={() => onNavigateTab('p2p')} className="hover:text-[#9C8DD4]">P2P Transfer</button>
            <button onClick={() => onNavigateTab('audit')} className="hover:text-[#9C8DD4]">Audit Log</button>
          </div>

          <div className="font-mono text-[10px]">
            © 2026 Privora (AegisGuard) · Zero Cloud Architecture
          </div>
        </div>
      </footer>
    </div>
  );
};
