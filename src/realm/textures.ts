import { CanvasTexture, RepeatWrapping } from 'three'
import { makeNoise2D } from './noise'

/**
 * Procedural PBR-ish detail maps (no downloaded assets): multi-octave noise
 * height fields converted to tangent-space normal maps via Sobel. Used for
 * terrain ground detail, the Wall's ice, and the sea surface.
 */

const cache = new Map<string, CanvasTexture>()

export function makeNoiseNormalMap(seed: number, strength = 2.2, size = 256): CanvasTexture {
  const key = `${seed}:${strength}:${size}`
  const cached = cache.get(key)
  if (cached) return cached

  const noise = makeNoise2D(seed)
  const height = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      let amp = 1
      let freq = 4 / size
      for (let o = 0; o < 5; o++) {
        v += noise(x * freq, y * freq) * amp
        amp *= 0.5
        freq *= 2
      }
      height[y * size + x] = v / 1.9375
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * size + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = Math.min(255, ((1 / len) * 0.5 + 0.5) * 255)
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  cache.set(key, texture)
  return texture
}
