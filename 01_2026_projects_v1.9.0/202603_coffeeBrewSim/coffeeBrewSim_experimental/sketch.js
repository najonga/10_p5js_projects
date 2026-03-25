const ASPECT = 16 / 9;

let sim;

// p5.js starts here: create the canvas and initialize the physics demo.
function setup() {
  const dims = getCanvasSize();
  createCanvas(dims.w, dims.h);
  pixelDensity(1);
  sim = new SingleParticleBrewSim();
}

// Runs every frame: clear the screen, advance physics, then draw the result.
function draw() {
  background(255); // #F5F5F5 background color.
  sim.update();
  sim.render();
}

// Keep click-to-restart so the collision can be replayed at any time.
function mousePressed() {
  sim.reset();
}

// When the window size changes, rebuild the canvas and reset object positions.
function windowResized() {
  const dims = getCanvasSize();
  resizeCanvas(dims.w, dims.h);
  sim.reset();
}

// Keep the canvas in a fixed 16:9 ratio regardless of browser size.
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

// Controls the whole minimal demo: one falling water particle and one resting particle.
class SingleParticleBrewSim {
  constructor() {
    // Main gravity strength. Increase to make both objects fall faster.
    this.gravity = createVector(0, 0.1);

    // Change only this value if you want the floor line itself to move up or down.
    this.floorYRatio = 0.84;

    // Change only this value if you want the coffee particle to start higher or lower.
    // This is independent from the floor line position.
    this.coffeeStartOffset = 22;

    // Change only this value if you want the falling particle to start higher or lower.
    this.waterStartOffset = 42;

    this.reset();
  }

  // Defines the simple vertical chamber where the particles are simulated.
  get chamber() {
    const w = min(width * 0.4, 360); // Change chamber width here.
    const topY = height * 0.12; // Top offset of the chamber.
    const floorY = height * this.floorYRatio; // Floor line position.
    const h = floorY - topY; // Chamber height is derived from top and floor.
    return {
      x: width * 0.5 - w * 0.5,
      y: topY,
      w,
      h,
      cx: width * 0.5,
      floorY
    };
  }

  // Reset both objects to their starting positions.
  reset() {
    const chamber = this.chamber;
    const coffeeStartY = chamber.floorY - this.coffeeStartOffset;
    const waterStartY = chamber.y + this.waterStartOffset;

    this.coffee = new CoffeeParticle(
      chamber.cx,
      coffeeStartY, // Coffee start height. Change coffeeStartOffset above to adjust only this.
      44 // Resting object diameter.
    );
    this.water = new WaterParticle(
      chamber.cx,
      waterStartY, // Water start height. Change waterStartOffset above to adjust only this.
      12 // Falling object diameter.
    );
  }

  // Apply forces, advance both particles, resolve collision, then clamp to bounds.
  update() {
    const dt = min(deltaTime / 1000, 1 / 30);
    const chamber = this.chamber;

    this.water.applyForce(p5.Vector.mult(this.gravity, this.water.mass));
    this.coffee.applyForce(p5.Vector.mult(this.gravity, this.coffee.mass));

    // Velocity damping. More negative means stronger air resistance / drag.
    this.water.applyForce(p5.Vector.mult(this.water.vel, -0.012)); // Falling object drag.
    this.coffee.applyForce(p5.Vector.mult(this.coffee.vel, -0.085)); // Resting object drag.

    this.water.update(dt);
    this.coffee.update(dt);

    this.resolvePair(this.water, this.coffee, 0.36); // Collision bounciness (restitution).

    this.water.keepInsideChamber(chamber);
    this.coffee.keepInsideChamber(chamber);
    this.coffee.applyGroundFriction(chamber.floorY);
  }

  // Resolves overlap and applies a 1D collision impulse along the contact normal.
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
  }

  // Draw only the floor line and the two particles.
  render() {
    const chamber = this.chamber;
    this.renderBounds(chamber);
    this.water.render();
    this.coffee.render();
  }

  // Visual reference for the floor that the particles collide with.
  renderBounds(chamber) {
    stroke(0); // #000000
    strokeWeight(2); // Floor line thickness.
    line(chamber.x, chamber.floorY, chamber.x + chamber.w, chamber.floorY);
  }
}

