import * as THREE from "three";

export type NeuralGeometry = {
  points: THREE.BufferGeometry;
  lines: THREE.BufferGeometry;
  nodeCount: number;
  dispose: () => void;
};

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A seeded branching graph inside a sphere. Both buffers share node positions and phases. */
export function createNeuralGeometry(profile: "low" | "balanced" | "high"): NeuralGeometry {
  const rng = random(0x524f4f48);
  const branchCount = profile === "high" ? 220 : profile === "balanced" ? 135 : 68;
  const webCount = profile === "high" ? 1700 : profile === "balanced" ? 1050 : 540;
  const nodes: THREE.Vector3[] = [];
  const phases: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const connections: Array<[number, number]> = [];
  const adjacency: number[][] = [];
  const cyan = new THREE.Color("#55e9ff");
  const gold = new THREE.Color("#ffc986");
  const addNode = (p: THREE.Vector3, color: number, size: number) => {
    const index = nodes.length;
    nodes.push(p);
    phases.push(rng());
    colors.push(color);
    sizes.push(size);
    adjacency.push([]);
    return index;
  };
  const join = (a: number, b: number) => {
    connections.push([a, b]);
    adjacency[a].push(b);
    adjacency[b].push(a);
  };

  const root = addNode(new THREE.Vector3(0, -.18, 0), 1, 2.8);
  const trunks: number[] = [];
  for (let arm = 0; arm < 9; arm++) {
    const theta = arm * Math.PI * 2 / 9 + .18;
    let parent = root;
    for (let step = 1; step <= 11; step++) {
      const t = step / 11;
      const p = new THREE.Vector3(
        Math.cos(theta + t * .52) * (.12 + 1.18 * t),
        -.18 + Math.sin(theta * 1.8) * .2 + (t - .3) * 1.1,
        Math.sin(theta + t * .52) * (.1 + .9 * t),
      );
      p.clampLength(0, 1.42);
      const index = addNode(p, arm % 3 === 0 ? 0 : 1, 2.2 - t * .5);
      join(parent, index);
      if (step >= 3) trunks.push(index);
      parent = index;
    }
  }

  for (let branch = 0; branch < branchCount; branch++) {
    const origin = trunks[Math.floor(rng() * trunks.length)];
    const start = nodes[origin];
    const direction = new THREE.Vector3(rng() - .5, rng() - .5, rng() - .5).normalize();
    const length = 4 + Math.floor(rng() * 9);
    let parent = origin;
    for (let step = 1; step <= length; step++) {
      const t = step / length;
      const p = start.clone().addScaledVector(direction, t * (.48 + rng() * .35));
      p.x += Math.sin(t * 5 + branch) * .045;
      p.y += Math.cos(t * 4 + branch) * .045;
      p.clampLength(0, 1.47);
      const index = addNode(p, branch % 4 === 0 ? 0 : 1, 1.6 - t * .6);
      join(parent, index);
      parent = index;
    }
  }

  // A membrane of short paths encloses the inner branches without making a wire globe.
  const surface: number[] = [];
  for (let i = 0; i < webCount; i++) {
    const y = 1 - 2 * (i + .5) / webCount;
    const a = i * Math.PI * (3 - Math.sqrt(5));
    const r = Math.sqrt(1 - y * y);
    const ripple = 1.42 + .045 * Math.sin(a * 4) * Math.cos(y * 12);
    surface.push(addNode(new THREE.Vector3(Math.cos(a) * r * ripple, y * ripple, Math.sin(a) * r * ripple), i % 7 === 0 ? 1 : 0, .75 + rng() * .55));
  }
  const cells = new Map<string, number[]>();
  const key = (p: THREE.Vector3) => `${Math.floor(p.x * 5)},${Math.floor(p.y * 5)},${Math.floor(p.z * 5)}`;
  for (const index of surface) {
    const p = nodes[index];
    const cx = Math.floor(p.x * 5), cy = Math.floor(p.y * 5), cz = Math.floor(p.z * 5);
    const near: Array<{index: number; distance: number}> = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      for (const other of cells.get(`${cx + x},${cy + y},${cz + z}`) || []) {
        const distance = p.distanceTo(nodes[other]);
        if (distance < .48) near.push({index: other, distance});
      }
    }
    near.sort((a, b) => a.distance - b.distance);
    near.slice(0, 3).forEach(item => join(index, item.index));
    const cell = key(p);
    cells.set(cell, [...(cells.get(cell) || []), index]);
  }
  // Join the membrane to the biological tree so cascades can traverse both layers.
  for (let i = 0; i < 36; i++) {
    const a = trunks[Math.floor(rng() * trunks.length)];
    let best = surface[0], distance = Infinity;
    for (const b of surface) {
      const d = nodes[a].distanceToSquared(nodes[b]);
      if (d < distance) { distance = d; best = b; }
    }
    join(a, best);
  }

  // Breadth first hop distance follows actual edges, as in the Neural Cloud reference.
  const hops = new Float32Array(nodes.length).fill(9999);
  const queue = new Int32Array(nodes.length);
  queue[0] = root; hops[root] = 0;
  let head = 0, tail = 1;
  while (head < tail) {
    const current = queue[head++];
    for (const next of adjacency[current]) if (hops[next] === 9999) {
      hops[next] = hops[current] + 1;
      queue[tail++] = next;
    }
  }
  const positions = new Float32Array(nodes.length * 3);
  const pointColor = new Float32Array(nodes.length * 3);
  nodes.forEach((node, index) => {
    node.toArray(positions, index * 3);
    (colors[index] ? gold : cyan).toArray(pointColor, index * 3);
  });
  const points = new THREE.BufferGeometry();
  points.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  points.setAttribute("aColor", new THREE.BufferAttribute(pointColor, 3));
  points.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
  points.setAttribute("aHop", new THREE.BufferAttribute(hops, 1));
  points.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  const linePositions = new Float32Array(connections.length * 6);
  const lineColors = new Float32Array(connections.length * 6);
  const linePhases = new Float32Array(connections.length * 2);
  const lineHops = new Float32Array(connections.length * 2);
  const edgeT = new Float32Array(connections.length * 2);
  connections.forEach(([a, b], i) => {
    nodes[a].toArray(linePositions, i * 6);
    nodes[b].toArray(linePositions, i * 6 + 3);
    (colors[a] ? gold : cyan).toArray(lineColors, i * 6);
    (colors[b] ? gold : cyan).toArray(lineColors, i * 6 + 3);
    linePhases[i * 2] = linePhases[i * 2 + 1] = phases[a];
    lineHops[i * 2] = hops[a]; lineHops[i * 2 + 1] = hops[b];
    edgeT[i * 2 + 1] = 1;
  });
  const lines = new THREE.BufferGeometry();
  lines.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  lines.setAttribute("aColor", new THREE.BufferAttribute(lineColors, 3));
  lines.setAttribute("aPhase", new THREE.BufferAttribute(linePhases, 1));
  lines.setAttribute("aHop", new THREE.BufferAttribute(lineHops, 1));
  lines.setAttribute("aEdgeT", new THREE.BufferAttribute(edgeT, 1));
  return {points, lines, nodeCount: nodes.length, dispose: () => {points.dispose(); lines.dispose();}};
}
