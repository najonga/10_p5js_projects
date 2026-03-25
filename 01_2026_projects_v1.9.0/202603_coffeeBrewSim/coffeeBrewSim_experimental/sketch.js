const DESIGN_W = 1280;
const DESIGN_H = 720;
const ASPECT = 16 / 9;

let sim;

function setup() {
  const dims = getCanvasSize();
  createCanvas(dims.w, dims.h);
  pixelDensity(1);
  textFont("Georgia");
  sim = new SingleParticleBrewSim();
}

function draw() {
  background(10, 8, 6);
  sim.update();
  sim.render();
}

function mousePressed() {
  sim.reset();
}

function keyPressed() {
  if (key === "r" || key === "R") {
    sim.reset();
  }
}

function windowResized() {
  const dims = getCanvasSize();
  resizeCanvas(dims.w, dims.h);
  sim.reset();
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

class SingleParticleBrewSim {
  constructor() {
    this.gravity = createVector(0, 0.28);
    this.reset();
  }

  get chamber() {
    const w = min(width * 0.34, 320);
    const h = min(height * 0.72, 520);
    return {
      x: width * 0.5 - w * 0.5,
      y: height * 0.12,
      w,
      h,
      cx: width * 0.5,
      floorY: height * 0.12 + h
    };
  }

  reset() {
    const chamber = this.chamber;
    this.elapsed = 0;
    this.collisionHappened = false;
    this.resetTimer = 0;
    this.coffee = new CoffeeParticle(chamber.cx, chamber.floorY - 22, 44);
    this.water = new WaterParticle(chamber.cx, chamber.y + 42, 12);
  }

  update() {
    const dt = min(deltaTime / 1000, 1 / 30);
    const chamber = this.chamber;

    this.elapsed += dt;

    this.water.applyForce(p5.Vector.mult(this.gravity, this.water.mass));
    this.coffee.applyForce(p5.Vector.mult(this.gravity, this.coffee.mass));

    this.water.applyForce(p5.Vector.mult(this.water.vel, -0.012));
    this.coffee.applyForce(p5.Vector.mult(this.coffee.vel, -0.085));

    this.water.update(dt);
    this.coffee.update(dt);

    this.resolvePair(this.water, this.coffee, 0.36);

    this.water.keepInsideChamber(chamber);
    this.coffee.keepInsideChamber(chamber);
    this.coffee.applyGroundFriction(chamber.floorY);

    if (this.collisionHappened) {
      this.resetTimer += dt;
    }

    const waterSettled =
      this.water.pos.y >= chamber.floorY - this.water.radius - 0.5 &&
      abs(this.water.vel.y) < 0.08;
    const coffeeSettled =
      this.coffee.pos.y >= chamber.floorY - this.coffee.radius - 0.5 &&
      this.coffee.vel.mag() < 0.05;

    if ((this.resetTimer > 1.6 && waterSettled && coffeeSettled) || this.elapsed > 8) {
      this.reset();
    }
  }

  resolvePair(a, b, restitution) {
    const delta = p5.Vector.sub(b.pos, a.pos);
    const distanceSq = delta.magSq();
    const minDistance = a.radius + b.radius;
    if (distanceSq === 0 || distanceSq >= minDistance * minDistance) {
      return;
    }

    const distance = sqrt(distanceSq);
    const normal = delta.copy().div(distance);
    const overlap = minDistance - distance;
    const totalInvMass = 1 / a.mass + 1 / b.mass;

    a.pos.add(p5.Vector.mult(normal, -overlap * (1 / a.mass) / totalInvMass));
    b.pos.add(p5.Vector.mult(normal, overlap * (1 / b.mass) / totalInvMass));

    const relativeVelocity = p5.Vector.sub(b.vel, a.vel);
    const velocityAlongNormal = relativeVelocity.dot(normal);
    if (velocityAlongNormal >= 0) {
      return;
    }

    const impulseMagnitude = (-(1 + restitution) * velocityAlongNormal) / totalInvMass;
    const impulse = p5.Vector.mult(normal, impulseMagnitude);
    a.vel.sub(p5.Vector.div(impulse, a.mass));
    b.vel.add(p5.Vector.div(impulse, b.mass));

    this.collisionHappened = true;
    this.coffee.lastImpactFrame = frameCount;
  }

  render() {
    const chamber = this.chamber;

    this.renderBackdrop(chamber);
    this.renderGuides(chamber);
    this.water.render();
    this.coffee.render();
    this.renderLabels(chamber);
  }

  renderBackdrop(chamber) {
    noStroke();
    fill(24, 18, 14);
    rect(0, 0, width, height);

    fill(20, 16, 12);
    rect(chamber.x - 36, chamber.y - 24, chamber.w + 72, chamber.h + 48, 22);

    fill(12, 10, 8);
    rect(chamber.x, chamber.y, chamber.w, chamber.h, 18);
  }

  renderGuides(chamber) {
    stroke(255, 235, 210, 80);
    strokeWeight(2);
    line(chamber.x, chamber.y, chamber.x, chamber.floorY);
    line(chamber.x + chamber.w, chamber.y, chamber.x + chamber.w, chamber.floorY);
    line(chamber.x, chamber.floorY, chamber.x + chamber.w, chamber.floorY);

    stroke(120, 190, 255, 60);
    line(chamber.cx, chamber.y + 6, chamber.cx, chamber.floorY - 8);
  }

  renderLabels(chamber) {
    noStroke();
    fill(240, 224, 202);
    textSize(26);
    textAlign(CENTER, TOP);
    text("One Coffee Particle + One Water Particle", width * 0.5, height * 0.05);

    textSize(14);
    fill(210, 195, 178);
    text("click or press R to reset", width * 0.5, height * 0.095);

    textAlign(LEFT, TOP);
    textSize(15);

    const infoX = chamber.x + chamber.w + 36;
    const infoY = chamber.y + 26;
    const waterSpeed = this.water.vel.mag().toFixed(2);
    const coffeeSpeed = this.coffee.vel.mag().toFixed(2);

    fill(145, 210, 255);
    text("Water particle", infoX, infoY);
    fill(228, 216, 198);
    text(`position: (${this.water.pos.x.toFixed(1)}, ${this.water.pos.y.toFixed(1)})`, infoX, infoY + 24);
    text(`velocity: ${waterSpeed}`, infoX, infoY + 46);

    fill(148, 94, 52);
    text("Coffee particle", infoX, infoY + 96);
    fill(228, 216, 198);
    text(`position: (${this.coffee.pos.x.toFixed(1)}, ${this.coffee.pos.y.toFixed(1)})`, infoX, infoY + 120);
    text(`velocity: ${coffeeSpeed}`, infoX, infoY + 142);

    fill(228, 216, 198, 180);
    text(
      this.collisionHappened
        ? "collision: water transfers momentum to the resting coffee particle"
        : "collision: waiting for the falling water particle to arrive",
      chamber.x - 8,
      chamber.floorY + 26
    );
  }
}

class Particle {
  constructor(x, y, radius, colorValue) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.radius = radius;
    this.mass = radius * radius * 0.018;
    this.colorValue = colorValue;
  }

  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  update(dt) {
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
  }
}

