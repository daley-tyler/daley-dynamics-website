import { sceneVertex, sceneFragment, screenVertex, glassFragment } from './scene-shaders.js';

export const QUALITY = {
  full: { pixelRatio: 1.25, plants: 6, dispersion: true, amplitude: 1 },
  standard: { pixelRatio: 1, plants: 4, dispersion: false, amplitude: 0.85 },
  lightweight: { pixelRatio: 0.85, plants: 3, dispersion: false, amplitude: 0.7 },
  reduced: { pixelRatio: 1, plants: 3, dispersion: false, amplitude: 0 },
};

// Each frond is an independently deforming mesh with a root below/in the scene.
// x and bottom are viewport fractions; height is relative to viewport height.
const FOLIAGE = [
  { x: 0.61, bottom: 1.08, height: 0.72, phase: 1.2, angle: -0.26, mirror: 0, light: 0.84 },
  { x: 0.77, bottom: 1.13, height: 0.88, phase: 3.9, angle: 0.22, mirror: 1, light: 0.95 },
  { x: 0.97, bottom: 1.14, height: 1.04, phase: 5.6, angle: -0.12, mirror: 1, light: 1.04 },
  { x: 0.84, bottom: 0.96, height: 0.6, phase: 2.8, angle: -0.45, mirror: 0, light: 0.9 },
  { x: 0.57, bottom: 1.12, height: 0.45, phase: 7.4, angle: -0.4, mirror: 0, light: 1.08 },
  { x: 1.04, bottom: 1.06, height: 0.62, phase: 9.1, angle: 0.5, mirror: 1, light: 0.93 },
];

function imageFrom(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('scene-asset-unavailable'));
    img.src = url;
  });
}

function program(gl, vertex, fragment) {
  const shaders = [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(reason);
    }
    return shader;
  });
  const linked = gl.createProgram();
  shaders.forEach((shader) => gl.attachShader(linked, shader));
  gl.linkProgram(linked);
  shaders.forEach((shader) => gl.deleteShader(shader));
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(linked));
  const uniforms = new Map();
  return {
    use() {
      gl.useProgram(linked);
    },
    location(name) {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(linked, name));
      return uniforms.get(name);
    },
    position: gl.getAttribLocation(linked, 'a_position'),
    dispose() {
      gl.deleteProgram(linked);
    },
  };
}

function texture(gl, image) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return tex;
}

function mesh(gl, columns, rows) {
  const vertices = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        vertices.push((x + dx) / columns, (y + dy) / rows);
      }
    }
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return {
    draw(shader) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(shader.position);
      gl.vertexAttribPointer(shader.position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
    },
    dispose() {
      gl.deleteBuffer(buffer);
    },
  };
}

