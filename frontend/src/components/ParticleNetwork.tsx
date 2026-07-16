// Particle network animation — port dependency-free (sem jQuery) do canvas
// particle network (inspiração: JulianLaval/canvas-particle-network).
import { useEffect, useRef } from "react";

const OPTIONS = {
  velocity: 1,
  density: 15000,
  netLineDistance: 200,
  netLineColor: "#929292",
  particleColors: ["#aaa"],
};

export function ParticleNetwork() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    container.appendChild(canvas);

    let particles: Particle[] = [];
    let interaction: Particle | null = null;
    let raf = 0;
    let createInterval: ReturnType<typeof setInterval> | undefined;

    const rnd = (min: number, max: number) => Math.random() * (max - min) + min;

    class Particle {
      x: number;
      y: number;
      radius = rnd(1.5, 2.5);
      opacity = 0;
      color = OPTIONS.particleColors[Math.floor(Math.random() * OPTIONS.particleColors.length)];
      velocity = { x: (Math.random() - 0.5) * OPTIONS.velocity, y: (Math.random() - 0.5) * OPTIONS.velocity };
      constructor(x?: number, y?: number) {
        this.x = x ?? Math.random() * canvas.width;
        this.y = y ?? Math.random() * canvas.height;
      }
      update() {
        this.opacity = Math.min(this.opacity + 0.01, 1);
        if (this.x > canvas.width + 100 || this.x < -100) this.velocity.x = -this.velocity.x;
        if (this.y > canvas.height + 100 || this.y < -100) this.velocity.y = -this.velocity.y;
        this.x += this.velocity.x;
        this.y += this.velocity.y;
      }
      draw() {
        ctx!.beginPath();
        ctx!.fillStyle = this.color;
        ctx!.globalAlpha = this.opacity;
        ctx!.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
        ctx!.fill();
      }
    }

    function sizeCanvas() {
      canvas.width = container!.offsetWidth;
      canvas.height = container!.offsetHeight;
    }

    function createParticles(initial = false) {
      particles = [];
      const quantity = (canvas.width * canvas.height) / OPTIONS.density;
      if (initial) {
        let counter = 0;
        clearInterval(createInterval);
        createInterval = setInterval(() => {
          if (counter < quantity - 1) particles.push(new Particle());
          else clearInterval(createInterval);
          counter++;
        }, 250);
      } else {
        for (let i = 0; i < quantity; i++) particles.push(new Particle());
      }
    }

    function update() {
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      ctx!.globalAlpha = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = particles.length - 1; j > i; j--) {
          const p1 = particles[i];
          const p2 = particles[j];
          let d = Math.min(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y));
          if (d > OPTIONS.netLineDistance) continue;
          d = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
          if (d > OPTIONS.netLineDistance) continue;
          ctx!.beginPath();
          ctx!.strokeStyle = OPTIONS.netLineColor;
          ctx!.globalAlpha = ((OPTIONS.netLineDistance - d) / OPTIONS.netLineDistance) * p1.opacity * p2.opacity;
          ctx!.lineWidth = 0.7;
          ctx!.moveTo(p1.x, p1.y);
          ctx!.lineTo(p2.x, p2.y);
          ctx!.stroke();
        }
      }
      for (const p of particles) {
        p.update();
        p.draw();
      }
      raf = requestAnimationFrame(update);
    }

    function onMouseMove(e: MouseEvent) {
      if (!interaction) {
        interaction = new Particle(e.offsetX, e.offsetY);
        interaction.velocity = { x: 0, y: 0 };
        particles.push(interaction);
      }
      interaction.x = e.offsetX;
      interaction.y = e.offsetY;
    }
    function onMouseOut() {
      if (interaction) {
        const i = particles.indexOf(interaction);
        if (i > -1) particles.splice(i, 1);
        interaction = null;
      }
    }
    function onMouseDown(e: MouseEvent) {
      for (let i = 0; i < 3; i++) particles.push(new Particle(e.offsetX, e.offsetY));
    }
    function onResize() {
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      sizeCanvas();
      createParticles();
    }

    sizeCanvas();
    createParticles(true);
    raf = requestAnimationFrame(update);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseout", onMouseOut);
    canvas.addEventListener("mousedown", onMouseDown);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(createInterval);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseout", onMouseOut);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.remove();
    };
  }, []);

  return (
    <div ref={containerRef} className="particle-network-animation">
      <div className="glow glow-1" />
      <div className="glow glow-2" />
      <div className="glow glow-3" />
    </div>
  );
}
