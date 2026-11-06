import { buildFaceHull, bounceOffHull } from './head-collision.js';

const options = new URLSearchParams(location.search);
const debugCollision = options.getAll('debug').includes('collision');
const debugExpression = options.getAll('debug').includes('expression');
const forceEllipse = options.get('collider') === 'ellipse';
const contacts = debugCollision ? Array.from({ length: 48 }, () => ({ until: 0 })) : [];
let contactIndex = 0;
let ovalIndices = [];

function recordContact(x, y, nx, ny) {
  const point = contacts[contactIndex];
  point.x = x;
  point.y = y;
  point.nx = nx;
  point.ny = ny;
  point.until = performance.now() + 450;
  contactIndex = (contactIndex + 1) % contacts.length;
}
const referenceLook = options.get('look') === 'reference';
let nextImpact = 0;
let motionSample, shakeDirection = 0, shakeAt = 0, nextShake = 0;
let pitchBaseline, charge = 0, nextLookUp = 0, lookUpLatched = false;
function showImpact(x, y, nx, ny) {
  if (debugCollision) recordContact(x, y, nx, ny);
  const now = performance.now();
  if (now < nextImpact) return;
  nextImpact = now + 105;
  const flash = spawn(x, y, 0, 0, .28, 'flash', 1, 76);
  if (flash) {
    flash.nx = nx;
    flash.ny = ny;
  }
  for (const side of [-1, 1]) {
    const spark = spawn(x, y, 0, 0, .42, 'rim-spark', 1, 8);
    if (spark) {
      spark.nx = nx;
      spark.ny = ny;
      spark.side = side;
      spark.color = side < 0 ? fireworkColors.pink : fireworkColors.gold;
    }
  }
}
const onContact = referenceLook ? showImpact : debugCollision ? recordContact : undefined;

const $ = id => document.getElementById(id);
const stage = $('stage'), video = $('camera'), canvas = $('effects'), hint = $('hint');
const toggle = $('toggle');
const performancePanel = $('performance-debug');
const debugPerformance = options.getAll('debug').includes('performance');
performancePanel.hidden = !debugPerformance;
const idlePerformance = performancePanel.textContent;
let startRendering, stopRendering;
let cameraAttempt = 0;

function parameter(name, fallback, maximum = 1) {
  const raw = options.get(name);
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback;
}

const expression = {
  smileEnter: parameter('smileEnter', .32),
  smileExit: parameter('smileExit', .26),
  laughSmileEnter: parameter('laughSmileEnter', .34),
  laughSmileExit: parameter('laughSmileExit', .24),
  jawEnter: parameter('jawEnter', .23),
  jawExit: parameter('jawExit', .16),
  lipEnter: parameter('lipEnter', .25),
  lipExit: parameter('lipExit', .18),
};
const rand = (a,b) => a + Math.random() * (b-a);
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
let width, height, stream, tracker, face, lastVideo = -1, lastTrack = 0;
const expressionHoldMs = parameter('holdMs', 105, 3000);
const laughHoldMs = parameter('laughHoldMs', 230, 3000);
const laughReleaseMs = 500;
let lastLaughAt = 0;
const smileHoldMs = parameter('smileHoldMs', 48, 3000);
const switchCooldownMs = parameter('cooldownMs', 250, 3000);
let mood = 'neutral', candidate = mood, since = 0, smile = 0, jaw = 0;
let mouthSample, mouthDirection = 0, lastMouthTurn = -Infinity, speechUntil = 0;
let moodSince = 0, cooldownUntil = 0, opening = 0;
const rainLayers = [
  { weight: .34, speed: 270, length: .067, opacity: .32, width: 1.35, tint: .48 },
  { weight: .39, speed: 410, length: .13, opacity: .60, width: 2.6, tint: .68 },
  { speed: 580, length: .24, opacity: .88, width: 4.4, tint: .92 },
];
const wetMarks = [];
const wetMarkLimit = 12;
const wetTrailSteps = 20;
let nextWetMark = 0;
const waterHighlight = { color: [.62, .82, 1], tint: .6 };

// Landmark-centered relief: horizontal and vertical reach in face radii.
const runoffFeatures = [
  [105, .30, .17, .08], [334, .30, .17, .08], // brow ridges
  [159, .29, .19, .10], [386, .29, .19, .10], // eye area
  [1, .32, .25, .15],                         // nose
  [50, .36, .24, .10], [280, .36, .24, .10],   // cheekbones
  [61, .23, .17, .07], [291, .23, .17, .07],   // mouth corners
];

function runoffOffset(u, v, features) {
  let offset = 0;
  for (const feature of features) {
    const dx = (u - feature.u) / feature.reachX;
    const dy = (v - feature.v) / feature.reachY;
    const influence = 1 - dx * dx - dy * dy;
    if (influence > 0) offset += feature.strength * Math.tanh(dx * 3) * influence ** 2;
  }
  return clamp(offset, -.16, .16);
}

function leaveWetMark(x, y, nx, ny, drop) {
  const now = performance.now();
  if (now < nextWetMark || wetMarks.length >= wetMarkLimit) return;
  nextWetMark = now + 220;
  const u = (x - face.x) / face.rx;
  wetMarks.push({
    u, v: (y - face.y) / face.ry,
    color: drop.color, tint: drop.layer.tint, layer: drop.layer,
    bend: rand(.008, .022) * (Math.random() < .5 ? -1 : 1),
    phase: rand(0, Math.PI * 2), trailLength: rand(.30, .78),
    flow: rand(.8, 1.25), age: 0,
  });
}
let nextBurst = 0, rainCarry = 0, rainStrength = 0;
let particles = [], bursts = [];
const limit = 3600, tail = 24, rocketLimit = 24;

const expressionPanel = debugExpression ? $('expression-debug') : null;
const expressionLabels = { neutral: 'NEUTRAL', rain: 'SMILE', fire: 'LAUGH', speech: '疑似说话' };
const expressionFields = expressionPanel ? Object.fromEntries([
  'smile-meter', 'smile-score', 'jaw-meter', 'jaw-score', 'lip-opening',
  'expression-raw', 'expression-gates', 'expression-state', 'expression-duration', 'expression-candidate', 'expression-cooldown',
].map(id => [id, $(id)])) : null;
if (expressionPanel) expressionPanel.hidden = false;

