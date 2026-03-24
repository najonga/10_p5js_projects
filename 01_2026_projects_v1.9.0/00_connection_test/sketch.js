// coffee_visual_physics_sketch.js
// Stage 1: Visual Physics only (no p5.sound yet)
// p5.js sketch for a 16:9 coffee extraction microsimulation
// Left 70%: top-down particle world
// Right 30%: side-view dripper + controls/status

let sim;
let controlPanel;

const CANVAS_W = 1280;
const CANVAS_H = 720;

const LEFT_RATIO = 0.7;
const LEFT_W = Math.floor(CANVAS_W * LEFT_RATIO);
const RIGHT_W = CANVAS_W - LEFT_W;

const MAX_COFFEE = 260;
const MAX_WATER = 180;

function setup() {
  createCanvas(CANVAS_W, CANVAS_H);
  pixelDensity(1);
  sim = new Simulation();
  controlPanel = new ControlPanel(sim.params);
  sim.initializeParticles();
}

function draw() {
  background(12, 11, 10);

  sim.syncParams();
  sim.update();
  sim.render();

  controlPanel.renderLabels();
}

function mouseDragged() {
  sim.applyMouseTurbulence(mouseX, mouseY, pmouseX, pmouseY);
}

function mousePressed() {
  userStartAudio?.(); // harmless here; prepares for stage 2
}

function keyPressed() {
  if (key === 'R' || key === 'r') {
    sim.reset();
  }
}

class Simulation {
  constructor() {
    this.leftRect = { x: 0, y: 0, w: LEFT_W, h: CANVAS_H };
    this.rightRect = { x: LEFT_W, y: 0, w: RIGHT_W, h: CANVAS_H };

    this.params = {
      meanGrindSize: 11.5,
      uniformity: 0.72,
      finesRatio: 0.22,
      waterTemp: 78,
      pourForce: 1.25,
      turbulence: 1.1,
      coffeeCount: 220,
      waterCount: 140,
      extractionTargetTime: 22.0,
      tdsPeakScale: 1.0,
      reset: () => this.reset()
    };

    this.coffeeParticles = [];
    this.waterParticles = [];

    this.time = 0;
    this.dt = 1 / 60;
    this.collisionEvents = 0;
    this.collisionAccumulator = 0;
    this.flowHistory = [];
    this.tds = 0;
    this.tdsPeak = 0;
    this.extractionAmount = 0;
    this.energyField = 0;
    this.brazilNutActive = false;

    this.emitterX = this.leftRect.w * 0.5;
    this.emitterY = 40;

    this.sideFlow = [];
    this.spawnAccumulator = 0;
  }

  syncParams() {
    this.params.coffeeCount = constrain(floor(this.params.coffeeCount), 60, MAX_COFFEE);
    this.params.waterCount = constrain(floor(this.params.waterCount), 40, MAX_WATER);
  }

  reset() {
    this.time = 0;
    this.collisionEvents = 0;
    this.collisionAccumulator = 0;
    this.flowHistory = [];
    this.tds = 0;
    this.tdsPeak = 0;
    this.extractionAmount = 0;
    this.energyField = 0;
    this.brazilNutActive = false;
    this.sideFlow = [];
    this.initializeParticles();
  }

  initializeParticles() {
    this.coffeeParticles = [];
    this.waterParticles = [];

    for (let i = 0; i < this.params.coffeeCount; i++) {
      this.coffeeParticles.push(this.createCoffeeParticle());
    }

    for (let i = 0; i < this.params.waterCount; i++) {
      this.waterParticles.push(this.createWaterParticle(random(0.5, 1.0)));
    }
  }

  createCoffeeParticle() {
    const p = this.sampleCoffeeSize();
    const r = p.size;
    const x = random(r + 8, this.leftRect.w - r - 8);
    const y = random(this.leftRect.h * 0.2, this.leftRect.h - r - 10);
    return new CoffeeParticle(x, y, p.size, p.isFine);
  }

