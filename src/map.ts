import { MAP } from "./map-data";

/**
 * The pixelated world map behind the portfolio: land as dots, the places
 * I've been, and a traveling pixel that flies out from Salt Lake City on
 * each trip and home again. Drawn on a fixed, viewport-sized canvas.
 */

type Stop = { name: string; lat: number; lon: number };
export const TRIPS: Stop[][] = [
      [{ name: 'Mexico City, Mexico', lat: 19.43, lon: -99.13 }],
      [{ name: 'Lake Havasu, Arizona', lat: 34.48, lon: -114.32 }],
      [{ name: 'Vancouver, Canada', lat: 49.28, lon: -123.12 }],
      [{ name: 'San Francisco, Bay Area', lat: 37.77, lon: -122.42 }],
      [{ name: 'Sequoia National Park', lat: 36.49, lon: -118.57 }],
      [{ name: 'Panama City, Panama', lat: 8.98, lon: -79.52 }],
      [{ name: 'San José, Costa Rica', lat: 9.93, lon: -84.08 }],
      [{ name: 'New York City', lat: 40.71, lon: -74.01 }],
      [{ name: 'Punta Cana, Dominican Republic', lat: 18.58, lon: -68.37 }],
      [{ name: 'Jackson Hole, Wyoming', lat: 43.48, lon: -110.76 }],
      [{ name: 'Paris, France', lat: 48.86, lon: 2.35 }, { name: 'Madrid, Spain', lat: 40.42, lon: -3.70 }, { name: 'London, Britain', lat: 51.51, lon: -0.13 }],
      [{ name: 'Louisville, Kentucky', lat: 38.25, lon: -85.76 }],
      [{ name: 'San Salvador, El Salvador', lat: 13.69, lon: -89.19 }, { name: 'Lima, Peru', lat: -12.05, lon: -77.04 }, { name: 'Sacred Valley, Peru', lat: -13.31, lon: -72.12 }, { name: 'Cusco, Peru', lat: -13.53, lon: -71.97 }, { name: 'Amazon (Puerto Maldonado), Peru', lat: -12.59, lon: -69.19 }],
      [{ name: 'San Diego, California', lat: 32.72, lon: -117.16 }],
      [{ name: 'Las Vegas, Nevada', lat: 36.17, lon: -115.14 }],
      [{ name: 'Zion National Park', lat: 37.3, lon: -113.03 }],
      [{ name: 'Siem Reap, Cambodia', lat: 13.36, lon: 103.86 }, { name: 'Phnom Penh, Cambodia', lat: 11.56, lon: 104.92 }, { name: 'Da Nang, Vietnam', lat: 16.05, lon: 108.21 }, { name: 'Ho Chi Minh City (Saigon), Vietnam', lat: 10.78, lon: 106.70 }, { name: 'Hoi An, Vietnam', lat: 15.88, lon: 108.34 }, { name: 'Taipei, Taiwan', lat: 25.03, lon: 121.57 }],
      [{ name: 'Washington, DC', lat: 38.91, lon: -77.04 }],
      [{ name: 'Monterey, California', lat: 36.6, lon: -121.89 }],
      [{ name: 'Zurich, Switzerland', lat: 47.38, lon: 8.54 }, { name: 'Munich, Germany', lat: 48.14, lon: 11.58 }, { name: 'Berlin, Germany', lat: 52.52, lon: 13.41 }, { name: 'Budapest, Hungary', lat: 47.50, lon: 19.04 }, { name: 'Prague, Czechia', lat: 50.08, lon: 14.44 }, { name: 'Vienna, Austria', lat: 48.21, lon: 16.37 }, { name: 'Salzburg, Austria', lat: 47.81, lon: 13.04 }],
      [{ name: 'Honolulu, Hawaii', lat: 21.31, lon: -157.86 }],
      [{ name: 'Capitol Reef National Park', lat: 38.37, lon: -111.26 }],
      [{ name: 'Luxor, Egypt', lat: 25.69, lon: 32.64 }, { name: 'Cairo, Egypt', lat: 30.04, lon: 31.24 }],
      [{ name: 'Milwaukee, Wisconsin', lat: 43.04, lon: -87.91 }],
      [{ name: 'Livingstone, Zambia', lat: -17.85, lon: 25.85 }],
      [{ name: 'Mount Shasta, California', lat: 41.41, lon: -122.19 }],
      [{ name: 'Bogotá, Colombia', lat: 4.71, lon: -74.07 }, { name: 'Cartagena, Colombia', lat: 10.39, lon: -75.51 }, { name: 'Medellín, Colombia', lat: 6.24, lon: -75.58 }],
      [{ name: 'Twin Falls, Idaho', lat: 42.56, lon: -114.46 }],
      [{ name: 'Canyonlands National Park', lat: 38.33, lon: -109.86 }],
      [{ name: 'Sydney, Australia', lat: -33.87, lon: 151.21 }, { name: 'Cairns, Australia', lat: -16.92, lon: 145.77 }, { name: 'Great Barrier Reef', lat: -16.29, lon: 145.98 }, { name: 'Adelaide, Australia', lat: -34.93, lon: 138.60 }, { name: 'Hobart, Tasmania', lat: -42.88, lon: 147.33 }, { name: 'Melbourne, Australia', lat: -37.81, lon: 144.96 }],
      [{ name: 'Rome, Italy', lat: 41.90, lon: 12.50 }, { name: 'Vatican City', lat: 41.90, lon: 12.45 }, { name: 'Venice, Italy', lat: 45.44, lon: 12.33 }, { name: 'Florence, Italy', lat: 43.77, lon: 11.26 }, { name: 'Naples, Italy', lat: 40.85, lon: 14.27 }, { name: 'Pisa, Italy', lat: 43.72, lon: 10.40 }, { name: 'Cinque Terre, Italy', lat: 44.13, lon: 9.71 }, { name: 'Amalfi Coast, Italy', lat: 40.63, lon: 14.60 }, { name: 'Amsterdam, Netherlands', lat: 52.37, lon: 4.90 }],
      [{ name: 'Portland, Oregon', lat: 45.52, lon: -122.68 }],
      [{ name: 'Bryce Canyon National Park', lat: 37.59, lon: -112.19 }],
      [{ name: 'Anchorage, Alaska', lat: 61.22, lon: -149.90 }],
      [{ name: 'São Paulo, Brazil', lat: -23.55, lon: -46.63 }, { name: 'Rio de Janeiro, Brazil', lat: -22.91, lon: -43.17 }, { name: 'Iguaçu Falls, Brazil', lat: -25.69, lon: -54.44 }, { name: 'Salvador, Brazil', lat: -12.97, lon: -38.51 }, { name: 'Amazon (Manaus), Brazil', lat: -3.12, lon: -60.02 }, { name: 'Buenos Aires, Argentina', lat: -34.60, lon: -58.38 }, { name: 'Asunción, Paraguay', lat: -25.26, lon: -57.58 }],
      [{ name: 'Arches National Park', lat: 38.73, lon: -109.59 }],
      [{ name: 'Ljubljana, Slovenia', lat: 46.05, lon: 14.51 }, { name: 'Dubrovnik, Croatia', lat: 42.65, lon: 18.09 }, { name: 'Zagreb, Croatia', lat: 45.81, lon: 15.98 }, { name: 'Kotor, Montenegro', lat: 42.42, lon: 18.77 }, { name: 'Mostar, Bosnia & Herzegovina', lat: 43.34, lon: 17.81 }, { name: 'Bratislava, Slovakia', lat: 48.15, lon: 17.11 }, { name: 'Kraków, Poland', lat: 50.06, lon: 19.94 }],
      [{ name: 'San Ignacio, Belize', lat: 17.16, lon: -89.07 }, { name: 'Ambergris Caye, Belize', lat: 17.92, lon: -87.96 }, { name: 'Antigua, Guatemala', lat: 14.56, lon: -90.73 }],
    ]

