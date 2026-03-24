const DESIGN_W = 1280;
const DESIGN_H = 720;
const ASPECT = 16 / 9;

let sim;
let controls = {};
let uiNodes = [];
let audioStarted = false;

function setup() {
  const dims = getCanvasSize();
  createCanvas(dims.w, dims.h);
  pixelDensity(1);
  strokeCap(SQUARE);
  strokeJoin(MITER);
  setupUI();
  sim = new BrewSimulation();
  textFont("Georgia");
}

function draw() {
  background(12, 10, 8);
  sim.update();
  sim.render();
  renderOverlay();
}

function mousePressed() {
  startAudioEngine();
  sim.applyPointerAgitation(mouseX, mouseY, 1.25);
}

function mouseDragged() {
  sim.applyPointerAgitation(mouseX, mouseY, 1.85);
}

function windowResized() {
  const dims = getCanvasSize();
  resizeCanvas(dims.w, dims.h);
  positionUI();
}

function getCanvasSize() {
  let w = windowWidth;
  let h = windowHeight;
  if (w / h > ASPECT) {
    w = h * ASPECT;
  } else {
    h = w / ASPECT;
  }
  return { w: floor(w), h: floor(h) };
}

function startAudioEngine() {
  if (audioStarted || typeof userStartAudio !== "function") {
    return;
  }
  userStartAudio();
  sim.audio.enable();
  audioStarted = true;
}

function setupUI() {
  const configs = [
    ["meanGrind", "Grind Mean", 6, 24, 13, 0.1],
    ["uniformity", "Uniformity", 0.1, 1, 0.62, 0.01],
    ["finesRatio", "Fines Ratio", 0, 0.6, 0.17, 0.01],
    ["waterTemp", "Water Temp", 70, 100, 91, 0.1],
    ["pourForce", "Pour Force", 0.15, 2.4, 1.05, 0.01],
    ["turbulence", "Turbulence", 0, 2.6, 0.9, 0.01]
  ];

  for (const [key, label, minV, maxV, initial, step] of configs) {
    const wrap = createDiv("");
    wrap.style("position", "absolute");
    wrap.style("color", "#f2e7d0");
    wrap.style("font-family", "Georgia, serif");
    wrap.style("font-size", "12px");
    wrap.style("letter-spacing", "0.05em");
    wrap.style("text-transform", "uppercase");
    wrap.style("background", "rgba(16, 12, 10, 0.64)");
    wrap.style("padding", "8px 10px");
    wrap.style("border", "1px solid rgba(228, 197, 154, 0.15)");
    wrap.style("backdrop-filter", "blur(3px)");

    const title = createDiv(label);
    title.parent(wrap);

    const slider = createSlider(minV, maxV, initial, step);
    slider.parent(wrap);
    slider.style("width", "160px");
    slider.input(() => sim.markParticleReset());

    const value = createDiv("");
    value.parent(wrap);
    value.style("margin-top", "4px");
    value.style("font-size", "11px");
    value.style("opacity", "0.72");

    controls[key] = { wrap, slider, value, label };
    uiNodes.push(wrap);
  }

  positionUI();
}

function positionUI() {
  const startX = width * 0.77;
  const startY = height * 0.08;
  const spacing = height * 0.11;
  let idx = 0;
  for (const key of Object.keys(controls)) {
    const node = controls[key].wrap;
    node.position(startX, startY + spacing * idx);
    idx += 1;
  }
}

function renderOverlay() {
  for (const key of Object.keys(controls)) {
    const v = controls[key].slider.value();
    controls[key].value.html(nf(v, 1, key === "waterTemp" || key === "meanGrind" ? 1 : 2));
  }
}

class BrewSimulation {
  constructor() {
    this.leftRatio = 0.7;
    this.elapsed = 0;
    this.coffeeParticles = [];
    this.waterParticles = [];
    this.maxCoffee = 320;
    this.maxWater = 1;
    this.spawnAccumulator = 0;
    this.collisionCountFrame = 0;
    this.collisionHistory = [];
    this.currentFlow = 0;
    this.currentTDS = 0;
    this.extractionMass = 0;
    this.frameExtraction = 0;
    this.optimalTime = 25;
    this.overExtractRate = 0.02;
    this.resetNeeded = false;
    this.audio = new AudioEngine();
    this.initParticles();
  }