  createWaterParticle(seedVel = 1) {
    const spread = 32;
    const x = this.emitterX + random(-spread, spread);
    const y = this.emitterY + random(-10, 10);
    return new WaterParticle(x, y, this.params.waterTemp, this.params.pourForce, seedVel);
  }

  sampleCoffeeSize() {
    const finesChance = this.params.finesRatio;
    const isFine = random() < finesChance;

    const mean = this.params.meanGrindSize;
    const uniformity = this.params.uniformity;
    const deviation = map(uniformity, 0, 1, mean * 0.7, mean * 0.12);

    let size;
    if (isFine) {
      size = randomGaussian(mean * 0.38, deviation * 0.22);
    } else {
      size = randomGaussian(mean, deviation);
    }

    size = constrain(size, 2.5, 24);
    return { size, isFine };
  }

  update() {
    this.time += this.dt;
    this.collisionEvents = 0;

    this.spawnWaterContinuously();
    this.updateEnergyField();
    this.applyGlobalCoffeeForces();

    for (const w of this.waterParticles) {
      w.applyThermalJitter(this.params.waterTemp);
      w.applyForce(createVector(0, 0.02 * this.params.pourForce));
      w.update(this.leftRect);
    }

    for (const c of this.coffeeParticles) {
      c.update(this.leftRect);
    }

    this.handleWaterCoffeeCollisions();
    this.handleCoffeeCoffeeCollisions();
    this.handleWaterWaterSoftRepulsion();
    this.updateExtractionModel();
    this.updateSideFlow();
  }

  spawnWaterContinuously() {
    this.spawnAccumulator += 0.75 + this.params.pourForce * 0.55;

    while (this.spawnAccumulator >= 1) {
      this.spawnAccumulator -= 1;
      this.waterParticles.push(this.createWaterParticle(random(0.7, 1.2)));
    }

    if (this.waterParticles.length > this.params.waterCount) {
      this.waterParticles.splice(0, this.waterParticles.length - this.params.waterCount);
    }
  }

  updateEnergyField() {
    let total = 0;
    for (const w of this.waterParticles) {
      total += w.vel.magSq() * w.mass;
    }
    this.energyField = total / max(1, this.waterParticles.length);
    this.brazilNutActive = this.energyField > 7.8;
  }

  applyGlobalCoffeeForces() {
    const center = createVector(this.leftRect.w * 0.5, this.leftRect.h * 0.55);

    for (const c of this.coffeeParticles) {
      const towardCenter = p5.Vector.sub(center, c.pos);
      const dist = max(20, towardCenter.mag());
      towardCenter.setMag(0.0035 * map(dist, 20, 520, 1.1, 0.4));
      c.applyForce(towardCenter);

      const settle = createVector(0, 0.012 * c.mass);
      c.applyForce(settle);

      if (this.brazilNutActive) {
        const coarseLift = map(c.size, 2.5, 24, -0.03, 0.05);
        const fineSinkBias = c.isFine ? 0.055 : 0.0;
        c.applyForce(createVector(0, -(coarseLift) + fineSinkBias));
      }
    }
  }