export function startMap(canvas: HTMLCanvasElement) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d")!;
  const COLS = MAP.cols, ROWS = MAP.rows;
  const bytes = Uint8Array.from(atob(MAP.b64), (ch) => ch.charCodeAt(0));
  const land = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < COLS * ROWS; i++) land[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  const landIdx: number[] = [];
  for (let i = 0; i < land.length; i++) if (land[i]) landIdx.push(i);
  // Salt Lake City
  const SLC = { lon: -111.891, lat: 40.761 };
  const slcC = Math.floor(((SLC.lon + 180) / 360) * COLS);
  const slcR = Math.floor(((MAP.latMax - SLC.lat) / (MAP.latMax - MAP.latMin)) * ROWS);

  const PLACES = TRIPS.flat();
  const toCell = (lat: number, lon: number): [number, number] => [
    ((lon + 180) / 360) * COLS,
    ((MAP.latMax - lat) / (MAP.latMax - MAP.latMin)) * ROWS,
  ];
  const home = toCell(SLC.lat, SLC.lon);
  // Trip state: a list of waypoints (home, stops..., home); legs fly between consecutive ones.
  const trip = {
    i: -1,
    leg: 0,
    route: [] as [number, number][],
    phase: "idle" as "idle" | "fly" | "stay",
    t0: 0,
    dur: 0,
    from: home,
    to: home,
    trail: [] as [number, number, number][],
  };
  function startLeg(now: number) {
    trip.from = trip.route[trip.leg];
    trip.to = trip.route[trip.leg + 1];
    trip.dur = 1400 + Math.hypot(trip.to[0] - trip.from[0], trip.to[1] - trip.from[1]) * 45;
    trip.phase = "fly";
    trip.t0 = now;
  }
  function nextTrip(now: number) {
    if (!TRIPS.length) return;
    trip.i = (trip.i + 1) % TRIPS.length;
    trip.route = [home, ...TRIPS[trip.i].map((d) => toCell(d.lat, d.lon)), home];
    trip.leg = 0;
    startLeg(now);
  }
  function travelerPos(now: number): [number, number, number] {
    const k = Math.min(1, (now - trip.t0) / trip.dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const [ax, ay] = trip.from, [bx, by] = trip.to;
    const dist = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - dist * 0.22;
    const u = 1 - e;
    return [u * u * ax + 2 * u * e * mx + e * e * bx, u * u * ay + 2 * u * e * my + e * e * by, k];
  }
  function stepTraveler(now: number) {
    if (!TRIPS.length || reduce) return;
    if (trip.phase === "idle") {
      if (now - trip.t0 > 1500) nextTrip(now);
      return;
    }
    if (trip.phase === "fly") {
      const [, , k] = travelerPos(now);
      if (k >= 1) {
        trip.leg++;
        if (trip.leg >= trip.route.length - 1) {
          trip.phase = "idle";
          trip.t0 = now;
        } else {
          trip.phase = "stay";
          trip.t0 = now;
        }
      }
    } else if (trip.phase === "stay" && now - trip.t0 > 1600) startLeg(now);
  }
  function drawTraveler(now: number) {
    if (!TRIPS.length) return;
    const g = Math.max(1, cell - 2);
    const active = trip.phase !== "idle" ? TRIPS[trip.i] : null;
    for (let i = 0; i < PLACES.length; i++) {
      const d = toCell(PLACES[i].lat, PLACES[i].lon);
      const lit = active && active.includes(PLACES[i]);
      ctx.fillStyle = lit ? "rgba(201,223,122,0.6)" : "rgba(201,223,122,0.2)";
      ctx.fillRect(ox + Math.floor(d[0]) * cell + 1, oy + Math.floor(d[1]) * cell + 1, g, g);
    }
    let cx = -1, cy = -1;
    if (trip.phase === "fly") {
      const [x, y] = travelerPos(now);
      cx = Math.floor(x);
      cy = Math.floor(y);
      const last = trip.trail[trip.trail.length - 1];
      if (!last || last[0] !== cx || last[1] !== cy) trip.trail.push([cx, cy, now]);
    }
    // The tail erases itself the same way the head drew it: each cell lives LIFE ms after it was
    // drawn, then dissolves over DISSOLVE ms, so the path retracts from its origin at the pixel's pace.
    const LIFE = 2200, DISSOLVE = 700;
    while (trip.trail.length && now - trip.trail[0][2] > LIFE + DISSOLVE) trip.trail.shift();
    for (let i = 0; i < trip.trail.length; i++) {
      const age = now - trip.trail[i][2];
      const k = age < LIFE ? 1 : 1 - (age - LIFE) / DISSOLVE;
      ctx.fillStyle = `rgba(201,223,122,${0.3 * k})`;
      ctx.fillRect(ox + trip.trail[i][0] * cell + 1, oy + trip.trail[i][1] * cell + 1, g, g);
    }
    if (cx >= 0) {
      ctx.fillStyle = "rgba(236,230,214,0.7)";
      ctx.fillRect(ox + cx * cell + 1, oy + cy * cell + 1, g, g);
    }
  }

  let W = 0, H = 0, dpr = 1, cell = 6, ox = 0, oy = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Cover the viewport: the map spans the full width, or the full height on tall screens.
    cell = Math.max(W / COLS, (H * 0.9) / ROWS);
    ox = (W - cell * COLS) / 2;
    oy = (H - cell * ROWS) / 2;
  }

  function draw(t: number) {
    ctx.clearRect(0, 0, W, H);
    const g = Math.max(1, cell - 2);
    ctx.fillStyle = "rgba(143, 165, 151, 0.13)";
    for (let i = 0; i < landIdx.length; i++) {
      const idx = landIdx[i], x = idx % COLS, y = (idx - x) / COLS;
      ctx.fillRect(ox + x * cell + 1, oy + y * cell + 1, g, g);
    }
    drawTraveler(t);
    // Salt Lake City: pulsing marker
    const px = ox + (slcC + 0.5) * cell, py = oy + (slcR + 0.5) * cell;
    const pulse = reduce ? 0.5 : 0.5 + 0.5 * Math.sin(t / 500);
    ctx.fillStyle = "rgba(201,223,122,1)";
    ctx.fillRect(ox + slcC * cell + 1, oy + slcR * cell + 1, g, g);
    ctx.strokeStyle = `rgba(201,223,122,${0.7 * (1 - pulse)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, cell * (1.2 + 2.2 * pulse), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Only drawn while it can be seen (it's faded out behind the frog's screen).
  let visible = true;
  function loop(t: number) {
    if ((W === 0 || canvas.width === 0) && innerWidth > 0) resize();
    if (visible) {
      stepTraveler(t);
      draw(t);
    }
    requestAnimationFrame(loop);
  }
  resize();
  let rt = 0;
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = window.setTimeout(resize, 150);
  });
  requestAnimationFrame(loop);
  return { setVisible: (v: boolean) => (visible = v) };
}