  markParticleReset() {
    this.resetNeeded = true;
  }

  get params() {
    return {
      meanGrind: controls.meanGrind.slider.value(),
      uniformity: controls.uniformity.slider.value(),
      finesRatio: controls.finesRatio.slider.value(),
      waterTemp: controls.waterTemp.slider.value(),
      pourForce: controls.pourForce.slider.value(),
      turbulence: controls.turbulence.slider.value()
    };
  }

  get leftW() {
    return width * this.leftRatio;
  }

  get rightX() {
    return this.leftW;
  }

  get brewBounds() {
    return {
      x: width * 0.04,
      y: height * 0.09,
      w: this.leftW - width * 0.08,
      h: height * 0.82
    };
  }

  get bedRect() {
    const bounds = this.brewBounds;
    const w = min(bounds.w * 0.62, bounds.h * 0.5);
    const h = w * 2;
    return {
      x: bounds.x + bounds.w * 0.5 - w * 0.5,
      y: bounds.y + bounds.h * 0.02,
      w,
      h
    };
  }

  get bedSection() {
    const panelX = this.rightX;
    const panelW = width - panelX;
    const cx = panelX + panelW * 0.46;
    const topY = height * 0.12;
    const bottomY = height * 0.83;
    const dripperTop = panelW * 0.18;
    const dripperBottom = panelW * 0.1;
    const bedTop = topY + (bottomY - topY) * 0.24;
    const bedBottom = bottomY - 18;
    return { cx, topY, bottomY, dripperTop, dripperBottom, bedTop, bedBottom, panelW, panelX };
  }

  initParticles() {
    this.coffeeParticles.length = 0;
    this.waterParticles.length = 0;
    this.generateCoffeeBed();
    this.waterParticles.push(this.createWaterParticle());
  }

  sampleCoffeeSpecs() {
    const params = this.params;
    const mean = params.meanGrind;
    const uniformity = params.uniformity;
    const finesRatio = params.finesRatio;
    const isFine = random() < finesRatio;
    let size;
    if (isFine) {
      size = random(mean * 0.22, mean * 0.58);
    } else {
      const sd = lerp(mean * 0.7, mean * 0.12, uniformity);
      size = randomGaussian(mean, sd);
    }
    size = constrain(size * 1.9, 16, 56);
    return { size, isFine };
  }

  generateCoffeeBed() {
    const bed = this.bedRect;
    const placed = [];
    const targetCoverage = bed.w * bed.h * 0.9;
    const maxAttempts = this.maxCoffee * 24;
    let attempts = 0;
    let coverage = 0;

    while (placed.length < this.maxCoffee && attempts < maxAttempts && coverage < targetCoverage) {
      attempts += 1;
      const specs = this.sampleCoffeeSpecs();
      const r = specs.size * 0.5;
      const x = random(bed.x + r + 2, bed.x + bed.w - r - 2);
      const yBias = pow(random(), 0.58);
      const y = lerp(bed.y + r + 2, bed.y + bed.h - r - 2, yBias);
      let blocked = false;
      for (const other of placed) {
        if (dist(x, y, other.pos.x, other.pos.y) < r + other.radius + 0.25) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        const particle = new CoffeeParticle(x, y, specs.size, specs.isFine);
        placed.push(particle);
        coverage += PI * particle.radius * particle.radius * 0.82;
      }
    }

    while (placed.length < this.maxCoffee && coverage < targetCoverage * 1.03) {
      const specs = this.sampleCoffeeSpecs();
      const r = specs.size * 0.5;
      const x = random(bed.x + r + 2, bed.x + bed.w - r - 2);
      const y = random(bed.y + r + 2, bed.y + bed.h - r - 2);
      const particle = new CoffeeParticle(x, y, specs.size, specs.isFine);
      placed.push(particle);
      coverage += PI * particle.radius * particle.radius * 0.72;
    }

    this.coffeeParticles = placed;
  }