  handleWaterCoffeeCollisions() {
    for (let i = 0; i < this.waterParticles.length; i++) {
      const w = this.waterParticles[i];

      for (let j = 0; j < this.coffeeParticles.length; j++) {
        const c = this.coffeeParticles[j];
        const delta = p5.Vector.sub(w.pos, c.pos);
        const dist = delta.mag();
        const minDist = w.radius + c.radius;

        if (dist > 0 && dist < minDist) {
          const normal = delta.copy().div(dist);
          const overlap = minDist - dist;

          w.pos.add(p5.Vector.mult(normal, overlap * 0.55));
          c.pos.sub(p5.Vector.mult(normal, overlap * 0.45));

          const relative = p5.Vector.sub(w.vel, c.vel);
          const sepVel = relative.dot(normal);

          if (sepVel < 0) {
            const restitution = 0.62;
            const invMassW = 1 / w.mass;
            const invMassC = 1 / c.mass;
            const jImpulse = -(1 + restitution) * sepVel / (invMassW + invMassC);
            const impulse = p5.Vector.mult(normal, jImpulse);

            w.vel.add(p5.Vector.mult(impulse, invMassW));
            c.vel.sub(p5.Vector.mult(impulse, invMassC));

            const tangent = createVector(-normal.y, normal.x);
            const tangentialAmt = relative.dot(tangent);
            const friction = tangent.mult(tangentialAmt * 0.028 * this.params.turbulence);
            w.vel.sub(friction);
            c.vel.add(friction.copy().mult(0.75));

            c.flash = min(1, c.flash + abs(sepVel) * 0.09);
            w.flash = min(1, w.flash + abs(sepVel) * 0.08);

            this.collisionEvents += 1;
            this.collisionAccumulator += abs(sepVel) * (0.5 + c.size * 0.03);
            // Stage 2 hook: triggerCollisionSound(c, w, abs(sepVel));
          }
        }
      }
    }
  }

  handleCoffeeCoffeeCollisions() {
    for (let i = 0; i < this.coffeeParticles.length; i++) {
      for (let j = i + 1; j < this.coffeeParticles.length; j++) {
        const a = this.coffeeParticles[i];
        const b = this.coffeeParticles[j];
        const delta = p5.Vector.sub(b.pos, a.pos);
        const dist = delta.mag();
        const minDist = a.radius + b.radius;

        if (dist > 0 && dist < minDist) {
          const normal = delta.copy().div(dist);
          const overlap = minDist - dist;
          a.pos.add(p5.Vector.mult(normal, -overlap * 0.5));
          b.pos.add(p5.Vector.mult(normal, overlap * 0.5));

          const relative = p5.Vector.sub(b.vel, a.vel);
          const sepVel = relative.dot(normal);
          if (sepVel < 0) {
            const restitution = 0.42;
            const invA = 1 / a.mass;
            const invB = 1 / b.mass;
            const impulseMag = -(1 + restitution) * sepVel / (invA + invB);
            const impulse = p5.Vector.mult(normal, impulseMag);
            a.vel.sub(p5.Vector.mult(impulse, invA));
            b.vel.add(p5.Vector.mult(impulse, invB));
          }
        }
      }
    }
  }

  handleWaterWaterSoftRepulsion() {
    for (let i = 0; i < this.waterParticles.length; i++) {
      for (let j = i + 1; j < this.waterParticles.length; j++) {
        const a = this.waterParticles[i];
        const b = this.waterParticles[j];
        const delta = p5.Vector.sub(b.pos, a.pos);
        const distSq = delta.magSq();
        const maxRange = 18;

        if (distSq > 0 && distSq < maxRange * maxRange) {
          const dist = sqrt(distSq);
          const push = delta.copy().normalize().mult((maxRange - dist) * 0.0025);
          a.vel.sub(push);
          b.vel.add(push);
        }
      }
    }
  }

  updateExtractionModel() {
    const flowRate = this.collisionEvents / max(1, this.waterParticles.length);
    this.flowHistory.push(flowRate);
    if (this.flowHistory.length > 120) this.flowHistory.shift();

    const meanFlow = this.getMeanFlow();
    const collisionContribution = this.collisionEvents * 0.0028;
    const energyContribution = constrain(this.energyField * 0.00035, 0, 0.03);
    this.extractionAmount += collisionContribution + energyContribution;

    const t = this.time;
    const target = this.params.extractionTargetTime;

    const rise = 1.0 - Math.exp(-this.extractionAmount * 0.24);
    const over = max(0, t - target);
    const overPenalty = 0.018 * pow(over, 1.28);
    const flowPenalty = abs(meanFlow - 0.12) * 0.9;

    this.tds = max(0, (rise * 100 * this.params.tdsPeakScale) - overPenalty - flowPenalty);
    this.tdsPeak = max(this.tdsPeak, this.tds);
  }