export async function startLiveScene() {
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  // Documented local QA switches: never required by the visitor journey.
  if (params.get('effects') === 'off') {
    root.dataset.scene = 'fallback';
    return () => {};
  }
  const environment = document.querySelector('.environment');
  const canvas = document.createElement('canvas');
  canvas.className = 'scene-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    root.dataset.scene = 'fallback';
    return () => {};
  }

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = matchMedia('(pointer: fine)');
  const isReduced = () => motion.matches || params.get('motion') === 'reduce';
  let stopped = false;
  let frame = 0;
  let lastTime = 0;
  let clock = 0;
  let frames = 0;
  let measuredMs = 0;
  let measurementStart = performance.now();
  let slowWindows = 0;
  let degraded = false;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let tier;
  const resources = [];
  const abort = new AbortController();

  function fallback(reason) {
    stopped = true;
    cancelAnimationFrame(frame);
    abort.abort();
    root.dataset.scene = 'fallback';
    root.dataset.sceneReason = reason;
    canvas.remove();
    resources.forEach((dispose) => dispose());
  }

  try {
    const [backdrop, fern] = await Promise.all([
      imageFrom('/assets/nature-hero.jpg'),
      imageFrom('/assets/fern-frond.webp'),
    ]);
    const scene = program(gl, sceneVertex, sceneFragment);
    const glass = program(gl, screenVertex, glassFragment);
    const quad = mesh(gl, 1, 1);
    const plantMesh = mesh(gl, 18, 28);
    const backdropTexture = texture(gl, backdrop);
    const fernTexture = texture(gl, fern);
    const sceneTexture = texture(gl);
    const framebuffer = gl.createFramebuffer();
    resources.push(() => {
      [scene, glass, quad, plantMesh].forEach((item) => item.dispose());
      [backdropTexture, fernTexture, sceneTexture].forEach((tex) => gl.deleteTexture(tex));
      gl.deleteFramebuffer(framebuffer);
    });
    let surfaces = [];
    function collectSurfaces() {
      // Later sections opt in with the same data-glass attribute; DOM remains semantic.
      surfaces = [...document.querySelectorAll('[data-glass]')].map((element) => {
        const css = getComputedStyle(element);
        const number = (name) => parseFloat(css.getPropertyValue(name)) || 0;
        return {
          element,
          radii: [
            'borderTopLeftRadius',
            'borderTopRightRadius',
            'borderBottomRightRadius',
            'borderBottomLeftRadius',
          ].map((name) => css[name].split(' ')),
          optics: [
            number('--glass-refraction'),
            number('--glass-edge-width'),
            number('--glass-chromatic'),
            number('--glass-reflection-strength'),
          ],
          pointer: [-1, -1],
          target: [-1, -1],
        };
      });
    }

    function resize() {
      width = innerWidth;
      height = innerHeight;
      const name = isReduced()
        ? 'reduced'
        : width < 600 || degraded
          ? 'lightweight'
          : width < 1200
            ? 'standard'
            : 'full';
      tier = QUALITY[name];
      root.dataset.quality = name;
      ratio = Math.min(devicePixelRatio || 1, tier.pixelRatio);
      // Bound GPU memory even on very large screens.
      ratio = Math.min(ratio, Math.sqrt(3200000 / (width * height)));
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        canvas.width,
        canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTexture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('scene-buffer-unavailable');
      collectSurfaces();
    }

    function drawImage(tex, rect, crop, wind, opacity = 1, illumination = 1, mirror = 0) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform4fv(scene.location('u_rect'), rect);
      gl.uniform4fv(scene.location('u_crop'), crop);
      gl.uniform4fv(scene.location('u_wind'), wind);
      gl.uniform2f(scene.location('u_finish'), opacity, illumination);
      gl.uniform1f(scene.location('u_mirror'), mirror);
      (wind[0] ? plantMesh : quad).draw(scene);
    }

    function render(now) {
      if (stopped || document.hidden) return;
      const begin = performance.now();
      const elapsed = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;
      if (!isReduced()) clock += elapsed / 1000;
      gl.viewport(0, 0, canvas.width, canvas.height);
      // Reset raster state before repainting both targets, including after resize/resume.
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.disable(gl.BLEND);
      scene.use();
      gl.uniform2f(scene.location('u_view'), width, height);
      gl.uniform1i(scene.location('u_image'), 0);
      const cover = Math.max(width / backdrop.width, height / backdrop.height);
      const cropX = width / (backdrop.width * cover);
      const cropY = height / (backdrop.height * cover);
      drawImage(
        backdropTexture,
        [0, 0, width, height],
        [(1 - cropX) / 2, (1 - cropY) / 2, cropX, cropY],
        [0, 0, 0, 0],
      );
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      FOLIAGE.slice(0, tier.plants).forEach((plant) => {
        const h = Math.min(height * plant.height, 1100);
        const w = (h * fern.width) / fern.height;
        // Foreground alone has small scroll depth; background photograph never moves.
        const depth = isReduced() ? 0 : Math.min(scrollY, height) * 0.025;
        drawImage(
          fernTexture,
          [width * plant.x - w * 0.5, height * plant.bottom - h - depth, w, h],
          [0, 0, 1, 1],
          [h * 0.019 * tier.amplitude, plant.phase, clock, plant.angle],
          0.82,
          plant.light,
          plant.mirror,
        );
      });
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      glass.use();
      gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
      gl.uniform1i(glass.location('u_scene'), 0);
      gl.uniform2f(glass.location('u_view'), width, height);
      gl.uniform1f(glass.location('u_surface'), 0);
      quad.draw(glass);
      gl.uniform1f(glass.location('u_surface'), 1);
      gl.enable(gl.SCISSOR_TEST);
      const paintedSurfaces = [];
      // Paint broad surfaces first, compact controls last when they overlap.
      [...surfaces]
        .sort(
          (a, b) =>
            Number(a.element.dataset.glass === 'compact') -
            Number(b.element.dataset.glass === 'compact'),
        )
        .forEach((surface) => {
          const rect = surface.element.getBoundingClientRect();
          if (
            rect.bottom < 0 ||
            rect.top > height ||
            rect.width === 0 ||
            rect.height === 0 ||
            rect.right <= 0 ||
            rect.left >= width ||
            !surface.element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
          )
            return;
          paintedSurfaces.push(surface.element.dataset.glass);
          const rx = [],
            ry = [];
          surface.radii.forEach(([x, y = x]) => {
            rx.push(x.endsWith('%') ? (parseFloat(x) * rect.width) / 100 : parseFloat(x));
            ry.push(y.endsWith('%') ? (parseFloat(y) * rect.height) / 100 : parseFloat(y));
          });
          // CSS scales all corner radii together when their sums exceed an edge.
          const scale = Math.min(
            1,
            rect.width / (rx[0] + rx[1]),
            rect.width / (rx[3] + rx[2]),
            rect.height / (ry[0] + ry[3]),
            rect.height / (ry[1] + ry[2]),
          );
          gl.uniform4fv(
            glass.location('u_radiiX'),
            rx.map((n) => n * scale),
          );
          gl.uniform4fv(
            glass.location('u_radiiY'),
            ry.map((n) => n * scale),
          );
          gl.uniform4f(glass.location('u_rect'), rect.x, rect.y, rect.width, rect.height);
          const optics = [...surface.optics];
          if (!tier.dispersion) optics[2] = 0;
          gl.uniform4fv(glass.location('u_optics'), optics);
          if (isReduced()) surface.pointer = [-1, -1];
          else surface.pointer = surface.pointer.map((n, i) => n + (surface.target[i] - n) * 0.12);
          gl.uniform2fv(glass.location('u_pointer'), surface.pointer);
          // Intersect both edges: a partially offscreen surface must not extend its clip.
          const x = Math.max(0, Math.floor(rect.left * ratio));
          const y = Math.max(0, Math.floor((height - rect.bottom) * ratio));
          const right = Math.min(canvas.width, Math.ceil(rect.right * ratio));
          const top = Math.min(canvas.height, Math.ceil((height - rect.top) * ratio));
          gl.scissor(x, y, Math.max(0, right - x), Math.max(0, top - y));
          quad.draw(glass);
        });
      gl.disable(gl.SCISSOR_TEST);
      if (params.has('inspect')) canvas.dataset.paintedSurfaces = paintedSurfaces.join(',');
      root.dataset.scene = 'live';
      if (isReduced()) {
        canvas.dataset.sceneTime = clock.toFixed(3);
        canvas.dataset.staticRenders = String(Number(canvas.dataset.staticRenders || 0) + 1);
      }
      frames++;
      measuredMs += performance.now() - begin;
      if (now - measurementStart > 2000) {
        const fps = (frames * 1000) / (now - measurementStart);
        canvas.dataset.fps = fps.toFixed(1);
        canvas.dataset.cpuMs = (measuredMs / frames).toFixed(2);
        canvas.dataset.sceneTime = clock.toFixed(3);
        canvas.dataset.surfaces = String(surfaces.length);
        if (!isReduced() && fps < 42) slowWindows++;
        else slowWindows = 0;
        if (slowWindows >= 3 && !degraded) {
          degraded = true;
          resize();
        }
        frames = 0;
        measuredMs = 0;
        measurementStart = now;
      }
      frame = isReduced() ? 0 : requestAnimationFrame(renderSafely);
    }

    function renderSafely(now) {
      try {
        render(now);
      } catch {
        fallback('render-failed');
      }
    }
    function requestRender() {
      if (!frame && !stopped)
        frame = requestAnimationFrame((now) => {
          frame = 0;
          renderSafely(now);
        });
    }
    resize();
    environment.append(canvas);
    renderSafely(performance.now());
    const options = { signal: abort.signal, passive: true };
    window.addEventListener(
      'resize',
      () => {
        try {
          resize();
          requestRender();
        } catch {
          fallback('resize-failed');
        }
      },
      options,
    );
    window.addEventListener('scroll', requestRender, options);
    // A closed mobile menu still has layout boxes. Refresh the static reduced-motion
    // canvas when it opens/closes so its compact CTA cannot leave a detached glass bar.
    const menu = document.querySelector('[data-nav-links]');
    const menuObserver = new MutationObserver(requestRender);
    if (menu) menuObserver.observe(menu, { attributes: true, attributeFilter: ['data-open'] });
    resources.push(() => menuObserver.disconnect());
    menu?.addEventListener('transitionend', requestRender, options);
    document.addEventListener(
      'pointermove',
      (event) => {
        if (isReduced() || !pointer.matches) return;
        surfaces.forEach((surface) => {
          const r = surface.element.getBoundingClientRect();
          const inside =
            event.clientX >= r.left &&
            event.clientX <= r.right &&
            event.clientY >= r.top &&
            event.clientY <= r.bottom;
          surface.target = inside
            ? [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height]
            : [-1, -1];
        });
      },
      options,
    );
    document.addEventListener(
      'focusin',
      (event) => {
        surfaces.forEach((surface) => {
          surface.target = surface.element.contains(event.target) ? [0.4, 0.3] : [-1, -1];
        });
        requestRender();
      },
      options,
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
        frames = 0;
        measuredMs = 0;
        measurementStart = performance.now();
        if (!document.hidden) requestRender();
      },
      options,
    );
    motion.addEventListener(
      'change',
      () => {
        cancelAnimationFrame(frame);
        frame = 0;
        resize();
        requestRender();
      },
      options,
    );
    canvas.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        fallback('context-lost');
      },
      { signal: abort.signal },
    );
    document.fonts.ready.then(() => {
      if (!stopped) {
        collectSurfaces();
        requestRender();
      }
    });
    return () => fallback('disposed');
  } catch (error) {
    fallback(`initialization-failed: ${error.message}`);
    return () => {};
  }
}