  createWaterParticle() {
    const params = this.params;
    const bed = this.bedRect;
    const showerW = bed.w * 0.72;
    const x = random(bed.x + bed.w * 0.5 - showerW * 0.5, bed.x + bed.w * 0.5 + showerW * 0.5);
    const y = bed.y - random(22, 86);
    return new WaterParticle(x, y, params.waterTemp);
  }

  update() {
    const dt = min(deltaTime / 1000, 1 / 30);
    this.elapsed += dt;
    if (this.resetNeeded) {
      this.initParticles();
      this.elapsed = 0;
      this.extractionMass = 0;
      this.currentTDS = 0;
      this.frameExtraction = 0;
      this.collisionHistory.length = 0;
      this.resetNeeded = false;
    }

    this.collisionCountFrame = 0;
    this.frameExtraction = 0;
    this.spawnWater(dt);
    this.updateWater(dt);
    this.updateCoffee(dt);
    this.handleCollisions();
    this.removeExpiredWater();
    this.updateFlowAndExtraction(dt);
    this.audio.update(this.currentFlow, this.params.waterTemp);
  }

  spawnWater(dt) {
    const params = this.params;
    this.spawnAccumulator += dt * (0.18 + params.pourForce * 0.12);
    while (this.spawnAccumulator > 1 && this.waterParticles.length < this.maxWater) {
      this.spawnAccumulator -= 1;
      this.waterParticles.push(this.createWaterParticle());
    }
  }

  updateWater(dt) {
    const params = this.params;
    const bounds = this.brewBounds;
    const bed = this.bedRect;
    const speedScale = 0.1;
    const gravity = createVector(0, 14 * params.pourForce * speedScale);
    const tempAmp = map(params.waterTemp, 70, 100, 0.09, 0.5) * speedScale;
    const swirl = params.turbulence * 0.18 * speedScale;

    for (const water of this.waterParticles) {
      water.temperature = params.waterTemp;
      water.applyForce(p5.Vector.mult(gravity, water.mass));

      const noiseAngle = noise(water.seed, frameCount * 0.018, water.pos.y * 0.005) * TAU * 2.4;
      const jitter = p5.Vector.fromAngle(noiseAngle).mult(tempAmp + swirl);
      water.applyForce(jitter);

      const lateral = sin(frameCount * 0.035 + water.seed * 6.0) * (0.012 + params.turbulence * 0.028) * speedScale;
      water.applyForce(createVector(lateral, 0));

      if (water.pos.y > bed.y && water.pos.y < bed.y + bed.h) {
        water.vel.mult(0.9988);
        water.applyForce(createVector(0, 0.008));
      }

      water.update(dt);
      water.keepInsideColumn(bounds, bed);
    }
  }

  updateCoffee(dt) {
    const bed = this.bedRect;
    const params = this.params;
    const threshold = 2.7 + params.turbulence * 1.2 + params.pourForce * 1.0;

    for (const coffee of this.coffeeParticles) {
      const damping = p5.Vector.mult(coffee.vel, -0.15);
      coffee.applyForce(damping);
      coffee.applyForce(createVector(0, 0.04 * coffee.mass));

      const field = this.sampleWaterField(coffee.pos, 85);
      coffee.applyForce(field.mult(coffee.isFine ? 0.85 : 0.65));

      const localEnergy = this.sampleWaterEnergy(coffee.pos, 82);
      if (localEnergy > threshold) {
        const sortForce = coffee.isFine ? 0.085 : -0.07;
        coffee.applyForce(createVector(0, sortForce * coffee.mass));
      }

      const toMidX = (bed.x + bed.w * 0.5 - coffee.pos.x) * 0.0018;
      coffee.applyForce(createVector(toMidX, 0));

      coffee.update(dt);
      coffee.keepInsideBed(bed);
    }

    this.resolveCoffeePacking();
  }

  computeWaterEnergy() {
    if (this.waterParticles.length === 0) {
      return 0;
    }
    let total = 0;
    for (const water of this.waterParticles) {
      total += water.vel.magSq() * 0.5;
    }
    return total / this.waterParticles.length;
  }

