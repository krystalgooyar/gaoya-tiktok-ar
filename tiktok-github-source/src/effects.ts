export type Expression = 'neutral' | 'smile' | 'laugh'
export type Point = { x: number; y: number }

type Particle = Point & { vx: number; vy: number; life: number; hue: number }

export function animateEffect(canvas: HTMLCanvasElement, head: HTMLElement, expression: Expression) {
  const context = canvas.getContext('2d')
  if (!context) return

  let frame = 0
  let last = 0
  let nextSpawn = 0
  let particles: Particle[] = []

  function draw(time: number) {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const scale = Math.min(devicePixelRatio, 2)
    const pixelWidth = Math.round(width * scale)
    const pixelHeight = Math.round(height * scale)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    context!.setTransform(scale, 0, 0, scale, 0, 0)
    context!.clearRect(0, 0, width, height)

    const dt = Math.min((time - (last || time)) / 1000, 0.033)
    last = time
    const bounds = canvas.getBoundingClientRect()
    const face = head.getBoundingClientRect()
    const centerX = face.left - bounds.left + face.width / 2
    const centerY = face.top - bounds.top + face.height / 2
    const radiusX = face.width / 2
    const radiusY = face.height / 2

    if (time >= nextSpawn && width && height) {
      if (expression === 'smile') {
        for (let i = 0; i < 6; i++) {
          particles.push({ x: Math.random() * width, y: -18, vx: -35, vy: 260 + Math.random() * 180, life: 4, hue: 194 })
        }
        nextSpawn = time + 70
      }
      if (expression === 'laugh') {
        const fromLeft = centerX > width / 2
        const x = fromLeft ? Math.max(0, centerX - radiusX - 56) : Math.min(width, centerX + radiusX + 56)
        for (let i = 0; i < 64; i++) {
          const angle = Math.random() * Math.PI * 2
          const speed = 60 + Math.random() * 250
          particles.push({
            x, y: centerY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 0.7 + Math.random() * 0.8, hue: [28, 45, 318, 174][i % 4],
          })
        }
        nextSpawn = time + 800
      }
    }

    particles = particles.filter((particle) => {
      particle.life -= dt
      if (particle.life <= 0 || particle.y > height + 20) return false
      particle.x += particle.vx * dt
      particle.y += particle.vy * dt
      if (expression === 'laugh' && radiusX && radiusY) {
        particle.vy += 140 * dt
        const dx = (particle.x - centerX) / radiusX
        const dy = (particle.y - centerY) / radiusY
        const distance = Math.hypot(dx, dy)
        if (distance > 0 && distance < 1) {
          const nx = dx / radiusX
          const ny = dy / radiusY
          const normalLength = Math.hypot(nx, ny)
          const normalX = nx / normalLength
          const normalY = ny / normalLength
          const incoming = particle.vx * normalX + particle.vy * normalY
          particle.x = centerX + dx / distance * (radiusX + 2)
          particle.y = centerY + dy / distance * (radiusY + 2)
          if (incoming < 0) {
            particle.vx -= 1.8 * incoming * normalX
            particle.vy -= 1.8 * incoming * normalY
          }
        }
      }

      const trail = expression === 'smile' ? 0.045 : 0.025
      context!.strokeStyle = `hsla(${particle.hue}, 100%, 72%, ${Math.min(0.9, particle.life)})`
      context!.lineWidth = expression === 'smile' ? 1.4 : 2.5
      context!.beginPath()
      context!.moveTo(particle.x, particle.y)
      context!.lineTo(particle.x - particle.vx * trail, particle.y - particle.vy * trail)
      context!.stroke()
      return true
    })
    frame = requestAnimationFrame(draw)
  }

  frame = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(frame)
    context.clearRect(0, 0, canvas.width, canvas.height)
  }
}