class CoffeeParticle extends Particle {
  constructor(x, y, diameter) {
    super(x, y, diameter * 0.5, color(84, 46, 24));
    this.mass = this.radius * this.radius * 0.028;
    this.lastImpactFrame = -999;
  }

  keepInsideChamber(chamber) {
    if (this.pos.x < chamber.x + this.radius) {
      this.pos.x = chamber.x + this.radius;
      this.vel.x *= -0.2;
    }
    if (this.pos.x > chamber.x + chamber.w - this.radius) {
      this.pos.x = chamber.x + chamber.w - this.radius;
      this.vel.x *= -0.2;
    }
    if (this.pos.y > chamber.floorY - this.radius) {
      this.pos.y = chamber.floorY - this.radius;
      this.vel.y *= -0.16;
    }
  }

  applyGroundFriction(floorY) {
    const onFloor = this.pos.y >= floorY - this.radius - 0.5;
    if (!onFloor) {
      return;
    }
    this.vel.x *= 0.92;
    if (abs(this.vel.x) < 0.01) {
      this.vel.x = 0;
    }
    if (abs(this.vel.y) < 0.02) {
      this.vel.y = 0;
    }
  }

  render() {
    const glow = constrain(map(frameCount - this.lastImpactFrame, 0, 14, 90, 0), 0, 90);

    noStroke();
    fill(35, 20, 10, 90);
    ellipse(this.pos.x, this.pos.y + this.radius * 0.92, this.radius * 1.9, this.radius * 0.55);

    fill(this.colorValue);
    ellipse(this.pos.x, this.pos.y, this.radius * 2);

    fill(140, 102, 70, 95);
    ellipse(this.pos.x - this.radius * 0.18, this.pos.y - this.radius * 0.24, this.radius * 0.9);

    fill(255, 232, 210, glow);
    ellipse(this.pos.x, this.pos.y, this.radius * 2.2);
  }
}

class WaterParticle extends Particle {
  constructor(x, y, diameter) {
    super(x, y, diameter * 0.5, color(188, 228, 255, 210));
    this.mass = this.radius * this.radius * 0.011;
  }

  keepInsideChamber(chamber) {
    if (this.pos.x < chamber.x + this.radius) {
      this.pos.x = chamber.x + this.radius;
      this.vel.x *= -0.75;
    }
    if (this.pos.x > chamber.x + chamber.w - this.radius) {
      this.pos.x = chamber.x + chamber.w - this.radius;
      this.vel.x *= -0.75;
    }
    if (this.pos.y < chamber.y + this.radius) {
      this.pos.y = chamber.y + this.radius;
      this.vel.y *= -0.45;
    }
    if (this.pos.y > chamber.floorY - this.radius) {
      this.pos.y = chamber.floorY - this.radius;
      this.vel.y *= -0.28;
      this.vel.x *= 0.98;
      if (abs(this.vel.y) < 0.02) {
        this.vel.y = 0;
      }
    }
  }

  render() {
    noStroke();
    fill(130, 200, 255, 44);
    ellipse(this.pos.x, this.pos.y, this.radius * 4.1);

    fill(this.colorValue);
    ellipse(this.pos.x, this.pos.y, this.radius * 2);

    fill(255, 255, 255, 90);
    ellipse(this.pos.x - this.radius * 0.2, this.pos.y - this.radius * 0.24, this.radius * 0.75);
  }
}
