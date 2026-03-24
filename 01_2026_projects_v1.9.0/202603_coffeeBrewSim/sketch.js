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
  noStroke();
  fill(255, 244, 226, 220);
  textAlign(LEFT, TOP);
  textSize(width * 0.014);
  text("Microsound Coffee Extraction", width * 0.03, height * 0.035);
  fill(220, 197, 162, 180);
  textSize(width * 0.0098);
  text("Click to activate sound. Drag in the left field to agitate the flow.", width * 0.03, height * 0.064);

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
    this.maxCoffee = 240;
    this.maxWater = 150;
    this.spawnAccumulator = 0;
    this.collisionCountFrame = 0;
    this.collisionHistory = [];
    this.currentFlow = 0;
    this.currentTDS = 0;
    this.extractionMass = 0;
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

  get bedTopDown() {
    const bounds = this.brewBounds;
    return {
      cx: bounds.x + bounds.w * 0.5,
      cy: bounds.y + bounds.h * 0.56,
      rx: bounds.w * 0.29,
      ry: bounds.h * 0.26
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
    const bounds = this.brewBounds;
    for (let i = 0; i < this.maxCoffee; i += 1) {
      this.coffeeParticles.push(this.createCoffeeParticle(bounds));
    }
    for (let i = 0; i < this.maxWater * 0.55; i += 1) {
      this.waterParticles.push(this.createWaterParticle());
    }
  }

  createCoffeeParticle(bounds) {
    const params = this.params;
    const bed = this.bedTopDown;
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
    size = constrain(size, 3.2, 26);
    const angle = random(TAU);
    const radial = sqrt(random());
    const x = bed.cx + cos(angle) * bed.rx * radial;
    const y = bed.cy + sin(angle) * bed.ry * radial;
    return new CoffeeParticle(x, y, size, isFine);
  }

  createWaterParticle() {
    const params = this.params;
    const bounds = this.brewBounds;
    const x = random(bounds.x + bounds.w * 0.38, bounds.x + bounds.w * 0.62);
    const y = bounds.y - random(10, 80);
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
      this.collisionHistory.length = 0;
      this.resetNeeded = false;
    }

    this.collisionCountFrame = 0;
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
    this.spawnAccumulator += dt * (24 + params.pourForce * 36);
    while (this.spawnAccumulator > 1 && this.waterParticles.length < this.maxWater) {
      this.spawnAccumulator -= 1;
      this.waterParticles.push(this.createWaterParticle());
    }
  }

  updateWater(dt) {
    const params = this.params;
    const bounds = this.brewBounds;
    const gravity = createVector(0, 14 * params.pourForce);
    const tempAmp = map(params.waterTemp, 70, 100, 0.06, 0.42);
    const swirl = params.turbulence * 0.12;

    for (const water of this.waterParticles) {
      water.temperature = params.waterTemp;
      water.applyForce(p5.Vector.mult(gravity, water.mass));

      const noiseAngle = noise(water.seed, frameCount * 0.014, water.pos.y * 0.004) * TAU * 2.0;
      const jitter = p5.Vector.fromAngle(noiseAngle).mult(tempAmp + swirl);
      water.applyForce(jitter);

      const centerPull = createVector(bounds.x + bounds.w * 0.5 - water.pos.x, bounds.y + bounds.h * 0.45 - water.pos.y);
      centerPull.mult(0.0014 + params.pourForce * 0.0009);
      water.applyForce(centerPull);

      water.update(dt);
      water.wrap(bounds);
    }
  }

  updateCoffee(dt) {
    const bed = this.bedTopDown;
    const params = this.params;
    const threshold = 2.8 + params.turbulence * 1.1 + params.pourForce * 0.9;

    for (const coffee of this.coffeeParticles) {
      const damping = p5.Vector.mult(coffee.vel, -0.11);
      coffee.applyForce(damping);

      const field = this.sampleWaterField(coffee.pos, 85);
      coffee.applyForce(field.mult(coffee.isFine ? 0.95 : 0.55));

      const localEnergy = this.sampleWaterEnergy(coffee.pos, 82);
      coffee.updateDepth(localEnergy, threshold, dt);

      const toCenter = createVector(bed.cx - coffee.pos.x, bed.cy - coffee.pos.y).mult(0.0024);
      coffee.applyForce(toCenter);

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
      }
    }
  }

  handleCollisions() {
    for (const water of this.waterParticles) {
      for (const coffee of this.coffeeParticles) {
        const sumR = water.radius + coffee.radius;
        const dx = coffee.pos.x - water.pos.x;
        const dy = coffee.pos.y - water.pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > sumR * sumR || distSq === 0) {
          continue;
        }

        const dist = sqrt(distSq);
        const normal = createVector(dx / dist, dy / dist);
        const overlap = sumR - dist;

        water.pos.add(p5.Vector.mult(normal, -overlap * 0.42));
        coffee.pos.add(p5.Vector.mult(normal, overlap * 0.58));

        const relative = p5.Vector.sub(coffee.vel, water.vel);
        const speed = relative.dot(normal);
        if (speed > 0) {
          continue;
        }

        const impulseMag = (-1.18 * speed) / (1 / water.mass + 1 / coffee.mass);
        const impulse = p5.Vector.mult(normal, impulseMag);
        water.vel.sub(p5.Vector.div(impulse, water.mass));
        coffee.vel.add(p5.Vector.div(impulse, coffee.mass));
        coffee.lastHit = frameCount;

        this.collisionCountFrame += 1;
        if (frameCount - water.lastSoundFrame > 2) {
          this.audio.trigger(coffee.radius, speed, this.currentFlow);
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

    const saturation = exp(-this.elapsed * 0.052);
    this.extractionMass += this.collisionCountFrame * dt * 0.17 * saturation;

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
    this.renderSectionView();
    this.renderTDSGauge();
  }

  renderBackdrop() {
    noStroke();
    const leftW = this.leftW;
    for (let i = 0; i < 18; i += 1) {
      const t = i / 17;
      fill(lerp(20, 6, t), lerp(16, 10, t), lerp(10, 18, t), 120);
      rect(0, height * t, leftW, height / 17 + 1);
    }
    fill(34, 24, 20, 120);
    rect(this.rightX, 0, width - this.rightX, height);

    stroke(214, 179, 124, 28);
    line(this.rightX, height * 0.06, this.rightX, height * 0.94);
  }

  renderMicroField() {
    const bounds = this.brewBounds;
    const bed = this.bedTopDown;
    noFill();
    stroke(227, 196, 150, 40);
    rect(bounds.x, bounds.y, bounds.w, bounds.h, 26);

    for (let i = 0; i < 42; i += 1) {
      const y = bounds.y + (bounds.h / 42) * i;
      stroke(255, 230, 190, 10);
      line(bounds.x + 10, y, bounds.x + bounds.w - 10, y);
    }

    noStroke();
    fill(68, 45, 29, 78);
    ellipse(bed.cx, bed.cy, bed.rx * 2.16, bed.ry * 2.08);
    fill(102, 66, 37, 34);
    ellipse(bed.cx, bed.cy, bed.rx * 1.55, bed.ry * 1.48);

    noStroke();
    for (const coffee of this.coffeeParticles) {
      coffee.render();
    }
    for (const water of this.waterParticles) {
      water.render();
    }

    const centerX = bounds.x + bounds.w * 0.5;
    const wave = sin(frameCount * 0.05) * 18;
    fill(255, 214, 173, 25);
    ellipse(centerX + wave, bounds.y + 12, bounds.w * 0.14, 30);
  }

  renderSectionView() {
    const section = this.bedSection;
    const { panelX, panelW, cx, topY, bottomY, dripperTop, dripperBottom, bedTop, bedBottom } = section;

    noFill();
    stroke(240, 214, 174, 90);
    strokeWeight(2);
    beginShape();
    vertex(cx - dripperTop, topY);
    vertex(cx - dripperBottom, bottomY);
    vertex(cx + dripperBottom, bottomY);
    vertex(cx + dripperTop, topY);
    endShape(CLOSE);

    const waterColumn = map(this.currentFlow, 0, 10, panelW * 0.025, panelW * 0.075, true);
    strokeWeight(1);
    for (const water of this.waterParticles) {
      const mappedY = map(constrain(water.pos.y, this.brewBounds.y, this.brewBounds.y + this.brewBounds.h), this.brewBounds.y, this.brewBounds.y + this.brewBounds.h, topY + 10, bottomY - 8);
      const drift = map(water.pos.x, this.brewBounds.x, this.brewBounds.x + this.brewBounds.w, -dripperBottom * 0.85, dripperBottom * 0.85);
      noStroke();
      fill(131, 182, 214, 105);
      ellipse(cx + drift * 0.45, mappedY, waterColumn, waterColumn * 1.3);
    }

    noStroke();
    fill(73, 46, 29, 145);
    beginShape();
    vertex(cx - dripperTop * 0.7, bedTop);
    vertex(cx - dripperBottom * 1.02, bedBottom);
    vertex(cx + dripperBottom * 1.02, bedBottom);
    vertex(cx + dripperTop * 0.7, bedTop);
    endShape(CLOSE);

    const bed = this.bedTopDown;
    const sampleStep = max(1, floor(this.coffeeParticles.length / 130));
    for (let i = 0; i < this.coffeeParticles.length; i += sampleStep) {
      const coffee = this.coffeeParticles[i];
      const lateralNorm = constrain((coffee.pos.x - (bed.cx - bed.rx)) / (bed.rx * 2), 0, 1);
      const localWidth = lerp(dripperTop * 0.7, dripperBottom * 1.02, coffee.depth);
      const px = cx + map(lateralNorm, 0, 1, -localWidth, localWidth);
      const py = lerp(bedTop + 4, bedBottom - 4, coffee.depth) + sin(i * 0.7 + frameCount * 0.02) * 1.6;
      fill(coffee.isFine ? 60 : 118, coffee.isFine ? 38 : 78, coffee.isFine ? 25 : 42, coffee.isFine ? 190 : 150);
      ellipse(px, py, coffee.radius * 0.78, coffee.radius * 0.62);
    }

    const coarseAvg = this.averageDepth(false);
    const fineAvg = this.averageDepth(true);

    fill(240, 221, 197, 170);
    textAlign(LEFT, TOP);
    textSize(width * 0.01);
    text("Section View", panelX + panelW * 0.08, height * 0.08);
    textSize(width * 0.0086);
    text(`Coarse depth ${nf(coarseAvg, 1, 2)}`, panelX + panelW * 0.08, height * 0.12);
    text(`Fine depth ${nf(fineAvg, 1, 2)}`, panelX + panelW * 0.08, height * 0.145);
    text(`Flow index ${nf(this.currentFlow, 1, 2)}`, panelX + panelW * 0.08, height * 0.17);
  }

  averageDepth(finesOnly) {
    let total = 0;
    let count = 0;
    for (const coffee of this.coffeeParticles) {
      if (coffee.isFine === finesOnly) {
        total += coffee.depth;
        count += 1;
      }
    }
    return count === 0 ? 0 : total / count;
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
    rect(gaugeX, gaugeY, 14, gaugeH, 10);

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
    this.depth = constrain(randomGaussian(0.52, 0.16), 0.08, 0.92);
    this.depthVel = 0;
    this.baseColor = isFine
      ? color(84, 52, 31, 170)
      : color(146, 98, 52, 130);
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(dt) {
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.vel.limit(this.isFine ? 2.4 : 1.8);
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
  }

  updateDepth(localEnergy, threshold, dt) {
    const mixedTarget = 0.52 + (this.isFine ? 0.06 : -0.05);
    const sortedTarget = this.isFine ? 0.78 : 0.26;
    const sortAmount = constrain(map(localEnergy, threshold, threshold * 2.4, 0, 1), 0, 1);
    const target = lerp(mixedTarget, sortedTarget, sortAmount);
    const pull = (target - this.depth) * (0.06 + sortAmount * 0.12);
    this.depthVel += pull * dt * 60;
    this.depthVel *= 0.92;
    this.depth = constrain(this.depth + this.depthVel * dt * 1.8, 0.06, 0.94);
  }

  keepInsideBed(bed) {
    const nx = (this.pos.x - bed.cx) / bed.rx;
    const ny = (this.pos.y - bed.cy) / bed.ry;
    const d = nx * nx + ny * ny;
    if (d <= 1) {
      return;
    }
    const angle = atan2(this.pos.y - bed.cy, this.pos.x - bed.cx);
    this.pos.x = bed.cx + cos(angle) * (bed.rx - this.radius * 0.35);
    this.pos.y = bed.cy + sin(angle) * (bed.ry - this.radius * 0.35);
    this.vel.mult(0.7);
  }

  render() {
    const hitGlow = constrain(map(frameCount - this.lastHit, 0, 12, 95, 0), 0, 95);
    const depthTint = lerp(1.15, 0.72, this.depth);
    noStroke();
    fill(red(this.baseColor) * depthTint, green(this.baseColor) * depthTint, blue(this.baseColor) * depthTint, alpha(this.baseColor));
    ellipse(this.pos.x, this.pos.y, this.radius * 2.1);
    fill(255, 210, 168, hitGlow);
    ellipse(this.pos.x, this.pos.y, this.radius * 2.7);
  }
}

class WaterParticle {
  constructor(x, y, temperature) {
    this.pos = createVector(x, y);
    this.vel = createVector(random(-0.5, 0.5), random(0.8, 1.6));
    this.acc = createVector(0, 0);
    this.temperature = temperature;
    this.life = random(5.8, 9.8);
    this.radius = random(2.6, 4.8);
    this.mass = this.radius * 0.45;
    this.seed = random(1000);
    this.lastSoundFrame = -999;
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(dt) {
    const tempBoost = map(this.temperature, 70, 100, 0.98, 1.35);
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.vel.mult(0.994);
    this.vel.limit(3.8 * tempBoost);
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
    this.life -= dt;
  }

  wrap(bounds) {
    if (this.pos.x < bounds.x + this.radius) {
      this.pos.x = bounds.x + this.radius;
      this.vel.x *= -0.35;
    }
    if (this.pos.x > bounds.x + bounds.w - this.radius) {
      this.pos.x = bounds.x + bounds.w - this.radius;
      this.vel.x *= -0.35;
    }
  }

  render() {
    const speedGlow = constrain(this.vel.mag() * 32, 18, 95);
    noStroke();
    fill(116, 176, 209, 40);
    ellipse(this.pos.x, this.pos.y, this.radius * 4.2);
    fill(142, 211, 236, speedGlow);
    ellipse(this.pos.x, this.pos.y, this.radius * 1.9);
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
