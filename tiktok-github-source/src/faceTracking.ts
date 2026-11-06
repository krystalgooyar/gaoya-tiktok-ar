/// <reference types="vite/client" />
import { drawCheekFireworks } from './cheekFireworks'
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import simdLoader from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url'
import simdBinary from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'
import fallbackLoader from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url'
import fallbackBinary from '../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm?url'

export async function createTracker(outputFaceBlendshapes = false, outputFacialTransformationMatrixes = false) {
  const simd = await FilesetResolver.isSimdSupported()
  return FaceLandmarker.createFromOptions({
    wasmLoaderPath: simd ? simdLoader : fallbackLoader,
    wasmBinaryPath: simd ? simdBinary : fallbackBinary,
  }, {
    baseOptions: { modelAssetPath: import.meta.env.BASE_URL + 'models/face_landmarker.task' },
    runningMode: 'VIDEO',
    outputFaceBlendshapes,
    outputFacialTransformationMatrixes,
    numFaces: 1,
  })
}

export function composeFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  result: FaceLandmarkerResult | undefined,
  fireworkAge: number,
) {
  const { width, height } = ctx.canvas
  ctx.setTransform(-1, 0, 0, 1, width, 0)
  ctx.drawImage(video, 0, 0, width, height)
  ctx.resetTransform()

  const face = result?.faceLandmarks[0]
  if (!face) return

  const point = (index: number) => ({
    x: (1 - face[index].x) * width,
    y: face[index].y * height,
  })
  const forehead = point(10)
  const chin = point(152)
  const size = Math.max(12, Math.min(76, Math.hypot(chin.x - forehead.x, chin.y - forehead.y) * 0.26))
  drawCheekFireworks(ctx, [point(50), point(280)], size, fireworkAge)
}
