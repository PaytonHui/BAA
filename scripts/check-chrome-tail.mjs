import {
  CHROME_TAIL_CLUSTERS,
  chromeOrbitPoint,
  chromeTailFade,
  chromeTailSample,
  chromeTailSpan,
  chromeTailU,
} from "../src/lib/chromeTail.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function travel(spec, ang, t) {
  const eps = 1e-3;
  const dt = eps / spec.speed;
  const a = chromeOrbitPoint(
    ang,
    spec.r,
    spec.depth,
    spec.y,
    spec.bobAmp,
    spec.bobPhase,
    t
  );
  const b = chromeOrbitPoint(
    ang + eps,
    spec.r,
    spec.depth,
    spec.y,
    spec.bobAmp,
    spec.bobPhase,
    t + dt
  );
  return { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
}

for (const ang of [0, 0.6, 1.2, 2.1, 3.4, 4.8, 5.9]) {
  const spec = {
    ang,
    speed: 1.1,
    r: 1.2,
    depth: 0.9,
    y: 0.2,
    bobAmp: 0.08,
    bobPhase: 0.4,
    t: 3.2,
    insetRad: 0.12,
  };
  const head = chromeOrbitPoint(
    ang,
    spec.r,
    spec.depth,
    spec.y,
    spec.bobAmp,
    spec.bobPhase,
    spec.t
  );
  const vel = travel(spec, ang, spec.t);
  const velLen = Math.hypot(vel.x, vel.y, vel.z);
  let prevBehind = 0;

  for (let c = 0; c < CHROME_TAIL_CLUSTERS; c++) {
    const u = chromeTailU(c, CHROME_TAIL_CLUSTERS);
    const sample = chromeTailSample(spec, u);
    assert(Number.isFinite(sample.x + sample.y + sample.z), `nan at ${ang}`);
    const behind =
      ((sample.x - head.x) * vel.x +
        (sample.y - head.y) * vel.y +
        (sample.z - head.z) * vel.z) /
      velLen;
    assert(behind < -0.04, `shine is in front of the star at ${ang} cluster ${c}: ${behind}`);
    if (c > 0) assert(behind < prevBehind - 0.02, `cluster ${c} is not farther behind at ${ang}`);
    prevBehind = behind;

    const dt = (spec.insetRad + u * chromeTailSpan(spec.speed)) / spec.speed;
    const onOrbit = chromeOrbitPoint(
      ang - spec.insetRad - u * chromeTailSpan(spec.speed),
      spec.r,
      spec.depth,
      spec.y,
      spec.bobAmp,
      spec.bobPhase,
      spec.t - dt
    );
    const miss = Math.hypot(sample.x - onOrbit.x, sample.y - onOrbit.y, sample.z - onOrbit.z);
    assert(miss < 1e-4, `shine left the orbit at ${ang}: ${miss}`);
    assert(Math.abs(sample.fade - chromeTailFade(u)) < 1e-6, "fade");
  }

  const first = chromeTailSample(spec, chromeTailU(0, CHROME_TAIL_CLUSTERS));
  const last = chromeTailSample(spec, chromeTailU(CHROME_TAIL_CLUSTERS - 1, CHROME_TAIL_CLUSTERS));
  assert(first.fade > last.fade, "tip is brighter than the head of the tail");

  const tipAng = ang - spec.insetRad - chromeTailU(CHROME_TAIL_CLUSTERS - 1, CHROME_TAIL_CLUSTERS) * chromeTailSpan(spec.speed);
  const tipDt = (ang - tipAng) / spec.speed;
  const lagged = chromeOrbitPoint(tipAng, spec.r, spec.depth, spec.y, spec.bobAmp, spec.bobPhase, spec.t - tipDt);
  const now = chromeOrbitPoint(tipAng, spec.r, spec.depth, spec.y, spec.bobAmp, spec.bobPhase, spec.t);
  assert(Math.abs(lagged.y - now.y) > 0.01, `tip bob used the current time at ${ang}`);
  assert(Math.abs(last.y - lagged.y) < 1e-4, "tip y");
}

console.log("chrome tail ok");
