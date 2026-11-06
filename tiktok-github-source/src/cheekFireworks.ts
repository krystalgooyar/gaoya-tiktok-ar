const burstDuration = 1.55
const burstOffsets = [0, 0.64, 1.24, 1.86]
const sparks = Array.from({ length: 32 }, (_, index) => ({
  angle: index * Math.PI * (3 - Math.sqrt(5)),
  speed: 0.48 + ((index * 37) % 29) / 29 * 0.74,
  color: index % 4 === 0 ? '#fff5df' : index % 3 === 0 ? '#ffab56' : '#ffd278',
  lifetime: 1.05 + ((index * 13) % 17) / 17 * 0.5,
}))

export function drawCheekFireworks(
  ctx: CanvasRenderingContext2D,
  cheeks: { x: number; y: number }[],
  size: number,
  elapsed: number,
) {
  if (elapsed < 0 || elapsed > burstOffsets[3] + burstDuration) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'

  for (const [index, offset] of burstOffsets.entries()) {
    const age = elapsed - offset
    if (age < 0 || age >= burstDuration) continue
    const cheek = cheeks[index % 2]
    const spread = size * (index < 2 ? 1 : 0.72)
    const originY = cheek.y - (index < 2 ? 0 : spread * 0.3)

    for (const [sparkIndex, spark] of sparks.entries()) {
      const opacity = 1 - age / spark.lifetime
      if (opacity <= 0) continue
      const angle = spark.angle + index * 0.9
      const dx = Math.cos(angle) * spark.speed * spread
      const dy = Math.sin(angle) * spark.speed * spread
      const expansion = 1 - Math.exp(-3.1 * age)
      const trailAge = Math.max(0, age - 0.13)
      const trailExpansion = 1 - Math.exp(-3.1 * trailAge)
      const gravity = spread * 0.57
      const x = cheek.x + dx * expansion
      const y = originY + dy * expansion + gravity * age * age
      const twinkle = 0.72 + 0.28 * Math.sin(age * 37 + sparkIndex)
      ctx.globalAlpha = opacity * opacity * twinkle
      ctx.strokeStyle = spark.color
      ctx.lineWidth = Math.max(0.8, spread * 0.024)
      ctx.beginPath()
      ctx.moveTo(cheek.x + dx * trailExpansion, originY + dy * trailExpansion + gravity * trailAge * trailAge)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.fillStyle = '#fff5df'
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.7, spread * 0.017), 0, Math.PI * 2)
      ctx.fill()
    }

    if (age < 0.18) {
      ctx.globalAlpha = (1 - age / 0.18) * 0.65
      const glow = ctx.createRadialGradient(cheek.x, originY, 0, cheek.x, originY, spread * 0.6)
      glow.addColorStop(0, '#fff7d6')
      glow.addColorStop(0.35, '#ffbf60')
      glow.addColorStop(1, '#ffbf6000')
      ctx.fillStyle = glow
      ctx.fillRect(cheek.x - spread, originY - spread, spread * 2, spread * 2)
    }
  }
  ctx.restore()
}
