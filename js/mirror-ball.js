/* A faceted sphere with rotating longitude, not a rotating flat picture. */
(function () {
  window.addEventListener('DOMContentLoaded', () => {
    const balls = Array.from(document.querySelectorAll('.stage-mirror-ball img, .judge-mirror-ball img')).map(image => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true'); canvas.className = 'mirror-sphere';
      image.replaceWith(canvas); return canvas;
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const rows = 11, columns = 20;
    let previous = 0;
    function draw(canvas, angle) {
      const size = canvas.getBoundingClientRect();
      if (!size.width || !size.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(size.width * ratio), height = Math.round(size.height * ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const radius = Math.min(width * .43, height * .37), cx = width / 2, cy = height * .59;
      // The cable and spindle stay still while the ball turns beneath them.
      ctx.strokeStyle = '#adb6c9'; ctx.lineWidth = Math.max(1, ratio * .7);
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, cy - radius); ctx.stroke();
      ctx.fillStyle = '#b7becb'; ctx.fillRect(cx - radius * .11, cy - radius - ratio * 2, radius * .22, ratio * 3);
      // A fixed circular boundary prevents rotating polygon edges from wobbling.
      ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2);
      ctx.fillStyle='#949eaf'; ctx.fill(); ctx.clip();
      const vertex = (row, column) => {
        const latitude = -Math.PI / 2 + row / rows * Math.PI;
        const longitude = column / columns * Math.PI * 2 + angle;
        const x = Math.cos(latitude) * Math.sin(longitude), y = Math.sin(latitude), z = Math.cos(latitude) * Math.cos(longitude);
        return {x:cx + x * radius * 1.025, y:cy - y * radius * 1.025, z, nx:x, ny:y};
      };
      const faces = [];
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        const points = [vertex(row,col),vertex(row,col+1),vertex(row+1,col+1),vertex(row+1,col)];
        const z = points.reduce((sum,p) => sum + p.z,0) / 4;
        if (z < -.05) continue;
        faces.push({points,z,row,col});
      }
      faces.sort((a,b) => a.z - b.z);
      const glints = [];
      let reflectedLight = 0;
      for (const face of faces) {
        const x = face.points.reduce((sum,p) => sum + p.nx,0) / 4;
        const y = face.points.reduce((sum,p) => sum + p.ny,0) / 4;
        const light = Math.max(0, -x * .4 + y * .5 + face.z * .7);
        const pattern = (face.row * 37 + face.col * 19) % 11;
        const base = 85 + pattern * 7 + light * 75;
        const length = Math.hypot(x,y,face.z) || 1;
        const alignment = Math.max(0, (-x * .3 + y * .4 + face.z * .866) / length);
        const reflection = Math.pow(alignment, 40);
        const highlight = reflection * 140;
        reflectedLight = Math.max(reflectedLight, reflection);
        if (reflection > .38) glints.push({
          x:face.points.reduce((sum,p) => sum+p.x,0)/4,
          y:face.points.reduce((sum,p) => sum+p.y,0)/4,
          strength:reflection
        });
        const tint = pattern % 4;
        const r = Math.min(255, base + highlight + (tint === 1 ? 15 : 0));
        const g = Math.min(255, base + highlight + 2);
        const b = Math.min(255, base + highlight + (tint === 2 ? 25 : 9));
        ctx.beginPath(); face.points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath();
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
        ctx.strokeStyle = '#39435260'; ctx.lineWidth = ratio * .35; ctx.stroke();
      }
      // Highlights belong to the moving facets, so their position follows the rotation.
      glints.forEach(glint => {
        const size = radius * (.06 + glint.strength * .07);
        const glow = ctx.createRadialGradient(glint.x,glint.y,0,glint.x,glint.y,size*2);
        glow.addColorStop(0,`rgba(255,255,255,${glint.strength*.85})`);
        glow.addColorStop(1,'rgba(220,235,255,0)');
        ctx.fillStyle=glow;ctx.fillRect(glint.x-size*2,glint.y-size*2,size*4,size*4);
        ctx.strokeStyle=`rgba(255,255,255,${glint.strength*.8})`;ctx.lineWidth=ratio*.6;
        ctx.beginPath();ctx.moveTo(glint.x-size,glint.y);ctx.lineTo(glint.x+size,glint.y);
        ctx.moveTo(glint.x,glint.y-size);ctx.lineTo(glint.x,glint.y+size);ctx.stroke();
      });
      ctx.restore();
      const holder = canvas.parentElement;
      holder.style.setProperty('--reflection-angle', (angle * 180 / Math.PI) + 'deg');
      holder.style.setProperty('--reflection-x', (Math.sin(angle) * 8) + 'px');
      holder.style.setProperty('--reflection-y', (Math.cos(angle * 2) * 4) + 'px');
      holder.style.setProperty('--reflection-light', String(.2 + reflectedLight * .5));
    }
    function frame(now) {
      if (!document.hidden && now - previous > 15) {
        previous = now;
        balls.forEach(canvas => {
          if (canvas.getClientRects().length) draw(canvas, reduced.matches ? .4 : now / 6500);
        });
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
})();
