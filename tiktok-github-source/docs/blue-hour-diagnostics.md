# Blue Hour 诊断

运行 `npm ci` 和 `npm run dev`，用终端显示的本地地址打开 `/blue-hour/`。
也可以运行 `npm run build` 和 `npm exec vite preview` 检查生产构建。
安装依赖后，Three.js、MediaPipe、SIMD/非 SIMD WASM 和模型均由项目服务器提供。测试离线时保持本机服务器运行，再断开外网。

## 调试入口

- `?debug=expression` 显示左右嘴角、下颌的原始分数，平滑分数、嘴唇开合比，以及大笑的两项判定条件。
- `?debug=performance` 每半秒显示实际渲染帧率、活跃粒子数和火箭队列长度。
- `?debug=collision` 用绿色显示凸包、橙色显示回退椭圆，用红色标记接触点和法线。
- 参数可以叠加，例如 `?debug=expression&debug=performance&debug=collision`。添加 `&collider=ellipse` 可以强制使用椭圆。

## 表情校准

| URL 参数 | 进入默认值 | 退出参数及默认值 |
| --- | --- | --- |
| `smileEnter` | .35 | `smileExit=.29` |
| `laughSmileEnter` | .22 | `laughSmileExit=.15` |
| `jawEnter` | .23 | `jawExit=.16` |
| `lipEnter` | .25 | `lipExit=.18` |

`smileHoldMs=48` 用于平静进入微笑，`holdMs=105` 用于其余切换，`cooldownMs=250` 用于两次切换之间的冷却。分数参数范围为 0–1，时间参数范围为 0–3000 毫秒。参数仅作用于当前 URL，移除即可恢复默认值。调参时保持退出值低于相应进入值。

依次测试平静、正常说话、单独张嘴、轻微微笑、明显微笑和大笑，每种重复五次，再重复快速切换和轻微转头。记录原始左右分数、平滑分数、预期状态、实际状态和是否来回切换。漏检时先确认平滑笑意是否达到进入门槛，以及候选是否保持到计时结束。一次只改一个参数，再重复同一组动作。

MediaPipe 的输出是面部形变系数。页面用下颌分数或嘴唇开合比判断张嘴，再结合笑意判定大笑。说话和张嘴是校准时应单独测试的动作，页面没有语音或笑声分类器。
[Google MediaPipe Blendshapes](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/drawing_styles/face_landmarker/Blendshapes)

## 设备验证

在每台设备上用同一组动作测试平静、连续微笑、连续大笑各 10 秒，记录设备、浏览器、视口、FPS 范围和峰值粒子数。用碰撞模式转头并比较两种边界。关闭相机后确认 FPS 回到空值、粒子数归零、相机指示熄灭，再重新开启一次。