function updateExpressionDebug(now, raw, gates) {
  if (!expressionFields) return;
  const set = (id, value) => { expressionFields[id].textContent = value; };
  expressionFields['smile-meter'].value = smile;
  expressionFields['jaw-meter'].value = jaw;
  set('expression-raw', raw ? raw.map(value => value.toFixed(2)).join(' / ') : '—');
  set('expression-gates', gates ? gates.map(value => value ? '✓' : '–').join(' / ') : '—');
  set('smile-score', face ? smile.toFixed(2) : '—');
  set('jaw-score', face ? jaw.toFixed(2) : '—');
  set('lip-opening', face ? opening.toFixed(2) : '—');
  set('expression-state', face ? expressionLabels[mood] : stream ? '寻找人脸' : '等待相机');
  set('expression-duration', face ? ((now - moodSince) / 1000).toFixed(2) + ' s' : '—');
  set('expression-candidate', face && candidate !== mood
    ? expressionLabels[candidate] + ' · ' + Math.round(now - since) + ' ms' : '—');
  set('expression-cooldown', face ? Math.max(0, Math.ceil(cooldownUntil - now)) + ' ms' : '—');
}

function resetExpression() {
  face = null;
  motionSample = pitchBaseline = undefined;
  shakeDirection = shakeAt = nextShake = charge = nextLookUp = 0;
  lookUpLatched = false;
  mood = candidate = 'neutral';
  smile = jaw = opening = 0;
  mouthSample = undefined;
  mouthDirection = speechUntil = 0;
  lastMouthTurn = -Infinity;
  since = moodSince = cooldownUntil = 0;
  lastLaughAt = 0;
}

function stop() {
  cameraAttempt++;
  stopRendering?.();
  const activeTracker = tracker;
  tracker = null;
  const current = stream;
  stream = null;
  current?.getTracks().forEach(track => track.stop());
  video.pause();
  video.srcObject = null;
  try { activeTracker?.close(); }
  catch (error) { console.error('Unable to close face tracker', error); }
  if (debugPerformance) performancePanel.textContent = idlePerformance;
  video.hidden = true;
  stage.classList.remove('live');
  resetExpression();
  lastVideo = -1;
  updateExpressionDebug(performance.now());
  toggle.textContent = '开启相机';
  hint.textContent = '';
  particles.length = bursts.length = wetMarks.length = 0;
  nextWetMark = 0;
  for (const point of contacts) point.until = 0;
  nextBurst = rainCarry = rainStrength = nextImpact = 0;
}
window.addEventListener('pagehide', stop);
toggle.onclick = async () => {
  if (stream) return stop();
  toggle.disabled = true;
  toggle.textContent = '正在开启…';
  hint.textContent = '';
  const attempt = ++cameraAttempt;
  let step = 'camera';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('secure-context');
    const active = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:{ideal:1280}, height:{ideal:720} }, audio:false
    });
    if (attempt !== cameraAttempt) {
      active.getTracks().forEach(track => track.stop());
      return;
    }
    stream = active;
    for (const track of active.getTracks()) track.onended = () => {
      if (stream === active) { stop(); hint.textContent = '相机已断开，可以重新开启。'; }
    };
    video.srcObject = active;
    await video.play();
    if (attempt !== cameraAttempt) return;
    video.hidden = false;
    stage.classList.add('live');
    step = 'tracker';
    toggle.textContent = '正在加载…';
    const [{ FaceLandmarker }, { createTracker }] = await Promise.all([
      import('@mediapipe/tasks-vision'), import('../src/faceTracking.ts'),
    ]);
    if (attempt !== cameraAttempt) return;
    const loadedTracker = await createTracker(true, referenceLook);
    if (attempt !== cameraAttempt) {
      loadedTracker.close();
      return;
    }
    tracker = loadedTracker;
    ovalIndices = [...new Set((FaceLandmarker.FACE_LANDMARKS_FACE_OVAL ?? [])
      .flatMap(({ start, end }) => [start, end]))];
    startRendering();
    toggle.textContent = '关闭相机';
  } catch (error) {
    if (attempt !== cameraAttempt) return;
    console.error(error);
    stop();
    hint.textContent = step === 'tracker' ? '本地表情模型或 WASM 加载失败。请通过项目服务器打开，并检查模型和构建资源是否完整。'
      : error.name === 'NotAllowedError' ? '请在浏览器中允许相机权限后重试。'
      : error.message === 'secure-context' ? '请通过 HTTPS 或 localhost 打开。'
      : '无法开启相机，请检查连接或关闭占用相机的应用。';
  } finally { toggle.disabled = false; }
};

