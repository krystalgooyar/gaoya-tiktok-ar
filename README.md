# Gaoya TikTok AR

浏览器摄像头 AR 原型。微笑触发雨幕和落地水花，大笑触发烟花。烟花粒子会与跟随面部轮廓的边界碰撞。参考版还支持在烟花互动期间快速摇头甩开粒子、抬头引爆。

## 本地体验

使用 Node.js 22.12 或更高版本。

```sh
npm ci
npm run dev
```

在浏览器打开 [参考版预览](http://localhost:5173/blue-hour/?look=reference)，点击「开启相机」并授权。如果终端显示不同端口，请替换链接里的端口。摄像头画面在浏览器内处理。

## 构建与部署

```sh
npm run build
npm run preview
```

部署静态产物 `dist/`，从站点的 `/blue-hour/?look=reference` 进入。线上摄像头访问需要 HTTPS。构建产物包含模型与 MediaPipe WASM，运行时从本站加载。

## 调试

在预览地址末尾附加 `&debug=expression` 查看表情状态，`&debug=collision` 查看碰撞边界和接触点，或 `&debug=performance` 查看 FPS 与粒子数量。可追加 `&collider=ellipse` 强制使用椭圆回退模式。
