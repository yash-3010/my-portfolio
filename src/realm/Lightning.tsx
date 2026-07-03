import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { DirectionalLight } from 'three'

/**
 * Distant storm over the northern ranges: occasional multi-flicker lightning
 * bursts from a cold directional light. Runtime-random on purpose — weather
 * shouldn't be deterministic.
 */
export function Lightning() {
  const lightRef = useRef<DirectionalLight>(null)
  const state = useRef({ t: 0, next: 5 + Math.random() * 9, flashes: [] as number[] })

  useFrame((_, delta) => {
    const s = state.current
    const light = lightRef.current
    if (!light) return
    s.t += delta
    if (s.t >= s.next) {
      const flickers = 2 + Math.floor(Math.random() * 3)
      s.flashes = Array.from(
        { length: flickers },
        (_, i) => s.t + i * 0.11 + Math.random() * 0.06,
      )
      s.next = s.t + 8 + Math.random() * 16
      light.position.set((Math.random() * 2 - 1) * 150, 130, -90 - Math.random() * 70)
    }
    let intensity = 0
    for (const f of s.flashes) {
      const dt = s.t - f
      if (dt > 0 && dt < 0.22) {
        intensity = Math.max(intensity, (1 - dt / 0.22) * 2.6)
      }
    }
    light.intensity = intensity
    light.visible = intensity > 0.01
  })

  return <directionalLight ref={lightRef} color="#cfe0ff" intensity={0} visible={false} />
}