  sampleWaterField(pos, radius) {
    const field = createVector(0, 0);
    let count = 0;
    for (const water of this.waterParticles) {
      const d = p5.Vector.dist(pos, water.pos);
      if (d < radius) {
        const influence = map(d, 0, radius, 1, 0);
        field.add(p5.Vector.mult(water.vel, influence * 0.002));
        count += 1;
      }
    }
    if (count > 0) {
      field.div(count);
    }
    return field;
  }

  sampleWaterEnergy(pos, radius) {
    let total = 0;
    let count = 0;
    for (const water of this.waterParticles) {
      const d = p5.Vector.dist(pos, water.pos);
      if (d < radius) {
        const influence = map(d, 0, radius, 1, 0);
        total += water.vel.magSq() * influence;
        count += 1;
      }
    }
    if (count === 0) {
      return 0;
    }
    return total / count;
  }

  resolveCoffeePacking() {
    for (let i = 0; i < this.coffeeParticles.length; i += 1) {
      const a = this.coffeeParticles[i];
      for (let j = i + 1; j < this.coffeeParticles.length; j += 1) {
        const b = this.coffeeParticles[j];
        const delta = p5.Vector.sub(b.pos, a.pos);
        const distSq = delta.magSq();
        const minDist = a.radius + b.radius;
        if (distSq === 0 || distSq >= minDist * minDist) {
          continue;
        }
        const dist = sqrt(distSq);
        const normal = delta.copy().div(dist);
        const overlap = minDist - dist;
        const totalInvMass = 1 / a.mass + 1 / b.mass;
        a.pos.add(p5.Vector.mult(normal, -overlap * (1 / a.mass) / totalInvMass));
        b.pos.add(p5.Vector.mult(normal, overlap * (1 / b.mass) / totalInvMass));

        const relative = p5.Vector.sub(b.vel, a.vel);
        const speed = relative.dot(normal);
        if (speed >= 0) {
          continue;
        }
        const impulseMag = (-0.32 * speed) / totalInvMass;
        const impulse = p5.Vector.mult(normal, impulseMag);
        a.vel.sub(p5.Vector.div(impulse, a.mass));
        b.vel.add(p5.Vector.div(impulse, b.mass));
        a.keepInsideBed(this.bedRect);
        b.keepInsideBed(this.bedRect);
      }
    }
  }

  resolvePair(a, b, restitution, friction) {
    const delta = p5.Vector.sub(b.pos, a.pos);
    const distSq = delta.magSq();
    const minDist = a.radius + b.radius;
    if (distSq === 0 || distSq >= minDist * minDist) {
      return null;
    }

    const dist = sqrt(distSq);
    const normal = delta.copy().div(dist);
    const overlap = minDist - dist;
    const totalInvMass = 1 / a.mass + 1 / b.mass;

    a.pos.add(p5.Vector.mult(normal, -overlap * (1 / a.mass) / totalInvMass));
    b.pos.add(p5.Vector.mult(normal, overlap * (1 / b.mass) / totalInvMass));

    const rv = p5.Vector.sub(b.vel, a.vel);
    const velAlongNormal = rv.dot(normal);
    if (velAlongNormal > 0) {
      return null;
    }

    const impulseMag = (-(1 + restitution) * velAlongNormal) / totalInvMass;
    const impulse = p5.Vector.mult(normal, impulseMag);
    a.vel.sub(p5.Vector.div(impulse, a.mass));
    b.vel.add(p5.Vector.div(impulse, b.mass));

    const tangent = p5.Vector.sub(rv, p5.Vector.mult(normal, velAlongNormal));
    if (tangent.magSq() > 0.0001) {
      tangent.normalize();
      const jt = (-rv.dot(tangent) * friction) / totalInvMass;
      const frictionImpulse = p5.Vector.mult(tangent, jt);
      a.vel.sub(p5.Vector.div(frictionImpulse, a.mass));
      b.vel.add(p5.Vector.div(frictionImpulse, b.mass));
    }

    return abs(velAlongNormal);
  }

  transferExtraction(water, coffee, impactSpeed) {
    const available = coffee.solubleLeft;
    const capacity = water.maxYield - water.extractLoad;
    if (available <= 0 || capacity <= 0) {
      return 0;
    }
    const transfer = min(available, capacity, 0.0035 + impactSpeed * 0.0022);
    coffee.solubleLeft -= transfer;
    water.extractLoad += transfer;
    water.brewTint = lerp(water.brewTint, coffee.colorSeed, 0.34);
    this.frameExtraction += transfer;
    return transfer;
  }

