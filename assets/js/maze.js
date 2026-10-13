/* --------------------------------------------------------------------------
   Maze demo — a small web port of the a_maze_ing idea.

   1. Carve a perfect maze with an iterative depth-first search (backtracker).
   2. Run one breadth-first search from the start; the parent tree it builds
      gives the shortest path to every cell in O(path) time.
   3. Follow the pointer: the route to whatever cell you point at is redrawn
      every move, with no delay between hand and result.
   -------------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var N = 1, E = 2, S = 4, W = 8;
  var OPPOSITE = { 1: S, 2: W, 4: N, 8: E };

  var reduceMotion = global.matchMedia('(prefers-reduced-motion: reduce)');
  var darkScheme = global.matchMedia('(prefers-color-scheme: dark)');

  // Deterministic PRNG so a seed always reproduces the same maze.
  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function generate(cols, rows, rand) {
    var size = cols * rows;
    var open = new Uint8Array(size);   // bitmask of open sides per cell
    var seen = new Uint8Array(size);
    var carve = [];                    // flat [from, to, from, to, …] in carve order
    var stack = [0];
    var options = [];
    seen[0] = 1;

    while (stack.length) {
      var cell = stack[stack.length - 1];
      var x = cell % cols;
      var y = (cell - x) / cols;

      options.length = 0;
      if (y > 0 && !seen[cell - cols]) options.push(N);
      if (x < cols - 1 && !seen[cell + 1]) options.push(E);
      if (y < rows - 1 && !seen[cell + cols]) options.push(S);
      if (x > 0 && !seen[cell - 1]) options.push(W);

      if (!options.length) { stack.pop(); continue; }

      var dir = options[(rand() * options.length) | 0];
      var next = cell + (dir === N ? -cols : dir === S ? cols : dir === E ? 1 : -1);
      open[cell] |= dir;
      open[next] |= OPPOSITE[dir];
      seen[next] = 1;
      carve.push(cell, next);
      stack.push(next);
    }
    return { open: open, carve: carve };
  }

  function solve(cols, open, start) {
    var size = open.length;
    var dist = new Int32Array(size).fill(-1);
    var parent = new Int32Array(size).fill(-1);
    var order = new Int32Array(size);  // BFS visiting order (non-decreasing distance)
    var head = 0, tail = 0, max = 0;

    order[tail++] = start;
    dist[start] = 0;

    function visit(from, to, d) {
      if (dist[to] !== -1) return;
      dist[to] = d;
      parent[to] = from;
      order[tail++] = to;
      if (d > max) max = d;
    }

    while (head < tail) {
      var cell = order[head++];
      var d = dist[cell] + 1;
      var o = open[cell];
      if (o & N) visit(cell, cell - cols, d);
      if (o & E) visit(cell, cell + 1, d);
      if (o & S) visit(cell, cell + cols, d);
      if (o & W) visit(cell, cell - 1, d);
    }
    return { dist: dist, parent: parent, order: order, max: max };
  }

  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  var HEAT_BUCKETS = 14;

  function MazeDemo(root) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas'); // cached corridors + BFS heat
    this.baseCtx = this.base.getContext('2d');
    this.readout = root.querySelector('[data-maze-readout]');
    this.button = root.querySelector('[data-maze-new]');

    this.seed = (Math.random() * 4294967296) >>> 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.open = null;
    this.phase = 'idle';
    this.started = false;
    this.raf = 0;
    this.lastSteps = -1;
    this.frame = this.frame.bind(this);

    this.readColors();

    var self = this;
    this.button.addEventListener('click', function () { self.regenerate(true); });

    // Mouse and pen: the route follows the pointer continuously.
    this.canvas.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'touch') self.pointTo(e);
    });
    // Touch (and click): tap a cell to route there; scrolling stays native.
    this.canvas.addEventListener('pointerdown', function (e) { self.pointTo(e); });

    new ResizeObserver(function () { self.resize(); }).observe(this.canvas);

    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !self.started) {
        self.started = true;
        self.regenerate(true);
      }
    }, { threshold: 0.35 }).observe(root);

    darkScheme.addEventListener('change', function () {
      self.readColors();
      if (self.phase === 'ready') { self.renderBase(1, 1); self.draw(1); }
      else if (!self.open) self.paintEmpty();
    });
  }

  MazeDemo.prototype.readColors = function () {
    var cs = getComputedStyle(this.root);
    function triplet(name) {
      return cs.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
    }
    var wall = triplet('--maze-wall');
    var corridor = triplet('--maze-corridor');
    var from = triplet('--maze-heat-from');
    var to = triplet('--maze-heat-to');
    var amount = parseFloat(cs.getPropertyValue('--maze-heat-mix')) || 0.2;

    // Pre-blend heat into the corridor colour so overlapping round caps
    // never stack alpha into darker blobs at the joints.
    var heat = [];
    for (var i = 0; i < HEAT_BUCKETS; i++) {
      heat.push(rgb(mix(corridor, mix(from, to, i / (HEAT_BUCKETS - 1)), amount)));
    }

    this.colors = {
      wall: rgb(wall),
      corridor: rgb(corridor),
      heat: heat,
      path: cs.getPropertyValue('--maze-path').trim(),
      start: cs.getPropertyValue('--maze-start').trim()
    };
  };

  MazeDemo.prototype.layout = function () {
    var w = this.width, h = this.height;
    var cell = w < 480 ? 20 : 24;
    var pad = 14;
    var cols = Math.max(8, Math.floor((w - pad * 2) / cell));
    var rows = Math.max(6, Math.floor((h - pad * 2) / cell));
    var s = Math.min((w - pad * 2) / cols, (h - pad * 2) / rows);
    this.s = s;
    this.ox = (w - cols * s) / 2;
    this.oy = (h - rows * s) / 2;
    return [cols, rows];
  };

  MazeDemo.prototype.cx = function (cell) { return this.ox + ((cell % this.cols) + 0.5) * this.s; };
  MazeDemo.prototype.cy = function (cell) { return this.oy + (Math.floor(cell / this.cols) + 0.5) * this.s; };

  MazeDemo.prototype.resize = function () {
    var w = this.canvas.clientWidth;
    var h = this.canvas.clientHeight;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (!w || !h) return;
    if (w === this.width && h === this.height && dpr === this.dpr) return;

    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = this.base.width = Math.round(w * dpr);
    this.canvas.height = this.base.height = Math.round(h * dpr);

    if (!this.open) {
      // The section may have scrolled into view before the canvas had a size.
      if (this.started) this.regenerate(true);
      else this.paintEmpty();
      return;
    }

    var prevCols = this.cols, prevRows = this.rows;
    var grid = this.layout();
    if (grid[0] !== prevCols || grid[1] !== prevRows) {
      this.regenerate(false); // the grid changed shape: a new maze, without replaying the intro
    } else if (this.phase === 'ready') {
      this.renderBase(1, 1);
      this.draw(1);
    }
  };

  MazeDemo.prototype.paintEmpty = function () {
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.colors.wall;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  };

  MazeDemo.prototype.regenerate = function (animate) {
    cancelAnimationFrame(this.raf);
    if (!this.width) return;

    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    var grid = this.layout();
    this.cols = grid[0];
    this.rows = grid[1];

    var maze = generate(this.cols, this.rows, mulberry32(this.seed));
    this.open = maze.open;
    this.carve = maze.carve;
    this.start = 0;
    this.exit = this.cols * this.rows - 1;
    this.bfs = solve(this.cols, this.open, this.start);
    this.target = this.exit;
    this.lastSteps = -1;

    if (!animate || reduceMotion.matches) {
      this.phase = 'ready';
      this.renderBase(1, 1);
      this.draw(1);
      return;
    }

    // Timeline scales gently with maze size so small screens don't drag.
    var edges = this.carve.length / 2;
    this.tCarve = clamp(edges * 2.6, 900, 1700);
    this.tFlood = 650;
    this.tPath = 420;
    this.t0 = performance.now();
    this.phase = 'carving';
    this.setReadout('Carving · depth-first search');
    this.raf = requestAnimationFrame(this.frame);
  };

  MazeDemo.prototype.frame = function (now) {
    var t = now - this.t0;
    var pc = clamp(t / this.tCarve, 0, 1);
    var pf = clamp((t - this.tCarve) / this.tFlood, 0, 1);
    var pp = clamp((t - this.tCarve - this.tFlood) / this.tPath, 0, 1);

    if (pc >= 1 && this.phase === 'carving') {
      this.phase = 'solving';
      this.setReadout('Solving · breadth-first search');
    }

    this.renderBase(pc, pf);
    this.draw(easeOut(pp), pc < 1);

    if (pp < 1) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.phase = 'ready';
    }
  };

  MazeDemo.prototype.renderBase = function (carveProgress, floodProgress) {
    var ctx = this.baseCtx;
    var s = this.s;
    var c = this.colors;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c.wall;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.62;

    // Corridors, drawn as rounded strokes between cell centres.
    var edges = this.carve.length / 2;
    var shown = Math.floor(edges * carveProgress);
    ctx.strokeStyle = c.corridor;
    ctx.beginPath();
    ctx.moveTo(this.cx(0), this.cy(0));
    ctx.lineTo(this.cx(0), this.cy(0));
    for (var i = 0; i < shown; i++) {
      var a = this.carve[i * 2], b = this.carve[i * 2 + 1];
      ctx.moveTo(this.cx(a), this.cy(a));
      ctx.lineTo(this.cx(b), this.cy(b));
    }
    ctx.stroke();

    // BFS flood: reveal by distance layer, coloured by distance from start.
    if (floodProgress > 0) {
      var bfs = this.bfs;
      var limit = floodProgress * (bfs.max + 1);
      var buckets = [];
      for (var k = 0; k < HEAT_BUCKETS; k++) buckets.push([]);

      for (var j = 1; j < bfs.order.length; j++) {
        var cell = bfs.order[j];
        if (bfs.dist[cell] > limit) break;
        var bucket = Math.min(HEAT_BUCKETS - 1, Math.floor((bfs.dist[cell] / (bfs.max || 1)) * HEAT_BUCKETS));
        buckets[bucket].push(bfs.parent[cell], cell);
      }
      for (var q = 0; q < HEAT_BUCKETS; q++) {
        var list = buckets[q];
        if (!list.length) continue;
        ctx.strokeStyle = c.heat[q];
        ctx.beginPath();
        for (var m = 0; m < list.length; m += 2) {
          ctx.moveTo(this.cx(list[m]), this.cy(list[m]));
          ctx.lineTo(this.cx(list[m + 1]), this.cy(list[m + 1]));
        }
        ctx.stroke();
      }
    }

    // Carving head: shows where the depth-first search is right now.
    if (carveProgress < 1 && shown > 0) {
      var head = this.carve[shown * 2 - 1];
      ctx.fillStyle = c.path;
      ctx.beginPath();
      ctx.arc(this.cx(head), this.cy(head), s * 0.24, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  MazeDemo.prototype.pathTo = function (cell) {
    var path = [];
    var parent = this.bfs.parent;
    while (cell !== -1) { path.push(cell); cell = parent[cell]; }
    return path.reverse();
  };

  MazeDemo.prototype.draw = function (pathProgress, carving) {
    var ctx = this.ctx;
    var s = this.s;
    var c = this.colors;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (pathProgress > 0) {
      var path = this.pathTo(this.target);
      // Draw a fractional prefix so the route extends smoothly, not cell by cell.
      var span = (path.length - 1) * pathProgress;
      var whole = Math.floor(span);
      var frac = span - whole;

      ctx.strokeStyle = c.path;
      ctx.lineWidth = s * 0.26;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(this.cx(path[0]), this.cy(path[0]));
      for (var i = 1; i <= whole; i++) ctx.lineTo(this.cx(path[i]), this.cy(path[i]));
      if (whole < path.length - 1 && frac > 0) {
        var a = path[whole], b = path[whole + 1];
        ctx.lineTo(
          this.cx(a) + (this.cx(b) - this.cx(a)) * frac,
          this.cy(a) + (this.cy(b) - this.cy(a)) * frac
        );
      }
      ctx.stroke();

      if (pathProgress >= 1) {
        var tx = this.cx(this.target), ty = this.cy(this.target);
        ctx.fillStyle = c.path;
        ctx.beginPath();
        ctx.arc(tx, ty, s * 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = s * 0.08;
        ctx.beginPath();
        ctx.arc(tx, ty, s * 0.36, 0, Math.PI * 2);
        ctx.stroke();

        var steps = path.length - 1;
        if (steps !== this.lastSteps) {
          this.lastSteps = steps;
          this.setReadout('Shortest path · ' + steps + (steps === 1 ? ' step' : ' steps'));
        }
      }
    }

    // Start marker, drawn last so it sits above the route.
    if (!carving) {
      ctx.fillStyle = c.start;
      ctx.beginPath();
      ctx.arc(this.cx(this.start), this.cy(this.start), s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  MazeDemo.prototype.pointTo = function (e) {
    if (this.phase !== 'ready') return;
    var rect = this.canvas.getBoundingClientRect();
    var x = clamp(Math.floor((e.clientX - rect.left - this.ox) / this.s), 0, this.cols - 1);
    var y = clamp(Math.floor((e.clientY - rect.top - this.oy) / this.s), 0, this.rows - 1);
    var cell = y * this.cols + x;
    if (cell === this.target) return;
    this.target = cell;
    this.draw(1);
  };

  MazeDemo.prototype.setReadout = function (text) {
    if (this.readout && this.readout.textContent !== text) this.readout.textContent = text;
  };

  global.MazeDemo = MazeDemo;
})(window);