  updateSideFlow() {
    const columnX = this.rightRect.x + this.rightRect.w * 0.46;
    const topY = 130;
    const bottomY = height - 120;
    const speed = map(this.params.pourForce, 0.4, 2.5, 1.4, 4.8);

    if (frameCount % 2 === 0) {
      this.sideFlow.push({
        x: columnX + random(-14, 14),
        y: topY,
        vy: speed + random(0.2, 1.2),
        alpha: random(120, 220),
        size: random(4, 8)
      });
    }

    for (const d of this.sideFlow) {
      d.y += d.vy;
      d.x += sin(frameCount * 0.03 + d.y * 0.02) * 0.35 * this.params.turbulence;
      d.alpha *= 0.995;
    }

    this.sideFlow = this.sideFlow.filter(d => d.y < bottomY && d.alpha > 15);
  }

  getMeanFlow() {
    if (this.flowHistory.length === 0) return 0;
    let s = 0;
    for (const f of this.flowHistory) s += f;
    return s / this.flowHistory.length;
  }

  applyMouseTurbulence(mx, my, pmx, pmy) {
    if (mx < 0 || mx > this.leftRect.w || my < 0 || my > this.leftRect.h) return;

    const drag = createVector(mx - pmx, my - pmy);
    const power = drag.mag() * 0.02 * this.params.turbulence;
    if (power <= 0) return;

    const center = createVector(mx, my);
    const radius = 120;

    for (const w of this.waterParticles) {
      const offset = p5.Vector.sub(w.pos, center);
      const d = offset.mag();
      if (d < radius && d > 1) {
        const tangent = createVector(-offset.y, offset.x).normalize();
        const falloff = 1 - d / radius;
        w.vel.add(tangent.mult(power * falloff * 1.8));
      }
    }

    for (const c of this.coffeeParticles) {
      const offset = p5.Vector.sub(c.pos, center);
      const d = offset.mag();
      if (d < radius && d > 1) {
        const tangent = createVector(-offset.y, offset.x).normalize();
        const falloff = 1 - d / radius;
        c.vel.add(tangent.mult(power * falloff * 0.6));
      }
    }
  }

  render() {
    this.drawRegions();
    this.drawLeftBackgroundField();
    this.drawParticles();
    this.drawRightPanel();
    this.drawOverlayInfo();
  }

  drawRegions() {
    noStroke();
    fill(20, 17, 16);
    rect(0, 0, this.leftRect.w, this.leftRect.h);
    fill(28, 24, 22);
    rect(this.rightRect.x, this.rightRect.y, this.rightRect.w, this.rightRect.h);

    stroke(70, 58, 50, 120);
    line(this.leftRect.w, 0, this.leftRect.w, height);
  }

  drawLeftBackgroundField() {
    noStroke();
    for (let i = 0; i < 14; i++) {
      const alpha = 7 + i * 2;
      fill(80, 55, 30, alpha);
      ellipse(
        this.leftRect.w * 0.5 + sin(frameCount * 0.006 + i) * 80,
        this.leftRect.h * 0.55 + cos(frameCount * 0.008 + i * 0.7) * 60,
        520 - i * 26,
        380 - i * 20
      );
    }

    if (this.brazilNutActive) {
      noFill();
      stroke(255, 180, 120, 60);
      strokeWeight(1.2);
      for (let i = 0; i < 4; i++) {
        ellipse(this.leftRect.w * 0.5, this.leftRect.h * 0.55, 180 + i * 70 + sin(frameCount * 0.04 + i) * 8);
      }
    }
  }

  drawParticles() {
    for (const c of this.coffeeParticles) c.render();
    for (const w of this.waterParticles) w.render();
  }

