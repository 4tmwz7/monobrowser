import assert from "node:assert/strict";
import test from "node:test";
import { buildSwipeTriggerScript, createSwipeNavigationDetector, parseSwipeMessage, type SwipeDirection } from "./swipe-navigation.js";

const setup = () => {
  let time = 0;
  const swipes: SwipeDirection[] = [];
  const detector = createSwipeNavigationDetector({
    threshold: 100,
    idleMs: 300,
    now: () => time,
    onSwipe: (direction) => swipes.push(direction),
  });
  return {
    swipes,
    detector,
    wheel: (deltaX: number, deltaY = 0, at = time) => {
      time = at;
      detector.handleWheel(deltaX, deltaY);
    },
  };
};

test("a horizontal two-finger swipe navigates once per gesture", () => {
  const { swipes, wheel } = setup();
  wheel(-40, 0, 0);
  wheel(-40, 0, 16);
  assert.deepEqual(swipes, []);
  wheel(-40, 0, 32);
  assert.deepEqual(swipes, ["back"]);
  wheel(-80, 0, 48);
  assert.deepEqual(swipes, ["back"], "momentum of the same gesture must not navigate again");
});

test("positive deltaX goes forward", () => {
  const { swipes, wheel } = setup();
  wheel(150, 2, 0);
  assert.deepEqual(swipes, ["forward"]);
});

test("vertical scrolling never navigates", () => {
  const { swipes, wheel } = setup();
  for (let i = 0; i < 20; i++) wheel(5, 60, i * 16);
  assert.deepEqual(swipes, []);
});

test("a pause resets the gesture", () => {
  const { swipes, wheel } = setup();
  wheel(-60, 0, 0);
  wheel(-60, 0, 1000);
  assert.deepEqual(swipes, [], "two separated small movements must not add up");
  wheel(-60, 0, 1016);
  assert.deepEqual(swipes, ["back"]);
});

test("a cancelled gesture never navigates, the next one does", () => {
  const { swipes, wheel, detector } = setup();
  wheel(-60, 0, 0);
  detector.cancelGesture();
  wheel(-200, 0, 16);
  assert.deepEqual(swipes, [], "the page scrolled horizontally during this gesture");
  wheel(-200, 0, 1000);
  assert.deepEqual(swipes, ["back"]);
});

test("swipe messages need the nonce and a known direction", () => {
  assert.equal(parseSwipeMessage("MBSWIPE:abc:back", "abc"), "back");
  assert.equal(parseSwipeMessage("MBSWIPE:abc:forward", "abc"), "forward");
  assert.equal(parseSwipeMessage("MBSWIPE:xyz:back", "abc"), null);
  assert.equal(parseSwipeMessage("MBSWIPE:abc:reload", "abc"), null);
  assert.equal(parseSwipeMessage(42, "abc"), null);
});

test("the injected script parses and embeds the nonce", () => {
  const script = buildSwipeTriggerScript("n0nce", { animate: true, canGoBack: true, canGoForward: true, colors: { bg: "#111111", fg: "#eeeeee", accent: "#777777", onAccent: "#000000" } });
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes("MBSWIPE:n0nce:"));
});

test("progress follows the gesture and reaches 1 when it navigates", () => {
  const progress: number[] = [];
  const detector = createSwipeNavigationDetector({ threshold: 100, now: () => 0, onSwipe: () => undefined, onProgress: (value) => progress.push(value) });
  detector.handleWheel(-50, 0);
  detector.handleWheel(-80, 0);
  assert.deepEqual(progress, [-0.5, -1]);
});

test("the script without animations has no transitions", () => {
  assert.ok(buildSwipeTriggerScript("n", { animate: true, canGoBack: true, canGoForward: false, colors: { bg: "#111111", fg: "#eeeeee", accent: "#777777", onAccent: "#000000" } }).includes("transition:"));
  assert.ok(!buildSwipeTriggerScript("n", { animate: false, canGoBack: true, canGoForward: false, colors: { bg: "#111111", fg: "#eeeeee", accent: "#777777", onAccent: "#000000" } }).includes("transition:"));
});

test("the indicator uses the theme colors", () => {
  const script = buildSwipeTriggerScript("n", { animate: true, canGoBack: true, canGoForward: true, colors: { bg: "#101010", fg: "#fafafa", accent: "#ff8800", onAccent: "#000000" } });
  assert.ok(script.includes("#ff8800") && script.includes("#101010"));
  assert.ok(!/#f2f0eb|#111;/.test(script), "no hardcoded colors");
});
