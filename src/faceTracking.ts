/// <reference types="vite/client" />
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
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