  drawRightPanel() {
    const rx = this.rightRect.x;
    const rw = this.rightRect.w;

    fill(240, 230, 215, 18);
    noStroke();
    rect(rx + 16, 18, rw - 32, 684, 18);

    this.drawDripperSection();
    this.drawTDSGauge();
    this.drawFlowGraph();
    this.drawStatusText();
  }

  drawDripperSection() {
    const cx = this.rightRect.x + this.rightRect.w * 0.46;
    const topY = 130;
    const midY = 250;
    const botY = height - 120;

    stroke(190, 175, 160, 180);
    strokeWeight(2);
    noFill();
    beginShape();
    vertex(cx - 52, topY);
    vertex(cx - 36, midY);
    vertex(cx - 18, botY - 30);
    endShape();
    beginShape();
    vertex(cx + 52, topY);
    vertex(cx + 36, midY);
    vertex(cx + 18, botY - 30);
    endShape();

    stroke(130, 110, 90, 180);
    line(cx - 16, botY - 30, cx + 16, botY - 30);

    noStroke();
    fill(90, 60, 36, 150);
    ellipse(cx, botY - 42, 58, 16);

    fill(82, 54, 30, 180);
    for (let i = 0; i < 42; i++) {
      const py = map(i, 0, 41, midY - 8, botY - 42);
      const halfW = map(py, topY, botY, 44, 18);
      const jitter = noise(i * 0.2, frameCount * 0.01) * 6;
      ellipse(cx + random(-halfW + 6, halfW - 6), py + jitter, random(2, 5), random(2, 5));
    }

    for (const d of this.sideFlow) {
      noStroke();
      fill(145, 185, 215, d.alpha);
      ellipse(d.x, d.y, d.size, d.size * 1.5);
    }

    stroke(120, 160, 190, 140);
    strokeWeight(2.5);
    line(cx, 70, cx, 115);

    noStroke();
    fill(120, 160, 190, 120);
    ellipse(cx, 118, 16, 16);
  }

  drawTDSGauge() {
    const gx = this.rightRect.x + this.rightRect.w - 52;
    const gy = 78;
    const gh = 420;
    const gw = 18;

    noStroke();
    fill(255, 255, 255, 18);
    rect(gx, gy, gw, gh, 9);

    const normPeak = constrain(this.tdsPeak / 100, 0, 1);
    const normCurrent = constrain(this.tds / 100, 0, 1);
    const peakY = gy + gh * (1 - normPeak);
    const fillH = gh * normCurrent;

    fill(180, 120, 60, 210);
    rect(gx, gy + gh - fillH, gw, fillH, 9);

    stroke(255, 220, 180, 220);
    strokeWeight(2);
    line(gx - 8, peakY, gx + gw + 8, peakY);

    noStroke();
    fill(230, 220, 200);
    textAlign(CENTER, BOTTOM);
    textSize(11);
    text('TDS', gx + gw * 0.5, gy - 10);
  }

  drawFlowGraph() {
    const x = this.rightRect.x + 28;
    const y = height - 170;
    const w = this.rightRect.w - 90;
    const h = 92;

    noFill();
    stroke(255, 255, 255, 26);
    rect(x, y, w, h, 10);

    if (this.flowHistory.length < 2) return;

    stroke(150, 195, 225, 180);
    strokeWeight(1.6);
    noFill();
    beginShape();
    for (let i = 0; i < this.flowHistory.length; i++) {
      const fx = x + map(i, 0, this.flowHistory.length - 1, 0, w);
      const fy = y + h - map(this.flowHistory[i], 0, 0.45, 2, h - 2, true);
      vertex(fx, fy);
    }
    endShape();

    noStroke();
    fill(220, 212, 204);
    textSize(11);
    textAlign(LEFT, BOTTOM);
    text('flow / collision density', x, y - 6);
  }