  handleCollisions() {
    for (const water of this.waterParticles) {
      for (const coffee of this.coffeeParticles) {
        const impact = this.resolvePair(water, coffee, 0.42, 0.12);
        if (impact === null) {
          continue;
        }
        coffee.lastHit = frameCount;
        coffee.keepInsideBed(this.bedRect);
        water.keepInsideColumn(this.brewBounds, this.bedRect);
        this.transferExtraction(water, coffee, impact);

        this.collisionCountFrame += 1;
        if (frameCount - water.lastSoundFrame > 2) {
          this.audio.trigger(coffee.radius, impact, this.currentFlow);
          water.lastSoundFrame = frameCount;
        }
      }
    }
  }

  removeExpiredWater() {
    const bounds = this.brewBounds;
    this.waterParticles = this.waterParticles.filter((water) => water.life > 0 && water.pos.y < bounds.y + bounds.h + 40);
  }

  updateFlowAndExtraction(dt) {
    this.collisionHistory.push(this.collisionCountFrame);
    if (this.collisionHistory.length > 45) {
      this.collisionHistory.shift();
    }
    const recent = this.collisionHistory.reduce((sum, n) => sum + n, 0);
    this.currentFlow = recent / max(1, this.collisionHistory.length);

    const saturation = exp(-this.elapsed * 0.05);
    this.extractionMass += this.frameExtraction * 18 * saturation + this.collisionCountFrame * dt * 0.015;

    const over = max(0, this.elapsed - this.optimalTime);
    const penalty = pow(over, 1.32) * this.overExtractRate;
    this.currentTDS = max(0, this.extractionMass - penalty);
  }

  applyPointerAgitation(px, py, strength) {
    if (px > this.leftW) {
      return;
    }
    const radius = width * 0.13;
    const params = this.params;
    for (const water of this.waterParticles) {
      const d = dist(px, py, water.pos.x, water.pos.y);
      if (d < radius) {
        const dir = createVector(water.pos.x - px, water.pos.y - py);
        dir.rotate(HALF_PI);
        dir.setMag(map(d, 0, radius, strength * params.turbulence * 2.6, 0));
        water.applyForce(dir);
      }
    }
  }

  render() {
    this.renderBackdrop();
    this.renderMicroField();
    this.renderTDSGauge();
  }

  renderBackdrop() {
    background(2, 2, 2);
  }

  renderMicroField() {
    const bed = this.bedRect;
    stroke(255, 255, 255, 228);
    strokeWeight(2);
    line(bed.x, bed.y, bed.x, bed.y + bed.h);
    line(bed.x + bed.w, bed.y, bed.x + bed.w, bed.y + bed.h);
    line(bed.x, bed.y + bed.h, bed.x + bed.w, bed.y + bed.h);

    noStroke();
    for (const water of this.waterParticles) {
      water.render();
    }
    for (const coffee of this.coffeeParticles) {
      coffee.render();
    }
  }

  renderTDSGauge() {
    const panelX = this.rightX;
    const panelW = width - panelX;
    const gaugeX = panelX + panelW * 0.82;
    const gaugeY = height * 0.14;
    const gaugeH = height * 0.66;
    const normalized = constrain(this.currentTDS / 12, 0, 1);
    const peakNorm = constrain((this.optimalTime - min(this.elapsed, this.optimalTime)) / this.optimalTime, 0, 1);

    noFill();
    stroke(245, 228, 203, 60);
    rect(gaugeX, gaugeY, 14, gaugeH);

    for (let i = 0; i < 36; i += 1) {
      const t = i / 35;
      const yy = gaugeY + gaugeH - t * gaugeH;
      stroke(255, 242, 214, 22);
      line(gaugeX - 7, yy, gaugeX + 21, yy);
    }

    noStroke();
    for (let i = 0; i < 46; i += 1) {
      const t = i / 45;
      const yy = gaugeY + gaugeH - t * gaugeH;
      const active = t < normalized;
      fill(
        active ? lerp(116, 236, t) : 56,
        active ? lerp(71, 196, t) : 36,
        active ? lerp(38, 118, t) : 24,
        active ? 210 : 28
      );
      rect(gaugeX + 1, yy, 12, gaugeH / 45 + 1);
    }

    const peakY = gaugeY + gaugeH * peakNorm;
    stroke(255, 188, 125, 190);
    line(gaugeX - 10, peakY, gaugeX + 24, peakY);

    noStroke();
    fill(245, 223, 196, 180);
    textAlign(CENTER, BOTTOM);
    textSize(width * 0.009);
    text("TDS", gaugeX + 7, gaugeY - 12);
    textAlign(CENTER, TOP);
    textSize(width * 0.0083);
    text(nf(this.currentTDS, 1, 2), gaugeX + 7, gaugeY + gaugeH + 10);
  }
}