function updateHeadGestures(now, matrix) {
  if (matrix?.length !== 16) return;
  // Detect matrix layout from the depth translation; +Z is the face's forward axis.
  const columnMajor = Math.abs(matrix[14]) > Math.abs(matrix[11]);
  const forwardX = matrix[columnMajor ? 8 : 2];
  const forwardY = matrix[columnMajor ? 9 : 6];
  const forwardZ = matrix[10];
  const pitch = Math.atan2(forwardY, Math.hypot(forwardX, forwardZ));
  const yaw = -Math.atan2(forwardX, forwardZ); // Mirror to match the preview.
  if (!Number.isFinite(pitch) || !Number.isFinite(yaw)) return;

  const previous = motionSample;
  motionSample = { x: face.x, yaw, now };
  if (pitchBaseline === undefined) pitchBaseline = pitch;
  const lift = pitch - pitchBaseline;
  if (!lookUpLatched && Math.abs(lift) < .14) pitchBaseline += lift * .025;
  if (lift < .10) lookUpLatched = false;

  if (previous && now - previous.now <= 180) {
    const seconds = Math.max(.025, (now - previous.now) / 1000);
    const speed = ((face.x - previous.x) / Math.max(32, face.rx) + (yaw - previous.yaw) * .9) / seconds;
    if (Math.abs(speed) > 1.25) {
      const direction = Math.sign(speed);
      if (shakeDirection && direction !== shakeDirection && now - shakeAt < 340 && now >= nextShake) {
        for (const p of particles) {
          if (p.kind !== 'fire') continue;
          const dx = (p.x - face.x) / face.rx;
          const dy = (p.y - face.y) / face.ry;
          const distance = Math.hypot(dx, dy);
          if (distance > 2.25) continue;
          const impulse = clamp(Math.abs(speed) * 66, 95, 310) * (1 - distance / 2.8);
          p.vx += (Math.sign(dx || -direction) * .8 - direction * .45) * impulse;
          p.vy += (dy * .3 - .24) * impulse;
          p.aimHeight = undefined;
          p.tint = 1;
        }
        nextShake = now + 330;
      }
      shakeDirection = direction;
      shakeAt = now;
    }
  }

  if (lift > .19 && !lookUpLatched && charge >= .36 && now >= nextLookUp) {
    lookUpLatched = true;
    nextLookUp = now + 900;
    const x = face.x;
    const y = Math.max(6, (face.hull?.minY ?? face.y - face.ry) - 14);
    const strength = charge;
    charge = 0;
    spawn(x, y, 0, 0, .24, 'flash', 1, 75);
    for (let i = 0; i < 32; i++) {
      const angle = rand(-.92, .92) + clamp(yaw * .4, -.25, .25);
      const speed = rand(165, 390) * (.72 + strength * .5 + Math.min(.25, lift));
      const spark = spawn(x, y, Math.sin(angle) * speed, -Math.cos(angle) * speed,
        rand(.65, 1.45), 'fire', .95, rand(2.8, 4.6));
      if (spark) {
        spark.color = i % 2 ? fireworkColors.gold : fireworkColors.violet;
        spark.drag = .58;
        spark.gravity = .65;
      }
    }
  }
}

function track(now) {
  if (!stream || !tracker || video.readyState < 2 || now-lastTrack < 48 || video.currentTime === lastVideo) return;
  lastTrack = now; lastVideo = video.currentTime;
  const result = tracker.detectForVideo(video, now);
  const marks = result.faceLandmarks[0];
  if (!marks) {
    resetExpression();
    updateExpressionDebug(now);
    return;
  }
  // Same centered contain transform and mirror as the video element.
  const fit = Math.min(width/video.videoWidth, height/video.videoHeight);
  const vw = video.videoWidth*fit, vh = video.videoHeight*fit;
  const map = i => [(width-vw)/2 + (1-marks[i]?.x)*vw, (height-vh)/2 + marks[i]?.y*vh];
  const left = map(234), right = map(454), top = map(10), chin = map(152);
  if (![...left, ...right, ...top, ...chin].every(Number.isFinite)) {
    resetExpression();
    updateExpressionDebug(now);
    return;
  }
  const rx = Math.max(15, Math.hypot(left[0]-right[0],left[1]-right[1])*.57);
  const ry = Math.max(20, Math.hypot(top[0]-chin[0],top[1]-chin[1])*.65);
  face = {x:(top[0]+chin[0])/2, y:(top[1]+chin[1])/2-ry*.14, rx, ry};
  face.hull = forceEllipse ? null : buildFaceHull(ovalIndices.map(map));
  if (mood === 'rain' || wetMarks.length) {
    face.runoff = [];
    for (const [index, reachX, reachY, strength] of runoffFeatures) {
      const [x, y] = map(index);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        face.runoff.push({ u: (x - face.x) / rx, v: (y - face.y) / ry, reachX, reachY, strength });
      }
    }
  }
  const scores = Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(c => [c.categoryName,c.score]));
  const rawLeft = scores.mouthSmileLeft || 0;
  const rawRight = scores.mouthSmileRight || 0;
  const rawJaw = scores.jawOpen || 0;
  // Mouth geometry backs up the jaw score when an open smile lowers that score.
  const upperLip = map(13), lowerLip = map(14);
  const leftCorner = map(61), rightCorner = map(291);
  const mouthWidth = Math.hypot(leftCorner[0] - rightCorner[0], leftCorner[1] - rightCorner[1]);
  const lipGap = Math.hypot(upperLip[0] - lowerLip[0], upperLip[1] - lowerLip[1]);
  opening = lipGap / Math.max(1, mouthWidth);
  updateExpression(now, rawLeft, rawRight, rawJaw, Math.max(scores.mouthFunnel || 0, scores.mouthPucker || 0));
  if (referenceLook) updateHeadGestures(now, result.facialTransformationMatrixes?.[0]?.data);
}

function updateExpression(now, rawLeft, rawRight, rawJaw, roundedLips) {
  smile += ((rawLeft + rawRight) / 2 - smile) * .43;
  jaw += (rawJaw - jaw) * .43;
  // Look for repeated opening and closing, with lip rounding as supporting evidence.
  const mouth = Math.max(rawJaw, opening * .8);
  const change = mouth - (mouthSample ?? mouth);
  mouthSample = mouth;
  if (Math.abs(change) >= .065) {
    const direction = Math.sign(change);
    if (mouthDirection && direction !== mouthDirection) {
      if (now - lastMouthTurn <= 400 || roundedLips >= .27) speechUntil = now + 360;
      lastMouthTurn = now;
    }
    mouthDirection = direction;
  }
  const holdingFire = mood === 'fire';
  const openMouth = jaw > (holdingFire ? expression.jawExit : expression.jawEnter) ||
    opening > (holdingFire ? expression.lipExit : expression.lipEnter);
  const bilateralSmile = Math.min(rawLeft, rawRight);
  const laughSmile = smile > (holdingFire ? expression.laughSmileExit : expression.laughSmileEnter)
    && bilateralSmile >= (holdingFire ? .12 : .21);
  const speech = now < speechUntil;
  const laughing = openMouth && laughSmile && (!speech || (smile >= .50 && bilateralSmile >= .34));
  if (laughing) lastLaughAt = now;
  const smiling = smile > (mood === 'rain' ? expression.smileExit : expression.smileEnter);
  const next = laughing ? 'fire' : speech ? 'speech' : smiling ? 'rain' : 'neutral';
  if (!moodSince) moodSince = now;
  if (next !== candidate) { candidate = next; since = now; }
  const holdMs = candidate === 'fire' ? laughHoldMs
    : candidate === 'rain' && mood === 'neutral' ? smileHoldMs : expressionHoldMs;
  const ready = holdingFire ? now - lastLaughAt >= laughReleaseMs : now - since >= holdMs;
  if (mood !== candidate && ready && now >= cooldownUntil) {
    mood = candidate;
    moodSince = now;
    cooldownUntil = now + switchCooldownMs;
    if (mood === 'fire') {
      nextBurst = 0;
    }
  }
  if (debugExpression) updateExpressionDebug(now, [rawLeft, rawRight, rawJaw], [openMouth, laughSmile, speech]);
}