  drawStatusText() {
    const x = this.rightRect.x + 28;
    let y = 46;

    noStroke();
    fill(232, 225, 215);
    textAlign(LEFT, TOP);
    textSize(17);
    text('Coffee Extraction Microsimulation', x, y);

    y += 30;
    fill(180, 165, 150);
    textSize(11);
    text('Stage 1 — Visual Physics only', x, y);

    y = 520;
    fill(225, 215, 205);
    textSize(12);
    text(`time            ${nf(this.time, 2, 1)} s`, x, y); y += 20;
    text(`collisions      ${this.collisionEvents}`, x, y); y += 20;
    text(`energy field    ${nf(this.energyField, 1, 2)}`, x, y); y += 20;
    text(`mean flow       ${nf(this.getMeanFlow(), 1, 3)}`, x, y); y += 20;
    text(`TDS             ${nf(this.tds, 2, 2)}`, x, y); y += 20;
    text(`peak TDS        ${nf(this.tdsPeak, 2, 2)}`, x, y); y += 20;

    fill(this.brazilNutActive ? color(255, 190, 120) : color(145, 132, 122));
    text(`brazil nut      ${this.brazilNutActive ? 'ACTIVE' : 'inactive'}`, x, y);

    fill(160, 146, 136);
    textSize(11);
    text('drag in left field = agitation / turbulence', x, height - 40);
    text('press R = reset particles', x, height - 24);
  }

  drawOverlayInfo() {
    noFill();
    stroke(255, 255, 255, 14);
    rect(8, 8, this.leftRect.w - 16, this.leftRect.h - 16, 14);
  }
}

class Particle {
  constructor(x, y) {
    this.pos = createVector(x, y);
    this.vel = createVector();
    this.acc = createVector();
    this.flash = 0;
    this.linearDamping = 0.985;
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(bounds) {
    this.vel.add(this.acc);
    this.vel.mult(this.linearDamping);
    this.pos.add(this.vel);
    this.acc.mult(0);
    this.flash *= 0.92;
    this.constrainToBounds(bounds);
  }

  constrainToBounds(bounds) {
    const r = this.radius;

    if (this.pos.x < bounds.x + r) {
      this.pos.x = bounds.x + r;
      this.vel.x *= -0.72;
    }
    if (this.pos.x > bounds.x + bounds.w - r) {
      this.pos.x = bounds.x + bounds.w - r;
      this.vel.x *= -0.72;
    }
    if (this.pos.y < bounds.y + r) {
      this.pos.y = bounds.y + r;
      this.vel.y *= -0.72;
    }
    if (this.pos.y > bounds.y + bounds.h - r) {
      this.pos.y = bounds.y + bounds.h - r;
      this.vel.y *= -0.68;
    }
  }
}

class CoffeeParticle extends Particle {
  constructor(x, y, size, isFine) {
    super(x, y);
    this.size = size;
    this.radius = size * 0.5;
    this.mass = map(size, 2.5, 24, 0.7, 3.8);
    this.isFine = isFine;
    this.linearDamping = 0.985;
    this.seed = random(1000);

    this.vel = p5.Vector.random2D().mult(random(0.15, 0.45));
  }

  render() {
    noStroke();

    const pulse = this.flash * 90;
    if (this.isFine) {
      fill(130 + pulse, 92 + pulse * 0.25, 58, 155);
    } else {
      fill(84 + pulse * 0.6, 54 + pulse * 0.25, 34, 220);
    }

    ellipse(this.pos.x, this.pos.y, this.radius * 2.05, this.radius * 2.05);

    fill(255, 240, 220, 18 + this.flash * 40);
    ellipse(this.pos.x - this.radius * 0.18, this.pos.y - this.radius * 0.18, this.radius * 0.75, this.radius * 0.75);
  }
}

class WaterParticle extends Particle {
  constructor(x, y, temperature, pourForce, seedVel = 1) {
    super(x, y);
    this.radius = random(2.6, 4.8);
    this.mass = map(this.radius, 2.6, 4.8, 0.5, 1.1);
    this.temperature = temperature;
    this.linearDamping = 0.992;

    const thermal = map(temperature, 20, 100, 0.5, 2.0);
    this.vel = createVector(random(-0.6, 0.6), random(0.4, 1.2)).mult(seedVel + thermal * 0.5 + pourForce * 0.2);
  }

