/* --------------------------------------------------------------------------
   Spring — physics-based motion, parameterized the way Apple's springs are:

     dampingRatio  1.0 = critically damped (no overshoot), < 1 = bouncy
     response      seconds; lower is snappier. Not a duration: settle time
                   emerges from the physics.

   Springs are interruptible by construction. Calling to() mid-flight keeps
   the current on-screen value and velocity, so a retarget never jumps and
   never hits a velocity "brick wall".
   -------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var STEP = 1 / 240; // fixed integration step (s), independent of frame rate

  var reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  function coefficients(dampingRatio, response) {
    return {
      stiffness: Math.pow(TAU / response, 2),
      damping: (4 * Math.PI * dampingRatio) / response
    };
  }

  function Spring(options) {
    var o = options || {};
    this.value = o.value || 0;
    this.target = this.value;
    this.velocity = 0;
    this.precision = o.precision || 0.01;
    this.onUpdate = o.onUpdate || function () {};
    this.onRest = o.onRest || null;
    this.configure(
      o.dampingRatio == null ? 1 : o.dampingRatio,
      o.response == null ? 0.4 : o.response
    );
    this._frame = 0;
    this._last = 0;
    this._tick = this._tick.bind(this);
  }

  Spring.prototype.configure = function (dampingRatio, response) {
    var c = coefficients(dampingRatio, response);
    this.stiffness = c.stiffness;
    this.damping = c.damping;
    return this;
  };

  /* Animate toward a new target. An optional velocity (units/s) hands off
     gesture momentum so there is no seam between dragging and animating. */
  Spring.prototype.to = function (target, velocity) {
    this.target = target;
    if (typeof velocity === 'number') this.velocity = velocity;
    if (reduceMotion.matches) return this.jump(target);
    if (!this._frame) {
      this._last = performance.now();
      this._frame = requestAnimationFrame(this._tick);
    }
    return this;
  };

  /* Set a value with no animation (first layout, resize, reduced motion). */
  Spring.prototype.jump = function (value) {
    this.stop();
    this.value = this.target = value;
    this.velocity = 0;
    this.onUpdate(value);
    return this;
  };

  Spring.prototype.stop = function () {
    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = 0;
    return this;
  };

  Spring.prototype._tick = function (now) {
    // Clamp long frames (background tabs) so the simulation never explodes.
    var dt = Math.min((now - this._last) / 1000, 0.064);
    this._last = now;

    while (dt > 0) {
      var h = Math.min(STEP, dt);
      var accel = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += accel * h; // semi-implicit Euler: stable for stiff springs
      this.value += this.velocity * h;
      dt -= h;
    }

    if (Math.abs(this.value - this.target) < this.precision &&
        Math.abs(this.velocity) < this.precision * 10) {
      this.value = this.target;
      this.velocity = 0;
      this._frame = 0;
      this.onUpdate(this.value);
      if (this.onRest) this.onRest(this.value);
      return;
    }

    this.onUpdate(this.value);
    this._frame = requestAnimationFrame(this._tick);
  };

  /* Sample the spring's 0 → 1 step response into a CSS linear() easing, so
     CSS transitions run on exactly the same physics as the JS springs. */
  Spring.toCss = function (dampingRatio, response) {
    var c = coefficients(dampingRatio, response);
    var points = [0];
    var x = 0, v = 0, t = 0;
    var h = 1 / 1000;
    var every = 1 / 60;
    var next = every;

    while (t < 3) {
      var a = -c.stiffness * (x - 1) - c.damping * v;
      v += a * h;
      x += v * h;
      t += h;
      if (t >= next) { points.push(x); next += every; }
      if (Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01) break;
    }
    points.push(1);

    return {
      easing: 'linear(' + points.map(function (p) { return +p.toFixed(4); }).join(', ') + ')',
      duration: Math.round(t * 1000)
    };
  };

  /* Publish presets as --ease-<name> / --dur-<name> custom properties. */
  Spring.installCssEasings = function (root, presets) {
    var supported = global.CSS && CSS.supports &&
      CSS.supports('transition-timing-function', 'linear(0, 1)');
    if (!supported) return; // stylesheet fallbacks stay in place

    Object.keys(presets).forEach(function (name) {
      var p = presets[name];
      var curve = Spring.toCss(p.dampingRatio, p.response);
      root.style.setProperty('--ease-' + name, curve.easing);
      root.style.setProperty('--dur-' + name, curve.duration + 'ms');
    });
  };

  Spring.reducedMotion = function () { return reduceMotion.matches; };

  global.Spring = Spring;
})(window);