function spawn(x,y,vx,vy,life,kind,tint,size) {
  if (particles.length >= limit) return;
  const history = kind === 'fire' || kind === 'splash'
    ? new Float32Array(tail*2).map((_,i)=>i%2?y:x) : null;
  const particle = {x,y,vx,vy,life,max:life,kind,tint,size,history,cursor:0};
  particles.push(particle);
  return particle;
}
const fireworkStyles = {
  crown: { rays: 112, speed: .92, drag: .85, gravity: .16, life: 3.15 },
  willow: { rays: 58, speed: .78, drag: .72, gravity: .29, life: 3.55 },
  peony: { rays: 76, speed: .63, drag: 1.05, gravity: .12, life: 2.45 },
};

const fireworkColors = {
  cyan: [.12, .76, 1],
  pink: [1, .16, .48],
  violet: [.55, .29, 1],
  gold: [1, .72, .14],
};
const rainColors = referenceLook
  ? [[.22, .46, .92], [.25, .62, 1], [.54, .8, 1]]
  : [[.2, .66, 1], [.56, .39, 1], [.46, .92, 1]];
const referenceFireColors = ['violet', 'gold', 'pink', 'violet', 'gold', 'cyan'];

function burst(x, y, scale, style, color) {
  const profile = fireworkStyles[style];
  const speed = Math.min(width, height) * profile.speed * scale;
  const spin = rand(0, 2 * Math.PI);
  for (let i = 0; i < profile.rays; i++) {
    const angle = spin + i * 2.39996;
    const depth = 1 - 2 * i / (profile.rays - 1);
    const projection = Math.sqrt(1 - depth * depth);
    const innerRing = style === 'crown' && i % 6 === 0;
    const velocity = speed * projection * rand(.83, 1.12) * (innerRing ? .55 : 1);
    const life = profile.life * rand(.73, 1.13) * (innerRing ? .8 : 1);
    const tint = innerRing ? rand(.02, .35) : rand(.36, 1);
    const ray = spawn(x, y, Math.cos(angle) * velocity, Math.sin(angle) * velocity, life,
      'fire', tint, rand(2.3, 4.2));
    if (!ray) break;
    ray.color = innerRing ? fireworkColors.cyan : color;
    ray.drag = profile.drag;
    ray.gravity = profile.gravity;
  }
  spawn(x, y, 0, 0, .22, 'flash', 1, clamp(Math.min(width, height) * .23, 48, 150));
  const aimedCount = referenceLook && face ? 3 : 0;
  for (let i = 0; i < aimedCount; i++) {
    const aimHeight = (i - 1) * .48;
    const dx = face.x - x, dy = face.y + face.ry * aimHeight - y;
    const travel = .32 + i * .12;
    const comet = spawn(x, y, dx / travel, dy / travel, 1.3, 'fire', .95, 5.5);
    if (!comet) break;
    comet.aimHeight = aimHeight;
    comet.drag = .12;
    comet.gravity = .22;
    comet.color = i === 1 ? fireworkColors.gold : color;
  }
  for (let i = 0; i < 18 - aimedCount; i++) {
    const angle = rand(0, 2 * Math.PI);
    const velocity = speed * rand(.08, .62);
    const ember = spawn(x, y, Math.cos(angle) * velocity, Math.sin(angle) * velocity,
      rand(.55, 1.35), 'fire', rand(.7, 1), rand(1, 3));
    if (ember) ember.color = color;
  }
}

function safeBurstTarget(x, y, side) {
  if (!face) return { x, y };
  const margin = Math.max(14, face.rx * .28);
  const left = (face.hull?.minX ?? face.x - face.rx) - margin;
  const right = (face.hull?.maxX ?? face.x + face.rx) + margin;
  const top = (face.hull?.minY ?? face.y - face.ry) - Math.max(margin, face.ry * .28);
  const bottom = (face.hull?.maxY ?? face.y + face.ry) + margin;
  if (x <= left || x >= right || y <= top || y >= bottom) return { x, y };

  const insetX = width * .07, insetY = height * .07;
  const preferredX = side < 0 ? left - 1 : right + 1;
  const oppositeX = side < 0 ? right + 1 : left - 1;
  for (const flank of [preferredX, oppositeX]) {
    if (flank >= insetX && flank <= width - insetX) return { x: flank, y };
  }
  if (top >= insetY) return { x, y: top - 1 };
  if (bottom <= height - insetY) return { x, y: bottom + 1 };
  return null;
}