  applyThermalJitter(temp) {
    const amp = map(temp, 20, 100, 0.002, 0.028);
    const angle = noise(this.pos.x * 0.01, this.pos.y * 0.01, frameCount * 0.01) * TAU * 2;
    const jitter = p5.Vector.fromAngle(angle).mult(amp);
    this.vel.add(jitter);
  }

  render() {
    noStroke();
    fill(140 + this.flash * 40, 185 + this.flash * 30, 220 + this.flash * 20, 110);
    ellipse(this.pos.x, this.pos.y, this.radius * 2.6, this.radius * 2.6);

    fill(220, 245, 255, 70 + this.flash * 60);
    ellipse(this.pos.x - 1, this.pos.y - 1, this.radius * 1.1, this.radius * 1.1);
  }
}

class ControlPanel {
  constructor(params) {
    this.params = params;
    this.sliders = [];
    this.build();
  }

  build() {
    const rightX = LEFT_W + 26;
    const startY = 352;
    const gap = 46;
    const w = 210;

    this.sliders.push(this.makeSlider('meanGrindSize', 4, 22, this.params.meanGrindSize, 0.1, rightX, startY + gap * 0, w));
    this.sliders.push(this.makeSlider('uniformity', 0, 1, this.params.uniformity, 0.01, rightX, startY + gap * 1, w));
    this.sliders.push(this.makeSlider('finesRatio', 0, 0.7, this.params.finesRatio, 0.01, rightX, startY + gap * 2, w));
    this.sliders.push(this.makeSlider('waterTemp', 20, 100, this.params.waterTemp, 1, rightX, startY + gap * 3, w));
    this.sliders.push(this.makeSlider('pourForce', 0.4, 2.5, this.params.pourForce, 0.01, rightX, startY + gap * 4, w));
    this.sliders.push(this.makeSlider('turbulence', 0, 3, this.params.turbulence, 0.01, rightX, startY + gap * 5, w));
    this.sliders.push(this.makeSlider('coffeeCount', 80, MAX_COFFEE, this.params.coffeeCount, 1, rightX, startY + gap * 6, w));
    this.sliders.push(this.makeSlider('waterCount', 40, MAX_WATER, this.params.waterCount, 1, rightX, startY + gap * 7, w));

    const button = createButton('Re-seed particles');
    button.position(rightX, startY + gap * 8 + 8);
    button.size(w, 28);
    button.mousePressed(() => this.params.reset());
    this.button = button;
  }

  makeSlider(key, minVal, maxVal, initial, step, x, y, w) {
    const s = createSlider(minVal, maxVal, initial, step);
    s.position(x, y);
    s.size(w);
    s.input(() => {
      this.params[key] = s.value();
    });
    return { key, slider: s, x, y };
  }

  renderLabels() {
    const labelMap = {
      meanGrindSize: 'Grind mean size',
      uniformity: 'Uniformity',
      finesRatio: 'Fines ratio',
      waterTemp: 'Water temperature',
      pourForce: 'Pour force',
      turbulence: 'Turbulence',
      coffeeCount: 'Coffee particles',
      waterCount: 'Water particles'
    };

    noStroke();
    fill(220, 212, 204);
    textAlign(LEFT, BOTTOM);
    textSize(11);

    for (const item of this.sliders) {
      const value = this.params[item.key];
      const suffix = item.key === 'waterTemp' ? ' °C' : '';
      const precision = Number.isInteger(value) ? 0 : 2;
      text(`${labelMap[item.key]}: ${nf(value, 1, precision)}${suffix}`, item.x, item.y - 6);
    }
  }
}
