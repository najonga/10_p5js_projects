function setup() {
  createCanvas(windowWidth, windowHeight);
}

function draw() {
  background(220);
  fill(0, 100, 255);
  ellipse(mouseX, mouseY, 80, 80); // 마우스를 따라다니는 원
}