function volley(now) {
  const mirror = Math.random() < .5 ? -1 : 1;
  const sites = [
    [-1, .24, .24, 1.12, 'crown', 0, 'cyan'],
    [1, .76, .22, .94, 'willow', 130, 'violet'],
    [-1, .18, .48, .83, 'peony', 340, 'pink'],
    [1, .82, .45, .89, 'peony', 490, 'gold'],
    [1, .56, .30, 1.05, 'crown', 700, 'violet'],
    [-1, .43, .19, .73, 'peony', 880, 'cyan'],
  ];
  for (const [index, [side, x, y, scale, style, delay, color]] of sites.entries()) {
    const launchX = face
      ? (side * mirror < 0 ? face.hull?.minX ?? face.x - face.rx : face.hull?.maxX ?? face.x + face.rx)
        + side * mirror * Math.max(12, face.rx * .24)
      : width * (.5 + side * mirror * .28);
    const launchY = face ? clamp((face.y + face.ry * .58) / height, .52, .94) : .89;
    if (bursts.length >= rocketLimit) break;
    bursts.push({
      start: now + delay,
      side: side * mirror,
      travel: rand(290, 495),
      fromX: clamp(launchX / width, .025, .975),
      fromY: launchY,
      x: (mirror < 0 ? 1 - x : x) + rand(-.035, .035),
      y: y + rand(-.025, .025),
      scale,
      style,
      color: fireworkColors[referenceLook ? referenceFireColors[index] : color],
      tint: .72,
    });
  }
}

function bounce(p,h,ox,oy,contact) {
  const dx=(p.x-h.x)/h.rx,dy=(p.y-h.y)/h.ry;
  const ax=(ox-h.x)/h.rx,ay=(oy-h.y)/h.ry;
  const ux=dx-ax,uy=dy-ay, a=ux*ux+uy*uy,b=ax*ux+ay*uy,c=ax*ax+ay*ay-1;
  const disc=b*b-a*c;
  const t=a>0 && disc>=0 ? (-b-Math.sqrt(disc))/a : -1;
  const entry=t>=0 && t<=1;
  if (!entry && dx*dx+dy*dy>=1) return;
  let nx=entry?ax+t*ux:dx, ny=entry?ay+t*uy:dy;
  const len=Math.hypot(nx,ny);
  if(len<.0001){nx=0;ny=-1;}else{nx/=len;ny/=len;}
  p.x=h.x+nx*(h.rx+1);p.y=h.y+ny*(h.ry+1);
  const surfaceX = nx, surfaceY = ny;
  const normal=Math.hypot(nx/h.rx,ny/h.ry);
  nx/=h.rx*normal; ny/=h.ry*normal;
  const dot=p.vx*nx+p.vy*ny;
  if(dot<0){
    p.vx-=1.68*dot*nx;p.vy-=1.68*dot*ny;
    p.tint=Math.min(1,p.tint+.35);
    contact?.(h.x + surfaceX * h.rx, h.y + surfaceY * h.ry, nx, ny, p);
    return true;
  }
}

