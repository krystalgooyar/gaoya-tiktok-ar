import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { openRoom, type Comment } from './liveRoom'
import './styles.css'

const viewer = location.pathname === '/viewer'

function cameraError(error: unknown) {
  switch (error instanceof Error ? error.name : '') {
    case 'NotAllowedError': return '相机权限被拒绝。请在地址栏的网站设置中允许使用相机。'
    case 'NotFoundError': return '没有找到摄像头。请连接摄像头后重试。'
    case 'NotReadableError': return '摄像头无法读取。请检查是否被其他应用占用。'
    default: return '无法打开摄像头：' + String(error)
  }
}

function App() {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const commentList = useRef<HTMLUListElement>(null)
  const room = useRef<ReturnType<typeof openRoom> | null>(null)
  const stopCamera = useRef<(() => void) | null>(null)
  const fireworkStarted = useRef(-Infinity)
  const [phase, setPhase] = useState('idle')
  const [cameraStatus, setCameraStatus] = useState('开启相机后，观众即可看到直播画面。')
  const [connection, setConnection] = useState({ status: '等待主播开播…', failed: false, connected: false })
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const list = commentList.current
    if (list) list.scrollTop = list.scrollHeight
  }, [comments])

  useEffect(() => {
    const preview = video.current
    try {
      const session = openRoom(
        viewer ? 'viewer' : 'host',
        (status, failed = false, connected = false) => setConnection({ status, failed, connected }),
        (comment) => {
          setComments((current) => [...current.filter((item) => item.id !== comment.id), comment].slice(-4))
          if (!viewer && comment.text.includes('✨')) fireworkStarted.current = performance.now()
        },
        (stream) => {
          if (!preview) return
          preview.srcObject = stream
          if (stream) void preview.play().catch(() => {
            if (preview.srcObject === stream) {
              setConnection({ status: '浏览器未能播放直播视频，请重试连接。', failed: true, connected: false })
            }
          })
        },
      )
      room.current = session
      if (viewer) session.retry()
      return () => {
        stopCamera.current?.()
        session.close()
        room.current = null
      }
    } catch (error) {
      setConnection({ status: '无法启动本地双端连接：' + String(error), failed: true, connected: false })
    }
  }, [])

  async function startCamera() {
    const source = video.current
    const output = canvas.current
    if (!source || !output || stopCamera.current) return

    let camera: MediaStream | undefined
    let broadcast: MediaStream | undefined
    let tracker: Awaited<ReturnType<typeof import('./faceTracking').createTracker>> | undefined
    let timer = 0
    let cancelled = false
    let step = 'camera'

    function stop() {
      cancelled = true
      stopCamera.current = null
      clearInterval(timer)
      camera?.getTracks().forEach((track) => track.stop())
      broadcast?.getTracks().forEach((track) => track.stop())
      source!.srcObject = null
      output!.getContext('2d')?.clearRect(0, 0, output!.width, output!.height)
      tracker?.close()
      room.current?.unpublish()
      fireworkStarted.current = -Infinity
    }

    function fail(message: string) {
      stop()
      setCameraStatus(message)
      setPhase('error')
    }

    stopCamera.current = stop
    setPhase('loading')
    setCameraStatus('等待相机权限…')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        fail('当前页面无法访问摄像头。请用独立浏览器打开 localhost 或 HTTPS 地址。')
        return
      }
      camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      if (cancelled) {
        camera.getTracks().forEach((track) => track.stop())
        return
      }
      camera.getVideoTracks()[0].addEventListener('ended', () => {
        if (!cancelled) fail('摄像头连接已断开，请检查设备后重试。')
      }, { once: true })
      source.srcObject = camera
      await source.play()
      if (cancelled) return

      step = 'model'
      setCameraStatus('正在加载人脸追踪模型…')
      const { createTracker, composeFrame } = await import('./faceTracking')
      if (cancelled) return
      tracker = await createTracker()
      if (cancelled) {
        tracker.close()
        return
      }

      step = 'broadcast'
      if (!room.current) throw new Error('本地直播连接未初始化，请刷新页面')
      output.width = source.videoWidth
      output.height = source.videoHeight
      const context = output.getContext('2d')
      if (!context) throw new Error('无法初始化合成画布')
      broadcast = output.captureStream(30)
      room.current.publish(broadcast)
      setPhase('live')

      let previousFrame = -1
      timer = window.setInterval(() => {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || source.currentTime === previousFrame) return
        previousFrame = source.currentTime
        try {
          const now = performance.now()
          const result = tracker!.detectForVideo(source, now)
          composeFrame(context, source, result, (now - fireworkStarted.current) / 1000)
        } catch (error) {
          console.error(error)
          fail('实时人脸追踪中断，请重试相机。')
        }
      }, 33)
    } catch (error) {
      if (cancelled) return
      console.error(error)
      fail(step === 'camera' ? cameraError(error) : step === 'model'
        ? '人脸模型加载失败，请确认浏览器支持 WebAssembly 和 WebGL。详情：' + String(error)
        : '无法合成直播视频：' + String(error))
    }
  }

  const live = viewer ? connection.connected : phase === 'live'

  return (
    <main className="phone" aria-label={viewer ? '观众端' : '主播端'}>
      <video ref={video} className={viewer ? 'feed' : 'camera-source'} muted playsInline aria-hidden={!viewer} aria-label={viewer ? '主播实时视频' : undefined} />
      {!viewer && <canvas ref={canvas} className="feed" hidden={!live} aria-label="合成直播画面" />}
      <header className="top">
        <div className="identity"><h1>AR Playground</h1><span>{viewer ? '观众端' : '主播端'}</span></div>
        <span className="badge">{live ? 'LIVE' : '预览'}</span>
      </header>

      <footer className="controls">
        <ul ref={commentList} className="comments" aria-label="直播评论" aria-live="polite">
          {comments.map((comment) => <li key={comment.id}><strong>观众</strong> {comment.text}</li>)}
        </ul>
        <p className="feedback" role="status">{viewer || live ? connection.status : cameraStatus}</p>
        {(viewer || live) && (connection.failed || (viewer && !connection.connected)) && (
          <button onClick={() => room.current ? room.current.retry() : location.reload()}>重试连接</button>
        )}
        {viewer ? (
          <form onSubmit={(event) => {
            event.preventDefault()
            const message = draft.trim()
            if (message && room.current?.send(message)) setDraft('')
          }}>
            <input aria-label="输入评论" placeholder="输入评论，例如 ✨" maxLength={120} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <button className="primary" disabled={!connection.connected || !draft.trim()}>发送</button>
            <button className="gift" type="button" disabled aria-label="礼物入口，暂未开放">🎁</button>
          </form>
        ) : live ? (
          <button onClick={() => { stopCamera.current?.(); setPhase('idle'); setCameraStatus('直播已结束。可以重新开启相机。') }}>结束直播</button>
        ) : (
          <button className="primary" disabled={phase === 'loading'} onClick={startCamera}>{phase === 'error' ? '重试相机' : '开启相机'}</button>
        )}
      </footer>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