class CoffeeParticle {
  constructor(x, y, size, isFine) {
    this.pos = createVector(x, y);
    this.vel = p5.Vector.random2D().mult(random(0.01, 0.12));
    this.acc = createVector(0, 0);
    this.radius = size * 0.5;
    this.mass = max(0.8, this.radius * 0.7);
    this.isFine = isFine;
    this.lastHit = -999;
    this.baseColor = isFine
      ? color(34, 18, 10, 220)
      : color(58, 28, 14, 210);
    this.colorSeed = isFine ? 0.82 : 0.64;
    this.solubleMax = map(this.radius, 1.8, 12, 0.045, 0.14, true);
    this.solubleLeft = this.solubleMax;
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(dt) {
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.vel.limit(this.isFine ? 1.9 : 1.5);
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
  }

  keepInsideBed(bed) {
    if (this.pos.x < bed.x + this.radius) {
      this.pos.x = bed.x + this.radius;
      this.vel.x *= -0.25;
    }
    if (this.pos.x > bed.x + bed.w - this.radius) {
      this.pos.x = bed.x + bed.w - this.radius;
      this.vel.x *= -0.25;
    }
    if (this.pos.y < bed.y + this.radius) {
      this.pos.y = bed.y + this.radius;
      this.vel.y *= -0.2;
    }
    if (this.pos.y > bed.y + bed.h - this.radius) {
      this.pos.y = bed.y + bed.h - this.radius;
      this.vel.y *= -0.18;
    }
  }

  render() {
    const hitGlow = constrain(map(frameCount - this.lastHit, 0, 12, 95, 0), 0, 95);
    const yieldRatio = this.solubleLeft / this.solubleMax;
    this.renderColor = lerpColor(color(104, 82, 62, 120), this.baseColor, yieldRatio);
    noStroke();
    fill(red(this.renderColor), green(this.renderColor), blue(this.renderColor), alpha(this.baseColor));
    ellipse(this.pos.x, this.pos.y, this.radius * 2.0);
    fill(255, 242, 218, hitGlow * 0.65);
    ellipse(this.pos.x, this.pos.y, this.radius * 2.22);
  }
}

class WaterParticle {
  constructor(x, y, temperature) {
    this.pos = createVector(x, y);
    this.vel = createVector(random(-0.05, 0.05), random(0.08, 0.16));
    this.acc = createVector(0, 0);
    this.temperature = temperature;
    this.life = random(18, 26);
    this.radius = random(3.2, 5.4);
    this.mass = this.radius * 0.45;
    this.seed = random(1000);
    this.lastSoundFrame = -999;
    this.extractLoad = 0;
    this.maxYield = random(0.16, 0.26);
    this.brewTint = random(0.58, 0.72);
    this.displayColor = color(236, 247, 255, 200);
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(dt) {
    const tempBoost = map(this.temperature, 70, 100, 0.98, 1.35);
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.vel.mult(0.9992);
    this.vel.limit(0.38 * tempBoost);
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
    this.life -= dt;

    const brewRatio = constrain(this.extractLoad / this.maxYield, 0, 1);
    this.displayColor = lerpColor(
      color(238, 248, 255, 190),
      color(126 + this.brewTint * 32, 86 + this.brewTint * 20, 52 + this.brewTint * 10, 205),
      brewRatio
    );
  }

  keepInsideColumn(bounds, bed) {
    const wallLeft = bed.x - 12;
    const wallRight = bed.x + bed.w + 12;
    if (this.pos.x < wallLeft + this.radius) {
      this.pos.x = wallLeft + this.radius;
      this.vel.x *= -0.45;
    }
    if (this.pos.x > wallRight - this.radius) {
      this.pos.x = wallRight - this.radius;
      this.vel.x *= -0.45;
    }
    if (this.pos.y < bounds.y - 20) {
      this.pos.y = bounds.y - 20;
    }
    if (this.pos.y > bed.y + bed.h + 35) {
      this.life = -1;
    }
  }

  render() {
    const speedGlow = constrain(this.vel.mag() * 32, 18, 95);
    noStroke();
    fill(red(this.displayColor), green(this.displayColor), blue(this.displayColor), 44);
    ellipse(this.pos.x, this.pos.y, this.radius * 3.3);
    fill(red(this.displayColor), green(this.displayColor), blue(this.displayColor), speedGlow);
    ellipse(this.pos.x, this.pos.y, this.radius * 2.0);
  }
}

class AudioEngine {
  constructor() {
    this.enabledFlag = false;
    this.highPass = null;
    this.lowPass = null;
    this.voices = [];
    this.voiceIndex = 0;
    if (typeof p5 !== "undefined" && p5.Oscillator) {
      this.setup();
    }
  }

