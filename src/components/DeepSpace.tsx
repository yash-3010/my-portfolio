import { useEffect, useMemo } from 'react'
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import type { Mesh } from 'three'

/**
 * Deep space beyond the starfield: a procedurally painted Andromeda hanging
 * in the black, a dwarf companion, and a few faint nebulae. Everything is a
 * canvas-texture plane facing the system's center — no downloads, fully
 * deterministic, drawn once at mount.
 */

const GALAXY_SEED = 0xa11d70

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Inclined spiral galaxy: core, tilted disk, arm speckles, dust lane. */
function paintGalaxy(): HTMLCanvasElement {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32(GALAXY_SEED)

  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate(-0.5)
  ctx.scale(1, 0.36) // strong inclination, M31-style
  ctx.globalCompositeOperation = 'lighter'

  // Outer disk glow.
  let g = ctx.createRadialGradient(0, 0, 0, 0, 0, 235)
  g.addColorStop(0, 'rgba(255, 243, 222, 0.55)')
  g.addColorStop(0.14, 'rgba(226, 220, 255, 0.34)')
  g.addColorStop(0.45, 'rgba(148, 168, 236, 0.16)')
  g.addColorStop(1, 'rgba(90, 110, 200, 0)')
  ctx.fillStyle = g
  ctx.fillRect(-size / 2, -size / 2, size, size)

  // Spiral-arm star speckles (two arms, loosely wound).
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 900; i++) {
      const t = rnd()
      const r = 18 + t * 208
      const theta = arm * Math.PI + r * 0.021 + (rnd() - 0.5) * 0.35
      const x = Math.cos(theta) * r + (rnd() - 0.5) * 14
      const y = Math.sin(theta) * r + (rnd() - 0.5) * 14
      const bright = ((1 - t) * 0.5 + 0.08) * (0.25 + rnd() * 0.5)
      ctx.fillStyle = `rgba(212, 222, 255, ${bright.toFixed(3)})`
      const s = 0.8 + rnd() * 1.8
      ctx.fillRect(x - s / 2, y - s / 2, s, s)
    }
  }

  // Hot core.
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 58)
  g.addColorStop(0, 'rgba(255, 240, 212, 0.95)')
  g.addColorStop(0.35, 'rgba(255, 226, 188, 0.5)')
  g.addColorStop(1, 'rgba(255, 214, 170, 0)')
  ctx.fillStyle = g
  ctx.fillRect(-120, -120, 240, 240)

  // Dust lane: darken only where the disk already glows.
  ctx.globalCompositeOperation = 'source-atop'
  ctx.strokeStyle = 'rgba(24, 18, 26, 0.4)'
  ctx.lineWidth = 13
  ctx.beginPath()
  ctx.arc(0, 34, 120, Math.PI * 1.12, Math.PI * 1.88)
  ctx.stroke()
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(0, 20, 72, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()

  ctx.restore()
  return canvas
}

/** Soft greyscale nebula blobs — tinted per-instance by material color. */
function paintNebula(seed: number): HTMLCanvasElement {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rnd = mulberry32(seed)

  ctx.clearRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 30; i++) {
    // Cluster blobs toward the middle so plane edges stay clean.
    const x = size / 2 + (rnd() + rnd() - 1) * size * 0.26
    const y = size / 2 + (rnd() + rnd() - 1) * size * 0.26
    const r = 22 + rnd() * 62
    const a = 0.03 + rnd() * 0.06
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255, 255, 255, ${a.toFixed(3)})`)
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  return canvas
}

function makeTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

interface PlaneSpec {
  texture: CanvasTexture
  /** Direction from the origin (normalized at build time). */
  dir: Vector3
  /** Distance and world size as multiples of the system radius. */
  dist: number
  size: number
  color: string
  opacity: number
  /** In-plane twist, radians. */
  roll: number
}

const noRaycast = () => null

export function DeepSpace({ radius }: { radius: number }) {
  const planes = useMemo<PlaneSpec[]>(() => {
    const galaxy = makeTexture(paintGalaxy())
    const nebulaA = makeTexture(paintNebula(0x9eb01a01))
    const nebulaB = makeTexture(paintNebula(0x9eb01a02))
    return [
      // Andromeda — placed to sit upper-left in the default overview frame
      // (the intro camera settles at ~(0, 0.85R, 1.55R) looking at origin).
      {
        texture: galaxy,
        dir: new Vector3(-0.47, -0.17, -0.87).normalize(),
        dist: 4.0,
        size: 2.2,
        color: '#ffffff',
        opacity: 0.85,
        roll: 0.3,
      },
      // Dwarf companion — same painting, tiny and warm-shifted.
      {
        texture: galaxy,
        dir: new Vector3(-0.66, -0.02, -0.75).normalize(),
        dist: 4.4,
        size: 0.55,
        color: '#ffd9bd',
        opacity: 0.5,
        roll: -0.8,
      },
      // Faint emission nebulae scattered around the sky.
      {
        texture: nebulaA,
        dir: new Vector3(-0.72, 0.22, 0.5).normalize(),
        dist: 3.4,
        size: 1.9,
        color: '#5a6fd0',
        opacity: 0.7,
        roll: 0,
      },
      {
        texture: nebulaB,
        dir: new Vector3(0.62, 0.1, -0.78).normalize(),
        dist: 3.6,
        size: 1.6,
        color: '#8a54a8',
        opacity: 0.55,
        roll: 1.1,
      },
      {
        texture: nebulaA,
        dir: new Vector3(0.15, 0.5, 0.82).normalize(),
        dist: 3.5,
        size: 1.5,
        color: '#3f7a74',
        opacity: 0.5,
        roll: 2.3,
      },
    ]
  }, [])

  useEffect(() => {
    const textures = new Set(planes.map((p) => p.texture))
    return () => {
      for (const tex of textures) tex.dispose()
    }
  }, [planes])

  return (
    <group>
      {planes.map((p, i) => (
        <mesh
          key={i}
          position={[p.dir.x * radius * p.dist, p.dir.y * radius * p.dist, p.dir.z * radius * p.dist]}
          onUpdate={(mesh: Mesh) => {
            mesh.lookAt(0, 0, 0)
            mesh.rotateZ(p.roll)
          }}
          renderOrder={-2}
          frustumCulled={false}
          raycast={noRaycast}
        >
          <planeGeometry args={[radius * p.size, radius * p.size]} />
          <meshBasicMaterial
            map={p.texture}
            color={p.color}
            transparent
            opacity={p.opacity}
            blending={AdditiveBlending}
            depthWrite={false}
            fog={false}
          />
        </mesh>
      ))}
    </group>
  )
}
