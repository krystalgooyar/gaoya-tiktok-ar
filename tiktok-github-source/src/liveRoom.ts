type Role = 'host' | 'viewer'
type Signal =
  | { kind: 'hello' | 'ready' | 'offline' }
  | { kind: 'offer' | 'answer'; id: string; sdp: RTCSessionDescriptionInit }

export type Comment = { id: string; text: string }

function gatherDescription(peer: RTCPeerConnection, description: RTCSessionDescriptionInit) {
  return peer.setLocalDescription(description).then(() => new Promise<RTCSessionDescriptionInit>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', check)
      reject(new Error('收集本地连接地址超时'))
    }, 5000)
    function check() {
      if (peer.iceGatheringState !== 'complete' || !peer.localDescription) return
      clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', check)
      resolve(peer.localDescription.toJSON())
    }
    peer.addEventListener('icegatheringstatechange', check)
    check()
  }))
}

export function openRoom(
  role: Role,
  onStatus: (status: string, failed?: boolean, connected?: boolean) => void,
  onComment: (comment: Comment) => void,
  onVideo: (stream: MediaStream | null) => void,
) {
  const signals = new BroadcastChannel('tiktok-live-local-v1')
  let peer: RTCPeerConnection | undefined
  let data: RTCDataChannel | undefined
  let stream: MediaStream | undefined
  let id = ''
  let timeout = 0
  let heartbeat = 0

  function reset() {
    clearTimeout(timeout)
    clearInterval(heartbeat)
    const previous = peer
    peer = undefined
    data = undefined
    previous?.close()
    if (role === 'viewer') onVideo(null)
  }

  function fail(message: string) {
    reset()
    onStatus(message, true)
  }

  function setup(channel: RTCDataChannel, connection: RTCPeerConnection) {
    data = channel
    let lastMessage = Date.now()
    channel.onopen = () => {
      if (peer !== connection) return
      clearTimeout(timeout)
      lastMessage = Date.now()
      heartbeat = window.setInterval(() => {
        if (Date.now() - lastMessage > 10000 || channel.readyState !== 'open') {
          fail('双端连接已中断，请重试连接。')
          return
        }
        try { channel.send('ping') }
        catch { fail('双端连接已中断，请重试连接。') }
      }, 2000)
      onStatus(role === 'host' ? '观众已连接' : '已连接 · 发送 ✨ 点亮脸颊烟花', false, true)
    }
    channel.onclose = () => {
      if (peer === connection) fail('双端连接已断开，请重试连接。')
    }
    channel.onmessage = ({ data: payload }) => {
      if (peer !== connection || typeof payload !== 'string') return
      lastMessage = Date.now()
      if (payload === 'ping') return
      let comment: Comment
      try { comment = JSON.parse(payload) } catch { return }
      if (!comment || typeof comment.id !== 'string' || typeof comment.text !== 'string' || !comment.text.trim() || comment.text.length > 120) return
      onComment(comment)
      if (role === 'host' && channel.readyState === 'open') channel.send(JSON.stringify(comment))
    }
  }

  function connect() {
    reset()
    const connection = new RTCPeerConnection({ iceServers: [] })
    peer = connection
    onStatus('正在建立双端连接…')
    timeout = window.setTimeout(() => {
      if (peer === connection) fail('双端连接超时。请确认主播已开播，且两个页面在同一浏览器和同一地址下打开。')
    }, 12000)
    connection.onconnectionstatechange = () => {
      if (peer === connection && connection.connectionState === 'failed') fail('WebRTC 视频连接失败，请重试连接。')
    }
    return connection
  }

  async function offer() {
    if (peer) return
    let connection: RTCPeerConnection | undefined
    try {
      connection = connect()
      const current = connection
      id = crypto.randomUUID()
      current.ontrack = (event) => { if (peer === current) onVideo(event.streams[0] ?? new MediaStream([event.track])) }
      current.addTransceiver('video', { direction: 'recvonly' })
      setup(current.createDataChannel('comments'), current)
      const sdp = await gatherDescription(current, await current.createOffer())
      if (peer === current) signals.postMessage({ kind: 'offer', id, sdp } satisfies Signal)
    } catch (error) {
      if (peer === connection) fail('无法发起双端连接：' + String(error))
    }
  }

  signals.onmessage = async ({ data: signal }: MessageEvent<Signal>) => {
    if (role === 'viewer') {
      if (signal.kind === 'offline') {
        reset()
        onStatus('主播已结束或离开，请等待重新开播。')
      } else if (signal.kind === 'ready') {
        void offer()
      } else if (signal.kind === 'answer' && signal.id === id && peer) {
        const connection = peer
        try { await connection.setRemoteDescription(signal.sdp) }
        catch (error) { if (peer === connection) fail('无法接收主播连接：' + String(error)) }
      }
      return
    }

    if (!stream) return
    if (signal.kind === 'hello') signals.postMessage({ kind: 'ready' } satisfies Signal)
    if (signal.kind !== 'offer') return
    let connection: RTCPeerConnection | undefined
    try {
      connection = connect()
      const current = connection
      current.ondatachannel = (event) => { if (peer === current) setup(event.channel, current) }
      await current.setRemoteDescription(signal.sdp)
      if (peer !== current) return
      stream.getTracks().forEach((track) => current.addTrack(track, stream!))
      const sdp = await gatherDescription(current, await current.createAnswer())
      if (peer === current) signals.postMessage({ kind: 'answer', id: signal.id, sdp } satisfies Signal)
    } catch (error) {
      if (peer === connection) fail('无法发布主播视频：' + String(error))
    }
  }

  function retry() {
    reset()
    if (role === 'host') {
      if (stream) {
        onStatus('直播已开启，等待观众连接')
        signals.postMessage({ kind: 'offline' } satisfies Signal)
        signals.postMessage({ kind: 'ready' } satisfies Signal)
      }
    } else {
      onStatus('等待主播开播…')
      signals.postMessage({ kind: 'hello' } satisfies Signal)
    }
  }

  return {
    retry,
    publish(video: MediaStream) { stream = video; retry() },
    unpublish() {
      if (!stream) return
      stream = undefined
      reset()
      signals.postMessage({ kind: 'offline' } satisfies Signal)
    },
    send(text: string) {
      if (data?.readyState !== 'open') return false
      try { data.send(JSON.stringify({ id: crypto.randomUUID(), text })); return true }
      catch { fail('评论发送失败，请重试连接。'); return false }
    },
    close() {
      if (role === 'host' && stream) signals.postMessage({ kind: 'offline' } satisfies Signal)
      reset()
      signals.close()
    },
  }
}