// Shared base particle: position, velocity, acceleration, mass, and color.
class Particle {
  constructor(x, y, radius, colorValue) {
    this.pos = createVector(x, y);
    this.vel = createVector(0, 0);
    this.acc = createVector(0, 0);
    this.radius = radius;
    this.mass = radius * radius * 0.018; // Default mass formula.
    this.colorValue = colorValue;
  }

  // Convert a force into acceleration using F = m * a.
  applyForce(force) {
    this.acc.add(p5.Vector.div(force, this.mass));
  }

  // Integrate acceleration into velocity and velocity into position.
  update(dt) {
    this.vel.add(p5.Vector.mult(this.acc, dt * 60));
    this.pos.add(p5.Vector.mult(this.vel, dt * 60));
    this.acc.mult(0);
  }
}

// The lower object that starts at rest and gets hit by the falling particle.
class CoffeeParticle extends Particle {
  constructor(x, y, diameter) {
    super(x, y, diameter * 0.5, color(84, 46, 24)); // #542E18
    this.mass = this.radius * this.radius * 0.028; // Heavier mass multiplier.
  }

  // Prevent the resting particle from leaving the chamber horizontally or below the floor.
  keepInsideChamber(chamber) {
    if (this.pos.x < chamber.x + this.radius) {
      this.pos.x = chamber.x + this.radius;
      this.vel.x *= -0.2; // Side wall bounce for the resting particle.
    }
    if (this.pos.x > chamber.x + chamber.w - this.radius) {
      this.pos.x = chamber.x + chamber.w - this.radius;
      this.vel.x *= -0.2; // Side wall bounce for the resting particle.
    }
    if (this.pos.y > chamber.floorY - this.radius) {
      this.pos.y = chamber.floorY - this.radius;
      this.vel.y *= -0.16; // Floor bounce for the resting particle.
    }
  }

  // Extra floor friction so the resting particle eventually stops sliding.
  applyGroundFriction(floorY) {
    const onFloor = this.pos.y >= floorY - this.radius - 0.5;
    if (!onFloor) {
      return;
    }
    this.vel.x *= 0.92; // Horizontal floor friction.
    if (abs(this.vel.x) < 0.01) {
      this.vel.x = 0; // Horizontal stop threshold.
    }
    if (abs(this.vel.y) < 0.02) {
      this.vel.y = 0; // Vertical stop threshold.
    }
  }

  // Draw the resting particle as a simple solid circle.
  render() {
    noStroke();
    fill(this.colorValue);
    ellipse(this.pos.x, this.pos.y, this.radius * 2);
  }
}

// The upper object that falls first and transfers momentum during collision.
class WaterParticle extends Particle {
  constructor(x, y, diameter) {
    super(x, y, diameter * 0.5, color(0, 47, 255, 210)); // #002fff, alpha 210
    this.mass = this.radius * this.radius * 0.02; // Mass multiplier for the falling particle.
  }

  // Keep the falling particle inside the chamber and bounce it off walls/floor.
  keepInsideChamber(chamber) {
    if (this.pos.x < chamber.x + this.radius) {
      this.pos.x = chamber.x + this.radius;
      this.vel.x *= -0.75; // Side wall bounce for the falling particle.
    }
    if (this.pos.x > chamber.x + chamber.w - this.radius) {
      this.pos.x = chamber.x + chamber.w - this.radius;
      this.vel.x *= -0.75; // Side wall bounce for the falling particle.
    }
    if (this.pos.y < chamber.y + this.radius) {
      this.pos.y = chamber.y + this.radius;
      this.vel.y *= -0.45; // Ceiling bounce.
    }
    if (this.pos.y > chamber.floorY - this.radius) {
      this.pos.y = chamber.floorY - this.radius;
      this.vel.y *= -0.28; // Floor bounce for the falling particle.
      this.vel.x *= 0.98; // Small floor friction after landing.
      if (abs(this.vel.y) < 0.02) {
        this.vel.y = 0; // Vertical stop threshold.
      }
    }
  }

  // Draw the falling particle as a simple solid circle.
  render() {
    noStroke();
    fill(this.colorValue);
    ellipse(this.pos.x, this.pos.y, this.radius * 2);
  }
}