  setup() {
    this.highPass = new p5.HighPass();
    this.lowPass = new p5.LowPass();
    this.highPass.disconnect();
    this.lowPass.disconnect();
    this.highPass.connect(this.lowPass);
    this.lowPass.connect();
    this.highPass.freq(20);
    this.lowPass.freq(12000);
    this.lowPass.res(2);

    for (let i = 0; i < 10; i += 1) {
      const osc = new p5.Oscillator(i % 2 === 0 ? "triangle" : "sine");
      const noise = new p5.Noise("brown");
      const oscEnv = new p5.Envelope();
      const noiseEnv = new p5.Envelope();

      osc.disconnect();
      noise.disconnect();
      osc.connect(this.highPass);
      noise.connect(this.highPass);

      oscEnv.setADSR(0.002, 0.02, 0.0, 0.06);
      oscEnv.setRange(0.06, 0);
      noiseEnv.setADSR(0.001, 0.014, 0.0, 0.03);
      noiseEnv.setRange(0.03, 0);

      osc.start();
      noise.start();
      osc.amp(0);
      noise.amp(0);

      this.voices.push({ osc, noise, oscEnv, noiseEnv });
    }
  }

  enable() {
    this.enabledFlag = true;
  }

  trigger(coffeeRadius, impactSpeed, flow) {
    if (!this.enabledFlag || this.voices.length === 0) {
      return;
    }
    const voice = this.voices[this.voiceIndex];
    this.voiceIndex = (this.voiceIndex + 1) % this.voices.length;

    const pitch = map(coffeeRadius, 1.5, 12, 980, 180, true) + impactSpeed * 22;
    const noiseAmp = map(coffeeRadius, 1.5, 12, 0.05, 0.014, true);
    const toneAmp = map(flow, 0, 10, 0.02, 0.08, true);

    voice.osc.freq(pitch);
    voice.oscEnv.setRange(toneAmp, 0);
    voice.noiseEnv.setRange(noiseAmp, 0);
    voice.oscEnv.play(voice.osc);
    voice.noiseEnv.play(voice.noise);
  }

  update(flow, waterTemp) {
    if (!this.highPass || !this.lowPass) {
      return;
    }
    const slowThreshold = 1.2;
    const fastThreshold = 3.8;
    let hpFreq = 20;
    let lpFreq = 12000;

    if (flow < slowThreshold) {
      lpFreq = map(flow, 0, slowThreshold, 520, 3200, true);
    } else if (flow > fastThreshold) {
      hpFreq = map(flow, fastThreshold, 10, 350, 2600, true);
    }

    lpFreq += map(waterTemp, 70, 100, -180, 220, true);
    this.highPass.freq(hpFreq);
    this.lowPass.freq(lpFreq);
  }
}