async function init() {
  const T = await import('three');
  const renderer = new T.WebGLRenderer({canvas,alpha:true,antialias:true});
  const scene = new T.Scene(), camera = new T.OrthographicCamera(0,1,0,1,.1,10);
  camera.position.z = 1;
  const density = Math.min(devicePixelRatio,2);
  renderer.setPixelRatio(density);
  const resize = () => {
    const fit = video.videoWidth
      ? Math.min(stage.clientWidth / video.videoWidth, stage.clientHeight / video.videoHeight)
      : 0;
    width = fit ? video.videoWidth * fit : stage.clientWidth;
    height = fit ? video.videoHeight * fit : stage.clientHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    face = null;
    lastVideo = -1;
    camera.right=width;camera.bottom=height;camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
  };
  new ResizeObserver(resize).observe(stage);
  video.addEventListener('resize', resize);
  resize();
  toggle.disabled = false;
  function batch(count, points, debug = false, triangles = false) {
    const geometry = new T.BufferGeometry();
    for(const [name,size] of [['position',3],['ink',4],['size',1]]) {
      geometry.setAttribute(name,new T.BufferAttribute(new Float32Array(count*size),size).setUsage(T.DynamicDrawUsage));
    }
    const material = new T.ShaderMaterial({
      transparent:true,depthTest:false,depthWrite:false,side:triangles ? T.DoubleSide : T.FrontSide,forceSinglePass:triangles,blending:debug ? T.NormalBlending : T.AdditiveBlending,
      vertexShader:`attribute vec4 ink; attribute float size; varying vec4 vInk;
        void main(){ vInk=ink; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=size*${density.toFixed(3)}; }`,
      fragmentShader:`varying vec4 vInk; void main(){
        float alpha=vInk.a;
        ${points ? 'float r=length(gl_PointCoord-.5)*2.; alpha*=pow(max(0.,1.-r),2.);' : ''}
        gl_FragColor=vec4(vInk.rgb,alpha); }`
    });
    const item = triangles ? new T.Mesh(geometry, material)
      : points ? new T.Points(geometry, material) : new T.LineSegments(geometry, material);
    item.frustumCulled=false;
    if (debug) item.renderOrder = 1;
    scene.add(item);
    let index=0;
    return {
      add(x,y,p,a,s=0){
        if(index>=count)return;
        geometry.attributes.position.setXYZ(index,x,y,0);
        if (debug) {
          geometry.attributes.ink.setXYZW(index,p[0],p[1],p[2],a);
        } else if (p.kind === 'flash') {
          geometry.attributes.ink.setXYZW(index,1,.97,.9,a);
        } else if (p.color) {
          const [r, g, b] = p.color;
          const white = p.tint * .42;
          geometry.attributes.ink.setXYZW(index,
            r + (1 - r) * white, g + (1 - g) * white, b + (1 - b) * white, a);
        } else if (p.kind === 'fire') {
          geometry.attributes.ink.setXYZW(index,.18+p.tint*.69,.48+p.tint*.49,1,a);
        } else {
          // Cyan highlights on a saturated blue base stay visible over live video.
          geometry.attributes.ink.setXYZW(index,.48+p.tint*.43,.68+p.tint*.28,1,a);
        }
        geometry.attributes.size.setX(index++,s);
      },
      flush(){
        geometry.setDrawRange(0,index);
        for(const attribute of Object.values(geometry.attributes)){
          attribute.clearUpdateRanges();
          if(index){attribute.addUpdateRange(0,index*attribute.itemSize);attribute.needsUpdate=true;}
        }
        index=0;
      }
    };
  }
  const lines=batch(limit * (tail - 1 + 12 + 4) * 2 + rocketLimit * 2, false),
    dots = batch(limit * 3 + rocketLimit + 9, true);
  const rainRibbons = batch(limit * 3 + wetMarkLimit * wetTrailSteps * 6, false, false, true);
  const waterBeads = batch(limit * 2 + wetMarkLimit * 3, true);

  function taperedWater(x, y, endX, endY, width, color, alpha) {
    const dx = endX - x, dy = endY - y;
    const scale = width / Math.max(.01, Math.hypot(dx, dy));
    rainRibbons.add(x, y, color, 0);
    rainRibbons.add(endX - dy * scale, endY + dx * scale, color, alpha);
    rainRibbons.add(endX + dy * scale, endY - dx * scale, color, alpha);
  }

  function drawWaterBead(x, y, drop, alpha) {
    waterBeads.add(x, y, drop, alpha, drop.layer.width * 2.8);
    waterBeads.add(x, y, waterHighlight, alpha * .72, drop.layer.width * 1.45);
  }

  function drawWetMarks(dt) {
    if (!face) {
      wetMarks.length = 0;
      return;
    }
    let kept = 0;
    for (const mark of wetMarks) {
      mark.age += dt;
      const fade = clamp((mark.flow + .92 - mark.age) / .92, 0, 1);
      if (!fade) continue;
      wetMarks[kept++] = mark;
      const travel = clamp(mark.age / mark.flow, 0, 1) ** 1.35;
      // Outer drops leave the cheek sooner, while inner drops reach the jaw.
      const endV = Math.max(mark.v + .08, .76 * Math.sqrt(1 - Math.min(.98, Math.abs(mark.u)) ** 2));
      // The older end recedes as the bead advances, leaving trails of different lengths.
      const tailStart = Math.max(0, travel - mark.trailLength);
      const features = face.runoff ?? [];
      const startOffset = runoffOffset(mark.u, mark.v, features);
      let x, y;
      let halfWidth = 0, alpha = 0;
      for (let step = 0; step <= wetTrailSteps; step++) {
        const along = step / wetTrailSteps;
        const t = tailStart + (travel - tailStart) * along;
        const bend = mark.bend * Math.sin(t * Math.PI * 1.7)
          + .024 * Math.sin(t * Math.PI) * Math.sin(t * 10 + mark.phase);
        const v = mark.v + (endV - mark.v) * t;
        const relief = runoffOffset(mark.u, v, features) - startOffset * Math.max(0, 1 - t * 8);
        const nextX = face.x + (mark.u + bend + relief) * face.rx;
        const nextY = face.y + v * face.ry;
        const taper = Math.sin(along * Math.PI * .5);
        const swell = .5 + .5 * Math.sin(t * 21 + mark.phase);
        const nextWidth = mark.layer.width * taper * (.23 + .32 * swell);
        const nextAlpha = mark.layer.opacity * fade * Math.min(1, along * 5)
          * (.56 + .28 * swell);
        if (step === 0) {
          x = nextX;
          y = nextY;
          continue;
        }
        rainRibbons.add(x - halfWidth, y, mark, alpha);
        rainRibbons.add(x + halfWidth, y, mark, alpha * .36);
        rainRibbons.add(nextX - nextWidth, nextY, mark, nextAlpha);
        rainRibbons.add(x + halfWidth, y, mark, alpha * .36);
        rainRibbons.add(nextX + nextWidth, nextY, mark, nextAlpha * .36);
        rainRibbons.add(nextX - nextWidth, nextY, mark, nextAlpha);
        halfWidth = nextWidth;
        alpha = nextAlpha;
        x = nextX;
        y = nextY;
      }
      if (travel < 1) {
        drawWaterBead(x, y, mark, mark.layer.opacity * fade);
      } else {
        if (mark.age - dt < mark.flow) {
          mark.releaseX = x;
          mark.releaseY = y;
        }
        const fall = mark.age - mark.flow;
        if (mark.releaseX !== undefined) {
          const dropX = mark.releaseX;
          const dropY = mark.releaseY + fall * (65 + 270 * fall);
          drawWaterBead(dropX, dropY, mark, mark.layer.opacity * fade);
        }
      }
    }
    wetMarks.length = kept;
  }

  const debugLines = debugCollision ? batch(2 * (48 + contacts.length * 3), false, true) : null;
  const hullColor = [.1, 1, .5], ellipseColor = [1, .63, .1], hitColor = [1, .12, .12];
  function drawCollisionDebug(now) {
    function segment(x, y, endX, endY, color, alpha = 1) {
      debugLines.add(x, y, color, alpha);
      debugLines.add(endX, endY, color, alpha);
    }
    if (face?.hull) {
      for (const edge of face.hull.edges) {
        segment(edge.x, edge.y, edge.endX, edge.endY, hullColor);
      }
    } else if (face) {
      for (let i = 0; i < 48; i++) {
        const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24;
        segment(face.x + Math.cos(a) * face.rx, face.y + Math.sin(a) * face.ry,
          face.x + Math.cos(b) * face.rx, face.y + Math.sin(b) * face.ry, ellipseColor);
      }
    }
    for (const { x, y, nx, ny, until } of contacts) {
      if (until <= now) continue;
      const alpha = Math.min(1, (until - now) / 180);
      segment(x - 4, y, x + 4, y, hitColor, alpha);
      segment(x, y - 4, x, y + 4, hitColor, alpha);
      segment(x, y, x + nx * 16, y + ny * 16, hitColor, alpha);
    }
    debugLines.flush();
  }
  const whiteSpark = { color: [1, .98, .94], tint: 1 };
  let previous=performance.now();
  let sampleStart = previous, frameCount = 0;
  function renderFrame(now) {
    const dt=clamp((now-previous)/1000,0,.035);
    previous=now;
    try { track(now); }
    catch (error) {
      console.error(error); stop();
      hint.textContent='表情识别中断，请重新开启相机。';
      return;
    }
    const mode=stream && mood;
    if (referenceLook && face) {
      charge = clamp(charge + dt * (mode === 'fire' ? .94 : -.34), 0, 1);
      const crownY = Math.max(6, (face.hull?.minY ?? face.y - face.ry) - 14);
      for (let i = 0; i < Math.ceil(charge * 9); i++) {
        const angle = now * .004 + i * 2.4;
        const x = face.x + Math.cos(angle) * (12 + i * 3);
        const y = crownY - 5 + Math.sin(angle) * (4 + i * .65);
        dots.add(x, y, whiteSpark, charge * .82, 4 + charge * 5);
      }
    }
    if(mode==='fire' && candidate==='fire' && now>=nextBurst){volley(now);nextBurst=now+2780;}
    if(mode!=='fire') nextBurst=0;
    let queued = 0;
    for (const rocket of bursts) {
      if (now < rocket.start) {
        bursts[queued++] = rocket;
        continue;
      }
      if (!rocket.launched) {
        const target = safeBurstTarget(rocket.x * width, rocket.y * height, rocket.side);
        if (!target) continue;
        rocket.x = target.x / width;
        rocket.y = target.y / height;
        rocket.launched = true;
      }
      const progress = (now - rocket.start) / rocket.travel;
      if (progress >= 1) {
        const x = rocket.x * width, y = rocket.y * height;
        const target = safeBurstTarget(x, y, rocket.side);
        if (target && target.x === x && target.y === y) burst(x, y, rocket.scale, rocket.style, rocket.color);
        continue;
      }
      bursts[queued++] = rocket;
      const rise = 1 - (1 - progress) ** 1.45;
      const tailProgress = Math.max(0, progress - .20);
      const tailRise = 1 - (1 - tailProgress) ** 1.45;
      const dx = rocket.x - rocket.fromX, dy = rocket.y - rocket.fromY;
      const x = (rocket.fromX + dx * progress) * width;
      const y = (rocket.fromY + dy * rise) * height;
      lines.add((rocket.fromX + dx * tailProgress) * width,
        (rocket.fromY + dy * tailRise) * height, rocket, 0);
      lines.add(x, y, rocket, .9);
      dots.add(x, y, rocket, .93, 9);
    }
    bursts.length = queued;
    const rainTarget = mode === 'rain' ? 1 : 0;
    const rainRamp = mode === 'fire' ? .65 : mode === 'rain' ? .38 : 1.1;
    rainStrength += clamp(rainTarget - rainStrength, -dt / rainRamp, dt / rainRamp);
    if (rainStrength > 0 && mode !== 'fire') {
      const emission = mode === 'rain' ? Math.max(.32, rainStrength) : rainStrength;
      rainCarry += dt * clamp(width * .38, 95, 440) * emission;
      while (rainCarry >= 1) {
        rainCarry--;
        const pick = Math.random();
        const [far, middle, near] = rainLayers;
        const layer = pick < far.weight ? far : pick < far.weight + middle.weight ? middle : near;
        const speed = layer.speed * rand(.8, 1.2);
        const length = clamp(height * layer.length * rand(.7, 1.3), 12, 155);
        const drop = spawn(rand(0, width), 0, rand(-15, 8), speed,
          (height + length) / speed, 'rain', layer.tint, length);
        if (drop) {
          drop.layer = layer;
          drop.color = rainColors[layer === far ? 0 : layer === middle ? 1 : 2];
        }
      }
    } else {
      rainCarry = 0;
    }
    let kept=0;
    for(const p of particles){
      p.life-=dt;
      if (p.life <= 0 || (p.kind === 'rain' && rainStrength === 0)) continue;
      particles[kept++]=p;
      if (p.kind === 'flash') {
        const fade = (p.life / p.max) ** 2;
        dots.add(p.x, p.y, p, fade * .85, p.size);
        dots.add(p.x, p.y, p, fade, p.size * .31);
        if (p.nx !== undefined) {
          const radius = 5 + 24 * (1 - p.life / p.max);
          for (let i = 0; i <= 16; i++) {
            const angle = i * Math.PI / 8;
            const tangent = Math.cos(angle) * radius;
            const normal = (1 + Math.sin(angle)) * radius * .32;
            const x = p.x - p.ny * tangent + p.nx * normal;
            const y = p.y + p.nx * tangent + p.ny * normal;
            if (i > 0) lines.add(x, y, whiteSpark, fade);
            if (i < 16) lines.add(x, y, whiteSpark, fade);
          }
        }
        continue;
      }
      if (p.kind === 'rim-spark') {
        const progress = 1 - p.life / p.max;
        const alpha = (1 - progress) * .95;
        // Split the contact into two arcs along the local tangent.
        let lastX, lastY;
        for (let i = 0; i <= 8; i++) {
          const t = progress * i / 8;
          const along = p.side * 68 * t;
          const outward = 3 + 22 * Math.sin(t * Math.PI * .75);
          const x = p.x - p.ny * along + p.nx * outward;
          const y = p.y + p.nx * along + p.ny * outward;
          if (i > 0) {
            lines.add(lastX, lastY, p, alpha * (i - 1) / 8);
            lines.add(x, y, p, alpha * i / 8);
          }
          lastX = x;
          lastY = y;
        }
        dots.add(lastX, lastY, p, alpha, p.size);
        dots.add(lastX, lastY, whiteSpark, alpha, p.size * .45);
        continue;
      }
      if (p.kind === 'ground-splash') {
        p.x += p.vx * dt;
        p.y += p.vy * dt + 320 * dt * dt;
        p.vy += 640 * dt;
        if (p.y >= height - 2 && p.vy > 0) {
          kept--;
          continue;
        }
        const alpha = Math.sqrt(p.life / p.max) * rainStrength;
        const trailTime = Math.min(.046, p.max - p.life);
        const trailX = p.x - p.vx * trailTime;
        const trailY = p.y - p.vy * trailTime + 320 * trailTime ** 2;
        lines.add(trailX, trailY, p, alpha * .12);
        lines.add(p.x, p.y, p, alpha);
        dots.add(p.x, p.y, p, alpha * .35, p.size * 2);
        dots.add(p.x, p.y, p, alpha, p.size);
        continue;
      }
      if (p.kind === 'rain') {
        const oldX = p.x, oldY = p.y;
        const wind = Math.sin(now * .0015 + p.tint * 4) * (5 + p.tint * 11);
        p.x += (p.vx + wind) * dt;
        p.y += p.vy * dt;
        if (face && rainStrength > .08 && bounce(p, face, oldX, oldY, leaveWetMark)) {
          kept--;
          spawn(p.x, p.y, p.vx * .18 + rand(-26, 26), -rand(18, 42),
            rand(.12, .22), 'splash', rand(.65, 1), rand(.8, 1.2));
          continue;
        }
        const floor = height - 2;
        if (p.layer === rainLayers[2] && rainStrength > .15 && oldY < floor && p.y >= floor && Math.random() < .34) {
          const hitX = oldX + (p.x - oldX) * (floor - oldY) / (p.y - oldY);
          if (hitX >= 0 && hitX <= width) {
            for (const side of [-1, 1]) {
              spawn(hitX, floor, side * rand(34, 88), -rand(115, 178),
                .62, 'ground-splash', rand(.78, 1), rand(3.5, 5.5));
            }
          }
        }
        const length = p.size;
        const drift = length * (p.vx + wind) / p.vy;
        const alpha = p.layer.opacity * rainStrength * clamp(p.life * 8, 0, 1);
        taperedWater(p.x - drift, p.y - length, p.x, p.y,
          p.layer.width * .5, p, alpha);
        drawWaterBead(p.x, p.y, p, alpha);
        continue;
      }
      const ox=p.x,oy=p.y;
      if (face && p.aimHeight !== undefined) {
        const dx = face.x - p.x;
        const dy = face.y + face.ry * p.aimHeight - p.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 1) {
          const speed = Math.hypot(p.vx, p.vy);
          const steer = Math.min(1, dt * 5);
          p.vx += (dx / distance * speed - p.vx) * steer;
          p.vy += (dy / distance * speed - p.vy) * steer;
        }
      }
      const drag = Math.exp(-dt * (p.drag ?? 1.15));
      p.vx *= drag;
      p.vy = p.vy * drag + Math.min(width, height) * (p.gravity ?? .14) * dt;
      p.x+=p.vx*dt;p.y+=p.vy*dt;
      if (face && p.kind === 'fire') {
        const hit = face.hull
          ? bounceOffHull(p, face.hull, ox, oy, dt, onContact)
          : bounce(p, face, ox, oy, onContact);
        if (hit && p.aimHeight !== undefined) {
          p.aimHeight = undefined;
          p.drag = .64;
          p.gravity = .72;
        }
      }
      const h=p.history, offset=p.cursor*2;
      h[offset]=p.x;h[offset+1]=p.y;p.cursor=(p.cursor+1)%tail;
      const fade = p.kind === 'fire'
        ? (p.life / p.max) ** .55
        : (p.life / p.max) ** .75 * rainStrength * .52;
      const flicker = .89 + .11 * Math.sin(now * .025 + p.size * 9);
      for(let i=0;i<tail-1;i++){
        const start=((p.cursor+tail-1-i)%tail)*2, end=((p.cursor+tail-2-i)%tail)*2;
        const alpha = fade * flicker * (p.drag ? .98 : .67);
        lines.add(h[start],h[start+1],p,alpha*(1-i/tail));
        lines.add(h[end],h[end+1],p,alpha*(1-(i+1)/tail));
        // Add a soft shoulder to the brightest section of each main ray.
        if (p.drag && i < 12) {
          const dx = h[start] - h[end], dy = h[start + 1] - h[end + 1];
          const length = Math.hypot(dx, dy);
          if (length > .25) {
            const offsetX = -dy / length * 1.4, offsetY = dx / length * 1.4;
            const glow = alpha * .55 * (1 - i / 12);
            lines.add(h[start] + offsetX, h[start + 1] + offsetY, p, glow);
            lines.add(h[end] + offsetX, h[end + 1] + offsetY, p, glow * .88);
          }
        }
      }
      if (p.kind === 'fire' && p.drag && p.max - p.life > .38 && flicker > .98) {
        const ember = ((p.cursor + tail - 14) % tail) * 2;
        dots.add(h[ember], h[ember + 1], p, fade * .64, p.size * 1.25);
      }
      if (p.kind === 'fire' && p.drag && p.size > 3.8 && flicker > .94) {
        const arm = p.size * 1.3;
        lines.add(p.x - arm, p.y, whiteSpark, 0);
        lines.add(p.x, p.y, whiteSpark, fade * .9);
        lines.add(p.x, p.y, whiteSpark, fade * .9);
        lines.add(p.x + arm, p.y, whiteSpark, 0);
        lines.add(p.x, p.y - arm, whiteSpark, 0);
        lines.add(p.x, p.y, whiteSpark, fade * .9);
        lines.add(p.x, p.y, whiteSpark, fade * .9);
        lines.add(p.x, p.y + arm, whiteSpark, 0);
      }
      dots.add(p.x,p.y,p,fade*flicker*.63,p.size*5.4);
      dots.add(p.x, p.y, p.kind === 'fire' ? whiteSpark : p, fade * .97, p.size * 2.15);
    }
    particles.length=kept;
    drawWetMarks(dt);
    rainRibbons.flush();
    waterBeads.flush();
    lines.flush();dots.flush();
    if (debugLines) drawCollisionDebug(now);
    renderer.render(scene,camera);
    if (debugPerformance) frameCount++;
    if (debugPerformance && now - sampleStart >= 500) {
      const fps = Math.round(frameCount * 1000 / (now - sampleStart));
      performancePanel.textContent = `FPS ${fps} · 粒子 ${particles.length} / ${limit} · 火箭 ${bursts.length}`;
      frameCount = 0;
      sampleStart = now;
    }
  }
  startRendering = () => {
    previous = sampleStart = performance.now();
    frameCount = 0;
    renderer.setAnimationLoop(renderFrame);
  };
  stopRendering = () => {
    renderer.setAnimationLoop(null);
    renderer.clear();
  };
}
init().catch(error=>{
  console.error(error);
  toggle.disabled = true;
  hint.textContent='特效无法启动。请检查浏览器是否支持 WebGL 2，以及本地构建资源是否完整。';
});
